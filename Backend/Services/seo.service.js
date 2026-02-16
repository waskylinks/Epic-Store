import Product from '../models/product-model.js';
import { getCache, setCache, getCacheRaw, setCacheRaw } from '../utils/redis.js';

/**
 * SEO Service
 * 
 * Centralized service for all SEO-related operations including:
 * - Structured data generation (JSON-LD)
 * - Sitemap generation
 * - Open Graph meta tag generation
 * - Twitter Card generation
 * - Canonical URL management
 * - Breadcrumb generation
 * 
 * IMPORTANT: This version is compatible with the user's Redis implementation
 * which includes PREFIX and uses JSON serialization by default.
 */

class SEOService {
  constructor() {
    this.baseUrl = process.env.FRONTEND_URL || 'https://example.com';
    this.cacheTTL = {
      structuredData: 3600,      // 1 hour
      sitemap: 3600,              // 1 hour
      breadcrumbs: 7200           // 2 hours
    };
  }

  /**
   * Generate JSON-LD Structured Data for a Product
   * 
   * @param {Object} product - Mongoose product document
   * @returns {Object} JSON-LD structured data
   */
  generateStructuredData(product) {
    if (!product) {
      throw new Error('Product is required for structured data generation');
    }

    // Use the model's built-in method
    const baseStructuredData = product.getStructuredData();

    // Enhance with additional context
    const enhancedData = {
      ...baseStructuredData,
      url: `${this.baseUrl}/products/${product.slug}`,
    };

    // Add breadcrumb list if available
    if (product.breadcrumbs && product.breadcrumbs.length > 0) {
      enhancedData.breadcrumb = {
        "@type": "BreadcrumbList",
        "itemListElement": product.breadcrumbs.map(crumb => ({
          "@type": "ListItem",
          "position": crumb.position,
          "name": crumb.name,
          "item": `${this.baseUrl}${crumb.url}`
        }))
      };
    }

    // Add FAQ schema if available
    if (product.richSnippets?.faqs && product.richSnippets.faqs.length > 0) {
      enhancedData.mainEntity = {
        "@type": "FAQPage",
        "mainEntity": product.richSnippets.faqs.map(faq => ({
          "@type": "Question",
          "name": faq.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": faq.answer
          }
        }))
      };
    }

    // Add video schema if available
    if (product.richSnippets?.videos && product.richSnippets.videos.length > 0) {
      enhancedData.video = product.richSnippets.videos.map(video => ({
        "@type": "VideoObject",
        "name": video.name,
        "description": video.description,
        "thumbnailUrl": video.thumbnailUrl,
        "uploadDate": video.uploadDate,
        "contentUrl": video.contentUrl,
        "embedUrl": video.embedUrl,
        "duration": video.duration
      }));
    }

    // Add HowTo schema if available
    if (product.richSnippets?.howTo?.name) {
      enhancedData.howTo = {
        "@type": "HowTo",
        "name": product.richSnippets.howTo.name,
        "step": product.richSnippets.howTo.steps.map((step, index) => ({
          "@type": "HowToStep",
          "position": index + 1,
          "name": step.name,
          "text": step.text,
          "image": step.image
        }))
      };
    }

