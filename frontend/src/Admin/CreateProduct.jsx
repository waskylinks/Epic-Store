import React, { useCallback, useEffect, useRef, useState } from 'react';
import PageTitle from '../components/PageTitle';
import '../AdminStyles/CreateProduct.css';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { createProduct, removeErrors, removeProductCreated } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import {
  FiImage, FiDollarSign, FiPackage, FiTag, FiSettings,
  FiTrendingUp, FiX, FiPlus, FiTrash2, FiSave,
  FiEye, FiAlertCircle, FiCheck, FiFlag
} from 'react-icons/fi';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES    = ['Electronics', 'Clothing & Apparel', 'Home & Living', 'Sports & Outdoors', 'Beauty & Personal Care', 'Books & Media', 'Food & Beverages'];
const CURRENCIES    = ['USD', 'EUR', 'GBP', 'NGN'];
const WEIGHT_UNITS  = ['kg', 'lb', 'g'];
const DIM_UNITS     = ['cm', 'in'];
const SCHEMA_TYPES  = ['Product', 'Book', 'Course', 'SoftwareApplication'];
const CONDITIONS    = ['NewCondition', 'UsedCondition', 'RefurbishedCondition', 'DamagedCondition'];
const TWITTER_CARDS = ['summary', 'summary_large_image'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const TABS = [
  { id: 'basic',     label: 'Basic Info',   icon: <FiPackage /> },
  { id: 'pricing',   label: 'Pricing',      icon: <FiDollarSign /> },
  { id: 'inventory', label: 'Inventory',    icon: <FiPackage /> },
  { id: 'media',     label: 'Media',        icon: <FiImage /> },
  { id: 'variants',  label: 'Variants',     icon: <FiSettings /> },
  { id: 'seo',       label: 'SEO',          icon: <FiTrendingUp /> },
  { id: 'advanced',  label: 'Advanced SEO', icon: <FiTag /> },
  { id: 'settings',  label: 'Settings',     icon: <FiFlag /> },
];

const makeInitialForm = () => ({
  name: '', description: '', shortDescription: '',
  category: '', brand: '', manufacturer: '',
  pricing:   { regular: '', sale: '', cost: '', currency: 'USD', validFrom: '', validThrough: '' },
  inventory: { stock: '', sku: '', barcode: '', gtin: '', mpn: '', trackInventory: true, lowStockThreshold: 5 },
  dimensions: { length: '', width: '', height: '', unit: 'cm' },
  weight:    { value: '', unit: 'kg' },
  seo: {
    metaTitle: '', metaDescription: '', canonicalUrl: '',
    noIndex: false, noFollow: false,
    ogTitle: '', ogDescription: '', ogImage: '', ogType: 'product',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '', twitterImage: '',
    schemaType: 'Product', condition: 'NewCondition', focusKeyphrase: '',
  },
  isFeatured: false, isNewArrival: true, isBestseller: false,
});

// ─── Component ────────────────────────────────────────────────────────────────

function CreateProduct() {
  // FIX: use `creating` (per-action flag) instead of the shared `loading`.
  // The shared flag is also set by fetchAdminProducts, getOrderMessages, etc.
  // Any background thunk completing would flip loading → false or back → true,
  // making the spinner disappear early or stick forever.
  const { productCreated, creating, error } = useSelector((s) => s.admin);
  const dispatch = useDispatch();

  const [activeTab,          setActiveTab]          = useState('basic');
  const [images,             setImages]             = useState([]);
  const [imagePreviews,      setImagePreviews]      = useState([]);
  const [formData,           setFormData]           = useState(makeInitialForm);
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

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setFormData(makeInitialForm());
    setImages([]); setImagePreviews([]);
    setSubcategories([]); setTags([]); setSpecifications([]);
    setVariants([]); setSeoKeywords([]); setRelatedSearchTerms([]);
    setBreadcrumbs([]);
    setRichSnippets({ faqs: [], howTo: { name: '', steps: [] }, videos: [] });
    setActiveTab('basic');
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────
  // FIX: split error and success into separate effects, and use a ref guard
  // so StrictMode's double-invoke of cleanup cannot clear productCreated
  // before the success branch reads it.
  //
  // How the old bug manifested in StrictMode (React 18 dev):
  //   1. createProduct.fulfilled → productCreated = true
  //   2. React runs effect cleanup (unmount sim): dispatch(removeProductCreated()) → productCreated = false
  //   3. React re-runs the effect body: productCreated is now false → toast never fires
  //   4. Component re-renders with creating=false but no toast, so button
  //      text reverts to "Publish Product" but nothing else happens.
  //
  // The ref guard ensures we handle the flag exactly once regardless of how
  // many times React re-runs the effect.
  const handledCreated = useRef(false);

  useEffect(() => {
    if (!error) return;
    toast.error(error, { position: 'top-center', autoClose: 3000 });
    dispatch(removeErrors());
  }, [error, dispatch]);

  useEffect(() => {
    if (!productCreated || handledCreated.current) return;
    handledCreated.current = true;
    toast.success('Product created successfully!', { position: 'top-center', autoClose: 3000 });
    dispatch(removeProductCreated());
    resetForm();
    handledCreated.current = false; // allow future creates in same session
  }, [productCreated, dispatch, resetForm]);

  // Clear stale flag on unmount only
  useEffect(() => {
    return () => { dispatch(removeProductCreated()); };
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

  // ── Image handling ────────────────────────────────────────────────────────
  const handleImageUpload = useCallback((e) => {
    Array.from(e.target.files).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) { toast.error(`"${file.name}" exceeds 10MB`); return; }
      if (images.some((img) => img.name === file.name && img.size === file.size)) {
        toast.warn(`"${file.name}" already added`); return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setImages((o) => [...o, file]);
        setImagePreviews((o) => [...o, { url: reader.result, name: file.name, size: (file.size / 1024).toFixed(1) + ' KB', alt: '', caption: '' }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, [images]);

  const removeImage      = useCallback((i) => { setImages((o) => o.filter((_, j) => j !== i)); setImagePreviews((o) => o.filter((_, j) => j !== i)); }, []);
  const setPrimaryImage  = useCallback((i) => { if (i === 0) return; setImages((o) => { const n = [...o]; [n[0], n[i]] = [n[i], n[0]]; return n; }); setImagePreviews((o) => { const n = [...o]; [n[0], n[i]] = [n[i], n[0]]; return n; }); }, []);
  const updateImageMeta  = useCallback((i, field, value) => setImagePreviews((o) => o.map((img, j) => j === i ? { ...img, [field]: value } : img)), []);

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

  // ── Validation ────────────────────────────────────────────────────────────
  const validateDraft = () => {
    if (!formData.name.trim())     { toast.error('Product name is required even for a draft'); setActiveTab('basic');   return false; }
    if (!formData.category)        { toast.error('Category is required even for a draft');     setActiveTab('basic');   return false; }
    if (!formData.pricing.regular) { toast.error('Regular price is required even for a draft'); setActiveTab('pricing'); return false; }
    return true;
  };

  const validatePublish = () => {
    if (!formData.name.trim())        { toast.error('Product name is required');        setActiveTab('basic');   return false; }
    if (!formData.category)           { toast.error('Category is required');            setActiveTab('basic');   return false; }
    if (!formData.description.trim()) { toast.error('Product description is required'); setActiveTab('basic');   return false; }
    if (!formData.pricing.regular)    { toast.error('Regular price is required');       setActiveTab('pricing'); return false; }
    if (formData.pricing.sale !== '' && Number(formData.pricing.sale) >= Number(formData.pricing.regular)) {
      toast.error('Sale price must be less than regular price'); setActiveTab('pricing'); return false;
    }
    if (formData.pricing.validFrom && formData.pricing.validThrough &&
        new Date(formData.pricing.validFrom) > new Date(formData.pricing.validThrough)) {
      toast.error('Price valid-from must be before valid-through'); setActiveTab('pricing'); return false;
    }
    if (images.length === 0) { toast.error('At least one product image is required'); setActiveTab('media'); return false; }
    return true;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback((e, publishStatus) => {
    e.preventDefault();
    const isValid = publishStatus === 'draft' ? validateDraft() : validatePublish();
    if (!isValid) return;

    const fd = new FormData();
    fd.append('name',             formData.name.trim());
    fd.append('description',      formData.description.trim());
    fd.append('shortDescription', formData.shortDescription.trim());
    fd.append('category',         formData.category);
    fd.append('brand',            formData.brand.trim());
    fd.append('manufacturer',     formData.manufacturer.trim());
    fd.append('status',           publishStatus || 'published');

    // Stringify booleans — raw FormData.append(key, false) sends the string
    // "false" which evaluates as truthy in a backend `if (val)` check.
    fd.append('isFeatured',   JSON.stringify(formData.isFeatured));
    fd.append('isNewArrival', JSON.stringify(formData.isNewArrival));
    fd.append('isBestseller', JSON.stringify(formData.isBestseller));

    const pricingData = { regular: Number(formData.pricing.regular), currency: formData.pricing.currency };
    if (formData.pricing.sale !== '')  pricingData.sale = Number(formData.pricing.sale);
    if (formData.pricing.cost !== '')  pricingData.cost = Number(formData.pricing.cost);
    if (formData.pricing.validFrom)    pricingData.validFrom = formData.pricing.validFrom;
    if (formData.pricing.validThrough) pricingData.validThrough = formData.pricing.validThrough;
    fd.append('pricing', JSON.stringify(pricingData));

    const inventoryData = { stock: Number(formData.inventory.stock) || 0, trackInventory: formData.inventory.trackInventory, lowStockThreshold: Number(formData.inventory.lowStockThreshold) };
    if (formData.inventory.sku.trim())     inventoryData.sku     = formData.inventory.sku.trim();
    if (formData.inventory.barcode.trim()) inventoryData.barcode = formData.inventory.barcode.trim();
    if (formData.inventory.gtin.trim())    inventoryData.gtin    = formData.inventory.gtin.trim();
    if (formData.inventory.mpn.trim())     inventoryData.mpn     = formData.inventory.mpn.trim();
    fd.append('inventory', JSON.stringify(inventoryData));

    fd.append('subcategories',  JSON.stringify(subcategories));
    fd.append('tags',           JSON.stringify(tags));

    const validSpecs    = specifications.filter((s) => s.key && s.value);
    const validVariants = variants.filter((v) => v.name && v.options.length > 0);
    if (validSpecs.length)    fd.append('specifications', JSON.stringify(validSpecs));
    if (validVariants.length) fd.append('variants',       JSON.stringify(validVariants));

    fd.append('dimensions', JSON.stringify({ length: Number(formData.dimensions.length) || 0, width: Number(formData.dimensions.width) || 0, height: Number(formData.dimensions.height) || 0, unit: formData.dimensions.unit }));
    fd.append('weight',     JSON.stringify({ value: Number(formData.weight.value) || 0, unit: formData.weight.unit }));

    fd.append('seo', JSON.stringify({
      metaTitle:          formData.seo.metaTitle.trim(),
      metaDescription:    formData.seo.metaDescription.trim(),
      keywords:           seoKeywords,
      canonicalUrl:       formData.seo.canonicalUrl || '',
      noIndex:            formData.seo.noIndex  || false,
      noFollow:           formData.seo.noFollow || false,
      ogTitle:            formData.seo.ogTitle.trim()            || formData.seo.metaTitle.trim(),
      ogDescription:      formData.seo.ogDescription.trim()      || formData.seo.metaDescription.trim(),
      ogImage:            formData.seo.ogImage       || '',
      ogType:             formData.seo.ogType        || 'product',
      twitterCard:        formData.seo.twitterCard   || 'summary_large_image',
      twitterTitle:       formData.seo.twitterTitle  || formData.seo.ogTitle.trim() || formData.seo.metaTitle.trim(),
      twitterDescription: formData.seo.twitterDescription || formData.seo.ogDescription.trim() || formData.seo.metaDescription.trim(),
      twitterImage:       formData.seo.twitterImage  || '',
      schemaType:         formData.seo.schemaType    || 'Product',
      condition:          formData.seo.condition     || 'NewCondition',
      focusKeyphrase:     formData.seo.focusKeyphrase.trim(),
      relatedSearchTerms,
    }));

    if (breadcrumbs.length > 0) fd.append('breadcrumbs', JSON.stringify(breadcrumbs));

    fd.append('richSnippets', JSON.stringify({
      faqs:   richSnippets.faqs.filter((f) => f.question && f.answer),
      howTo:  richSnippets.howTo,
      videos: richSnippets.videos.filter((v) => v.name && v.contentUrl),
    }));

    fd.append('imageMetadata', JSON.stringify(imagePreviews.map((img) => ({ alt: img.alt || '', caption: img.caption || '' }))));
    images.forEach((img) => fd.append('images', img));

    dispatch(createProduct(fd));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, images, imagePreviews, subcategories, tags, specifications, variants, seoKeywords, relatedSearchTerms, breadcrumbs, richSnippets, dispatch]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle title="Create Product" />
      <Navbar />

      <div className="ecp-container">
        <div className="ecp-header">
          <div className="ecp-header-content">
            <h1 className="ecp-title">Create New Product</h1>
            <p className="ecp-subtitle">Add a new product to your catalog</p>
          </div>
          <div className="ecp-header-actions">
            <button type="button" className="ecp-btn ecp-btn-secondary" onClick={resetForm}>
              <FiX /> Cancel
            </button>
          </div>
        </div>

        <div className="ecp-content">
          <div className="ecp-tabs">
            {TABS.map((tab) => (
              <button key={tab.id} type="button"
                className={`ecp-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}>
                {tab.icon}<span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="ecp-form">

            {/* ══ BASIC INFO ══════════════════════════════════════════════ */}
            {activeTab === 'basic' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Information</h3>

                  <div className="ecp-form-group">
                    <label className="ecp-label ecp-label--required">Product Name</label>
                    <input type="text" className="ecp-input" placeholder="Enter product name"
                      name="name" value={formData.name} onChange={handleInputChange} maxLength={200} />
                    <span className="ecp-char-count">{formData.name.length}/200</span>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label ecp-label--required">Category</label>
                      <select className="ecp-select" name="category" value={formData.category} onChange={handleInputChange}>
                        <option value="">Select Category</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Brand</label>
                      <input type="text" className="ecp-input" placeholder="Enter brand name (optional)"
                        name="brand" value={formData.brand} onChange={handleInputChange} />
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Manufacturer</label>
                    <input type="text" className="ecp-input" placeholder="Enter manufacturer name (optional)"
                      name="manufacturer" value={formData.manufacturer} onChange={handleInputChange} />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Short Description</label>
                    <textarea className="ecp-textarea" placeholder="Brief product description (optional)"
                      name="shortDescription" value={formData.shortDescription} onChange={handleInputChange}
                      rows={3} maxLength={500} />
                    <span className="ecp-char-count">{formData.shortDescription.length}/500</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label ecp-label--required">Full Description</label>
                    <textarea className="ecp-textarea" placeholder="Detailed product description"
                      name="description" value={formData.description} onChange={handleInputChange}
                      rows={6} maxLength={5000} />
                    <span className="ecp-char-count">{formData.description.length}/5000</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Subcategories</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add subcategory" value={newSubcategory}
                        onChange={(e) => setNewSubcategory(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newSubcategory, setSubcategories, setNewSubcategory); } }} />
                      <button type="button" className="ecp-btn-icon" onClick={() => addItem(newSubcategory, setSubcategories, setNewSubcategory)}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {subcategories.map((s, i) => <span key={i} className="ecp-tag">{s}<button type="button" onClick={() => removeItem(i, setSubcategories)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Tags</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add tag" value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newTag, setTags, setNewTag, (v) => v.toLowerCase()); } }} />
                      <button type="button" className="ecp-btn-icon" onClick={() => addItem(newTag, setTags, setNewTag, (v) => v.toLowerCase())}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {tags.map((t, i) => <span key={i} className="ecp-tag">{t}<button type="button" onClick={() => removeItem(i, setTags)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <div className="ecp-label-with-btn">
                      <label className="ecp-label">Specifications</label>
                      <button type="button" className="ecp-btn-small" onClick={addSpec}><FiPlus /> Add Spec</button>
                    </div>
                    {specifications.map((spec, i) => (
                      <div key={i} className="ecp-spec-row">
                        <input type="text" className="ecp-input" placeholder="Key" value={spec.key} onChange={(e) => updateSpec(i, 'key', e.target.value)} />
                        <input type="text" className="ecp-input" placeholder="Value" value={spec.value} onChange={(e) => updateSpec(i, 'value', e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeSpec(i)}><FiTrash2 /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══ PRICING ═════════════════════════════════════════════════ */}
            {activeTab === 'pricing' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Pricing Information</h3>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label ecp-label--required">Regular Price</label>
                      <div className="ecp-input-with-icon">
                        <FiDollarSign className="ecp-input-icon" />
                        <input type="number" className="ecp-input ecp-input-with-padding" placeholder="0.00"
                          name="pricing.regular" value={formData.pricing.regular} onChange={handleInputChange} min="0" step="0.01" />
                      </div>
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Sale Price</label>
                      <div className="ecp-input-with-icon">
                        <FiDollarSign className="ecp-input-icon" />
                        <input type="number" className="ecp-input ecp-input-with-padding" placeholder="0.00 (optional)"
                          name="pricing.sale" value={formData.pricing.sale} onChange={handleInputChange} min="0" step="0.01" />
                      </div>
                    </div>
                  </div>

                  {formData.pricing.regular !== '' && formData.pricing.sale !== '' &&
                   Number(formData.pricing.sale) < Number(formData.pricing.regular) && (
                    <div className="ecp-discount-preview">
                      <FiCheck className="ecp-discount-icon" />
                      <span>Discount: {Math.round(((Number(formData.pricing.regular) - Number(formData.pricing.sale)) / Number(formData.pricing.regular)) * 100)}% off</span>
                    </div>
                  )}

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Cost Price</label>
                      <div className="ecp-input-with-icon">
                        <FiDollarSign className="ecp-input-icon" />
                        <input type="number" className="ecp-input ecp-input-with-padding" placeholder="0.00 (optional)"
                          name="pricing.cost" value={formData.pricing.cost} onChange={handleInputChange} min="0" step="0.01" />
                      </div>
                      <small className="ecp-help-text">Your cost — used for margin calculations</small>
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Currency</label>
                      <select className="ecp-select" name="pricing.currency" value={formData.pricing.currency} onChange={handleInputChange}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Price Valid From</label>
                      <input type="date" className="ecp-input" name="pricing.validFrom" value={formData.pricing.validFrom} onChange={handleInputChange} />
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Price Valid Through</label>
                      <input type="date" className="ecp-input" name="pricing.validThrough" value={formData.pricing.validThrough} onChange={handleInputChange} />
                    </div>
                  </div>

                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Shipping Information</h3>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Weight</label>
                      <div className="ecp-input-group">
                        <input type="number" className="ecp-input" placeholder="0 (optional)"
                          name="weight.value" value={formData.weight.value} onChange={handleInputChange} min="0" step="0.01" />
                        <select className="ecp-select-addon" name="weight.unit" value={formData.weight.unit} onChange={handleInputChange}>
                          {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Dimensions (L × W × H)</label>
                    <div className="ecp-dimensions-grid">
                      {['length', 'width', 'height'].map((dim) => (
                        <input key={dim} type="number" className="ecp-input"
                          placeholder={dim.charAt(0).toUpperCase() + dim.slice(1)}
                          name={`dimensions.${dim}`} value={formData.dimensions[dim]}
                          onChange={handleInputChange} min="0" step="0.01" />
                      ))}
                      <select className="ecp-select" name="dimensions.unit" value={formData.dimensions.unit} onChange={handleInputChange}>
                        {DIM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ INVENTORY ═══════════════════════════════════════════════ */}
            {activeTab === 'inventory' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Inventory Management</h3>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Stock Quantity</label>
                      <input type="number" className="ecp-input" placeholder="0"
                        name="inventory.stock" value={formData.inventory.stock} onChange={handleInputChange} min="0" />
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Low Stock Threshold</label>
                      <input type="number" className="ecp-input" placeholder="5"
                        name="inventory.lowStockThreshold" value={formData.inventory.lowStockThreshold} onChange={handleInputChange} min="0" />
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">SKU</label>
                      <input type="text" className="ecp-input" placeholder="PROD-001 (optional)"
                        name="inventory.sku" value={formData.inventory.sku} onChange={handleInputChange} />
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Barcode</label>
                      <input type="text" className="ecp-input" placeholder="123456789 (optional)"
                        name="inventory.barcode" value={formData.inventory.barcode} onChange={handleInputChange} />
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">GTIN <span className="ecp-badge">Google Shopping</span></label>
                      <input type="text" className="ecp-input" placeholder="UPC / EAN / ISBN (optional)"
                        name="inventory.gtin" value={formData.inventory.gtin} onChange={handleInputChange} />
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">MPN</label>
                      <input type="text" className="ecp-input" placeholder="Manufacturer Part Number (optional)"
                        name="inventory.mpn" value={formData.inventory.mpn} onChange={handleInputChange} />
                    </div>
                  </div>

                  <div className="ecp-checkbox-group">
                    <label className="ecp-checkbox">
                      <input type="checkbox" name="inventory.trackInventory"
                        checked={formData.inventory.trackInventory} onChange={handleInputChange} />
                      <span>Track inventory for this product</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* ══ MEDIA ═══════════════════════════════════════════════════ */}
            {activeTab === 'media' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Images</h3>

                  <div className="ecp-upload-area">
                    <input type="file" id="product-images" className="ecp-file-input"
                      accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={handleImageUpload} />
                    <label htmlFor="product-images" className="ecp-upload-label">
                      <FiImage className="ecp-upload-icon" />
                      <span className="ecp-upload-text">Click or drag images here</span>
                      <span className="ecp-upload-subtext">JPEG, PNG, WebP — max 10MB each</span>
                    </label>
                  </div>

                  {imagePreviews.length > 0 && (
                    <>
                      <div className="ecp-info-box" style={{ margin: '1rem 0' }}>
                        <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                        <span>First image is the primary. Click <FiEye style={{ verticalAlign: 'middle' }} /> on any image to make it primary.</span>
                      </div>
                      <div className="ecp-image-grid">
                        {imagePreviews.map((img, i) => (
                          <div key={i} className="ecp-image-card">
                            <img src={img.url} alt={img.alt || `Product ${i + 1}`} />
                            <div className="ecp-image-overlay">
                              <button type="button" className="ecp-image-btn" onClick={() => setPrimaryImage(i)} title="Set as primary">
                                {i === 0 ? <FiCheck /> : <FiEye />}
                              </button>
                              <button type="button" className="ecp-image-btn ecp-image-btn-danger" onClick={() => removeImage(i)}><FiTrash2 /></button>
                            </div>
                            {i === 0 && <span className="ecp-primary-badge">Primary</span>}
                            <div className="ecp-image-meta">
                              <input type="text" className="ecp-input ecp-image-meta-input" placeholder="Alt text (SEO)" maxLength={125}
                                value={img.alt} onChange={(e) => updateImageMeta(i, 'alt', e.target.value)} />
                              <input type="text" className="ecp-input ecp-image-meta-input" placeholder="Caption (optional)" maxLength={200}
                                value={img.caption} onChange={(e) => updateImageMeta(i, 'caption', e.target.value)} />
                              <small className="ecp-image-size">{img.size}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ══ VARIANTS ════════════════════════════════════════════════ */}
            {activeTab === 'variants' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <div className="ecp-label-with-btn">
                    <h3 className="ecp-section-title">Product Variants</h3>
                    <button type="button" className="ecp-btn-small" onClick={addVariant}><FiPlus /> Add Variant</button>
                  </div>
                  {variants.length === 0 && (
                    <div className="ecp-info-box"><FiAlertCircle style={{ marginRight: '0.5rem' }} /><span>Add variants if your product comes in different sizes, colors, or styles</span></div>
                  )}
                  {variants.map((variant, vi) => (
                    <div key={vi} className="ecp-variant-card">
                      <div className="ecp-variant-header">
                        <input type="text" className="ecp-input" placeholder="Variant name (e.g., Size, Color)"
                          value={variant.name} onChange={(e) => updateVariantName(vi, e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeVariant(vi)}><FiTrash2 /></button>
                      </div>
                      <div className="ecp-variant-options">
                        {variant.options.map((opt, oi) => (
                          <div key={oi} className="ecp-variant-option-row">
                            <input type="text"   className="ecp-input" placeholder="Value"   value={opt.value}         onChange={(e) => updateVariantOption(vi, oi, 'value', e.target.value)} />
                            <input type="number" className="ecp-input" placeholder="Price +" value={opt.priceModifier} onChange={(e) => updateVariantOption(vi, oi, 'priceModifier', Number(e.target.value))} step="0.01" />
                            <input type="number" className="ecp-input" placeholder="Stock"   value={opt.stock}         onChange={(e) => updateVariantOption(vi, oi, 'stock', Number(e.target.value))} min="0" />
                            <button type="button" className="ecp-btn-icon-danger" onClick={() => removeVariantOption(vi, oi)}><FiX /></button>
                          </div>
                        ))}
                        <button type="button" className="ecp-btn-secondary ecp-btn-full" onClick={() => addVariantOption(vi)}><FiPlus /> Add Option</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ SEO ═════════════════════════════════════════════════════ */}
            {activeTab === 'seo' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Search Engine Optimization</h3>

                  <div className="ecp-info-box" style={{ marginBottom: '1.5rem' }}>
                    <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                    <span>Filling these fields improves search visibility. None are strictly required to save.</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Meta Title <span className="ecp-recommended">(recommended, max 60)</span></label>
                    <input type="text" className="ecp-input" placeholder="Enter SEO meta title"
                      name="seo.metaTitle" value={formData.seo.metaTitle} onChange={handleInputChange} maxLength={60} />
                    <span className="ecp-char-count">{formData.seo.metaTitle.length}/60</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Meta Description <span className="ecp-recommended">(recommended 120–160)</span></label>
                    <textarea className="ecp-textarea" placeholder="Enter SEO meta description"
                      name="seo.metaDescription" value={formData.seo.metaDescription} onChange={handleInputChange} rows={3} maxLength={160} />
                    <span className={`ecp-char-count ${formData.seo.metaDescription.length > 0 && formData.seo.metaDescription.length < 120 ? 'ecp-char-count--warn' : ''}`}>
                      {formData.seo.metaDescription.length}/160
                    </span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">SEO Keywords</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add keyword" value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newKeyword, setSeoKeywords, setNewKeyword); } }} />
                      <button type="button" className="ecp-btn-icon" onClick={() => addItem(newKeyword, setSeoKeywords, setNewKeyword)}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {seoKeywords.map((k, i) => <span key={i} className="ecp-tag">{k}<button type="button" onClick={() => removeItem(i, setSeoKeywords)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Focus Keyphrase</label>
                    <input type="text" className="ecp-input" placeholder="Main keyword phrase"
                      name="seo.focusKeyphrase" value={formData.seo.focusKeyphrase} onChange={handleInputChange} />
                    <small className="ecp-help-text">Primary keyword/phrase you want this product to rank for</small>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Canonical URL</label>
                    <input type="url" className="ecp-input" placeholder="https://example.com/products/name (optional)"
                      name="seo.canonicalUrl" value={formData.seo.canonicalUrl} onChange={handleInputChange} />
                  </div>

                  <div className="ecp-form-group" style={{ marginTop: '2rem' }}>
                    <div className="ecp-label-with-btn">
                      <label className="ecp-label">Breadcrumbs</label>
                      <button type="button" className="ecp-btn-small" onClick={addBreadcrumb} disabled={!newBreadcrumb.name || !newBreadcrumb.url}><FiPlus /> Add</button>
                    </div>
                    <div className="ecp-spec-row">
                      <input type="text" className="ecp-input" placeholder="Name (e.g., Home)" value={newBreadcrumb.name} onChange={(e) => setNewBreadcrumb((p) => ({ ...p, name: e.target.value }))} />
                      <input type="text" className="ecp-input" placeholder="URL (e.g., /)" value={newBreadcrumb.url} onChange={(e) => setNewBreadcrumb((p) => ({ ...p, url: e.target.value }))} />
                    </div>
                    <div className="ecp-tags">
                      {breadcrumbs.map((b, i) => <span key={i} className="ecp-tag">{b.position}. {b.name}<button type="button" onClick={() => removeBreadcrumb(i)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Schema Type</label>
                      <select className="ecp-select" name="seo.schemaType" value={formData.seo.schemaType} onChange={handleInputChange}>
                        {SCHEMA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Condition</label>
                      <select className="ecp-select" name="seo.condition" value={formData.seo.condition} onChange={handleInputChange}>
                        {CONDITIONS.map((c) => <option key={c} value={c}>{c.replace('Condition', '')}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="ecp-checkbox-grid">
                    <label className="ecp-checkbox"><input type="checkbox" name="seo.noIndex"  checked={formData.seo.noIndex}  onChange={handleInputChange} /><span>No Index (hide from search engines)</span></label>
                    <label className="ecp-checkbox"><input type="checkbox" name="seo.noFollow" checked={formData.seo.noFollow} onChange={handleInputChange} /><span>No Follow</span></label>
                  </div>

                  <div className="ecp-form-group" style={{ marginTop: '2rem' }}>
                    <label className="ecp-label">Related Search Terms</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add related search term" value={newRelatedTerm}
                        onChange={(e) => setNewRelatedTerm(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, (v) => v.toLowerCase()); } }} />
                      <button type="button" className="ecp-btn-icon" onClick={() => addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, (v) => v.toLowerCase())}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {relatedSearchTerms.map((t, i) => <span key={i} className="ecp-tag">{t}<button type="button" onClick={() => removeItem(i, setRelatedSearchTerms)}><FiX /></button></span>)}
                    </div>
                  </div>

                  <div className="ecp-label-with-btn" style={{ marginTop: '2rem' }}>
                    <h3 className="ecp-section-title">FAQs</h3>
                    <button type="button" className="ecp-btn-small" onClick={addFAQ}><FiPlus /> Add FAQ</button>
                  </div>
                  {richSnippets.faqs.map((faq, i) => (
                    <div key={i} className="ecp-faq-card">
                      <div className="ecp-faq-header">
                        <input type="text" className="ecp-input" placeholder="Question" maxLength={200}
                          value={faq.question} onChange={(e) => updateFAQ(i, 'question', e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeFAQ(i)}><FiTrash2 /></button>
                      </div>
                      <textarea className="ecp-textarea" placeholder="Answer" rows={3} maxLength={1000}
                        value={faq.answer} onChange={(e) => updateFAQ(i, 'answer', e.target.value)} />
                    </div>
                  ))}

                  <div className="ecp-label-with-btn" style={{ marginTop: '2rem' }}>
                    <h3 className="ecp-section-title">Videos</h3>
                    <button type="button" className="ecp-btn-small" onClick={addVideo}><FiPlus /> Add Video</button>
                  </div>
                  {richSnippets.videos.map((video, i) => (
                    <div key={i} className="ecp-video-card">
                      <div className="ecp-video-header">
                        <input type="text" className="ecp-input" placeholder="Video Name"
                          value={video.name} onChange={(e) => updateVideo(i, 'name', e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeVideo(i)}><FiTrash2 /></button>
                      </div>
                      {[['description','Description'],['contentUrl','Content URL'],['thumbnailUrl','Thumbnail URL']].map(([field, ph]) => (
                        <input key={field} type={field.includes('Url') ? 'url' : 'text'} className="ecp-input"
                          placeholder={ph} value={video[field]} style={{ marginTop: '0.5rem' }}
                          onChange={(e) => updateVideo(i, field, e.target.value)} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ ADVANCED SEO ════════════════════════════════════════════ */}
            {activeTab === 'advanced' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Open Graph (Facebook / LinkedIn)</h3>

                  {[
                    ['ogTitle',       'OG Title',       'text',     60],
                    ['ogDescription', 'OG Description', 'textarea', 160],
                    ['ogImage',       'OG Image URL',   'url',      null],
                    ['ogType',        'OG Type',        'text',     null],
                  ].map(([field, label, type, max]) => (
                    <div key={field} className="ecp-form-group">
                      <label className="ecp-label">{label}</label>
                      {type === 'textarea'
                        ? <textarea className="ecp-textarea" name={`seo.${field}`} rows={3} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                        : <input type={type} className="ecp-input" name={`seo.${field}`} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                      }
                      {max && <span className="ecp-char-count">{(formData.seo[field] ?? '').length}/{max}</span>}
                    </div>
                  ))}

                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Twitter / X Card</h3>
                  <div className="ecp-form-group">
                    <label className="ecp-label">Card Type</label>
                    <select className="ecp-select" name="seo.twitterCard" value={formData.seo.twitterCard} onChange={handleInputChange}>
                      {TWITTER_CARDS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {[
                    ['twitterTitle',       'Twitter Title',       'text',     70],
                    ['twitterDescription', 'Twitter Description', 'textarea', 200],
                    ['twitterImage',       'Twitter Image URL',   'url',      null],
                  ].map(([field, label, type, max]) => (
                    <div key={field} className="ecp-form-group">
                      <label className="ecp-label">{label}</label>
                      {type === 'textarea'
                        ? <textarea className="ecp-textarea" name={`seo.${field}`} rows={3} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                        : <input type={type} className="ecp-input" name={`seo.${field}`} maxLength={max ?? undefined} value={formData.seo[field]} onChange={handleInputChange} />
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ SETTINGS ════════════════════════════════════════════════ */}
            {activeTab === 'settings' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Flags</h3>
                  <p className="ecp-help-text" style={{ marginBottom: '1.5rem' }}>
                    These flags control how the product appears in storefront sections and promotions.
                  </p>
                  <div className="ecp-checkbox-grid">
                    {[['isFeatured','Featured Product'],['isNewArrival','New Arrival'],['isBestseller','Bestseller']].map(([name, label]) => (
                      <label key={name} className="ecp-checkbox">
                        <input type="checkbox" name={name} checked={formData[name]} onChange={handleInputChange} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══ ACTION BUTTONS ══════════════════════════════════════════ */}
            <div className="ecp-actions">
              <button type="button" className="ecp-btn ecp-btn-secondary"
                onClick={(e) => handleSubmit(e, 'draft')} disabled={creating}>
                <FiSave /> {creating ? 'Saving…' : 'Save as Draft'}
              </button>
              <button type="button" className="ecp-btn ecp-btn-primary"
                onClick={(e) => handleSubmit(e, 'published')} disabled={creating}>
                {creating ? 'Publishing…' : 'Publish Product'}
              </button>
            </div>

          </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default CreateProduct;