import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Order from '../models/order-model.js';

dotenv.config();

const migrateRefundSchema = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find all orders
    const orders = await Order.find({});
    console.log(`📊 Found ${orders.length} orders to migrate`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const order of orders) {
      try {
        let needsUpdate = false;

        // Check if refundInfo exists
        if (!order.refundInfo) {
          order.refundInfo = {
            status: "none",
            amount: 0
          };
          needsUpdate = true;
        } else {
          // Update existing refundInfo to include new fields
          if (!order.refundInfo.status) {
            order.refundInfo.status = "none";
            needsUpdate = true;
          }

          // Ensure status is one of the new valid values
          if (!["none", "requested", "approved", "rejected", "processing", "completed", "failed"].includes(order.refundInfo.status)) {
            // Map old values to new schema
            if (order.refundInfo.status === "pending") {
              order.refundInfo.status = "requested";
            } else {
              order.refundInfo.status = "none";
            }
            needsUpdate = true;
          }

          // Set default amount if missing
          if (order.refundInfo.amount === undefined) {
            order.refundInfo.amount = 0;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await order.save({ validateBeforeSave: false });
          migrated++;
          console.log(`✅ Migrated order ${order._id}`);
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
        console.error(`❌ Error migrating order ${order._id}:`, err.message);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`✅ Migrated: ${migrated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run migration
migrateRefundSchema();