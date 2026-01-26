import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import { uploadToCloudinary, cloudinary, deleteFromCloudinary } from '../utils/cloudinaryUpload.js';
import { deleteCachePattern } from '../utils/redis.js';

// Helper: Delete multiple images from Cloudinary
const deleteMultipleFromCloudinary = async (publicIds) => {
    const results = [];
    for (const publicId of publicIds) {
        try {
            const result = await deleteFromCloudinary(publicId);
            results.push({ public_id: publicId, result: 'ok' });
        } catch (error) {
            results.push({ public_id: publicId, error: error.message });
        }
    }
    return results;
};

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
export const createProduct = async (req, res, next) => {
  try {
    console.log('📝 Creating new product...');

    // Parse JSON fields
    let parsedPricing = null;
    let parsedInventory = null;
    let parsedDimensions = null;
    let parsedWeight = null;
    let parsedSeo = null;
    let parsedSpecs = null;
    let parsedVariants = null;

    // ✅ Parse pricing object (NEW)
    if (req.body.pricing) {
      try {
        parsedPricing = JSON.parse(req.body.pricing);
        console.log('💰 Parsed pricing:', parsedPricing);
      } catch (err) {
        console.error('❌ Failed to parse pricing:', err);
      }
    }

    // ✅ Parse inventory object (NEW)
    if (req.body.inventory) {
      try {
        parsedInventory = JSON.parse(req.body.inventory);
        console.log('📦 Parsed inventory:', parsedInventory);
      } catch (err) {
        console.error('❌ Failed to parse inventory:', err);
      }
    }

    if (req.body.dimensions) {
      try {
        parsedDimensions = JSON.parse(req.body.dimensions);
      } catch (err) {
        console.error('❌ Failed to parse dimensions:', err);
      }
    }

    if (req.body.weight) {
      try {
        parsedWeight = JSON.parse(req.body.weight);
      } catch (err) {
        console.error('❌ Failed to parse weight:', err);
      }
    }

    if (req.body.seo) {
      try {
        parsedSeo = JSON.parse(req.body.seo);
      } catch (err) {
        console.error('❌ Failed to parse seo:', err);
      }
    }

    if (req.body.specifications) {
      try {
        parsedSpecs = JSON.parse(req.body.specifications);
      } catch (err) {
        console.error('❌ Failed to parse specifications:', err);
      }
    }

    if (req.body.variants) {
      try {
        parsedVariants = JSON.parse(req.body.variants);
      } catch (err) {
        console.error('❌ Failed to parse variants:', err);
      }
    }

    // Build product data
    const productData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription,
      category: req.body.category,
      brand: req.body.brand || '',
      
      // ✅ Use parsed pricing object if available
      pricing: parsedPricing || {
        regular: Number(req.body.price),
        sale: req.body.salePrice ? Number(req.body.salePrice) : undefined,
        cost: undefined,
        currency: req.body.currency || 'USD'
      },
      
      // ✅ Use parsed inventory object if available
      inventory: parsedInventory || {
        stock: Number(req.body.stock) || 0,
        sku: req.body.sku || undefined,
        barcode: undefined,
        trackInventory: true,
        lowStockThreshold: 5
      },
      
      // Legacy fields
      price: Number(req.body.price),
      stock: Number(req.body.stock) || 0,
      
      subcategories: req.body.subcategories || [],
      tags: req.body.tags || [],
      specifications: parsedSpecs || [],
      variants: parsedVariants || [],
      dimensions: parsedDimensions,
      weight: parsedWeight,
      seo: parsedSeo,
      
      isFeatured: req.body.isFeatured === 'true',
      isNewArrival: req.body.isNewArrival === 'true',
      isBestseller: req.body.isBestseller === 'true',
      status: req.body.status || 'published',
      
      user: req.user._id
    };

    console.log('📊 Product data prepared:', JSON.stringify(productData, null, 2));

    // Handle images
    if (req.files && req.files.length > 0) {
      const imagesLinks = [];
      
      for (let i = 0; i < req.files.length; i++) {
        const result = await uploadToCloudinary(req.files[i].path, "products");
        
        imagesLinks.push({
          public_id: result.public_id,
          url: result.secure_url,
          isPrimary: i === 0,
          order: i
        });
        
        fs.unlinkSync(req.files[i].path);
      }
      
      productData.images = imagesLinks;
    }

    // Create product
    const product = await Product.create(productData);
    
    console.log('✅ Product created successfully:', product._id);

    res.status(201).json({
      success: true,
      product
    });

  } catch (error) {
    console.error('🔥 Error creating product:', error);
    next(error);
  }
};


// ============================================
// FIX 4: Backend - updateProduct function
// ============================================


