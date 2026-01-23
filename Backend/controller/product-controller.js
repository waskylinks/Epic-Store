import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import { uploadToCloudinary, cloudinary, deleteFromCloudinary } from '../utils/cloudinaryUpload.js';
import { deleteCachePattern } from '../utils/redis.js';

// Helper: Invalidate product-related caches
const invalidateProductCaches = async () => {
    try {
        await Promise.all([
            deleteCachePattern('admin_stats*'),
            deleteCachePattern('analytics_*'),
            deleteCachePattern('trending_products*'),
            deleteCachePattern('new_products*'),
            deleteCachePattern('featured_products*'),
            deleteCachePattern('bestsellers*')
        ]);
    } catch (error) {
        console.error('Cache invalidation error:', error);
    }
};

// creating products 
export const createProducts = handleAsyncError(async (req, res, next) => {
    // Debug: Check environment variables
    console.log('🔍 Cloudinary Config Check:', {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME ? `Set (${process.env.CLOUDINARY_CLOUD_NAME.substring(0, 5)}...)` : '❌ MISSING',
        apiKey: process.env.CLOUDINARY_API_KEY ? 'Set ✅' : '❌ MISSING',
        apiSecret: process.env.CLOUDINARY_API_SECRET ? 'Set ✅' : '❌ MISSING'
    });

    // Debug: Log raw request body
    console.log('📝 Raw Request Body:', {
        name: req.body.name,
        category: req.body.category,
        price: req.body.price,
        stock: req.body.stock,
        status: req.body.status,
        bodyKeys: Object.keys(req.body)
    });

    // Debug: Check files
    console.log('📁 Files received:', {
        filesExist: !!req.files,
        fileCount: req.files?.length || 0,
        fileDetails: req.files?.map(f => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            mimetype: f.mimetype,
            size: f.size,
            hasBuffer: !!f.buffer
        }))
    });

    const imageLinks = [];

    if (req.files && req.files.length > 0) {
        for (const file of req.files) {
            try {
                console.log(`⬆️ Uploading image: ${file.originalname}`);
                const result = await uploadToCloudinary(file.buffer);
                console.log('✅ Upload successful:', {
                    public_id: result.public_id,
                    url: result.secure_url
                });
                
                imageLinks.push({
                    public_id: result.public_id,
                    url: result.secure_url,
                    alt: req.body.name || 'Product image',
                    isPrimary: imageLinks.length === 0
                });
            } catch (uploadError) {
                // Detailed error logging
                console.error('❌ Cloudinary Upload Failed:', {
                    fileName: file.originalname,
                    errorName: uploadError.name,
                    errorMessage: uploadError.message,
                    httpCode: uploadError.http_code,
                    stack: uploadError.stack
                });
                
                return next(new HandleError(
                    `Failed to upload image "${file.originalname}": ${uploadError.message}`, 
                    500
                ));
            }
        }
    }

    if (imageLinks.length === 0) {
        return next(new HandleError('Please upload at least one product image', 400));
    }

    req.body.images = imageLinks;

    // Parse JSON strings if they exist
    if (typeof req.body.specifications === 'string') {
        try {
            req.body.specifications = JSON.parse(req.body.specifications);
        } catch (e) {
            console.warn('Failed to parse specifications:', e);
            req.body.specifications = [];
        }
    }

    if (typeof req.body.variants === 'string') {
        try {
            req.body.variants = JSON.parse(req.body.variants);
        } catch (e) {
            console.warn('Failed to parse variants:', e);
            req.body.variants = [];
        }
    }

    if (typeof req.body.dimensions === 'string') {
        try {
            req.body.dimensions = JSON.parse(req.body.dimensions);
        } catch (e) {
            console.warn('Failed to parse dimensions:', e);
        }
    }

    if (typeof req.body.weight === 'string') {
        try {
            req.body.weight = JSON.parse(req.body.weight);
        } catch (e) {
            console.warn('Failed to parse weight:', e);
        }
    }

    if (typeof req.body.seo === 'string') {
        try {
            req.body.seo = JSON.parse(req.body.seo);
        } catch (e) {
            console.warn('Failed to parse seo:', e);
        }
    }

    // Convert string booleans to actual booleans
    if (typeof req.body.isFeatured === 'string') {
        req.body.isFeatured = req.body.isFeatured === 'true';
    }
    if (typeof req.body.isNewArrival === 'string') {
        req.body.isNewArrival = req.body.isNewArrival === 'true';
    }
    if (typeof req.body.isBestseller === 'string') {
        req.body.isBestseller = req.body.isBestseller === 'true';
    }

    if (req.body.price && !req.body.pricing) {
        req.body.pricing = {
            regular: req.body.price,
            currency: req.body.currency || 'USD'
        };
        if (req.body.salePrice) {
            req.body.pricing.sale = req.body.salePrice;
        }
    }

    if (req.body.stock !== undefined && !req.body.inventory) {
        req.body.inventory = {
            stock: req.body.stock,
            trackInventory: true
        };
    }

    if (req.body.sku && req.body.inventory) {
        req.body.inventory.sku = req.body.sku;
    }

    req.body.user = req.user.id;

    if (req.body.isNewArrival === undefined) {
        req.body.isNewArrival = true;
    }

    console.log('📦 Creating product with data:', {
        name: req.body.name,
        category: req.body.category,
        price: req.body.price,
        stock: req.body.stock,
        imagesCount: req.body.images?.length,
        user: req.body.user,
        description: req.body.description ? 'Set' : 'MISSING'
    });

    try {
        const product = await Product.create(req.body);
        console.log('✅ Product created successfully:', product._id);

        await invalidateProductCaches();

        res.status(201).json({
            success: true,
            product,
        });
    } catch (dbError) {
        console.error('❌ Database Error:', {
            name: dbError.name,
            message: dbError.message,
            errors: dbError.errors,
            code: dbError.code
        });
        
        // Better error messages for validation errors
        if (dbError.name === 'ValidationError') {
            const missingFields = Object.keys(dbError.errors).map(field => {
                return `${field}: ${dbError.errors[field].message}`;
            }).join(', ');
            
            return next(new HandleError(
                `Validation failed: ${missingFields}`,
                400
            ));
        }
        
        return next(new HandleError(
            `Failed to create product: ${dbError.message}`,
            500
        ));
    }
});

