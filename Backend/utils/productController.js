import HandleError from '../utils/handleError.js';
import {
  uploadToCloudinary,
  deleteMultipleFromCloudinary
} from '../utils/cloudinaryUpload.js';

// ============================================
// JSON PARSERS
// ============================================

export const parseJSONSafe = (field) => {
  if (!field) return null;
  if (typeof field === 'object') return field;
  try {
    return JSON.parse(field);
  } catch {
    return null;
  }
};

export const parsePricing = (pricingData) => {
  const pricing = parseJSONSafe(pricingData);
  if (!pricing) return null;

  if (pricing.validFrom && pricing.validThrough) {
    const from    = new Date(pricing.validFrom);
    const through = new Date(pricing.validThrough);
    if (from > through) {
      throw new Error('Pricing validFrom date must be before validThrough date');
    }
  }

  return pricing;
};

export const parseBreadcrumbs = (breadcrumbsData) => {
  const breadcrumbs = parseJSONSafe(breadcrumbsData);
  if (!Array.isArray(breadcrumbs)) return [];

  const positions       = breadcrumbs.map(b => b.position);
  const uniquePositions = new Set(positions);
  if (positions.length !== uniquePositions.size) {
    throw new Error('Breadcrumb positions must be unique');
  }

  return breadcrumbs.sort((a, b) => a.position - b.position);
};

export const parseRichSnippets = (richSnippetsData) => {
  const richSnippets = parseJSONSafe(richSnippetsData);
  if (!richSnippets) return {};

  if (richSnippets.faqs && Array.isArray(richSnippets.faqs)) {
    const questions       = richSnippets.faqs.map(faq => faq.question?.toLowerCase());
    const uniqueQuestions = new Set(questions);
    if (questions.length !== uniqueQuestions.size) {
      throw new Error('FAQ questions must be unique');
    }
  }

  return richSnippets;
};

export const parseSEO = (seoData) => {
  const seo = parseJSONSafe(seoData);
  if (!seo) return {};

  if (seo.metaDescription && seo.metaDescription.length < 120) {
    console.warn('SEO metaDescription is shorter than recommended 120 characters');
  }

  return seo;
};

export const parseImageMetadata = (imageMetadataData) => {
  const metadata = parseJSONSafe(imageMetadataData);
  if (!metadata || !Array.isArray(metadata)) return [];
  return metadata;
};

// ============================================
// PARSE PRODUCT BODY
// Calls all parsers directly — no injection needed
// since they are colocated in this file.
// Throws on parse errors so callers can catch and return 400.
// ============================================

export const parseProductBody = (body) => ({
  pricing:        parsePricing(body.pricing),
  breadcrumbs:    parseBreadcrumbs(body.breadcrumbs),
  richSnippets:   parseRichSnippets(body.richSnippets),
  seo:            parseSEO(body.seo),
  inventory:      parseJSONSafe(body.inventory),
  subcategories:  parseJSONSafe(body.subcategories),
  tags:           parseJSONSafe(body.tags),
  specifications: parseJSONSafe(body.specifications),
  variants:       parseJSONSafe(body.variants),
  dimensions:     parseJSONSafe(body.dimensions),
  weight:         parseJSONSafe(body.weight),
  imageMetadata:  parseImageMetadata(body.imageMetadata),
});

// ============================================
// UPLOAD PRODUCT IMAGES
// Automatic rollback on failure.
// startOrder shifts the `order` index for updates
// (where existing images already occupy positions 0..n).
// ============================================

export const uploadProductImages = async (files, imageMetadata, startOrder = 0) => {
  const uploaded = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await uploadToCloudinary(files[i].buffer, {
        folder: 'products',
        transformation: [
          { width: 1000, height: 1000, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      });

      const metadata = imageMetadata[i] || {};
      uploaded.push({
        public_id: result.public_id,
        url:       result.secure_url,
        alt:       metadata.alt     || '',
        isPrimary: startOrder === 0 && i === 0,
        order:     startOrder + i,
        width:     result.width     || metadata.width  || null,
        height:    result.height    || metadata.height || null,
        caption:   metadata.caption || ''
      });
    } catch (uploadError) {
      if (uploaded.length > 0) {
        await deleteMultipleFromCloudinary(uploaded.map(img => img.public_id)).catch(() => {});
      }
      throw new HandleError(`Failed to upload image ${i + 1}: ${uploadError.message}`, 500);
    }
  }

  return uploaded;
};