export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    console.log(`📝 Updating product: ${id}`);

    let product = await Product.findById(id);
    if (!product) {
      return next(new ErrorHandler("Product not found", 404));
    }

    // Parse JSON fields
    let parsedPricing = null;
    let parsedInventory = null;
    let parsedDimensions = null;
    let parsedWeight = null;
    let parsedSeo = null;
    let parsedSpecs = null;
    let parsedVariants = null;
    let imagesToDelete = null;

    // ✅ Parse pricing object (NEW)
    if (req.body.pricing) {
      try {
        parsedPricing = JSON.parse(req.body.pricing);
        console.log('💰 Parsed pricing:', parsedPricing);
      } catch (err) {
        console.error('❌ Failed to parse pricing:', err);
      }
    }

    // ✅ Parse inventory object (NEW)
    if (req.body.inventory) {
      try {
        parsedInventory = JSON.parse(req.body.inventory);
        console.log('📦 Parsed inventory:', parsedInventory);
      } catch (err) {
        console.error('❌ Failed to parse inventory:', err);
      }
    }

    if (req.body.dimensions) {
      try {
        parsedDimensions = JSON.parse(req.body.dimensions);
      } catch (err) {
        console.error('❌ Failed to parse dimensions:', err);
      }
    }

    if (req.body.weight) {
      try {
        parsedWeight = JSON.parse(req.body.weight);
      } catch (err) {
        console.error('❌ Failed to parse weight:', err);
      }
    }

    if (req.body.seo) {
      try {
        parsedSeo = JSON.parse(req.body.seo);
      } catch (err) {
        console.error('❌ Failed to parse seo:', err);
      }
    }

    if (req.body.specifications) {
      try {
        parsedSpecs = JSON.parse(req.body.specifications);
      } catch (err) {
        console.error('❌ Failed to parse specifications:', err);
      }
    }

    if (req.body.variants) {
      try {
        parsedVariants = JSON.parse(req.body.variants);
      } catch (err) {
        console.error('❌ Failed to parse variants:', err);
      }
    }

    if (req.body.imagesToDelete) {
      try {
        imagesToDelete = JSON.parse(req.body.imagesToDelete);
      } catch (err) {
        console.error('❌ Failed to parse imagesToDelete:', err);
      }
    }

    // Build update data
    const updateData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription,
      category: req.body.category,
      brand: req.body.brand || '',
      
      // ✅ Use parsed pricing object if available
      pricing: parsedPricing || {
        regular: Number(req.body.price),
        sale: req.body.salePrice ? Number(req.body.salePrice) : undefined,
        cost: undefined,
        currency: req.body.currency || 'USD'
      },
      
      // ✅ Use parsed inventory object if available
      inventory: parsedInventory || {
        stock: Number(req.body.stock) || 0,
        sku: req.body.sku || undefined,
        barcode: undefined,
        trackInventory: true,
        lowStockThreshold: 5
      },
      
      // Legacy fields
      price: Number(req.body.price),
      stock: Number(req.body.stock) || 0,
      
      subcategories: req.body.subcategories || [],
      tags: req.body.tags || [],
      specifications: parsedSpecs || [],
      variants: parsedVariants || [],
      dimensions: parsedDimensions,
      weight: parsedWeight,
      seo: parsedSeo,
      
      isFeatured: req.body.isFeatured === 'true',
      isNewArrival: req.body.isNewArrival === 'true',
      isBestseller: req.body.isBestseller === 'true',
      status: req.body.status || product.status,
      
      lastModifiedBy: req.user._id
    };

    console.log('📊 Update data prepared:', JSON.stringify(updateData, null, 2));

    // Handle image deletion
    if (imagesToDelete && imagesToDelete.length > 0) {
      for (const publicId of imagesToDelete) {
        await deleteFromCloudinary(publicId);
        product.images = product.images.filter(img => img.public_id !== publicId);
      }
    }

    // Handle new images
    if (req.files && req.files.length > 0) {
      const imagesLinks = [];
      
      for (let i = 0; i < req.files.length; i++) {
        const result = await uploadToCloudinary(req.files[i].path, "products");
        
        imagesLinks.push({
          public_id: result.public_id,
          url: result.secure_url,
          isPrimary: false,
          order: product.images.length + i
        });
        
        fs.unlinkSync(req.files[i].path);
      }
      
      updateData.images = [...product.images, ...imagesLinks];
    } else {
      updateData.images = product.images;
    }

    // Update product
    product = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      useFindAndModify: false
    });

    console.log('✅ Product updated successfully');

    res.status(200).json({
      success: true,
      product
    });

  } catch (error) {
    console.error('🔥 Error updating product:', error);
    next(error);
  }
};


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
                }
            } catch (cloudinaryError) {
                console.error('❌ Cloudinary deletion error:', cloudinaryError.message);
                
                return next(new HandleError(
                    'Failed to delete product images from Cloudinary. Product not deleted.',
                    500
                ));
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

// BATCH DELETE PRODUCTS
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