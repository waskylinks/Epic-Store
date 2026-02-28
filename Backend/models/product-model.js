import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    // Basic Information
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters']
    },
    slug: {
      type: String,
      lowercase: true,
      trim: true
      // Note: Auto-generated in pre-save if missing
    },
    // SEO: Track slug history for 301 redirects
    slugHistory: [{
      oldSlug: { type: String, required: true },
      changedAt: { type: Date, default: Date.now }
    }],
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters']
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [500, 'Short description cannot exceed 500 characters']
    },

    // ============================================
    // Pricing
    // ============================================
    pricing: {
      regular: {
        type: Number,
        required: [true, 'Regular price is required'],
        min: [0, 'Price cannot be negative']
      },
      sale: {
        type: Number,
        min: [0, 'Sale price cannot be negative']
      },
      cost: {
        type: Number,
        min: [0, 'Cost cannot be negative']
      },
      currency: {
        type: String,
        default: 'USD',
        enum: ['USD', 'EUR', 'GBP', 'NGN']
      },
      // SEO: For rich snippets - price valid period
      validFrom: { type: Date },
      validThrough: { type: Date }
    },

    // Categories
    category: {
      type: String,
      required: [true, 'Primary category is required'],
      enum: {
        values: [
          'Electronics',
          'Clothing & Apparel',
          'Home & Living',
          'Sports & Outdoors',
          'Beauty & Personal Care',
          'Books & Media',
          'Food & Beverages'
        ],
        message: '{VALUE} is not a valid category'
      }
    },
    subcategories: [{ type: String, trim: true }],
    tags: [{ type: String, trim: true, lowercase: true }],
    
    // SEO: Breadcrumb trail for structured data
    breadcrumbs: [{
      name: { type: String, required: true },
      url: { type: String, required: true },
      position: { type: Number, required: true }
    }],

    // Brand
    brand: { 
      type: String, 
      trim: true,
      // SEO: Brand info for schema.org
      required: [false, 'Brand helps with SEO']
    },
    manufacturer: { type: String, trim: true },

    // Images
    images: [
      {
        public_id: { type: String, required: true },
        url: { type: String, required: true },
        // SEO: Alt text strongly recommended for accessibility and SEO
        alt: { 
          type: String, 
          default: '',
          trim: true,
          maxlength: [125, 'Alt text should be under 125 characters']
        },
        isPrimary: { type: Boolean, default: false },
        order: { type: Number, default: 0 },
        // SEO: Image dimensions for schema markup
        width: { type: Number },
        height: { type: Number },
        // SEO: Caption for additional context
        caption: { type: String, maxlength: 200 }
      }
    ],

    // ============================================
    // Inventory Management
    // ============================================
    inventory: {
      stock: {
        type: Number,
        default: 0,
        min: [0, 'Stock cannot be negative']
      },
      sku: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
        uppercase: true
      },
      // SEO: GTIN for Google Shopping and rich snippets
      gtin: { type: String, trim: true },
      mpn: { type: String, trim: true }, // Manufacturer Part Number
      barcode: { type: String, trim: true },
      trackInventory: { type: Boolean, default: true },
      lowStockThreshold: { type: Number, default: 5 },
      status: {
        type: String,
        enum: ['InStock', 'LowStock', 'OutOfStock', 'Discontinued'],
        default: 'InStock'
      }
    },

    // Product Variants
    variants: [{
      name: { type: String, required: true },
      options: [{
        value: { type: String, required: true },
        priceModifier: { type: Number, default: 0 },
        stock: { type: Number, default: 0 },
        sku: { type: String },
        gtin: { type: String }
      }]
    }],

    // Specifications
    specifications: [{
      key: { type: String, required: true },
      value: { type: String, required: true }
    }],

    // Dimensions & Weight
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, enum: ['cm', 'in'], default: 'cm' }
    },
    weight: {
      value: { type: Number },
      unit: { type: String, enum: ['kg', 'lb', 'g'], default: 'kg' }
    },

    // ============================================
    // SEO - ENHANCED
    // ============================================
    seo: {
      metaTitle: { 
        type: String, 
        maxlength: [60, 'Meta title should be under 60 characters'],
        trim: true
      },
      metaDescription: { 
        type: String, 
        minlength: [120, 'Meta description should be at least 120 characters'],
        maxlength: [160, 'Meta description should be under 160 characters'],
        trim: true
      },
      keywords: [{ type: String, lowercase: true }],
      
      // Canonical URL to prevent duplicate content
      canonicalUrl: { type: String, trim: true },
      
      // Robots meta directives
      noIndex: { type: Boolean, default: false },
      noFollow: { type: Boolean, default: false },
      
      // Open Graph for social sharing
      ogTitle: { type: String, maxlength: 60, trim: true },
      ogDescription: { type: String, maxlength: 160, trim: true },
      ogImage: { type: String, trim: true },
      ogType: { type: String, default: 'product' },
      
      // Twitter Card
      twitterCard: { type: String, enum: ['summary', 'summary_large_image'], default: 'summary_large_image' },
      twitterTitle: { type: String, maxlength: 70, trim: true },
      twitterDescription: { type: String, maxlength: 200, trim: true },
      twitterImage: { type: String, trim: true },
      
      // Schema.org structured data type
      schemaType: { 
        type: String, 
        default: 'Product',
        enum: ['Product', 'Book', 'Course', 'SoftwareApplication']
      },
      
      // Additional schema fields
      condition: {
        type: String,
        enum: ['NewCondition', 'UsedCondition', 'RefurbishedCondition', 'DamagedCondition'],
        default: 'NewCondition'
      },
      
      // SEO: Availability schema
      availability: {
        type: String,
        enum: [
          'InStock',
          'OutOfStock', 
          'PreOrder',
          'Discontinued',
          'LimitedAvailability',
          'SoldOut',
          'BackOrder'
        ],
        default: 'InStock'
      },
      
      // Focus keyphrase for SEO optimization
      focusKeyphrase: { type: String, lowercase: true, trim: true },
      
      // Internal linking suggestions
      relatedSearchTerms: [{ type: String, lowercase: true }]
    },

    // ============================================
    // RICH SNIPPETS DATA
    // ============================================
    richSnippets: {
      // FAQ Schema
      faqs: [{
        question: { type: String, required: true, maxlength: 200 },
        answer: { type: String, required: true, maxlength: 1000 }
      }],
      
      // How-to Schema (for applicable products)
      howTo: {
        name: { type: String },
        steps: [{
          name: { type: String },
          text: { type: String },
          image: { type: String }
        }]
      },
      
      // Video Schema
      videos: [{
        name: { type: String },
        description: { type: String },
        thumbnailUrl: { type: String },
        uploadDate: { type: Date },
        contentUrl: { type: String },
        embedUrl: { type: String },
        duration: { type: String } // ISO 8601 format
      }]
    },

    // Reviews & Ratings
    ratings: { type: Number, default: 0, min: 0, max: 5 },
    numOfReviews: { type: Number, default: 0 },
    reviews: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String, maxlength: 1000 },
        verified: { type: Boolean, default: false },
        helpful: { type: Number, default: 0 },
        // SEO: Review schema fields
        reviewTitle: { type: String, maxlength: 100 },
        pros: [{ type: String }],
        cons: [{ type: String }],
        createdAt: { type: Date, default: Date.now }
      }
    ],

    // Product Relationships
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    crossSells: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    upsells: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    // Analytics & Tracking
    analytics: {
      views: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 },
      addedToCart: { type: Number, default: 0 },
      addedToWishlist: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      lastViewed: { type: Date },
      // SEO: Track search impressions and clicks
      searchImpressions: { type: Number, default: 0 },
      searchClicks: { type: Number, default: 0 },
      // SEO: Average time on page
      avgTimeOnPage: { type: Number, default: 0 },
      // SEO: Bounce rate
      bounceRate: { type: Number, default: 0 }
    },

    // Flags
    isFeatured: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },
    isBestseller: { type: Boolean, default: false },
    isOnSale: { type: Boolean, default: false },

    // Visibility
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'published'
    },

    publishedAt: { type: Date },
    archivedAt: { type: Date },
    
    // SEO: Last modified for sitemaps
    lastModifiedAt: { type: Date },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true,
    strict: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// PRICING VALIDATION (PRE-VALIDATE)
