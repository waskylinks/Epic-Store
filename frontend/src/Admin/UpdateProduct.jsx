import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  updateProduct,
  fetchAdminProducts,
  removeErrors,
  removeProductUpdated,
} from '../features/admin/adminSlice';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import '../AdminStyles/UpdateProduct.css';
import {
  FiImage, FiDollarSign, FiPackage, FiTag, FiSettings,
  FiTrendingUp, FiX, FiPlus, FiTrash2, FiSave,
  FiEye, FiAlertCircle, FiCheck, FiArrowLeft, FiFlag,
} from 'react-icons/fi';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const CATEGORIES    = ['Electronics','Clothing & Apparel','Home & Living','Sports & Outdoors','Beauty & Personal Care','Books & Media','Food & Beverages'];
const CURRENCIES    = ['USD','EUR','GBP','NGN'];
const WEIGHT_UNITS  = ['kg','lb','g'];
const DIM_UNITS     = ['cm','in'];
const SCHEMA_TYPES  = ['Product','Book','Course','SoftwareApplication'];
const CONDITIONS    = ['NewCondition','UsedCondition','RefurbishedCondition','DamagedCondition'];
const TWITTER_CARDS = ['summary','summary_large_image'];

const TABS = [
  { id: 'basic',     label: 'Basic Info',   Icon: FiPackage    },
  { id: 'pricing',   label: 'Pricing',      Icon: FiDollarSign },
  { id: 'inventory', label: 'Inventory',    Icon: FiPackage    },
  { id: 'media',     label: 'Media',        Icon: FiImage      },
  { id: 'variants',  label: 'Variants',     Icon: FiSettings   },
  { id: 'seo',       label: 'SEO',          Icon: FiTrendingUp },
  { id: 'advanced',  label: 'Advanced SEO', Icon: FiTag        },
  { id: 'settings',  label: 'Settings',     Icon: FiFlag       },
];

const EMPTY_FORM = {
  name: '', description: '', shortDescription: '',
  category: '', brand: '', manufacturer: '',
  pricing:   { regular: '', sale: '', cost: '', currency: 'USD', validFrom: '', validThrough: '' },
  inventory: { stock: '', sku: '', barcode: '', gtin: '', mpn: '', trackInventory: true, lowStockThreshold: 5 },
  dimensions:{ length: '', width: '', height: '', unit: 'cm' },
  weight:    { value: '', unit: 'kg' },
  seo: {
    metaTitle: '', metaDescription: '', canonicalUrl: '',
    noIndex: false, noFollow: false,
    ogTitle: '', ogDescription: '', ogImage: '', ogType: 'product',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '', twitterImage: '',
    schemaType: 'Product', condition: 'NewCondition', focusKeyphrase: '',
  },
  isFeatured: false, isNewArrival: false, isBestseller: false, status: 'published',
};

const buildFormFromProduct = (p) => ({
  name:             p.name             ?? '',
  description:      p.description      ?? '',
  shortDescription: p.shortDescription ?? '',
  category:         p.category         ?? '',
  brand:            p.brand            ?? '',
  manufacturer:     p.manufacturer     ?? '',
  pricing: {
    regular:      p.pricing?.regular      ?? p.price ?? '',
    sale:         p.pricing?.sale         ?? '',
    cost:         p.pricing?.cost         ?? '',
    currency:     p.pricing?.currency     ?? 'USD',
    validFrom:    p.pricing?.validFrom    ?? '',
    validThrough: p.pricing?.validThrough ?? '',
  },
  inventory: {
    stock:             p.inventory?.stock             ?? p.stock ?? '',
    sku:               p.inventory?.sku               ?? '',
    barcode:           p.inventory?.barcode           ?? '',
    gtin:              p.inventory?.gtin              ?? '',
    mpn:               p.inventory?.mpn               ?? '',
    trackInventory:    p.inventory?.trackInventory    ?? true,
    lowStockThreshold: p.inventory?.lowStockThreshold ?? 5,
  },
  dimensions: p.dimensions ?? { length: '', width: '', height: '', unit: 'cm' },
  weight:     { value: p.weight?.value ?? '', unit: p.weight?.unit ?? 'kg' },
  seo: {
    metaTitle:          p.seo?.metaTitle          ?? '',
    metaDescription:    p.seo?.metaDescription    ?? '',
    canonicalUrl:       p.seo?.canonicalUrl       ?? '',
    noIndex:            p.seo?.noIndex            ?? false,
    noFollow:           p.seo?.noFollow           ?? false,
    ogTitle:            p.seo?.ogTitle            ?? '',
    ogDescription:      p.seo?.ogDescription      ?? '',
    ogImage:            p.seo?.ogImage            ?? '',
    ogType:             p.seo?.ogType             ?? 'product',
    twitterCard:        p.seo?.twitterCard        ?? 'summary_large_image',
    twitterTitle:       p.seo?.twitterTitle       ?? '',
    twitterDescription: p.seo?.twitterDescription ?? '',
    twitterImage:       p.seo?.twitterImage       ?? '',
    schemaType:         p.seo?.schemaType         ?? 'Product',
    condition:          p.seo?.condition          ?? 'NewCondition',
    focusKeyphrase:     p.seo?.focusKeyphrase     ?? '',
  },
  isFeatured:   p.isFeatured   ?? false,
  isNewArrival: p.isNewArrival ?? false,
  isBestseller: p.isBestseller ?? false,
  status:       p.status       ?? 'published',
});

// ─── Component ─────────────────────────────────────────────────────────────────

