import handleAsyncError from "../middleware/handleAsyncError.js";
import User from "../models/userModel.js";
import HandleError from "../utils/handleError.js";
import { sendToken } from "../utils/jwtToken.js";
import { sendEmail } from "../utils/sendEmail.js";
import { emailTemplates } from "../utils/emailTemplates.js";
import Product from '../models/product-model.js';
import Order from '../models/order-model.js';
import crypto from "crypto";
import {v2 as cloudinary} from 'cloudinary';
import { deleteCachePattern } from '../utils/redis.js';

const invalidateCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
    }
};


// REGISTER NEW USER (WITH EMAIL VERIFICATION) 

export const registerUser = handleAsyncError(async (req, res, next) => {
    const { firstName, lastName, email, password } = req.body;

    // ✅ Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
        if (existingUser.emailVerified) {
            return next(new HandleError("Email already registered. Please login instead.", 400));
        } else {
            // User exists but not verified - allow re-registration
            await User.findByIdAndDelete(existingUser._id);
        }
    }

    // ✅ Create user (no avatar at registration)
    const user = await User.create({
        firstName,
        lastName,
        email: email.toLowerCase(),
        password,
        authProvider: 'local',
        emailVerified: false
        // Avatar will use default with initials automatically
    });

    // Generate verification code
    const verificationCode = user.generateVerificationCode();
    await user.save({ validateBeforeSave: false });

    // Send verification email
    try {
        const emailTemplate = emailTemplates.verificationEmail(user.fullName, verificationCode);
        await sendEmail({
            email: user.email,
            subject: emailTemplate.subject,
            message: emailTemplate.text,
            html: emailTemplate.html
        });

        res.status(201).json({
            success: true,
            message: `Verification code sent to ${user.email}. Please verify your email to complete registration.`,
            email: user.email,
            needsVerification: true
        });

    } catch (error) {
        // If email fails, delete the user
        await User.findByIdAndDelete(user._id);
        return next(new HandleError("Could not send verification email. Please try again later.", 500));
    }
});


// VERIFY EMAIL WITH CODE

export const verifyEmail = handleAsyncError(async (req, res, next) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return next(new HandleError("Email and verification code are required", 400));
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
        return next(new HandleError("User not found", 404));
    }

    if (user.emailVerified) {
        return next(new HandleError("Email already verified. Please login.", 400));
    }

    // Verify code
    const isCodeValid = user.verifyEmailCode(code);

    if (!isCodeValid) {
        return next(new HandleError("Invalid or expired verification code", 400));
    }

    // Mark email as verified
    user.emailVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpire = undefined;
    await user.save();

    // Send welcome email
    try {
        const welcomeTemplate = emailTemplates.welcomeEmail(user.name);
        await sendEmail({
            email: user.email,
            subject: welcomeTemplate.subject,
            message: welcomeTemplate.text,
            html: welcomeTemplate.html
        });
    } catch (error) {
        console.error('Failed to send welcome email:', error);
        // Don't fail verification if welcome email fails
    }

    await invalidateCaches();

    // Login user automatically after verification
    sendToken(user, 200, res);
});


// RESEND VERIFICATION CODE

export const resendVerificationCode = handleAsyncError(async (req, res, next) => {
    const { email } = req.body;

    if (!email) {
        return next(new HandleError("Email is required", 400));
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
        return next(new HandleError("User not found", 404));
    }

    if (user.emailVerified) {
        return next(new HandleError("Email already verified. Please login.", 400));
    }

    // Generate new verification code
    const verificationCode = user.generateVerificationCode();
    await user.save({ validateBeforeSave: false });

    // Send verification email
    try {
        const emailTemplate = emailTemplates.verificationEmail(user.name, verificationCode);
        await sendEmail({
            email: user.email,
            subject: emailTemplate.subject,
            message: emailTemplate.text,
            html: emailTemplate.html
        });

        res.status(200).json({
            success: true,
            message: `New verification code sent to ${user.email}`
        });

    } catch (error) {
        user.verificationCode = undefined;
        user.verificationCodeExpire = undefined;
        await user.save({ validateBeforeSave: false });
        return next(new HandleError("Could not send verification email. Please try again later.", 500));
    }
});


// LOGIN USER (CHECK EMAIL VERIFICATION)

// LOGIN USER (CHECK EMAIL VERIFICATION + RESEND CODE IF NEEDED)

