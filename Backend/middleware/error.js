/**
 * Global Error Handler Middleware
 * middleware/errorHandler.js
 */

import HandleError from '../utils/handleError.js';

/**
 * Handle different types of errors
 */
const handleCastErrorDB = (err) => {
    const message = `Invalid ${err.path}: ${err.value}`;
    return new HandleError(message, 400, { code: 'INVALID_ID' });
};

const handleDuplicateFieldsDB = (err) => {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    const message = `Duplicate field value: ${field} = '${value}'. Please use another value.`;
    return new HandleError(message, 409, { 
        code: 'DUPLICATE_FIELD',
        details: { field, value }
    });
};

const handleValidationErrorDB = (err) => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `Invalid input data: ${errors.join('. ')}`;
    return new HandleError(message, 422, { 
        code: 'VALIDATION_ERROR',
        details: errors
    });
};

const handleJWTError = () => {
    return new HandleError('Invalid token. Please log in again.', 401, {
        code: 'INVALID_TOKEN'
    });
};

const handleJWTExpiredError = () => {
    return new HandleError('Your token has expired. Please log in again.', 401, {
        code: 'TOKEN_EXPIRED'
    });
};

const handleMulterError = (err) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return new HandleError('File size too large. Maximum size is 5MB.', 400, {
            code: 'FILE_TOO_LARGE'
        });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return new HandleError('Too many files uploaded.', 400, {
            code: 'TOO_MANY_FILES'
        });
    }
    return new HandleError(err.message, 400, { code: 'FILE_UPLOAD_ERROR' });
};

/**
 * Send error response in development
 */
const sendErrorDev = (err, req, res) => {
    // Log full error in development
    console.error('💥 ERROR:', err);

    res.status(err.statusCode).json({
        success: false,
        status: err.status,
        error: err,
        message: err.message,
        code: err.code,
        stack: err.stack,
        path: req.path,
        method: req.method,
        timestamp: err.timestamp
    });
};

/**
 * Send error response in production (sanitized)
 */
const sendErrorProd = (err, req, res) => {
    // Operational, trusted error: send message to client
    if (err.isOperational) {
        res.status(err.statusCode).json({
            success: false,
            status: err.status,
            code: err.code,
            message: err.message,
            ...(err.details && { details: err.details })
        });
    } 
    // Programming or unknown error: don't leak error details
    else {
        // Log error for internal tracking
        console.error('💥 PROGRAMMING ERROR:', err);

        // Send generic message
        res.status(500).json({
            success: false,
            status: 'error',
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong. Please try again later.'
        });
    }
};

/**
 * Global Error Handler
 */
export const globalErrorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Add request context to error
    if (!err.path) err.path = req.path;
    if (!err.method) err.method = req.method;
    if (!err.ip) err.ip = req.ip;
    if (req.user && !err.userId) err.userId = req.user.id;

    // Log error
    if (err.log) err.log();

    let error = { ...err };
    error.message = err.message;
    error.name = err.name;

    // Handle specific error types
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (err.name === 'MulterError') error = handleMulterError(err);

    // Send response based on environment
    if (process.env.NODE_ENV === 'development') {
        sendErrorDev(error, req, res);
    } else {
        sendErrorProd(error, req, res);
    }
};

/**
 * Handle unhandled routes (404)
 */
export const handle404 = (req, res, next) => {
    const err = new HandleError(
        `Cannot find ${req.originalUrl} on this server`,
        404,
        {
            path: req.originalUrl,
            method: req.method
        }
    );
    next(err);
};