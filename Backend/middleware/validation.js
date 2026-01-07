import { validatePassword, validatePasswordMatch } from './passwordValidator.js';
import validator from 'validator';
import HandleError from '../utils/handleError.js';

/**
 * Validate registration data
 */
export const validateRegistration = (req, res, next) => {
    const { name, email, password } = req.body;
    const errors = [];

    // Validate name
    if (!name || name.trim().length < 3) {
        errors.push('Name must be at least 3 characters long');
    }
    if (name && name.length > 30) {
        errors.push('Name cannot exceed 30 characters');
    }

    // Validate email
    if (!email || !validator.isEmail(email)) {
        errors.push('Please provide a valid email address');
    }

    // Validate password
    if (!password) {
        errors.push('Password is required');
    } else {
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            errors.push(...passwordValidation.errors);
        }
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate login data
 */
export const validateLogin = (req, res, next) => {
    const { email, password } = req.body;
    const errors = [];

    if (!email || !validator.isEmail(email)) {
        errors.push('Please provide a valid email address');
    }

    if (!password) {
        errors.push('Password is required');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate password update
 */
export const validatePasswordUpdate = (req, res, next) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const errors = [];

    if (!oldPassword) {
        errors.push('Current password is required');
    }

    if (!newPassword) {
        errors.push('New password is required');
    } else {
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.isValid) {
            errors.push(...passwordValidation.errors);
        }
    }

    if (!confirmPassword) {
        errors.push('Password confirmation is required');
    }

    if (newPassword && confirmPassword) {
        const matchValidation = validatePasswordMatch(newPassword, confirmPassword);
        if (!matchValidation.isValid) {
            errors.push(matchValidation.error);
        }
    }

    if (oldPassword && newPassword && oldPassword === newPassword) {
        errors.push('New password must be different from current password');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate password reset
 */
export const validatePasswordReset = (req, res, next) => {
    const { password, confirmPassword } = req.body;
    const errors = [];

    if (!password) {
        errors.push('Password is required');
    } else {
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            errors.push(...passwordValidation.errors);
        }
    }

    if (!confirmPassword) {
        errors.push('Password confirmation is required');
    }

    if (password && confirmPassword) {
        const matchValidation = validatePasswordMatch(password, confirmPassword);
        if (!matchValidation.isValid) {
            errors.push(matchValidation.error);
        }
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate email
 */
export const validateEmail = (req, res, next) => {
    const { email } = req.body;

    if (!email || !validator.isEmail(email)) {
        return next(new HandleError('Please provide a valid email address', 400));
    }

    next();
};

/**
 * Validate verification code
 */
export const validateVerificationCode = (req, res, next) => {
    const { code } = req.body;

    if (!code) {
        return next(new HandleError('Verification code is required', 400));
    }

    if (!/^\d{6}$/.test(code)) {
        return next(new HandleError('Verification code must be 6 digits', 400));
    }

    next();
};

/**
 * Sanitize user input to prevent XSS and injection attacks
 */
export const sanitizeInput = (req, res, next) => {
    // Trim whitespace from strings
    Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
            req.body[key] = req.body[key].trim();
        }
    });

    next();
};