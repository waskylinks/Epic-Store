/**
 * Enterprise-Level Error Handler
 * Handles operational errors, logging, monitoring integration, and error categorization
 */

class HandleError extends Error {
    constructor(message, statusCode, options = {}) {
        super(message);
        
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true; // Distinguishes operational vs programming errors
        
        // Additional error metadata
        this.code = options.code || this.getErrorCode(statusCode);
        this.details = options.details || null;
        this.timestamp = new Date().toISOString();
        this.path = options.path || null;
        this.method = options.method || null;
        this.ip = options.ip || null;
        this.userId = options.userId || null;
        
        // Error categorization
        this.category = this.categorizeError(statusCode);
        
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * Generate standardized error codes
     */
    getErrorCode(statusCode) {
        const errorCodes = {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            422: 'VALIDATION_ERROR',
            429: 'RATE_LIMIT_EXCEEDED',
            500: 'INTERNAL_SERVER_ERROR',
            502: 'BAD_GATEWAY',
            503: 'SERVICE_UNAVAILABLE'
        };
        return errorCodes[statusCode] || 'UNKNOWN_ERROR';
    }

    /**
     * Categorize errors for better monitoring and analytics
     */
    categorizeError(statusCode) {
        if (statusCode >= 400 && statusCode < 500) return 'CLIENT_ERROR';
        if (statusCode >= 500) return 'SERVER_ERROR';
        return 'UNKNOWN';
    }

    /**
     * Convert error to JSON for API responses
     */
    toJSON() {
        return {
            success: false,
            status: this.status,
            statusCode: this.statusCode,
            code: this.code,
            message: this.message,
            details: this.details,
            timestamp: this.timestamp,
            ...(process.env.NODE_ENV === 'development' && {
                stack: this.stack,
                path: this.path,
                method: this.method
            })
        };
    }

    /**
     * Log error with context (for monitoring services)
     */
    log() {
        const logData = {
            message: this.message,
            statusCode: this.statusCode,
            code: this.code,
            category: this.category,
            timestamp: this.timestamp,
            path: this.path,
            method: this.method,
            ip: this.ip,
            userId: this.userId,
            stack: this.stack
        };

        if (this.statusCode >= 500) {
            console.error('🔴 SERVER ERROR:', JSON.stringify(logData, null, 2));
        } else if (this.statusCode >= 400) {
            console.warn('🟡 CLIENT ERROR:', JSON.stringify(logData, null, 2));
        }

        // Integration point for external monitoring (Sentry, DataDog, etc.)
        // this.sendToMonitoring(logData);
    }

    /**
     * Send to external monitoring service (placeholder)
     */
    sendToMonitoring(logData) {
        // Example: Sentry integration
        // if (process.env.SENTRY_DSN) {
        //     Sentry.captureException(this, { extra: logData });
        // }
    }
}

/**
 * Predefined Error Classes for Common Scenarios
 */

export class ValidationError extends HandleError {
    constructor(message, details = null) {
        super(message, 422, { 
            code: 'VALIDATION_ERROR',
            details 
        });
    }
}

export class AuthenticationError extends HandleError {
    constructor(message = 'Authentication failed') {
        super(message, 401, { code: 'AUTHENTICATION_ERROR' });
    }
}

export class AuthorizationError extends HandleError {
    constructor(message = 'Access denied') {
        super(message, 403, { code: 'AUTHORIZATION_ERROR' });
    }
}

export class NotFoundError extends HandleError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, { code: 'NOT_FOUND' });
    }
}

export class ConflictError extends HandleError {
    constructor(message = 'Resource already exists') {
        super(message, 409, { code: 'CONFLICT' });
    }
}

export class RateLimitError extends HandleError {
    constructor(message = 'Too many requests') {
        super(message, 429, { code: 'RATE_LIMIT_EXCEEDED' });
    }
}

export class DatabaseError extends HandleError {
    constructor(message = 'Database operation failed') {
        super(message, 500, { code: 'DATABASE_ERROR' });
    }
}

export class ExternalServiceError extends HandleError {
    constructor(service = 'External service', message = 'unavailable') {
        super(`${service} ${message}`, 503, { code: 'EXTERNAL_SERVICE_ERROR' });
    }
}

export default HandleError;