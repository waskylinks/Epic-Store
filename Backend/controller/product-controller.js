import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import { deleteMultipleFromCloudinary } from '../utils/cloudinaryUpload.js';
import { deleteCachePattern, getCache, setCache } from '../utils/redis.js';
import seoService from '../Services/seo.service.js';
import { RESERVED_SLUGS } from '../utils/reserved-slugs.js';
import { slugify } from '../utils/slugify.js';
import {
  parseProductBody,
  uploadProductImages,
  buildProductData,
  buildProductUpdateData,
  buildSeoForUpdate,
  resolveUpdateImages,
  deriveInventoryStatus,
  handleDuplicateKeyError,
} from '../utils/productController.js';

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
      deleteCachePattern('category_performance*'),
      deleteCachePattern('sitemap*'),
      deleteCachePattern('product_*_seo'),
      deleteCachePattern('product_*_structured')
    ]);
  } catch {
    // Cache invalidation failure must not affect the primary response.
  }
};

const calcRating = (reviews) =>
  reviews.length === 0
    ? 0
    : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;

const withProductPopulate = (query) =>
  query
    .populate('relatedProducts', 'name pricing images slug ratings')
    .populate('crossSells', 'name pricing images slug')
    .populate('upsells', 'name pricing images slug');

    const ADMIN_LIST_SELECT = [
  'name',
  'slug',
  'brand',
  'category',
  'status',
  'pricing',
  'images',           // only isPrimary + url + alt are used — but lean keeps it small
  'inventory.stock',
  'inventory.sku',
  'inventory.status',
  'inventory.lowStockThreshold',
  'ratings',
  'numOfReviews',
  'isFeatured',
  'isBestseller',
  'isNewArrival',
  'isOnSale',
  'createdAt',
].join(' ');


const SORT_MAP = {
  createdAt_desc:           { createdAt: -1 },
  createdAt_asc:            { createdAt:  1 },
  name_asc:                 { name:  1 },
  name_desc:                { name: -1 },
  'pricing.regular_asc':    { 'pricing.regular':  1 },
  'pricing.regular_desc':   { 'pricing.regular': -1 },
  ratings_desc:             { ratings: -1 },
  'inventory.stock_asc':    { 'inventory.stock':  1 },
};


const VALID_STATUSES   = new Set(['draft', 'published', 'archived']);
const VALID_INV_STATUS = new Set(['InStock', 'LowStock', 'OutOfStock', 'Discontinued']);
const VALID_CATEGORIES = new Set([
  'Electronics', 'Clothing & Apparel', 'Home & Living',
  'Sports & Outdoors', 'Beauty & Personal Care', 'Books & Media', 'Food & Beverages'
]);

// ── Cache TTL config ─────────────────────────────────────────────────────────
// Short TTL because admins expect near-real-time data.
// Set to 0 to disable caching entirely (e.g. during heavy write periods).
const ADMIN_PRODUCTS_CACHE_TTL = 30; // seconds

// ── Build a deterministic cache key from the request params ─────────────────
const buildCacheKey = (query) => {
  const { page = 1, limit = 20, search = '', status = '', inventoryStatus = '', category = '', sort = 'createdAt_desc' } = query;
  return `admin_products_list:p${page}:l${limit}:s${encodeURIComponent(search)}:st${status}:inv${inventoryStatus}:cat${encodeURIComponent(category)}:srt${sort}`;
};

const STATS_CACHE_KEY = 'admin_products_stats';
const STATS_CACHE_TTL = 60; // seconds — slightly longer, counts change less often


// ============================================
// GET ALL PRODUCTS
// ============================================

