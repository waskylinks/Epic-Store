import { validatePassword, validatePasswordMatch } from './passwordValidator.js';
import validator from 'validator';
import HandleError from '../utils/handleError.js';

// ============================================
// USER AUTHENTICATION VALIDATORS
// ============================================

/**
 * Validate registration data (firstName, lastName)
 */
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
 * ✅ FIXED: Validate profile update (with avatar)
 */
export const validateProfileUpdate = (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty.', 400));
    }

    const { firstName, lastName, email } = req.body;
    const errors = [];

    // Validate first name if provided
    if (firstName !== undefined) {
        if (firstName === null || firstName === '') {
            errors.push('First name cannot be empty');
        } else if (firstName.trim().length < 2) {
            errors.push('First name must be at least 2 characters long');
        } else if (firstName.length > 50) {
            errors.push('First name cannot exceed 50 characters');
        } else if (!/^[a-zA-Z\s'-]+$/.test(firstName)) {
            errors.push('First name can only contain letters, spaces, hyphens, and apostrophes');
        }
    }

    // Validate last name if provided
    if (lastName !== undefined) {
        if (lastName === null || lastName === '') {
            errors.push('Last name cannot be empty');
        } else if (lastName.trim().length < 2) {
            errors.push('Last name must be at least 2 characters long');
        } else if (lastName.length > 50) {
            errors.push('Last name cannot exceed 50 characters');
        } else if (lastName && !/^[a-zA-Z\s'-]+$/.test(lastName)) {
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

    const { email, code, password, confirmPassword } = req.body;
    const errors = [];

    // Validate email
    if (!email || !validator.isEmail(email)) {
        errors.push('Please provide a valid email address');
    }

    // Validate code
    if (!code || !/^\d{6}$/.test(code)) {
        errors.push('Verification code must be 6 digits');
    }

    // Validate password
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

// ============================================
// REFUND VALIDATORS
// ============================================

/**
 * Validate refund request
 */
export const validateRefundRequest = (req, res, next) => {
    const { reason, description, refundType, requestedAmount } = req.body;
    const errors = [];

    const validReasons = [
        'defective_product',
        'wrong_item',
        'not_as_described',
        'damaged_in_shipping',
        'changed_mind',
        'duplicate_order',
        'unauthorized_purchase',
        'other'
    ];

    if (!reason || !validReasons.includes(reason)) {
        errors.push('Please provide a valid refund reason');
    }

    if (!description || description.trim().length < 10) {
        errors.push('Description must be at least 10 characters');
    }
    if (description && description.length > 500) {
        errors.push('Description cannot exceed 500 characters');
    }

    if (refundType && !['full', 'partial'].includes(refundType)) {
        errors.push('Refund type must be either "full" or "partial"');
    }

    if (refundType === 'partial') {
        if (!requestedAmount || isNaN(requestedAmount) || requestedAmount <= 0) {
            errors.push('Valid refund amount is required for partial refunds');
        }
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate refund message
 */
export const validateRefundMessage = (req, res, next) => {
    const { message } = req.body;
    const errors = [];

    if (!message || message.trim().length === 0) {
        errors.push('Message content is required');
    }
    if (message && message.length > 2000) {
        errors.push('Message cannot exceed 2000 characters');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate refund review (admin)
 */
export const validateRefundReview = (req, res, next) => {
    const { action, adminNote } = req.body;
    const errors = [];

    if (!action || !['approve', 'reject'].includes(action)) {
        errors.push('Action must be either "approve" or "reject"');
    }

    if (action === 'reject' && (!adminNote || adminNote.trim().length < 10)) {
        errors.push('Rejection reason (adminNote) must be at least 10 characters when rejecting a refund');
    }

    if (adminNote && adminNote.length > 1000) {
        errors.push('Admin note cannot exceed 1000 characters');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate process refund payment
 */
export const validateProcessRefund = (req, res, next) => {
    const { refundAmount, merchantNote } = req.body;
    const errors = [];

    // refundAmount is optional - if not provided, use approved amount
    if (refundAmount !== undefined) {
        if (isNaN(refundAmount) || refundAmount <= 0) {
            errors.push('Refund amount must be a positive number');
        }
    }

    if (merchantNote && merchantNote.length > 1000) {
        errors.push('Merchant note cannot exceed 1000 characters');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

// ============================================
// ORDER VALIDATORS
// ============================================

/**
 * Validate order note
 */
export const validateOrderNote = (req, res, next) => {
    const { content, type } = req.body;
    const errors = [];

    if (!content || content.trim().length === 0) {
        errors.push('Note content is required');
    }
    if (content && content.trim().length < 5) {
        errors.push('Note must be at least 5 characters');
    }
    if (content && content.length > 2000) {
        errors.push('Note cannot exceed 2000 characters');
    }

    if (type && !['internal', 'customer'].includes(type)) {
        errors.push('Note type must be either "internal" or "customer"');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate tracking info
 */
export const validateTrackingInfo = (req, res, next) => {
    const { carrier, trackingNumber, estimatedDelivery } = req.body;
    const errors = [];

    if (!carrier) {
        errors.push('Carrier is required');
    }
    if (carrier && !['DHL', 'FedEx', 'UPS', 'USPS', 'Other'].includes(carrier)) {
        errors.push('Invalid carrier. Must be DHL, FedEx, UPS, USPS, or Other');
    }

    if (!trackingNumber || trackingNumber.trim().length === 0) {
        errors.push('Tracking number is required');
    }
    if (trackingNumber && trackingNumber.length > 100) {
        errors.push('Tracking number cannot exceed 100 characters');
    }

    if (estimatedDelivery && isNaN(Date.parse(estimatedDelivery))) {
        errors.push('Invalid estimated delivery date');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate return request
 */
export const validateReturnRequest = (req, res, next) => {
    const { reason, itemsToReturn } = req.body;
    const errors = [];

    if (!reason || reason.trim().length < 10) {
        errors.push('Return reason must be at least 10 characters');
    }
    if (reason && reason.length > 500) {
        errors.push('Return reason cannot exceed 500 characters');
    }

    if (!itemsToReturn || !Array.isArray(itemsToReturn) || itemsToReturn.length === 0) {
        errors.push('At least one item must be selected for return');
    }

    if (itemsToReturn && Array.isArray(itemsToReturn)) {
        itemsToReturn.forEach((item, index) => {
            if (!item.product) {
                errors.push(`Item ${index + 1}: Product ID is required`);
            }
            if (!item.quantity || item.quantity <= 0) {
                errors.push(`Item ${index + 1}: Valid quantity is required`);
            }
            if (!item.reason || item.reason.trim().length < 5) {
                errors.push(`Item ${index + 1}: Reason must be at least 5 characters`);
            }
        });
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

/**
 * Validate fraud review decision
 */
export const validateFraudReview = (req, res, next) => {
    const { decision } = req.body;
    const errors = [];

    if (!decision || !['approved', 'rejected'].includes(decision)) {
        errors.push('Decision must be either "approved" or "rejected"');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

// ============================================
// UTILITY VALIDATORS
// ============================================

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

// ADD THESE TO validation.js

/**
 * Validate order message
 */
export const validateOrderMessage = (req, res, next) => {
  const { content } = req.body;
  const errors = [];

  if (!content || content.trim().length === 0) {
    errors.push('Message content is required');
  }
  if (content && content.trim().length < 1) {
    errors.push('Message cannot be empty');
  }
  if (content && content.length > 2000) {
    errors.push('Message cannot exceed 2000 characters');
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};

/**
 * Validate return message
 */
export const validateReturnMessage = (req, res, next) => {
  const { content } = req.body;
  const errors = [];

  if (!content || content.trim().length === 0) {
    errors.push('Message content is required');
  }
  if (content && content.length > 2000) {
    errors.push('Message cannot exceed 2000 characters');
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};

/**
 * Validate return review (admin)
 */
export const validateReturnReview = (req, res, next) => {
  const { action, adminNote } = req.body;
  const errors = [];

  if (!action || !['approve', 'reject'].includes(action)) {
    errors.push('Action must be either "approve" or "reject"');
  }

  if (action === 'reject' && (!adminNote || adminNote.trim().length < 10)) {
    errors.push('Rejection reason must be at least 10 characters');
  }

  if (adminNote && adminNote.length > 1000) {
    errors.push('Admin note cannot exceed 1000 characters');
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};

/**
 * Validate return status update
 */
export const validateReturnStatusUpdate = (req, res, next) => {
  const { status, inspectionNotes } = req.body;
  const errors = [];

  const validStatuses = ['in_transit', 'received', 'inspected', 'completed'];
  if (!status || !validStatuses.includes(status)) {
    errors.push('Invalid return status. Must be: in_transit, received, inspected, or completed');
  }

  if (status === 'inspected' && inspectionNotes && inspectionNotes.length > 2000) {
    errors.push('Inspection notes cannot exceed 2000 characters');
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};