//get all products
export const getAllProducts = handleAsyncError(async (req, res, next) => {
    const resultPerPage = 4;
    
    const apiFeatures = new APIFunctionality(Product.find({ status: 'published' }), req.query)
        .search()
        .filter();
    
    const filteredQuery = apiFeatures.query.clone();
    const productsCount = await filteredQuery.countDocuments();
    const totalPages = Math.ceil(productsCount / resultPerPage);
    
    const page = Number(req.query.page) || 1;
    if(page > totalPages && productsCount > 0){
        return next(new HandleError("Page not found", 404));
    }

    apiFeatures.pagination(resultPerPage);
    const products = await apiFeatures.query;

    if(!products || products.length === 0){
        return next(new HandleError("No products found", 404));
    }

    res.status(200).json({
        success: true,
        products,
        productsCount,
        resultPerPage,
        totalPages,
        currentPage: page,
    });
});

// update products
export const updateProduct = handleAsyncError(async (req, res, next) => {
    let product = await Product.findById(req.params.id);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    console.log(`📝 Updating product: ${product.name} (${product._id})`);

    // Start with existing images
    let imageLinks = [...product.images];
    let deletedImageIds = [];

    // STEP 1: Handle image deletions
    if (req.body.imagesToDelete) {
        let imagesToDelete;
        
        // Parse the deletion list
        try {
            imagesToDelete = typeof req.body.imagesToDelete === 'string' 
                ? JSON.parse(req.body.imagesToDelete)
                : req.body.imagesToDelete;
        } catch (e) {
            return next(new HandleError('Invalid imagesToDelete format', 400));
        }

        // Ensure it's an array
        if (!Array.isArray(imagesToDelete)) {
            imagesToDelete = [imagesToDelete];
        }

        if (imagesToDelete.length > 0) {
            console.log(`🗑️ Deleting ${imagesToDelete.length} images from Cloudinary...`);

            try {
                // Delete from Cloudinary using helper function
                const results = await deleteMultipleFromCloudinary(imagesToDelete);
                
                // Check results
                const successful = results.filter(r => !r.error);
                const failed = results.filter(r => r.error);

                console.log(`✅ Deleted ${successful.length}/${imagesToDelete.length} images`);
                
                if (failed.length > 0) {
                    console.warn('⚠️ Some images failed to delete:', 
                        failed.map(f => f.public_id || 'unknown')
                    );
                }

                // Track successfully deleted IDs
                deletedImageIds = imagesToDelete;

                // Remove deleted images from the image links array
                imageLinks = imageLinks.filter(
                    (img) => !imagesToDelete.includes(img.public_id)
                );

            } catch (cloudinaryError) {
                console.error('❌ Cloudinary deletion error:', cloudinaryError.message);
                
                // DECISION: Should we fail the update or continue?
                // Option A: Fail the update (safer)
                return next(new HandleError(
                    'Failed to delete images from Cloudinary',
                    500
                ));
                
                // Option B: Continue with warning (less safe)
                // console.warn('Continuing update despite deletion errors');
            }
        }
    }

    // STEP 2: Upload new images
    let newlyUploadedImages = [];
    if (req.files && req.files.length > 0) {
        console.log(`⬆️ Uploading ${req.files.length} new images...`);

        for (const file of req.files) {
            try {
                console.log(`📤 Uploading: ${file.originalname}`);
                const result = await uploadToCloudinary(file.buffer);
                
                const newImage = {
                    public_id: result.public_id,
                    url: result.secure_url,
                    alt: req.body.name || product.name || 'Product image',
                    isPrimary: imageLinks.length === 0 && newlyUploadedImages.length === 0
                };

                imageLinks.push(newImage);
                newlyUploadedImages.push(newImage);
                
                console.log(`✅ Uploaded: ${result.public_id}`);

            } catch (uploadError) {
                console.error('❌ Upload failed:', {
                    fileName: file.originalname,
                    error: uploadError.message
                });

                // ROLLBACK: Delete newly uploaded images if one fails
                if (newlyUploadedImages.length > 0) {
                    console.log('🔄 Rolling back uploaded images...');
                    const rollbackIds = newlyUploadedImages.map(img => img.public_id);
                    try {
                        await deleteMultipleFromCloudinary(rollbackIds);
                        console.log('✅ Rollback successful');
                    } catch (rollbackError) {
                        console.error('❌ Rollback failed:', rollbackError.message);
                    }
                }

                return next(new HandleError(
                    `Failed to upload image "${file.originalname}": ${uploadError.message}`,
                    500
                ));
            }
        }
    }

    // STEP 3: Validate that product has at least one image
    if (imageLinks.length === 0) {
        // ROLLBACK: Restore deleted images if no images remain
        if (deletedImageIds.length > 0) {
            console.warn('⚠️ Cannot delete all images - product needs at least one');
        }
        return next(new HandleError(
            'Product must have at least one image',
            400
        ));
    }

    // STEP 4: Update product data
    req.body.images = imageLinks;

    // Handle pricing updates
    if (req.body.price) {
        req.body.pricing = req.body.pricing || {};
        req.body.pricing.regular = req.body.price;
        if (req.body.salePrice) {
            req.body.pricing.sale = req.body.salePrice;
        }
    }

    // Handle inventory updates
    if (req.body.stock !== undefined) {
        req.body.inventory = req.body.inventory || {};
        req.body.inventory.stock = req.body.stock;
    }

    // Track who modified the product
    req.body.lastModifiedBy = req.user.id;

    // STEP 5: Update in database
    try {
        product = await Product.findByIdAndUpdate(
            req.params.id, 
            req.body, 
            {
                new: true,
                runValidators: true,
                useFindAndModify: false,
            }
        );

        console.log('✅ Product updated successfully');

    } catch (dbError) {
        console.error('❌ Database update error:', dbError.message);

        // ROLLBACK: Delete newly uploaded images
        if (newlyUploadedImages.length > 0) {
            console.log('🔄 Rolling back uploaded images due to DB error...');
            const rollbackIds = newlyUploadedImages.map(img => img.public_id);
            try {
                await deleteMultipleFromCloudinary(rollbackIds);
            } catch (rollbackError) {
                console.error('❌ Rollback failed:', rollbackError.message);
            }
        }

        return next(new HandleError(
            `Failed to update product: ${dbError.message}`,
            500
        ));
    }

    // STEP 6: Invalidate caches
    await invalidateProductCaches();

    res.status(200).json({
        success: true,
        product,
        changes: {
            imagesDeleted: deletedImageIds.length,
            imagesAdded: newlyUploadedImages.length,
            totalImages: imageLinks.length
        }
    });
});