// ============================================
// DERIVE INVENTORY STATUS
// Mirrors the model's pre-save hook so updateProduct
// (which uses findByIdAndUpdate) stays consistent.
// ============================================

export const deriveInventoryStatus = (inventory, existingStatus) => {
  if (existingStatus === 'Discontinued') return 'Discontinued';
  const stock     = Number(inventory?.stock ?? 0);
  const threshold = Number(inventory?.lowStockThreshold ?? 5);
  if (stock === 0)        return 'OutOfStock';
  if (stock <= threshold) return 'LowStock';
  return 'InStock';
};

// ============================================
// INVENTORY → SCHEMA.ORG AVAILABILITY MAP
// Shared by buildSeoForUpdate and updateProduct.
// ============================================

export const inventoryToAvailability = {
  InStock:      'InStock',
  LowStock:     'LimitedAvailability',
  OutOfStock:   'OutOfStock',
  Discontinued: 'Discontinued',
};

// ============================================
// BUILD SEO — CREATE
// ============================================

export const buildSeoForCreate = (seo, productName) => ({
  metaTitle:          seo?.metaTitle          || productName.substring(0, 60),
  metaDescription:    seo?.metaDescription    || '',
  keywords:           Array.isArray(seo?.keywords) ? seo.keywords : [],
  canonicalUrl:       seo?.canonicalUrl        || '',
  noIndex:            seo?.noIndex  === true   || seo?.noIndex  === 'true',
  noFollow:           seo?.noFollow === true   || seo?.noFollow === 'true',
  ogTitle:            seo?.ogTitle            || seo?.metaTitle            || productName.substring(0, 60),
  ogDescription:      seo?.ogDescription      || seo?.metaDescription      || '',
  ogImage:            seo?.ogImage            || '',
  ogType:             seo?.ogType             || 'product',
  twitterCard:        seo?.twitterCard        || 'summary_large_image',
  twitterTitle:       seo?.twitterTitle       || seo?.ogTitle              || seo?.metaTitle            || '',
  twitterDescription: seo?.twitterDescription || seo?.ogDescription        || seo?.metaDescription      || '',
  twitterImage:       seo?.twitterImage       || '',
  schemaType:         seo?.schemaType         || 'Product',
  condition:          seo?.condition          || 'NewCondition',
  availability:       seo?.availability       || 'InStock',
  focusKeyphrase:     seo?.focusKeyphrase     || '',
  relatedSearchTerms: Array.isArray(seo?.relatedSearchTerms) ? seo.relatedSearchTerms : [],
});

// ============================================
// BUILD SEO — UPDATE
// Merges incoming seo fields with the existing document's seo.
// availability is always derived from inventoryStatus — never trusted from client.
// ============================================

export const buildSeoForUpdate = (seo, existingSeo, productName, inventoryStatus) => {
  const resolved = {
    metaTitle:          seo?.metaTitle          || existingSeo?.metaTitle          || productName.substring(0, 60),
    metaDescription:    seo?.metaDescription    || existingSeo?.metaDescription    || '',
    keywords:           Array.isArray(seo?.keywords) ? seo.keywords : existingSeo?.keywords || [],
    canonicalUrl:       seo?.canonicalUrl        || '',
    noIndex:            seo?.noIndex  !== undefined
      ? (seo.noIndex  === true || seo.noIndex  === 'true')
      : existingSeo?.noIndex  || false,
    noFollow:           seo?.noFollow !== undefined
      ? (seo.noFollow === true || seo.noFollow === 'true')
      : existingSeo?.noFollow || false,
    ogTitle:            seo?.ogTitle            || existingSeo?.ogTitle            || seo?.metaTitle            || existingSeo?.metaTitle            || '',
    ogDescription:      seo?.ogDescription      || existingSeo?.ogDescription      || seo?.metaDescription      || existingSeo?.metaDescription      || '',
    ogImage:            seo?.ogImage            || existingSeo?.ogImage            || '',
    ogType:             seo?.ogType             || existingSeo?.ogType             || 'product',
    twitterCard:        seo?.twitterCard        || existingSeo?.twitterCard        || 'summary_large_image',
    twitterTitle:       seo?.twitterTitle       || existingSeo?.twitterTitle       || seo?.ogTitle              || existingSeo?.ogTitle              || '',
    twitterDescription: seo?.twitterDescription || existingSeo?.twitterDescription || seo?.ogDescription        || existingSeo?.ogDescription        || '',
    twitterImage:       seo?.twitterImage       || existingSeo?.twitterImage       || '',
    schemaType:         seo?.schemaType         || existingSeo?.schemaType         || 'Product',
    condition:          seo?.condition          || existingSeo?.condition          || 'NewCondition',
    availability:       inventoryToAvailability[inventoryStatus] || 'InStock',
    focusKeyphrase:     seo?.focusKeyphrase     || existingSeo?.focusKeyphrase     || '',
    relatedSearchTerms: Array.isArray(seo?.relatedSearchTerms)
      ? seo.relatedSearchTerms
      : existingSeo?.relatedSearchTerms || [],
  };

  if (!resolved.ogTitle)       resolved.ogTitle       = resolved.metaTitle;
  if (!resolved.ogDescription) resolved.ogDescription = resolved.metaDescription;

  return resolved;
};