// ============================================
productSchema.pre('validate', function (next) {
  const { pricing } = this;

  if (!pricing || pricing.regular == null) {
    return next(new Error('Pricing.regular is required'));
  }

  if (pricing.sale != null && pricing.regular > 0 && pricing.sale >= pricing.regular) {
    return next(new Error('Sale price must be less than regular price'));
  }

  if (pricing.cost != null && pricing.cost > pricing.regular) {
    return next(new Error('Cost price cannot exceed regular price'));
  }

  next();
});

// ============================================
// VIRTUALS
// ============================================
productSchema.virtual('finalPrice').get(function () {
  return this.pricing?.sale ?? this.pricing?.regular;
});

productSchema.virtual('discountPercentage').get(function () {
  if (this.pricing?.sale != null && this.pricing?.regular) {
    return Math.round(
      ((this.pricing.regular - this.pricing.sale) / this.pricing.regular) * 100
    );
  }
  return 0;
});

productSchema.virtual('isLowStock').get(function () {
  if (this.inventory?.status === 'Discontinued') return false;
  const stock = this.inventory?.stock ?? 0;
  const threshold = this.inventory?.lowStockThreshold ?? 5;
  return stock > 0 && stock <= threshold;
});

productSchema.virtual('isOutOfStock').get(function () {
  if (this.inventory?.status === 'Discontinued') return false;
  return (this.inventory?.stock ?? 0) === 0;
});

