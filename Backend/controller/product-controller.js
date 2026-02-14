import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  deleteMultipleFromCloudinary
} from '../utils/cloudinaryUpload.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// SHARED HELPERS
// ============================================

const invalidateProductCaches = async () => {
  try {
    await Promise.all([
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('analytics_*'),
      deleteCachePattern('trending_products*'),
      deleteCachePattern('new_products*'),
      deleteCachePattern('featured_products*'),
      deleteCachePattern('bestsellers*'),
      deleteCachePattern('product_performance*'),
      deleteCachePattern('product_conversion*'),
      deleteCachePattern('inventory_turnover*'),
      deleteCachePattern('product_margins*'),
      deleteCachePattern('category_performance*')
    ]);
  } catch {
    // Cache invalidation failure must not affect the primary response
  }
};

const parseJSONSafe = (field) => {
  if (!field) return null;
  if (typeof field === 'object') return field;
  try {
    return JSON.parse(field);
  } catch {
    return null;
  }
};

// ============================================
// GET ALL PRODUCTS
// ============================================

export const getAllProducts = handleAsyncError(async (req, res, next) => {
  const resultPerPage = 4;

  const apiFeatures = new APIFunctionality(
    Product.find({ status: 'published' }),
    req.query
  ).search().filter();

  const filteredQuery = apiFeatures.query.clone();
  const productsCount = await filteredQuery.countDocuments();
  const totalPages = Math.ceil(productsCount / resultPerPage);

  const page = Number(req.query.page) || 1;
  if (page > totalPages && productsCount > 0) {
    return next(new HandleError("Page not found", 404));
  }

  apiFeatures.pagination(resultPerPage);
  const products = await apiFeatures.query;

  if (!products || products.length === 0) {
    return next(new HandleError("No products found", 404));
  }

  res.status(200).json({
    success: true,
    products,
    productsCount,
    resultPerPage,
    totalPages,
    currentPage: page
  });
});

// ============================================
// CREATE PRODUCT
// ============================================

// FIX PC1: Wrapped in handleAsyncError. The original used a plain async function
// with a manual try-catch, which is fine but inconsistent and leaves any code
// path outside the try-catch without global error handling. Using handleAsyncError
// as the outer wrapper + re-throwing from the inner catch (after Cloudinary
// cleanup) gives both: Cloudinary rollback on failure AND consistent error handling.
export const createProducts = handleAsyncError(async (req, res, next) => {
  let uploadedImages = [];

  try {
    const pricing = parseJSONSafe(req.body.pricing);
    const inventory = parseJSONSafe(req.body.inventory);
    const subcategories = parseJSONSafe(req.body.subcategories);
    const tags = parseJSONSafe(req.body.tags);
    const specifications = parseJSONSafe(req.body.specifications);
    const variants = parseJSONSafe(req.body.variants);
    const dimensions = parseJSONSafe(req.body.dimensions);
    const weight = parseJSONSafe(req.body.weight);
    const seo = parseJSONSafe(req.body.seo);

    const productData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription || '',
      category: req.body.category,
      brand: req.body.brand || '',
      pricing: pricing || {},
      inventory: inventory || {},
      subcategories: Array.isArray(subcategories) ? subcategories : [],
      tags: Array.isArray(tags) ? tags : [],
      specifications: Array.isArray(specifications) ? specifications : [],
      variants: Array.isArray(variants) ? variants : [],
      dimensions: dimensions || {},
      weight: weight || {},
      seo: seo || { metaTitle: '', metaDescription: '', keywords: [] },
      isFeatured: req.body.isFeatured === 'true',
      isNewArrival: req.body.isNewArrival === 'true',
      isBestseller: req.body.isBestseller === 'true',
      status: req.body.status || 'published',
      user: req.user._id,
      analytics: {
        views: 0,
        purchases: 0,
        addedToCart: 0,
        addedToWishlist: 0,
        conversions: 0
      }
    };

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
          if (imagesLinks.length > 0) {
            await deleteMultipleFromCloudinary(imagesLinks.map(img => img.public_id));
          }
          return next(new HandleError(`Failed to upload image ${i + 1}`, 500));
        }
      }

      productData.images = imagesLinks;
      uploadedImages = imagesLinks;
    }

    const product = await Product.create(productData);
    await invalidateProductCaches();

    res.status(201).json({ success: true, product });
  } catch (error) {
    // Rollback any Cloudinary uploads before surfacing the error
    if (uploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(
        uploadedImages.map(img => img.public_id)
      ).catch(() => {});
    }
    // Re-throw so handleAsyncError forwards to the global error handler
    throw error;
  }
});

