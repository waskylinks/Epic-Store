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
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Fetch users that may need migration
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to migrate`);

    let updatedCount = 0;

    for (const user of users) {
      const updates = {};

      // ==============================
      // NAME → firstName / lastName
      // ==============================
      if (user.name && (!user.firstName || !user.lastName)) {
        const nameParts = user.name.trim().split(' ');
        updates.firstName = nameParts[0] || 'User';
        updates.lastName = nameParts.slice(1).join(' ') || 'Name';
        updates.name = undefined; // remove legacy field
      }

      // ==============================
      // AUTH PROVIDER
      // ==============================
      if (!user.authProvider) {
        updates.authProvider = 'local';
      }

      // ==============================
      // EMAIL VERIFIED
      // ==============================
      if (user.emailVerified === undefined) {
        updates.emailVerified = true; // assume existing users were verified
      }

      // ==============================
      // AVATAR DEFAULT
      // ==============================
      if (!user.avatar || !user.avatar.url) {
        updates.avatar = {
          public_id: 'default_avatar',
          url: 'https://res.cloudinary.com/demo/image/upload/v1234567890/default_avatar.png'
        };
      }

      // ==============================
      // SECURITY FIELDS
      // ==============================
      if (user.loginAttempts === undefined) {
        updates.loginAttempts = 0;
      }

      if (!Array.isArray(user.passwordHistory)) {
        updates.passwordHistory = [];
      }

      // ==============================
      // APPLY UPDATES
      // ==============================
      if (Object.keys(updates).length > 0) {
        await User.findByIdAndUpdate(
          user._id,
          { $set: updates, $unset: { name: "" } },
          { new: true }
        );
        updatedCount++;
        console.log(`✅ Migrated user: ${user.email}`);
      }
    }

    console.log('\n✨ Migration completed successfully');
    console.log(`📝 Updated ${updatedCount} out of ${users.length} users`);

    // Close DB
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
