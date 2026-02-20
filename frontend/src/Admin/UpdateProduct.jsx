import { useEffect, useState, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import {
  fetchAdminProductDetails,
  updateProduct,
  fetchProductStructuredData,
  clearUpdateStatus,
  clearSelectedProduct,
  selectSelectedProduct,
  selectSelectedProductLoading,
  selectSelectedProductError,
  selectUpdateStatus,
  selectStructuredData,
  selectStructuredDataLoading,
} from '../features/admin/adminProductSlice';
import '../AdminStyles/UpdateProduct.css';

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
  'Basic Info','Pricing','Inventory','Images',
  'Variants','Specifications','Dimensions & Weight',
  'Breadcrumbs','SEO','Rich Snippets','Relationships & Flags',
];

// ── SaveButton — hoisted outside UpdateProduct so it is never recreated during
//    render (fixes react-hooks/static-components across all 11 call sites).
// ─────────────────────────────────────────────────────────────────────────────
function SaveButton({ loading, onSave }) {
  return (
    <button
      type="button"
      className="up-btn up-btn--submit"
      disabled={loading}
      onClick={onSave}
    >
      {loading ? <><span className="up-spinner" /> Saving…</> : 'Save Changes'}
    </button>
  );
}

// ── hydrate form from existing product ────────────────────────────────────────
const hydrateForm = (p) => ({
  name:             p.name             || '',
  description:      p.description      || '',
  shortDescription: p.shortDescription || '',
  category:         p.category         || '',
  brand:            p.brand            || '',
  manufacturer:     p.manufacturer     || '',
  status:           p.status           || 'published',
  pricing: {
    regular:      p.pricing?.regular      ?? '',
    sale:         p.pricing?.sale         ?? '',
    cost:         p.pricing?.cost         ?? '',
    currency:     p.pricing?.currency     || 'USD',
    validFrom:    p.pricing?.validFrom    ? p.pricing.validFrom.substring(0, 10)    : '',
    validThrough: p.pricing?.validThrough ? p.pricing.validThrough.substring(0, 10) : '',
  },
  inventory: {
    stock:             p.inventory?.stock             ?? '',
    sku:               p.inventory?.sku               || '',
    gtin:              p.inventory?.gtin              || '',
    mpn:               p.inventory?.mpn               || '',
    barcode:           p.inventory?.barcode           || '',
    trackInventory:    p.inventory?.trackInventory    ?? true,
    lowStockThreshold: p.inventory?.lowStockThreshold ?? 5,
    status:            p.inventory?.status            || 'InStock',
  },
  dimensions: {
    length: p.dimensions?.length ?? '',
    width:  p.dimensions?.width  ?? '',
    height: p.dimensions?.height ?? '',
    unit:   p.dimensions?.unit   || 'cm',
  },
  weight: {
    value: p.weight?.value ?? '',
    unit:  p.weight?.unit  || 'kg',
  },
  subcategories:  p.subcategories  || [],
  tags:           p.tags           || [],
  specifications: p.specifications || [],
  variants:       p.variants       || [],
  breadcrumbs:    p.breadcrumbs    || [],
  isFeatured:     p.isFeatured     || false,
  isNewArrival:   p.isNewArrival   || false,
  isBestseller:   p.isBestseller   || false,
  seo: {
    metaTitle:          p.seo?.metaTitle          || '',
    metaDescription:    p.seo?.metaDescription    || '',
    keywords:           p.seo?.keywords           || [],
    canonicalUrl:       p.seo?.canonicalUrl       || '',
    noIndex:            p.seo?.noIndex            || false,
    noFollow:           p.seo?.noFollow           || false,
    ogTitle:            p.seo?.ogTitle            || '',
    ogDescription:      p.seo?.ogDescription      || '',
    ogImage:            p.seo?.ogImage            || '',
    ogType:             p.seo?.ogType             || 'product',
    twitterCard:        p.seo?.twitterCard        || 'summary_large_image',
    twitterTitle:       p.seo?.twitterTitle       || '',
    twitterDescription: p.seo?.twitterDescription || '',
    twitterImage:       p.seo?.twitterImage       || '',
    schemaType:         p.seo?.schemaType         || 'Product',
    condition:          p.seo?.condition          || 'NewCondition',
    availability:       p.seo?.availability       || 'InStock',
    focusKeyphrase:     p.seo?.focusKeyphrase     || '',
    relatedSearchTerms: p.seo?.relatedSearchTerms || [],
  },
  richSnippets: {
    faqs:   p.richSnippets?.faqs   || [],
    howTo:  p.richSnippets?.howTo  || { name: '', steps: [] },
    videos: p.richSnippets?.videos || [],
  },
  // Populated refs are hydrated back to comma-separated ID strings for the text inputs
  relatedProducts: p.relatedProducts?.map(r => r._id || r).join(', ') || '',
  crossSells:      p.crossSells?.map(r => r._id || r).join(', ')      || '',
  upsells:         p.upsells?.map(r => r._id || r).join(', ')         || '',
});