// ============================================
// UPDATE PRODUCT
// ============================================

// FIX PC1 (continued): Same handleAsyncError wrapping applied here.
export const updateProduct = handleAsyncError(async (req, res, next) => {
  let newlyUploadedImages = [];

  try {
    const { id } = req.params;
    let product = await Product.findById(id);
    if (!product) return next(new HandleError('Product not found', 404));

    const pricing = parseJSONSafe(req.body.pricing);
    const inventory = parseJSONSafe(req.body.inventory);
    const subcategories = parseJSONSafe(req.body.subcategories);
    const tags = parseJSONSafe(req.body.tags);
    const specifications = parseJSONSafe(req.body.specifications);
    const variants = parseJSONSafe(req.body.variants);
    const dimensions = parseJSONSafe(req.body.dimensions);
    const weight = parseJSONSafe(req.body.weight);
    const seo = parseJSONSafe(req.body.seo);

    const updateData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription || '',
      category: req.body.category,
      brand: req.body.brand || '',
      pricing: pricing || product.pricing || {},
      inventory: inventory || product.inventory || {},
      subcategories: Array.isArray(subcategories) ? subcategories : product.subcategories || [],
      tags: Array.isArray(tags) ? tags : product.tags || [],
      specifications: Array.isArray(specifications) ? specifications : product.specifications || [],
      variants: Array.isArray(variants) ? variants : product.variants || [],
      dimensions: dimensions || product.dimensions || {},
      weight: weight || product.weight || {},
      seo: seo || product.seo || { metaTitle: '', metaDescription: '', keywords: [] },
      isFeatured: req.body.isFeatured === 'true',
      isNewArrival: req.body.isNewArrival === 'true',
      isBestseller: req.body.isBestseller === 'true',
      status: req.body.status || product.status,
      lastModifiedBy: req.user._id
    };

    // Handle image deletion
    const imagesToDelete = parseJSONSafe(req.body.imagesToDelete) || [];
    if (imagesToDelete.length > 0) {
      product.images = product.images.filter(
        img => !imagesToDelete.includes(img.public_id)
      );
    }

    const existingImages = parseJSONSafe(req.body.existingImages);
    let currentImages = existingImages || product.images;

    // Handle new image uploads
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
          if (imagesLinks.length > 0) {
            await deleteMultipleFromCloudinary(imagesLinks.map(img => img.public_id));
          }
          return next(new HandleError(`Failed to upload image ${i + 1}`, 500));
        }
      }

      updateData.images = [...currentImages, ...imagesLinks];
      newlyUploadedImages = imagesLinks;
    } else {
      updateData.images = currentImages;
    }

    product = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      useFindAndModify: false
    });

    // Delete old images from Cloudinary after DB update succeeds
    if (imagesToDelete.length > 0) {
      await deleteMultipleFromCloudinary(imagesToDelete).catch(() => {});
    }

    await invalidateProductCaches();

    res.status(200).json({ success: true, product });
  } catch (error) {
    // Rollback any newly uploaded Cloudinary images before surfacing the error
    if (newlyUploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(
        newlyUploadedImages.map(img => img.public_id)
      ).catch(() => {});
    }
    throw error;
  }
});

// ============================================
// DELETE PRODUCT
// ============================================

export const deleteProduct = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) return next(new HandleError("Product not found", 404));

  if (product.images && product.images.length > 0) {
    const publicIds = product.images.map(img => img.public_id).filter(Boolean);

    if (publicIds.length > 0) {
      try {
        await deleteMultipleFromCloudinary(publicIds);
      } catch {
        return next(new HandleError('Failed to delete product images from Cloudinary', 500));
      }
    }
  }

  await Product.findByIdAndDelete(req.params.id);
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