export const getAllProducts = handleAsyncError(async (req, res, next) => {
  const resultPerPage = 4;

  const apiFeatures = new APIFunctionality(
    Product.find({ status: 'published', 'seo.noIndex': false }),
    req.query
  ).search().filter();

  const filteredQuery = apiFeatures.query.clone();
  const productsCount = await filteredQuery.countDocuments();
  const totalPages    = Math.ceil(productsCount / resultPerPage);

  const page = Number(req.query.page) || 1;
  if (page > totalPages && productsCount > 0) {
    return next(new HandleError('Page not found', 404));
  }

  apiFeatures.pagination(resultPerPage);
  const products = await apiFeatures.query;

  if (!products || products.length === 0) {
    return next(new HandleError('No products found', 404));
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

export const createProducts = handleAsyncError(async (req, res, next) => {
  let uploadedImages = [];

  try {
    if (!req.body.name || !req.body.description || !req.body.category) {
      return next(new HandleError('Name, description, and category are required', 400));
    }

    let parsed;
    try {
      parsed = parseProductBody(req.body);
    } catch (parseError) {
      return next(new HandleError(parseError.message, 400));
    }

    const prospectiveSlug = slugify(req.body.name);
    if (RESERVED_SLUGS.has(prospectiveSlug)) {
      return next(new HandleError(
        `Product name "${req.body.name}" generates a reserved URL slug ("${prospectiveSlug}"). ` +
        `Please choose a different name.`,
        400
      ));
    }

    if (req.files && req.files.length > 0) {
      uploadedImages = await uploadProductImages(req.files, parsed.imageMetadata, 0);
    }

    const productData = buildProductData(req, parsed, uploadedImages, req.user._id);
    const product     = await Product.create(productData);

    invalidateProductCaches().catch((err) => console.error('Cache invalidation error:', err));
    res.status(201).json({ success: true, product });
  } catch (error) {
    if (uploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(uploadedImages.map(img => img.public_id)).catch(() => {});
    }
    if (handleDuplicateKeyError(error, next)) return;
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return next(new HandleError(errors.join(', '), 400));
    }
    throw error;
  }
});

// ============================================
// UPDATE PRODUCT
// ============================================
//
// Uses findByIdAndUpdate (bypasses pre-save hooks intentionally).
// All logic the pre-save hooks would compute is calculated
// explicitly via utils before the update call.
//
// ============================================

export const updateProduct = handleAsyncError(async (req, res, next) => {
  let newlyUploadedImages = [];

  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) return next(new HandleError('Product not found', 404));

    if (!req.body.name || !req.body.description || !req.body.category) {
      return next(new HandleError('Name, description, and category are required', 400));
    }

    let parsed;
    try {
      parsed = parseProductBody(req.body);
    } catch (parseError) {
      return next(new HandleError(parseError.message, 400));
    }

    const newSlug = slugify(req.body.name);
    if (newSlug !== product.slug && RESERVED_SLUGS.has(newSlug)) {
      return next(new HandleError(
        `Product name "${req.body.name}" generates a reserved URL slug ("${newSlug}"). ` +
        `Please choose a different name.`,
        400
      ));
    }

    // ── Compute what pre-save hooks would have done ──────────────────────

    // 1. Slug
    const slugChanged = newSlug !== product.slug;
    const updatedSlug = slugChanged ? newSlug : product.slug;
    const slugHistory = slugChanged && product.slug
      ? [...(product.slugHistory || []), { oldSlug: product.slug, changedAt: new Date() }]
      : product.slugHistory || [];

    // 2. Inventory status
    const mergedInventory  = {
      ...(product.inventory.toObject?.() ?? product.inventory),
      ...(parsed.inventory || {})
    };
    const inventoryStatus  = deriveInventoryStatus(mergedInventory, mergedInventory?.status);
    mergedInventory.status  = inventoryStatus;

    // 3. isOnSale
    const finalPricing = parsed.pricing || product.pricing;
    const isOnSale     = !!(finalPricing?.sale != null && finalPricing.sale < finalPricing.regular);

    // 4. SEO
    const resolvedSeo = buildSeoForUpdate(parsed.seo, product.seo, req.body.name, inventoryStatus);

    // 5. Status transition timestamps
    const newStatus   = req.body.status || product.status;
    const publishedAt = newStatus === 'published' && !product.publishedAt ? new Date() : product.publishedAt;
    const archivedAt  = newStatus === 'archived'  && !product.archivedAt  ? new Date() : product.archivedAt;

    // ── Images ───────────────────────────────────────────────────────────

    const { currentImages, newlyUploaded, imagesToDelete } =
      await resolveUpdateImages(req, product, parsed.imageMetadata);
    newlyUploadedImages = newlyUploaded;

    // Auto-fill ogImage from images if still blank
    if (!resolvedSeo.ogImage && currentImages.length > 0) {
      const primary        = currentImages.find(img => img.isPrimary) || currentImages[0];
      resolvedSeo.ogImage  = primary.url;
    }

    // ── Build update document ─────────────────────────────────────────────

    const updateData = buildProductUpdateData(req, parsed, product, {
      updatedSlug,
      slugHistory,
      mergedInventory,
      isOnSale,
      resolvedSeo,
      currentImages,
      newStatus,
      publishedAt,
      archivedAt,
      userId: req.user._id,
    });

    const updated = await Product.findByIdAndUpdate(id, updateData, {
      new:           true,
      runValidators: false,
    });

    // Clean up removed Cloudinary images after successful DB write
    if (imagesToDelete.length > 0) {
      await deleteMultipleFromCloudinary(imagesToDelete).catch(() => {});
    }

    invalidateProductCaches().catch((err) => console.error('Cache invalidation error:', err));
    res.status(200).json({ success: true, product: updated });
  } catch (error) {
    if (newlyUploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(newlyUploadedImages.map(img => img.public_id)).catch(() => {});
    }
    if (handleDuplicateKeyError(error, next)) return;
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return next(new HandleError(errors.join(', '), 400));
    }
    throw error;
  }
});