// delete products
export const deleteProduct = handleAsyncError(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    console.log(`🗑️ Starting deletion process for product: ${product.name} (${product._id})`);

    // STEP 1: Delete images from Cloudinary FIRST
    if (product.images && product.images.length > 0) {
        const publicIds = product.images.map(img => img.public_id).filter(Boolean);
        
        if (publicIds.length > 0) {
            console.log(`📸 Deleting ${publicIds.length} images from Cloudinary...`);
            
            try {
                // Use the helper function for batch deletion
                const results = await deleteMultipleFromCloudinary(publicIds);
                
                // Check for failures
                const failed = results.filter(r => r.error);
                const successful = results.filter(r => !r.error);
                
                console.log(`✅ Successfully deleted ${successful.length} images`);
                
                if (failed.length > 0) {
                    console.warn(`⚠️ Failed to delete ${failed.length} images:`, 
                        failed.map(f => f.public_id || 'unknown')
                    );
                    
                    // You can choose to:
                    // Option A: Continue anyway (current approach)
                    // Option B: Return error and don't delete product
                    // For now, we'll log but continue
                }
            } catch (cloudinaryError) {
                console.error('❌ Cloudinary deletion error:', cloudinaryError.message);
                
                // IMPORTANT DECISION POINT:
                // Should we fail the entire deletion if Cloudinary fails?
                // Option A: Fail the request (recommended for data consistency)
                return next(new HandleError(
                    'Failed to delete product images from Cloudinary. Product not deleted.',
                    500
                ));
                
                // Option B: Continue anyway (orphans images in Cloudinary)
                // console.warn('Continuing with product deletion despite Cloudinary errors');
            }
        }
    }

    // STEP 2: Delete product from database
    try {
        await Product.findByIdAndDelete(req.params.id);
        console.log(`✅ Product deleted from database: ${product._id}`);
    } catch (dbError) {
        console.error('❌ Database deletion error:', dbError.message);
        return next(new HandleError(
            'Failed to delete product from database',
            500
        ));
    }

    // STEP 3: Invalidate caches
    await invalidateProductCaches();

    res.status(200).json({
        success: true,
        message: 'Product and associated images deleted successfully',
        deletedProduct: {
            id: product._id,
            name: product.name,
            imagesDeleted: product.images?.length || 0
        }
    });
});

