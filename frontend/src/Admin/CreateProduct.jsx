import { useEffect, useState, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import {
  createProduct,
  clearCreateStatus,
  selectCreateStatus,
} from '../features/admin/adminProductSlice';
import '../AdminStyles/CreateProduct.css';

// ── constants ─────────────────────────────────────────────────────────────────
const CATEGORIES   = ['Electronics','Clothing & Apparel','Home & Living','Sports & Outdoors','Beauty & Personal Care','Books & Media','Food & Beverages'];
const CURRENCIES   = ['USD','EUR','GBP','NGN'];
const DIM_UNITS    = ['cm','in'];
const W_UNITS      = ['kg','lb','g'];
const INV_STATUSES = ['InStock','LowStock','OutOfStock','Discontinued'];
const SCHEMA_TYPES = ['Product','Book','Course','SoftwareApplication'];
const CONDITIONS   = ['NewCondition','UsedCondition','RefurbishedCondition','DamagedCondition'];
const TW_CARDS     = ['summary','summary_large_image'];
const OG_TYPES     = ['product','website','article'];

const SECTIONS = [
  'Basic Info', 'Pricing', 'Inventory', 'Images',
  'Variants', 'Specifications', 'Dimensions & Weight',
  'Breadcrumbs', 'SEO', 'Rich Snippets', 'Relationships & Flags',
];

const initState = () => ({
  // basic — status intentionally excluded from UI; always 'published' on create
  name: '', description: '', shortDescription: '', category: '', brand: '', manufacturer: '',
  // pricing
  pricing: { regular: '', sale: '', cost: '', currency: 'USD', validFrom: '', validThrough: '' },
  // inventory
  inventory: { stock: '', sku: '', gtin: '', mpn: '', barcode: '', trackInventory: true, lowStockThreshold: 5, status: 'InStock' },
  // dimensions
  dimensions: { length: '', width: '', height: '', unit: 'cm' },
  weight: { value: '', unit: 'kg' },
  // arrays
  subcategories: [], tags: [], specifications: [], variants: [], breadcrumbs: [],
  // flags
  isFeatured: false, isNewArrival: false, isBestseller: false,
  // seo
  seo: {
    metaTitle: '', metaDescription: '', keywords: [], canonicalUrl: '', noIndex: false, noFollow: false,
    ogTitle: '', ogDescription: '', ogImage: '', ogType: 'product',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '', twitterImage: '',
    schemaType: 'Product', condition: 'NewCondition', availability: 'InStock',
    focusKeyphrase: '', relatedSearchTerms: [],
  },
  // rich snippets
  richSnippets: {
    faqs: [], howTo: { name: '', steps: [] }, videos: [],
  },
  // relationships — comma-separated product IDs entered by admin
  relatedProducts: '', crossSells: '', upsells: '',
});

export default function CreateProduct() {
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const { loading, error, success } = useSelector(selectCreateStatus);

  const [form,           setForm]          = useState(initState());
  const [activeSection,  setActiveSection] = useState(0);
  const [images,         setImages]        = useState([]);  // { file, preview, alt, caption }
  const [imageMetadata,  setImageMetadata] = useState([]);
  const [tagInput,       setTagInput]      = useState('');
  const [subInput,       setSubInput]      = useState('');
  const [kwInput,        setKwInput]       = useState('');
  const [rstInput,       setRstInput]      = useState('');
  const [toast,          setToast]         = useState(null);
  const [errors,         setErrors]        = useState({});
  const fileRef = useRef();

  // ── toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Scroll to top when navigating between sections
useEffect(() => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}, [activeSection]);

  useEffect(() => {
    if (success) {
      showToast('Product created successfully!');
      dispatch(clearCreateStatus());
      setTimeout(() => navigate('/admin/products'), 1200);
    }
    if (error) {
      showToast(error, 'error');
      dispatch(clearCreateStatus());
    }
  }, [success, error, dispatch, navigate, showToast]);

  // ── derived pricing stats (computed, no state needed) ─────────────────────
  const pricingStats = (() => {
    const regular = parseFloat(form.pricing.regular);
    const sale    = parseFloat(form.pricing.sale);
    const cost    = parseFloat(form.pricing.cost);

    const hasRegular = regular > 0;
    const hasSale    = hasRegular && sale > 0 && sale < regular;
    const hasCost    = hasRegular && !isNaN(cost) && cost >= 0 && form.pricing.cost !== '';

    const discount   = hasSale ? Math.round(((regular - sale) / regular) * 100) : null;
    const saving     = hasSale ? (regular - sale).toFixed(2) : null;
    const margin     = hasCost ? Math.round(((regular - cost) / regular) * 100) : null;
    const saleMargin = hasSale && hasCost ? Math.round(((sale - cost) / sale) * 100) : null;

    return { discount, saving, margin, saleMargin };
  })();

  // ── generic nested field setter ───────────────────────────────────────────
  const set = (path, value) => {
    setForm(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  // ── images ────────────────────────────────────────────────────────────────
  const handleImageAdd = (e) => {
    const files   = Array.from(e.target.files);
    const newImgs = files.map(file => ({ file, preview: URL.createObjectURL(file), alt: '', caption: '' }));
    setImages(prev => [...prev, ...newImgs]);
    setImageMetadata(prev => [...prev, ...newImgs.map(img => ({ alt: img.alt, caption: img.caption }))]);
    e.target.value = '';
  };

  const removeImage = (idx) => {
    setImages(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx); });
    setImageMetadata(prev => prev.filter((_, i) => i !== idx));
  };

  const updateImageMeta = (idx, field, value) => {
    setImages(prev => prev.map((img, i) => i === idx ? { ...img, [field]: value } : img));
    setImageMetadata(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  // ── array field helpers ───────────────────────────────────────────────────
  const addToArray = (field, value, setter) => {
    if (!value.trim()) return;
    setForm(prev => ({ ...prev, [field]: [...prev[field], value.trim()] }));
    setter('');
  };
  const removeFromArray = (field, idx) =>
    setForm(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));

  const addToSeoArray = (field, value, setter) => {
    if (!value.trim()) return;
    setForm(prev => ({ ...prev, seo: { ...prev.seo, [field]: [...prev.seo[field], value.trim()] } }));
    setter('');
  };
  const removeFromSeoArray = (field, idx) =>
    setForm(prev => ({ ...prev, seo: { ...prev.seo, [field]: prev.seo[field].filter((_, i) => i !== idx) } }));

  // ── specifications ────────────────────────────────────────────────────────
  const addSpec    = () => setForm(prev => ({ ...prev, specifications: [...prev.specifications, { key: '', value: '' }] }));
  const setSpec    = (idx, field, val) => setForm(prev => ({
    ...prev, specifications: prev.specifications.map((s, i) => i === idx ? { ...s, [field]: val } : s),
  }));
  const removeSpec = (idx) => setForm(prev => ({ ...prev, specifications: prev.specifications.filter((_, i) => i !== idx) }));

  // ── variants ──────────────────────────────────────────────────────────────
  const addVariant    = () => setForm(prev => ({
    ...prev, variants: [...prev.variants, { name: '', options: [{ value: '', priceModifier: 0, stock: 0, sku: '', gtin: '' }] }],
  }));
  const setVariant    = (vi, field, val) => setForm(prev => ({
    ...prev, variants: prev.variants.map((v, i) => i === vi ? { ...v, [field]: val } : v),
  }));
  const addVariantOption = (vi) => setForm(prev => ({
    ...prev, variants: prev.variants.map((v, i) =>
      i === vi ? { ...v, options: [...v.options, { value: '', priceModifier: 0, stock: 0, sku: '', gtin: '' }] } : v),
  }));
  const setVariantOption = (vi, oi, field, val) => setForm(prev => ({
    ...prev, variants: prev.variants.map((v, i) =>
      i === vi ? { ...v, options: v.options.map((o, j) => j === oi ? { ...o, [field]: val } : o) } : v),
  }));
  const removeVariant       = (vi) => setForm(prev => ({ ...prev, variants: prev.variants.filter((_, i) => i !== vi) }));
  const removeVariantOption = (vi, oi) => setForm(prev => ({
    ...prev, variants: prev.variants.map((v, i) =>
      i === vi ? { ...v, options: v.options.filter((_, j) => j !== oi) } : v),
  }));

  // ── breadcrumbs ───────────────────────────────────────────────────────────
  const addBreadcrumb    = () => setForm(prev => ({
    ...prev, breadcrumbs: [...prev.breadcrumbs, { name: '', url: '', position: prev.breadcrumbs.length + 1 }],
  }));
  const setBreadcrumb    = (idx, field, val) => setForm(prev => ({
    ...prev, breadcrumbs: prev.breadcrumbs.map((b, i) => i === idx ? { ...b, [field]: val } : b),
  }));
  const removeBreadcrumb = (idx) => setForm(prev => ({ ...prev, breadcrumbs: prev.breadcrumbs.filter((_, i) => i !== idx) }));

  // ── FAQs ──────────────────────────────────────────────────────────────────
  const addFaq    = () => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, faqs: [...prev.richSnippets.faqs, { question: '', answer: '' }] },
  }));
  const setFaq    = (idx, field, val) => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, faqs: prev.richSnippets.faqs.map((f, i) => i === idx ? { ...f, [field]: val } : f) },
  }));
  const removeFaq = (idx) => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, faqs: prev.richSnippets.faqs.filter((_, i) => i !== idx) },
  }));

  // ── HowTo steps ───────────────────────────────────────────────────────────
  const addHowToStep    = () => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, steps: [...prev.richSnippets.howTo.steps, { name: '', text: '', image: '' }] } },
  }));
  const setHowToStep    = (idx, field, val) => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, steps: prev.richSnippets.howTo.steps.map((s, i) => i === idx ? { ...s, [field]: val } : s) } },
  }));
  const removeHowToStep = (idx) => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, steps: prev.richSnippets.howTo.steps.filter((_, i) => i !== idx) } },
  }));

  // ── Videos ────────────────────────────────────────────────────────────────
  const addVideo    = () => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, videos: [...prev.richSnippets.videos, { name: '', description: '', thumbnailUrl: '', uploadDate: '', contentUrl: '', embedUrl: '', duration: '' }] },
  }));
  const setVideo    = (idx, field, val) => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, videos: prev.richSnippets.videos.map((v, i) => i === idx ? { ...v, [field]: val } : v) },
  }));
  const removeVideo = (idx) => setForm(prev => ({
    ...prev, richSnippets: { ...prev.richSnippets, videos: prev.richSnippets.videos.filter((_, i) => i !== idx) },
  }));

  // ── validation ────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.name.trim())        e.name        = 'Product name is required';
    if (!form.description.trim()) e.description = 'Description is required';
    if (!form.category)           e.category    = 'Category is required';
    if (!form.pricing.regular)    e.regular     = 'Regular price is required';
    if (form.pricing.sale && Number(form.pricing.sale) >= Number(form.pricing.regular))
      e.sale = 'Sale price must be less than regular price';
    if (images.length === 0)      e.images      = 'At least one image is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── submit ────────────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) { showToast('Please fix the errors below', 'error'); return; }

    const fd = new FormData();

    // FIX: status hardcoded to 'published' — no draft on create
    fd.append('name',             form.name);
    fd.append('description',      form.description);
    fd.append('shortDescription', form.shortDescription);
    fd.append('category',         form.category);
    fd.append('brand',            form.brand);
    fd.append('manufacturer',     form.manufacturer);
    fd.append('status',           'published');
    fd.append('isFeatured',       form.isFeatured);
    fd.append('isNewArrival',     form.isNewArrival);
    fd.append('isBestseller',     form.isBestseller);

    fd.append('pricing',         JSON.stringify(form.pricing));
    fd.append('inventory',       JSON.stringify(form.inventory));
    fd.append('dimensions',      JSON.stringify(form.dimensions));
    fd.append('weight',          JSON.stringify(form.weight));
    fd.append('subcategories',   JSON.stringify(form.subcategories));
    fd.append('tags',            JSON.stringify(form.tags));
    fd.append('specifications',  JSON.stringify(form.specifications));
    fd.append('variants',        JSON.stringify(form.variants));
    fd.append('breadcrumbs',     JSON.stringify(form.breadcrumbs));
    fd.append('seo',             JSON.stringify(form.seo));
    fd.append('richSnippets',    JSON.stringify(form.richSnippets));
    fd.append('imageMetadata',   JSON.stringify(imageMetadata));

    // FIX: parse comma-separated IDs and send as JSON arrays
    const parseIds = (str) => str.split(',').map(s => s.trim()).filter(Boolean);
    fd.append('relatedProducts', JSON.stringify(parseIds(form.relatedProducts)));
    fd.append('crossSells',      JSON.stringify(parseIds(form.crossSells)));
    fd.append('upsells',         JSON.stringify(parseIds(form.upsells)));

    images.forEach(img => fd.append('images', img.file));

    dispatch(createProduct(fd));
  };

  // ── sidebar completion check ──────────────────────────────────────────────
  const sectionComplete = (s) => {
    if (s === 0) return !!(form.name && form.description && form.category);
    if (s === 1) return !!form.pricing.regular;
    if (s === 3) return images.length > 0;
    return true;
  };

  if (loading) return <Loader />;

  return (
    <>
      <PageTitle title="Create Product — Admin" />
      <Navbar />

      <main className="cp-main">
        {toast && (
          <div className={`cp-toast cp-toast--${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : '✕'}</span> {toast.msg}
          </div>
        )}

        {/* ── Page Header ── */}
        <div className="cp-header">
          <button className="cp-back" onClick={() => navigate('/admin/products')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Products
          </button>
          <h1 className="cp-title">Create Product</h1>
        </div>

        <div className="cp-layout">

          {/* ── Sidebar Navigation ── */}
          <aside className="cp-sidebar">
            {SECTIONS.map((s, i) => (
              <button
                key={s}
                className={`cp-nav-item ${activeSection === i ? 'active' : ''} ${sectionComplete(i) ? 'complete' : ''}`}
                onClick={() => setActiveSection(i)}
              >
                <span className="cp-nav-num">{sectionComplete(i) ? '✓' : i + 1}</span>
                {s}
              </button>
            ))}
          </aside>

          {/* ── Form ── */}
          <form className="cp-form" onSubmit={handleSubmit} noValidate>

            {/* ────────────────────────────────────────────────────────────
                SECTION 0 — Basic Info
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 0 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Basic Information</h2>

              <div className="cp-field cp-field--full">
                <label>Product Name <span className="cp-req">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="Enter product name"
                  maxLength={200}
                />
                {errors.name && <span className="cp-error">{errors.name}</span>}
                <span className="cp-hint">{form.name.length}/200 characters</span>
              </div>

              <div className="cp-field cp-field--full">
                <label>Description <span className="cp-req">*</span></label>
                <textarea
                  rows={5}
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Detailed product description"
                  maxLength={5000}
                />
                {errors.description && <span className="cp-error">{errors.description}</span>}
                <span className="cp-hint">{form.description.length}/5000 characters</span>
              </div>

              <div className="cp-field cp-field--full">
                <label>Short Description</label>
                <textarea
                  rows={2}
                  value={form.shortDescription}
                  onChange={e => set('shortDescription', e.target.value)}
                  placeholder="Brief summary (used for SEO meta if metaDescription is blank)"
                  maxLength={500}
                />
                <span className="cp-hint">{form.shortDescription.length}/500 characters</span>
              </div>

              {/* FIX: status dropdown removed — only category remains in this row */}
              <div className="cp-field cp-field--half">
                <label>Category <span className="cp-req">*</span></label>
                <select value={form.category} onChange={e => set('category', e.target.value)}>
                  <option value="">Select category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {errors.category && <span className="cp-error">{errors.category}</span>}
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Brand</label>
                  <input
                    type="text"
                    value={form.brand}
                    onChange={e => set('brand', e.target.value)}
                    placeholder="Brand name"
                  />
                </div>
                <div className="cp-field">
                  <label>Manufacturer</label>
                  <input
                    type="text"
                    value={form.manufacturer}
                    onChange={e => set('manufacturer', e.target.value)}
                    placeholder="Manufacturer name"
                  />
                </div>
              </div>

              <div className="cp-field">
                <label>Subcategories</label>
                <div className="cp-tag-input">
                  <input
                    type="text"
                    value={subInput}
                    onChange={e => setSubInput(e.target.value)}
                    placeholder="Type and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToArray('subcategories', subInput, setSubInput); }}}
                  />
                  <button type="button" onClick={() => addToArray('subcategories', subInput, setSubInput)}>Add</button>
                </div>
                <div className="cp-tags">
                  {form.subcategories.map((s, i) => (
                    <span key={i} className="cp-tag">
                      {s}<button type="button" onClick={() => removeFromArray('subcategories', i)}>×</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="cp-field">
                <label>Tags</label>
                <div className="cp-tag-input">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    placeholder="Type and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToArray('tags', tagInput, setTagInput); }}}
                  />
                  <button type="button" onClick={() => addToArray('tags', tagInput, setTagInput)}>Add</button>
                </div>
                <div className="cp-tags">
                  {form.tags.map((t, i) => (
                    <span key={i} className="cp-tag">
                      {t}<button type="button" onClick={() => removeFromArray('tags', i)}>×</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(1)}>
                  Next: Pricing →
                </button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 1 — Pricing
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 1 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Pricing</h2>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Regular Price <span className="cp-req">*</span></label>
                  <div className="cp-input-prefix">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.pricing.regular}
                      onChange={e => set('pricing.regular', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  {errors.regular && <span className="cp-error">{errors.regular}</span>}
                </div>
                <div className="cp-field">
                  <label>Sale Price</label>
                  <div className="cp-input-prefix">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.pricing.sale}
                      onChange={e => set('pricing.sale', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  {errors.sale && <span className="cp-error">{errors.sale}</span>}
                </div>
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Cost Price</label>
                  <div className="cp-input-prefix">
                    <span>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.pricing.cost}
                      onChange={e => set('pricing.cost', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="cp-field">
                  <label>Currency</label>
                  <select value={form.pricing.currency} onChange={e => set('pricing.currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Price Valid From</label>
                  <input
                    type="date"
                    value={form.pricing.validFrom}
                    onChange={e => set('pricing.validFrom', e.target.value)}
                  />
                </div>
                <div className="cp-field">
                  <label>Price Valid Through</label>
                  <input
                    type="date"
                    value={form.pricing.validThrough}
                    onChange={e => set('pricing.validThrough', e.target.value)}
                  />
                </div>
              </div>

              {/* FIX: live pricing stats cards */}
              {(pricingStats.discount !== null || pricingStats.margin !== null) && (
                <div className="cp-pricing-stats">
                  {pricingStats.discount !== null && (
                    <div className="cp-pricing-stat cp-pricing-stat--discount">
                      <span className="cp-pricing-stat__label">Discount</span>
                      <span className="cp-pricing-stat__value">-{pricingStats.discount}%</span>
                      <span className="cp-pricing-stat__sub">
                        Customer saves {form.pricing.currency} {pricingStats.saving}
                      </span>
                    </div>
                  )}
                  {pricingStats.margin !== null && (
                    <div className={`cp-pricing-stat ${pricingStats.margin < 20 ? 'cp-pricing-stat--warn' : 'cp-pricing-stat--good'}`}>
                      <span className="cp-pricing-stat__label">Margin (Regular)</span>
                      <span className="cp-pricing-stat__value">{pricingStats.margin}%</span>
                      <span className="cp-pricing-stat__sub">
                        {pricingStats.margin < 20 ? '⚠ Low margin' : '✓ Healthy margin'}
                      </span>
                    </div>
                  )}
                  {pricingStats.saleMargin !== null && (
                    <div className={`cp-pricing-stat ${pricingStats.saleMargin < 10 ? 'cp-pricing-stat--danger' : pricingStats.saleMargin < 20 ? 'cp-pricing-stat--warn' : 'cp-pricing-stat--good'}`}>
                      <span className="cp-pricing-stat__label">Margin (Sale)</span>
                      <span className="cp-pricing-stat__value">{pricingStats.saleMargin}%</span>
                      <span className="cp-pricing-stat__sub">
                        {pricingStats.saleMargin < 10 ? '⚠ Very low — check cost' : pricingStats.saleMargin < 20 ? '⚠ Low on sale price' : '✓ OK on sale'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(0)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(2)}>Next: Inventory →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 2 — Inventory
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 2 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Inventory</h2>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Stock Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={form.inventory.stock}
                    onChange={e => set('inventory.stock', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="cp-field">
                  <label>Low Stock Threshold</label>
                  <input
                    type="number"
                    min="0"
                    value={form.inventory.lowStockThreshold}
                    onChange={e => set('inventory.lowStockThreshold', e.target.value)}
                  />
                </div>
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>SKU</label>
                  <input
                    type="text"
                    value={form.inventory.sku}
                    onChange={e => set('inventory.sku', e.target.value)}
                    placeholder="Stock keeping unit"
                  />
                </div>
                <div className="cp-field">
                  <label>
                    Inventory Status
                    <span className="cp-hint-inline">— auto-recalculated from stock unless Discontinued</span>
                  </label>
                  <select value={form.inventory.status} onChange={e => set('inventory.status', e.target.value)}>
                    {INV_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>GTIN <span className="cp-hint-inline">(Google Shopping)</span></label>
                  <input
                    type="text"
                    value={form.inventory.gtin}
                    onChange={e => set('inventory.gtin', e.target.value)}
                    placeholder="Global Trade Item Number"
                  />
                </div>
                <div className="cp-field">
                  <label>MPN <span className="cp-hint-inline">(Manufacturer Part No.)</span></label>
                  <input
                    type="text"
                    value={form.inventory.mpn}
                    onChange={e => set('inventory.mpn', e.target.value)}
                    placeholder="Manufacturer part number"
                  />
                </div>
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Barcode</label>
                  <input
                    type="text"
                    value={form.inventory.barcode}
                    onChange={e => set('inventory.barcode', e.target.value)}
                    placeholder="Barcode"
                  />
                </div>
                <div className="cp-field cp-field--checkbox">
                  <label className="cp-checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.inventory.trackInventory}
                      onChange={e => set('inventory.trackInventory', e.target.checked)}
                    />
                    <span>Track Inventory</span>
                  </label>
                </div>
              </div>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(1)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(3)}>Next: Images →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 3 — Images
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 3 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Images</h2>
              {errors.images && <div className="cp-error cp-error--block">{errors.images}</div>}

              <div className="cp-dropzone" onClick={() => fileRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>Click or drag to upload images</p>
                <span>First image becomes the primary / thumbnail</span>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageAdd}
                  style={{ display: 'none' }}
                />
              </div>

              {images.length > 0 && (
                <div className="cp-image-grid">
                  {images.map((img, i) => (
                    <div key={i} className={`cp-image-card ${i === 0 ? 'cp-image-card--primary' : ''}`}>
                      <div className="cp-image-preview">
                        <img src={img.preview} alt={img.alt || `Preview ${i + 1}`} />
                        {i === 0 && <span className="cp-image-badge">Primary</span>}
                        <button type="button" className="cp-image-remove" onClick={() => removeImage(i)}>×</button>
                      </div>
                      <div className="cp-image-meta">
                        <input
                          type="text"
                          placeholder="Alt text (max 125 chars)"
                          maxLength={125}
                          value={img.alt}
                          onChange={e => updateImageMeta(i, 'alt', e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Caption (optional, max 200 chars)"
                          maxLength={200}
                          value={img.caption}
                          onChange={e => updateImageMeta(i, 'caption', e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(2)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(4)}>Next: Variants →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 4 — Variants
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 4 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Variants</h2>
              <p className="cp-section-desc">Define product variants such as Size, Color, Storage, etc.</p>

              {form.variants.map((variant, vi) => (
                <div key={vi} className="cp-variant-block">
                  <div className="cp-variant-header">
                    <input
                      type="text"
                      placeholder="Variant name (e.g. Size, Color)"
                      value={variant.name}
                      onChange={e => setVariant(vi, 'name', e.target.value)}
                    />
                    <button type="button" className="cp-btn cp-btn--danger-sm" onClick={() => removeVariant(vi)}>
                      Remove Variant
                    </button>
                  </div>
                  {variant.options.map((opt, oi) => (
                    <div key={oi} className="cp-variant-option">
                      <input type="text"   placeholder="Value (e.g. Red, XL)"  value={opt.value}         onChange={e => setVariantOption(vi, oi, 'value',         e.target.value)} />
                      <input type="number" placeholder="Price modifier ($)"     value={opt.priceModifier} onChange={e => setVariantOption(vi, oi, 'priceModifier', e.target.value)} />
                      <input type="number" placeholder="Stock"                  value={opt.stock}         onChange={e => setVariantOption(vi, oi, 'stock',         e.target.value)} />
                      <input type="text"   placeholder="SKU"                    value={opt.sku}           onChange={e => setVariantOption(vi, oi, 'sku',           e.target.value)} />
                      <input type="text"   placeholder="GTIN"                   value={opt.gtin}          onChange={e => setVariantOption(vi, oi, 'gtin',          e.target.value)} />
                      <button type="button" className="cp-btn cp-btn--icon-danger" onClick={() => removeVariantOption(vi, oi)}>×</button>
                    </div>
                  ))}
                  <button type="button" className="cp-btn cp-btn--ghost-sm" onClick={() => addVariantOption(vi)}>+ Add Option</button>
                </div>
              ))}

              <button type="button" className="cp-btn cp-btn--dashed" onClick={addVariant}>+ Add Variant</button>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(3)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(5)}>Next: Specifications →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 5 — Specifications
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 5 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Specifications</h2>

              {form.specifications.map((spec, i) => (
                <div key={i} className="cp-spec-row">
                  <input type="text" placeholder="Key (e.g. Material)"  value={spec.key}   onChange={e => setSpec(i, 'key',   e.target.value)} />
                  <input type="text" placeholder="Value (e.g. Cotton)"  value={spec.value} onChange={e => setSpec(i, 'value', e.target.value)} />
                  <button type="button" className="cp-btn cp-btn--icon-danger" onClick={() => removeSpec(i)}>×</button>
                </div>
              ))}

              <button type="button" className="cp-btn cp-btn--dashed" onClick={addSpec}>+ Add Specification</button>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(4)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(6)}>Next: Dimensions →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 6 — Dimensions & Weight
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 6 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Dimensions & Weight</h2>

              <div className="cp-row cp-row--3">
                <div className="cp-field">
                  <label>Length</label>
                  <input type="number" min="0" value={form.dimensions.length} onChange={e => set('dimensions.length', e.target.value)} placeholder="0" />
                </div>
                <div className="cp-field">
                  <label>Width</label>
                  <input type="number" min="0" value={form.dimensions.width}  onChange={e => set('dimensions.width',  e.target.value)} placeholder="0" />
                </div>
                <div className="cp-field">
                  <label>Height</label>
                  <input type="number" min="0" value={form.dimensions.height} onChange={e => set('dimensions.height', e.target.value)} placeholder="0" />
                </div>
              </div>

              <div className="cp-field cp-field--sm">
                <label>Dimension Unit</label>
                <select value={form.dimensions.unit} onChange={e => set('dimensions.unit', e.target.value)}>
                  {DIM_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Weight</label>
                  <input type="number" min="0" step="0.01" value={form.weight.value} onChange={e => set('weight.value', e.target.value)} placeholder="0" />
                </div>
                <div className="cp-field">
                  <label>Weight Unit</label>
                  <select value={form.weight.unit} onChange={e => set('weight.unit', e.target.value)}>
                    {W_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(5)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(7)}>Next: Breadcrumbs →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 7 — Breadcrumbs
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 7 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Breadcrumbs</h2>
              <p className="cp-section-desc">Positions must be unique. Used for structured data breadcrumb trails.</p>

              {form.breadcrumbs.map((b, i) => (
                <div key={i} className="cp-spec-row">
                  <input type="text"   placeholder="Name"     value={b.name}     onChange={e => setBreadcrumb(i, 'name',     e.target.value)} />
                  <input type="text"   placeholder="URL"      value={b.url}      onChange={e => setBreadcrumb(i, 'url',      e.target.value)} />
                  <input type="number" placeholder="Position" value={b.position} onChange={e => setBreadcrumb(i, 'position', Number(e.target.value))} style={{ maxWidth: '80px' }} />
                  <button type="button" className="cp-btn cp-btn--icon-danger" onClick={() => removeBreadcrumb(i)}>×</button>
                </div>
              ))}

              <button type="button" className="cp-btn cp-btn--dashed" onClick={addBreadcrumb}>+ Add Breadcrumb</button>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(6)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(8)}>Next: SEO →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 8 — SEO
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 8 ? 'active' : ''}`}>
              <h2 className="cp-section-title">SEO</h2>

              <div className="cp-field cp-field--full">
                <label>Meta Title <span className="cp-hint-inline">max 60 chars</span></label>
                <input
                  type="text"
                  maxLength={60}
                  value={form.seo.metaTitle}
                  onChange={e => set('seo.metaTitle', e.target.value)}
                  placeholder="Auto-filled from product name if blank"
                />
                <span className="cp-hint">{form.seo.metaTitle.length}/60</span>
              </div>

              <div className="cp-field cp-field--full">
                <label>Meta Description <span className="cp-hint-inline">120–160 chars</span></label>
                <textarea
                  rows={3}
                  maxLength={160}
                  value={form.seo.metaDescription}
                  onChange={e => set('seo.metaDescription', e.target.value)}
                  placeholder="Min 120 characters enforced on create"
                />
                <span className={`cp-hint ${form.seo.metaDescription.length > 0 && form.seo.metaDescription.length < 120 ? 'cp-hint--warn' : ''}`}>
                  {form.seo.metaDescription.length}/160
                  {form.seo.metaDescription.length > 0 && form.seo.metaDescription.length < 120 ? ' — too short (min 120)' : ''}
                </span>
              </div>

              <div className="cp-field cp-field--full">
                <label>Focus Keyphrase</label>
                <input
                  type="text"
                  value={form.seo.focusKeyphrase}
                  onChange={e => set('seo.focusKeyphrase', e.target.value)}
                  placeholder="Primary keyword to rank for"
                />
              </div>

              <div className="cp-field">
                <label>Keywords</label>
                <div className="cp-tag-input">
                  <input
                    type="text"
                    value={kwInput}
                    onChange={e => setKwInput(e.target.value)}
                    placeholder="Add keyword and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToSeoArray('keywords', kwInput, setKwInput); }}}
                  />
                  <button type="button" onClick={() => addToSeoArray('keywords', kwInput, setKwInput)}>Add</button>
                </div>
                <div className="cp-tags">
                  {form.seo.keywords.map((k, i) => (
                    <span key={i} className="cp-tag">
                      {k}<button type="button" onClick={() => removeFromSeoArray('keywords', i)}>×</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="cp-field cp-field--full">
                <label>Canonical URL</label>
                <input
                  type="url"
                  value={form.seo.canonicalUrl}
                  onChange={e => set('seo.canonicalUrl', e.target.value)}
                  placeholder="https://yourdomain.com/products/..."
                />
              </div>

              <div className="cp-row">
                <div className="cp-field">
                  <label>Schema Type</label>
                  <select value={form.seo.schemaType} onChange={e => set('seo.schemaType', e.target.value)}>
                    {SCHEMA_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="cp-field">
                  <label>Condition</label>
                  <select value={form.seo.condition} onChange={e => set('seo.condition', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="cp-subsection">
                <h3 className="cp-subsection-title">Open Graph</h3>
                <div className="cp-field cp-field--full">
                  <label>OG Title</label>
                  <input
                    type="text"
                    maxLength={60}
                    value={form.seo.ogTitle}
                    onChange={e => set('seo.ogTitle', e.target.value)}
                    placeholder="Auto-filled from Meta Title if blank"
                  />
                </div>
                <div className="cp-field cp-field--full">
                  <label>OG Description</label>
                  <textarea
                    rows={2}
                    maxLength={160}
                    value={form.seo.ogDescription}
                    onChange={e => set('seo.ogDescription', e.target.value)}
                  />
                </div>
                <div className="cp-row">
                  <div className="cp-field">
                    <label>OG Image URL</label>
                    <input
                      type="url"
                      value={form.seo.ogImage}
                      onChange={e => set('seo.ogImage', e.target.value)}
                      placeholder="Auto-filled from primary image if blank"
                    />
                  </div>
                  <div className="cp-field">
                    <label>OG Type</label>
                    <select value={form.seo.ogType} onChange={e => set('seo.ogType', e.target.value)}>
                      {OG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="cp-subsection">
                <h3 className="cp-subsection-title">Twitter Card</h3>
                <div className="cp-row">
                  <div className="cp-field">
                    <label>Twitter Card Type</label>
                    <select value={form.seo.twitterCard} onChange={e => set('seo.twitterCard', e.target.value)}>
                      {TW_CARDS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="cp-field">
                    <label>Twitter Title</label>
                    <input
                      type="text"
                      maxLength={70}
                      value={form.seo.twitterTitle}
                      onChange={e => set('seo.twitterTitle', e.target.value)}
                    />
                  </div>
                </div>
                <div className="cp-field cp-field--full">
                  <label>Twitter Description</label>
                  <textarea
                    rows={2}
                    maxLength={200}
                    value={form.seo.twitterDescription}
                    onChange={e => set('seo.twitterDescription', e.target.value)}
                  />
                </div>
                <div className="cp-field cp-field--full">
                  <label>Twitter Image URL</label>
                  <input
                    type="url"
                    value={form.seo.twitterImage}
                    onChange={e => set('seo.twitterImage', e.target.value)}
                  />
                </div>
              </div>

              <div className="cp-subsection">
                <h3 className="cp-subsection-title">Related Search Terms</h3>
                <div className="cp-tag-input">
                  <input
                    type="text"
                    value={rstInput}
                    onChange={e => setRstInput(e.target.value)}
                    placeholder="Add term and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToSeoArray('relatedSearchTerms', rstInput, setRstInput); }}}
                  />
                  <button type="button" onClick={() => addToSeoArray('relatedSearchTerms', rstInput, setRstInput)}>Add</button>
                </div>
                <div className="cp-tags">
                  {form.seo.relatedSearchTerms.map((t, i) => (
                    <span key={i} className="cp-tag">
                      {t}<button type="button" onClick={() => removeFromSeoArray('relatedSearchTerms', i)}>×</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="cp-row">
                <div className="cp-field cp-field--checkbox">
                  <label className="cp-checkbox-label">
                    <input type="checkbox" checked={form.seo.noIndex}  onChange={e => set('seo.noIndex',  e.target.checked)} />
                    <span>No Index</span>
                  </label>
                </div>
                <div className="cp-field cp-field--checkbox">
                  <label className="cp-checkbox-label">
                    <input type="checkbox" checked={form.seo.noFollow} onChange={e => set('seo.noFollow', e.target.checked)} />
                    <span>No Follow</span>
                  </label>
                </div>
              </div>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(7)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(9)}>Next: Rich Snippets →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 9 — Rich Snippets
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 9 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Rich Snippets</h2>

              {/* FAQs */}
              <div className="cp-subsection" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                <h3 className="cp-subsection-title">FAQs <span className="cp-hint-inline">(questions must be unique)</span></h3>
                {form.richSnippets.faqs.map((faq, i) => (
                  <div key={i} className="cp-faq-block">
                    <div className="cp-faq-header">
                      <span>FAQ {i + 1}</span>
                      <button type="button" className="cp-btn cp-btn--icon-danger" onClick={() => removeFaq(i)}>×</button>
                    </div>
                    <input    type="text" placeholder="Question (max 200 chars)"  maxLength={200}  value={faq.question} onChange={e => setFaq(i, 'question', e.target.value)} />
                    <textarea rows={3}   placeholder="Answer (max 1000 chars)"   maxLength={1000} value={faq.answer}   onChange={e => setFaq(i, 'answer',   e.target.value)} />
                  </div>
                ))}
                <button type="button" className="cp-btn cp-btn--dashed" onClick={addFaq}>+ Add FAQ</button>
              </div>

              {/* How-To */}
              <div className="cp-subsection">
                <h3 className="cp-subsection-title">How-To</h3>
                <div className="cp-field">
                  <label>How-To Name</label>
                  <input
                    type="text"
                    value={form.richSnippets.howTo.name}
                    onChange={e => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, name: e.target.value } } }))}
                    placeholder="e.g. How to assemble the product"
                  />
                </div>
                {form.richSnippets.howTo.steps.map((step, i) => (
                  <div key={i} className="cp-faq-block">
                    <div className="cp-faq-header">
                      <span>Step {i + 1}</span>
                      <button type="button" className="cp-btn cp-btn--icon-danger" onClick={() => removeHowToStep(i)}>×</button>
                    </div>
                    <input    type="text" placeholder="Step name"                       value={step.name}  onChange={e => setHowToStep(i, 'name',  e.target.value)} />
                    <textarea rows={2}   placeholder="Step instructions"               value={step.text}  onChange={e => setHowToStep(i, 'text',  e.target.value)} />
                    <input    type="url" placeholder="Step image URL (optional)"       value={step.image} onChange={e => setHowToStep(i, 'image', e.target.value)} />
                  </div>
                ))}
                <button type="button" className="cp-btn cp-btn--dashed" onClick={addHowToStep}>+ Add Step</button>
              </div>

              {/* Videos */}
              <div className="cp-subsection">
                <h3 className="cp-subsection-title">Videos</h3>
                {form.richSnippets.videos.map((video, i) => (
                  <div key={i} className="cp-faq-block">
                    <div className="cp-faq-header">
                      <span>Video {i + 1}</span>
                      <button type="button" className="cp-btn cp-btn--icon-danger" onClick={() => removeVideo(i)}>×</button>
                    </div>
                    <div className="cp-row">
                      <input type="text" placeholder="Video name"    value={video.name}       onChange={e => setVideo(i, 'name',       e.target.value)} />
                      <input type="date" placeholder="Upload date"   value={video.uploadDate} onChange={e => setVideo(i, 'uploadDate', e.target.value)} />
                    </div>
                    <textarea rows={2}   placeholder="Description"   value={video.description}  onChange={e => setVideo(i, 'description',  e.target.value)} />
                    <input type="url"    placeholder="Thumbnail URL" value={video.thumbnailUrl}  onChange={e => setVideo(i, 'thumbnailUrl',  e.target.value)} />
                    <input type="url"    placeholder="Content URL"   value={video.contentUrl}    onChange={e => setVideo(i, 'contentUrl',    e.target.value)} />
                    <input type="url"    placeholder="Embed URL"     value={video.embedUrl}      onChange={e => setVideo(i, 'embedUrl',      e.target.value)} />
                    <input type="text"   placeholder="Duration (ISO 8601, e.g. PT2M30S)" value={video.duration} onChange={e => setVideo(i, 'duration', e.target.value)} />
                  </div>
                ))}
                <button type="button" className="cp-btn cp-btn--dashed" onClick={addVideo}>+ Add Video</button>
              </div>

              <div className="cp-section-nav">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(8)}>← Back</button>
                <button type="button" className="cp-btn cp-btn--primary" onClick={() => setActiveSection(10)}>Next: Relationships →</button>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────────
                SECTION 10 — Relationships & Flags
            ──────────────────────────────────────────────────────────── */}
            <div className={`cp-section ${activeSection === 10 ? 'active' : ''}`}>
              <h2 className="cp-section-title">Relationships & Flags</h2>

              <div className="cp-field cp-field--full">
                <label>Related Products <span className="cp-hint-inline">comma-separated product IDs</span></label>
                <input
                  type="text"
                  value={form.relatedProducts}
                  onChange={e => set('relatedProducts', e.target.value)}
                  placeholder="6507f1f77bcf86cd79..."
                />
              </div>
              <div className="cp-field cp-field--full">
                <label>Cross-Sells <span className="cp-hint-inline">comma-separated product IDs</span></label>
                <input
                  type="text"
                  value={form.crossSells}
                  onChange={e => set('crossSells', e.target.value)}
                  placeholder="6507f1f77bcf86cd79..."
                />
              </div>
              <div className="cp-field cp-field--full">
                <label>Upsells <span className="cp-hint-inline">comma-separated product IDs</span></label>
                <input
                  type="text"
                  value={form.upsells}
                  onChange={e => set('upsells', e.target.value)}
                  placeholder="6507f1f77bcf86cd79..."
                />
              </div>

              <div className="cp-subsection">
                <h3 className="cp-subsection-title">Product Flags</h3>
                <div className="cp-flag-grid">
                  <label className="cp-toggle-label">
                    <input type="checkbox" checked={form.isFeatured}   onChange={e => set('isFeatured',   e.target.checked)} />
                    <span className="cp-toggle-track"><span className="cp-toggle-thumb" /></span>
                    <span>Featured</span>
                  </label>
                  <label className="cp-toggle-label">
                    <input type="checkbox" checked={form.isNewArrival} onChange={e => set('isNewArrival', e.target.checked)} />
                    <span className="cp-toggle-track"><span className="cp-toggle-thumb" /></span>
                    <span>New Arrival</span>
                  </label>
                  <label className="cp-toggle-label">
                    <input type="checkbox" checked={form.isBestseller} onChange={e => set('isBestseller', e.target.checked)} />
                    <span className="cp-toggle-track"><span className="cp-toggle-thumb" /></span>
                    <span>Bestseller</span>
                  </label>
                </div>
              </div>

              <div className="cp-section-nav cp-section-nav--submit">
                <button type="button" className="cp-btn cp-btn--ghost" onClick={() => setActiveSection(9)}>← Back</button>
                <button type="submit" className="cp-btn cp-btn--submit" disabled={loading}>
                  {loading ? <><span className="cp-spinner" /> Creating Product…</> : 'Create Product'}
                </button>
              </div>
            </div>

          </form>
        </div>
      </main>

      <Footer />
    </>
  );
}