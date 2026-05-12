import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import app          from './app.js';
import { connectDB, setupGracefulShutdown, getDBStatus } from './Database/database.js';
import { initializeRedis, shutdownRedis, default as redis } from './utils/redis.js';
import { configureCloudinary } from './utils/cloudinaryUpload.js';
import { startAllCronJobs, stopAllCronJobs } from './jobs/cronRegistry.js';
import { validateCronEnv } from './config/cronConfig.js';
import {
  initializeBigQuerySchema,
  checkBigQueryConfig,
} from './Services/analytics/bigQueryService.js';


/* ================= ENV VALIDATION ================= */
const validateEnvVariables = () => {
  const required = [
    'NODE_ENV',
    'PORT',
    'MONGO_URI',
    'JWT_SECRET_KEY',
    'JWT_EXPIRES_TIME',
    'COOKIE_EXPIRES_TIME',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'SMTP_SERVICE',
    'SMTP_MAIL',
    'SMTP_PASSWORD',
    'FRONTEND_URL',
    'SESSION_SECRET',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    process.exit(1);
  }

  // Warn (not exit) about missing cron alert channels
  const cronWarnings = validateCronEnv();
  if (cronWarnings.length > 0) {
    console.warn('⚠️  Cron alert channel warnings:');
    cronWarnings.forEach((w) => console.warn(`   - ${w}`));
  }

  console.log('✅ Environment variables validated');
};

/* ================= UNCAUGHT EXCEPTIONS ================= */
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

    // 5️⃣ Setup graceful shutdown hooks (DB-level)
    setupGracefulShutdown();

    // 6️⃣ Mount API routes (including new cron health route)
    //    Note: mount cronHealthRouter in app.js or here before server.listen()
    //    Example: app.use('/api/v1/admin/cron', cronHealthRouter);
    //    If you mount routes in app.js, import and use it there instead.

    // 7️⃣ Initialize BigQuery tables (idempotent — safe on every start).
    //    Runs after MongoDB is confirmed connected so operational DB is ready
    //    before analytics setup begins. A BigQuery failure is non-critical —
    //    it logs a warning and allows the server to continue starting normally.
    //    initializeBigQuerySchema() catches individual table errors internally
    //    so a single table failure does not abort the remaining tables.
    const bqConfig = await checkBigQueryConfig();
    if (bqConfig.configured) {
      await initializeBigQuerySchema();
      console.log('✅ [BigQuery] Schema initialization complete');
    } else {
      console.warn('⚠️  [BigQuery] Not configured — skipping init. Missing:', bqConfig.missing.join(', '));
    }

    // 8️⃣ Register all scheduled jobs
    //    startAllCronJobs() is async — it seeds CronJobStatus documents
    //    before handing off to each job's start function.
    //    Order is enforced inside cronRegistry.js:
    //      AbandonmentSweep → DiscountCleanup → AuditCleanup → RecoveryEmailCron
    await startAllCronJobs();

    // 9️⃣ Start Express server
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
          stopAllCronJobs();
          await shutdownRedis();
          process.exit(1);
        });

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
        // Stop all cron jobs first — prevents new runs starting mid-shutdown
        stopAllCronJobs();

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