import React, { useCallback, useEffect, useState } from 'react';
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

const CATEGORIES = [
  'Electronics', 'Clothing & Apparel', 'Home & Living',
  'Sports & Outdoors', 'Beauty & Personal Care', 'Books & Media', 'Food & Beverages'
];
const CURRENCIES    = ['USD', 'EUR', 'GBP', 'NGN'];
const WEIGHT_UNITS  = ['kg', 'lb', 'g'];
const DIM_UNITS     = ['cm', 'in'];
const SCHEMA_TYPES  = ['Product', 'Book', 'Course', 'SoftwareApplication'];
const CONDITIONS    = ['NewCondition', 'UsedCondition', 'RefurbishedCondition', 'DamagedCondition'];
const TWITTER_CARDS = ['summary', 'summary_large_image'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_FORM = () => ({
  name: '', description: '', shortDescription: '',
  category: '', brand: '', manufacturer: '',
  pricing: { regular: '', sale: '', cost: '', currency: 'USD', validFrom: '', validThrough: '' },
  inventory: { stock: '', sku: '', barcode: '', gtin: '', mpn: '', trackInventory: true, lowStockThreshold: 5 },
  dimensions: { length: '', width: '', height: '', unit: 'cm' },
  weight: { value: '', unit: 'kg' },
  seo: {
    metaTitle: '', metaDescription: '', keywords: [], canonicalUrl: '',
    noIndex: false, noFollow: false,
    ogTitle: '', ogDescription: '', ogImage: '', ogType: 'product',
    twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '', twitterImage: '',
    schemaType: 'Product', condition: 'NewCondition', focusKeyphrase: '', relatedSearchTerms: []
  },
  isFeatured: false, isNewArrival: true, isBestseller: false
});

// ─── Component ────────────────────────────────────────────────────────────────

function CreateProduct() {
  // FIX: destructure `productCreated` (not the shared `success`) so this
  // component only reacts to its own action completing — not to deleteProduct,
  // addOrderMessage, updateOrder, or any of the other 15 thunks that also
  // set `success: true` in the old slice.
  const { productCreated, loading, error } = useSelector(state => state.admin);
  const dispatch = useDispatch();

  const [activeTab, setActiveTab]   = useState('basic');
  const [images, setImages]         = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [formData, setFormData]     = useState(INITIAL_FORM);
  const [subcategories, setSubcategories] = useState([]);
  const [tags, setTags]             = useState([]);
  const [specifications, setSpecifications] = useState([]);
  const [variants, setVariants]     = useState([]);
  const [seoKeywords, setSeoKeywords]         = useState([]);
  const [relatedSearchTerms, setRelatedSearchTerms] = useState([]);
  const [breadcrumbs, setBreadcrumbs]         = useState([]);
  const [richSnippets, setRichSnippets]       = useState({ faqs: [], howTo: { name: '', steps: [] }, videos: [] });

  const [newSubcategory, setNewSubcategory] = useState('');
  const [newTag, setNewTag]                 = useState('');
  const [newKeyword, setNewKeyword]         = useState('');
  const [newRelatedTerm, setNewRelatedTerm] = useState('');
  const [newBreadcrumb, setNewBreadcrumb]   = useState({ name: '', url: '' });

  // ── Input handler ────────────────────────────────────────────────────────────
  const handleInputChange = e => {
    const { name, value, type, checked } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setFormData(prev => ({ ...prev, [parent]: { ...prev[parent], [child]: type === 'checkbox' ? checked : value } }));
    } else {
      setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    }
  };

  // ── Image handling ───────────────────────────────────────────────────────────
  const handleImageUpload = e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    files.forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" exceeds 10MB and was skipped`);
        return;
      }
      const isDuplicate = images.some(img => img.name === file.name && img.size === file.size);
      if (isDuplicate) {
        toast.warn(`"${file.name}" is already added`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (reader.readyState === 2) {
          setImages(old => [...old, file]);
          setImagePreviews(old => [...old, {
            url: reader.result,
            name: file.name,
            size: (file.size / 1024).toFixed(1) + ' KB',
            alt: '',
            caption: ''
          }]);
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removeImage = index => {
    setImages(old => old.filter((_, i) => i !== index));
    setImagePreviews(old => old.filter((_, i) => i !== index));
  };

  const setPrimaryImage = index => {
    if (index === 0) return;
    setImages(old => { const n = [...old]; [n[0], n[index]] = [n[index], n[0]]; return n; });
    setImagePreviews(old => { const n = [...old]; [n[0], n[index]] = [n[index], n[0]]; return n; });
  };

  const updateImageMeta = (index, field, value) => {
    setImagePreviews(old => old.map((img, i) => i === index ? { ...img, [field]: value } : img));
  };

  // ── Tag / keyword helpers ────────────────────────────────────────────────────
  const addItem = (value, setter, resetSetter, transform = v => v) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setter(prev => [...prev, transform(trimmed)]);
    resetSetter('');
  };

  const removeItem = (index, setter) => setter(prev => prev.filter((_, i) => i !== index));

  // ── Breadcrumbs ───────────────────────────────────────────────────────────────
  const addBreadcrumb = () => {
    if (!newBreadcrumb.name.trim() || !newBreadcrumb.url.trim()) return;
    setBreadcrumbs(prev => [...prev, { name: newBreadcrumb.name.trim(), url: newBreadcrumb.url.trim(), position: prev.length + 1 }]);
    setNewBreadcrumb({ name: '', url: '' });
  };
  const removeBreadcrumb = index =>
    setBreadcrumbs(prev => prev.filter((_, i) => i !== index).map((b, i) => ({ ...b, position: i + 1 })));

  // ── Specifications ────────────────────────────────────────────────────────────
  const addSpec    = () => setSpecifications(prev => [...prev, { key: '', value: '' }]);
  const updateSpec = (i, field, val) => setSpecifications(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  const removeSpec = i => setSpecifications(prev => prev.filter((_, idx) => idx !== i));

  // ── Variants ──────────────────────────────────────────────────────────────────
  const addVariant          = () => setVariants(prev => [...prev, { name: '', options: [{ value: '', priceModifier: 0, stock: 0 }] }]);
  const updateVariantName   = (i, name) => setVariants(prev => prev.map((v, idx) => idx === i ? { ...v, name } : v));
  const removeVariant       = i => setVariants(prev => prev.filter((_, idx) => idx !== i));
  const addVariantOption    = vi => setVariants(prev => prev.map((v, i) => i === vi ? { ...v, options: [...v.options, { value: '', priceModifier: 0, stock: 0 }] } : v));
  const updateVariantOption = (vi, oi, field, val) =>
    setVariants(prev => prev.map((v, i) => i === vi
      ? { ...v, options: v.options.map((o, j) => j === oi ? { ...o, [field]: val } : o) }
      : v));
  const removeVariantOption = (vi, oi) =>
    setVariants(prev => prev.map((v, i) => i === vi ? { ...v, options: v.options.filter((_, j) => j !== oi) } : v));

  // ── Rich Snippets ─────────────────────────────────────────────────────────────
  const addFAQ    = () => setRichSnippets(p => ({ ...p, faqs: [...p.faqs, { question: '', answer: '' }] }));
  const updateFAQ = (i, field, val) => setRichSnippets(p => ({ ...p, faqs: p.faqs.map((f, idx) => idx === i ? { ...f, [field]: val } : f) }));
  const removeFAQ = i => setRichSnippets(p => ({ ...p, faqs: p.faqs.filter((_, idx) => idx !== i) }));

  const addVideo    = () => setRichSnippets(p => ({ ...p, videos: [...p.videos, { name: '', description: '', thumbnailUrl: '', contentUrl: '' }] }));
  const updateVideo = (i, field, val) => setRichSnippets(p => ({ ...p, videos: p.videos.map((v, idx) => idx === i ? { ...v, [field]: val } : v) }));
  const removeVideo = i => setRichSnippets(p => ({ ...p, videos: p.videos.filter((_, idx) => idx !== i) }));

  // ── Reset ─────────────────────────────────────────────────────────────────────
  // Bug 2 fix: wrapped in useCallback with stable empty-deps so resetForm has a
  // stable reference and can safely appear in the useEffect dependency array.
  // Without useCallback, resetForm is recreated every render — listing it in deps
  // would cause an infinite loop, omitting it leaves a stale closure.
  // All useState setters are stable by React contract, so [] deps is correct.
  const resetForm = useCallback(() => {
    setFormData(INITIAL_FORM());
    setImages([]); setImagePreviews([]);
    setSubcategories([]); setTags([]); setSpecifications([]);
    setVariants([]); setSeoKeywords([]); setRelatedSearchTerms([]);
    setBreadcrumbs([]);
    setRichSnippets({ faqs: [], howTo: { name: '', steps: [] }, videos: [] });
    setActiveTab('basic');
  }, []);

  // ── Validation ────────────────────────────────────────────────────────────────
  const validateDraft = () => {
    if (!formData.name.trim()) {
      toast.error('Product name is required even for a draft'); setActiveTab('basic'); return false;
    }
    if (!formData.category) {
      toast.error('Category is required even for a draft'); setActiveTab('basic'); return false;
    }
    if (!formData.pricing.regular) {
      toast.error('Regular price is required even for a draft'); setActiveTab('pricing'); return false;
    }
    return true;
  };

  const validatePublish = () => {
    if (!formData.name.trim())        { toast.error('Product name is required');        setActiveTab('basic');     return false; }
    if (!formData.category)           { toast.error('Category is required');            setActiveTab('basic');     return false; }
    if (!formData.description.trim()) { toast.error('Product description is required'); setActiveTab('basic');     return false; }

    if (!formData.pricing.regular) { toast.error('Regular price is required'); setActiveTab('pricing'); return false; }
    if (formData.pricing.sale !== '' && Number(formData.pricing.sale) >= Number(formData.pricing.regular)) {
      toast.error('Sale price must be less than regular price'); setActiveTab('pricing'); return false;
    }
    if (formData.pricing.validFrom && formData.pricing.validThrough) {
      if (new Date(formData.pricing.validFrom) > new Date(formData.pricing.validThrough)) {
        toast.error('Price valid-from must be before valid-through'); setActiveTab('pricing'); return false;
      }
    }

    if (images.length === 0) { toast.error('At least one product image is required'); setActiveTab('media'); return false; }

    if (formData.seo.metaTitle && formData.seo.metaTitle.length > 60) {
      toast.error('SEO Meta Title must not exceed 60 characters'); setActiveTab('seo'); return false;
    }
    if (formData.seo.metaDescription && formData.seo.metaDescription.length > 160) {
      toast.error('SEO Meta Description must not exceed 160 characters'); setActiveTab('seo'); return false;
    }
    if (formData.seo.metaDescription && formData.seo.metaDescription.length < 120 && formData.seo.metaDescription.length > 0) {
      toast.warn('SEO Meta Description is below recommended 120 characters');
    }

    return true;
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = (e, publishStatus) => {
    e.preventDefault();

    const isValid = publishStatus === 'draft' ? validateDraft() : validatePublish();
    if (!isValid) return;

    const myForm = new FormData();

    myForm.append('name',             formData.name.trim());
    myForm.append('description',      formData.description.trim());
    myForm.append('shortDescription', formData.shortDescription.trim());
    myForm.append('category',         formData.category);
    myForm.append('brand',            formData.brand.trim());
    myForm.append('manufacturer',     formData.manufacturer.trim());

    const pricingData = { regular: Number(formData.pricing.regular), currency: formData.pricing.currency };
    if (formData.pricing.cost !== '')       pricingData.cost = Number(formData.pricing.cost);
    if (formData.pricing.sale !== '')       pricingData.sale = Number(formData.pricing.sale);
    if (formData.pricing.validFrom)         pricingData.validFrom = formData.pricing.validFrom;
    if (formData.pricing.validThrough)      pricingData.validThrough = formData.pricing.validThrough;
    myForm.append('pricing', JSON.stringify(pricingData));

    const inventoryData = {
      stock: Number(formData.inventory.stock) || 0,
      trackInventory: formData.inventory.trackInventory,
      lowStockThreshold: Number(formData.inventory.lowStockThreshold)
    };
    if (formData.inventory.sku.trim())     inventoryData.sku = formData.inventory.sku.trim();
    if (formData.inventory.barcode.trim()) inventoryData.barcode = formData.inventory.barcode.trim();
    if (formData.inventory.gtin.trim())    inventoryData.gtin = formData.inventory.gtin.trim();
    if (formData.inventory.mpn.trim())     inventoryData.mpn = formData.inventory.mpn.trim();
    myForm.append('inventory', JSON.stringify(inventoryData));

    myForm.append('subcategories', JSON.stringify(subcategories));
    myForm.append('tags',          JSON.stringify(tags));

    const validSpecs    = specifications.filter(s => s.key && s.value);
    const validVariants = variants.filter(v => v.name && v.options.length > 0);
    if (validSpecs.length)    myForm.append('specifications', JSON.stringify(validSpecs));
    if (validVariants.length) myForm.append('variants',       JSON.stringify(validVariants));

    myForm.append('dimensions', JSON.stringify({
      length: Number(formData.dimensions.length) || 0,
      width:  Number(formData.dimensions.width)  || 0,
      height: Number(formData.dimensions.height) || 0,
      unit:   formData.dimensions.unit
    }));
    myForm.append('weight', JSON.stringify({
      value: Number(formData.weight.value) || 0,
      unit:  formData.weight.unit
    }));

    const seoData = {
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
      relatedSearchTerms
    };
    myForm.append('seo', JSON.stringify(seoData));

    if (breadcrumbs.length > 0) myForm.append('breadcrumbs', JSON.stringify(breadcrumbs));

    myForm.append('richSnippets', JSON.stringify({
      faqs:   richSnippets.faqs.filter(f => f.question && f.answer),
      howTo:  richSnippets.howTo,
      videos: richSnippets.videos.filter(v => v.name && v.contentUrl)
    }));

    myForm.append('isFeatured',   formData.isFeatured);
    myForm.append('isNewArrival', formData.isNewArrival);
    myForm.append('isBestseller', formData.isBestseller);
    myForm.append('status',       publishStatus || 'published');

    const imageMetadata = imagePreviews.map(img => ({ alt: img.alt || '', caption: img.caption || '' }));
    myForm.append('imageMetadata', JSON.stringify(imageMetadata));

    images.forEach(img => myForm.append('images', img));

    dispatch(createProduct(myForm));
  };

  // ── Effects ───────────────────────────────────────────────────────────────────
  // FIX: watch `productCreated` instead of the shared `success` flag.
  // Previously, `success` was set by 15+ different thunks across the admin
  // slice (deleteProduct, updateOrder, addOrderMessage, cancelOrder, etc.).
  // If the admin had performed any of those actions before visiting this page,
  // `success` would already be `true` in the Redux store. The moment this
  // component mounted and the useEffect ran, it would fire — showing the
  // "Product created successfully!" toast and resetting all inputs to empty,
  // even though no product had been submitted yet.
  //
  // Now `productCreated` is only set to `true` by `createProduct.fulfilled`,
  // so the toast and resetForm() only trigger when this specific action succeeds.
  useEffect(() => {
    // Bug 4 fix: `error` is stored as a string in the slice (not an object),
    // so `error.message` is always undefined. Simplified to just `error`.
    if (error)          { toast.error(error, { position: 'top-center', autoClose: 3000 }); dispatch(removeErrors()); }
    if (productCreated) { toast.success('Product created successfully!', { position: 'top-center', autoClose: 3000 }); dispatch(removeProductCreated()); resetForm(); }

    // Bug 3 fix: clear productCreated on unmount so navigating away and back
    // doesn't leave a stale `true` value in Redux that re-triggers the toast
    // and form reset the moment the component mounts again.
    return () => { dispatch(removeProductCreated()); };
  }, [dispatch, error, productCreated, resetForm]);

  // ── Tab config ────────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'basic',     label: 'Basic Info',    icon: <FiPackage /> },
    { id: 'pricing',   label: 'Pricing',       icon: <FiDollarSign /> },
    { id: 'inventory', label: 'Inventory',     icon: <FiPackage /> },
    { id: 'media',     label: 'Media',         icon: <FiImage /> },
    { id: 'variants',  label: 'Variants',      icon: <FiSettings /> },
    { id: 'seo',       label: 'SEO',           icon: <FiTrendingUp /> },
    { id: 'advanced',  label: 'Advanced SEO',  icon: <FiTag /> },
    { id: 'settings',  label: 'Settings',      icon: <FiFlag /> }
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
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
            {tabs.map(tab => (
              <button key={tab.id} type="button"
                className={`ecp-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}>
                {tab.icon}<span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="ecp-form">

            {/* ══ BASIC INFO ══════════════════════════════════════════════════ */}
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
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
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

                  {/* Subcategories */}
                  <div className="ecp-form-group">
                    <label className="ecp-label">Subcategories</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add subcategory"
                        value={newSubcategory} onChange={e => setNewSubcategory(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newSubcategory, setSubcategories, setNewSubcategory))} />
                      <button type="button" className="ecp-btn-icon"
                        onClick={() => addItem(newSubcategory, setSubcategories, setNewSubcategory)}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {subcategories.map((s, i) => (
                        <span key={i} className="ecp-tag">{s}
                          <button type="button" onClick={() => removeItem(i, setSubcategories)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="ecp-form-group">
                    <label className="ecp-label">Tags</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add tag"
                        value={newTag} onChange={e => setNewTag(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newTag, setTags, setNewTag, v => v.toLowerCase()))} />
                      <button type="button" className="ecp-btn-icon"
                        onClick={() => addItem(newTag, setTags, setNewTag, v => v.toLowerCase())}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {tags.map((t, i) => (
                        <span key={i} className="ecp-tag">{t}
                          <button type="button" onClick={() => removeItem(i, setTags)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Specifications */}
                  <div className="ecp-form-group">
                    <div className="ecp-label-with-btn">
                      <label className="ecp-label">Specifications</label>
                      <button type="button" className="ecp-btn-small" onClick={addSpec}><FiPlus /> Add Spec</button>
                    </div>
                    {specifications.map((spec, i) => (
                      <div key={i} className="ecp-spec-row">
                        <input type="text" className="ecp-input" placeholder="Key (e.g., Material)"
                          value={spec.key} onChange={e => updateSpec(i, 'key', e.target.value)} />
                        <input type="text" className="ecp-input" placeholder="Value (e.g., Cotton)"
                          value={spec.value} onChange={e => updateSpec(i, 'value', e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeSpec(i)}><FiTrash2 /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══ PRICING ═════════════════════════════════════════════════════ */}
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
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Price Valid From</label>
                      <input type="date" className="ecp-input" name="pricing.validFrom"
                        value={formData.pricing.validFrom} onChange={handleInputChange} />
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Price Valid Through</label>
                      <input type="date" className="ecp-input" name="pricing.validThrough"
                        value={formData.pricing.validThrough} onChange={handleInputChange} />
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
                          {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Dimensions (L × W × H)</label>
                    <div className="ecp-dimensions-grid">
                      {['length', 'width', 'height'].map(dim => (
                        <input key={dim} type="number" className="ecp-input"
                          placeholder={dim.charAt(0).toUpperCase() + dim.slice(1)}
                          name={`dimensions.${dim}`} value={formData.dimensions[dim]}
                          onChange={handleInputChange} min="0" step="0.01" />
                      ))}
                      <select className="ecp-select" name="dimensions.unit" value={formData.dimensions.unit} onChange={handleInputChange}>
                        {DIM_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ INVENTORY ═══════════════════════════════════════════════════ */}
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
                        name="inventory.lowStockThreshold" value={formData.inventory.lowStockThreshold}
                        onChange={handleInputChange} min="0" />
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

            {/* ══ MEDIA ═══════════════════════════════════════════════════════ */}
            {activeTab === 'media' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Images</h3>

                  <div className="ecp-upload-area">
                    <input type="file" id="product-images" className="ecp-file-input"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple onChange={handleImageUpload} />
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
                              <button type="button" className="ecp-image-btn"
                                onClick={() => setPrimaryImage(i)} title="Set as primary">
                                {i === 0 ? <FiCheck /> : <FiEye />}
                              </button>
                              <button type="button" className="ecp-image-btn ecp-image-btn-danger"
                                onClick={() => removeImage(i)} title="Remove">
                                <FiTrash2 />
                              </button>
                            </div>
                            {i === 0 && <span className="ecp-primary-badge">Primary</span>}

                            <div className="ecp-image-meta">
                              <input type="text" className="ecp-input ecp-image-meta-input"
                                placeholder="Alt text (SEO)" maxLength={125}
                                value={img.alt} onChange={e => updateImageMeta(i, 'alt', e.target.value)} />
                              <input type="text" className="ecp-input ecp-image-meta-input"
                                placeholder="Caption (optional)" maxLength={200}
                                value={img.caption} onChange={e => updateImageMeta(i, 'caption', e.target.value)} />
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

            {/* ══ VARIANTS ════════════════════════════════════════════════════ */}
            {activeTab === 'variants' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <div className="ecp-label-with-btn">
                    <h3 className="ecp-section-title">Product Variants</h3>
                    <button type="button" className="ecp-btn-small" onClick={addVariant}><FiPlus /> Add Variant</button>
                  </div>

                  {variants.length === 0 && (
                    <div className="ecp-info-box">
                      <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                      <span>Add variants if your product comes in different sizes, colors, or styles</span>
                    </div>
                  )}

                  {variants.map((variant, vi) => (
                    <div key={vi} className="ecp-variant-card">
                      <div className="ecp-variant-header">
                        <input type="text" className="ecp-input" placeholder="Variant name (e.g., Size, Color)"
                          value={variant.name} onChange={e => updateVariantName(vi, e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeVariant(vi)}><FiTrash2 /></button>
                      </div>
                      <div className="ecp-variant-options">
                        {variant.options.map((opt, oi) => (
                          <div key={oi} className="ecp-variant-option-row">
                            <input type="text" className="ecp-input" placeholder="Value"
                              value={opt.value} onChange={e => updateVariantOption(vi, oi, 'value', e.target.value)} />
                            <input type="number" className="ecp-input" placeholder="Price +"
                              value={opt.priceModifier} onChange={e => updateVariantOption(vi, oi, 'priceModifier', Number(e.target.value))} step="0.01" />
                            <input type="number" className="ecp-input" placeholder="Stock"
                              value={opt.stock} onChange={e => updateVariantOption(vi, oi, 'stock', Number(e.target.value))} min="0" />
                            <button type="button" className="ecp-btn-icon-danger" onClick={() => removeVariantOption(vi, oi)}><FiX /></button>
                          </div>
                        ))}
                        <button type="button" className="ecp-btn-secondary ecp-btn-full"
                          onClick={() => addVariantOption(vi)}><FiPlus /> Add Option</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ SEO ═════════════════════════════════════════════════════════ */}
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
                      name="seo.metaDescription" value={formData.seo.metaDescription} onChange={handleInputChange}
                      rows={3} maxLength={160} />
                    <span className={`ecp-char-count ${formData.seo.metaDescription.length > 0 && formData.seo.metaDescription.length < 120 ? 'ecp-char-count--warn' : ''}`}>
                      {formData.seo.metaDescription.length}/160 {formData.seo.metaDescription.length > 0 && formData.seo.metaDescription.length < 120 ? '(min 120 recommended)' : ''}
                    </span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">SEO Keywords</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add keyword"
                        value={newKeyword} onChange={e => setNewKeyword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newKeyword, setSeoKeywords, setNewKeyword))} />
                      <button type="button" className="ecp-btn-icon"
                        onClick={() => addItem(newKeyword, setSeoKeywords, setNewKeyword)}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {seoKeywords.map((k, i) => (
                        <span key={i} className="ecp-tag">{k}
                          <button type="button" onClick={() => removeItem(i, setSeoKeywords)}><FiX /></button>
                        </span>
                      ))}
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

                  {/* Breadcrumbs */}
                  <div className="ecp-form-group" style={{ marginTop: '2rem' }}>
                    <div className="ecp-label-with-btn">
                      <label className="ecp-label">Breadcrumbs</label>
                      <button type="button" className="ecp-btn-small" onClick={addBreadcrumb}
                        disabled={!newBreadcrumb.name || !newBreadcrumb.url}><FiPlus /> Add</button>
                    </div>
                    <div className="ecp-spec-row">
                      <input type="text" className="ecp-input" placeholder="Name (e.g., Home)"
                        value={newBreadcrumb.name} onChange={e => setNewBreadcrumb(p => ({ ...p, name: e.target.value }))} />
                      <input type="text" className="ecp-input" placeholder="URL (e.g., /)"
                        value={newBreadcrumb.url} onChange={e => setNewBreadcrumb(p => ({ ...p, url: e.target.value }))} />
                    </div>
                    <div className="ecp-tags">
                      {breadcrumbs.map((b, i) => (
                        <span key={i} className="ecp-tag">{b.position}. {b.name}
                          <button type="button" onClick={() => removeBreadcrumb(i)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Schema Type</label>
                      <select className="ecp-select" name="seo.schemaType" value={formData.seo.schemaType} onChange={handleInputChange}>
                        {SCHEMA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="ecp-form-group">
                      <label className="ecp-label">Condition</label>
                      <select className="ecp-select" name="seo.condition" value={formData.seo.condition} onChange={handleInputChange}>
                        {CONDITIONS.map(c => <option key={c} value={c}>{c.replace('Condition', '')}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="ecp-checkbox-grid">
                    <label className="ecp-checkbox">
                      <input type="checkbox" name="seo.noIndex" checked={formData.seo.noIndex} onChange={handleInputChange} />
                      <span>No Index (hide from search engines)</span>
                    </label>
                    <label className="ecp-checkbox">
                      <input type="checkbox" name="seo.noFollow" checked={formData.seo.noFollow} onChange={handleInputChange} />
                      <span>No Follow</span>
                    </label>
                  </div>

                  {/* Related Search Terms */}
                  <div className="ecp-form-group" style={{ marginTop: '2rem' }}>
                    <label className="ecp-label">Related Search Terms</label>
                    <div className="ecp-input-with-btn">
                      <input type="text" className="ecp-input" placeholder="Add related search term"
                        value={newRelatedTerm} onChange={e => setNewRelatedTerm(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, v => v.toLowerCase()))} />
                      <button type="button" className="ecp-btn-icon"
                        onClick={() => addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, v => v.toLowerCase())}><FiPlus /></button>
                    </div>
                    <div className="ecp-tags">
                      {relatedSearchTerms.map((t, i) => (
                        <span key={i} className="ecp-tag">{t}
                          <button type="button" onClick={() => removeItem(i, setRelatedSearchTerms)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* FAQs */}
                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Rich Snippets — FAQs</h3>
                  <div className="ecp-label-with-btn">
                    <label className="ecp-label">Frequently Asked Questions</label>
                    <button type="button" className="ecp-btn-small" onClick={addFAQ}><FiPlus /> Add FAQ</button>
                  </div>
                  {richSnippets.faqs.map((faq, i) => (
                    <div key={i} className="ecp-faq-card">
                      <div className="ecp-faq-header">
                        <input type="text" className="ecp-input" placeholder="Question"
                          value={faq.question} onChange={e => updateFAQ(i, 'question', e.target.value)} maxLength={200} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeFAQ(i)}><FiTrash2 /></button>
                      </div>
                      <textarea className="ecp-textarea" placeholder="Answer"
                        value={faq.answer} onChange={e => updateFAQ(i, 'answer', e.target.value)} rows={3} maxLength={1000} />
                    </div>
                  ))}

                  {/* Videos */}
                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Rich Snippets — Videos</h3>
                  <div className="ecp-label-with-btn">
                    <label className="ecp-label">Product Videos</label>
                    <button type="button" className="ecp-btn-small" onClick={addVideo}><FiPlus /> Add Video</button>
                  </div>
                  {richSnippets.videos.map((video, i) => (
                    <div key={i} className="ecp-video-card">
                      <div className="ecp-video-header">
                        <input type="text" className="ecp-input" placeholder="Video Name"
                          value={video.name} onChange={e => updateVideo(i, 'name', e.target.value)} />
                        <button type="button" className="ecp-btn-icon-danger" onClick={() => removeVideo(i)}><FiTrash2 /></button>
                      </div>
                      {[['description','Description'],['contentUrl','Content URL'],['thumbnailUrl','Thumbnail URL']].map(([field, ph]) => (
                        <input key={field} type={field.includes('Url') ? 'url' : 'text'} className="ecp-input"
                          placeholder={ph} value={video[field]} style={{ marginTop: '0.5rem' }}
                          onChange={e => updateVideo(i, field, e.target.value)} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ ADVANCED SEO ════════════════════════════════════════════════ */}
            {activeTab === 'advanced' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Open Graph (Facebook / LinkedIn)</h3>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Title <span className="ecp-recommended">(auto-filled from Meta Title if empty)</span></label>
                    <input type="text" className="ecp-input" placeholder="Title for social sharing"
                      name="seo.ogTitle" value={formData.seo.ogTitle} onChange={handleInputChange} maxLength={60} />
                    <span className="ecp-char-count">{formData.seo.ogTitle.length}/60</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Description <span className="ecp-recommended">(auto-filled from Meta Description if empty)</span></label>
                    <textarea className="ecp-textarea" placeholder="Description for social sharing"
                      name="seo.ogDescription" value={formData.seo.ogDescription} onChange={handleInputChange}
                      rows={3} maxLength={160} />
                    <span className="ecp-char-count">{formData.seo.ogDescription.length}/160</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Image URL <span className="ecp-recommended">(auto-filled from product images if empty)</span></label>
                    <input type="url" className="ecp-input" placeholder="https://example.com/image.jpg"
                      name="seo.ogImage" value={formData.seo.ogImage} onChange={handleInputChange} />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Type</label>
                    <input type="text" className="ecp-input" placeholder="product"
                      name="seo.ogType" value={formData.seo.ogType} onChange={handleInputChange} />
                  </div>

                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Twitter / X Card</h3>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Card Type</label>
                    <select className="ecp-select" name="seo.twitterCard" value={formData.seo.twitterCard} onChange={handleInputChange}>
                      {TWITTER_CARDS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Twitter Title <span className="ecp-recommended">(auto-filled from OG Title if empty)</span></label>
                    <input type="text" className="ecp-input" placeholder="Title for Twitter"
                      name="seo.twitterTitle" value={formData.seo.twitterTitle} onChange={handleInputChange} maxLength={70} />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Twitter Description <span className="ecp-recommended">(auto-filled from OG Description if empty)</span></label>
                    <textarea className="ecp-textarea" placeholder="Description for Twitter"
                      name="seo.twitterDescription" value={formData.seo.twitterDescription} onChange={handleInputChange}
                      rows={3} maxLength={200} />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Twitter Image URL</label>
                    <input type="url" className="ecp-input" placeholder="https://example.com/image.jpg"
                      name="seo.twitterImage" value={formData.seo.twitterImage} onChange={handleInputChange} />
                  </div>
                </div>
              </div>
            )}

            {/* ══ SETTINGS ════════════════════════════════════════════════════ */}
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

            {/* ══ ACTION BUTTONS ══════════════════════════════════════════════ */}
            <div className="ecp-actions">
              <button type="button" className="ecp-btn ecp-btn-secondary"
                onClick={e => handleSubmit(e, 'draft')} disabled={loading}>
                <FiSave /> Save as Draft
              </button>
              <button type="button" className="ecp-btn ecp-btn-primary"
                onClick={e => handleSubmit(e, 'published')} disabled={loading}>
                {loading ? 'Publishing...' : 'Publish Product'}
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