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
      unique: true,
      lowercase: true,
      trim: true
    },
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
      }
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

    // Brand
    brand: { type: String, trim: true },

    // Images
    images: [
      {
        public_id: { type: String, required: true },
        url: { type: String, required: true },
        alt: { type: String, default: '' },
        isPrimary: { type: Boolean, default: false },
        order: { type: Number, default: 0 }
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
        sku: { type: String }
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

    // SEO
    seo: {
      metaTitle: { type: String, maxlength: 60 },
      metaDescription: { type: String, maxlength: 160 },
      keywords: [{ type: String }]
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
      lastViewed: { type: Date }
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
// NOTE: This only runs on .save()/.validate(). findOneAndUpdate bypasses it.
// Apply the same constraints in your update service layer as well.
// ============================================
productSchema.pre('validate', function (next) {
  const { pricing } = this;

  if (!pricing || pricing.regular == null) {
    return next(new Error('Pricing.regular is required'));
  }

  // FIX P3: sale=0 with regular=0 is a valid free product — only reject
  // when sale is explicitly set AND is >= regular on a non-zero price.
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

// FIX P2: `this.pricing?.sale` is falsy when sale=0 (valid free item),
// causing 100% discount to show as 0%. Use `!= null` check instead.
productSchema.virtual('discountPercentage').get(function () {
  if (this.pricing?.sale != null && this.pricing?.regular) {
    return Math.round(
      ((this.pricing.regular - this.pricing.sale) / this.pricing.regular) * 100
    );
  }
  return 0;
});

// FIX P9: A Discontinued product should not be reported as LowStock or
// OutOfStock — those are stock-driven states. Discontinued is admin-set.
productSchema.virtual('isLowStock').get(function () {
  if (this.inventory?.status === 'Discontinued') return false;
  const stock = this.inventory?.stock ?? 0;
  const threshold = this.inventory?.lowStockThreshold ?? 5;
  return stock > 0 && stock <= threshold;
});

productSchema.virtual('isOutOfStock').get(function () {
  if (this.inventory?.status === 'Discontinued') return false;
  const stock = this.inventory?.stock ?? 0;
  return stock === 0;
});

// Backward-compatibility alias for legacy `stock` field access
productSchema.virtual('stock').get(function () {
  return this.inventory?.stock ?? 0;
});

// ============================================
// INDEXES
// ============================================
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
// FIX P10: Add index for inventory.status — used in find queries throughout
// the codebase (lowStockProducts, getInventoryStats, etc.)
productSchema.index({ 'inventory.status': 1, status: 1 });

// Text search index
productSchema.index({
  name: 'text',
  description: 'text',
  'seo.keywords': 'text',
  tags: 'text'
});

// Compound indexes
productSchema.index({ category: 1, status: 1, createdAt: -1 });
productSchema.index({ status: 1, isFeatured: 1, ratings: -1 });

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
productSchema.pre('save', function (next) {
  // Auto-generate slug on first save only.
  // Slugs are intentionally stable after creation for SEO — renaming a product
  // does not auto-update the slug to avoid breaking existing URLs.
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // FIX P4: Guard Discontinued status — it is an admin-set flag, not
  // a stock-derived state. Stock-based logic must not overwrite it.
  // FIX P6: Use nullish coalescing for lowStockThreshold so an explicitly
  // null threshold doesn't coerce to 0 and misclassify stock levels.
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

  // Check if on sale
  this.isOnSale = !!(this.pricing?.sale != null && this.pricing.sale < this.pricing.regular);

  // Set publishedAt date
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  // Mark first image as primary if none set
  if (this.images?.length > 0) {
    const hasPrimary = this.images.some(img => img.isPrimary);
    if (!hasPrimary) {
      this.images[0].isPrimary = true;
    }
  }

  next();
});

// ============================================
// STATIC METHODS
// ============================================
productSchema.statics.getTrendingProducts = async function (limit = 10) {
  return this.find({ status: 'published' })
    .sort({ 'analytics.purchases': -1, 'analytics.views': -1 })
    .limit(limit);
};

productSchema.statics.getNewArrivals = async function (limit = 10) {
  return this.find({ status: 'published', isNewArrival: true })
    .sort({ createdAt: -1 })
    .limit(limit);
};

productSchema.statics.getFeaturedProducts = async function (limit = 10) {
  return this.find({ status: 'published', isFeatured: true })
    .sort({ ratings: -1 })
    .limit(limit);
};

productSchema.statics.getBestsellers = async function (limit = 10) {
  return this.find({ status: 'published', isBestseller: true })
    .sort({ 'analytics.purchases': -1 })
    .limit(limit);
};

// ============================================
// INSTANCE METHODS
// ============================================
productSchema.methods.incrementView = async function () {
  this.analytics.views += 1;
  this.analytics.lastViewed = new Date();
  return this.save({ validateBeforeSave: false });
};

// FIX P4-confirmed + FIX P5: Floor stock at 0 to prevent negative inventory.
// The pre-save hook (which runs even with validateBeforeSave:false) will then
// correctly set inventory.status based on the new stock value.
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

productSchema.set('strictQuery', true);

export default mongoose.model('Product', productSchema);