productSchema.virtual('stock').get(function () {
  return this.inventory?.stock ?? 0;
});

// SEO: Generate full URL virtual
productSchema.virtual('url').get(function () {
  return `/products/${this.slug}`;
});

// SEO: CTR (Click-through rate) virtual
productSchema.virtual('searchCTR').get(function () {
  if (this.analytics?.searchImpressions > 0) {
    return ((this.analytics.searchClicks / this.analytics.searchImpressions) * 100).toFixed(2);
  }
  return 0;
});

// ============================================
// INDEXES - ENHANCED FOR SEO
// ============================================
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ createdAt: -1 });
productSchema.index({ 'inventory.stock': 1 });
productSchema.index({ category: 1 });
productSchema.index({ 'pricing.regular': 1 });
productSchema.index({ ratings: -1 });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ isNewArrival: 1, status: 1 });
productSchema.index({ isBestseller: 1, status: 1 });
productSchema.index({ 'analytics.views': -1 });
productSchema.index({ 'analytics.purchases': -1 });
productSchema.index({ 'analytics.conversions': -1 });
productSchema.index({ 'inventory.status': 1, status: 1 });

// SEO: Index for sitemap generation
productSchema.index({ status: 1, lastModifiedAt: -1, publishedAt: -1 });
productSchema.index({ 'seo.noIndex': 1, status: 1 });

// SEO: Index for GTIN lookups (Google Shopping)
productSchema.index({ 'inventory.gtin': 1 });
productSchema.index({ 'inventory.mpn': 1 });

// Text search index
productSchema.index({
  name: 'text',
  description: 'text',
  'seo.keywords': 'text',
  'seo.focusKeyphrase': 'text',
  tags: 'text'
});