// ALTERNATIVE VERSION - WITH TRANSACTION-LIKE ROLLBACK
export const deleteProductWithRollback = handleAsyncError(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    console.log(`🗑️ Starting deletion with rollback for: ${product.name}`);

    let deletedImageIds = [];
    let dbDeleted = false;

    try {
        // STEP 1: Delete images from Cloudinary
        if (product.images && product.images.length > 0) {
            const publicIds = product.images.map(img => img.public_id).filter(Boolean);
            
            if (publicIds.length > 0) {
                console.log(`📸 Deleting ${publicIds.length} images...`);
                const results = await deleteMultipleFromCloudinary(publicIds);
                
                // Track successfully deleted images for potential rollback
                deletedImageIds = results
                    .filter(r => !r.error && r.result === 'ok')
                    .map((r, idx) => publicIds[idx]);
                
                const failed = results.filter(r => r.error);
                if (failed.length > 0) {
                    throw new Error(`Failed to delete ${failed.length} images`);
                }
            }
        }

        // STEP 2: Delete from database
        await Product.findByIdAndDelete(req.params.id);
        dbDeleted = true;
        console.log(`✅ Product deleted successfully`);

        // STEP 3: Invalidate caches
        await invalidateProductCaches();

        res.status(200).json({
            success: true,
            message: 'Product and images deleted successfully',
            deletedProduct: {
                id: product._id,
                name: product.name,
                imagesDeleted: deletedImageIds.length
            }
        });

    } catch (error) {
        console.error('❌ Deletion failed, attempting rollback:', error.message);

        // ROLLBACK: If DB deletion succeeded but something after failed,
        // we can't easily recreate the product, so this is mainly for Cloudinary
        if (!dbDeleted && deletedImageIds.length > 0) {
            console.warn('⚠️ Rolling back Cloudinary deletions is not supported');
            console.warn('Images may be orphaned:', deletedImageIds);
        }

        return next(new HandleError(
            `Failed to delete product: ${error.message}`,
            500
        ));
    }
});

