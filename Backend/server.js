import dotenv from 'dotenv';
// ✅ Load environment variables FIRST
dotenv.config({ path: './.env' });

import app from './app.js';
import { connectDB, setupGracefulShutdown, getDBStatus } from './Database/database.js';
import { initializeRedis, shutdownRedis, default as redis } from './utils/redis.js';
import { v2 as cloudinary } from 'cloudinary';

/* ================= ENV VALIDATION ================= */
const validateEnvVariables = () => {
    const required = [
        'NODE_ENV',
        'PORT',
        'MONGO_URI',
        'JWT_SECRET_KEY',
        'JWT_EXPIRES_TIME',
        'COOKIE_EXPIRES_TIME',
        'CLOUDINARY_NAME',
        'API_KEY',
        'API_SECRET',
        'SMTP_SERVICE',
        'SMTP_MAIL',
        'SMTP_PASSWORD',
        'FRONTEND_URL',
        'SESSION_SECRET',
        'REDIS_HOST',
        'REDIS_PORT',
        'REDIS_PASSWORD'
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        process.exit(1);
    }

    console.log('✅ Environment variables validated');
};

/* ================= CLOUDINARY CONFIG ================= */
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

/* ================= UNCUGHT EXCEPTIONS ================= */
process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION! Shutting down...');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Stack trace:', err.stack);
    process.exit(1);
});

/* ================= START SERVER ================= */
const startServer = async () => {
    let server;

    try {
        // 1️⃣ Validate env
        validateEnvVariables();

        // 2️⃣ Configure Cloudinary
        configureCloudinary();

        // 3️⃣ Initialize Redis
        await initializeRedis();
        console.log(`📊 Redis status: ${redis.isOpen ? '✅ Connected' : '❌ Not connected'}`);

        // 4️⃣ Connect to MongoDB
        await connectDB();

        // 5️⃣ Setup graceful shutdown hooks
        setupGracefulShutdown();

        // 6️⃣ Start Express server
        const PORT = process.env.PORT || 8000;
        server = app.listen(PORT, () => {
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

        /* ================= SERVER ERROR ================= */
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Port ${PORT} is already in use`);
            } else {
                console.error('❌ Server error:', error);
            }
            process.exit(1);
        });

        /* ================= UNHANDLED REJECTIONS ================= */
        process.on('unhandledRejection', async (err, promise) => {
            console.error('💥 UNHANDLED REJECTION! Shutting down gracefully...');
            console.error('Error name:', err.name);
            console.error('Error message:', err.message);
            console.error('Promise:', promise);

            if (server) {
                server.close(async () => {
                    console.log('✅ Server closed gracefully');
                    await shutdownRedis();
                    process.exit(1);
                });

                // Force shutdown after 10 seconds
                setTimeout(() => {
                    console.error('⚠️ Forcing shutdown after timeout');
                    process.exit(1);
                }, 10000);
            }
        });

        /* ================= SIGTERM HANDLER ================= */
        process.on('SIGTERM', async () => {
            console.log('📡 SIGTERM received. Starting graceful shutdown...');
            if (server) {
                server.close(async () => {
                    console.log('✅ Server closed gracefully');
                    await shutdownRedis();
                    process.exit(0);
                });
            }
        });

    } catch (error) {
        console.error('💥 Failed to start server:', error.message);
        console.error('Stack trace:', error.stack);
        if (redis.isOpen) await shutdownRedis();
        process.exit(1);
    }
};

/* ================= INITIALIZE APP ================= */
startServer();