// ============================================
// DELETE PRODUCT
// ============================================

export const deleteProduct = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new HandleError('Product not found', 404));

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
      id:            product._id,
      name:          product.name,
      imagesDeleted: product.images?.length || 0
    }
  });
});

// ============================================
// BATCH DELETE PRODUCTS
// ============================================
//
// Strategy:
//   1. Single find() for all products — one DB round-trip
//   2. Single deleteMany to remove all found products
//   3. Response sent immediately
//   4. Cloudinary cleanup fires after response (fire-and-forget)
//
// ============================================

export const deleteMultipleProducts = handleAsyncError(async (req, res, next) => {
  const { productIds } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return next(new HandleError('Please provide an array of product IDs', 400));
  }

  if (productIds.length > 100) {
    return next(new HandleError('Cannot delete more than 100 products at once', 400));
  }

  // ── Step 1: Single query instead of N findById calls ──────────────────
  const products = await Product.find(
    { _id: { $in: productIds } },
    { _id: 1, name: 1, 'images.public_id': 1 }
  ).lean();

  const foundIds  = new Set(products.map(p => p._id.toString()));
  const results   = { successful: [], failed: [] };

  // Mark any IDs that weren't found
  productIds.forEach(id => {
    if (!foundIds.has(id.toString())) {
      results.failed.push({ id, reason: 'Product not found' });
    }
  });

  // ── Step 2: Delete all found products in one round-trip ───────────────
  if (products.length > 0) {
    try {
      await Product.deleteMany({ _id: { $in: products.map(p => p._id) } });
      products.forEach(p => results.successful.push({ id: p._id, name: p.name }));
    } catch (err) {
      products.forEach(p => results.failed.push({ id: p._id, name: p.name, reason: err.message }));
    }
  }

  // ── Step 3: Respond immediately ───────────────────────────────────────
  invalidateProductCaches().catch(() => {});

  res.status(200).json({
    success: true,
    message: `Deleted ${results.successful.length}/${productIds.length} products`,
    results,
  });

  // ── Step 4: Cloudinary cleanup after response ─────────────────────────
  const allPublicIds = products
    .filter(p => results.successful.some(s => s.id.toString() === p._id.toString()))
    .flatMap(p => (p.images || []).map(img => img.public_id).filter(Boolean));

  if (allPublicIds.length > 0) {
    deleteMultipleFromCloudinary(allPublicIds).catch((err) => {
      console.error('Batch delete — Cloudinary cleanup failed:', err.message);
    });
  }
});