// BATCH DELETE PRODUCTS (BONUS)
export const deleteMultipleProducts = handleAsyncError(async (req, res, next) => {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
        return next(new HandleError('Please provide an array of product IDs', 400));
    }

    console.log(`🗑️ Batch deleting ${productIds.length} products...`);

    const results = {
        successful: [],
        failed: []
    };

    for (const productId of productIds) {
        try {
            const product = await Product.findById(productId);
            
            if (!product) {
                results.failed.push({
                    id: productId,
                    reason: 'Product not found'
                });
                continue;
            }

            // Delete images
            if (product.images && product.images.length > 0) {
                const publicIds = product.images.map(img => img.public_id).filter(Boolean);
                if (publicIds.length > 0) {
                    await deleteMultipleFromCloudinary(publicIds);
                }
            }

            // Delete product
            await Product.findByIdAndDelete(productId);

            results.successful.push({
                id: productId,
                name: product.name
            });

        } catch (error) {
            results.failed.push({
                id: productId,
                reason: error.message
            });
        }
    }

    await invalidateProductCaches();

    res.status(200).json({
        success: true,
        message: `Deleted ${results.successful.length}/${productIds.length} products`,
        results
    });
});

// get single product details (with analytics tracking)
export const getProductDetails = handleAsyncError(async (req, res, next) => {
    const product = await Product.findById(req.params.id)
        .populate('relatedProducts', 'name price images slug ratings')
        .populate('crossSells', 'name price images slug')
        .populate('upsells', 'name price images slug'); 

    if(!product){
        return next(new HandleError("Product not found", 404))
    }

    product.incrementView().catch(err => 
        console.warn('Failed to track view:', err)
    );

    res.status(200).json({
        success: true,
        product,
    });
});

// creating and updating review
export const createProductReview = handleAsyncError(async(req, res, next) => {
    const {rating, comment, productID} = req.body;
    const review = {
        user: req.user._id,
        name: req.user.name,
        rating: Number(rating),
        comment,
        verified: false
    } 

    const product = await Product.findById(productID);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    const reviewExists = product.reviews.find(review => review.user.toString() === req.user._id.toString());

    if (reviewExists) {
        product.reviews.forEach(review => {
            if (review.user.toString() === req.user._id.toString()) {
                review.rating = rating;
                review.comment = comment;
            }
        })
    } else {
        product.reviews.push(review)
        product.numOfReviews = product.reviews.length;
    }

    let avg = 0;
    product.reviews.forEach(review => {
        avg += review.rating;
    })

    if(product.reviews.length === 0) {
        product.ratings = 0;
    } else {
        product.ratings = Math.ceil((avg / product.reviews.length) * 10) / 10;
    }

    await product.save({
        validateBeforeSave: false
    })

    res.status(200).json({
        success: true,
        product
    })
});

//getting reviews 
export const getProductReviews = handleAsyncError(async(req, res, next) => {
    const product = await Product.findById(req.query.id);
    if(!product) {
        return next(new HandleError(`Product not found`, 400))
    }

    res.status(200).json({
        success: true,
        reviews: product.reviews
    })
});

//delete product reviews
export const deleteReview = handleAsyncError(async(req, res, next) => {
    const product = await Product.findById(req.query.productID);
    if(!product) {
        return next(new HandleError(`Product not found`, 400))
    }

    const reviews = product.reviews.filter(review => review._id.toString() !== req.query.id.toString()); 
    let avg = 0;

    reviews.forEach(review => {
        avg += review.rating;
    })

    const ratings = reviews.length > 0 
        ? Number((avg / reviews.length).toFixed(1)) 
        : 0;

    const numOfReviews = reviews.length;

    await Product.findByIdAndUpdate(req.query.productID, {
        reviews,
        ratings,
        numOfReviews
    }, {
        new: true,
        runValidators: true
    })

    res.status(200).json({
        success: true,
        message: `Review deleted successfully`
    })
});

//admin - get all products
export const getAdminProducts = handleAsyncError(async(req, res, next) => {
    const products = await Product.find();
    res.status(200).json({
        success: true,
        products
    })
});