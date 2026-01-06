import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import xss from 'xss-clean';

/**
 * Security middleware configuration
 * Apply these to your Express app in server.js/app.js
 */

/**
 * Helmet - Sets various HTTP headers for security
 */
export const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            scriptSrc: ["'self'", "https:"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            connectSrc: ["'self'", "https:", "ws:", "wss:"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "https:"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
});

/**
 * Data Sanitization against NoSQL Injection
 * Prevents operators like $gt, $ne etc in user input
 */
export const sanitizeData = mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
        console.warn(`Sanitized potentially malicious input: ${key}`);
    }
});

/**
 * XSS Clean - Sanitizes user input to prevent XSS attacks
 */
export const xssProtection = xss();

/**
 * HPP - Prevent HTTP Parameter Pollution
 */
export const preventParameterPollution = hpp({
    whitelist: [
        'price',
        'rating',
        'category',
        'sort',
        'page',
        'limit'
    ]
});

/**
 * CORS Configuration
 */
export const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

/**
 * Additional security headers
 */
export const additionalSecurityHeaders = (req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection in browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    next();
};

/**
 * How to use in your app.js/server.js:
 * 
 * import cors from 'cors';
 * import { 
 *   helmetConfig, 
 *   sanitizeData, 
 *   xssProtection, 
 *   preventParameterPollution,
 *   corsOptions,
 *   additionalSecurityHeaders 
 * } from './middleware/security.js';
 * 
 * // Apply security middleware
 * app.use(helmetConfig);
 * app.use(cors(corsOptions));
 * app.use(additionalSecurityHeaders);
 * app.use(sanitizeData);
 * app.use(xssProtection);
 * app.use(preventParameterPollution);
 */