import mongoose from "mongoose";
import validator from "validator";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Please enter your name"],
        maxLength: [30, "Name cannot exceed 30 characters"],
        minLength: [3, "Name should have more than 3 characters"],
    },
    email: {
        type: String,
        required: [true, "Please enter your email"],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail, "Please enter a valid email address"],
    },
    password: {
        type: String,
        minLength: [12, "Password should be at least 12 characters"],
        select: false,
        // Password not required for OAuth users
        required: function() {
            return this.authProvider === 'local';
        }
    },
    avatar: {
        public_id: {
            type: String,
            default: 'default_avatar'
        },
        url: {
            type: String,
            default: 'https://res.cloudinary.com/demo/image/upload/v1234567890/default_avatar.png'
        }
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: "user",
    },
    
    // Authentication Provider
    authProvider: {
        type: String,
        enum: ['local', 'google', 'facebook'],
        default: 'local',
        required: true
    },
    
    // OAuth Provider IDs for account linking
    googleId: {
        type: String,
        sparse: true, // Allows multiple null values
        unique: true
    },
    facebookId: {
        type: String,
        sparse: true,
        unique: true
    },
    
    // Email Verification
    emailVerified: {
        type: Boolean,
        default: false
    },
    verificationCode: String,
    verificationCodeExpire: Date,
    
    // Password Reset
    resetPasswordCode: String,
    resetPasswordCodeExpire: Date,
    
    // Two-Factor Authentication (Optional for future)
    twoFactorEnabled: {
        type: Boolean,
        default: false
    },
    twoFactorSecret: String,
    
    // Security Features
    lastLogin: Date,
    loginAttempts: {
        type: Number,
        default: 0
    },
    lockUntil: Date,
    
    // Password History (prevent reusing last 5 passwords)
    passwordHistory: [{
        password: String,
        changedAt: Date
    }],

}, { timestamps: true });

//------------------------------------------------------------------
// INDEXES FOR PERFORMANCE
//------------------------------------------------------------------
userSchema.index({ createdAt: 1 });
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ facebookId: 1 });
userSchema.index({ authProvider: 1 });

//------------------------------------------------------------------
// VIRTUAL FIELD: Check if account is locked
//------------------------------------------------------------------
userSchema.virtual('isLocked').get(function() {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

//------------------------------------------------------------------
// PASSWORD HASHING
//------------------------------------------------------------------
userSchema.pre("save", async function (next) {
    // Only hash password if it's modified and exists (for local auth)
    if (!this.isModified("password") || !this.password) {
        return next();
    }
    
    // Store old password in history before hashing new one
    if (this.password && this.isModified('password') && !this.isNew) {
        this.passwordHistory.push({
            password: this.password,
            changedAt: new Date()
        });
        
        // Keep only last 5 passwords
        if (this.passwordHistory.length > 5) {
            this.passwordHistory = this.passwordHistory.slice(-5);
        }
    }
    
    this.password = await bcryptjs.hash(this.password, 12);
    next();
});

//------------------------------------------------------------------
// COMPARE PASSWORD METHOD
//------------------------------------------------------------------
userSchema.methods.comparePassword = async function (enteredPassword) {
    if (!this.password) return false;
    return await bcryptjs.compare(enteredPassword, this.password);
};

//------------------------------------------------------------------
// CHECK PASSWORD REUSE
//------------------------------------------------------------------
userSchema.methods.isPasswordReused = async function(newPassword) {
    if (!this.passwordHistory || this.passwordHistory.length === 0) {
        return false;
    }
    
    for (const oldPass of this.passwordHistory) {
        const isMatch = await bcryptjs.compare(newPassword, oldPass.password);
        if (isMatch) return true;
    }
    return false;
};

//------------------------------------------------------------------
// INCREMENT LOGIN ATTEMPTS
//------------------------------------------------------------------
userSchema.methods.incrementLoginAttempts = async function() {
    // Reset attempts if lock has expired
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return await this.updateOne({
            $set: { loginAttempts: 1 },
            $unset: { lockUntil: 1 }
        });
    }
    
    const updates = { $inc: { loginAttempts: 1 } };
    
    // Lock account after 5 failed attempts for 30 minutes
    const maxAttempts = 5;
    const lockTime = 30 * 60 * 1000; // 30 minutes
    
    if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
        updates.$set = { lockUntil: Date.now() + lockTime };
    }
    
    return await this.updateOne(updates);
};

//------------------------------------------------------------------
// RESET LOGIN ATTEMPTS
//------------------------------------------------------------------
userSchema.methods.resetLoginAttempts = async function() {
    return await this.updateOne({
        $set: { loginAttempts: 0, lastLogin: Date.now() },
        $unset: { lockUntil: 1 }
    });
};

//------------------------------------------------------------------
// JWT TOKEN GENERATION
//------------------------------------------------------------------
userSchema.methods.getJWTToken = function() {
    return jwt.sign({ id: this._id }, process.env.JWT_SECRET_KEY, {
        expiresIn: process.env.JWT_EXPIRES_TIME,
    });
};

//------------------------------------------------------------------
// GENERATE EMAIL VERIFICATION CODE (6 digits, 90 seconds expiry)
//------------------------------------------------------------------
userSchema.methods.generateVerificationCode = function() {
    const code = crypto.randomInt(100000, 999999).toString();
    
    this.verificationCode = crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');
    
    this.verificationCodeExpire = Date.now() + 90 * 1000; // 90 seconds (1:30 mins)
    
    return code; // Return unhashed code to send via email
};

//------------------------------------------------------------------
// GENERATE PASSWORD RESET CODE (6 digits, 90 seconds expiry)
//------------------------------------------------------------------
userSchema.methods.generatePasswordResetCode = function() {
    const code = crypto.randomInt(100000, 999999).toString();
    
    this.resetPasswordCode = crypto
        .createHash('sha256')
        .update(code)
        .digest('hex');
    
    this.resetPasswordCodeExpire = Date.now() + 90 * 1000; // 90 seconds (1:30 mins)
    
    return code; // Return unhashed code to send via email
};

//------------------------------------------------------------------
// VERIFY EMAIL WITH CODE
//------------------------------------------------------------------
userSchema.methods.verifyEmailCode = function(inputCode) {
    const hashedInputCode = crypto
        .createHash('sha256')
        .update(inputCode)
        .digest('hex');
    
    return (
        hashedInputCode === this.verificationCode &&
        this.verificationCodeExpire > Date.now()
    );
};

//------------------------------------------------------------------
// VERIFY RESET CODE
//------------------------------------------------------------------
userSchema.methods.verifyResetCode = function(inputCode) {
    const hashedInputCode = crypto
        .createHash('sha256')
        .update(inputCode)
        .digest('hex');
    
    return (
        hashedInputCode === this.resetPasswordCode &&
        this.resetPasswordCodeExpire > Date.now()
    );
};

export default mongoose.model("User", userSchema);