export const loginUser = handleAsyncError(async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return next(new HandleError("Please enter email and password", 400));
    }

    const user = await User.findOne({ email: email.toLowerCase() })
        .select("+password");

    if (!user) {
        return next(new HandleError("Invalid email or password", 401));
    }

    // ✅ Check if account is locked
    if (user.lockUntil && user.lockUntil > Date.now()) {
        const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return next(
            new HandleError(`Account locked. Try again in ${mins} minutes.`, 403)
        );
    }

    // ✅ Check if email is verified
    if (user.authProvider === "local" && !user.emailVerified) {
        // Generate NEW verification code
        const verificationCode = user.generateVerificationCode();
        await user.save({ validateBeforeSave: false });

        // Send verification email
        try {
            const emailTemplate = emailTemplates.verificationEmail(user.name, verificationCode);
            await sendEmail({
                email: user.email,
                subject: emailTemplate.subject,
                message: emailTemplate.text,
                html: emailTemplate.html
            });

            console.log(`✅ Verification code sent to ${user.email} during login attempt`);

            // Return response telling user to verify
            return res.status(403).json({
                success: false,
                message: "Please verify your email before logging in. A new verification code has been sent.",
                needsVerification: true,
                email: user.email
            });

        } catch (error) {
            console.error('❌ Failed to send verification email during login:', error);
            user.verificationCode = undefined;
            user.verificationCodeExpire = undefined;
            await user.save({ validateBeforeSave: false });
            return next(new HandleError("Could not send verification email. Please try again later.", 500));
        }
    }

    // ✅ Verify password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
        await user.incrementLoginAttempts();
        return next(new HandleError("Invalid email or password", 401));
    }

    await user.resetLoginAttempts();
    sendToken(user, 200, res);
});


// LOGOUT FUNCTION

export const logout = handleAsyncError(async (req, res) => {
  res.cookie("token", null, {
    expires: new Date(0),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/"
  });

  res.status(200).json({
    success: true,
    message: "Successfully logged out"
  });
});



// FORGOT PASSWORD (SEND CODE)

export const requestPasswordReset = handleAsyncError(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return next(new HandleError("No account found with this email", 404));
  }

  if (!user.emailVerified && user.authProvider === "local") {
    return next(
      new HandleError("Please verify your email first", 403)
    );
  }

  const resetCode = user.generatePasswordResetCode();
  await user.save({ validateBeforeSave: false });

  const template = emailTemplates.passwordResetEmail(
    user.name,
    resetCode
  );

  await sendEmail({
    email: user.email,
    subject: template.subject,
    message: template.text,
    html: template.html
  });

  res.status(200).json({
    success: true,
    message: `Password reset code sent to ${user.email}`
  });
});


// RESET PASSWORD WITH CODE

export const resetPasswordWithCode = handleAsyncError(async(req, res, next) => {
    const { email, code, password, confirmPassword } = req.body;

    if (!email || !code) {
        return next(new HandleError("Email and reset code are required", 400));
    }

    if (password !== confirmPassword) {
        return next(new HandleError('Passwords do not match', 400));
    }

    // Find user
    const user = await User.findOne({ 
        email: email.toLowerCase() 
    }).select('+password');

    if (!user) {
        return next(new HandleError('User not found', 404));
    }

    // Verify reset code
    const isCodeValid = user.verifyResetCode(code);

    if (!isCodeValid) {
        return next(new HandleError('Invalid or expired reset code', 400));
    }

    // Check if password is being reused
    const isPasswordReused = await user.isPasswordReused(password);
    if (isPasswordReused) {
        return next(new HandleError('Cannot reuse any of your last 5 passwords', 400));
    }

    // Update password
    user.password = password;
    user.resetPasswordCode = undefined;
    user.resetPasswordCodeExpire = undefined;
    await user.save();

    // Send password changed notification
    try {
        const emailTemplate = emailTemplates.passwordChangedEmail(user.name);
        await sendEmail({
            email: user.email,
            subject: emailTemplate.subject,
            message: emailTemplate.text,
            html: emailTemplate.html
        });
    } catch (error) {
        console.error('Failed to send password changed email:', error);
    }

    sendToken(user, 200, res);
});


// UPDATE PASSWORD

export const UpdatePassword = handleAsyncError(async(req, res, next) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password');

    // Verify old password
    const checkPasswordMatch = await user.comparePassword(oldPassword);
    if(!checkPasswordMatch){
        return next(new HandleError(`Old password is incorrect`, 400));
    }

    if(newPassword !== confirmPassword){
        return next(new HandleError(`Passwords do not match`, 400));
    }

    // Check if new password is being reused
    const isPasswordReused = await user.isPasswordReused(newPassword);
    if (isPasswordReused) {
        return next(new HandleError('Cannot reuse any of your last 5 passwords', 400));
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Send password changed notification
    try {
        const emailTemplate = emailTemplates.passwordChangedEmail(user.name);
        await sendEmail({
            email: user.email,
            subject: emailTemplate.subject,
            message: emailTemplate.text,
            html: emailTemplate.html
        });
    } catch (error) {
        console.error('Failed to send password changed email:', error);
    }

    sendToken(user, 200, res);
});