export default function UpdateProduct() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // FIX: use `updating` (per-action flag) instead of the shared `loading`.
  // The shared `loading` flag is set to true by ANY pending thunk — including
  // background reads like fetchAdminProducts. If one of those fires while the
  // user is waiting for updateProduct to resolve, the shared flag bounces
  // true→false→true and the button spinner either disappears too early or
  // gets stuck indefinitely. Using `updating` means only updateProduct.pending/
  // fulfilled/rejected can toggle the spinner.
  const { products, loading, updating, error, productUpdated } = useSelector((s) => s.admin);

  // Fetch products on mount if store is empty (direct navigation / page refresh)
  useEffect(() => {
    if (products.length === 0) dispatch(fetchAdminProducts());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const product = useMemo(
    () => products.find((p) => p._id === id) ?? null,
    [products, id],
  );

  // ── Form state ────────────────────────────────────────────────────────────
  const [activeTab,          setActiveTab]          = useState('basic');
  const [formData,           setFormData]           = useState(EMPTY_FORM);
  const [oldImages,          setOldImages]          = useState([]);
  const [imagesToDelete,     setImagesToDelete]     = useState([]);
  const [newImages,          setNewImages]          = useState([]);
  const [newImagePreviews,   setNewImagePreviews]   = useState([]);
  const [subcategories,      setSubcategories]      = useState([]);
  const [tags,               setTags]               = useState([]);
  const [specifications,     setSpecifications]     = useState([]);
  const [variants,           setVariants]           = useState([]);
  const [seoKeywords,        setSeoKeywords]        = useState([]);
  const [relatedSearchTerms, setRelatedSearchTerms] = useState([]);
  const [breadcrumbs,        setBreadcrumbs]        = useState([]);
  const [richSnippets,       setRichSnippets]       = useState({ faqs: [], howTo: { name: '', steps: [] }, videos: [] });

  const [newSubcategory, setNewSubcategory] = useState('');
  const [newTag,         setNewTag]         = useState('');
  const [newKeyword,     setNewKeyword]     = useState('');
  const [newRelatedTerm, setNewRelatedTerm] = useState('');
  const [newBreadcrumb,  setNewBreadcrumb]  = useState({ name: '', url: '' });

  // ── Prefill guard ─────────────────────────────────────────────────────────
  // Run exactly once when the product first resolves. Without this, the effect
  // would re-fire after updateProduct.fulfilled replaces products[index] with
  // fresh server data (new object reference), wiping any pending edits.
  const hasPrefilled = useRef(false);

  useEffect(() => {
    if (!product || hasPrefilled.current) return;
    hasPrefilled.current = true;
    setFormData(buildFormFromProduct(product));
    setOldImages(product.images ?? product.image ?? []);
    setSubcategories(product.subcategories ?? []);
    setTags(product.tags ?? []);
    setSpecifications(product.specifications ?? []);
    setVariants(product.variants ?? []);
    setSeoKeywords(product.seo?.keywords ?? []);
    setRelatedSearchTerms(product.seo?.relatedSearchTerms ?? []);
    setBreadcrumbs(product.breadcrumbs ?? []);
    setRichSnippets(product.richSnippets ?? { faqs: [], howTo: { name: '', steps: [] }, videos: [] });
  }, [product]);

  // ── Error effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!error) return;
    toast.error(error, { position: 'top-center', autoClose: 3000 });
    dispatch(removeErrors());
  }, [error, dispatch]);

  // ── Success effect ────────────────────────────────────────────────────────
  // FIX: use a ref guard (same pattern as CreateProduct) so StrictMode's
  // double-invoke of cleanup cannot clear productUpdated before this branch
  // reads it, which would prevent the toast from ever showing.
  const handledUpdated = useRef(false);

  useEffect(() => {
    if (!productUpdated || handledUpdated.current) return;
    handledUpdated.current = true;
    toast.success('Product updated successfully!', { position: 'top-center', autoClose: 3000 });
    dispatch(removeProductUpdated());
    navigate('/admin/products');
  }, [productUpdated, dispatch, navigate]);

  // Clear stale flag on unmount only
  useEffect(() => {
    return () => { dispatch(removeProductUpdated()); };
  }, [dispatch]);

  // ── Input handler ─────────────────────────────────────────────────────────
  const handleInputChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setFormData((prev) => ({ ...prev, [parent]: { ...prev[parent], [child]: val } }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: val }));
    }
  }, []);

  // ── Image handlers ────────────────────────────────────────────────────────
  const handleNewImages = useCallback((e) => {
    Array.from(e.target.files).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) { toast.error(`"${file.name}" exceeds 10 MB`); return; }
      if (newImages.some((img) => img.name === file.name && img.size === file.size)) {
        toast.warn(`"${file.name}" already added`); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setNewImages((o) => [...o, file]);
        setNewImagePreviews((o) => [...o, { url: reader.result, name: file.name, size: (file.size / 1024).toFixed(1) + ' KB', alt: '', caption: '' }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, [newImages]);

  const removeNewImage     = useCallback((i) => { setNewImages((o) => o.filter((_, j) => j !== i)); setNewImagePreviews((o) => o.filter((_, j) => j !== i)); }, []);
  const updateNewImageMeta = useCallback((i, field, value) => setNewImagePreviews((o) => o.map((img, j) => j === i ? { ...img, [field]: value } : img)), []);
  const removeOldImage     = useCallback((publicId) => { if (!publicId) return; setOldImages((p) => p.filter((img) => img.public_id !== publicId)); setImagesToDelete((p) => [...p, publicId]); }, []);
  const setPrimaryOldImage = useCallback((i) => { if (i === 0) return; setOldImages((p) => { const n = [...p]; [n[0], n[i]] = [n[i], n[0]]; return n; }); }, []);
  const updateOldImageMeta = useCallback((i, field, value) => setOldImages((p) => p.map((img, j) => j === i ? { ...img, [field]: value } : img)), []);

  // ── List helpers ──────────────────────────────────────────────────────────
  const addItem    = useCallback((value, setter, resetSetter, transform = (v) => v) => { const t = value.trim(); if (!t) return; setter((p) => [...p, transform(t)]); resetSetter(''); }, []);
  const removeItem = useCallback((i, setter) => setter((p) => p.filter((_, j) => j !== i)), []);

  const addBreadcrumb    = useCallback(() => { if (!newBreadcrumb.name.trim() || !newBreadcrumb.url.trim()) return; setBreadcrumbs((p) => [...p, { name: newBreadcrumb.name.trim(), url: newBreadcrumb.url.trim(), position: p.length + 1 }]); setNewBreadcrumb({ name: '', url: '' }); }, [newBreadcrumb]);
  const removeBreadcrumb = useCallback((i) => setBreadcrumbs((p) => p.filter((_, j) => j !== i).map((b, j) => ({ ...b, position: j + 1 }))), []);

  const addSpec    = useCallback(() => setSpecifications((p) => [...p, { key: '', value: '' }]), []);
  const updateSpec = useCallback((i, field, val) => setSpecifications((p) => p.map((s, j) => j === i ? { ...s, [field]: val } : s)), []);
  const removeSpec = useCallback((i) => setSpecifications((p) => p.filter((_, j) => j !== i)), []);

  const addVariant          = useCallback(() => setVariants((p) => [...p, { name: '', options: [{ value: '', priceModifier: 0, stock: 0 }] }]), []);
  const updateVariantName   = useCallback((i, name) => setVariants((p) => p.map((v, j) => j === i ? { ...v, name } : v)), []);
  const removeVariant       = useCallback((i) => setVariants((p) => p.filter((_, j) => j !== i)), []);
  const addVariantOption    = useCallback((vi) => setVariants((p) => p.map((v, i) => i === vi ? { ...v, options: [...v.options, { value: '', priceModifier: 0, stock: 0 }] } : v)), []);
  const updateVariantOption = useCallback((vi, oi, f, val) => setVariants((p) => p.map((v, i) => i === vi ? { ...v, options: v.options.map((o, j) => j === oi ? { ...o, [f]: val } : o) } : v)), []);
  const removeVariantOption = useCallback((vi, oi) => setVariants((p) => p.map((v, i) => i === vi ? { ...v, options: v.options.filter((_, j) => j !== oi) } : v)), []);

  const addFAQ    = useCallback(() => setRichSnippets((p) => ({ ...p, faqs: [...p.faqs, { question: '', answer: '' }] })), []);
  const updateFAQ = useCallback((i, field, val) => setRichSnippets((p) => ({ ...p, faqs: p.faqs.map((f, j) => j === i ? { ...f, [field]: val } : f) })), []);
  const removeFAQ = useCallback((i) => setRichSnippets((p) => ({ ...p, faqs: p.faqs.filter((_, j) => j !== i) })), []);

  const addVideo    = useCallback(() => setRichSnippets((p) => ({ ...p, videos: [...p.videos, { name: '', description: '', thumbnailUrl: '', contentUrl: '' }] })), []);
  const updateVideo = useCallback((i, field, val) => setRichSnippets((p) => ({ ...p, videos: p.videos.map((v, j) => j === i ? { ...v, [field]: val } : v) })), []);
  const removeVideo = useCallback((i) => setRichSnippets((p) => ({ ...p, videos: p.videos.filter((_, j) => j !== i) })), []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback((e) => {
    e.preventDefault();

    if (!formData.name.trim())        { toast.error('Product name is required');        setActiveTab('basic');   return; }
    if (!formData.category)           { toast.error('Category is required');            setActiveTab('basic');   return; }
    if (!formData.description.trim()) { toast.error('Description is required');         setActiveTab('basic');   return; }
    if (!formData.pricing.regular)    { toast.error('Regular price is required');       setActiveTab('pricing'); return; }
    if (formData.pricing.sale !== '' && Number(formData.pricing.sale) >= Number(formData.pricing.regular)) {
      toast.error('Sale price must be less than regular price'); setActiveTab('pricing'); return;
    }
    if (formData.pricing.validFrom && formData.pricing.validThrough &&
        new Date(formData.pricing.validFrom) > new Date(formData.pricing.validThrough)) {
      toast.error('Valid-from must be before valid-through'); setActiveTab('pricing'); return;
    }
    if (oldImages.length + newImages.length === 0) {
      toast.error('At least one image is required'); setActiveTab('media'); return;
    }

    const fd = new FormData();

    fd.append('name',             formData.name.trim());
    fd.append('description',      formData.description.trim());
    fd.append('shortDescription', formData.shortDescription.trim());
    fd.append('category',         formData.category);
    fd.append('brand',            formData.brand.trim());
    fd.append('manufacturer',     formData.manufacturer.trim());
    fd.append('status',           formData.status);

    // Stringify booleans — FormData.append(key, false) sends "false" which is
    // truthy in a backend `if (val)` check.
    fd.append('isFeatured',   JSON.stringify(formData.isFeatured));
    fd.append('isNewArrival', JSON.stringify(formData.isNewArrival));
    fd.append('isBestseller', JSON.stringify(formData.isBestseller));

    const pricingData = { regular: Number(formData.pricing.regular), currency: formData.pricing.currency };
    if (formData.pricing.sale !== '')  pricingData.sale = Number(formData.pricing.sale);
    if (formData.pricing.cost !== '')  pricingData.cost = Number(formData.pricing.cost);
    if (formData.pricing.validFrom)    pricingData.validFrom = formData.pricing.validFrom;
    if (formData.pricing.validThrough) pricingData.validThrough = formData.pricing.validThrough;
    fd.append('pricing', JSON.stringify(pricingData));

    fd.append('inventory', JSON.stringify({
      stock:             Number(formData.inventory.stock) || 0,
      sku:               formData.inventory.sku.trim(),
      barcode:           formData.inventory.barcode.trim(),
      gtin:              formData.inventory.gtin.trim(),
      mpn:               formData.inventory.mpn.trim(),
      trackInventory:    formData.inventory.trackInventory,
      lowStockThreshold: Number(formData.inventory.lowStockThreshold),
    }));

    fd.append('dimensions', JSON.stringify({
      length: Number(formData.dimensions.length) || 0,
      width:  Number(formData.dimensions.width)  || 0,
      height: Number(formData.dimensions.height) || 0,
      unit:   formData.dimensions.unit,
    }));
    fd.append('weight', JSON.stringify({
      value: Number(formData.weight.value) || 0,
      unit:  formData.weight.unit,
    }));

    fd.append('subcategories',  JSON.stringify(subcategories));
    fd.append('tags',           JSON.stringify(tags));
    fd.append('specifications', JSON.stringify(specifications.filter((s) => s.key && s.value)));
    fd.append('variants',       JSON.stringify(variants.filter((v) => v.name && v.options.length > 0)));

    fd.append('seo', JSON.stringify({
      metaTitle:          formData.seo.metaTitle.trim(),
      metaDescription:    formData.seo.metaDescription.trim(),
      keywords:           seoKeywords,
      canonicalUrl:       formData.seo.canonicalUrl,
      noIndex:            formData.seo.noIndex,
      noFollow:           formData.seo.noFollow,
      ogTitle:            formData.seo.ogTitle,
      ogDescription:      formData.seo.ogDescription,
      ogImage:            formData.seo.ogImage,
      ogType:             formData.seo.ogType,
      twitterCard:        formData.seo.twitterCard,
      twitterTitle:       formData.seo.twitterTitle,
      twitterDescription: formData.seo.twitterDescription,
      twitterImage:       formData.seo.twitterImage,
      schemaType:         formData.seo.schemaType,
      condition:          formData.seo.condition,
      focusKeyphrase:     formData.seo.focusKeyphrase,
      relatedSearchTerms,
    }));

    fd.append('richSnippets', JSON.stringify({
      faqs:   richSnippets.faqs.filter((f) => f.question && f.answer),
      howTo:  richSnippets.howTo,
      videos: richSnippets.videos.filter((v) => v.name && v.contentUrl),
    }));

    if (breadcrumbs.length > 0) fd.append('breadcrumbs', JSON.stringify(breadcrumbs));
    if (imagesToDelete.length > 0) fd.append('imagesToDelete', JSON.stringify(imagesToDelete));

    fd.append('existingImages', JSON.stringify(
      oldImages.map((img, i) => ({
        public_id: img.public_id, url: img.url,
        alt: img.alt ?? '', caption: img.caption ?? '',
        isPrimary: i === 0, order: i,
        width: img.width ?? null, height: img.height ?? null,
      })),
    ));
    fd.append('imageMetadata', JSON.stringify(
      newImagePreviews.map((img) => ({ alt: img.alt ?? '', caption: img.caption ?? '' })),
    ));
    newImages.forEach((img) => fd.append('images', img));

    dispatch(updateProduct({ id, productData: fd }));
  }, [
    formData, oldImages, newImages, newImagePreviews,
    subcategories, tags, specifications, variants,
    seoKeywords, relatedSearchTerms, breadcrumbs, richSnippets,
    imagesToDelete, id, dispatch,
  ]);

  // ── Guards ────────────────────────────────────────────────────────────────
  // FIX: the original guard was `products.length === 0 || (loading && !hasPrefilled.current)`.
  // This had two problems:
  //   1. `loading` is the shared flag. After updateProduct completes, if any
  //      other thunk (fetchAdminProducts from another component) sets loading=true,
  //      we'd fall back to <Loader> mid-edit, losing the user's unsaved work.
  //   2. Once products loaded and prefill ran, the guard could still show <Loader>
  //      during subsequent background reads.
  //
  // Fix: only show <Loader> during the initial fetch (products empty AND
  // loading=true), never during updates. The `updating` flag is separate.
  if (products.length === 0 && loading) return <Loader />;

  if (products.length > 0 && !product) return (
    <div className="eup-not-found">
      <FiAlertCircle />
      <h2>Product not found</h2>
      <button onClick={() => navigate('/admin/products')}>Back to Products</button>
    </div>
  );

  // Product not yet in store but still loading — wait
  if (!product) return <Loader />;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle title={`Update — ${product.name}`} />
      <Navbar />

      <div className="eup-container">
        <div className="eup-header">
          <button className="eup-back-btn" onClick={() => navigate('/admin/products')}>
            <FiArrowLeft /> Back to Products
          </button>
          <div>
            <h1 className="eup-title">Update Product</h1>
            <p className="eup-subtitle">Editing: <strong>{product.name}</strong></p>
          </div>
        </div>

        <div className="eup-content">
          <nav className="eup-tabs">
            {TABS.map(({ id: tabId, label, Icon }) => (
              <button key={tabId} type="button"
                className={`eup-tab ${activeTab === tabId ? 'active' : ''}`}
                onClick={() => setActiveTab(tabId)}>
                <Icon /><span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="eup-form">

            {/* ══ BASIC INFO ═══════════════════════════════════════════════ */}
            {activeTab === 'basic' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <h3 className="eup-section-title">Product Information</h3>

                  <div className="eup-form-group">
                    <label className="eup-label eup-label--required">Product Name</label>
                    <input type="text" className="eup-input" name="name"
                      value={formData.name} onChange={handleInputChange} maxLength={200} />
                    <span className="eup-char-count">{formData.name.length}/200</span>
                  </div>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label eup-label--required">Category</label>
                      <select className="eup-select" name="category" value={formData.category} onChange={handleInputChange}>
                        <option value="">Select Category</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Brand</label>
                      <input type="text" className="eup-input" name="brand" value={formData.brand} onChange={handleInputChange} />
                    </div>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Manufacturer</label>
                    <input type="text" className="eup-input" name="manufacturer" value={formData.manufacturer} onChange={handleInputChange} />
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Short Description</label>
                    <textarea className="eup-textarea" name="shortDescription" rows={3} maxLength={500}
                      value={formData.shortDescription} onChange={handleInputChange} />
                    <span className="eup-char-count">{formData.shortDescription.length}/500</span>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label eup-label--required">Full Description</label>
                    <textarea className="eup-textarea" name="description" rows={6} maxLength={5000}
                      value={formData.description} onChange={handleInputChange} />
                    <span className="eup-char-count">{formData.description.length}/5000</span>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Subcategories</label>
                    <div className="eup-input-with-btn">
                      <input type="text" className="eup-input" placeholder="Add subcategory" value={newSubcategory}
                        onChange={(e) => setNewSubcategory(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newSubcategory, setSubcategories, setNewSubcategory); } }} />
                      <button type="button" className="eup-btn-icon" onClick={() => addItem(newSubcategory, setSubcategories, setNewSubcategory)}><FiPlus /></button>
                    </div>
                    <div className="eup-tags">
                      {subcategories.map((s, i) => <span key={i} className="eup-tag">{s}<button type="button" onClick={() => removeItem(i, setSubcategories)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Tags</label>
                    <div className="eup-input-with-btn">
                      <input type="text" className="eup-input" placeholder="Add tag" value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newTag, setTags, setNewTag, (v) => v.toLowerCase()); } }} />
                      <button type="button" className="eup-btn-icon" onClick={() => addItem(newTag, setTags, setNewTag, (v) => v.toLowerCase())}><FiPlus /></button>
                    </div>
                    <div className="eup-tags">
                      {tags.map((t, i) => <span key={i} className="eup-tag">{t}<button type="button" onClick={() => removeItem(i, setTags)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="eup-form-group">
                    <div className="eup-label-with-btn">
                      <label className="eup-label">Specifications</label>
                      <button type="button" className="eup-btn-small" onClick={addSpec}><FiPlus /> Add</button>
                    </div>
                    {specifications.map((spec, i) => (
                      <div key={i} className="eup-spec-row">
                        <input type="text" className="eup-input" placeholder="Key" value={spec.key} onChange={(e) => updateSpec(i, 'key', e.target.value)} />
                        <input type="text" className="eup-input" placeholder="Value" value={spec.value} onChange={(e) => updateSpec(i, 'value', e.target.value)} />
                        <button type="button" className="eup-btn-icon-danger" onClick={() => removeSpec(i)}><FiTrash2 /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══ PRICING ══════════════════════════════════════════════════ */}
            {activeTab === 'pricing' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <h3 className="eup-section-title">Pricing</h3>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label eup-label--required">Regular Price</label>
                      <div className="eup-input-with-icon">
                        <FiDollarSign className="eup-input-icon" />
                        <input type="number" className="eup-input eup-input-with-padding"
                          name="pricing.regular" value={formData.pricing.regular} onChange={handleInputChange} min="0" step="0.01" />
                      </div>
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Sale Price</label>
                      <div className="eup-input-with-icon">
                        <FiDollarSign className="eup-input-icon" />
                        <input type="number" className="eup-input eup-input-with-padding"
                          name="pricing.sale" value={formData.pricing.sale} onChange={handleInputChange} min="0" step="0.01" />
                      </div>
                    </div>
                  </div>

                  {formData.pricing.regular !== '' && formData.pricing.sale !== '' &&
                   Number(formData.pricing.sale) < Number(formData.pricing.regular) && (
                    <div className="eup-discount-preview">
                      <FiCheck className="eup-discount-icon" />
                      <span>{Math.round(((Number(formData.pricing.regular) - Number(formData.pricing.sale)) / Number(formData.pricing.regular)) * 100)}% off</span>
                    </div>
                  )}

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">Cost Price</label>
                      <div className="eup-input-with-icon">
                        <FiDollarSign className="eup-input-icon" />
                        <input type="number" className="eup-input eup-input-with-padding"
                          name="pricing.cost" value={formData.pricing.cost} onChange={handleInputChange} min="0" step="0.01" />
                      </div>
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Currency</label>
                      <select className="eup-select" name="pricing.currency" value={formData.pricing.currency} onChange={handleInputChange}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">Valid From</label>
                      <input type="date" className="eup-input" name="pricing.validFrom" value={formData.pricing.validFrom} onChange={handleInputChange} />
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Valid Through</label>
                      <input type="date" className="eup-input" name="pricing.validThrough" value={formData.pricing.validThrough} onChange={handleInputChange} />
                    </div>
                  </div>

                  <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Shipping</h3>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">Weight</label>
                      <div className="eup-input-group">
                        <input type="number" className="eup-input" name="weight.value" value={formData.weight.value} onChange={handleInputChange} min="0" step="0.01" />
                        <select className="eup-select-addon" name="weight.unit" value={formData.weight.unit} onChange={handleInputChange}>
                          {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Dimensions (L × W × H)</label>
                    <div className="eup-dimensions-grid">
                      {['length','width','height'].map((dim) => (
                        <input key={dim} type="number" className="eup-input"
                          placeholder={dim.charAt(0).toUpperCase() + dim.slice(1)}
                          name={`dimensions.${dim}`} value={formData.dimensions[dim]}
                          onChange={handleInputChange} min="0" step="0.01" />
                      ))}
                      <select className="eup-select" name="dimensions.unit" value={formData.dimensions.unit} onChange={handleInputChange}>
                        {DIM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ INVENTORY ════════════════════════════════════════════════ */}
            {activeTab === 'inventory' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <h3 className="eup-section-title">Inventory</h3>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">Stock</label>
                      <input type="number" className="eup-input" name="inventory.stock" value={formData.inventory.stock} onChange={handleInputChange} min="0" />
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Low Stock Threshold</label>
                      <input type="number" className="eup-input" name="inventory.lowStockThreshold" value={formData.inventory.lowStockThreshold} onChange={handleInputChange} min="0" />
                    </div>
                  </div>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">SKU</label>
                      <input type="text" className="eup-input" name="inventory.sku" value={formData.inventory.sku} onChange={handleInputChange} />
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Barcode</label>
                      <input type="text" className="eup-input" name="inventory.barcode" value={formData.inventory.barcode} onChange={handleInputChange} />
                    </div>
                  </div>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">GTIN <span className="eup-badge">Google Shopping</span></label>
                      <input type="text" className="eup-input" placeholder="UPC / EAN / ISBN" name="inventory.gtin" value={formData.inventory.gtin} onChange={handleInputChange} />
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">MPN</label>
                      <input type="text" className="eup-input" name="inventory.mpn" value={formData.inventory.mpn} onChange={handleInputChange} />
                    </div>
                  </div>

                  <div className="eup-checkbox-group">
                    <label className="eup-checkbox">
                      <input type="checkbox" name="inventory.trackInventory" checked={formData.inventory.trackInventory} onChange={handleInputChange} />
                      <span>Track inventory for this product</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ══ MEDIA ════════════════════════════════════════════════════ */}
            {activeTab === 'media' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  {oldImages.length > 0 && (
                    <>
                      <h3 className="eup-section-title">Current Images</h3>
                      <div className="eup-info-box" style={{ marginBottom: '1rem' }}>
                        <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                        <span>First image is primary. Click <FiEye style={{ verticalAlign: 'middle' }} /> to promote.</span>
                      </div>
                      <div className="eup-image-grid">
                        {oldImages.map((img, i) => (
                          <div key={img.public_id ?? i} className="eup-image-card">
                            <img src={img.url} alt={img.alt || `Product ${i + 1}`} />
                            <div className="eup-image-overlay">
                              <button type="button" className="eup-image-btn" onClick={() => setPrimaryOldImage(i)} title="Set as primary">
                                {i === 0 ? <FiCheck /> : <FiEye />}
                              </button>
                              <button type="button" className="eup-image-btn eup-image-btn-danger" onClick={() => removeOldImage(img.public_id)}><FiTrash2 /></button>
                            </div>
                            {i === 0 && <span className="eup-primary-badge">Primary</span>}
                            <div className="eup-image-meta">
                              <input type="text" className="eup-input eup-image-meta-input" placeholder="Alt text" maxLength={125}
                                value={img.alt ?? ''} onChange={(e) => updateOldImageMeta(i, 'alt', e.target.value)} />
                              <input type="text" className="eup-input eup-image-meta-input" placeholder="Caption" maxLength={200}
                                value={img.caption ?? ''} onChange={(e) => updateOldImageMeta(i, 'caption', e.target.value)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <h3 className="eup-section-title" style={{ marginTop: oldImages.length > 0 ? '2rem' : 0 }}>Add Images</h3>
                  <div className="eup-upload-area">
                    <input type="file" id="new-images" className="eup-file-input"
                      accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={handleNewImages} />
                    <label htmlFor="new-images" className="eup-upload-label">
                      <FiImage className="eup-upload-icon" />
                      <span className="eup-upload-text">Click to upload</span>
                      <span className="eup-upload-subtext">JPEG, PNG, WebP — max 10 MB each</span>
                    </label>
                  </div>

                  {newImagePreviews.length > 0 && (
                    <>
                      <h3 className="eup-section-title" style={{ marginTop: '1.5rem' }}>New Images</h3>
                      <div className="eup-image-grid">
                        {newImagePreviews.map((img, i) => (
                          <div key={i} className="eup-image-card">
                            <img src={img.url} alt={img.alt || `New ${i + 1}`} />
                            <div className="eup-image-overlay">
                              <button type="button" className="eup-image-btn eup-image-btn-danger" onClick={() => removeNewImage(i)}><FiTrash2 /></button>
                            </div>
                            <span className="eup-new-badge">New</span>
                            <div className="eup-image-meta">
                              <input type="text" className="eup-input eup-image-meta-input" placeholder="Alt text" maxLength={125}
                                value={img.alt} onChange={(e) => updateNewImageMeta(i, 'alt', e.target.value)} />
                              <input type="text" className="eup-input eup-image-meta-input" placeholder="Caption" maxLength={200}
                                value={img.caption} onChange={(e) => updateNewImageMeta(i, 'caption', e.target.value)} />
                              <small className="eup-image-size">{img.size}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ══ VARIANTS ═════════════════════════════════════════════════ */}
            {activeTab === 'variants' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <div className="eup-label-with-btn">
                    <h3 className="eup-section-title">Variants</h3>
                    <button type="button" className="eup-btn-small" onClick={addVariant}><FiPlus /> Add Variant</button>
                  </div>
                  {variants.length === 0 && (
                    <div className="eup-info-box"><FiAlertCircle style={{ marginRight: '0.5rem' }} /><span>No variants. Add sizes, colours, or styles.</span></div>
                  )}
                  {variants.map((variant, vi) => (
                    <div key={vi} className="eup-variant-card">
                      <div className="eup-variant-header">
                        <input type="text" className="eup-input" placeholder="Variant name (e.g. Size)"
                          value={variant.name} onChange={(e) => updateVariantName(vi, e.target.value)} />
                        <button type="button" className="eup-btn-icon-danger" onClick={() => removeVariant(vi)}><FiTrash2 /></button>
                      </div>
                      <div className="eup-variant-options">
                        {variant.options.map((opt, oi) => (
                          <div key={oi} className="eup-variant-option-row">
                            <input type="text"   className="eup-input" placeholder="Value"   value={opt.value}         onChange={(e) => updateVariantOption(vi, oi, 'value', e.target.value)} />
                            <input type="number" className="eup-input" placeholder="Price +" value={opt.priceModifier} onChange={(e) => updateVariantOption(vi, oi, 'priceModifier', Number(e.target.value))} step="0.01" />
                            <input type="number" className="eup-input" placeholder="Stock"   value={opt.stock}         onChange={(e) => updateVariantOption(vi, oi, 'stock', Number(e.target.value))} min="0" />
                            <button type="button" className="eup-btn-icon-danger" onClick={() => removeVariantOption(vi, oi)}><FiX /></button>
                          </div>
                        ))}
                        <button type="button" className="ecp-btn-secondary eup-btn-full" onClick={() => addVariantOption(vi)}><FiPlus /> Add Option</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ SEO ══════════════════════════════════════════════════════ */}
            {activeTab === 'seo' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <h3 className="eup-section-title">SEO</h3>

                  <div className="eup-form-group">
                    <label className="eup-label">Meta Title <span className="eup-recommended">(max 60)</span></label>
                    <input type="text" className="eup-input" name="seo.metaTitle" value={formData.seo.metaTitle} onChange={handleInputChange} maxLength={60} />
                    <span className="eup-char-count">{formData.seo.metaTitle.length}/60</span>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Meta Description <span className="eup-recommended">(120–160)</span></label>
                    <textarea className="eup-textarea" name="seo.metaDescription" rows={3} maxLength={160}
                      value={formData.seo.metaDescription} onChange={handleInputChange} />
                    <span className={`eup-char-count ${formData.seo.metaDescription.length > 0 && formData.seo.metaDescription.length < 120 ? 'eup-char-count--warn' : ''}`}>
                      {formData.seo.metaDescription.length}/160
                    </span>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Keywords</label>
                    <div className="eup-input-with-btn">
                      <input type="text" className="eup-input" placeholder="Add keyword" value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newKeyword, setSeoKeywords, setNewKeyword); } }} />
                      <button type="button" className="eup-btn-icon" onClick={() => addItem(newKeyword, setSeoKeywords, setNewKeyword)}><FiPlus /></button>
                    </div>
                    <div className="eup-tags">
                      {seoKeywords.map((k, i) => <span key={i} className="eup-tag">{k}<button type="button" onClick={() => removeItem(i, setSeoKeywords)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Canonical URL</label>
                    <input type="url" className="eup-input" name="seo.canonicalUrl" value={formData.seo.canonicalUrl} onChange={handleInputChange} />
                  </div>

                  <div className="eup-form-group">
                    <label className="eup-label">Focus Keyphrase</label>
                    <input type="text" className="eup-input" name="seo.focusKeyphrase" value={formData.seo.focusKeyphrase} onChange={handleInputChange} />
                  </div>

                  <div className="eup-form-group" style={{ marginTop: '2rem' }}>
                    <div className="eup-label-with-btn">
                      <label className="eup-label">Breadcrumbs</label>
                      <button type="button" className="eup-btn-small" onClick={addBreadcrumb} disabled={!newBreadcrumb.name || !newBreadcrumb.url}><FiPlus /> Add</button>
                    </div>
                    <div className="eup-spec-row">
                      <input type="text" className="eup-input" placeholder="Name" value={newBreadcrumb.name} onChange={(e) => setNewBreadcrumb((p) => ({ ...p, name: e.target.value }))} />
                      <input type="text" className="eup-input" placeholder="URL"  value={newBreadcrumb.url}  onChange={(e) => setNewBreadcrumb((p) => ({ ...p, url: e.target.value }))} />
                    </div>
                    <div className="eup-tags">
                      {breadcrumbs.map((b, i) => <span key={i} className="eup-tag">{b.position}. {b.name}<button type="button" onClick={() => removeBreadcrumb(i)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="eup-form-row">
                    <div className="eup-form-group">
                      <label className="eup-label">Schema Type</label>
                      <select className="eup-select" name="seo.schemaType" value={formData.seo.schemaType} onChange={handleInputChange}>
                        {SCHEMA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="eup-form-group">
                      <label className="eup-label">Condition</label>
                      <select className="eup-select" name="seo.condition" value={formData.seo.condition} onChange={handleInputChange}>
                        {CONDITIONS.map((c) => <option key={c} value={c}>{c.replace('Condition', '')}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="eup-checkbox-grid">
                    <label className="eup-checkbox"><input type="checkbox" name="seo.noIndex"  checked={formData.seo.noIndex}  onChange={handleInputChange} /><span>No Index</span></label>
                    <label className="eup-checkbox"><input type="checkbox" name="seo.noFollow" checked={formData.seo.noFollow} onChange={handleInputChange} /><span>No Follow</span></label>
                  </div>

                  <div className="eup-form-group" style={{ marginTop: '2rem' }}>
                    <label className="eup-label">Related Search Terms</label>
                    <div className="eup-input-with-btn">
                      <input type="text" className="eup-input" placeholder="Add term" value={newRelatedTerm}
                        onChange={(e) => setNewRelatedTerm(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, (v) => v.toLowerCase()); } }} />
                      <button type="button" className="eup-btn-icon" onClick={() => addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, (v) => v.toLowerCase())}><FiPlus /></button>
                    </div>
                    <div className="eup-tags">
                      {relatedSearchTerms.map((t, i) => <span key={i} className="eup-tag">{t}<button type="button" onClick={() => removeItem(i, setRelatedSearchTerms)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="eup-label-with-btn" style={{ marginTop: '2rem' }}>
                    <h3 className="eup-section-title">FAQs</h3>
                    <button type="button" className="eup-btn-small" onClick={addFAQ}><FiPlus /> Add FAQ</button>
                  </div>
                  {richSnippets.faqs.map((faq, i) => (
                    <div key={i} className="eup-faq-card">
                      <div className="eup-faq-header">
                        <input type="text" className="eup-input" placeholder="Question" maxLength={200}
                          value={faq.question} onChange={(e) => updateFAQ(i, 'question', e.target.value)} />
                        <button type="button" className="eup-btn-icon-danger" onClick={() => removeFAQ(i)}><FiTrash2 /></button>
                      </div>
                      <textarea className="eup-textarea" placeholder="Answer" rows={3} maxLength={1000}
                        value={faq.answer} onChange={(e) => updateFAQ(i, 'answer', e.target.value)} />
                    </div>
                  ))}

                  <div className="eup-label-with-btn" style={{ marginTop: '2rem' }}>
                    <h3 className="eup-section-title">Videos</h3>
                    <button type="button" className="eup-btn-small" onClick={addVideo}><FiPlus /> Add Video</button>
                  </div>
                  {richSnippets.videos.map((video, i) => (
                    <div key={i} className="eup-video-card">
                      <div className="eup-video-header">
                        <input type="text" className="eup-input" placeholder="Video Name"
                          value={video.name} onChange={(e) => updateVideo(i, 'name', e.target.value)} />
                        <button type="button" className="eup-btn-icon-danger" onClick={() => removeVideo(i)}><FiTrash2 /></button>
                      </div>
                      {[['description','Description'],['contentUrl','Content URL'],['thumbnailUrl','Thumbnail URL']].map(([field, ph]) => (
                        <input key={field} type={field.includes('Url') ? 'url' : 'text'} className="eup-input"
                          placeholder={ph} value={video[field]} style={{ marginTop: '0.5rem' }}
                          onChange={(e) => updateVideo(i, field, e.target.value)} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ ADVANCED SEO ═════════════════════════════════════════════ */}
            {activeTab === 'advanced' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <h3 className="eup-section-title">Open Graph</h3>
                  {[
                    ['ogTitle',       'OG Title',       'text',     60],
                    ['ogDescription', 'OG Description', 'textarea', 160],
                    ['ogImage',       'OG Image URL',   'url',      null],
                    ['ogType',        'OG Type',        'text',     null],
                  ].map(([field, label, type, max]) => (
                    <div key={field} className="eup-form-group">
                      <label className="eup-label">{label}</label>
                      {type === 'textarea'
                        ? <textarea className="eup-textarea" name={`seo.${field}`} rows={3} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                        : <input type={type} className="eup-input" name={`seo.${field}`} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                      }
                      {max && <span className="eup-char-count">{(formData.seo[field] ?? '').length}/{max}</span>}
                    </div>
                  ))}

                  <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Twitter / X</h3>
                  <div className="eup-form-group">
                    <label className="eup-label">Card Type</label>
                    <select className="eup-select" name="seo.twitterCard" value={formData.seo.twitterCard} onChange={handleInputChange}>
                      {TWITTER_CARDS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {[
                    ['twitterTitle',       'Twitter Title',       'text',     70],
                    ['twitterDescription', 'Twitter Description', 'textarea', 200],
                    ['twitterImage',       'Twitter Image URL',   'url',      null],
                  ].map(([field, label, type, max]) => (
                    <div key={field} className="eup-form-group">
                      <label className="eup-label">{label}</label>
                      {type === 'textarea'
                        ? <textarea className="eup-textarea" name={`seo.${field}`} rows={3} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                        : <input type={type} className="eup-input" name={`seo.${field}`} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ SETTINGS ═════════════════════════════════════════════════ */}
            {activeTab === 'settings' && (
              <div className="eup-tab-content">
                <div className="eup-section">
                  <h3 className="eup-section-title">Product Flags</h3>
                  <div className="eup-checkbox-grid">
                    {[['isFeatured','Featured'],['isNewArrival','New Arrival'],['isBestseller','Bestseller']].map(([name, label]) => (
                      <label key={name} className="eup-checkbox">
                        <input type="checkbox" name={name} checked={formData[name]} onChange={handleInputChange} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="eup-form-group" style={{ marginTop: '2rem' }}>
                    <label className="eup-label">Status</label>
                    <select className="eup-select" name="status" value={formData.status} onChange={handleInputChange}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ══ ACTION BAR ═══════════════════════════════════════════════ */}
            <div className="eup-actions">
              <button type="button" className="eup-btn eup-btn-secondary"
                onClick={() => navigate('/admin/products')} disabled={updating}>
                Cancel
              </button>
              <button type="button" className="eup-btn eup-btn-primary"
                onClick={handleSubmit} disabled={updating}>
                {updating ? 'Updating…' : <><FiSave /> Update Product</>}
              </button>
            </div>

          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}