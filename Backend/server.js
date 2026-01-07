import dotenv from 'dotenv';
// ✅ Load environment variables FIRST
dotenv.config({ path: './.env' });

import app from './app.js';
import { connectDB, setupGracefulShutdown, getDBStatus } from './Database/database.js';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Validate required environment variables
 */
const validateEnvVariables = () => {
    const required = [
        'PORT',
        'MONGO_URI',
        'JWT_SECRET',
        'JWT_EXPIRE',
        'COOKIE_EXPIRE',
        'CLOUDINARY_NAME',
        'API_KEY',
        'API_SECRET',
        'SMTP_SERVICE',
        'SMTP_MAIL',
        'SMTP_PASSWORD',
        'FRONTEND_URL'
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        process.exit(1);
    }

    console.log('✅ Environment variables validated');
};

/**
 * Configure Cloudinary
 */
const configureCloudinary = () => {
    try {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_NAME,
            api_key: process.env.API_KEY,
            api_secret: process.env.API_SECRET
        });
        console.log('✅ Cloudinary configured successfully');
    } catch (error) {
        console.error('❌ Cloudinary configuration failed:', error.message);
        throw error;
    }
};

/**
 * Handle Uncaught Exceptions (BEFORE any other code)
 */
process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION! Shutting down...');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Stack trace:', err.stack);
    process.exit(1);
});

/**
 * Start the server
 */
const startServer = async () => {
    try {
        // 1. Validate environment variables
        validateEnvVariables();

        // 2. Configure external services
        configureCloudinary();

        // 3. Connect to database with retry logic
        await connectDB();

        // 4. Setup graceful shutdown handlers
        setupGracefulShutdown();

        // 5. Start Express server
        const PORT = process.env.PORT || 8000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(50));
            console.log('🚀 SERVER STARTED SUCCESSFULLY');
            console.log('='.repeat(50));
            console.log(`📡 Port: ${PORT}`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🕐 Time: ${new Date().toLocaleString()}`);
            console.log(`🔗 URL: http://localhost:${PORT}`);
            console.log('='.repeat(50) + '\n');

            // Log database status
            const dbStatus = getDBStatus();
            if (dbStatus.isConnected) {
                console.log('📊 Database Status:');
                console.log(`   - Connected: ✅`);
                console.log(`   - Host: ${dbStatus.host}`);
                console.log(`   - Database: ${dbStatus.name}`);
                console.log(`   - Models loaded: ${dbStatus.models.length}`);
                console.log('');
            }
        });

        // Handle server-specific errors
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use`);
            } else {
                console.error('❌ Server error:', error);
            }
            process.exit(1);
        });

        /**
         * Handle Unhandled Promise Rejections
         */
        process.on('unhandledRejection', (err, promise) => {
            console.error('💥 UNHANDLED REJECTION! Shutting down gracefully...');
            console.error('Error name:', err.name);
            console.error('Error message:', err.message);
            console.error('Promise:', promise);
            
            // Close server gracefully
            server.close(() => {
                console.log('✅ Server closed gracefully');
                process.exit(1);
            });

            // Force shutdown after 10 seconds if graceful shutdown fails
            setTimeout(() => {
                console.error('⚠️ Forcing shutdown after timeout');
                process.exit(1);
            }, 10000);
        });

        /**
         * Handle SIGTERM (for production deployments like Heroku, Railway)
         */
        process.on('SIGTERM', () => {
            console.log('📡 SIGTERM received. Starting graceful shutdown...');
            server.close(() => {
                console.log('✅ Process terminated gracefully');
            });
        });

    } catch (error) {
        console.error('💥 Failed to start server:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

/**
 * Initialize application
 */
startServer();