// ============================================
// RESOLVE UPDATE IMAGES
// Merges existing images with newly uploaded files,
// ensures a primary image is always set.
// Returns { currentImages, newlyUploaded, imagesToDelete }
// so the caller can clean up Cloudinary after a successful DB write.
// ============================================

export const resolveUpdateImages = async (req, product, imageMetadata) => {
  const imagesToDelete = parseJSONSafe(req.body.imagesToDelete) || [];
  const existingImages = parseJSONSafe(req.body.existingImages);

  let currentImages = existingImages
    || product.images.filter(img => !imagesToDelete.includes(img.public_id));

  let newlyUploaded = [];
  if (req.files && req.files.length > 0) {
    newlyUploaded = await uploadProductImages(req.files, imageMetadata, currentImages.length);
    currentImages = [...currentImages, ...newlyUploaded];
  }

  if (currentImages.length > 0 && !currentImages.some(img => img.isPrimary)) {
    currentImages[0] = { ...currentImages[0], isPrimary: true };
  }

  return { currentImages, newlyUploaded, imagesToDelete };
};

// ============================================
// BUILD PRODUCT DATA — CREATE
// Assembles the full document ready for Product.create().
// FIX: relatedProducts, crossSells, upsells now included.
// ============================================

export const buildProductData = (req, parsed, uploadedImages, userId) => {
  const {
    pricing, breadcrumbs, richSnippets, seo,
    inventory, subcategories, tags, specifications,
    variants, dimensions, weight
  } = parsed;

  // Parse JSON-stringified array of ObjectId strings sent from the frontend.
  // The frontend sends: JSON.stringify(['id1', 'id2', ...])
  const parseIds = (field) => {
    const result = parseJSONSafe(field);
    if (Array.isArray(result)) return result.filter(Boolean);
    return [];
  };

  return {
    name:             req.body.name,
    description:      req.body.description,
    shortDescription: req.body.shortDescription || '',
    category:         req.body.category,
    brand:            req.body.brand            || '',
    manufacturer:     req.body.manufacturer     || '',
    pricing:          pricing                   || {},
    inventory:        inventory                 || {},
    subcategories:    Array.isArray(subcategories)  ? subcategories  : [],
    tags:             Array.isArray(tags)            ? tags           : [],
    specifications:   Array.isArray(specifications) ? specifications : [],
    variants:         Array.isArray(variants)        ? variants       : [],
    dimensions:       dimensions  || {},
    weight:           weight      || {},
    breadcrumbs:      breadcrumbs || [],
    seo:              buildSeoForCreate(seo, req.body.name),
    richSnippets: {
      faqs:   Array.isArray(richSnippets?.faqs)   ? richSnippets.faqs   : [],
      howTo:  richSnippets?.howTo || { name: '', steps: [] },
      videos: Array.isArray(richSnippets?.videos) ? richSnippets.videos : [],
    },
    relatedProducts:  parseIds(req.body.relatedProducts),
    crossSells:       parseIds(req.body.crossSells),
    upsells:          parseIds(req.body.upsells),
    isFeatured:   req.body.isFeatured   === 'true' || req.body.isFeatured   === true,
    isNewArrival: req.body.isNewArrival === 'true' || req.body.isNewArrival === true,
    isBestseller: req.body.isBestseller === 'true' || req.body.isBestseller === true,
    status:       req.body.status || 'published',
    user:         userId,
    images:       uploadedImages,
    analytics: {
      views: 0, purchases: 0, addedToCart: 0, addedToWishlist: 0,
      conversions: 0, searchImpressions: 0, searchClicks: 0,
      avgTimeOnPage: 0, bounceRate: 0
    }
  };
};

