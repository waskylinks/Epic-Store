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
        // FIX U1: Must store HASHED passwords so bcrypt.compare() in isPasswordReused()
        // works correctly. Storing plaintext here means bcrypt.compare(candidate, plaintext)
        // always returns false (plaintext is not a valid bcrypt hash), silently breaking
        // the entire password-reuse guard.
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

// Password hashing
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();

  // FIX U1: Hash the new password first.
  // Then push the NEW hash into history (replacing the previous approach of
  // pushing plaintext, which made bcrypt.compare() in isPasswordReused() always
  // return false and silently broke password reuse detection).
  //
  // Why push the new hash (not old)?
  // On each password change, we record what hash is now in use.
  // isPasswordReused() compares the candidate against all stored hashes —
  // if the candidate matches any stored hash, it was a previously used password.
  const hashed = await bcrypt.hash(this.password, 12);

  if (!this.isNew) {
    // Push the new hash BEFORE overwriting so history captures every distinct value
    this.passwordHistory.push({
      password: hashed,
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