// Compound indexes
productSchema.index({ category: 1, status: 1, createdAt: -1 });
productSchema.index({ status: 1, isFeatured: 1, ratings: -1 });
productSchema.index({ brand: 1, status: 1, ratings: -1 });
productSchema.index({ createdAt: -1, _id: -1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ 'inventory.status': 1, createdAt: -1 });
productSchema.index({ status: 1, 'inventory.status': 1, createdAt: -1 });
productSchema.index({ status: 1, 'pricing.regular': 1 });
productSchema.index({ status: 1, ratings: -1 });
productSchema.index({ status: 1, 'inventory.stock': 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isOnSale: 1 });
productSchema.index({ isBestseller: 1 });
productSchema.index({ isNewArrival: 1 });


// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
productSchema.pre('save', function (next) {
  // Track slug changes for 301 redirects
  if (this.isModified('slug') && !this.isNew) {
    const originalSlug = this._original?.slug;
    if (originalSlug && originalSlug !== this.slug) {
      this.slugHistory.push({
        oldSlug: originalSlug,
        changedAt: new Date()
      });
    }
  }

  // Auto-generate slug on first save only
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // SEO: Auto-populate meta fields if empty
  if (!this.seo.metaTitle) {
    this.seo.metaTitle = this.name.substring(0, 60);
  }
  
  if (!this.seo.metaDescription && this.shortDescription) {
    this.seo.metaDescription = this.shortDescription.substring(0, 160);
  }

  // SEO: Auto-populate Open Graph if empty
  if (!this.seo.ogTitle) {
    this.seo.ogTitle = this.seo.metaTitle;
  }
  
  if (!this.seo.ogDescription) {
    this.seo.ogDescription = this.seo.metaDescription;
  }
  
  if (!this.seo.ogImage && this.images?.length > 0) {
    const primaryImage = this.images.find(img => img.isPrimary) || this.images[0];
    this.seo.ogImage = primaryImage.url;
  }

  // SEO: Sync inventory status with schema availability
  if (this.inventory) {
    const statusMap = {
      'InStock': 'InStock',
      'LowStock': 'LimitedAvailability',
      'OutOfStock': 'OutOfStock',
      'Discontinued': 'Discontinued'
    };
    this.seo.availability = statusMap[this.inventory.status] || 'InStock';
  }

  // Guard Discontinued status
  if (this.inventory && this.inventory.status !== 'Discontinued') {
    const threshold = this.inventory.lowStockThreshold ?? 5;
    if (this.inventory.stock === 0) {
      this.inventory.status = 'OutOfStock';
    } else if (this.inventory.stock <= threshold) {
      this.inventory.status = 'LowStock';
    } else {
      this.inventory.status = 'InStock';
    }
  }

  this.isOnSale = !!(this.pricing?.sale != null && this.pricing.sale < this.pricing.regular);

  // Track status transition timestamps
  if (this.isModified('status')) {
    if (this.status === 'published' && !this.publishedAt) {
      this.publishedAt = new Date();
    }
    if (this.status === 'archived' && !this.archivedAt) {
      this.archivedAt = new Date();
    }
  }

  // SEO: Update lastModifiedAt for sitemaps
  if (this.isModified()) {
    this.lastModifiedAt = new Date();
  }

  // Mark first image as primary if none is set
  if (this.images?.length > 0) {
    const hasPrimary = this.images.some(img => img.isPrimary);
    if (!hasPrimary) {
      this.images[0].isPrimary = true;
    }
  }

  next();
});

// Store original document for slug change detection
productSchema.post('init', function() {
  this._original = this.toObject();
});

// ============================================
// STATIC METHODS
// ============================================
productSchema.statics.getTrendingProducts = async function (limit = 10) {
  return this.find({ status: 'published', 'seo.noIndex': false })
    .sort({ 'analytics.purchases': -1, 'analytics.views': -1 })
    .limit(limit);
};

productSchema.statics.getNewArrivals = async function (limit = 10) {
  return this.find({ status: 'published', isNewArrival: true, 'seo.noIndex': false })
    .sort({ createdAt: -1 })
    .limit(limit);
};

