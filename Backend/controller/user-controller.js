import handleAsyncError from "../middleware/handleAsyncError.js";
import User from "../models/userModel.js";
import HandleError from "../utils/handleError.js";
import { sendToken } from "../utils/jwtToken.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../utils/emailTemplates.js";
import { v2 as cloudinary } from 'cloudinary';
import { deleteCachePattern } from '../utils/redis.js';
import { syncCustomerAnalytics } from '../Services/customer-analytics-service.js';
import { stitchIdentityFromRequest } from '../middleware/identityMiddleware.js';
import { invalidateSession } from '../middleware/sessionMiddleware.js';
import { fireSignUpEvent } from '../Services/analytics/analyticsOrchestrator.js';
 import Address from '../models/address-model.js';

const invalidateCaches = async () => {
  try {
    await Promise.all([
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('analytics_*'),
      deleteCachePattern('customer_analytics*')
    ]);
  } catch {
    // Cache invalidation failure must not affect the primary response
  }
};

const USER_LIST_SELECT = 'firstName lastName email role avatar.url authProvider emailVerified createdAt';

// ============================================
// REGISTER NEW USER (WITH EMAIL VERIFICATION)
// ===========================================

export const registerUser = handleAsyncError(async (req, res, next) => {
  const {
    firstName, lastName, email, password,
    phone, dateOfBirth, gender,
    shippingAddress,
  } = req.body;

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    if (existingUser.emailVerified) {
      return next(new HandleError("Email already registered. Please login instead.", 400));
    } else {
      await User.findByIdAndDelete(existingUser._id);
    }
  }

  // Validate shippingAddress once — reused for both User.create and Address.create
  // so the validation logic lives in exactly one place.
  const parsedAddress = (() => {
    if (!shippingAddress) return null;
    const {
      address: addrLine,
      city    = '',
      state,
      country,
      pinCode   = '',
      isDefault = false,
    } = shippingAddress;

    const hasMin =
      typeof addrLine === 'string' && addrLine.trim().length >= 5 &&
      typeof state    === 'string' && state.trim().length    >  0 &&
      typeof country  === 'string' && country.trim().length  >  0;

    if (!hasMin) return null;

    return {
      address:   addrLine.trim(),
      city:      city.trim(),
      state:     state.trim(),
      country:   country.trim(),
      pinCode:   pinCode.trim(),
      isDefault: Boolean(isDefault),
    };
  })();

  const user = await User.create({
    firstName,
    lastName,
    email: email.toLowerCase(),
    password,
    phone,
    dateOfBirth,
    gender,
    authProvider:  'local',
    emailVerified: false,
    // Write shippingAddress to the User document so Meta CAPI CompleteRegistration
    // (fired inside verifyEmail) has city/state/country/pinCode available as geo
    // signals at verification time. user.shippingAddress is the analytics fallback
    // copy; the Address model save below is the canonical checkout record.
    ...(parsedAddress && {
      shippingAddress: {
        address: parsedAddress.address,
        city:    parsedAddress.city,
        state:   parsedAddress.state,
        country: parsedAddress.country,
        pinCode: parsedAddress.pinCode,
      },
    }),
  });

  // Persist to Address model — canonical record used by the checkout flow.
  // Fire-and-forget: failure here must never block the verification email.
  if (parsedAddress) {
    try {
      await Address.create({
        user:      user._id,
        name:      user.fullName,
        phoneNo:   phone,
        address:   parsedAddress.address,
        city:      parsedAddress.city,
        state:     parsedAddress.state,
        country:   parsedAddress.country,
        pinCode:   parsedAddress.pinCode,
        isDefault: parsedAddress.isDefault,
      });
    } catch (addrErr) {
      console.error('[Register] Address save failed (non-fatal):', addrErr.message);
    }
  }

  const verificationCode = user.generateVerificationCode();
  await user.save({ validateBeforeSave: false });

  try {
    const emailTemplate = emailTemplates.verificationEmail(user.fullName, verificationCode);
    await sendEmail({
      email:   user.email,
      subject: emailTemplate.subject,
      message: emailTemplate.text,
      html:    emailTemplate.html,
    });

    res.status(201).json({
      success:           true,
      message:           `Verification code sent to ${user.email}. Please verify your email to complete registration.`,
      email:             user.email,
      needsVerification: true,
    });
  } catch {
    await User.findByIdAndDelete(user._id);
    return next(new HandleError("Could not send verification email. Please try again later.", 500));
  }
});

