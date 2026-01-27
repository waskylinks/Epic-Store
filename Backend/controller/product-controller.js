import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import { uploadToCloudinary, deleteFromCloudinary, deleteMultipleFromCloudinary } from '../utils/cloudinaryUpload.js';
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

const parsePricingData = (body) => {
  let pricing = null;
  
  if (body.pricing) {
    try {
      pricing = JSON.parse(body.pricing);
    } catch (err) {
      console.error('❌ Failed to parse pricing JSON:', err);
    }
  }
  
  // Convert to numbers and handle undefined
  const regular = Number(pricing?.regular || body.price || 0);
  const sale = pricing?.sale ? Number(pricing.sale) : (body.salePrice ? Number(body.salePrice) : null);
  const cost = pricing?.cost ? Number(pricing.cost) : null;
  
  const result = {
    regular,
    currency: pricing?.currency || body.currency || 'USD'
  };
  
  // Only add sale if it exists AND is less than regular
  if (sale !== null && !isNaN(sale) && sale > 0) {
    if (sale >= regular) {
      throw new Error(`Sale price (${sale}) must be less than regular price (${regular})`);
    }
    result.sale = sale;
  }
  
  // Only add cost if it exists
  if (cost !== null && !isNaN(cost) && cost > 0) {
    result.cost = cost;
  }
  
  console.log('✅ Parsed pricing:', result);
  return result;
};

// Get all products
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

// Create Product - fully resilient
export const createProducts = async (req, res, next) => {
  let uploadedImages = [];

  try {
    console.log('📝 Creating new product...');
    console.log('📤 Files received:', req.files?.length || 0);

    // Parse JSON fields safely
    const parseJSONSafe = (field) => {
      if (!req.body[field]) return undefined;
      try { return JSON.parse(req.body[field]); }
      catch { return undefined; }
    };

    const inventory = parseJSONSafe('inventory') || {
      stock: Number(req.body.stock) || 0,
      sku: req.body.sku || undefined,
      barcode: undefined,
      trackInventory: true,
      lowStockThreshold: 5
    };

    const productData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription,
      category: req.body.category,
      brand: req.body.brand || '',
      pricing: parseJSONSafe('pricing') || {
        regular: Number(req.body.price) || 0,
        sale: req.body.salePrice ? Number(req.body.salePrice) : undefined,
        cost: req.body.cost ? Number(req.body.cost) : undefined,
        currency: req.body.currency || 'USD'
      },
      inventory,
      subcategories: parseJSONSafe('subcategories') || [],
      tags: parseJSONSafe('tags') || [],
      specifications: parseJSONSafe('specifications') || [],
      variants: parseJSONSafe('variants') || [],
      dimensions: parseJSONSafe('dimensions'),
      weight: parseJSONSafe('weight'),
      seo: parseJSONSafe('seo'),
      isFeatured: req.body.isFeatured === 'true',
      isNewArrival: req.body.isNewArrival === 'true',
      isBestseller: req.body.isBestseller === 'true',
      status: req.body.status || 'published',
      user: req.user._id
    };

    // Handle images
    if (req.files && req.files.length > 0) {
      const imagesLinks = [];
      for (let i = 0; i < req.files.length; i++) {
        try {
          const result = await uploadToCloudinary(req.files[i].buffer, {
            folder: 'products',
            transformation: [
              { width: 1000, height: 1000, crop: 'limit' },
              { quality: 'auto:good' }
            ]
          });
          imagesLinks.push({
            public_id: result.public_id,
            url: result.secure_url,
            isPrimary: i === 0,
            order: i
          });
        } catch (err) {
          if (imagesLinks.length > 0)
            await deleteMultipleFromCloudinary(imagesLinks.map(img => img.public_id));
          return next(new HandleError(`Failed to upload image ${i + 1}`, 500));
        }
      }
      productData.images = imagesLinks;
      uploadedImages = imagesLinks;
    }

    // Save product - let Mongoose handle pricing validation
    const product = await Product.create(productData);

    await invalidateProductCaches();

    res.status(201).json({
      success: true,
      product
    });

  } catch (error) {
    if (uploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(uploadedImages.map(img => img.public_id));
    }
    console.error('🔥 Error creating product:', error);
    next(error);
  }
};

