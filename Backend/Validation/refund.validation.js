// Backend/validation/refund-validation.js

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
      'any.only': 'Invalid refund reason. Must be one of: defective_product, wrong_item, not_as_described, damaged_in_shipping, changed_mind, duplicate_order, unauthorized_purchase, or other',
      'any.required': 'Refund reason is required'
    }),

  description: Joi.string()
    .min(10)
    .max(500)
    .trim()
    .required()
    .messages({
      'string.min': 'Description must be at least 10 characters',
      'string.max': 'Description cannot exceed 500 characters',
      'string.empty': 'Description cannot be empty',
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
    .precision(2)
    .when('refundType', {
      is: 'partial',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'number.positive': 'Refund amount must be positive',
      'number.precision': 'Refund amount cannot have more than 2 decimal places',
      'any.required': 'Requested amount is required for partial refunds',
      'any.unknown': 'Requested amount should not be provided for full refunds'
    }),

  attachments: Joi.array()
    .items(Joi.object({
      public_id: Joi.string().required(),
      url: Joi.string().uri().required(),
      type: Joi.string().required(),
      format: Joi.string().optional(),
      size: Joi.number().optional()
    }))
    .max(5)
    .optional()
    .messages({
      'array.max': 'Maximum 5 attachments allowed'
    })
});

/**
 * ✅ Validation schema for admin refund review (approve/reject)
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
    .max(1000)
    .trim()
    .allow('', null)
    .when('action', {
      is: 'reject',
      then: Joi.string().min(10).required().messages({
        'string.min': 'Please provide at least 10 characters explaining why the refund is being rejected',
        'any.required': 'Rejection reason is required when rejecting a refund'
      }),
      otherwise: Joi.string().allow('', null).optional()
    })
    .messages({
      'string.max': 'Admin note cannot exceed 1000 characters'
    }),

  attachments: Joi.array()
    .items(Joi.object({
      public_id: Joi.string().required(),
      url: Joi.string().uri().required(),
      type: Joi.string().required(),
      format: Joi.string().optional(),
      size: Joi.number().optional()
    }))
    .max(5)
    .optional()
    .messages({
      'array.max': 'Maximum 5 attachments allowed'
    })
});

/**
 * Validation schema for processing refund (Admin executes)
 */
export const processRefundSchema = Joi.object({
  refundAmount: Joi.number()
    .positive()
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Refund amount must be positive',
      'number.precision': 'Refund amount cannot have more than 2 decimal places'
    }),

  merchantNote: Joi.string()
    .max(1000)
    .trim()
    .allow('', null)
    .optional()
    .messages({
      'string.max': 'Merchant note cannot exceed 1000 characters'
    })
});

/**
 * Validation schema for adding refund messages
 */
export const addRefundMessageSchema = Joi.object({
  message: Joi.string()
    .min(1)
    .max(2000)
    .trim()
    .required()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message cannot exceed 2000 characters',
      'string.empty': 'Message content is required',
      'any.required': 'Message is required'
    }),

  attachments: Joi.array()
    .items(Joi.object({
      public_id: Joi.string().optional(),
      url: Joi.string().uri().required(),
      type: Joi.string().required(),
      format: Joi.string().optional(),
      size: Joi.number().optional(),
      filename: Joi.string().optional(),
      fileType: Joi.string().optional(),
      fileSize: Joi.number().optional(),
      uploadedBy: Joi.string().optional(),
      uploadedAt: Joi.date().optional()
    }))
    .max(5)
    .optional()
    .messages({
      'array.max': 'Maximum 5 attachments allowed per message'
    })
});

/**
 * Validation schema for refund status query (with empty string support)
 */
export const refundStatusQuerySchema = Joi.object({
  status: Joi.string()
    .valid('requested', 'approved', 'rejected', 'processing', 'completed', 'failed', '')
    .optional()
    .allow('')
    .default('')
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
    }),

  search: Joi.string()
    .allow('')
    .trim()
    .optional()
    .max(100)
    .messages({
      'string.max': 'Search term cannot exceed 100 characters'
    }),

  page: Joi.number()
    .integer()
    .min(1)
    .optional()
    .default(1)
    .messages({
      'number.base': 'Page must be a number',
      'number.integer': 'Page must be an integer',
      'number.min': 'Page must be at least 1'
    }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .messages({
      'number.base': 'Limit must be a number',
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    })
});

/**
 * Validation schema for file uploads
 */
