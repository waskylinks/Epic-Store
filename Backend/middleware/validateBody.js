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
