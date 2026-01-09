import { validatePassword, validatePasswordMatch } from './passwordValidator.js';
import validator from 'validator';
import HandleError from '../utils/handleError.js';

//✅ UPDATED: Validate registration data (firstName, lastName)
export const validateRegistration = (req, res, next) => {
    console.log('🔍 validateRegistration called');
    console.log('📦 req.body:', req.body);
    
    if (!req.body || Object.keys(req.body).length === 0) {
        console.error('❌ Request body is empty!');
        return next(new HandleError('Request body is empty. Please provide registration data.', 400));
    }

    const { firstName, lastName, email, password } = req.body;
    const errors = [];

    // Validate first name
    if (!firstName || firstName.trim().length < 2) {
        errors.push('First name must be at least 2 characters long');
    }
    if (firstName && firstName.length > 50) {
        errors.push('First name cannot exceed 50 characters');
    }
    if (firstName && !/^[a-zA-Z\s'-]+$/.test(firstName)) {
        errors.push('First name can only contain letters, spaces, hyphens, and apostrophes');
    }

    // Validate last name
    if (!lastName || lastName.trim().length < 2) {
        errors.push('Last name must be at least 2 characters long');
    }
    if (lastName && lastName.length > 50) {
        errors.push('Last name cannot exceed 50 characters');
    }
    if (lastName && !/^[a-zA-Z\s'-]+$/.test(lastName)) {
        errors.push('Last name can only contain letters, spaces, hyphens, and apostrophes');
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
        console.log('❌ Validation errors:', errors);
        return next(new HandleError(errors.join('. '), 400));
    }

    console.log('✅ Validation passed');
    next();
};

/**
 * Validate login data
 */
export const validateLogin = (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty. Please provide login credentials.', 400));
    }

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
 * ✅ NEW: Validate profile update (with avatar)
 */
export const validateProfileUpdate = (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty.', 400));
    }

    const { firstName, lastName, email } = req.body;
    const errors = [];

    // Validate first name if provided
    if (firstName !== undefined) {
        if (!firstName || firstName.trim().length < 2) {
            errors.push('First name must be at least 2 characters long');
        }
        if (firstName && firstName.length > 50) {
            errors.push('First name cannot exceed 50 characters');
        }
        if (firstName && !/^[a-zA-Z\s'-]+$/.test(firstName)) {
            errors.push('First name can only contain letters, spaces, hyphens, and apostrophes');
        }
    }

    // Validate last name if provided
    if (lastName !== undefined) {
        if (!lastName || lastName.trim().length < 2) {
            errors.push('Last name must be at least 2 characters long');
        }
        if (lastName && lastName.length > 50) {
            errors.push('Last name cannot exceed 50 characters');
        }
        if (lastName && !/^[a-zA-Z\s'-]+$/.test(lastName)) {
            errors.push('Last name can only contain letters, spaces, hyphens, and apostrophes');
        }
    }

    // Validate email if provided
    if (email !== undefined && (!email || !validator.isEmail(email))) {
        errors.push('Please provide a valid email address');
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
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty.', 400));
    }

    const { oldPassword, newPassword, confirmPassword } = req.body;
    const errors = [];

    if (!oldPassword) errors.push('Current password is required');

    if (!newPassword) {
        errors.push('New password is required');
    } else {
        const validation = validatePassword(newPassword);
        if (!validation.isValid) errors.push(...validation.errors);
    }

    if (!confirmPassword) errors.push('Password confirmation is required');

    if (newPassword && confirmPassword) {
        const match = validatePasswordMatch(newPassword, confirmPassword);
        if (!match.isValid) errors.push(match.error);
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
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty.', 400));
    }

    const { password, confirmPassword } = req.body;
    const errors = [];

    if (!password) {
        errors.push('Password is required');
    } else {
        const validation = validatePassword(password);
        if (!validation.isValid) errors.push(...validation.errors);
    }

    if (!confirmPassword) errors.push('Password confirmation is required');

    if (password && confirmPassword) {
        const match = validatePasswordMatch(password, confirmPassword);
        if (!match.isValid) errors.push(match.error);
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
    if (!req.body || !req.body.email || !validator.isEmail(req.body.email)) {
        return next(new HandleError('Please provide a valid email address', 400));
    }
    next();
};

/**
 * Validate verification code
 */
export const validateVerificationCode = (req, res, next) => {
    if (!req.body || !req.body.code) {
        return next(new HandleError('Verification code is required', 400));
    }

    if (!/^\d{6}$/.test(req.body.code)) {
        return next(new HandleError('Verification code must be 6 digits', 400));
    }

    next();
};

/**
 * Safe input sanitization with logging
 */
export const sanitizeInput = (req, res, next) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = req.body[key].trim();
            }
        });
    }
    next();
};