import Product from '../models/product-model.js';
import HandleError from '../utils/handleError.js';
import handleAsyncError from '../middleware/handleAsyncError.js';
import APIFunctionality from '../utils/apiFunctionality.js';
import {
  uploadToCloudinary,
  deleteMultipleFromCloudinary
} from '../utils/cloudinaryUpload.js';
import { deleteCachePattern } from '../utils/redis.js';
import seoService from '../Services/seo.service.js';
import { RESERVED_SLUGS } from '../utils/reserved-slugs.js';
import { slugify } from '../utils/slugify.js';

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

// FIX #1 — Shared rating helper: eliminates the Math.ceil vs toFixed(1)
// inconsistency between createProductReview and deleteReview.
const calcRating = (reviews) =>
  reviews.length === 0
    ? 0
    : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;

// FIX #4 — Shared populate chain: getProductDetails and getProductBySlug
// previously duplicated the same three .populate() calls. One change here
// now covers both controllers.
const withProductPopulate = (query) =>
  query
    .populate('relatedProducts', 'name pricing images slug ratings')
    .populate('crossSells', 'name pricing images slug')
    .populate('upsells', 'name pricing images slug');

const parseJSONSafe = (field) => {
  if (!field) return null;
  if (typeof field === 'object') return field;
  try {
    return JSON.parse(field);
  } catch {
    return null;
  }
};

const parsePricing = (pricingData) => {
  const pricing = parseJSONSafe(pricingData);
  if (!pricing) return null;

  if (pricing.validFrom && pricing.validThrough) {
    const from = new Date(pricing.validFrom);
    const through = new Date(pricing.validThrough);
    if (from > through) {
      throw new Error('Pricing validFrom date must be before validThrough date');
    }
  }

  return pricing;
};

const parseBreadcrumbs = (breadcrumbsData) => {
  const breadcrumbs = parseJSONSafe(breadcrumbsData);
  if (!Array.isArray(breadcrumbs)) return [];

  const positions = breadcrumbs.map(b => b.position);
  const uniquePositions = new Set(positions);
  if (positions.length !== uniquePositions.size) {
    throw new Error('Breadcrumb positions must be unique');
  }

  return breadcrumbs.sort((a, b) => a.position - b.position);
};

const parseRichSnippets = (richSnippetsData) => {
  const richSnippets = parseJSONSafe(richSnippetsData);
  if (!richSnippets) return {};

  if (richSnippets.faqs && Array.isArray(richSnippets.faqs)) {
    const questions = richSnippets.faqs.map(faq => faq.question?.toLowerCase());
    const uniqueQuestions = new Set(questions);
    if (questions.length !== uniqueQuestions.size) {
      throw new Error('FAQ questions must be unique');
    }
  }

  return richSnippets;
};

// FIX #2 — parseSEO is now a pure parser. The og/twitter fallback
// assignments were dead code: the controller's own seo block immediately
// overwrote seo.ogTitle etc. with `seo?.ogTitle || ''`, so any value
// parseSEO wrote was silently discarded. Fallbacks now live only in the
// controller seo block, in one place.
const parseSEO = (seoData) => {
  const seo = parseJSONSafe(seoData);
  if (!seo) return {};

  if (seo.metaDescription && seo.metaDescription.length < 120) {
    console.warn('SEO metaDescription is shorter than recommended 120 characters');
  }

  return seo;
};