// ============================================
// GET SINGLE PRODUCT DETAILS (ADMIN ONLY)
// ============================================

export const getProductDetails = handleAsyncError(async (req, res, next) => {
  const product = await withProductPopulate(Product.findById(req.params.id));
  if (!product) return next(new HandleError('Product not found', 404));
  res.status(200).json({ success: true, product });
});

// ============================================
// CREATE / UPDATE PRODUCT REVIEW
// ============================================

export const createProductReview = handleAsyncError(async (req, res, next) => {
  const { rating, comment, productID, reviewTitle, pros, cons } = req.body;

  const review = {
    user:        req.user._id,
    name:        req.user.name,
    rating:      Number(rating),
    comment,
    verified:    false,
    reviewTitle: reviewTitle || '',
    pros:        Array.isArray(pros) ? pros : [],
    cons:        Array.isArray(cons) ? cons : []
  };

  const product = await Product.findById(productID);
  if (!product) return next(new HandleError('Product not found', 404));

  const reviewExists = product.reviews.find(
    r => r.user.toString() === req.user._id.toString()
  );

  if (reviewExists) {
    product.reviews.forEach(r => {
      if (r.user.toString() === req.user._id.toString()) {
        r.rating      = Number(rating);
        r.comment     = comment;
        r.reviewTitle = reviewTitle || '';
        r.pros        = Array.isArray(pros) ? pros : [];
        r.cons        = Array.isArray(cons) ? cons : [];
      }
    });
  } else {
    product.reviews.push(review);
    product.numOfReviews = product.reviews.length;
  }

  product.ratings = calcRating(product.reviews);

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

  await Product.findByIdAndUpdate(
    req.query.productID,
    { reviews, ratings: calcRating(reviews), numOfReviews: reviews.length },
    { new: true, runValidators: true }
  );

  res.status(200).json({ success: true, message: 'Review deleted successfully' });
});



// ============================================
// ADMIN — GET ALL PRODUCTS (OPTIMIZED)
// ============================================