// ============================================
// VERIFY EMAIL WITH CODE
// ============================================

export const verifyEmail = handleAsyncError(async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return next(new HandleError("Email and verification code are required", 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) return next(new HandleError("User not found", 404));

  if (user.emailVerified) {
    return next(new HandleError("Email already verified. Please login.", 400));
  }

  const isCodeValid = user.verifyEmailCode(code);
  if (!isCodeValid) {
    return next(new HandleError("Invalid or expired verification code", 400));
  }

  user.emailVerified          = true;
  user.verificationCode       = undefined;
  user.verificationCodeExpire = undefined;
  await user.save();

  try {
    const welcomeTemplate = emailTemplates.welcomeEmail(user.fullName);
    await sendEmail({
      email:   user.email,
      subject: welcomeTemplate.subject,
      message: welcomeTemplate.text,
      html:    welcomeTemplate.html
    });
  } catch {
    // Welcome email failure must not block verification success
  }

  // Chain stitch after sync so the CustomerAnalytics document exists
  // before stitchIdentity runs. Both are fire-and-forget from the user's
  // perspective — the auth response is sent immediately below regardless.
  syncCustomerAnalytics(user._id)
    .then(() => stitchIdentityFromRequest(req))
    .catch(err =>
      console.error('[Identity] verifyEmail sync+stitch failed (non-fatal):', err.message)
    );

  // Fire Meta CAPI CompleteRegistration + GA4 sign_up — fire-and-forget
  fireSignUpEvent('email', user, req).catch(err =>
    console.error('[Analytics] fireSignUpEvent failed (non-fatal):', err.message)
  );

  invalidateCaches();

  sendToken(user, 200, res);
});

// ============================================
// RESEND VERIFICATION CODE
// ============================================

export const resendVerificationCode = handleAsyncError(async (req, res, next) => {
  const { email } = req.body;

  if (!email) return next(new HandleError("Email is required", 400));

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) return next(new HandleError("User not found", 404));

  if (user.emailVerified) {
    return next(new HandleError("Email already verified. Please login.", 400));
  }

  const verificationCode = user.generateVerificationCode();
  await user.save({ validateBeforeSave: false });

  try {
    const emailTemplate = emailTemplates.verificationEmail(user.fullName, verificationCode);
    await sendEmail({
      email:   user.email,
      subject: emailTemplate.subject,
      message: emailTemplate.text,
      html:    emailTemplate.html
    });

    res.status(200).json({
      success: true,
      message: `New verification code sent to ${user.email}`
    });
  } catch {
    user.verificationCode       = undefined;
    user.verificationCodeExpire = undefined;
    await user.save({ validateBeforeSave: false });

    return next(new HandleError("Could not send verification email. Please try again later.", 500));
  }
});

// ============================================
// LOGIN USER
// ============================================