export default function UpdateProduct() {
  const { id }  = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const product               = useSelector(selectSelectedProduct);
  const fetchLoading          = useSelector(selectSelectedProductLoading);
  const fetchError            = useSelector(selectSelectedProductError);
  const updateStatus          = useSelector(selectUpdateStatus);
  const structuredData        = useSelector(selectStructuredData);
  const structuredDataLoading = useSelector(selectStructuredDataLoading);

  const [form,           setForm]          = useState(null);
  const [activeSection,  setActiveSection] = useState(0);
  const [existingImages, setExistingImages]= useState([]);
  const [newImages,      setNewImages]     = useState([]);
  const [imagesToDelete, setImagesToDelete]= useState([]);
  const [imageMetadata,  setImageMetadata] = useState([]);
  const [tagInput,       setTagInput]      = useState('');
  const [subInput,       setSubInput]      = useState('');
  const [kwInput,        setKwInput]       = useState('');
  const [rstInput,       setRstInput]      = useState('');
  const [toast,          setToast]         = useState(null);
  const [errors,         setErrors]        = useState({});
  const [showJSON,       setShowJSON]      = useState(false);
  const fileRef = useRef();

  // ── fetch product on mount ─────────────────────────────────────────────────
  useEffect(() => {
    dispatch(fetchAdminProductDetails(id));
    return () => dispatch(clearSelectedProduct());
  }, [id, dispatch]);

  // Scroll to top when navigating between sections
useEffect(() => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}, [activeSection]);

  // ── hydrate form when product loads ───────────────────────────────────────
  // eslint-disable-next-line react-hooks/set-state-in-effect
  // Initialising local form state from async-loaded Redux data is a legitimate
  // use of setState inside an effect; the rule is overly broad here.
  useEffect(() => {
    if (product) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(hydrateForm(product));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExistingImages(product.images || []);
    }
  }, [product]);

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── update success / error ─────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/set-state-in-effect
  // Responding to an async Redux action result (not syncing external state into
  // React) is a valid pattern; showToast → setToast is intentional here.
  useEffect(() => {
    if (updateStatus.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      showToast('Product updated successfully!');
      dispatch(clearUpdateStatus());
    }
    if (updateStatus.error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      showToast(updateStatus.error, 'error');
      dispatch(clearUpdateStatus());
    }
  }, [updateStatus, dispatch, showToast]);

  // ── generic deep-setter ────────────────────────────────────────────────────
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

  // ── derived pricing stats (mirrors CreateProduct — no state needed) ────────
  const pricingStats = (() => {
    if (!form) return { discount: null, saving: null, margin: null, saleMargin: null };
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

  // ── existing image handlers ────────────────────────────────────────────────
  const markForDeletion = (publicId) => {
    setImagesToDelete(prev => [...prev, publicId]);
    setExistingImages(prev => prev.filter(img => img.public_id !== publicId));
  };
  const updateExistingImageMeta = (idx, field, value) =>
    setExistingImages(prev => prev.map((img, i) => i === idx ? { ...img, [field]: value } : img));
  const setPrimaryImage = (publicId) =>
    setExistingImages(prev => prev.map(img => ({ ...img, isPrimary: img.public_id === publicId })));

  // ── new image handlers ─────────────────────────────────────────────────────
  const handleImageAdd = (e) => {
    const files   = Array.from(e.target.files);
    const newImgs = files.map(file => ({ file, preview: URL.createObjectURL(file), alt: '', caption: '' }));
    setNewImages(prev => [...prev, ...newImgs]);
    setImageMetadata(prev => [...prev, ...newImgs.map(img => ({ alt: img.alt, caption: img.caption }))]);
    e.target.value = '';
  };
  const removeNewImage = (idx) => {
    setNewImages(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx); });
    setImageMetadata(prev => prev.filter((_, i) => i !== idx));
  };
  const updateNewImageMeta = (idx, field, value) => {
    setNewImages(prev => prev.map((img, i) => i === idx ? { ...img, [field]: value } : img));
    setImageMetadata(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  // ── array helpers ──────────────────────────────────────────────────────────
  const addToArray         = (field, value, setter) => { if (!value.trim()) return; setForm(prev => ({ ...prev, [field]: [...prev[field], value.trim()] })); setter(''); };
  const removeFromArray    = (field, idx) => setForm(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));
  const addToSeoArray      = (field, value, setter) => { if (!value.trim()) return; setForm(prev => ({ ...prev, seo: { ...prev.seo, [field]: [...prev.seo[field], value.trim()] } })); setter(''); };
  const removeFromSeoArray = (field, idx) => setForm(prev => ({ ...prev, seo: { ...prev.seo, [field]: prev.seo[field].filter((_, i) => i !== idx) } }));

  // ── spec helpers ───────────────────────────────────────────────────────────
  const addSpec    = () => setForm(prev => ({ ...prev, specifications: [...prev.specifications, { key: '', value: '' }] }));
  const setSpec    = (idx, field, val) => setForm(prev => ({ ...prev, specifications: prev.specifications.map((s, i) => i === idx ? { ...s, [field]: val } : s) }));
  const removeSpec = (idx) => setForm(prev => ({ ...prev, specifications: prev.specifications.filter((_, i) => i !== idx) }));

  // ── variant helpers ────────────────────────────────────────────────────────
  const addVariant          = () => setForm(prev => ({ ...prev, variants: [...prev.variants, { name: '', options: [{ value: '', priceModifier: 0, stock: 0, sku: '', gtin: '' }] }] }));
  const setVariant          = (vi, field, val) => setForm(prev => ({ ...prev, variants: prev.variants.map((v, i) => i === vi ? { ...v, [field]: val } : v) }));
  const removeVariant       = (vi) => setForm(prev => ({ ...prev, variants: prev.variants.filter((_, i) => i !== vi) }));
  const addVariantOption    = (vi) => setForm(prev => ({ ...prev, variants: prev.variants.map((v, i) => i === vi ? { ...v, options: [...v.options, { value: '', priceModifier: 0, stock: 0, sku: '', gtin: '' }] } : v) }));
  const setVariantOption    = (vi, oi, field, val) => setForm(prev => ({ ...prev, variants: prev.variants.map((v, i) => i === vi ? { ...v, options: v.options.map((o, j) => j === oi ? { ...o, [field]: val } : o) } : v) }));
  const removeVariantOption = (vi, oi) => setForm(prev => ({ ...prev, variants: prev.variants.map((v, i) => i === vi ? { ...v, options: v.options.filter((_, j) => j !== oi) } : v) }));

  // ── breadcrumb helpers ─────────────────────────────────────────────────────
  const addBreadcrumb    = () => setForm(prev => ({ ...prev, breadcrumbs: [...prev.breadcrumbs, { name: '', url: '', position: prev.breadcrumbs.length + 1 }] }));
  const setBreadcrumb    = (idx, field, val) => setForm(prev => ({ ...prev, breadcrumbs: prev.breadcrumbs.map((b, i) => i === idx ? { ...b, [field]: val } : b) }));
  const removeBreadcrumb = (idx) => setForm(prev => ({ ...prev, breadcrumbs: prev.breadcrumbs.filter((_, i) => i !== idx) }));

  // ── FAQ helpers ────────────────────────────────────────────────────────────
  const addFaq    = () => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, faqs: [...prev.richSnippets.faqs, { question: '', answer: '' }] } }));
  const setFaq    = (idx, field, val) => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, faqs: prev.richSnippets.faqs.map((f, i) => i === idx ? { ...f, [field]: val } : f) } }));
  const removeFaq = (idx) => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, faqs: prev.richSnippets.faqs.filter((_, i) => i !== idx) } }));

  // ── HowTo helpers ──────────────────────────────────────────────────────────
  const addHowToStep    = () => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, steps: [...prev.richSnippets.howTo.steps, { name: '', text: '', image: '' }] } } }));
  const setHowToStep    = (idx, field, val) => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, steps: prev.richSnippets.howTo.steps.map((s, i) => i === idx ? { ...s, [field]: val } : s) } } }));
  const removeHowToStep = (idx) => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, steps: prev.richSnippets.howTo.steps.filter((_, i) => i !== idx) } } }));

  // ── Video helpers ──────────────────────────────────────────────────────────
  const addVideo    = () => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, videos: [...prev.richSnippets.videos, { name: '', description: '', thumbnailUrl: '', uploadDate: '', contentUrl: '', embedUrl: '', duration: '' }] } }));
  const setVideo    = (idx, field, val) => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, videos: prev.richSnippets.videos.map((v, i) => i === idx ? { ...v, [field]: val } : v) } }));
  const removeVideo = (idx) => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, videos: prev.richSnippets.videos.filter((_, i) => i !== idx) } }));

  // ── validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.name.trim())        e.name        = 'Product name is required';
    if (!form.description.trim()) e.description = 'Description is required';
    if (!form.category)           e.category    = 'Category is required';
    if (!form.pricing.regular)    e.regular     = 'Regular price is required';
    if (form.pricing.sale && Number(form.pricing.sale) >= Number(form.pricing.regular))
      e.sale = 'Sale price must be less than regular price';
    if (existingImages.length + newImages.length === 0)
      e.images = 'At least one image is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── parse comma-separated IDs → JSON array string for the controller ───────
  // FIX: controller's parseIds expects JSON.stringify([...]), not a raw CSV string
  const serializeIds = (str) =>
    JSON.stringify(
      str.split(',').map(s => s.trim()).filter(Boolean)
    );

  // ── build FormData & dispatch ──────────────────────────────────────────────
  const buildAndSubmit = () => {
    if (!validate()) { showToast('Please fix the errors below', 'error'); return; }

    const fd = new FormData();
    fd.append('name',             form.name);
    fd.append('description',      form.description);
    fd.append('shortDescription', form.shortDescription);
    fd.append('category',         form.category);
    fd.append('brand',            form.brand);
    fd.append('manufacturer',     form.manufacturer);
    fd.append('status',           form.status);
    fd.append('isFeatured',       form.isFeatured);
    fd.append('isNewArrival',     form.isNewArrival);
    fd.append('isBestseller',     form.isBestseller);
    fd.append('pricing',          JSON.stringify(form.pricing));
    fd.append('inventory',        JSON.stringify(form.inventory));
    fd.append('dimensions',       JSON.stringify(form.dimensions));
    fd.append('weight',           JSON.stringify(form.weight));
    fd.append('subcategories',    JSON.stringify(form.subcategories));
    fd.append('tags',             JSON.stringify(form.tags));
    fd.append('specifications',   JSON.stringify(form.specifications));
    fd.append('variants',         JSON.stringify(form.variants));
    fd.append('breadcrumbs',      JSON.stringify(form.breadcrumbs));
    fd.append('seo',              JSON.stringify(form.seo));
    fd.append('richSnippets',     JSON.stringify(form.richSnippets));
    // FIX: serialize CSV strings → JSON arrays so controller's parseIds works correctly
    fd.append('relatedProducts',  serializeIds(form.relatedProducts));
    fd.append('crossSells',       serializeIds(form.crossSells));
    fd.append('upsells',          serializeIds(form.upsells));
    fd.append('imagesToDelete',   JSON.stringify(imagesToDelete));
    fd.append('existingImages',   JSON.stringify(existingImages));
    fd.append('imageMetadata',    JSON.stringify(imageMetadata));
    newImages.forEach(img => fd.append('images', img.file));

    dispatch(updateProduct({ id, formData: fd }));
  };

  const handleSubmit = (e) => { e.preventDefault(); buildAndSubmit(); };

  // ── structured data panel ──────────────────────────────────────────────────
  const handleViewStructuredData = () => {
    if (!structuredData) dispatch(fetchProductStructuredData(id));
    setShowJSON(v => !v);
  };

  if (fetchLoading || !form) 
    return( 
      <>  
      <Navbar />
      <Loader />
      <Footer />
      </>
);

  if (fetchError) return (
    <div className="up-fetch-error">
      <p>{fetchError}</p>
      <button onClick={() => dispatch(fetchAdminProductDetails(id))}>Retry</button>
    </div>
  );

  return (
    <>
      <PageTitle title={`Edit: ${product?.name || 'Product'} — Admin`} />
      <Navbar />

      <main className="up-main">
        {toast && (
          <div className={`up-toast up-toast--${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : '✕'}</span> {toast.msg}
          </div>
        )}

        {/* ── Header ── */}
        <div className="up-header">
          <button className="up-back" onClick={() => navigate('/admin/products')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Products
          </button>
          <div className="up-header__center">
            <h1 className="up-title">Edit Product</h1>
            {product?.slug && (
              <span className="up-slug">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                /products/{product.slug}
              </span>
            )}
          </div>
          <button
            className="up-btn up-btn--ghost up-btn--structured"
            onClick={handleViewStructuredData}
            disabled={structuredDataLoading}
          >
            {structuredDataLoading ? '…' : (showJSON ? 'Hide JSON-LD' : 'View JSON-LD')}
          </button>
        </div>

        {/* ── Slug History Banner ── */}
        {product?.slugHistory?.length > 0 && (
          <div className="up-slug-history">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Previous slugs (301 redirected):</span>
            {product.slugHistory.map((h, i) => (
              <code key={i}>{h.oldSlug}</code>
            ))}
          </div>
        )}

        {/* ── Structured Data JSON Panel ── */}
        {showJSON && structuredData && (
          <div className="up-json-panel">
            <div className="up-json-header">
              <span>JSON-LD Structured Data</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(JSON.stringify(structuredData, null, 2))}>
                Copy
              </button>
            </div>
            <pre className="up-json-body">{JSON.stringify(structuredData, null, 2)}</pre>
          </div>
        )}

        <div className="up-layout">

          {/* ── Sidebar ── */}
          <aside className="up-sidebar">
            {SECTIONS.map((s, i) => (
              <button
                key={s}
                className={`up-nav-item ${activeSection === i ? 'active' : ''}`}
                onClick={() => setActiveSection(i)}
              >
                <span className="up-nav-num">{i + 1}</span>
                {s}
              </button>
            ))}

            {product && (
              <div className="up-sidebar-stats">
                <div className="up-sidebar-stat"><span>Views</span><strong>{product.analytics?.views ?? 0}</strong></div>
                <div className="up-sidebar-stat"><span>Purchases</span><strong>{product.analytics?.purchases ?? 0}</strong></div>
                <div className="up-sidebar-stat"><span>Rating</span><strong>{product.ratings != null ? Number(product.ratings).toFixed(1) : '—'}</strong></div>
                <div className="up-sidebar-stat"><span>Reviews</span><strong>{product.numOfReviews ?? 0}</strong></div>
              </div>
            )}
          </aside>

          {/* ── Form ── */}
          <form className="up-form" onSubmit={handleSubmit} noValidate>

            {/* ── 0: Basic Info ── */}
            <div className={`up-section ${activeSection === 0 ? 'active' : ''}`}>
              <h2 className="up-section-title">Basic Information</h2>

              <div className="up-field up-field--full">
                <label>Product Name <span className="up-req">*</span></label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} maxLength={200} />
                {errors.name && <span className="up-error">{errors.name}</span>}
                <span className="up-hint">{form.name.length}/200</span>
              </div>

              <div className="up-field up-field--full">
                <label>Description <span className="up-req">*</span></label>
                <textarea rows={5} value={form.description} onChange={e => set('description', e.target.value)} maxLength={5000} />
                {errors.description && <span className="up-error">{errors.description}</span>}
                <span className="up-hint">{form.description.length}/5000</span>
              </div>

              <div className="up-field up-field--full">
                <label>Short Description</label>
                <textarea rows={2} value={form.shortDescription} onChange={e => set('shortDescription', e.target.value)} maxLength={500} />
                <span className="up-hint">{form.shortDescription.length}/500</span>
              </div>

              <div className="up-row">
                <div className="up-field">
                  <label>Category <span className="up-req">*</span></label>
                  <select value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="">Select category</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {errors.category && <span className="up-error">{errors.category}</span>}
                </div>
                <div className="up-field">
                  <label>Status</label>
                  <select value={form.status} onChange={e => set('status', e.target.value)}>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="up-row">
                <div className="up-field">
                  <label>Brand</label>
                  <input type="text" value={form.brand} onChange={e => set('brand', e.target.value)} />
                </div>
                <div className="up-field">
                  <label>Manufacturer</label>
                  <input type="text" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} />
                </div>
              </div>

              <div className="up-field">
                <label>Subcategories</label>
                <div className="up-tag-input">
                  <input type="text" value={subInput} onChange={e => setSubInput(e.target.value)} placeholder="Add and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToArray('subcategories', subInput, setSubInput); }}} />
                  <button type="button" onClick={() => addToArray('subcategories', subInput, setSubInput)}>Add</button>
                </div>
                <div className="up-tags">
                  {form.subcategories.map((s, i) => (
                    <span key={i} className="up-tag">{s}<button type="button" onClick={() => removeFromArray('subcategories', i)}>×</button></span>
                  ))}
                </div>
              </div>

              <div className="up-field">
                <label>Tags</label>
                <div className="up-tag-input">
                  <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="Add tag and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToArray('tags', tagInput, setTagInput); }}} />
                  <button type="button" onClick={() => addToArray('tags', tagInput, setTagInput)}>Add</button>
                </div>
                <div className="up-tags">
                  {form.tags.map((t, i) => (
                    <span key={i} className="up-tag">{t}<button type="button" onClick={() => removeFromArray('tags', i)}>×</button></span>
                  ))}
                </div>
              </div>

              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(1)}>Next: Pricing →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 1: Pricing ── */}
            <div className={`up-section ${activeSection === 1 ? 'active' : ''}`}>
              <h2 className="up-section-title">Pricing</h2>
              <div className="up-row">
                <div className="up-field">
                  <label>Regular Price <span className="up-req">*</span></label>
                  <div className="up-input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={form.pricing.regular} onChange={e => set('pricing.regular', e.target.value)} /></div>
                  {errors.regular && <span className="up-error">{errors.regular}</span>}
                </div>
                <div className="up-field">
                  <label>Sale Price</label>
                  <div className="up-input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={form.pricing.sale} onChange={e => set('pricing.sale', e.target.value)} /></div>
                  {errors.sale && <span className="up-error">{errors.sale}</span>}
                </div>
              </div>
              <div className="up-row">
                <div className="up-field">
                  <label>Cost Price</label>
                  <div className="up-input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={form.pricing.cost} onChange={e => set('pricing.cost', e.target.value)} /></div>
                </div>
                <div className="up-field">
                  <label>Currency</label>
                  <select value={form.pricing.currency} onChange={e => set('pricing.currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="up-row">
                <div className="up-field"><label>Valid From</label><input type="date" value={form.pricing.validFrom} onChange={e => set('pricing.validFrom', e.target.value)} /></div>
                <div className="up-field"><label>Valid Through</label><input type="date" value={form.pricing.validThrough} onChange={e => set('pricing.validThrough', e.target.value)} /></div>
              </div>

              {/* FIX: live pricing stats — mirrors CreateProduct behaviour */}
              {(pricingStats.discount !== null || pricingStats.margin !== null) && (
                <div className="up-pricing-stats">
                  {pricingStats.discount !== null && (
                    <div className="up-pricing-stat up-pricing-stat--discount">
                      <span className="up-pricing-stat__label">Discount</span>
                      <span className="up-pricing-stat__value">-{pricingStats.discount}%</span>
                      <span className="up-pricing-stat__sub">
                        Customer saves {form.pricing.currency} {pricingStats.saving}
                      </span>
                    </div>
                  )}
                  {pricingStats.margin !== null && (
                    <div className={`up-pricing-stat ${pricingStats.margin < 20 ? 'up-pricing-stat--warn' : 'up-pricing-stat--good'}`}>
                      <span className="up-pricing-stat__label">Margin (Regular)</span>
                      <span className="up-pricing-stat__value">{pricingStats.margin}%</span>
                      <span className="up-pricing-stat__sub">
                        {pricingStats.margin < 20 ? '⚠ Low margin' : '✓ Healthy margin'}
                      </span>
                    </div>
                  )}
                  {pricingStats.saleMargin !== null && (
                    <div className={`up-pricing-stat ${pricingStats.saleMargin < 10 ? 'up-pricing-stat--danger' : pricingStats.saleMargin < 20 ? 'up-pricing-stat--warn' : 'up-pricing-stat--good'}`}>
                      <span className="up-pricing-stat__label">Margin (Sale)</span>
                      <span className="up-pricing-stat__value">{pricingStats.saleMargin}%</span>
                      <span className="up-pricing-stat__sub">
                        {pricingStats.saleMargin < 10 ? '⚠ Very low — check cost' : pricingStats.saleMargin < 20 ? '⚠ Low on sale price' : '✓ OK on sale'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(0)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(2)}>Next: Inventory →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 2: Inventory ── */}
            <div className={`up-section ${activeSection === 2 ? 'active' : ''}`}>
              <h2 className="up-section-title">Inventory</h2>
              <div className="up-row">
                <div className="up-field"><label>Stock</label><input type="number" min="0" value={form.inventory.stock} onChange={e => set('inventory.stock', e.target.value)} /></div>
                <div className="up-field"><label>Low Stock Threshold</label><input type="number" min="0" value={form.inventory.lowStockThreshold} onChange={e => set('inventory.lowStockThreshold', e.target.value)} /></div>
              </div>
              <div className="up-row">
                <div className="up-field"><label>SKU</label><input type="text" value={form.inventory.sku} onChange={e => set('inventory.sku', e.target.value)} /></div>
                <div className="up-field">
                  <label>Inventory Status</label>
                  <select value={form.inventory.status} onChange={e => set('inventory.status', e.target.value)}>
                    {INV_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="up-hint">Auto-recalculated from stock on save unless Discontinued</span>
                </div>
              </div>
              <div className="up-row">
                <div className="up-field"><label>GTIN</label><input type="text" value={form.inventory.gtin} onChange={e => set('inventory.gtin', e.target.value)} /></div>
                <div className="up-field"><label>MPN</label><input type="text" value={form.inventory.mpn} onChange={e => set('inventory.mpn', e.target.value)} /></div>
              </div>
              <div className="up-row">
                <div className="up-field"><label>Barcode</label><input type="text" value={form.inventory.barcode} onChange={e => set('inventory.barcode', e.target.value)} /></div>
                <div className="up-field up-field--checkbox">
                  <label className="up-checkbox-label">
                    <input type="checkbox" checked={form.inventory.trackInventory} onChange={e => set('inventory.trackInventory', e.target.checked)} />
                    <span>Track Inventory</span>
                  </label>
                </div>
              </div>
              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(1)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(3)}>Next: Images →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 3: Images ── */}
            <div className={`up-section ${activeSection === 3 ? 'active' : ''}`}>
              <h2 className="up-section-title">Images</h2>
              {errors.images && <div className="up-error up-error--block">{errors.images}</div>}

              {existingImages.length > 0 && (
                <>
                  <h3 className="up-subsection-title">Current Images</h3>
                  <div className="up-image-grid">
                    {existingImages.map((img, i) => (
                      <div key={img.public_id} className={`up-image-card ${img.isPrimary ? 'up-image-card--primary' : ''}`}>
                        <div className="up-image-preview">
                          <img src={img.url} alt={img.alt || `Product image ${i + 1}`} loading="lazy" />
                          {img.isPrimary && <span className="up-image-badge">Primary</span>}
                          <div className="up-image-overlay">
                            <button type="button" className="up-image-action" onClick={() => setPrimaryImage(img.public_id)} title="Set as primary">★</button>
                            <button type="button" className="up-image-action up-image-action--delete" onClick={() => markForDeletion(img.public_id)} title="Remove">×</button>
                          </div>
                        </div>
                        <div className="up-image-meta">
                          <input type="text" placeholder="Alt text (max 125 chars)" maxLength={125} value={img.alt || ''} onChange={e => updateExistingImageMeta(i, 'alt', e.target.value)} />
                          <input type="text" placeholder="Caption (max 200 chars)" maxLength={200} value={img.caption || ''} onChange={e => updateExistingImageMeta(i, 'caption', e.target.value)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {imagesToDelete.length > 0 && (
                <div className="up-delete-warn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {imagesToDelete.length} image{imagesToDelete.length !== 1 ? 's' : ''} will be deleted from Cloudinary on save
                </div>
              )}

              <h3 className="up-subsection-title">Add New Images</h3>
              <div className="up-dropzone" onClick={() => fileRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p>Click or drag to add more images</p>
                <input ref={fileRef} type="file" multiple accept="image/*" onChange={handleImageAdd} style={{ display: 'none' }} />
              </div>

              {newImages.length > 0 && (
                <div className="up-image-grid">
                  {newImages.map((img, i) => (
                    <div key={i} className="up-image-card">
                      <div className="up-image-preview">
                        <img src={img.preview} alt={img.alt || `New image ${i + 1}`} />
                        <span className="up-image-badge up-image-badge--new">New</span>
                        <button type="button" className="up-image-remove" onClick={() => removeNewImage(i)}>×</button>
                      </div>
                      <div className="up-image-meta">
                        <input type="text" placeholder="Alt text (max 125 chars)" maxLength={125} value={img.alt} onChange={e => updateNewImageMeta(i, 'alt', e.target.value)} />
                        <input type="text" placeholder="Caption (optional, max 200 chars)" maxLength={200} value={img.caption} onChange={e => updateNewImageMeta(i, 'caption', e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(2)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(4)}>Next: Variants →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 4: Variants ── */}
            <div className={`up-section ${activeSection === 4 ? 'active' : ''}`}>
              <h2 className="up-section-title">Variants</h2>
              {form.variants.map((variant, vi) => (
                <div key={vi} className="up-variant-block">
                  <div className="up-variant-header">
                    <input type="text" placeholder="Variant name" value={variant.name} onChange={e => setVariant(vi, 'name', e.target.value)} />
                    <button type="button" className="up-btn up-btn--danger-sm" onClick={() => removeVariant(vi)}>Remove</button>
                  </div>
                  {variant.options.map((opt, oi) => (
                    <div key={oi} className="up-variant-option">
                      <input type="text"   placeholder="Value"     value={opt.value}         onChange={e => setVariantOption(vi, oi, 'value', e.target.value)} />
                      <input type="number" placeholder="Price mod" value={opt.priceModifier} onChange={e => setVariantOption(vi, oi, 'priceModifier', e.target.value)} />
                      <input type="number" placeholder="Stock"     value={opt.stock}         onChange={e => setVariantOption(vi, oi, 'stock', e.target.value)} />
                      <input type="text"   placeholder="SKU"       value={opt.sku}           onChange={e => setVariantOption(vi, oi, 'sku', e.target.value)} />
                      <input type="text"   placeholder="GTIN"      value={opt.gtin}          onChange={e => setVariantOption(vi, oi, 'gtin', e.target.value)} />
                      <button type="button" className="up-btn up-btn--icon-danger" onClick={() => removeVariantOption(vi, oi)}>×</button>
                    </div>
                  ))}
                  <button type="button" className="up-btn up-btn--ghost-sm" onClick={() => addVariantOption(vi)}>+ Add Option</button>
                </div>
              ))}
              <button type="button" className="up-btn up-btn--dashed" onClick={addVariant}>+ Add Variant</button>
              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(3)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(5)}>Next: Specifications →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 5: Specifications ── */}
            <div className={`up-section ${activeSection === 5 ? 'active' : ''}`}>
              <h2 className="up-section-title">Specifications</h2>
              {form.specifications.map((spec, i) => (
                <div key={i} className="up-spec-row">
                  <input type="text" placeholder="Key"   value={spec.key}   onChange={e => setSpec(i, 'key', e.target.value)} />
                  <input type="text" placeholder="Value" value={spec.value} onChange={e => setSpec(i, 'value', e.target.value)} />
                  <button type="button" className="up-btn up-btn--icon-danger" onClick={() => removeSpec(i)}>×</button>
                </div>
              ))}
              <button type="button" className="up-btn up-btn--dashed" onClick={addSpec}>+ Add Specification</button>
              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(4)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(6)}>Next: Dimensions →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 6: Dimensions & Weight ── */}
            <div className={`up-section ${activeSection === 6 ? 'active' : ''}`}>
              <h2 className="up-section-title">Dimensions & Weight</h2>
              <div className="up-row up-row--3">
                <div className="up-field"><label>Length</label><input type="number" min="0" value={form.dimensions.length} onChange={e => set('dimensions.length', e.target.value)} /></div>
                <div className="up-field"><label>Width</label><input  type="number" min="0" value={form.dimensions.width}  onChange={e => set('dimensions.width',  e.target.value)} /></div>
                <div className="up-field"><label>Height</label><input type="number" min="0" value={form.dimensions.height} onChange={e => set('dimensions.height', e.target.value)} /></div>
              </div>
              <div className="up-field up-field--sm">
                <label>Unit</label>
                <select value={form.dimensions.unit} onChange={e => set('dimensions.unit', e.target.value)}>
                  {DIM_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="up-row">
                <div className="up-field"><label>Weight</label><input type="number" min="0" step="0.01" value={form.weight.value} onChange={e => set('weight.value', e.target.value)} /></div>
                <div className="up-field">
                  <label>Weight Unit</label>
                  <select value={form.weight.unit} onChange={e => set('weight.unit', e.target.value)}>
                    {W_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(5)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(7)}>Next: Breadcrumbs →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 7: Breadcrumbs ── */}
            <div className={`up-section ${activeSection === 7 ? 'active' : ''}`}>
              <h2 className="up-section-title">Breadcrumbs</h2>
              {form.breadcrumbs.map((b, i) => (
                <div key={i} className="up-spec-row">
                  <input type="text"   placeholder="Name"     value={b.name}     onChange={e => setBreadcrumb(i, 'name', e.target.value)} />
                  <input type="text"   placeholder="URL"      value={b.url}      onChange={e => setBreadcrumb(i, 'url', e.target.value)} />
                  <input type="number" placeholder="Position" value={b.position} onChange={e => setBreadcrumb(i, 'position', Number(e.target.value))} style={{ maxWidth: '80px' }} />
                  <button type="button" className="up-btn up-btn--icon-danger" onClick={() => removeBreadcrumb(i)}>×</button>
                </div>
              ))}
              <button type="button" className="up-btn up-btn--dashed" onClick={addBreadcrumb}>+ Add Breadcrumb</button>
              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(6)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(8)}>Next: SEO →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 8: SEO ── */}
            <div className={`up-section ${activeSection === 8 ? 'active' : ''}`}>
              <h2 className="up-section-title">SEO</h2>

              <div className="up-field up-field--full">
                <label>Meta Title <span className="up-hint-inline">max 60 chars</span></label>
                <input type="text" maxLength={60} value={form.seo.metaTitle} onChange={e => set('seo.metaTitle', e.target.value)} />
                <span className="up-hint">{form.seo.metaTitle.length}/60</span>
              </div>
              <div className="up-field up-field--full">
                <label>Meta Description <span className="up-hint-inline">120–160 chars</span></label>
                <textarea rows={3} maxLength={160} value={form.seo.metaDescription} onChange={e => set('seo.metaDescription', e.target.value)} />
                <span className={`up-hint ${form.seo.metaDescription.length > 0 && form.seo.metaDescription.length < 120 ? 'up-hint--warn' : ''}`}>
                  {form.seo.metaDescription.length}/160{form.seo.metaDescription.length > 0 && form.seo.metaDescription.length < 120 ? ' — too short' : ''}
                </span>
              </div>
              <div className="up-field up-field--full">
                <label>Focus Keyphrase</label>
                <input type="text" value={form.seo.focusKeyphrase} onChange={e => set('seo.focusKeyphrase', e.target.value)} />
              </div>
              <div className="up-field">
                <label>Keywords</label>
                <div className="up-tag-input">
                  <input type="text" value={kwInput} onChange={e => setKwInput(e.target.value)} placeholder="Add keyword"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToSeoArray('keywords', kwInput, setKwInput); }}} />
                  <button type="button" onClick={() => addToSeoArray('keywords', kwInput, setKwInput)}>Add</button>
                </div>
                <div className="up-tags">
                  {form.seo.keywords.map((k, i) => <span key={i} className="up-tag">{k}<button type="button" onClick={() => removeFromSeoArray('keywords', i)}>×</button></span>)}
                </div>
              </div>
              <div className="up-field up-field--full">
                <label>Canonical URL</label>
                <input type="url" value={form.seo.canonicalUrl} onChange={e => set('seo.canonicalUrl', e.target.value)} />
              </div>
              <div className="up-row">
                <div className="up-field">
                  <label>Schema Type</label>
                  <select value={form.seo.schemaType} onChange={e => set('seo.schemaType', e.target.value)}>
                    {SCHEMA_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="up-field">
                  <label>Condition</label>
                  <select value={form.seo.condition} onChange={e => set('seo.condition', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="up-subsection">
                <h3 className="up-subsection-title">Open Graph</h3>
                <div className="up-field up-field--full"><label>OG Title</label><input type="text" maxLength={60} value={form.seo.ogTitle} onChange={e => set('seo.ogTitle', e.target.value)} /></div>
                <div className="up-field up-field--full"><label>OG Description</label><textarea rows={2} maxLength={160} value={form.seo.ogDescription} onChange={e => set('seo.ogDescription', e.target.value)} /></div>
                <div className="up-row">
                  <div className="up-field"><label>OG Image URL</label><input type="url" value={form.seo.ogImage} onChange={e => set('seo.ogImage', e.target.value)} /></div>
                  <div className="up-field">
                    <label>OG Type</label>
                    <select value={form.seo.ogType} onChange={e => set('seo.ogType', e.target.value)}>
                      {OG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="up-subsection">
                <h3 className="up-subsection-title">Twitter Card</h3>
                <div className="up-row">
                  <div className="up-field">
                    <label>Card Type</label>
                    <select value={form.seo.twitterCard} onChange={e => set('seo.twitterCard', e.target.value)}>
                      {TW_CARDS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="up-field"><label>Twitter Title</label><input type="text" maxLength={70} value={form.seo.twitterTitle} onChange={e => set('seo.twitterTitle', e.target.value)} /></div>
                </div>
                <div className="up-field up-field--full"><label>Twitter Description</label><textarea rows={2} maxLength={200} value={form.seo.twitterDescription} onChange={e => set('seo.twitterDescription', e.target.value)} /></div>
                <div className="up-field up-field--full"><label>Twitter Image URL</label><input type="url" value={form.seo.twitterImage} onChange={e => set('seo.twitterImage', e.target.value)} /></div>
              </div>

              <div className="up-subsection">
                <h3 className="up-subsection-title">Related Search Terms</h3>
                <div className="up-tag-input">
                  <input type="text" value={rstInput} onChange={e => setRstInput(e.target.value)} placeholder="Add term"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToSeoArray('relatedSearchTerms', rstInput, setRstInput); }}} />
                  <button type="button" onClick={() => addToSeoArray('relatedSearchTerms', rstInput, setRstInput)}>Add</button>
                </div>
                <div className="up-tags">
                  {form.seo.relatedSearchTerms.map((t, i) => <span key={i} className="up-tag">{t}<button type="button" onClick={() => removeFromSeoArray('relatedSearchTerms', i)}>×</button></span>)}
                </div>
              </div>

              <div className="up-row">
                <div className="up-field up-field--checkbox">
                  <label className="up-checkbox-label"><input type="checkbox" checked={form.seo.noIndex} onChange={e => set('seo.noIndex', e.target.checked)} /><span>No Index</span></label>
                </div>
                <div className="up-field up-field--checkbox">
                  <label className="up-checkbox-label"><input type="checkbox" checked={form.seo.noFollow} onChange={e => set('seo.noFollow', e.target.checked)} /><span>No Follow</span></label>
                </div>
              </div>

              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(7)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(9)}>Next: Rich Snippets →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 9: Rich Snippets ── */}
            <div className={`up-section ${activeSection === 9 ? 'active' : ''}`}>
              <h2 className="up-section-title">Rich Snippets</h2>

              <div className="up-subsection">
                <h3 className="up-subsection-title">FAQs</h3>
                {form.richSnippets.faqs.map((faq, i) => (
                  <div key={i} className="up-faq-block">
                    <div className="up-faq-header"><span>FAQ {i + 1}</span><button type="button" className="up-btn up-btn--icon-danger" onClick={() => removeFaq(i)}>×</button></div>
                    <input type="text" placeholder="Question" maxLength={200} value={faq.question} onChange={e => setFaq(i, 'question', e.target.value)} />
                    <textarea rows={3} placeholder="Answer" maxLength={1000} value={faq.answer} onChange={e => setFaq(i, 'answer', e.target.value)} />
                  </div>
                ))}
                <button type="button" className="up-btn up-btn--dashed" onClick={addFaq}>+ Add FAQ</button>
              </div>

              <div className="up-subsection">
                <h3 className="up-subsection-title">How-To</h3>
                <div className="up-field">
                  <label>How-To Name</label>
                  <input type="text" value={form.richSnippets.howTo.name}
                    onChange={e => setForm(prev => ({ ...prev, richSnippets: { ...prev.richSnippets, howTo: { ...prev.richSnippets.howTo, name: e.target.value } } }))} />
                </div>
                {form.richSnippets.howTo.steps.map((step, i) => (
                  <div key={i} className="up-faq-block">
                    <div className="up-faq-header"><span>Step {i + 1}</span><button type="button" className="up-btn up-btn--icon-danger" onClick={() => removeHowToStep(i)}>×</button></div>
                    <input type="text" placeholder="Step name" value={step.name} onChange={e => setHowToStep(i, 'name', e.target.value)} />
                    <textarea rows={2} placeholder="Instructions" value={step.text} onChange={e => setHowToStep(i, 'text', e.target.value)} />
                    <input type="url" placeholder="Image URL" value={step.image} onChange={e => setHowToStep(i, 'image', e.target.value)} />
                  </div>
                ))}
                <button type="button" className="up-btn up-btn--dashed" onClick={addHowToStep}>+ Add Step</button>
              </div>

              <div className="up-subsection">
                <h3 className="up-subsection-title">Videos</h3>
                {form.richSnippets.videos.map((video, i) => (
                  <div key={i} className="up-faq-block">
                    <div className="up-faq-header"><span>Video {i + 1}</span><button type="button" className="up-btn up-btn--icon-danger" onClick={() => removeVideo(i)}>×</button></div>
                    <div className="up-row">
                      <input type="text" placeholder="Name"        value={video.name}       onChange={e => setVideo(i, 'name', e.target.value)} />
                      <input type="date"                            value={video.uploadDate} onChange={e => setVideo(i, 'uploadDate', e.target.value)} />
                    </div>
                    <textarea rows={2} placeholder="Description"   value={video.description}  onChange={e => setVideo(i, 'description', e.target.value)} />
                    <input type="url" placeholder="Thumbnail URL"  value={video.thumbnailUrl} onChange={e => setVideo(i, 'thumbnailUrl', e.target.value)} />
                    <input type="url" placeholder="Content URL"    value={video.contentUrl}   onChange={e => setVideo(i, 'contentUrl', e.target.value)} />
                    <input type="url" placeholder="Embed URL"      value={video.embedUrl}     onChange={e => setVideo(i, 'embedUrl', e.target.value)} />
                    <input type="text" placeholder="Duration ISO 8601 (e.g. PT2M30S)" value={video.duration} onChange={e => setVideo(i, 'duration', e.target.value)} />
                  </div>
                ))}
                <button type="button" className="up-btn up-btn--dashed" onClick={addVideo}>+ Add Video</button>
              </div>

              <div className="up-section-nav">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(8)}>← Back</button>
                <button type="button" className="up-btn up-btn--primary" onClick={() => setActiveSection(10)}>Next: Relationships →</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

            {/* ── 10: Relationships & Flags ── */}
            <div className={`up-section ${activeSection === 10 ? 'active' : ''}`}>
              <h2 className="up-section-title">Relationships & Flags</h2>

              <div className="up-field up-field--full"><label>Related Products <span className="up-hint-inline">comma-separated IDs</span></label><input type="text" value={form.relatedProducts} onChange={e => set('relatedProducts', e.target.value)} /></div>
              <div className="up-field up-field--full"><label>Cross-Sells <span className="up-hint-inline">comma-separated IDs</span></label><input type="text" value={form.crossSells} onChange={e => set('crossSells', e.target.value)} /></div>
              <div className="up-field up-field--full"><label>Upsells <span className="up-hint-inline">comma-separated IDs</span></label><input type="text" value={form.upsells} onChange={e => set('upsells', e.target.value)} /></div>

              <div className="up-subsection">
                <h3 className="up-subsection-title">Flags</h3>
                <div className="up-flag-grid">
                  <label className="up-toggle-label">
                    <input type="checkbox" checked={form.isFeatured} onChange={e => set('isFeatured', e.target.checked)} />
                    <span className="up-toggle-track"><span className="up-toggle-thumb" /></span>
                    <span>Featured</span>
                  </label>
                  <label className="up-toggle-label">
                    <input type="checkbox" checked={form.isNewArrival} onChange={e => set('isNewArrival', e.target.checked)} />
                    <span className="up-toggle-track"><span className="up-toggle-thumb" /></span>
                    <span>New Arrival</span>
                  </label>
                  <label className="up-toggle-label">
                    <input type="checkbox" checked={form.isBestseller} onChange={e => set('isBestseller', e.target.checked)} />
                    <span className="up-toggle-track"><span className="up-toggle-thumb" /></span>
                    <span>Bestseller</span>
                  </label>
                </div>
              </div>

              <div className="up-section-nav up-section-nav--submit">
                <button type="button" className="up-btn up-btn--ghost" onClick={() => setActiveSection(9)}>← Back</button>
                <SaveButton loading={updateStatus.loading} onSave={buildAndSubmit} />
              </div>
            </div>

          </form>
        </div>
      </main>

      <Footer />
    </>
  );
}