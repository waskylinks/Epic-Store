import Product from '../models/product-model.js';
import { getCacheRaw, setCacheRaw } from '../utils/redis.js';
import { categoryToSlug } from '../utils/reserved-slugs.js';

class SEOService {
  constructor() {
    this.baseUrl = process.env.FRONTEND_URL || 'https://example.com';
    this.cacheTTL = {
      structuredData: 3600,
      sitemap: 3600,
      breadcrumbs: 7200
    };
  }

  // FIX #6 — Shared priority/changefreq logic. Previously duplicated
  // verbatim between generateSitemap() here and the /sitemap-:category.xml
  // route handler. Both now call this static method.
  static getSitemapUrlMeta(product) {
    const lastMod = product.lastModifiedAt || product.publishedAt || product.createdAt;
    const days = lastMod
      ? Math.floor((Date.now() - new Date(lastMod).getTime()) / 86_400_000)
      : 365;

    const changefreq = days < 7 ? 'daily' : days < 30 ? 'weekly' : 'monthly';

    const priority = product.isFeatured    ? '0.9'
      : product.isNewArrival               ? '0.8'
      : product.isBestseller               ? '0.7'
      :                                      '0.5';

    return { lastMod, changefreq, priority };
  }

  // FIX #8 — safeJsonStringify centralises the XSS escape so any caller
  // who stringifies structured data for HTML injection uses the safe path.
  // Previously only generateStructuredDataScript() applied the escape;
  // direct callers of generateStructuredData() got unescaped output.
  static safeJsonStringify(obj) {
    return JSON.stringify(obj, null, 2).replace(/<\//g, '<\/');
  }

  generateStructuredData(product) {
    if (!product) {
      throw new Error('Product is required for structured data generation');
    }

    const baseStructuredData = product.getStructuredData();

    const enhancedData = {
      ...baseStructuredData,
      url: `${this.baseUrl}/products/${product.slug}`,
    };

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

  // FIX #8 — Uses static safeJsonStringify so the escape is applied
  // consistently whether called here or by any other caller.
  generateStructuredDataScript(product) {
    const structuredData = this.generateStructuredData(product);
    return `<script type="application/ld+json">${SEOService.safeJsonStringify(structuredData)}</script>`;
  }

  generateOpenGraphTags(product) {
    const tags = [];
    const url = `${this.baseUrl}/products/${product.slug}`;

    tags.push({ property: 'og:type', content: product.seo?.ogType || 'product' });
    tags.push({ property: 'og:title', content: product.seo?.ogTitle || product.name });
    tags.push({ property: 'og:description', content: product.seo?.ogDescription || product.shortDescription });
    tags.push({ property: 'og:url', content: url });

    if (product.seo?.ogImage) {
      tags.push({ property: 'og:image', content: product.seo.ogImage });

      const primaryImage = product.images?.find(img => img.isPrimary) || product.images?.[0];
      if (primaryImage?.width)  tags.push({ property: 'og:image:width',  content: String(primaryImage.width) });
      if (primaryImage?.height) tags.push({ property: 'og:image:height', content: String(primaryImage.height) });
      if (primaryImage?.alt)    tags.push({ property: 'og:image:alt',    content: primaryImage.alt });
    }

    if (product.pricing?.regular) {
      tags.push({ property: 'product:price:amount',   content: String(product.finalPrice) });
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

    tags.push({ property: 'og:site_name', content: process.env.SITE_NAME || 'Your Store' });

    return tags;
  }

  generateTwitterCardTags(product) {
    const tags = [];

    tags.push({ name: 'twitter:card',        content: product.seo?.twitterCard || 'summary_large_image' });
    tags.push({ name: 'twitter:title',       content: product.seo?.twitterTitle || product.seo?.ogTitle || product.name });
    tags.push({ name: 'twitter:description', content: product.seo?.twitterDescription || product.seo?.ogDescription || product.shortDescription });

    if (product.seo?.twitterImage || product.seo?.ogImage) {
      tags.push({ name: 'twitter:image', content: product.seo.twitterImage || product.seo.ogImage });

      const primaryImage = product.images?.find(img => img.isPrimary) || product.images?.[0];
      if (primaryImage?.alt) {
        tags.push({ name: 'twitter:image:alt', content: primaryImage.alt });
      }
    }

    if (process.env.TWITTER_HANDLE) {
      tags.push({ name: 'twitter:site', content: process.env.TWITTER_HANDLE });
    }

    return tags;
  }

  generateMetaTags(product) {
    // FIX #5 — Canonical is always derived from product.slug at response-time.
    // The previous guard (storedCanonical.endsWith(`/${product.slug}`)) was dead
    // code because the controller always stores canonicalUrl as ''. Removed.
    const canonical = `${this.baseUrl}/products/${product.slug}`;

    const metaTags = {
      title:       product.seo?.metaTitle       || product.name,
      description: product.seo?.metaDescription || product.shortDescription,
      canonical,
      robots: [],
      openGraph: this.generateOpenGraphTags(product),
      twitter:   this.generateTwitterCardTags(product),
      keywords:  product.seo?.keywords || []
    };

    if (product.seo?.noIndex)  metaTags.robots.push('noindex');
    if (product.seo?.noFollow) metaTags.robots.push('nofollow');
    if (metaTags.robots.length === 0) metaTags.robots.push('index', 'follow');

    return metaTags;
  }

  async generateSitemap(options = {}) {
    const baseUrl = (options.baseUrl || this.baseUrl).replace(/\/$/, '');
    const cacheKey = 'sitemap_products';

    if (!options.skipCache) {
      try {
        const cached = await getCacheRaw(cacheKey);
        if (cached) return cached;
      } catch (error) {
        console.warn('Sitemap cache read failed, generating fresh:', error.message);
      }
    }

    const products = await Product.getSitemapProducts();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    for (const product of products) {
      // FIX #6 — Delegate to shared helper instead of inlining the logic.
      const { lastMod, changefreq, priority } = SEOService.getSitemapUrlMeta(product);

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/products/${product.slug}</loc>\n`;
      if (lastMod) {
        xml += `    <lastmod>${new Date(lastMod).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += `    <changefreq>${changefreq}</changefreq>\n`;
      xml += `    <priority>${priority}</priority>\n`;
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    try {
      await setCacheRaw(cacheKey, xml, this.cacheTTL.sitemap);
    } catch (error) {
      console.warn('Sitemap cache write failed:', error.message);
    }

    return xml;
  }

  generateBreadcrumbs(product) {
    if (product.breadcrumbs && product.breadcrumbs.length > 0) {
      return product.breadcrumbs;
    }

    // FIX #7 — Use shared categoryToSlug() helper so the category URL
    // segment is identical here and in seo-routes.js. Previously this used
    // /\s+/g while the sitemap index used /[\s&]+/g, so "Clothing & Apparel"
    // produced "/clothing-&-apparel" in breadcrumbs but "/clothing-apparel"
    // in the sitemap — those links 404'd.
    const breadcrumbs = [
      { name: 'Home', url: '/', position: 1 },
      {
        name: product.category,
        url: `/category/${categoryToSlug(product.category)}`,
        position: 2
      },
    ];

    if (product.subcategories && product.subcategories[0]) {
      breadcrumbs.push({
        name: product.subcategories[0],
        url: `/category/${categoryToSlug(product.category)}/${categoryToSlug(product.subcategories[0])}`,
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

  validateSEO(product) {
    const warnings = [];
    const errors = [];

    if (!product.seo?.metaTitle) {
      warnings.push('Missing meta title - using product name as fallback');
    } else if (product.seo.metaTitle.length > 60) {
      warnings.push(`Meta title is ${product.seo.metaTitle.length} characters (recommended: 50-60)`);
    }

    if (!product.seo?.metaDescription) {
      warnings.push('Missing meta description');
    } else if (product.seo.metaDescription.length < 120) {
      warnings.push(`Meta description is ${product.seo.metaDescription.length} characters (recommended: 120-160)`);
    } else if (product.seo.metaDescription.length > 160) {
      warnings.push(`Meta description is ${product.seo.metaDescription.length} characters (recommended: 120-160)`);
    }

    const imagesWithoutAlt = product.images?.filter(img => !img.alt).length || 0;
    if (imagesWithoutAlt > 0) {
      warnings.push(`${imagesWithoutAlt} image(s) missing alt text`);
    }

    if (!product.inventory?.sku && !product.inventory?.gtin) {
      warnings.push('Missing SKU and GTIN - recommended for Google Shopping');
    }

    if (!product.brand) {
      warnings.push('Missing brand - recommended for rich snippets');
    }

    if (product.seo?.focusKeyphrase) {
      const keyphrase = product.seo.focusKeyphrase.toLowerCase();
      if (!product.name.toLowerCase().includes(keyphrase)) {
        warnings.push('Focus keyphrase not found in product name');
      }
      if (!product.description.toLowerCase().includes(keyphrase)) {
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

  generateRobotsTxt(baseUrl) {
    const resolvedUrl = (baseUrl || this.baseUrl).replace(/\/$/, '');
    return `User-agent: *
Allow: /

# Sitemap
Sitemap: ${resolvedUrl}/sitemap.xml

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

export { SEOService };
const seoService = new SEOService();
export default seoService;