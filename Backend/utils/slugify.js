export const slugify = (text, options = {}) => {
  const {
    lowercase = true,
    strict = false,
    trim = true,
    replacement = '-',
    maxLength = 200
  } = options;

  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  let slug = text;

  if (lowercase) {
    slug = slug.toLowerCase();
  }

  if (strict) {
    slug = slug
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, replacement)
      .replace(new RegExp(`${replacement}+`, 'g'), replacement);
  } else {
    slug = slug
      .replace(/[^\w\s-]/g, '')
      .replace(/_/g, replacement)
      .replace(/\s+/g, replacement)
      .replace(new RegExp(`${replacement}+`, 'g'), replacement);
  }

  if (trim) {
    slug = slug.replace(/^-+|-+$/g, '').trim();
  }

  if (maxLength && slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    slug = slug.replace(/-+$/, '');
  }

  return slug;
};

// BUG (introduced by previous fix): The post-loop `if (await checkExists(slug))`
// guard fires unconditionally — including on the happy path where the loop
// broke early because no collision was found. This means every slug generation
// that succeeds on the first try now issues TWO DB queries instead of one:
// one inside the loop (which returns false and breaks) and one in the post-loop
// guard (which also returns false and is wasted).
//
// FIX: Use a boolean `found` flag set on break. The post-loop block only runs
// when the loop exhausted all numbered slots without finding a free one,
// which is the only case that should fall through to the timestamp fallback.
// This restores 1-query cost on the happy path.
export const generateUniqueSlug = async (baseSlug, checkExists, maxAttempts = 100) => {
  let slug = baseSlug;
  let attempt = 1;
  let found = false; // ← ADDED

  while (attempt < maxAttempts) {
    if (!(await checkExists(slug))) {
      found = true; // ← ADDED: mark that we found a free slot inside the loop
      break;
    }
    slug = `${baseSlug}-${attempt}`;
    attempt++;
  }

  // Only reach here if every numbered slot from baseSlug through baseSlug-(maxAttempts-1)
  // was taken. Fall back to a timestamp suffix which is effectively collision-free.
  if (!found) { // ← CHANGED: was `await checkExists(slug)` which re-queried the DB
    slug = `${baseSlug}-${Date.now()}`;
  }

  return slug;
};

export const validateSlug = (slug, rules = {}) => {
  const {
    minLength = 1,
    maxLength = 200,
    allowUppercase = false,
    allowNumbers = true,
    allowHyphens = true,
    allowUnderscores = true,
    customPattern = null
  } = rules;

  const errors = [];

  if (!slug || typeof slug !== 'string') {
    return { isValid: false, errors: ['Slug must be a non-empty string'] };
  }

  if (slug.length < minLength) {
    errors.push(`Slug must be at least ${minLength} characters long`);
  }
  if (slug.length > maxLength) {
    errors.push(`Slug must not exceed ${maxLength} characters`);
  }

  if (slug.startsWith('-') || slug.endsWith('-')) {
    errors.push('Slug cannot start or end with a hyphen');
  }

  if (slug.includes('--')) {
    errors.push('Slug cannot contain consecutive hyphens');
  }

  let patternParts = ['a-z'];
  if (allowUppercase)    patternParts.push('A-Z');
  if (allowNumbers)      patternParts.push('0-9');
  if (allowHyphens)      patternParts.push('-');
  if (allowUnderscores)  patternParts.push('_');

  const pattern = customPattern || new RegExp(`^[${patternParts.join('')}]+$`);

  if (!pattern.test(slug)) {
    errors.push('Slug contains invalid characters');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const extractSlugFromUrl = (urlOrPath) => {
  if (!urlOrPath || typeof urlOrPath !== 'string') {
    return null;
  }

  let path = urlOrPath.replace(/^https?:\/\/[^/]+/, '');
  path = path.split('?')[0].split('#')[0];

  const segments = path.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
};

export const generateSEOSlug = (text, options = {}) => {
  const {
    removeStopWords = false,
    maxWords = null,
    addPrefix = null,
    addSuffix = null,
    preserveNumbers = true
  } = options;

  let slug = text;

  if (removeStopWords) {
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const words = slug.toLowerCase().split(/\s+/);
    slug = words.filter(word => !stopWords.includes(word)).join(' ');
  }

  if (maxWords) {
    const words = slug.split(/\s+/);
    slug = words.slice(0, maxWords).join(' ');
  }

  slug = slugify(slug, { strict: !preserveNumbers });

  if (addPrefix) slug = `${slugify(addPrefix)}-${slug}`;
  if (addSuffix) slug = `${slug}-${slugify(addSuffix)}`;

  return slug;
};

export const batchSlugify = (items, options = {}) => {
  if (!Array.isArray(items)) {
    throw new Error('Items must be an array');
  }

  const results = [];
  const slugCounts = new Map();

  for (const item of items) {
    let slug = slugify(item, options);

    if (slugCounts.has(slug)) {
      const count = slugCounts.get(slug) + 1;
      slugCounts.set(slug, count);
      slug = `${slug}-${count}`;
    } else {
      slugCounts.set(slug, 0);
    }

    results.push({ original: item, slug });
  }

  return results;
};

export const compareSlugSimilarity = (slug1, slug2) => {
  if (!slug1 || !slug2) {
    return { similar: false, score: 0 };
  }

  const words1 = slug1.split('-');
  const words2 = slug2.split('-');

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  const jaccardScore = intersection.size / union.size;

  return {
    similar: jaccardScore > 0.5,
    score: jaccardScore,
    sharedWords: Array.from(intersection),
    uniqueToFirst: words1.filter(w => !set2.has(w)),
    uniqueToSecond: words2.filter(w => !set1.has(w))
  };
};

export default {
  slugify,
  generateUniqueSlug,
  validateSlug,
  extractSlugFromUrl,
  generateSEOSlug,
  batchSlugify,
  compareSlugSimilarity
};