// Update Product - fully resilient
export const updateProduct = async (req, res, next) => {
  let newlyUploadedImages = [];

  try {
    const { id } = req.params;
    let product = await Product.findById(id);
    if (!product) return next(new HandleError('Product not found', 404));

    const parseJSONSafe = (field) => {
      if (!req.body[field]) return undefined;
      try { return JSON.parse(req.body[field]); }
      catch { return undefined; }
    };

    const inventory = parseJSONSafe('inventory') || {
      stock: Number(req.body.stock) || product.inventory?.stock || 0,
      sku: req.body.sku || product.inventory?.sku,
      barcode: product.inventory?.barcode,
      trackInventory: true,
      lowStockThreshold: 5
    };

    const updateData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription,
      category: req.body.category,
      brand: req.body.brand || '',
      pricing: parseJSONSafe('pricing') || {
        regular: Number(req.body.price) || product.pricing?.regular || 0,
        sale: req.body.salePrice ? Number(req.body.salePrice) : product.pricing?.sale,
        cost: req.body.cost ? Number(req.body.cost) : product.pricing?.cost,
        currency: req.body.currency || product.pricing?.currency || 'USD'
      },
      inventory,
      subcategories: parseJSONSafe('subcategories') || product.subcategories,
      tags: parseJSONSafe('tags') || product.tags,
      specifications: parseJSONSafe('specifications') || product.specifications,
      variants: parseJSONSafe('variants') || product.variants,
      dimensions: parseJSONSafe('dimensions') || product.dimensions,
      weight: parseJSONSafe('weight') || product.weight,
      seo: parseJSONSafe('seo') || product.seo,
      isFeatured: req.body.isFeatured === 'true',
      isNewArrival: req.body.isNewArrival === 'true',
      isBestseller: req.body.isBestseller === 'true',
      status: req.body.status || product.status,
      lastModifiedBy: req.user._id
    };

    // Handle image deletion
    const imagesToDelete = parseJSONSafe('imagesToDelete') || [];
    if (imagesToDelete.length > 0) {
      product.images = product.images.filter(img => !imagesToDelete.includes(img.public_id));
    }

   // Handle existing images reordering
      const existingImages = parseJSONSafe('existingImages');
      let currentImages = product.images; // Start with current images

      if (existingImages && Array.isArray(existingImages)) {
          currentImages = existingImages; // Use the reordered existing images
      }

      // Handle new images
      if (req.files && req.files.length > 0) {
          const imagesLinks = [];
          for (let i = 0; i < req.files.length; i++) {
              try {
                  const result = await uploadToCloudinary(req.files[i].buffer, {
                      folder: 'products',
                      transformation: [
                          { width: 1000, height: 1000, crop: 'limit' },
                          { quality: 'auto:good' }
                      ]
                  });
                  imagesLinks.push({
                      public_id: result.public_id,
                      url: result.secure_url,
                      isPrimary: false,
                      order: currentImages.length + i
                  });
              } catch (err) {
                  if (imagesLinks.length > 0)
                      await deleteMultipleFromCloudinary(imagesLinks.map(img => img.public_id));
                  return next(new HandleError(`Failed to upload image ${i + 1}`, 500));
              }
          }
          updateData.images = [...currentImages, ...imagesLinks];
          newlyUploadedImages = imagesLinks;
      } else {
          updateData.images = currentImages;
      }

    // Update product in DB - Mongoose handles validation
    product = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      useFindAndModify: false
    });

    // Delete old images from Cloudinary
    if (imagesToDelete.length > 0) {
      await deleteMultipleFromCloudinary(imagesToDelete);
    }

    await invalidateProductCaches();

    res.status(200).json({
      success: true,
      product
    });

  } catch (error) {
    if (newlyUploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(newlyUploadedImages.map(img => img.public_id));
    }
    console.error('🔥 Error updating product:', error);
    next(error);
  }
};


// Delete products
export const deleteProduct = handleAsyncError(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new HandleError("Product not found", 404));
    }

    console.log(`🗑️ Deleting product: ${product.name} (${product._id})`);

    // Delete images from Cloudinary
    if (product.images && product.images.length > 0) {
        const publicIds = product.images.map(img => img.public_id).filter(Boolean);
        
        if (publicIds.length > 0) {
            console.log(`📸 Deleting ${publicIds.length} images from Cloudinary...`);
            
            try {
                const results = await deleteMultipleFromCloudinary(publicIds);
                console.log(`✅ Images deleted from Cloudinary`);
            } catch (cloudinaryError) {
                console.error('❌ Cloudinary deletion error:', cloudinaryError.message);
                return next(new HandleError(
                    'Failed to delete product images from Cloudinary',
                    500
                ));
            }
        }
    }

    // Delete product from database
    await Product.findByIdAndDelete(req.params.id);
    console.log(`✅ Product deleted from database`);

    // Invalidate caches
    await invalidateProductCaches();

    res.status(200).json({
        success: true,
        message: 'Product and images deleted successfully',
        deletedProduct: {
            id: product._id,
            name: product.name,
            imagesDeleted: product.images?.length || 0
        }
    });
});

// Batch delete products
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

// Get single product details
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

// Create/update product review
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

// Get product reviews
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

// Delete product review
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

// Admin - get all products
export const getAdminProducts = handleAsyncError(async(req, res, next) => {
    const products = await Product.find();
    res.status(200).json({
        success: true,
        products
    })
});