// ============================================
// BATCH DELETE PRODUCTS
// ============================================

export const deleteMultipleProducts = handleAsyncError(async (req, res, next) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return next(new HandleError('Please provide an array of product IDs', 400));
  }

  const results = { successful: [], failed: [] };

  for (const productId of productIds) {
    try {
      const product = await Product.findById(productId);

      if (!product) {
        results.failed.push({ id: productId, reason: 'Product not found' });
        continue;
      }

      if (product.images && product.images.length > 0) {
        const publicIds = product.images.map(img => img.public_id).filter(Boolean);
        if (publicIds.length > 0) {
          await deleteMultipleFromCloudinary(publicIds).catch(() => {});
        }
      }

      await Product.findByIdAndDelete(productId);
      results.successful.push({ id: productId, name: product.name });
    } catch (error) {
      results.failed.push({ id: productId, reason: error.message });
    }
  }

  await invalidateProductCaches();

  res.status(200).json({
    success: true,
    message: `Deleted ${results.successful.length}/${productIds.length} products`,
    results
  });
});

// ============================================
// GET SINGLE PRODUCT DETAILS
// ============================================

export const getProductDetails = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.params.id)
    .populate('relatedProducts', 'name pricing images slug ratings')
    .populate('crossSells', 'name pricing images slug')
    .populate('upsells', 'name pricing images slug');

  if (!product) return next(new HandleError("Product not found", 404));

  // Track view asynchronously — must not delay the response
  product.incrementView().catch(() => {});

  res.status(200).json({ success: true, product });
});

// ============================================
// CREATE / UPDATE PRODUCT REVIEW
// ============================================

export const createProductReview = handleAsyncError(async (req, res, next) => {
  const { rating, comment, productID } = req.body;

  const review = {
    user: req.user._id,
    name: req.user.name,
    rating: Number(rating),
    comment,
    verified: false
  };

  const product = await Product.findById(productID);
  if (!product) return next(new HandleError("Product not found", 404));

  const reviewExists = product.reviews.find(
    r => r.user.toString() === req.user._id.toString()
  );

  if (reviewExists) {
    product.reviews.forEach(r => {
      if (r.user.toString() === req.user._id.toString()) {
        r.rating = rating;
        r.comment = comment;
      }
    });
  } else {
    product.reviews.push(review);
    product.numOfReviews = product.reviews.length;
  }

  let avg = product.reviews.reduce((sum, r) => sum + r.rating, 0);
  product.ratings =
    product.reviews.length === 0
      ? 0
      : Math.ceil((avg / product.reviews.length) * 10) / 10;

  await product.save({ validateBeforeSave: false });

  res.status(200).json({ success: true, product });
});

// ============================================
// GET PRODUCT REVIEWS
// ============================================

export const getProductReviews = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.query.id);
  if (!product) return next(new HandleError('Product not found', 400));

  res.status(200).json({ success: true, reviews: product.reviews });
});

// ============================================
// DELETE PRODUCT REVIEW
// ============================================

export const deleteReview = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.query.productID);
  if (!product) return next(new HandleError('Product not found', 400));

  const reviews = product.reviews.filter(
    r => r._id.toString() !== req.query.id.toString()
  );

  const avg = reviews.reduce((sum, r) => sum + r.rating, 0);
  const ratings = reviews.length > 0
    ? Number((avg / reviews.length).toFixed(1))
    : 0;

  await Product.findByIdAndUpdate(
    req.query.productID,
    { reviews, ratings, numOfReviews: reviews.length },
    { new: true, runValidators: true }
  );

  res.status(200).json({ success: true, message: 'Review deleted successfully' });
});

// ============================================
// ADMIN — GET ALL PRODUCTS
// ============================================

export const getAdminProducts = handleAsyncError(async (req, res, next) => {
  const products = await Product.find();
  res.status(200).json({ success: true, products });
});