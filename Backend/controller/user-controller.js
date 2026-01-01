import handleAsyncError from "../middleware/handleAsyncError.js";
import User from "../models/userModel.js";
import HandleError from "../utils/handleError.js";
import { sendToken } from "../utils/jwtToken.js";
import { sendEmail } from "../utils/sendEmail.js";
import crypto from "crypto";
import {v2 as cloudinary} from 'cloudinary';


//register new user
export const registerUser = handleAsyncError(async (req, res, next) => {

    const { name, email, password, avatar } = req.body;

    const myCloud = await cloudinary.uploader.upload(avatar, {
        folder: `EpicStore`,
        width: 150,
        crop: 'scale'
    })

    const user = await User.create({
        name,
        email,
        password,
        avatar: {
            public_id: myCloud.public_id,
            url: myCloud.secure_url,
        }
    })

    //get token
    sendToken(user, 201, res);

});

//login user
export const loginUser = handleAsyncError(async (req, res, next) => {
    const { email, password } = req.body;

    //check if user has given password and email both
    if(!email || !password) {
        return next(new HandleError("Please enter email and password", 400));
    }

    const user = await User.findOne({ email }).select("+password");

    if(!user) {
        return next(new HandleError("Invalid email or password", 401));
    }

    // Check password
    const isPasswordMatched = await user.comparePassword(password);

    if (!isPasswordMatched) {
        return next(new HandleError("Invalid email or password", 401));
    }

    //get token
    sendToken(user, 200, res);

});

//logout function
export const logout = handleAsyncError(async(req, res, next) => {

    res.cookie('token', null, {
        expires: new Date(Date.now()),
        httpOnly: true
    })

    res.status(200).json({
        success: true,
        message:'Successfully logged out'
    })
})

//forgot password
export const requestPasswordReset = handleAsyncError(async(req, res, next) => {
    const user = await User.findOne({
        email: req.body.email
    })

    if(!user) {
        return next(new HandleError("User does'nt exist", 400))
    }
    let resetToken;

    try{
        resetToken = user.generatePasswordResetToken();
        await user.save({
            validateBeforeSave : false
        });

    } catch(error) {
        return next(new HandleError("Could not save reset token, please try again later", 500));
    }

    const resetPasswordURL = `${process.env.FRONTEND_URL}/reset/${resetToken}`;

    const message = `Use the following link to reset your password: ${resetPasswordURL}. \n\n This link will expire in 30 minutes.\n\n If you did not request a password reset, please ignore this message.`;
     
    try{
        //send email
        await sendEmail({
            email: user.email,
            subject: 'Password Reset Request',
            message: message
        });

        res.status(200).json({
            success: true,
            message: `Email was sent to ${user.email} successfully`
        })

    } catch (error) {
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save({
            validateBeforeSave : false
        })

        return next(new HandleError("Email could not be sent please try again later", 500));
    }

});

//reset password
export const resetPassword = handleAsyncError(async(req, res, next) => {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: {$gt:Date.now()}
    })

    if(!user) {
        return next(new HandleError('Reset Password Token is invalid or expired', 400))
    }

    const {password, confirmPassword} = req.body;
    if(password !== confirmPassword) {
        return next(new HandleError('Password mismatch', 400))
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    sendToken(user, 200, res);
})

//update password
export const UpdatePassword = handleAsyncError(async(req, res, next) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password');

    //verify old password
    const checkPasswordMatch = await user.comparePassword(oldPassword);

    if(!checkPasswordMatch){
        return next(new HandleError(`Old password is incorrect`, 400));
    }

    if(newPassword !== confirmPassword){
        return next(new HandleError(`Password mismatch`, 400));
    }

    //update password
    user.password = newPassword;
    await user.save();
    sendToken(user, 200, res);
});

//get user details(profile)
export const getUserDetails = handleAsyncError(async(req, res, next) => {
    const user = await User.findById(req.user.id)
    res.status(200).json({
        success: true,
        user
    });
})

//update user profile
export const updateProfile = handleAsyncError(async(req, res, next) => {
    const { name, email, avatar } = req.body;
    const updateUserDetails = {
        name,
        email,
    }
    if(avatar !== '') {
        const user = await User.findById(req.user.id)
        const imageId = user.avatar.public_id
        await cloudinary.uploader.destroy(imageId)
        const myCloud =await cloudinary.uploader.upload(avatar, {
            folder: `EpicStore`,
            width: 150,
            crop: 'scale'
        })

        updateUserDetails.avatar = {
            public_id : myCloud.public_id,
            url : myCloud.secure_url
        }
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

})

//admin- Getting all users information 
export const getUsersList = handleAsyncError(async(req, res, next) => {
    const users = await User.find();
    res.status(200).json({
        success: true,
        users
    })
})

//admin- get single user info
export const getSingleUser = handleAsyncError(async(req, res, next) => {
    const user = await User.findById(req.params.id);

    if(!user) {
        return next(new HandleError(`Invalid user ID: ${req.params.id}`, 400))
    }

    res.status(200).json({
        success: true,
        user
    });

});

// admin- changing user role
export const updateUserRole = handleAsyncError(async (req, res, next) => {
    const { role } = req.body;
    const targetUserId = req.params.id;

    // Prevent changing role if it would remove the last admin
    if (role === 'user') {
        const adminCount = await User.countDocuments({ role: 'admin' });
        const targetUser = await User.findById(targetUserId);

        if (!targetUser) {
            return next(new HandleError("User not found", 404));
        }

        // If this user is an admin AND there is only 1 admin → block downgrade
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

    res.status(200).json({
        success: true,
        user: updatedUser
    });
});

// admin- delete user profile
export const deleteUser = handleAsyncError(async(req, res, next) => {
    const user = await User.findById(req.params.id);
    if(!user) {
        return next(new HandleError(`Invalid user`, 400))
    }

    await User.findByIdAndDelete(req.params.id);
    return res.status(200).json({
        success: true,
        message: `User with ID: ${req.params.id} was deleted successfully`
    });

});