export const loginUser = handleAsyncError(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new HandleError("Please enter email and password", 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

  if (!user) return next(new HandleError("Invalid email or password", 401));

  if (user.lockUntil && user.lockUntil > Date.now()) {
    const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
    return next(new HandleError(`Too many failed attempts. Your account has been temporarily locked. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 403));
  }

  if (user.authProvider === "local" && !user.emailVerified) {
    const verificationCode = user.generateVerificationCode();
    await user.save({ validateBeforeSave: false });

    try {
      const emailTemplate = emailTemplates.verificationEmail(user.fullName, verificationCode);
      await sendEmail({
        email:   user.email,
        subject: emailTemplate.subject,
        message: emailTemplate.text,
        html:    emailTemplate.html
      });

      return res.status(403).json({
        success:           false,
        message:           "Please verify your email before logging in.",
        needsVerification: true,
        email:             user.email
      });
    } catch {
      user.verificationCode       = undefined;
      user.verificationCodeExpire = undefined;
      await user.save({ validateBeforeSave: false });

      return next(new HandleError("Could not send verification email. Please try again later.", 500));
    }
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    await user.incrementLoginAttempts();
    return next(new HandleError("Invalid email or password", 401));
  }

  await user.resetLoginAttempts();

  stitchIdentityFromRequest(req).catch(err =>
    console.error('[Identity] Login stitch failed (non-fatal):', err.message)
  );

  sendToken(user, 200, res);
});

// ============================================
// LOGOUT
// ============================================

export const logout = handleAsyncError(async (req, res) => {
  res.cookie("token", null, {
    expires:  new Date(0),
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    path:     "/"
  });

  invalidateSession(req.sessionId, res).catch(err =>
    console.error('[Session] Invalidation failed (non-fatal):', err.message)
  );

  res.status(200).json({ success: true, message: "Successfully logged out" });
});

// ============================================
// FORGOT PASSWORD
// ============================================

export const requestPasswordReset = handleAsyncError(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) return next(new HandleError("No account found with this email", 404));

  if (!user.emailVerified && user.authProvider === "local") {
    return next(new HandleError("Please verify your email first", 403));
  }

  const resetCode = user.generatePasswordResetCode();
  await user.save({ validateBeforeSave: false });

  try {
    const template = emailTemplates.passwordResetEmail(user.fullName, resetCode);
    await sendEmail({
      email:   user.email,
      subject: template.subject,
      message: template.text,
      html:    template.html
    });

    res.status(200).json({
      success: true,
      message: `Password reset code sent to ${user.email}`
    });
  } catch {
    user.resetPasswordCode       = undefined;
    user.resetPasswordCodeExpire = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new HandleError("Could not send password reset email. Please try again later.", 500));
  }
});

// ============================================
// RESET PASSWORD WITH CODE
// ============================================

export const resetPasswordWithCode = handleAsyncError(async (req, res, next) => {
  const { email, code, password, confirmPassword } = req.body;

  if (!email || !code) {
    return next(new HandleError("Email and reset code are required", 400));
  }

  if (!password || password.length < 8) {
    return next(new HandleError("Password must be at least 8 characters", 400));
  }

  if (password !== confirmPassword) {
    return next(new HandleError("The passwords you entered do not match. Please try again.", 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

  if (!user) return next(new HandleError("User not found", 404));

  const isCodeValid = user.verifyResetCode(code);
  if (!isCodeValid) {
    return next(new HandleError("Invalid or expired reset code", 400));
  }

  if (await user.isPasswordReused(password)) {
    return next(new HandleError("This password was used recently. Please choose a different password.", 400));
  }

  user.password                = password;
  user.resetPasswordCode       = undefined;
  user.resetPasswordCodeExpire = undefined;
  await user.save();

  try {
    const emailTemplate = emailTemplates.passwordChangedEmail(user.fullName);
    await sendEmail({
      email:   user.email,
      subject: emailTemplate.subject,
      message: emailTemplate.text,
      html:    emailTemplate.html
    });
  } catch {
    // Email confirmation failure must not block the password reset
  }

  sendToken(user, 200, res);
});

// ============================================
// VERIFY RESET CODE
// ============================================

export const verifyResetCode = handleAsyncError(async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return next(new HandleError("Email and reset code are required", 400));
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) return next(new HandleError("User not found", 404));

  const isCodeValid = user.verifyResetCode(code);
  if (!isCodeValid) {
    return next(new HandleError("Invalid or expired reset code", 400));
  }

  res.status(200).json({ success: true, message: "Code verified successfully" });
});

// ============================================
// UPDATE PASSWORD
// ============================================

export const UpdatePassword = handleAsyncError(async (req, res, next) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;

  const user = await User.findById(req.user.id).select("+password");

  if (!(await user.comparePassword(oldPassword))) {
    return next(new HandleError("Your current password is incorrect. Please try again.", 400));
  }

  if (!newPassword || newPassword.length < 8) {
    return next(new HandleError("Password must be at least 8 characters", 400));
  }

  if (newPassword !== confirmPassword) {
    return next(new HandleError("The new passwords you entered do not match. Please try again.", 400));
  }

  if (await user.isPasswordReused(newPassword)) {
    return next(new HandleError("This password was used recently. Please choose a different password.", 400));
  }

  user.password = newPassword;
  await user.save();

  try {
    const emailTemplate = emailTemplates.passwordChangedEmail(user.fullName);
    await sendEmail({
      email:   user.email,
      subject: emailTemplate.subject,
      message: emailTemplate.text,
      html:    emailTemplate.html
    });
  } catch {
    // Email confirmation failure must not block the password update
  }

  sendToken(user, 200, res);
});

// ============================================
// GET USER DETAILS (PROFILE)
// ============================================

export const getUserDetails = handleAsyncError(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  res.status(200).json({
    success:   true,
    user,
    sessionId: req.sessionId || null,
  });
});

// ============================================
// UPDATE USER PROFILE
// ============================================

export const updateProfile = handleAsyncError(async (req, res, next) => {
  const { firstName, lastName, email, avatar, phone, dateOfBirth, gender, shippingAddress } = req.body;

  const updateUserDetails = {};

  if (firstName       !== undefined) updateUserDetails.firstName = firstName;
  if (lastName        !== undefined) updateUserDetails.lastName  = lastName;
  if (email           !== undefined) updateUserDetails.email     = email?.toLowerCase();
  if (phone           !== undefined) updateUserDetails.phone     = phone;
  if (gender          !== undefined) updateUserDetails.gender    = gender;
  if (shippingAddress !== undefined) updateUserDetails.shippingAddress = shippingAddress;

  if (dateOfBirth !== undefined) {
    const parsed = new Date(dateOfBirth);
    if (isNaN(parsed.getTime())) {
      return next(new HandleError('Invalid date of birth format', 400));
    }
    updateUserDetails.dateOfBirth = parsed;
  }

  if (avatar && avatar !== '') {
    const user    = await User.findById(req.user.id);
    const imageId = user.avatar.public_id;

    if (imageId !== 'default_avatar') {
      await cloudinary.uploader.destroy(imageId);
    }

    const myCloud = await cloudinary.uploader.upload(avatar, {
      folder: 'EpicStore/avatars',
      width:  200,
      crop:   'scale'
    });

    updateUserDetails.avatar = {
      public_id: myCloud.public_id,
      url:       myCloud.secure_url
    };
  }

  const current = await User.findById(req.user.id);
  const merged  = { ...current.toObject(), ...updateUserDetails };
  updateUserDetails.profileCompleted = !!(
    merged.firstName   &&
    merged.lastName    &&
    merged.email       &&
    merged.phone       &&
    merged.dateOfBirth &&
    merged.gender
  );

  const updatedUser = await User.findByIdAndUpdate(req.user.id, updateUserDetails, {
    new:            true,
    runValidators:  true
  });

  syncCustomerAnalytics(updatedUser._id).catch(() => {});

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user:    updatedUser
  });
});

// ============================================
// ADMIN — GET ALL USERS
// ============================================

export const getUsersList = handleAsyncError(async (req, res, next) => {
  const page  = Math.max(Number(req.query.page)  || 1, 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const skip  = (page - 1) * limit;

  const filter = {};

  const search = req.query.search?.trim();
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName:  { $regex: search, $options: 'i' } },
      { email:     { $regex: search, $options: 'i' } },
    ];
  }

  const { role, emailVerified, authProvider } = req.query;
  if (role         && ['user', 'admin', 'superAdmin'].includes(role))              filter.role         = role;
  if (authProvider && ['local', 'google', 'facebook'].includes(authProvider))      filter.authProvider = authProvider;
  if (emailVerified !== undefined) filter.emailVerified = emailVerified === 'true';

  const sortOptions = {
    newest:    { createdAt: -1 },
    oldest:    { createdAt:  1 },
    name_asc:  { firstName:  1 },
    name_desc: { firstName: -1 },
  };
  const sort = sortOptions[req.query.sort] || sortOptions.newest;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(USER_LIST_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  let stats = null;
  const isBaseQuery = !search && !role && !emailVerified && !authProvider;
  if (isBaseQuery && page === 1) {
    const [result] = await User.aggregate([
      {
        $facet: {
          total:      [{ $count: 'n' }],
          admins:     [{ $match: { role: 'admin' } },       { $count: 'n' }],
          superAdmins:[{ $match: { role: 'superAdmin' } },  { $count: 'n' }],
          verified:   [{ $match: { emailVerified: true } },  { $count: 'n' }],
          google:     [{ $match: { authProvider: 'google' } }, { $count: 'n' }],
        }
      }
    ]);
    const ex = (arr) => arr?.[0]?.n ?? 0;
    stats = {
      total:       ex(result.total),
      admins:      ex(result.admins),
      superAdmins: ex(result.superAdmins),
      verified:    ex(result.verified),
      google:      ex(result.google),
    };
    stats.regularUsers = stats.total - stats.admins - stats.superAdmins;
  }

  res.status(200).json({
    success:       true,
    users,
    total,
    totalPages:    Math.ceil(total / limit),
    currentPage:   page,
    resultPerPage: limit,
    stats,
  });
});

// ============================================
// ADMIN — GET SINGLE USER
// ============================================

export const getSingleUser = handleAsyncError(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) return next(new HandleError(`Invalid user ID: ${req.params.id}`, 400));

  res.status(200).json({ success: true, user });
});

// ============================================
// ADMIN — UPDATE USER ROLE
// ============================================

export const updateUserRole = handleAsyncError(async (req, res, next) => {
  const { role }         = req.body;
  const targetUserId     = req.params.id;
  const requestingUser   = req.user;

  const VALID_ROLES = ['user', 'admin', 'superAdmin'];
  if (!VALID_ROLES.includes(role)) {
    return next(new HandleError(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, 400));
  }

  const targetUser = await User.findById(targetUserId);
  if (!targetUser) return next(new HandleError('User not found', 404));

  if (
    String(targetUser._id) === String(requestingUser._id) &&
    requestingUser.role === 'superAdmin' &&
    role !== 'superAdmin'
  ) {
    return next(new HandleError('You cannot change your own role.', 403));
  }

  const isElevatedTarget = ['admin', 'superAdmin'].includes(targetUser.role);
  const isElevatedRole   = ['admin', 'superAdmin'].includes(role);
  if ((isElevatedTarget || isElevatedRole) && requestingUser.role !== 'superAdmin') {
    return next(new HandleError('Only a superAdmin can manage admin and superAdmin roles', 403));
  }

  if (isElevatedTarget && role === 'user') {
    const privilegedCount = await User.countDocuments({
      role: { $in: ['admin', 'superAdmin'] },
    });
    if (privilegedCount <= 1) {
      return next(new HandleError('This action is not allowed. At least one admin account must remain active.', 403));
    }
  }

  const updatedUser = await User.findByIdAndUpdate(
    targetUserId,
    { role },
    { new: true, runValidators: true }
  ).select(USER_LIST_SELECT);

  if (!updatedUser) return next(new HandleError('User not found', 404));

  invalidateCaches();

  res.status(200).json({ success: true, user: updatedUser });
});

// ============================================
// ADMIN — DELETE USER
// ============================================

export const deleteUser = handleAsyncError(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new HandleError('Invalid user', 400));

  await User.findByIdAndDelete(req.params.id);
  invalidateCaches();

  return res.status(200).json({
    success: true,
    message: `User with ID: ${req.params.id} was deleted successfully`
  });
});