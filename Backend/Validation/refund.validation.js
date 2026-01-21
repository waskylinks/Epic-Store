import Joi from 'joi';

/**
 * Validation schema for refund request (User submits)
 */
export const requestRefundSchema = Joi.object({
  reason: Joi.string()
    .valid(
      'defective_product',
      'wrong_item',
      'not_as_described',
      'damaged_in_shipping',
      'changed_mind',
      'duplicate_order',
      'unauthorized_purchase',
      'other'
    )
    .required()
    .messages({
      'any.only': 'Invalid refund reason',
      'any.required': 'Refund reason is required'
    }),

  description: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'Description must be at least 10 characters',
      'string.max': 'Description cannot exceed 500 characters',
      'any.required': 'Please provide a detailed description'
    }),

  refundType: Joi.string()
    .valid('full', 'partial')
    .default('full')
    .messages({
      'any.only': 'Refund type must be either "full" or "partial"'
    }),

  requestedAmount: Joi.number()
    .positive()
    .when('refundType', {
      is: 'partial',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'number.positive': 'Refund amount must be positive',
      'any.required': 'Requested amount is required for partial refunds',
      'any.unknown': 'Requested amount should not be provided for full refunds'
    })
});

/**
 * ✅ FIXED: Validation schema for admin refund review (approve/reject)
 * The issue: adminNote was being treated as required for 'approve' when empty string was sent
 */
export const reviewRefundSchema = Joi.object({
  action: Joi.string()
    .valid('approve', 'reject')
    .required()
    .messages({
      'any.only': 'Action must be either "approve" or "reject"',
      'any.required': 'Action is required'
    }),

  adminNote: Joi.string()
    .max(500)
    .allow('', null) // ✅ FIX: Allow empty string and null
    .when('action', {
      is: 'reject',
      then: Joi.string().min(1).required(), // ✅ FIX: Require at least 1 character when rejecting
      otherwise: Joi.string().allow('', null).optional() // ✅ FIX: Optional when approving
    })
    .messages({
      'string.max': 'Admin note cannot exceed 500 characters',
      'string.min': 'Admin note is required when rejecting a refund',
      'any.required': 'Admin note is required when rejecting a refund'
    })
});

/**
 * Validation schema for processing refund (Admin executes)
 */
export const processRefundSchema = Joi.object({
  refundAmount: Joi.number()
    .positive()
    .optional()
    .messages({
      'number.positive': 'Refund amount must be positive'
    }),

  merchantNote: Joi.string()
    .max(500)
    .allow('', null) // ✅ Allow empty string
    .optional()
    .messages({
      'string.max': 'Merchant note cannot exceed 500 characters'
    })
});

/**
 * Validation schema for refund status query
 * Allow empty string for "All Refunds" filter
 */
export const refundStatusQuerySchema = Joi.object({
  status: Joi.string()
    .valid('requested', 'approved', 'rejected', 'processing', 'completed', 'failed', '')
    .optional()
    .allow('')
    .messages({
      'any.only': 'Invalid status filter'
    }),

  from: Joi.date()
    .optional()
    .messages({
      'date.base': 'Invalid from date'
    }),

  to: Joi.date()
    .optional()
    .greater(Joi.ref('from'))
    .messages({
      'date.base': 'Invalid to date',
      'date.greater': 'To date must be after from date'
    })
});