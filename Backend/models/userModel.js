import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50
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
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
      required: function () {
        return this.authProvider === "local";
      }
    },

    avatar: {
      public_id: { type: String, default: "default_avatar" },
      url: {
        type: String,
        default: "https://ui-avatars.com/api/?background=667eea&color=fff&name=User"
      }
    },

    wishlist: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true
      },
      addedAt: { type: Date, default: Date.now }
    }],

    lastSeenDiscountsAt: {
      type: Date,
      default: null
    },

    role: {
      type: String,
      enum: ["user", "admin", "superAdmin"],
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
        // FIX U1: Store HASHED passwords (not plaintext) so bcrypt.compare()
        // in isPasswordReused() works correctly
        password: String,
        changedAt: Date
      }
    ],

    profileCompleted: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    strict: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

/* ================= VIRTUALS ================= */

userSchema.virtual("fullName").get(function () {
  const first = this.firstName || "";
  const last = this.lastName || "";
  return `${first} ${last}`.trim() || "User";
});

userSchema.virtual("initials").get(function () {
  const first = this.firstName?.charAt(0) || "";
  const last = this.lastName?.charAt(0) || "";
  return `${first}${last}`.toUpperCase() || "U";
});

/* ================= INDEXES ================= */

userSchema.index({ authProvider: 1 });
userSchema.index({ createdAt: 1 });
userSchema.index({ firstName: 1, lastName: 1 });
userSchema.index({ "wishlist.product": 1 });
userSchema.index({ role: 1 });
userSchema.index({ emailVerified: 1 });
userSchema.index({ lastSeenDiscountsAt: 1 });

/* ================= MIDDLEWARE ================= */

// Update avatar URL with user's initials on save
userSchema.pre("save", function (next) {
  if (this.isModified("firstName") || this.isModified("lastName")) {
    if (this.avatar.public_id === "default_avatar") {
      const first = this.firstName || "User";
      const last = this.lastName || "Name";
      const name = `${first}+${last}`;
      this.avatar.url = `https://ui-avatars.com/api/?background=667eea&color=fff&name=${encodeURIComponent(name)}&size=200`;
    }
  }
  next();
});

// FIX U1: Password hashing with proper history tracking
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();

  // On password change (not initial registration), store the OLD hash BEFORE replacing it
  // This allows isPasswordReused() to compare candidates against all previous passwords
  if (!this.isNew) {
    // Get the old password hash from the database (this.password is the new plaintext)
    const oldDoc = await this.constructor.findById(this._id).select('+password');
    if (oldDoc && oldDoc.password) {
      this.passwordHistory.push({
        password: oldDoc.password,  // Store the OLD hash
        changedAt: new Date()
      });

      // Keep only the last 5 password hashes
      if (this.passwordHistory.length > 5) {
        this.passwordHistory = this.passwordHistory.slice(-5);
      }
    }
  }

  // Hash the new password
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

/* ================= METHODS ================= */

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Now works correctly because passwordHistory stores hashed passwords
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
  this.verificationCode = crypto.createHash("sha256").update(code).digest("hex");
  this.verificationCodeExpire = Date.now() + 10 * 60 * 1000;
  return code;
};

userSchema.methods.generatePasswordResetCode = function () {
  const code = crypto.randomInt(100000, 999999).toString();
  this.resetPasswordCode = crypto.createHash("sha256").update(code).digest("hex");
  this.resetPasswordCodeExpire = Date.now() + 90 * 1000;
  return code;
};

userSchema.methods.verifyCode = function (input, hashed, expiry) {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return hash === hashed && expiry > Date.now();
};

userSchema.methods.verifyEmailCode = function (code) {
  if (!this.verificationCode || !this.verificationCodeExpire) return false;
  return this.verifyCode(code, this.verificationCode, this.verificationCodeExpire);
};

userSchema.methods.verifyResetCode = function (code) {
  if (!this.resetPasswordCode || !this.resetPasswordCodeExpire) return false;
  return this.verifyCode(code, this.resetPasswordCode, this.resetPasswordCodeExpire);
};

userSchema.set("strictQuery", true);

export default mongoose.model("User", userSchema);