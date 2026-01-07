import mongoose from 'mongoose';

/**
 * Enterprise-Level MongoDB Connection Handler
 * Features: Retry logic, error handling, connection monitoring, graceful shutdown
 */

class DatabaseConnection {
    constructor() {
        this.isConnected = false;
        this.retryCount = 0;
        this.maxRetries = 5;
        this.retryDelay = 5000; // 5 seconds
    }

    /**
     * MongoDB connection options
     */
    getConnectionOptions() {
        return {
            // Connection pool settings
            maxPoolSize: 10,
            minPoolSize: 2,
            
            // Timeout settings
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            
            // Automatic reconnection
            retryWrites: true,
            retryReads: true,
            
            // Write concern
            w: 'majority',
            
            // Additional options
            autoIndex: process.env.NODE_ENV === 'development', // Only in development
        };
    }

    /**
     * Connect to MongoDB with retry logic
     */
    async connect() {
        if (this.isConnected) {
            console.log('✅ Already connected to MongoDB');
            return;
        }

        try {
            // Validate environment variable
            if (!process.env.MONGO_URI) {
                throw new Error('MONGO_URI is not defined in environment variables');
            }

            console.log('🔄 Connecting to MongoDB...');

            await mongoose.connect(process.env.MONGO_URI, this.getConnectionOptions());

            this.isConnected = true;
            this.retryCount = 0;

            console.log('✅ MongoDB connected successfully');
            console.log(`📊 Database: ${mongoose.connection.name}`);
            console.log(`🌍 Host: ${mongoose.connection.host}`);
            console.log(`⚡ Environment: ${process.env.NODE_ENV || 'development'}`);

            // Setup connection event listeners
            this.setupEventListeners();

        } catch (error) {
            this.isConnected = false;
            console.error('❌ MongoDB connection error:', error.message);

            // Retry logic
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`⏳ Retrying connection (${this.retryCount}/${this.maxRetries}) in ${this.retryDelay / 1000}s...`);
                
                await this.delay(this.retryDelay);
                return this.connect(); // Recursive retry
            } else {
                console.error(`💥 Failed to connect to MongoDB after ${this.maxRetries} attempts`);
                throw new Error('Database connection failed. Please check your MongoDB URI and ensure the database is running.');
            }
        }
    }

    /**
     * Setup MongoDB connection event listeners
     */
    setupEventListeners() {
        // Connection events
        mongoose.connection.on('connected', () => {
            console.log('🟢 Mongoose connected to MongoDB');
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('🟡 Mongoose disconnected from MongoDB');
            this.isConnected = false;
        });

        mongoose.connection.on('reconnected', () => {
            console.log('🔄 Mongoose reconnected to MongoDB');
            this.isConnected = true;
        });

        mongoose.connection.on('error', (err) => {
            console.error('🔴 MongoDB connection error:', err);
            this.isConnected = false;
        });

        // Handle connection pool events (for monitoring)
        mongoose.connection.on('close', () => {
            console.log('⚪ MongoDB connection closed');
            this.isConnected = false;
        });

        // Index build events (useful in development)
        if (process.env.NODE_ENV === 'development') {
            mongoose.connection.on('index', (index) => {
                console.log('🔍 Index created:', index);
            });
        }
    }

    /**
     * Graceful shutdown
     */
    async disconnect() {
        if (!this.isConnected) {
            console.log('⚪ MongoDB is not connected');
            return;
        }

        try {
            await mongoose.connection.close();
            this.isConnected = false;
            console.log('✅ MongoDB disconnected gracefully');
        } catch (error) {
            console.error('❌ Error disconnecting from MongoDB:', error);
            throw error;
        }
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            readyState: mongoose.connection.readyState,
            host: mongoose.connection.host,
            name: mongoose.connection.name,
            models: Object.keys(mongoose.connection.models),
        };
    }

    /**
     * Helper: Delay function for retry logic
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

/**
 * Connect to MongoDB (main export)
 */
export const connectDB = async () => {
    await dbConnection.connect();
};

/**
 * Disconnect from MongoDB
 */
export const disconnectDB = async () => {
    await dbConnection.disconnect();
};

/**
 * Get database status
 */
export const getDBStatus = () => {
    return dbConnection.getStatus();
};

/**
 * Setup graceful shutdown handlers
 */
export const setupGracefulShutdown = () => {
    // Handle process termination
    const gracefulShutdown = async (signal) => {
        console.log(`\n📡 ${signal} received. Starting graceful shutdown...`);
        
        try {
            await dbConnection.disconnect();
            console.log('✅ Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during graceful shutdown:', error);
            process.exit(1);
        }
    };

    // Listen for termination signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
        console.error('💥 Uncaught Exception:', error);
        await gracefulShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
        console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
        await gracefulShutdown('unhandledRejection');
    });
};

// Default export for backward compatibility
export default connectDB;