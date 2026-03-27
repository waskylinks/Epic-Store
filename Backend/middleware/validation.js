import { validatePassword, validatePasswordMatch } from './passwordValidator.js';
import validator from 'validator';
import HandleError from '../utils/handleError.js';

// ============================================
// USER AUTHENTICATION VALIDATORS
// ============================================

export const validateRegistration = (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty. Please provide registration data.', 400));
    }

    const { firstName, lastName, email, password } = req.body;
    const errors = [];

    if (!firstName || firstName.trim().length < 2) {
        errors.push('First name must be at least 2 characters long');
    }
    if (firstName && firstName.length > 50) {
        errors.push('First name cannot exceed 50 characters');
    }
    if (firstName && !/^[a-zA-Z\s'-]+$/.test(firstName)) {
        errors.push('First name can only contain letters, spaces, hyphens, and apostrophes');
    }

    if (!lastName || lastName.trim().length < 2) {
        errors.push('Last name must be at least 2 characters long');
    }
    if (lastName && lastName.length > 50) {
        errors.push('Last name cannot exceed 50 characters');
    }
    if (lastName && !/^[a-zA-Z\s'-]+$/.test(lastName)) {
        errors.push('Last name can only contain letters, spaces, hyphens, and apostrophes');
    }

    if (!email || !validator.isEmail(email)) {
        errors.push('Please provide a valid email address');
    }

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

export const validateProfileUpdate = (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty.', 400));
    }

    const { firstName, lastName, email } = req.body;
    const errors = [];

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

    if (email !== undefined && (!email || !validator.isEmail(email))) {
        errors.push('Please provide a valid email address');
    }

    if (errors.length > 0) {
        return next(new HandleError(errors.join('. '), 400));
    }

    next();
};

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

export const validatePasswordReset = (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        return next(new HandleError('Request body is empty.', 400));
    }

    const { email, code, password, confirmPassword } = req.body;
    const errors = [];

    if (!email || !validator.isEmail(email)) {
        errors.push('Please provide a valid email address');
    }

    if (!code || !/^\d{6}$/.test(code)) {
        errors.push('Verification code must be 6 digits');
    }

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

export const validateEmail = (req, res, next) => {
    if (!req.body || !req.body.email || !validator.isEmail(req.body.email)) {
        return next(new HandleError('Please provide a valid email address', 400));
    }
    next();
};

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

export const validateRefundRequest = (req, res, next) => {
    const { reason, description, refundType, requestedAmount } = req.body;
    const errors = [];

    const validReasons = [
        'defective_product', 'wrong_item', 'not_as_described',
        'damaged_in_shipping', 'changed_mind', 'duplicate_order',
        'unauthorized_purchase', 'other'
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

export const validateProcessRefund = (req, res, next) => {
    const { refundAmount, merchantNote } = req.body;
    const errors = [];

    if (refundAmount === undefined || refundAmount === null || refundAmount === '') {
        errors.push('Refund amount is required');
    } else if (isNaN(refundAmount) || Number(refundAmount) <= 0) {
        errors.push('Refund amount must be a positive number');
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

const VALID_RETURN_REASONS = [
  'defective_product', 'wrong_item', 'wrong_size', 'not_as_described',
  'quality_issues', 'changed_mind', 'better_price', 'duplicate_order',
  'no_longer_needed', 'other',
];

export const validateReturnRequest = (req, res, next) => {
  const { reason, description, items } = req.body;
  const errors = [];

  if (!reason || !VALID_RETURN_REASONS.includes(reason)) {
    errors.push('Please provide a valid return reason');
  }

  if (!description || description.trim().length < 5) {
    errors.push('Please provide a description of at least 5 characters');
  }
  if (description && description.length > 2000) {
    errors.push('Description cannot exceed 2000 characters');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    errors.push('At least one item must be selected for return');
  }

  if (Array.isArray(items) && items.length > 20) {
    errors.push('Cannot return more than 20 items in a single request');
  }

  if (Array.isArray(items)) {
    items.forEach((item, index) => {
      const n = index + 1;
      if (!item.product) {
        errors.push(`Item ${n}: Product ID is required`);
      }
      if (!item.quantity || item.quantity <= 0) {
        errors.push(`Item ${n}: Valid quantity is required`);
      }

      const trimmedReason = item.reason?.trim() ?? '';

      if (!trimmedReason || !VALID_RETURN_REASONS.includes(trimmedReason)) {
        errors.push(`Item ${n}: Please select a valid reason`);
      }

      if (trimmedReason.length > 500) {
        errors.push(`Item ${n}: Reason cannot exceed 500 characters`);
      }

      item.reason = trimmedReason;
    });
  }

  if (errors.length > 0) return next(new HandleError(errors.join('. '), 400));
  next();
};

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
 * Validate return review (admin) — per-item decisions.
 *
 * Expected body shape:
 * {
 *   itemDecisions: [
 *     { productId: '...', decision: 'approved' },
 *     { productId: '...', decision: 'rejected', rejectionReason: 'Damaged on arrival' },
 *   ],
 *   adminNote: 'Optional overall note'   // optional
 * }
 */
export const validateReturnReview = (req, res, next) => {
  const { itemDecisions, adminNote } = req.body;
  const errors = [];

  if (!itemDecisions || !Array.isArray(itemDecisions) || itemDecisions.length === 0) {
    errors.push('itemDecisions must be a non-empty array of per-item decisions');
  }

  if (Array.isArray(itemDecisions)) {
    itemDecisions.forEach((entry, index) => {
      const n = index + 1;

      if (!entry.productId || String(entry.productId).trim().length === 0) {
        errors.push(`Decision ${n}: productId is required`);
      }

      if (!entry.decision || !['approved', 'rejected'].includes(entry.decision)) {
        errors.push(`Decision ${n}: decision must be either "approved" or "rejected"`);
      }

      if (entry.decision === 'rejected') {
        const reason = entry.rejectionReason?.trim() ?? '';
        if (reason.length < 5) {
          errors.push(`Decision ${n}: rejectionReason must be at least 5 characters when rejecting an item`);
        }
        if (reason.length > 500) {
          errors.push(`Decision ${n}: rejectionReason cannot exceed 500 characters`);
        }
        entry.rejectionReason = reason;
      }
    });
  }

  if (adminNote !== undefined && adminNote !== null) {
    if (typeof adminNote !== 'string') {
      errors.push('adminNote must be a string');
    } else if (adminNote.length > 1000) {
      errors.push('adminNote cannot exceed 1000 characters');
    }
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};

/**
 * Validate return status update.
 *
 * FIX BUG-10 — removed items_reviewed, plea_submitted, and awaiting_discount
 * from the valid statuses list.
 *
 * These three statuses are ONLY reachable via dedicated controller actions:
 *   items_reviewed   → reviewReturnRequest  (PUT /return/review)
 *   plea_submitted   → submitPlea           (POST /return/plea)
 *   awaiting_discount→ resolveAfterPlea     (PUT /return/plea-review)
 *                      or checkAndExpireTimers (lazy auto-advance)
 *
 * Allowing them here would let an admin bypass all business logic —
 * per-item decisions, discountValue calculation, pleaDeadline setting,
 * and pleaAttempts tracking — by manually forcing the status via the
 * general update endpoint. This was a significant data integrity hole.
 *
 * The general status update endpoint (PUT /return/status) is intentionally
 * scoped to the physical fulfilment states of the returned parcel only:
 * in_transit, received, inspected, and completed.
 */
export const validateReturnStatusUpdate = (req, res, next) => {
  const { status, inspectionNotes } = req.body;
  const errors = [];

  const validStatuses = [
    'in_transit',
    'received',
    'inspected',
    'completed',
  ];

  if (!status || !validStatuses.includes(status)) {
    errors.push(
      'Invalid return status. The general status update endpoint only accepts: in_transit, received, inspected, or completed. ' +
      'Use the dedicated review, plea, and discount routes for other status transitions.'
    );
  }

  if (status === 'inspected' && inspectionNotes && inspectionNotes.length > 2000) {
    errors.push('Inspection notes cannot exceed 2000 characters');
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};

/**
 * Validate plea submission (customer).
 *
 * Expected body shape:
 * {
 *   pleaDescription: 'Detailed argument for reconsideration...'
 * }
 */
export const validatePleaSubmission = (req, res, next) => {
  const { pleaDescription } = req.body;
  const errors = [];

  if (!pleaDescription || pleaDescription.trim().length === 0) {
    errors.push('Plea description is required');
  }

  if (pleaDescription && pleaDescription.trim().length < 10) {
    errors.push('Plea description must be at least 10 characters');
  }

  if (pleaDescription && pleaDescription.length > 2000) {
    errors.push('Plea description cannot exceed 2000 characters');
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  req.body.pleaDescription = pleaDescription.trim();

  next();
};

/**
 * Validate generate discount code request (admin).
 *
 * Body is intentionally minimal. The discount value is derived server-side
 * from approved items. An optional adminNote can be included for records.
 *
 * NOTE on BUG-18: The orderId ObjectId check is handled upstream by
 * router.param('id', validateObjectId), and the status guard is handled
 * by canGenerateDiscount middleware. This validator is deliberately minimal
 * and only validates the optional adminNote field.
 */
export const validateGenerateDiscount = (req, res, next) => {
  const { adminNote } = req.body;
  const errors = [];

  if (adminNote !== undefined && adminNote !== null) {
    if (typeof adminNote !== 'string') {
      errors.push('adminNote must be a string');
    } else if (adminNote.length > 1000) {
      errors.push('adminNote cannot exceed 1000 characters');
    }
  }

  if (errors.length > 0) {
    return next(new HandleError(errors.join('. '), 400));
  }

  next();
};