// GET USER DETAILS (PROFILE)

export const getUserDetails = handleAsyncError(async(req, res, next) => {
    const user = await User.findById(req.user.id);
    res.status(200).json({
        success: true,
        user
    });
});


// UPDATE USER PROFILE

export const updateProfile = handleAsyncError(async(req, res, next) => {
    const { firstName, lastName, email, avatar } = req.body;
    
    const updateUserDetails = {
        firstName,
        lastName,
        email: email?.toLowerCase(),
    };

    // Handle avatar upload
    if(avatar && avatar !== '') {
        const user = await User.findById(req.user.id);
        const imageId = user.avatar.public_id;
        
        // Delete old avatar if not default
        if (imageId !== 'default_avatar') {
            await cloudinary.uploader.destroy(imageId);
        }
        
        const myCloud = await cloudinary.uploader.upload(avatar, {
            folder: `EpicStore/avatars`,
            width: 200,
            crop: 'scale'
        });

        updateUserDetails.avatar = {
            public_id: myCloud.public_id,
            url: myCloud.secure_url
        };
    }

    // Mark profile as completed if all fields are present
    if (firstName && lastName && email) {
        updateUserDetails.profileCompleted = true;
    }

    const user = await User.findByIdAndUpdate(req.user.id, updateUserDetails, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        success: true,
        message: `Profile updated successfully`,
        user
    });
});


// ADMIN - GET ALL USERS

export const getUsersList = handleAsyncError(async(req, res, next) => {
    const users = await User.find();
    res.status(200).json({
        success: true,
        users
    });
});


// ADMIN - GET SINGLE USER

export const getSingleUser = handleAsyncError(async(req, res, next) => {
    const user = await User.findById(req.params.id);

    if(!user) {
        return next(new HandleError(`Invalid user ID: ${req.params.id}`, 400));
    }

    res.status(200).json({
        success: true,
        user
    });
});


// ADMIN - UPDATE USER ROLE

export const updateUserRole = handleAsyncError(async (req, res, next) => {
    const { role } = req.body;
    const targetUserId = req.params.id;

    if (role === 'user') {
        const adminCount = await User.countDocuments({ role: 'admin' });
        const targetUser = await User.findById(targetUserId);

        if (!targetUser) {
            return next(new HandleError("User not found", 404));
        }

        if (targetUser.role === 'admin' && adminCount === 1) {
            return next(new HandleError("Cannot downgrade the last admin", 403));
        }
    }

    const updatedUser = await User.findByIdAndUpdate(
        targetUserId,
        { role },
        { new: true, runValidators: true }
    );

    if (!updatedUser) {
        return next(new HandleError("User not found", 404));
    }

    await invalidateCaches();

    res.status(200).json({
        success: true,
        user: updatedUser
    });
});


// ADMIN - DELETE USER

export const deleteUser = handleAsyncError(async(req, res, next) => {
    const user = await User.findById(req.params.id);
    if(!user) {
        return next(new HandleError(`Invalid user`, 400));
    }

    await User.findByIdAndDelete(req.params.id);
    await invalidateCaches();
    
    return res.status(200).json({
        success: true,
        message: `User with ID: ${req.params.id} was deleted successfully`
    });
});


// ADMIN - GET DASHBOARD STATS

export const getAdminStats = handleAsyncError(async (req, res, next) => {
    try {
        const products = await Product.countDocuments();
        const users = await User.countDocuments();
        const orders = await Order.countDocuments();
        const orderList = await Order.find().populate('orderItems.product');
        const revenue = orderList.reduce((acc, order) => acc + order.totalPrice, 0);
        const outOfStock = await Product.countDocuments({ stock: { $lte: 0 } });
        const lowStock = await Product.countDocuments({ stock: { $gt: 0, $lte: 10 } });
        const inStock = await Product.countDocuments({ stock: { $gt: 0 } });

        res.status(200).json({
            success: true,
            products,
            orders: orders || 0,
            revenue: revenue || 0,
            users,
            outOfStock,
            lowStock: lowStock || 0,
            inStock
        });
    } catch (error) {
        console.error("Stats error:", error);
        return next(new HandleError("Failed to load dashboard stats", 500));
    }
});