productSchema.statics.getFeaturedProducts = async function (limit = 10) {
  return this.find({ status: 'published', isFeatured: true, 'seo.noIndex': false })
    .sort({ ratings: -1 })
    .limit(limit);
};

productSchema.statics.getBestsellers = async function (limit = 10) {
  return this.find({ status: 'published', isBestseller: true, 'seo.noIndex': false })
    .sort({ 'analytics.purchases': -1 })
    .limit(limit);
};

// SEO: Get products for sitemap
productSchema.statics.getSitemapProducts = async function () {
  return this.find({ 
    status: 'published', 
    'seo.noIndex': false 
  })
  .select('slug lastModifiedAt publishedAt')
  .sort({ lastModifiedAt: -1 });
};

// SEO: Find product by old slug (for 301 redirects)
productSchema.statics.findByOldSlug = async function (oldSlug) {
  return this.findOne({ 'slugHistory.oldSlug': oldSlug });
};

// ============================================
// INSTANCE METHODS
// ============================================
productSchema.methods.incrementView = async function () {
  this.analytics.views += 1;
  this.analytics.lastViewed = new Date();
  return this.save({ validateBeforeSave: false });
};

productSchema.methods.incrementPurchase = async function (quantity = 1) {
  this.analytics.purchases += quantity;
  if (this.inventory?.trackInventory) {
    this.inventory.stock = Math.max(0, this.inventory.stock - quantity);
  }
  return this.save({ validateBeforeSave: false });
};

productSchema.methods.incrementWishlist = async function (increment = true) {
  if (increment) {
    this.analytics.addedToWishlist += 1;
  } else {
    this.analytics.addedToWishlist = Math.max(0, this.analytics.addedToWishlist - 1);
  }
  return this.save({ validateBeforeSave: false });
};

productSchema.methods.incrementConversion = async function () {
  this.analytics.conversions += 1;
  return this.save({ validateBeforeSave: false });
};

// SEO: Track search performance
productSchema.methods.trackSearchImpression = async function () {
  this.analytics.searchImpressions += 1;
  return this.save({ validateBeforeSave: false });
};

productSchema.methods.trackSearchClick = async function () {
  this.analytics.searchClicks += 1;
  return this.save({ validateBeforeSave: false });
};

// SEO: Generate structured data JSON-LD
productSchema.methods.getStructuredData = function () {
  const primaryImage = this.images?.find(img => img.isPrimary) || this.images?.[0];
  
  return {
    "@context": "https://schema.org/",
    "@type": this.seo?.schemaType || "Product",
    "name": this.name,
    "image": this.images?.map(img => img.url) || [],
    "description": this.description,
    "sku": this.inventory?.sku,
    "gtin": this.inventory?.gtin,
    "mpn": this.inventory?.mpn,
    "brand": this.brand ? {
      "@type": "Brand",
      "name": this.brand
    } : undefined,
    "offers": {
      "@type": "Offer",
      "url": this.seo?.canonicalUrl || this.url,
      "priceCurrency": this.pricing?.currency,
      "price": this.finalPrice,
      "priceValidUntil": this.pricing?.validThrough,
      "availability": `https://schema.org/${this.seo?.availability || 'InStock'}`,
      "itemCondition": `https://schema.org/${this.seo?.condition || 'NewCondition'}`
    },
    "aggregateRating": this.numOfReviews > 0 ? {
      "@type": "AggregateRating",
      "ratingValue": this.ratings,
      "reviewCount": this.numOfReviews,
      "bestRating": 5,
      "worstRating": 1
    } : undefined,
    "review": this.reviews?.slice(0, 5).map(review => ({
      "@type": "Review",
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": review.rating,
        "bestRating": 5
      },
      "author": {
        "@type": "Person",
        "name": review.name
      },
      "reviewBody": review.comment,
      "datePublished": review.createdAt
    }))
  };
};

productSchema.set('strictQuery', true);

export default mongoose.model('Product', productSchema);