export const getAdminProducts = handleAsyncError(async (req, res, next) => {
  const page  = Math.max(Number(req.query.page)  || 1,  1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const skip  = (page - 1) * limit;

  // ── Try cache first ──────────────────────────────────────────────────────
  const cacheKey = buildCacheKey(req.query);
  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, fromCache: true });
    }
  } catch {
    // Cache miss / Redis unavailable — continue to DB
  }

  // ── Build filter ─────────────────────────────────────────────────────────
  const filter = {};

  const search = req.query.search?.trim();
  if (search) filter.$text = { $search: search };

  const { status, inventoryStatus, category } = req.query;
  if (status          && VALID_STATUSES.has(status))            filter.status              = status;
  if (inventoryStatus && VALID_INV_STATUS.has(inventoryStatus)) filter['inventory.status'] = inventoryStatus;
  if (category        && VALID_CATEGORIES.has(category))        filter.category            = category;

  const sort = SORT_MAP[req.query.sort] || SORT_MAP.createdAt_desc;

  // ── Query DB ─────────────────────────────────────────────────────────────
  // .lean() returns plain JS objects instead of Mongoose documents → ~3× faster,
  // much less memory. Safe here because we're only reading, not calling methods.
  const [products, total] = await Promise.all([
    Product
      .find(filter)
      .select(ADMIN_LIST_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  const payload = {
    success:       true,
    products,
    total,
    totalPages:    Math.ceil(total / limit),
    currentPage:   page,
    resultPerPage: limit,
  };

  // ── Populate cache (fire-and-forget) ─────────────────────────────────────
  // Only cache unfiltered/simple queries; skip text-search results (they're
  // rarely repeated and the TTL is short anyway, so caching everything is fine).
  try {
    await setCache(cacheKey, payload, ADMIN_PRODUCTS_CACHE_TTL);
  } catch {
    // Redis write failure must never break the response
  }

  res.status(200).json(payload);
});

// ============================================
// ADMIN — GET PRODUCT STATS 
// ============================================

export const getAdminProductStats = handleAsyncError(async (req, res) => {
  // ── Try cache ─────────────────────────────────────────────────────────────
  try {
    const cached = await getCache(STATS_CACHE_KEY);
    if (cached) return res.status(200).json({ ...cached, fromCache: true });
  } catch { /* continue */ }

  // ── Single aggregation — one round-trip for all counts ────────────────────
  const [result] = await Product.aggregate([
    {
      $facet: {
        total:        [{ $count: 'n' }],
        published:    [{ $match: { status: 'published' }    }, { $count: 'n' }],
        draft:        [{ $match: { status: 'draft' }        }, { $count: 'n' }],
        archived:     [{ $match: { status: 'archived' }     }, { $count: 'n' }],
        inStock:      [{ $match: { 'inventory.status': 'InStock' }      }, { $count: 'n' }],
        lowStock:     [{ $match: { 'inventory.status': 'LowStock' }     }, { $count: 'n' }],
        outOfStock:   [{ $match: { 'inventory.status': 'OutOfStock' }   }, { $count: 'n' }],
        discontinued: [{ $match: { 'inventory.status': 'Discontinued' } }, { $count: 'n' }],
        featured:     [{ $match: { isFeatured: true }    }, { $count: 'n' }],
        onSale:       [{ $match: { isOnSale: true }      }, { $count: 'n' }],
        bestseller:   [{ $match: { isBestseller: true }  }, { $count: 'n' }],
        newArrival:   [{ $match: { isNewArrival: true }  }, { $count: 'n' }],
      },
    },
  ]);

  // $facet returns arrays; extract the first element's count (or 0)
  const extract = (arr) => arr?.[0]?.n ?? 0;

  const stats = {
    total:        extract(result.total),
    published:    extract(result.published),
    draft:        extract(result.draft),
    archived:     extract(result.archived),
    inStock:      extract(result.inStock),
    lowStock:     extract(result.lowStock),
    outOfStock:   extract(result.outOfStock),
    discontinued: extract(result.discontinued),
    featured:     extract(result.featured),
    onSale:       extract(result.onSale),
    bestseller:   extract(result.bestseller),
    newArrival:   extract(result.newArrival),
  };

  const payload = { success: true, stats };

  try {
    await setCache(STATS_CACHE_KEY, payload, STATS_CACHE_TTL);
  } catch { /* continue */ }

  res.status(200).json(payload);
});

// ============================================
// GET PRODUCT BY SLUG (SEO-FRIENDLY PUBLIC ROUTE)
// ============================================

export const getProductBySlug = handleAsyncError(async (req, res, next) => {
  const { slug } = req.params;

  const product = await withProductPopulate(
    Product.findOne({ slug, status: 'published' })
  );

  if (!product) return next(new HandleError('Product not found', 404));

  const seoData = {
    metaTags:       seoService.generateMetaTags(product),
    structuredData: seoService.generateStructuredData(product),
    breadcrumbs:    seoService.generateBreadcrumbs(product)
  };

  res.status(200).json({ success: true, product, seo: seoData });
});

// ============================================
// GET STRUCTURED DATA FOR SEO (ADMIN ONLY)
// ============================================

export const getProductStructuredData = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new HandleError('Product not found', 404));

  const structuredData = product.getStructuredData();
  res.status(200).json({ success: true, structuredData });
});