// ============================================
// BUILD PRODUCT UPDATE DATA
// Assembles the full update document for findByIdAndUpdate().
// resolvedSeo must already have ogImage filled in by the caller
// (after resolveUpdateImages runs) before being passed here.
// ============================================

export const buildProductUpdateData = (req, parsed, product, {
  updatedSlug,
  slugHistory,
  mergedInventory,
  isOnSale,
  resolvedSeo,
  currentImages,
  newStatus,
  publishedAt,
  archivedAt,
  userId,
}) => {
  const {
    pricing, breadcrumbs, richSnippets,
    subcategories, tags, specifications,
    variants, dimensions, weight
  } = parsed;

  // Parse JSON-stringified array of ObjectId strings sent from the frontend.
  // Falls back to the existing product value so relationships are never
  // silently dropped when the update form omits these fields.
  const parseIds = (field, fallback) => {
    const result = parseJSONSafe(field);
    if (Array.isArray(result)) return result.filter(Boolean);
    return fallback || [];
  };

  return {
    name:             req.body.name,
    slug:             updatedSlug,
    slugHistory,
    description:      req.body.description,
    shortDescription: req.body.shortDescription || '',
    category:         req.body.category,
    brand:            req.body.brand            || '',
    manufacturer:     req.body.manufacturer     || product.manufacturer || '',
    pricing:          pricing                   || product.pricing,
    inventory:        mergedInventory,
    subcategories:    Array.isArray(subcategories)  ? subcategories  : product.subcategories,
    tags:             Array.isArray(tags)            ? tags           : product.tags,
    specifications:   Array.isArray(specifications) ? specifications : product.specifications,
    variants:         Array.isArray(variants)        ? variants       : product.variants,
    dimensions:       dimensions  || product.dimensions,
    weight:           weight      || product.weight,
    breadcrumbs:      breadcrumbs || product.breadcrumbs,
    seo:              resolvedSeo,
    richSnippets: {
      faqs:   Array.isArray(richSnippets?.faqs)   ? richSnippets.faqs   : product.richSnippets?.faqs   || [],
      howTo:  richSnippets?.howTo                 || product.richSnippets?.howTo                        || { name: '', steps: [] },
      videos: Array.isArray(richSnippets?.videos) ? richSnippets.videos : product.richSnippets?.videos || [],
    },
    relatedProducts:  parseIds(req.body.relatedProducts, product.relatedProducts),
    crossSells:       parseIds(req.body.crossSells,      product.crossSells),
    upsells:          parseIds(req.body.upsells,         product.upsells),
    images:           currentImages,
    isOnSale,
    isFeatured:   req.body.isFeatured   !== undefined
      ? (req.body.isFeatured   === 'true' || req.body.isFeatured   === true)
      : product.isFeatured,
    isNewArrival: req.body.isNewArrival !== undefined
      ? (req.body.isNewArrival === 'true' || req.body.isNewArrival === true)
      : product.isNewArrival,
    isBestseller: req.body.isBestseller !== undefined
      ? (req.body.isBestseller === 'true' || req.body.isBestseller === true)
      : product.isBestseller,
    status:         newStatus,
    publishedAt,
    archivedAt,
    lastModifiedAt: new Date(),
    lastModifiedBy: userId,
  };
};

// ============================================
// HANDLE DUPLICATE KEY ERROR
// Catches MongoDB E11000 errors and returns a clean 400
// instead of a raw 500. Returns false if not a dupe error
// so callers can use: if (handleDuplicateKeyError(err, next)) return;
// ============================================

export const handleDuplicateKeyError = (error, next) => {
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'field';

    const fieldLabels = {
      slug:            'product name (slug)',
      'inventory.sku': 'SKU',
    };

    const label    = fieldLabels[field] || field;
    const value    = error.keyValue?.[field];
    const valueStr = value ? ` ("${value}")` : '';

    return next(
      new HandleError(
        `A product with this ${label}${valueStr} already exists. Please use a different value.`,
        400
      )
    );
  }
  return false;
};