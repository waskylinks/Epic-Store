import mongoose from 'mongoose';
import Product from '../models/product-model.js';
import dotenv from 'dotenv';

dotenv.config();

// Migration function
const migrateProducts = async () => {
    try {
        console.log('🚀 Starting product migration...');

        // Connect to database
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to database');

        // Get all existing products
        const products = await Product.find({});
        console.log(`📦 Found ${products.length} products to migrate`);

        let migratedCount = 0;
        let skippedCount = 0;

        for (const product of products) {
            try {
                // Check if already migrated (has pricing object)
                if (product.pricing && product.pricing.regular) {
                    console.log(`⏭️  Skipping ${product.name} - already migrated`);
                    skippedCount++;
                    continue;
                }

                // Create update object
                const updateData = {};

                // Migrate pricing structure
                if (product.price && !product.pricing) {
                    updateData.pricing = {
                        regular: product.price,
                        currency: 'USD'
                    };
                }

                // Migrate inventory structure
                if (product.stock !== undefined && !product.inventory) {
                    updateData.inventory = {
                        stock: product.stock,
                        trackInventory: true,
                        lowStockThreshold: 5,
                        status: product.stock === 0 ? 'out_of_stock' : 
                                product.stock <= 5 ? 'low_stock' : 'in_stock'
                    };
                }

                // Migrate images array (image -> images)
                if (product.image && !product.images) {
                    updateData.images = product.image.map((img, index) => ({
                        public_id: img.public_id,
                        url: img.url,
                        alt: product.name || 'Product image',
                        isPrimary: index === 0,
                        order: index
                    }));
                }

                // Generate slug if doesn't exist
                if (!product.slug) {
                    updateData.slug = product.name
                        .toLowerCase()
                        .replace(/[^\w\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .trim();
                }

                // Set default status
                if (!product.status) {
                    updateData.status = 'published';
                }

                // Set isNewArrival for recently created products (last 30 days)
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                if (product.createdAt >= thirtyDaysAgo) {
                    updateData.isNewArrival = true;
                }

                // Initialize analytics if doesn't exist
                if (!product.analytics) {
                    updateData.analytics = {
                        views: 0,
                        purchases: 0,
                        addedToCart: 0,
                        addedToWishlist: 0
                    };
                }

                // Set SEO fields if missing
                if (!product.seo) {
                    updateData.seo = {
                        metaTitle: product.name.substring(0, 60),
                        metaDescription: product.description ? 
                            product.description.substring(0, 160) : 
                            `Buy ${product.name} at great prices`
                    };
                }

                // Update the product
                await Product.findByIdAndUpdate(
                    product._id,
                    { $set: updateData },
                    { runValidators: false } // Skip validation during migration
                );

                migratedCount++;
                console.log(`✅ Migrated: ${product.name}`);

            } catch (err) {
                console.error(`❌ Error migrating product ${product.name}:`, err.message);
            }
        }

        console.log('\n📊 Migration Summary:');
        console.log(`   Total products: ${products.length}`);
        console.log(`   Migrated: ${migratedCount}`);
        console.log(`   Skipped: ${skippedCount}`);
        console.log(`   Failed: ${products.length - migratedCount - skippedCount}`);
        console.log('\n✅ Migration completed!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
        process.exit(0);
    }
};

// Run migration
migrateProducts();