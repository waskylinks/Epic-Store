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
    // Cache invalidation failure must not affect the primary response.
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

// Parse and validate pricing object
const parsePricing = (pricingData) => {
  const pricing = parseJSONSafe(pricingData);
  if (!pricing) return null;

  // Validate date range if both are provided
  if (pricing.validFrom && pricing.validThrough) {
    const from = new Date(pricing.validFrom);
    const through = new Date(pricing.validThrough);
    
    if (from > through) {
      throw new Error('Pricing validFrom date must be before validThrough date');
    }
  }

  return pricing;
};

// Parse and validate breadcrumbs
const parseBreadcrumbs = (breadcrumbsData) => {
  const breadcrumbs = parseJSONSafe(breadcrumbsData);
  if (!Array.isArray(breadcrumbs)) return [];

  // Validate position uniqueness
  const positions = breadcrumbs.map(b => b.position);
  const uniquePositions = new Set(positions);
  
  if (positions.length !== uniquePositions.size) {
    throw new Error('Breadcrumb positions must be unique');
  }

  // Sort by position
  return breadcrumbs.sort((a, b) => a.position - b.position);
};

// Parse and validate rich snippets
const parseRichSnippets = (richSnippetsData) => {
  const richSnippets = parseJSONSafe(richSnippetsData);
  if (!richSnippets) return {};

  // Validate FAQ questions for duplicates
  if (richSnippets.faqs && Array.isArray(richSnippets.faqs)) {
    const questions = richSnippets.faqs.map(faq => faq.question?.toLowerCase());
    const uniqueQuestions = new Set(questions);
    
    if (questions.length !== uniqueQuestions.size) {
      throw new Error('FAQ questions must be unique');
    }
  }

  return richSnippets;
};

// Parse SEO with validation
const parseSEO = (seoData) => {
  const seo = parseJSONSafe(seoData);
  if (!seo) return {};

  // Remove minlength validation issue - let model handle it with proper message
  // But warn if metaDescription is too short (optional validation)
  if (seo.metaDescription && seo.metaDescription.length < 120) {
    console.warn('SEO metaDescription is shorter than recommended 120 characters');
  }

  // Auto-populate social media fields if not provided
  if (!seo.ogTitle && seo.metaTitle) {
    seo.ogTitle = seo.metaTitle;
  }
  
  if (!seo.ogDescription && seo.metaDescription) {
    seo.ogDescription = seo.metaDescription;
  }
  
  if (!seo.twitterTitle && seo.ogTitle) {
    seo.twitterTitle = seo.ogTitle;
  }
  
  if (!seo.twitterDescription && seo.ogDescription) {
    seo.twitterDescription = seo.ogDescription;
  }

  return seo;
};