export const uploadRefundMediaSchema = Joi.object({
  files: Joi.array()
    .min(1)
    .max(5)
    .required()
    .messages({
      'array.min': 'At least one file is required',
      'array.max': 'Maximum 5 files allowed',
      'any.required': 'Files are required'
    })
});

/**
 * Validation schema for return request
 */
export const returnRequestSchema = Joi.object({
  reason: Joi.string()
    .min(10)
    .max(500)
    .trim()
    .required()
    .messages({
      'string.min': 'Return reason must be at least 10 characters',
      'string.max': 'Return reason cannot exceed 500 characters',
      'any.required': 'Return reason is required'
    }),

  itemsToReturn: Joi.array()
    .items(Joi.object({
      product: Joi.string().required().messages({
        'any.required': 'Product ID is required'
      }),
      quantity: Joi.number().integer().min(1).required().messages({
        'number.min': 'Quantity must be at least 1',
        'any.required': 'Quantity is required'
      }),
      condition: Joi.string().optional(),
      reason: Joi.string().min(5).required().messages({
        'string.min': 'Item reason must be at least 5 characters',
        'any.required': 'Reason is required for each item'
      })
    }))
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item must be selected for return',
      'any.required': 'Items to return are required'
    })
});

/**
 * Validation schema for order note
 */
export const orderNoteSchema = Joi.object({
  content: Joi.string()
    .min(5)
    .max(2000)
    .trim()
    .required()
    .messages({
      'string.min': 'Note must be at least 5 characters',
      'string.max': 'Note cannot exceed 2000 characters',
      'any.required': 'Note content is required'
    }),

  type: Joi.string()
    .valid('internal', 'customer')
    .default('customer')
    .messages({
      'any.only': 'Note type must be either "internal" or "customer"'
    }),

  attachments: Joi.array()
    .items(Joi.string().uri())
    .max(3)
    .optional()
    .messages({
      'array.max': 'Maximum 3 attachments allowed'
    })
});

/**
 * Validation schema for tracking information
 */
export const trackingInfoSchema = Joi.object({
  carrier: Joi.string()
    .valid('DHL', 'FedEx', 'UPS', 'USPS', 'Other')
    .required()
    .messages({
      'any.only': 'Invalid carrier. Must be DHL, FedEx, UPS, USPS, or Other',
      'any.required': 'Carrier is required'
    }),

  trackingNumber: Joi.string()
    .min(5)
    .max(100)
    .trim()
    .required()
    .messages({
      'string.min': 'Tracking number must be at least 5 characters',
      'string.max': 'Tracking number cannot exceed 100 characters',
      'any.required': 'Tracking number is required'
    }),

  estimatedDelivery: Joi.date()
    .optional()
    .messages({
      'date.base': 'Invalid estimated delivery date'
    })
});

/**
 * Validation schema for shipment creation
 */
export const shipmentSchema = Joi.object({
  items: Joi.array()
    .items(Joi.object({
      product: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
      name: Joi.string().optional()
    }))
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Items are required'
    }),

  warehouse: Joi.string().optional(),

  carrier: Joi.string()
    .valid('DHL', 'FedEx', 'UPS', 'USPS', 'Other')
    .optional()
    .messages({
      'any.only': 'Invalid carrier'
    }),

  weight: Joi.number().positive().optional().messages({
    'number.positive': 'Weight must be positive'
  }),

  dimensions: Joi.object({
    length: Joi.number().positive().optional(),
    width: Joi.number().positive().optional(),
    height: Joi.number().positive().optional(),
    unit: Joi.string().valid('cm', 'in').default('cm')
  }).optional()
});

/**
 * Validation schema for fraud review decision
 */
export const fraudReviewSchema = Joi.object({
  decision: Joi.string()
    .valid('approved', 'rejected')
    .required()
    .messages({
      'any.only': 'Decision must be either "approved" or "rejected"',
      'any.required': 'Decision is required'
    }),

  note: Joi.string()
    .max(500)
    .trim()
    .optional()
    .messages({
      'string.max': 'Note cannot exceed 500 characters'
    })
});

/**
 * Helper function to validate request with Joi schema
 */
export const validateWithSchema = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        success: false,
        message: errors.join('. ')
      });
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

/**
 * Helper function to validate query params with Joi schema
 */
export const validateQueryWithSchema = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => detail.message);
      return res.status(400).json({
        success: false,
        message: errors.join('. ')
      });
    }

    // Replace req.query with validated data
    req.query = value;
    next();
  };
};