    return enhancedData;
  }

  /**
   * Generate JSON-LD script tag for HTML insertion
   * 
   * @param {Object} product - Mongoose product document
   * @returns {String} HTML script tag with JSON-LD
   */
  generateStructuredDataScript(product) {
    const structuredData = this.generateStructuredData(product);
    // Escape closing script tags to prevent XSS
    const jsonString = JSON.stringify(structuredData, null, 2)
      .replace(/<\//g, '<\\/');
    return `<script type="application/ld+json">${jsonString}</script>`;
  }

  /**
   * Generate Open Graph Meta Tags
   * 
   * @param {Object} product - Mongoose product document
   * @returns {Array} Array of meta tag objects
   */
  generateOpenGraphTags(product) {
    const tags = [];
    const url = `${this.baseUrl}/products/${product.slug}`;
    
    // Required OG tags
    tags.push({ property: 'og:type', content: product.seo?.ogType || 'product' });
    tags.push({ property: 'og:title', content: product.seo?.ogTitle || product.name });
    tags.push({ property: 'og:description', content: product.seo?.ogDescription || product.shortDescription });
    tags.push({ property: 'og:url', content: url });

    // Image
    if (product.seo?.ogImage) {
      tags.push({ property: 'og:image', content: product.seo.ogImage });
      
      // Add image dimensions if available (convert to string for HTML)
      const primaryImage = product.images?.find(img => img.isPrimary) || product.images?.[0];
      if (primaryImage?.width) {
        tags.push({ property: 'og:image:width', content: String(primaryImage.width) });
      }
      if (primaryImage?.height) {
        tags.push({ property: 'og:image:height', content: String(primaryImage.height) });
      }
      if (primaryImage?.alt) {
        tags.push({ property: 'og:image:alt', content: primaryImage.alt });
      }
    }

    // Product-specific OG tags
    if (product.pricing?.regular) {
      tags.push({ property: 'product:price:amount', content: String(product.finalPrice) });
      tags.push({ property: 'product:price:currency', content: product.pricing.currency });
    }

    if (product.seo?.availability) {
      tags.push({ property: 'product:availability', content: product.seo.availability.toLowerCase() });
    }

    if (product.seo?.condition) {
      tags.push({ property: 'product:condition', content: product.seo.condition.replace('Condition', '').toLowerCase() });
    }

    if (product.brand) {
      tags.push({ property: 'product:brand', content: product.brand });
    }

    // Site name
    tags.push({ property: 'og:site_name', content: process.env.SITE_NAME || 'Your Store' });

    return tags;
  }

  /**
   * Generate Twitter Card Meta Tags
   * 
   * @param {Object} product - Mongoose product document
   * @returns {Array} Array of meta tag objects
   */
  generateTwitterCardTags(product) {
    const tags = [];

    tags.push({ name: 'twitter:card', content: product.seo?.twitterCard || 'summary_large_image' });
    tags.push({ name: 'twitter:title', content: product.seo?.twitterTitle || product.seo?.ogTitle || product.name });
    tags.push({ name: 'twitter:description', content: product.seo?.twitterDescription || product.seo?.ogDescription || product.shortDescription });

    if (product.seo?.twitterImage || product.seo?.ogImage) {
      tags.push({ name: 'twitter:image', content: product.seo.twitterImage || product.seo.ogImage });
      
      const primaryImage = product.images?.find(img => img.isPrimary) || product.images?.[0];
      if (primaryImage?.alt) {
        tags.push({ name: 'twitter:image:alt', content: primaryImage.alt });
      }
    }

    // Twitter site handle (if configured)
    if (process.env.TWITTER_HANDLE) {
      tags.push({ name: 'twitter:site', content: process.env.TWITTER_HANDLE });
    }

    return tags;
  }

  /**
   * Generate Complete Meta Tags for Product Page
   * 
   * @param {Object} product - Mongoose product document
   * @returns {Object} Object containing all meta tags
   */
  generateMetaTags(product) {
    const metaTags = {
      title: product.seo?.metaTitle || product.name,
      description: product.seo?.metaDescription || product.shortDescription,
      canonical: product.seo?.canonicalUrl || `${this.baseUrl}/products/${product.slug}`,
      robots: [],
      openGraph: this.generateOpenGraphTags(product),
      twitter: this.generateTwitterCardTags(product),
      keywords: product.seo?.keywords || []
    };

    // Robots directives
    if (product.seo?.noIndex) {
      metaTags.robots.push('noindex');
    }
    if (product.seo?.noFollow) {
      metaTags.robots.push('nofollow');
    }
    if (metaTags.robots.length === 0) {
      metaTags.robots.push('index', 'follow');
    }

    return metaTags;
  }

  /**
   * Generate XML Sitemap
   * 
   * NOTE: Uses getCacheRaw/setCacheRaw because XML is a string, not JSON
   * Your Redis auto-parses JSON, so we need raw string functions for XML
   * 
   * @param {Object} options - Sitemap generation options
   * @returns {String} XML sitemap string
   */
  async generateSitemap(options = {}) {
    const cacheKey = 'sitemap_products'; // Note: No colon - Redis adds prefix
    
    // Check cache first (using raw string function for XML)
    if (!options.skipCache) {
      try {
        const cached = await getCacheRaw(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (error) {
        console.warn('Sitemap cache read failed, generating fresh:', error.message);
      }
    }

    // Fetch products using the model's static method
    const products = await Product.getSitemapProducts();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Add homepage
    xml += '  <url>\n';
    xml += `    <loc>${this.baseUrl}/</loc>\n`;
    xml += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    // Add product URLs
    for (const product of products) {
      xml += '  <url>\n';
      xml += `    <loc>${this.baseUrl}/products/${product.slug}</loc>\n`;
      
      const lastMod = product.lastModifiedAt || product.publishedAt || product.createdAt;
      if (lastMod) {
        xml += `    <lastmod>${new Date(lastMod).toISOString().split('T')[0]}</lastmod>\n`;
      }
      
      // Calculate change frequency based on product activity
      const daysSinceModified = lastMod 
        ? Math.floor((Date.now() - new Date(lastMod).getTime()) / (1000 * 60 * 60 * 24))
        : 365;
      
      let changefreq = 'monthly';
      if (daysSinceModified < 7) changefreq = 'daily';
      else if (daysSinceModified < 30) changefreq = 'weekly';
      
      xml += `    <changefreq>${changefreq}</changefreq>\n`;
      
      // Priority based on product importance
      let priority = '0.5';
      if (product.isFeatured) priority = '0.9';
      else if (product.isNewArrival) priority = '0.8';
      else if (product.isBestseller) priority = '0.7';
      
      xml += `    <priority>${priority}</priority>\n`;
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    // Cache the sitemap (using raw string function for XML)
    try {
      await setCacheRaw(cacheKey, xml, this.cacheTTL.sitemap);
    } catch (error) {
      console.warn('Sitemap cache write failed:', error.message);
    }

    return xml;
  }

  /**
   * Generate Product Breadcrumbs
   * 
   * @param {Object} product - Mongoose product document
   * @returns {Array} Breadcrumb array
   */
  generateBreadcrumbs(product) {
    if (product.breadcrumbs && product.breadcrumbs.length > 0) {
      return product.breadcrumbs;
    }

    // Auto-generate basic breadcrumbs
    const breadcrumbs = [
      { name: 'Home', url: '/', position: 1 },
      { name: product.category, url: `/category/${product.category.toLowerCase().replace(/\s+/g, '-')}`, position: 2 },
    ];

    if (product.subcategories && product.subcategories[0]) {
      breadcrumbs.push({
        name: product.subcategories[0],
        url: `/category/${product.category.toLowerCase().replace(/\s+/g, '-')}/${product.subcategories[0].toLowerCase().replace(/\s+/g, '-')}`,
        position: 3
      });
    }

    breadcrumbs.push({
      name: product.name,
      url: `/products/${product.slug}`,
      position: breadcrumbs.length + 1
    });

    return breadcrumbs;
  }

  /**
   * Validate SEO Configuration
   * 
   * @param {Object} product - Mongoose product document
   * @returns {Object} Validation results with warnings and errors
   */
  validateSEO(product) {
    const warnings = [];
    const errors = [];

    // Meta title validation
    if (!product.seo?.metaTitle) {
      warnings.push('Missing meta title - using product name as fallback');
    } else if (product.seo.metaTitle.length > 60) {
      warnings.push(`Meta title is ${product.seo.metaTitle.length} characters (recommended: 50-60)`);
    }

    // Meta description validation
    if (!product.seo?.metaDescription) {
      warnings.push('Missing meta description');
    } else if (product.seo.metaDescription.length < 120) {
      warnings.push(`Meta description is ${product.seo.metaDescription.length} characters (recommended: 120-160)`);
    } else if (product.seo.metaDescription.length > 160) {
      warnings.push(`Meta description is ${product.seo.metaDescription.length} characters (recommended: 120-160)`);
    }

    // Image alt text validation
    const imagesWithoutAlt = product.images?.filter(img => !img.alt).length || 0;
    if (imagesWithoutAlt > 0) {
      warnings.push(`${imagesWithoutAlt} image(s) missing alt text`);
    }

    // Structured data validation
    if (!product.inventory?.sku && !product.inventory?.gtin) {
      warnings.push('Missing SKU and GTIN - recommended for Google Shopping');
    }

    if (!product.brand) {
      warnings.push('Missing brand - recommended for rich snippets');
    }

    // Focus keyphrase validation
    if (product.seo?.focusKeyphrase) {
      const keyphrase = product.seo.focusKeyphrase.toLowerCase();
      const nameContains = product.name.toLowerCase().includes(keyphrase);
      const descContains = product.description.toLowerCase().includes(keyphrase);
      
      if (!nameContains) {
        warnings.push('Focus keyphrase not found in product name');
      }
      if (!descContains) {
        warnings.push('Focus keyphrase not found in product description');
      }
    } else {
      warnings.push('No focus keyphrase set');
    }

    return {
      score: Math.max(0, 100 - (errors.length * 20) - (warnings.length * 5)),
      errors,
      warnings,
      isValid: errors.length === 0
    };
  }

  /**
   * Generate robots.txt content
   * 
   * @returns {String} robots.txt content
   */
  generateRobotsTxt() {
    return `User-agent: *
Allow: /

# Sitemap
Sitemap: ${this.baseUrl}/sitemap.xml

# Disallow admin and internal pages
Disallow: /admin/
Disallow: /api/
Disallow: /cart/
Disallow: /checkout/
Disallow: /account/

# Crawl-delay (optional, adjust based on your needs)
Crawl-delay: 1`;
  }
}

// Singleton instance
const seoService = new SEOService();

export default seoService;

/**
 * USAGE EXAMPLES WITH YOUR REDIS
 * ===============================
 * 
 * Your Redis implementation automatically:
 * - Adds PREFIX ('epicstore:') to all keys
 * - Serializes/deserializes JSON automatically
 * - Provides advanced patterns (SWR, fallback, locks)
 * 
 * 1. Basic Usage:
 * 
 * import seoService from '../services/seoService.js';
 * 
 * const product = await Product.findOne({ slug: req.params.slug });
 * const metaTags = seoService.generateMetaTags(product);
 * const structuredData = seoService.generateStructuredData(product);
 * 
 * 2. With Cache-with-Fallback Pattern:
 * 
 * import { getCacheWithFallback } from '../utils/redis.js';
 * 
 * const productSEO = await getCacheWithFallback(
 *   `product_${product._id}_seo`,
 *   async () => seoService.generateMetaTags(product),
 *   3600
 * );
 * 
 * 3. With Stale-While-Revalidate:
 * 
 * import { getCacheWithSWR } from '../utils/redis.js';
 * 
 * const trendingProducts = await getCacheWithSWR(
 *   'trending_products',
 *   async () => Product.getTrendingProducts(10),
 *   { ttl: 3600, staleAfter: 3000 }
 * );
 * 
 * 4. Sitemap with Distributed Lock:
 * 
 * import { executeWithLock } from '../utils/redis.js';
 * 
 * const sitemap = await executeWithLock(
 *   'sitemap_generation',
 *   async () => seoService.generateSitemap(),
 *   30
 * );
 */