const parseImageMetadata = (imageMetadataData) => {
  const metadata = parseJSONSafe(imageMetadataData);
  if (!metadata || !Array.isArray(metadata)) return [];
  return metadata;
};

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
  const totalPages = Math.ceil(productsCount / resultPerPage);

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

    let pricing, breadcrumbs, richSnippets, seo;
    try {
      pricing      = parsePricing(req.body.pricing);
      breadcrumbs  = parseBreadcrumbs(req.body.breadcrumbs);
      richSnippets = parseRichSnippets(req.body.richSnippets);
      seo          = parseSEO(req.body.seo);
    } catch (parseError) {
      return next(new HandleError(parseError.message, 400));
    }

    const inventory      = parseJSONSafe(req.body.inventory);
    const subcategories  = parseJSONSafe(req.body.subcategories);
    const tags           = parseJSONSafe(req.body.tags);
    const specifications = parseJSONSafe(req.body.specifications);
    const variants       = parseJSONSafe(req.body.variants);
    const dimensions     = parseJSONSafe(req.body.dimensions);
    const weight         = parseJSONSafe(req.body.weight);
    const imageMetadata  = parseImageMetadata(req.body.imageMetadata);

    // FIX #3 — Compare slugified form, not raw name string. Raw comparison
    // misses case/trim differences: "  Trending  " !== "trending" as strings
    // but slugify() produces "trending" for both, which is reserved.
    const prospectiveSlug = slugify(req.body.name);
    if (RESERVED_SLUGS.has(prospectiveSlug)) {
      return next(new HandleError(
        `Product name "${req.body.name}" generates a reserved URL slug ("${prospectiveSlug}"). ` +
        `Please choose a different name.`,
        400
      ));
    }

    const productData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription || '',
      category: req.body.category,
      brand: req.body.brand || '',
      manufacturer: req.body.manufacturer || '',
      pricing: pricing || {},
      inventory: inventory || {},
      subcategories: Array.isArray(subcategories) ? subcategories : [],
      tags: Array.isArray(tags) ? tags : [],
      specifications: Array.isArray(specifications) ? specifications : [],
      variants: Array.isArray(variants) ? variants : [],
      dimensions: dimensions || {},
      weight: weight || {},
      breadcrumbs: breadcrumbs || [],
      seo: {
        metaTitle: seo?.metaTitle || '',
        metaDescription: seo?.metaDescription || '',
        keywords: Array.isArray(seo?.keywords) ? seo.keywords : [],
        canonicalUrl: '',
        noIndex: seo?.noIndex === true || seo?.noIndex === 'true',
        noFollow: seo?.noFollow === true || seo?.noFollow === 'true',
        // FIX #2 — og/twitter fallbacks live here only, not also in parseSEO.
        ogTitle: seo?.ogTitle || seo?.metaTitle || '',
        ogDescription: seo?.ogDescription || seo?.metaDescription || '',
        ogImage: seo?.ogImage || '',
        ogType: seo?.ogType || 'product',
        twitterCard: seo?.twitterCard || 'summary_large_image',
        twitterTitle: seo?.twitterTitle || seo?.ogTitle || seo?.metaTitle || '',
        twitterDescription: seo?.twitterDescription || seo?.ogDescription || seo?.metaDescription || '',
        twitterImage: seo?.twitterImage || '',
        schemaType: seo?.schemaType || 'Product',
        condition: seo?.condition || 'NewCondition',
        availability: seo?.availability || 'InStock',
        focusKeyphrase: seo?.focusKeyphrase || '',
        relatedSearchTerms: Array.isArray(seo?.relatedSearchTerms) ? seo.relatedSearchTerms : []
      },
      richSnippets: {
        faqs: Array.isArray(richSnippets?.faqs) ? richSnippets.faqs : [],
        howTo: richSnippets?.howTo || { name: '', steps: [] },
        videos: Array.isArray(richSnippets?.videos) ? richSnippets.videos : []
      },
      isFeatured:   req.body.isFeatured   === 'true' || req.body.isFeatured   === true,
      isNewArrival: req.body.isNewArrival === 'true' || req.body.isNewArrival === true,
      isBestseller: req.body.isBestseller === 'true' || req.body.isBestseller === true,
      status: req.body.status || 'published',
      user: req.user._id,
      analytics: {
        views: 0, purchases: 0, addedToCart: 0, addedToWishlist: 0,
        conversions: 0, searchImpressions: 0, searchClicks: 0,
        avgTimeOnPage: 0, bounceRate: 0
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
          const metadata = imageMetadata[i] || {};
          imagesLinks.push({
            public_id: result.public_id,
            url: result.secure_url,
            alt: metadata.alt || '',
            isPrimary: i === 0,
            order: i,
            width: result.width || metadata.width || null,
            height: result.height || metadata.height || null,
            caption: metadata.caption || ''
          });
        } catch (uploadError) {
          if (imagesLinks.length > 0) {
            await deleteMultipleFromCloudinary(imagesLinks.map(img => img.public_id));
          }
          return next(new HandleError(`Failed to upload image ${i + 1}: ${uploadError.message}`, 500));
        }
      }
      productData.images = imagesLinks;
      uploadedImages = imagesLinks;
    }

    const product = await Product.create(productData);
    await invalidateProductCaches();

    res.status(201).json({ success: true, product });
  } catch (error) {
    if (uploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(uploadedImages.map(img => img.public_id)).catch(() => {});
    }
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

export const updateProduct = handleAsyncError(async (req, res, next) => {
  let newlyUploadedImages = [];

  try {
    const { id } = req.params;
    let product = await Product.findById(id);
    if (!product) return next(new HandleError('Product not found', 404));

    if (!req.body.name || !req.body.description || !req.body.category) {
      return next(new HandleError('Name, description, and category are required', 400));
    }

    let pricing, breadcrumbs, richSnippets, seo;
    try {
      pricing      = parsePricing(req.body.pricing);
      breadcrumbs  = parseBreadcrumbs(req.body.breadcrumbs);
      richSnippets = parseRichSnippets(req.body.richSnippets);
      seo          = parseSEO(req.body.seo);
    } catch (parseError) {
      return next(new HandleError(parseError.message, 400));
    }

    // FIX #3 — Compare the slugified new name against the existing product
    // slug, not raw name strings. "  Trending  " !== "trending" as strings,
    // but both produce the reserved slug "trending" after slugify().
    const newSlug = slugify(req.body.name);
    if (newSlug !== product.slug) {
      if (RESERVED_SLUGS.has(newSlug)) {
        return next(new HandleError(
          `Product name "${req.body.name}" generates a reserved URL slug ("${newSlug}"). ` +
          `Please choose a different name.`,
          400
        ));
      }
    }

    const inventory      = parseJSONSafe(req.body.inventory);
    const subcategories  = parseJSONSafe(req.body.subcategories);
    const tags           = parseJSONSafe(req.body.tags);
    const specifications = parseJSONSafe(req.body.specifications);
    const variants       = parseJSONSafe(req.body.variants);
    const dimensions     = parseJSONSafe(req.body.dimensions);
    const weight         = parseJSONSafe(req.body.weight);
    const imageMetadata  = parseImageMetadata(req.body.imageMetadata);

    const updateData = {
      name: req.body.name,
      description: req.body.description,
      shortDescription: req.body.shortDescription || '',
      category: req.body.category,
      brand: req.body.brand || '',
      manufacturer: req.body.manufacturer || product.manufacturer || '',
      pricing: pricing || product.pricing || {},
      inventory: inventory || product.inventory || {},
      subcategories: Array.isArray(subcategories) ? subcategories : product.subcategories || [],
      tags: Array.isArray(tags) ? tags : product.tags || [],
      specifications: Array.isArray(specifications) ? specifications : product.specifications || [],
      variants: Array.isArray(variants) ? variants : product.variants || [],
      dimensions: dimensions || product.dimensions || {},
      weight: weight || product.weight || {},
      breadcrumbs: breadcrumbs || product.breadcrumbs || [],
      seo: {
        metaTitle: seo?.metaTitle || product.seo?.metaTitle || '',
        metaDescription: seo?.metaDescription || product.seo?.metaDescription || '',
        keywords: Array.isArray(seo?.keywords) ? seo.keywords : product.seo?.keywords || [],
        canonicalUrl: '',
        noIndex:  seo?.noIndex  !== undefined ? (seo.noIndex  === true || seo.noIndex  === 'true') : product.seo?.noIndex  || false,
        noFollow: seo?.noFollow !== undefined ? (seo.noFollow === true || seo.noFollow === 'true') : product.seo?.noFollow || false,
        // FIX #2 — og/twitter fallbacks in one place only.
        ogTitle: seo?.ogTitle || product.seo?.ogTitle || seo?.metaTitle || product.seo?.metaTitle || '',
        ogDescription: seo?.ogDescription || product.seo?.ogDescription || seo?.metaDescription || product.seo?.metaDescription || '',
        ogImage: seo?.ogImage || product.seo?.ogImage || '',
        ogType: seo?.ogType || product.seo?.ogType || 'product',
        twitterCard: seo?.twitterCard || product.seo?.twitterCard || 'summary_large_image',
        twitterTitle: seo?.twitterTitle || product.seo?.twitterTitle || seo?.ogTitle || product.seo?.ogTitle || '',
        twitterDescription: seo?.twitterDescription || product.seo?.twitterDescription || seo?.ogDescription || product.seo?.ogDescription || '',
        twitterImage: seo?.twitterImage || product.seo?.twitterImage || '',
        schemaType: seo?.schemaType || product.seo?.schemaType || 'Product',
        condition: seo?.condition || product.seo?.condition || 'NewCondition',
        availability: seo?.availability || product.seo?.availability || 'InStock',
        focusKeyphrase: seo?.focusKeyphrase || product.seo?.focusKeyphrase || '',
        relatedSearchTerms: Array.isArray(seo?.relatedSearchTerms) ? seo.relatedSearchTerms : product.seo?.relatedSearchTerms || []
      },
      richSnippets: {
        faqs: Array.isArray(richSnippets?.faqs) ? richSnippets.faqs : product.richSnippets?.faqs || [],
        howTo: richSnippets?.howTo || product.richSnippets?.howTo || { name: '', steps: [] },
        videos: Array.isArray(richSnippets?.videos) ? richSnippets.videos : product.richSnippets?.videos || []
      },
      isFeatured:   req.body.isFeatured   !== undefined ? (req.body.isFeatured   === 'true' || req.body.isFeatured   === true) : product.isFeatured,
      isNewArrival: req.body.isNewArrival !== undefined ? (req.body.isNewArrival === 'true' || req.body.isNewArrival === true) : product.isNewArrival,
      isBestseller: req.body.isBestseller !== undefined ? (req.body.isBestseller === 'true' || req.body.isBestseller === true) : product.isBestseller,
      status: req.body.status || product.status,
      lastModifiedBy: req.user._id
    };

    const imagesToDelete = parseJSONSafe(req.body.imagesToDelete) || [];
    if (imagesToDelete.length > 0) {
      product.images = product.images.filter(img => !imagesToDelete.includes(img.public_id));
    }

    const existingImages = parseJSONSafe(req.body.existingImages);
    const currentImages  = existingImages || product.images;

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
          const metadata = imageMetadata[i] || {};
          imagesLinks.push({
            public_id: result.public_id,
            url: result.secure_url,
            alt: metadata.alt || '',
            isPrimary: false,
            order: currentImages.length + i,
            width: result.width || metadata.width || null,
            height: result.height || metadata.height || null,
            caption: metadata.caption || ''
          });
        } catch (uploadError) {
          if (imagesLinks.length > 0) {
            await deleteMultipleFromCloudinary(imagesLinks.map(img => img.public_id));
          }
          return next(new HandleError(`Failed to upload image ${i + 1}: ${uploadError.message}`, 500));
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

    if (imagesToDelete.length > 0) {
      await deleteMultipleFromCloudinary(imagesToDelete).catch(() => {});
    }

    await invalidateProductCaches();
    res.status(200).json({ success: true, product });
  } catch (error) {
    if (newlyUploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(newlyUploadedImages.map(img => img.public_id)).catch(() => {});
    }
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
// GET SINGLE PRODUCT DETAILS (ADMIN ONLY)
// ============================================

export const getProductDetails = handleAsyncError(async (req, res, next) => {
  // FIX #4 — Uses shared withProductPopulate helper instead of duplicating
  // the three .populate() calls that also exist in getProductBySlug.
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
    user: req.user._id,
    name: req.user.name,
    rating: Number(rating),
    comment,
    verified: false,
    reviewTitle: reviewTitle || '',
    pros: Array.isArray(pros) ? pros : [],
    cons: Array.isArray(cons) ? cons : []
  };

  const product = await Product.findById(productID);
  if (!product) return next(new HandleError('Product not found', 404));

  const reviewExists = product.reviews.find(
    r => r.user.toString() === req.user._id.toString()
  );

  if (reviewExists) {
    product.reviews.forEach(r => {
      if (r.user.toString() === req.user._id.toString()) {
        r.rating = Number(rating);
        r.comment = comment;
        r.reviewTitle = reviewTitle || '';
        r.pros = Array.isArray(pros) ? pros : [];
        r.cons = Array.isArray(cons) ? cons : [];
      }
    });
  } else {
    product.reviews.push(review);
    product.numOfReviews = product.reviews.length;
  }

  // FIX #1 — Use shared calcRating helper; was Math.ceil() here vs
  // toFixed(1) in deleteReview, causing different rounding on the same field.
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

  // FIX #1 — Use shared calcRating helper; was Number().toFixed(1) here
  // vs Math.ceil() in createProductReview, writing inconsistent values.
  await Product.findByIdAndUpdate(
    req.query.productID,
    { reviews, ratings: calcRating(reviews), numOfReviews: reviews.length },
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

// ============================================
// GET PRODUCT BY SLUG (SEO-FRIENDLY PUBLIC ROUTE)
// ============================================

export const getProductBySlug = handleAsyncError(async (req, res, next) => {
  const { slug } = req.params;

  // FIX #4 — Uses shared withProductPopulate helper.
  const product = await withProductPopulate(
    Product.findOne({ slug, status: 'published' })
  );

  if (!product) {
    // FIX #9 — Slug history lookup removed from this controller entirely.
    // redirectHandler middleware (mounted after routes) performs the single
    // authoritative slug-history DB query and issues the 301. Having it
    // here too meant two DB queries for every renamed-product 404, and two
    // different response shapes for the same redirect.
    return next(new HandleError('Product not found', 404));
  }

  const seoData = {
    metaTags: seoService.generateMetaTags(product),
    structuredData: seoService.generateStructuredData(product),
    breadcrumbs: seoService.generateBreadcrumbs(product)
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