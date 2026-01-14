import winston from 'winston';
import path from 'path';

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format (human-readable for development)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        
        // Add metadata if present
        if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
        }
        
        return msg;
    })
);

// Create logs directory if it doesn't exist
const logsDir = 'logs';

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Write all logs to combined.log
        new winston.transports.File({ 
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        
        // Write error logs to error.log
        new winston.transports.File({ 
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        
        // Write OAuth-specific logs
        new winston.transports.File({ 
            filename: path.join(logsDir, 'oauth.log'),
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 3
        })
    ]
});

// Add console logging in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Create OAuth-specific logger
export const oauthLogger = {
    info: (message, meta = {}) => {
        logger.info(message, { service: 'oauth', ...meta });
    },
    error: (message, meta = {}) => {
        logger.error(message, { service: 'oauth', ...meta });
    },
    warn: (message, meta = {}) => {
        logger.warn(message, { service: 'oauth', ...meta });
    },
    debug: (message, meta = {}) => {
        logger.debug(message, { service: 'oauth', ...meta });
    }
};

export default logger;