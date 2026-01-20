
import HandleError from '../utils/handleError.js';

/**
 * Middleware to validate request body/query/params using Joi schema
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

    // Replace request data with validated data
    req[source] = value;

    next();
  };
};

/**
 * Middleware to validate multiple sources (body + query + params)
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
        req[source] = value;
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

export const validateBody = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,   // return all errors, not just the first
    stripUnknown: true,  // remove unknown keys to avoid injection
    convert: true        // auto-convert types (e.g., string -> number)
  });

  if (error) {
    // Format Joi errors into a clean array of messages
    const details = error.details.map((d) => d.message);
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: details
    });
  }

  // Replace req.body with the validated value
  req.body = value;
  next();
};
