/**
 * Database Migration Script
 * Run this ONCE to update existing users to new schema
 * 
 * Usage: node migrations/updateUsers.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/userModel.js';

dotenv.config();

const migrateUsers = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Get all existing users
        const users = await User.find({});
        console.log(`📊 Found ${users.length} users to migrate`);

        let updatedCount = 0;

        for (const user of users) {
            const updates = {};

            // Add authProvider if missing
            if (!user.authProvider) {
                updates.authProvider = 'local';
            }

            // Add emailVerified (set to true for existing users)
            if (user.emailVerified === undefined) {
                updates.emailVerified = true; // Assume existing users are verified
            }

            // Add default avatar if missing
            if (!user.avatar || !user.avatar.url) {
                updates.avatar = {
                    public_id: 'default_avatar',
                    url: 'https://res.cloudinary.com/demo/image/upload/v1234567890/default_avatar.png'
                };
            }

            // Add security fields
            if (user.loginAttempts === undefined) {
                updates.loginAttempts = 0;
            }

            if (!user.passwordHistory) {
                updates.passwordHistory = [];
            }

            // Update user if there are changes
            if (Object.keys(updates).length > 0) {
                await User.findByIdAndUpdate(user._id, { $set: updates });
                updatedCount++;
                console.log(`✅ Updated user: ${user.email}`);
            }
        }

        console.log(`\n✨ Migration completed successfully!`);
        console.log(`📝 Updated ${updatedCount} out of ${users.length} users`);

        // Close connection
        await mongoose.connection.close();
        console.log('👋 Database connection closed');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
};

// Run migration
migrateUsers();