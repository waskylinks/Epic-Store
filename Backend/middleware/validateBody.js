// Backend/middleware/validateBody.js

import HandleError from '../utils/handleError.js';

/**
 * Middleware to validate request body/query/params using Joi schema
 * ✅ FIXED: Does not reassign req.query or req.params (read-only getters)
 * @param {Object} schema - Joi validation schema
 * @param {string} source - Where to validate: 'body' (default), 'query', 'params'
 * @returns {Function} Express middleware
 */
export const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    const dataToValidate = req[source];

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false, // Show all errors, not just the first one
      stripUnknown: true // Remove unknown fields
    });

    if (error) {
      // Format error messages
      const errorMessages = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return next(new HandleError(
        JSON.stringify(errorMessages),
        400
      ));
    }

    // ✅ FIX: Only replace req[source] if it's NOT 'query' or 'params'
    // These are read-only getters in Express and cannot be reassigned
    if (source === 'body') {
      req[source] = value;
    }
    // For 'query' and 'params', validation is enough - don't reassign
    // The original values remain but validation ensures they're correct

    next();
  };
};

/**
 * Middleware to validate multiple sources (body + query + params)
 * ✅ FIXED: Does not reassign read-only properties
 * @param {Object} schemas - Object with schemas for different sources
 * @example
 * validateMultiple({
 *   body: bodySchema,
 *   query: querySchema,
 *   params: paramsSchema
 * })
 */
export const validateMultiple = (schemas) => {
  return (req, res, next) => {
    const errors = [];

    // Validate each source
    for (const [source, schema] of Object.entries(schemas)) {
      const { error, value } = schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        errors.push(...error.details.map(detail => ({
          source,
          field: detail.path.join('.'),
          message: detail.message
        })));
      } else {
        // ✅ FIX: Only replace if it's the body
        if (source === 'body') {
          req[source] = value;
        }
        // For query and params, validation passed but don't reassign
      }
    }

    if (errors.length > 0) {
      return next(new HandleError(
        JSON.stringify(errors),
        400
      ));
    }

    next();
  };
};


/**
 * Middleware to validate request body only
 * This is the safest option for body validation
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
export const validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });

  if (error) {
    const details = error.details.map((d) => d.message);
    console.error('[validateBody] Joi errors:', JSON.stringify(error.details, null, 2)); // ADD THIS
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: details
    });
  }

  req.body = value;
  next();
};