import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 30
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: [validator.isEmail, "Invalid email address"]
    },

    password: {
      type: String,
      minlength: 12,
      select: false,
      required: function () {
        return this.authProvider === "local";
      }
    },

    avatar: {
      public_id: { type: String, default: "default_avatar" },
      url: {
        type: String,
        default:
          "https://res.cloudinary.com/demo/image/upload/v1234567890/default_avatar.png"
      }
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },

    authProvider: {
      type: String,
      enum: ["local", "google", "facebook"],
      default: "local",
      required: true
    },

    googleId: { type: String, unique: true, sparse: true },
    facebookId: { type: String, unique: true, sparse: true },

    emailVerified: { type: Boolean, default: false },

    verificationCode: String,
    verificationCodeExpire: Date,

    resetPasswordCode: String,
    resetPasswordCodeExpire: Date,

    lastLogin: Date,
    loginAttempts: { type: Number, default: 0 },
    lockUntil: Date,

    passwordHistory: [
      {
        password: String,
        changedAt: Date
      }
    ]
  },
  { timestamps: true, strict: true }
);

/* ================= INDEXES ================= */

userSchema.index({ authProvider: 1 });
userSchema.index({ createdAt: 1 });

/* ================= PASSWORD HASH ================= */

userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();

  const hashed = await bcrypt.hash(this.password, 12);

  if (!this.isNew) {
    this.passwordHistory.push({
      password: this.password,
      changedAt: new Date()
    });

    if (this.passwordHistory.length > 5) {
      this.passwordHistory = this.passwordHistory.slice(-5);
    }
  }

  this.password = hashed;
  next();
});

/* ================= METHODS ================= */

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isPasswordReused = async function (candidate) {
  for (const item of this.passwordHistory) {
    if (await bcrypt.compare(candidate, item.password)) return true;
  }
  return false;
};

userSchema.methods.incrementLoginAttempts = async function () {
  const maxAttempts = 5;
  const lockTime = 30 * 60 * 1000;

  if (this.lockUntil && this.lockUntil > Date.now()) return;

  this.loginAttempts += 1;

  if (this.loginAttempts >= maxAttempts) {
    this.lockUntil = Date.now() + lockTime;
  }

  await this.save({ validateBeforeSave: false });
};

userSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = undefined;
  this.lastLogin = Date.now();
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.getJWTToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES_TIME
  });
};

userSchema.methods.generateVerificationCode = function () {
  const code = crypto.randomInt(100000, 999999).toString();

  this.verificationCode = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");

  this.verificationCodeExpire = Date.now() + 90 * 1000;
  return code;
};

userSchema.methods.generatePasswordResetCode = function () {
  const code = crypto.randomInt(100000, 999999).toString();

  this.resetPasswordCode = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");

  this.resetPasswordCodeExpire = Date.now() + 90 * 1000;
  return code;
};

userSchema.methods.verifyCode = function (input, hashed, expiry) {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return hash === hashed && expiry > Date.now();
};

userSchema.set("strictQuery", true);

export default mongoose.model("User", userSchema);