// Parse image metadata from client
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
    // Validate required fields
    if (!req.body.name || !req.body.description || !req.body.category) {
      return next(new HandleError('Name, description, and category are required', 400));
    }

    // Parse complex fields with validation (these can throw errors)
    let pricing, breadcrumbs, richSnippets, seo;
    
    try {
      pricing = parsePricing(req.body.pricing);
      breadcrumbs = parseBreadcrumbs(req.body.breadcrumbs);
      richSnippets = parseRichSnippets(req.body.richSnippets);
      seo = parseSEO(req.body.seo);
    } catch (parseError) {
      // Handle parsing validation errors (date ranges, duplicates, etc.)
      return next(new HandleError(parseError.message, 400));
    }

    const inventory = parseJSONSafe(req.body.inventory);
    const subcategories = parseJSONSafe(req.body.subcategories);
    const tags = parseJSONSafe(req.body.tags);
    const specifications = parseJSONSafe(req.body.specifications);
    const variants = parseJSONSafe(req.body.variants);
    const dimensions = parseJSONSafe(req.body.dimensions);
    const weight = parseJSONSafe(req.body.weight);
    const imageMetadata = parseImageMetadata(req.body.imageMetadata);

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
        canonicalUrl: seo?.canonicalUrl || '',
        noIndex: seo?.noIndex === true || seo?.noIndex === 'true',
        noFollow: seo?.noFollow === true || seo?.noFollow === 'true',
        ogTitle: seo?.ogTitle || '',
        ogDescription: seo?.ogDescription || '',
        ogImage: seo?.ogImage || '',
        ogType: seo?.ogType || 'product',
        twitterCard: seo?.twitterCard || 'summary_large_image',
        twitterTitle: seo?.twitterTitle || '',
        twitterDescription: seo?.twitterDescription || '',
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
      isFeatured: req.body.isFeatured === 'true' || req.body.isFeatured === true,
      isNewArrival: req.body.isNewArrival === 'true' || req.body.isNewArrival === true,
      isBestseller: req.body.isBestseller === 'true' || req.body.isBestseller === true,
      status: req.body.status || 'published',
      user: req.user._id,
      analytics: {
        views: 0,
        purchases: 0,
        addedToCart: 0,
        addedToWishlist: 0,
        conversions: 0,
        searchImpressions: 0,
        searchClicks: 0,
        avgTimeOnPage: 0,
        bounceRate: 0
      }
    };

    // Handle image uploads with metadata
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

          // Get metadata for this image if provided
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
          // Rollback all uploaded images if any upload fails
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
    // Rollback any Cloudinary uploads before surfacing the error
    if (uploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(
        uploadedImages.map(img => img.public_id)
      ).catch(() => {});
    }
    
    // Pass validation errors clearly to the client
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

    // Validate required fields
    if (!req.body.name || !req.body.description || !req.body.category) {
      return next(new HandleError('Name, description, and category are required', 400));
    }

    // Parse complex fields with validation (these can throw errors)
    let pricing, breadcrumbs, richSnippets, seo;
    
    try {
      pricing = parsePricing(req.body.pricing);
      breadcrumbs = parseBreadcrumbs(req.body.breadcrumbs);
      richSnippets = parseRichSnippets(req.body.richSnippets);
      seo = parseSEO(req.body.seo);
    } catch (parseError) {
      // Handle parsing validation errors (date ranges, duplicates, etc.)
      return next(new HandleError(parseError.message, 400));
    }

    const inventory = parseJSONSafe(req.body.inventory);
    const subcategories = parseJSONSafe(req.body.subcategories);
    const tags = parseJSONSafe(req.body.tags);
    const specifications = parseJSONSafe(req.body.specifications);
    const variants = parseJSONSafe(req.body.variants);
    const dimensions = parseJSONSafe(req.body.dimensions);
    const weight = parseJSONSafe(req.body.weight);
    const imageMetadata = parseImageMetadata(req.body.imageMetadata);

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
        canonicalUrl: seo?.canonicalUrl || product.seo?.canonicalUrl || '',
        noIndex: seo?.noIndex !== undefined ? (seo.noIndex === true || seo.noIndex === 'true') : product.seo?.noIndex || false,
        noFollow: seo?.noFollow !== undefined ? (seo.noFollow === true || seo.noFollow === 'true') : product.seo?.noFollow || false,
        ogTitle: seo?.ogTitle || product.seo?.ogTitle || '',
        ogDescription: seo?.ogDescription || product.seo?.ogDescription || '',
        ogImage: seo?.ogImage || product.seo?.ogImage || '',
        ogType: seo?.ogType || product.seo?.ogType || 'product',
        twitterCard: seo?.twitterCard || product.seo?.twitterCard || 'summary_large_image',
        twitterTitle: seo?.twitterTitle || product.seo?.twitterTitle || '',
        twitterDescription: seo?.twitterDescription || product.seo?.twitterDescription || '',
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
      isFeatured: req.body.isFeatured !== undefined ? (req.body.isFeatured === 'true' || req.body.isFeatured === true) : product.isFeatured,
      isNewArrival: req.body.isNewArrival !== undefined ? (req.body.isNewArrival === 'true' || req.body.isNewArrival === true) : product.isNewArrival,
      isBestseller: req.body.isBestseller !== undefined ? (req.body.isBestseller === 'true' || req.body.isBestseller === true) : product.isBestseller,
      status: req.body.status || product.status,
      lastModifiedBy: req.user._id
    };

    // Handle image deletion — filter before computing currentImages
    const imagesToDelete = parseJSONSafe(req.body.imagesToDelete) || [];
    if (imagesToDelete.length > 0) {
      product.images = product.images.filter(
        img => !imagesToDelete.includes(img.public_id)
      );
    }

    // Get existing images: prefer client's existingImages if provided
    const existingImages = parseJSONSafe(req.body.existingImages);
    const currentImages = existingImages || product.images;

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

          // Get metadata for this image if provided
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
          // Rollback newly uploaded images
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

    // Update the product
    product = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      useFindAndModify: false
    });

    // Delete old images from Cloudinary only after the DB update succeeds
    if (imagesToDelete.length > 0) {
      await deleteMultipleFromCloudinary(imagesToDelete).catch(() => {});
    }

    await invalidateProductCaches();

    res.status(200).json({ success: true, product });
  } catch (error) {
    // Rollback newly uploaded images
    if (newlyUploadedImages.length > 0) {
      await deleteMultipleFromCloudinary(
        newlyUploadedImages.map(img => img.public_id)
      ).catch(() => {});
    }
    
    // Pass validation errors clearly to the client
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
// GET SINGLE PRODUCT DETAILS
// ============================================

export const getProductDetails = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.params.id)
    .populate('relatedProducts', 'name pricing images slug ratings')
    .populate('crossSells', 'name pricing images slug')
    .populate('upsells', 'name pricing images slug');

  if (!product) return next(new HandleError('Product not found', 404));

  // Track view asynchronously — must not delay the response
  product.incrementView().catch(() => {});

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
        r.rating = rating;
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

  const avg = product.reviews.reduce((sum, r) => sum + r.rating, 0);
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

// ============================================
// GET PRODUCT BY SLUG (SEO-FRIENDLY)
// ============================================

export const getProductBySlug = handleAsyncError(async (req, res, next) => {
  const { slug } = req.params;
  
  // First try to find by current slug
  let product = await Product.findOne({ slug, status: 'published' })
    .populate('relatedProducts', 'name pricing images slug ratings')
    .populate('crossSells', 'name pricing images slug')
    .populate('upsells', 'name pricing images slug');

  // If not found, check slug history for 301 redirect
  if (!product) {
    product = await Product.findByOldSlug(slug);
    
    if (product) {
      // Return 301 redirect info
      return res.status(301).json({
        success: true,
        redirect: true,
        newSlug: product.slug,
        newUrl: `/products/${product.slug}`,
        message: 'Product URL has changed. Please use the new URL.'
      });
    }
    
    return next(new HandleError('Product not found', 404));
  }

  // Track view asynchronously
  product.incrementView().catch(() => {});

  res.status(200).json({ success: true, product });
});

// ============================================
// GET STRUCTURED DATA FOR SEO
// ============================================

export const getProductStructuredData = handleAsyncError(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  
  if (!product) {
    return next(new HandleError('Product not found', 404));
  }

  const structuredData = product.getStructuredData();

  res.status(200).json({
    success: true,
    structuredData
  });
});