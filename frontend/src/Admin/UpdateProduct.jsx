import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import '../AdminStyles/UpdateProduct.css';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { updateProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { 
  FiImage, FiDollarSign, FiPackage, FiTag, FiSettings, 
  FiTrendingUp, FiX, FiPlus, FiTrash2, FiSave, 
  FiEye, FiAlertCircle, FiCheck, FiArrowLeft, FiFlag
} from 'react-icons/fi';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CATEGORIES    = ['Electronics','Clothing & Apparel','Home & Living','Sports & Outdoors','Beauty & Personal Care','Books & Media','Food & Beverages'];
const CURRENCIES    = ['USD','EUR','GBP','NGN'];
const WEIGHT_UNITS  = ['kg','lb','g'];
const DIM_UNITS     = ['cm','in'];
const SCHEMA_TYPES  = ['Product','Book','Course','SoftwareApplication'];
const CONDITIONS    = ['NewCondition','UsedCondition','RefurbishedCondition','DamagedCondition'];
const TWITTER_CARDS = ['summary','summary_large_image'];

function UpdateProduct() {
    const { id }   = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const { products, loading, error, success } = useSelector(state => state.admin);
    const product = products.find(p => p._id === id);

    const [activeTab, setActiveTab]           = useState('basic');
    const [oldImages, setOldImages]           = useState([]);
    const [imagesToDelete, setImagesToDelete] = useState([]);
    // FIX: newImagePreviews stores objects { url, name, size, alt, caption }
    // not raw base64 strings — mirrors CreateProduct so alt/caption inputs work
    // and imageMetadata can be sent to the backend.
    const [newImages, setNewImages]               = useState([]);
    const [newImagePreviews, setNewImagePreviews] = useState([]);

    const [formData, setFormData] = useState({
        name: '', description: '', shortDescription: '',
        category: '', brand: '', manufacturer: '',
        pricing:   { regular: '', sale: '', cost: '', currency: 'USD', validFrom: '', validThrough: '' },
        inventory: { stock: '', sku: '', barcode: '', gtin: '', mpn: '', trackInventory: true, lowStockThreshold: 5 },
        dimensions: { length: '', width: '', height: '', unit: 'cm' },
        weight:     { value: '', unit: 'kg' },
        // FIX: removed keywords and relatedSearchTerms from formData.seo — they
        // were dead/stale state. These live only in their dedicated arrays below.
        seo: {
            metaTitle: '', metaDescription: '', canonicalUrl: '',
            noIndex: false, noFollow: false,
            ogTitle: '', ogDescription: '', ogImage: '', ogType: 'product',
            twitterCard: 'summary_large_image', twitterTitle: '', twitterDescription: '', twitterImage: '',
            schemaType: 'Product', condition: 'NewCondition', focusKeyphrase: ''
        },
        isFeatured: false, isNewArrival: false, isBestseller: false, status: 'published'
    });

    const [subcategories, setSubcategories]           = useState([]);
    const [tags, setTags]                             = useState([]);
    const [specifications, setSpecifications]         = useState([]);
    const [variants, setVariants]                     = useState([]);
    const [seoKeywords, setSeoKeywords]               = useState([]);
    const [relatedSearchTerms, setRelatedSearchTerms] = useState([]);
    const [breadcrumbs, setBreadcrumbs]               = useState([]);
    const [richSnippets, setRichSnippets]             = useState({ faqs: [], howTo: { name: '', steps: [] }, videos: [] });

    const [newSubcategory, setNewSubcategory] = useState('');
    const [newTag, setNewTag]                 = useState('');
    const [newKeyword, setNewKeyword]         = useState('');
    const [newRelatedTerm, setNewRelatedTerm] = useState('');
    const [newBreadcrumb, setNewBreadcrumb]   = useState({ name: '', url: '' });

    // ── Prefill ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (product) {
            setFormData({
                name:             product.name || '',
                description:      product.description || '',
                shortDescription: product.shortDescription || '',
                category:         product.category || '',
                brand:            product.brand || '',
                manufacturer:     product.manufacturer || '',
                pricing: {
                    regular:      product.pricing?.regular ?? product.price ?? '',
                    sale:         product.pricing?.sale ?? '',
                    cost:         product.pricing?.cost ?? '',
                    currency:     product.pricing?.currency || 'USD',
                    validFrom:    product.pricing?.validFrom || '',
                    validThrough: product.pricing?.validThrough || ''
                },
                inventory: {
                    stock:             product.inventory?.stock ?? product.stock ?? '',
                    sku:               product.inventory?.sku || '',
                    barcode:           product.inventory?.barcode || '',
                    gtin:              product.inventory?.gtin || '',
                    mpn:               product.inventory?.mpn || '',
                    trackInventory:    product.inventory?.trackInventory ?? true,
                    lowStockThreshold: product.inventory?.lowStockThreshold ?? 5
                },
                dimensions: product.dimensions || { length: '', width: '', height: '', unit: 'cm' },
                weight: { value: product.weight?.value ?? '', unit: product.weight?.unit || 'kg' },
                seo: {
                    metaTitle:          product.seo?.metaTitle || '',
                    metaDescription:    product.seo?.metaDescription || '',
                    canonicalUrl:       product.seo?.canonicalUrl || '',
                    noIndex:            product.seo?.noIndex || false,
                    noFollow:           product.seo?.noFollow || false,
                    ogTitle:            product.seo?.ogTitle || '',
                    ogDescription:      product.seo?.ogDescription || '',
                    ogImage:            product.seo?.ogImage || '',
                    ogType:             product.seo?.ogType || 'product',
                    twitterCard:        product.seo?.twitterCard || 'summary_large_image',
                    twitterTitle:       product.seo?.twitterTitle || '',
                    twitterDescription: product.seo?.twitterDescription || '',
                    twitterImage:       product.seo?.twitterImage || '',
                    schemaType:         product.seo?.schemaType || 'Product',
                    condition:          product.seo?.condition || 'NewCondition',
                    focusKeyphrase:     product.seo?.focusKeyphrase || ''
                },
                isFeatured:   product.isFeatured   || false,
                isNewArrival: product.isNewArrival  || false,
                isBestseller: product.isBestseller  || false,
                status:       product.status        || 'published'
            });
            setOldImages(product.images || product.image || []);
            setSubcategories(product.subcategories || []);
            setTags(product.tags || []);
            setSpecifications(product.specifications || []);
            setVariants(product.variants || []);
            // FIX: populate only the dedicated array — not formData.seo
            setSeoKeywords(product.seo?.keywords || []);
            setRelatedSearchTerms(product.seo?.relatedSearchTerms || []);
            setBreadcrumbs(product.breadcrumbs || []);
            setRichSnippets(product.richSnippets || { faqs: [], howTo: { name: '', steps: [] }, videos: [] });
        } else if (products.length > 0) {
            toast.error('Product not found', { position: 'top-center', autoClose: 3000 });
            navigate('/admin/products');
        }
    }, [product, products, navigate]);

    // ── Input handler ─────────────────────────────────────────────────────────
    const handleInputChange = e => {
        const { name, value, type, checked } = e.target;
        if (name.includes('.')) {
            const [parent, child] = name.split('.');
            setFormData(prev => ({ ...prev, [parent]: { ...prev[parent], [child]: type === 'checkbox' ? checked : value } }));
        } else {
            setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
        }
    };

    // ── New image handling ────────────────────────────────────────────────────
    const handleNewImages = e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        files.forEach(file => {
            // FIX: per-file size validation
            if (file.size > MAX_FILE_SIZE) { toast.error(`"${file.name}" exceeds 10MB and was skipped`); return; }
            // FIX: duplicate detection
            if (newImages.some(img => img.name === file.name && img.size === file.size)) {
                toast.warn(`"${file.name}" is already added`); return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.readyState === 2) {
                    setNewImages(old => [...old, file]);
                    // FIX: object with alt/caption fields, not raw base64 string
                    setNewImagePreviews(old => [...old, {
                        url: reader.result, name: file.name,
                        size: (file.size / 1024).toFixed(1) + ' KB',
                        alt: '', caption: ''
                    }]);
                }
            };
            reader.readAsDataURL(file);
        });
        // FIX: reset so same file can be re-added after removal
        e.target.value = '';
    };

    const removeNewImage = i => {
        setNewImages(old => old.filter((_, idx) => idx !== i));
        setNewImagePreviews(old => old.filter((_, idx) => idx !== i));
    };

    // FIX: allow editing alt/caption for new images
    const updateNewImageMeta = (i, field, value) =>
        setNewImagePreviews(old => old.map((img, idx) => idx === i ? { ...img, [field]: value } : img));

    // ── Old image handling ────────────────────────────────────────────────────
    const removeOldImage = publicId => {
        if (!publicId) return;
        setOldImages(prev => prev.filter(img => img.public_id !== publicId));
        setImagesToDelete(prev => [...prev, publicId]);
    };
    const setPrimaryOldImage = i => {
        if (i === 0) return;
        setOldImages(prev => { const n = [...prev]; [n[0], n[i]] = [n[i], n[0]]; return n; });
    };
    // FIX: allow editing alt/caption on existing images — persists into existingImages JSON
    const updateOldImageMeta = (i, field, value) =>
        setOldImages(prev => prev.map((img, idx) => idx === i ? { ...img, [field]: value } : img));

    // ── Helpers ───────────────────────────────────────────────────────────────
    const addItem    = (value, setter, resetSetter, transform = v => v) => { const t = value.trim(); if (!t) return; setter(prev => [...prev, transform(t)]); resetSetter(''); };
    const removeItem = (i, setter) => setter(prev => prev.filter((_, idx) => idx !== i));

    const addBreadcrumb = () => {
        if (!newBreadcrumb.name.trim() || !newBreadcrumb.url.trim()) return;
        setBreadcrumbs(prev => [...prev, { name: newBreadcrumb.name.trim(), url: newBreadcrumb.url.trim(), position: prev.length + 1 }]);
        setNewBreadcrumb({ name: '', url: '' });
    };
    const removeBreadcrumb = i =>
        setBreadcrumbs(prev => prev.filter((_, idx) => idx !== i).map((b, idx) => ({ ...b, position: idx + 1 })));

    const addSpec    = () => setSpecifications(prev => [...prev, { key: '', value: '' }]);
    const updateSpec = (i, field, val) => setSpecifications(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
    const removeSpec = i => setSpecifications(prev => prev.filter((_, idx) => idx !== i));

    const addVariant          = () => setVariants(prev => [...prev, { name: '', options: [{ value: '', priceModifier: 0, stock: 0 }] }]);
    const updateVariantName   = (i, name) => setVariants(prev => prev.map((v, idx) => idx === i ? { ...v, name } : v));
    const removeVariant       = i => setVariants(prev => prev.filter((_, idx) => idx !== i));
    const addVariantOption    = vi => setVariants(prev => prev.map((v, i) => i === vi ? { ...v, options: [...v.options, { value: '', priceModifier: 0, stock: 0 }] } : v));
    const updateVariantOption = (vi, oi, field, val) =>
        setVariants(prev => prev.map((v, i) => i === vi ? { ...v, options: v.options.map((o, j) => j === oi ? { ...o, [field]: val } : o) } : v));
    const removeVariantOption = (vi, oi) =>
        setVariants(prev => prev.map((v, i) => i === vi ? { ...v, options: v.options.filter((_, j) => j !== oi) } : v));

    const addFAQ    = () => setRichSnippets(p => ({ ...p, faqs: [...p.faqs, { question: '', answer: '' }] }));
    const updateFAQ = (i, field, val) => setRichSnippets(p => ({ ...p, faqs: p.faqs.map((f, idx) => idx === i ? { ...f, [field]: val } : f) }));
    const removeFAQ = i => setRichSnippets(p => ({ ...p, faqs: p.faqs.filter((_, idx) => idx !== i) }));

    const addVideo    = () => setRichSnippets(p => ({ ...p, videos: [...p.videos, { name: '', description: '', thumbnailUrl: '', contentUrl: '' }] }));
    const updateVideo = (i, field, val) => setRichSnippets(p => ({ ...p, videos: p.videos.map((v, idx) => idx === i ? { ...v, [field]: val } : v) }));
    const removeVideo = i => setRichSnippets(p => ({ ...p, videos: p.videos.filter((_, idx) => idx !== i) }));

    // ── Submit ────────────────────────────────────────────────────────────────
    const handleSubmit = e => {
        e.preventDefault();
        if (!formData.name.trim())        { toast.error('Please enter product name');        setActiveTab('basic');   return; }
        if (!formData.category)           { toast.error('Please select a category');         setActiveTab('basic');   return; }
        if (!formData.description.trim()) { toast.error('Please enter product description'); setActiveTab('basic');   return; }
        if (!formData.pricing.regular)    { toast.error('Please enter regular price');       setActiveTab('pricing'); return; }
        if (formData.pricing.sale !== '' && Number(formData.pricing.sale) >= Number(formData.pricing.regular)) {
            toast.error('Sale price must be less than regular price'); setActiveTab('pricing'); return;
        }
        if (formData.pricing.validFrom && formData.pricing.validThrough &&
            new Date(formData.pricing.validFrom) > new Date(formData.pricing.validThrough)) {
            toast.error('Valid from date must be before valid through date'); setActiveTab('pricing'); return;
        }
        if (oldImages.length + newImages.length === 0) {
            toast.error('Product must have at least one image'); setActiveTab('media'); return;
        }

        const myForm = new FormData();
        myForm.append('name',             formData.name.trim());
        myForm.append('description',      formData.description.trim());
        myForm.append('shortDescription', formData.shortDescription.trim());
        myForm.append('category',         formData.category);
        myForm.append('brand',            formData.brand.trim());
        myForm.append('manufacturer',     formData.manufacturer.trim() || '');

        const pricingData = { regular: Number(formData.pricing.regular), currency: formData.pricing.currency };
        if (formData.pricing.cost !== '')  pricingData.cost = Number(formData.pricing.cost) || 0;
        if (formData.pricing.sale !== '')  pricingData.sale = Number(formData.pricing.sale);
        if (formData.pricing.validFrom)    pricingData.validFrom = formData.pricing.validFrom;
        if (formData.pricing.validThrough) pricingData.validThrough = formData.pricing.validThrough;
        myForm.append('pricing', JSON.stringify(pricingData));

        const inventoryData = { stock: Number(formData.inventory.stock) || 0, sku: formData.inventory.sku.trim(), barcode: formData.inventory.barcode.trim(), trackInventory: formData.inventory.trackInventory, lowStockThreshold: Number(formData.inventory.lowStockThreshold) };
        if (formData.inventory.gtin) inventoryData.gtin = formData.inventory.gtin.trim();
        if (formData.inventory.mpn)  inventoryData.mpn  = formData.inventory.mpn.trim();
        myForm.append('inventory', JSON.stringify(inventoryData));

        myForm.append('subcategories', JSON.stringify(subcategories));
        myForm.append('tags',          JSON.stringify(tags));

        const validSpecs    = specifications.filter(s => s.key && s.value);
        const validVariants = variants.filter(v => v.name && v.options.length > 0);
        if (validSpecs.length)    myForm.append('specifications', JSON.stringify(validSpecs));
        if (validVariants.length) myForm.append('variants',       JSON.stringify(validVariants));

        myForm.append('dimensions', JSON.stringify({ length: Number(formData.dimensions.length) || 0, width: Number(formData.dimensions.width) || 0, height: Number(formData.dimensions.height) || 0, unit: formData.dimensions.unit }));
        myForm.append('weight',     JSON.stringify({ value: Number(formData.weight.value) || 0, unit: formData.weight.unit }));

        myForm.append('seo', JSON.stringify({
            metaTitle: formData.seo.metaTitle.trim(), metaDescription: formData.seo.metaDescription.trim(),
            keywords: seoKeywords, canonicalUrl: formData.seo.canonicalUrl || '',
            noIndex: formData.seo.noIndex || false, noFollow: formData.seo.noFollow || false,
            ogTitle: formData.seo.ogTitle || '', ogDescription: formData.seo.ogDescription || '',
            ogImage: formData.seo.ogImage || '', ogType: formData.seo.ogType || 'product',
            twitterCard: formData.seo.twitterCard || 'summary_large_image',
            twitterTitle: formData.seo.twitterTitle || '', twitterDescription: formData.seo.twitterDescription || '',
            twitterImage: formData.seo.twitterImage || '', schemaType: formData.seo.schemaType || 'Product',
            condition: formData.seo.condition || 'NewCondition', focusKeyphrase: formData.seo.focusKeyphrase || '',
            relatedSearchTerms
        }));

        if (breadcrumbs.length > 0) myForm.append('breadcrumbs', JSON.stringify(breadcrumbs));
        myForm.append('richSnippets', JSON.stringify({ faqs: richSnippets.faqs.filter(f => f.question && f.answer), howTo: richSnippets.howTo, videos: richSnippets.videos.filter(v => v.name && v.contentUrl) }));
        myForm.append('isFeatured', formData.isFeatured);
        myForm.append('isNewArrival', formData.isNewArrival);
        myForm.append('isBestseller', formData.isBestseller);
        myForm.append('status', formData.status);

        if (imagesToDelete.length > 0) myForm.append('imagesToDelete', JSON.stringify(imagesToDelete));

        // Existing images carry updated alt/caption from updateOldImageMeta
        myForm.append('existingImages', JSON.stringify(
            oldImages.map((img, i) => ({ public_id: img.public_id, url: img.url, alt: img.alt || '', caption: img.caption || '', isPrimary: i === 0, order: i, width: img.width || null, height: img.height || null }))
        ));

        // FIX: send imageMetadata for new images so backend stores alt/caption
        myForm.append('imageMetadata', JSON.stringify(
            newImagePreviews.map(img => ({ alt: img.alt || '', caption: img.caption || '' }))
        ));

        // FIX: field name 'images' — matches multer upload.array('images', 10)
        newImages.forEach(img => myForm.append('images', img));

        dispatch(updateProduct({ id, productData: myForm }));
    };

    // ── Effects ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (error)   { toast.error(error.message || error, { position: 'top-center', autoClose: 3000 }); dispatch(removeErrors()); }
        if (success) { toast.success('Product updated successfully!', { position: 'top-center', autoClose: 3000 }); dispatch(removeSuccess()); navigate('/admin/products'); }
    }, [error, success, dispatch, navigate]);

    if (products.length === 0) return <Loader />;
    if (!product) return (
        <div className="eup-not-found">
            <FiAlertCircle /><h2>Product not found</h2>
            <button onClick={() => navigate('/admin/products')}>Back to Products</button>
        </div>
    );

    const tabs = [
        { id: 'basic',     label: 'Basic Info',   icon: <FiPackage /> },
        { id: 'pricing',   label: 'Pricing',      icon: <FiDollarSign /> },
        { id: 'inventory', label: 'Inventory',    icon: <FiPackage /> },
        { id: 'media',     label: 'Media',        icon: <FiImage /> },
        { id: 'variants',  label: 'Variants',     icon: <FiSettings /> },
        { id: 'seo',       label: 'SEO',          icon: <FiTrendingUp /> },
        { id: 'advanced',  label: 'Advanced SEO', icon: <FiTag /> },
        { id: 'settings',  label: 'Settings',     icon: <FiFlag /> }
    ];

    return (
        <>
            <PageTitle title="Update Product" />
            <Navbar />
            <div className="eup-container">
                <div className="eup-header">
                    <div className="eup-header-content">
                        <button className="eup-back-btn" onClick={() => navigate('/admin/products')}><FiArrowLeft /> Back to Products</button>
                        <h1 className="eup-title">Update Product</h1>
                        <p className="eup-subtitle">Editing: {product.name}</p>
                    </div>
                </div>
                <div className="eup-content">
                    <div className="eup-tabs">
                        {tabs.map(tab => (
                            <button key={tab.id} type="button" className={`eup-tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                                {tab.icon}<span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="eup-form">

                        {/* ══ BASIC ══ */}
                        {activeTab === 'basic' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Product Information</h3>
                                    <div className="eup-form-group">
                                        {/* FIX: eup-label--required, no hardcoded * in text */}
                                        <label className="eup-label eup-label--required">Product Name</label>
                                        <input type="text" className="eup-input" placeholder="Enter product name" name="name" value={formData.name} onChange={handleInputChange} maxLength={200} />
                                        <span className="eup-char-count">{formData.name.length}/200</span>
                                    </div>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label eup-label--required">Category</label>
                                            <select className="eup-select" name="category" value={formData.category} onChange={handleInputChange}>
                                                <option value="">Select Category</option>
                                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div className="eup-form-group">
                                            <label className="eup-label">Brand</label>
                                            <input type="text" className="eup-input" placeholder="Enter brand name" name="brand" value={formData.brand} onChange={handleInputChange} />
                                        </div>
                                    </div>
                                    <div className="eup-form-group">
                                        <label className="eup-label">Manufacturer</label>
                                        <input type="text" className="eup-input" placeholder="Enter manufacturer name" name="manufacturer" value={formData.manufacturer} onChange={handleInputChange} />
                                    </div>
                                    <div className="eup-form-group">
                                        <label className="eup-label">Short Description</label>
                                        <textarea className="eup-textarea" placeholder="Brief product description" name="shortDescription" value={formData.shortDescription} onChange={handleInputChange} rows={3} maxLength={500} />
                                        <span className="eup-char-count">{formData.shortDescription.length}/500</span>
                                    </div>
                                    <div className="eup-form-group">
                                        <label className="eup-label eup-label--required">Full Description</label>
                                        <textarea className="eup-textarea" placeholder="Detailed product description" name="description" value={formData.description} onChange={handleInputChange} rows={6} maxLength={5000} />
                                        <span className="eup-char-count">{formData.description.length}/5000</span>
                                    </div>
                                    <div className="eup-form-group">
                                        <label className="eup-label">Subcategories</label>
                                        <div className="eup-input-with-btn">
                                            <input type="text" className="eup-input" placeholder="Add subcategory" value={newSubcategory} onChange={e => setNewSubcategory(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newSubcategory, setSubcategories, setNewSubcategory))} />
                                            <button type="button" className="eup-btn-icon" onClick={() => addItem(newSubcategory, setSubcategories, setNewSubcategory)}><FiPlus /></button>
                                        </div>
                                        <div className="eup-tags">{subcategories.map((s, i) => <span key={i} className="eup-tag">{s}<button type="button" onClick={() => removeItem(i, setSubcategories)}><FiX /></button></span>)}</div>
                                    </div>
                                    <div className="eup-form-group">
                                        <label className="eup-label">Tags</label>
                                        <div className="eup-input-with-btn">
                                            <input type="text" className="eup-input" placeholder="Add tag" value={newTag} onChange={e => setNewTag(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newTag, setTags, setNewTag, v => v.toLowerCase()))} />
                                            <button type="button" className="eup-btn-icon" onClick={() => addItem(newTag, setTags, setNewTag, v => v.toLowerCase())}><FiPlus /></button>
                                        </div>
                                        <div className="eup-tags">{tags.map((t, i) => <span key={i} className="eup-tag">{t}<button type="button" onClick={() => removeItem(i, setTags)}><FiX /></button></span>)}</div>
                                    </div>
                                    <div className="eup-form-group">
                                        <div className="eup-label-with-btn">
                                            <label className="eup-label">Specifications</label>
                                            <button type="button" className="eup-btn-small" onClick={addSpec}><FiPlus /> Add Spec</button>
                                        </div>
                                        {specifications.map((spec, i) => (
                                            <div key={i} className="eup-spec-row">
                                                <input type="text" className="eup-input" placeholder="Key" value={spec.key} onChange={e => updateSpec(i, 'key', e.target.value)} />
                                                <input type="text" className="eup-input" placeholder="Value" value={spec.value} onChange={e => updateSpec(i, 'value', e.target.value)} />
                                                <button type="button" className="eup-btn-icon-danger" onClick={() => removeSpec(i)}><FiTrash2 /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ══ PRICING ══ */}
                        {activeTab === 'pricing' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Pricing Information</h3>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label eup-label--required">Regular Price</label>
                                            <div className="eup-input-with-icon"><FiDollarSign className="eup-input-icon" /><input type="number" className="eup-input eup-input-with-padding" placeholder="0.00" name="pricing.regular" value={formData.pricing.regular} onChange={handleInputChange} min="0" step="0.01" /></div>
                                        </div>
                                        <div className="eup-form-group">
                                            <label className="eup-label">Sale Price</label>
                                            <div className="eup-input-with-icon"><FiDollarSign className="eup-input-icon" /><input type="number" className="eup-input eup-input-with-padding" placeholder="0.00" name="pricing.sale" value={formData.pricing.sale} onChange={handleInputChange} min="0" step="0.01" /></div>
                                        </div>
                                    </div>
                                    {formData.pricing.regular !== '' && formData.pricing.sale !== '' && Number(formData.pricing.sale) < Number(formData.pricing.regular) && (
                                        <div className="eup-discount-preview"><FiCheck className="eup-discount-icon" /><span>Discount: {Math.round(((Number(formData.pricing.regular) - Number(formData.pricing.sale)) / Number(formData.pricing.regular)) * 100)}% off</span></div>
                                    )}
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Cost Price</label>
                                            <div className="eup-input-with-icon"><FiDollarSign className="eup-input-icon" /><input type="number" className="eup-input eup-input-with-padding" placeholder="0.00" name="pricing.cost" value={formData.pricing.cost} onChange={handleInputChange} min="0" step="0.01" /></div>
                                            <small className="eup-help-text">Your cost for this product</small>
                                        </div>
                                        <div className="eup-form-group">
                                            <label className="eup-label">Currency</label>
                                            <select className="eup-select" name="pricing.currency" value={formData.pricing.currency} onChange={handleInputChange}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                                        </div>
                                    </div>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group"><label className="eup-label">Price Valid From</label><input type="date" className="eup-input" name="pricing.validFrom" value={formData.pricing.validFrom} onChange={handleInputChange} /></div>
                                        <div className="eup-form-group"><label className="eup-label">Price Valid Through</label><input type="date" className="eup-input" name="pricing.validThrough" value={formData.pricing.validThrough} onChange={handleInputChange} /></div>
                                    </div>
                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Shipping Information</h3>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Weight</label>
                                            <div className="eup-input-group"><input type="number" className="eup-input" placeholder="0" name="weight.value" value={formData.weight.value} onChange={handleInputChange} min="0" step="0.01" /><select className="eup-select-addon" name="weight.unit" value={formData.weight.unit} onChange={handleInputChange}>{WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                                        </div>
                                    </div>
                                    <div className="eup-form-group">
                                        <label className="eup-label">Dimensions (L × W × H)</label>
                                        <div className="eup-dimensions-grid">
                                            {['length','width','height'].map(dim => <input key={dim} type="number" className="eup-input" placeholder={dim.charAt(0).toUpperCase()+dim.slice(1)} name={`dimensions.${dim}`} value={formData.dimensions[dim]} onChange={handleInputChange} min="0" step="0.01" />)}
                                            <select className="eup-select" name="dimensions.unit" value={formData.dimensions.unit} onChange={handleInputChange}>{DIM_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ══ INVENTORY ══ */}
                        {activeTab === 'inventory' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Inventory Management</h3>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group"><label className="eup-label">Stock Quantity</label><input type="number" className="eup-input" placeholder="0" name="inventory.stock" value={formData.inventory.stock} onChange={handleInputChange} min="0" /></div>
                                        <div className="eup-form-group"><label className="eup-label">Low Stock Threshold</label><input type="number" className="eup-input" placeholder="5" name="inventory.lowStockThreshold" value={formData.inventory.lowStockThreshold} onChange={handleInputChange} min="0" /></div>
                                    </div>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group"><label className="eup-label">SKU</label><input type="text" className="eup-input" placeholder="PROD-001" name="inventory.sku" value={formData.inventory.sku} onChange={handleInputChange} /></div>
                                        <div className="eup-form-group"><label className="eup-label">Barcode</label><input type="text" className="eup-input" placeholder="123456789" name="inventory.barcode" value={formData.inventory.barcode} onChange={handleInputChange} /></div>
                                    </div>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group"><label className="eup-label">GTIN <span className="eup-badge">Google Shopping</span></label><input type="text" className="eup-input" placeholder="UPC / EAN / ISBN" name="inventory.gtin" value={formData.inventory.gtin} onChange={handleInputChange} /><small className="eup-help-text">UPC, EAN, JAN, ISBN, or ITF-14</small></div>
                                        <div className="eup-form-group"><label className="eup-label">MPN</label><input type="text" className="eup-input" placeholder="Manufacturer Part Number" name="inventory.mpn" value={formData.inventory.mpn} onChange={handleInputChange} /></div>
                                    </div>
                                    <div className="eup-checkbox-group"><label className="eup-checkbox"><input type="checkbox" name="inventory.trackInventory" checked={formData.inventory.trackInventory} onChange={handleInputChange} /><span>Track inventory for this product</span></label></div>
                                </div>
                            </div>
                        )}

                        {/* ══ MEDIA ══ */}
                        {activeTab === 'media' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    {oldImages.length > 0 && (
                                        <>
                                            <h3 className="eup-section-title">Current Images</h3>
                                            <div className="eup-info-box" style={{ marginBottom: '1rem' }}>
                                                <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                                                <span>First image is primary. Click <FiEye style={{ verticalAlign: 'middle' }} /> to reorder. Edit alt text and captions below each image.</span>
                                            </div>
                                            <div className="eup-image-grid">
                                                {oldImages.map((img, i) => (
                                                    <div key={i} className="eup-image-card">
                                                        <img src={img.url} alt={img.alt || `Product ${i+1}`} />
                                                        <div className="eup-image-overlay">
                                                            <button type="button" className="eup-image-btn" onClick={() => setPrimaryOldImage(i)} title="Set as primary">{i === 0 ? <FiCheck /> : <FiEye />}</button>
                                                            <button type="button" className="eup-image-btn eup-image-btn-danger" onClick={() => removeOldImage(img.public_id)} title="Remove"><FiTrash2 /></button>
                                                        </div>
                                                        {i === 0 && <span className="eup-primary-badge">Primary</span>}
                                                        {/* FIX: alt/caption editable for existing images */}
                                                        <div className="eup-image-meta">
                                                            <input type="text" className="eup-input eup-image-meta-input" placeholder="Alt text (SEO)" maxLength={125} value={img.alt || ''} onChange={e => updateOldImageMeta(i, 'alt', e.target.value)} />
                                                            <input type="text" className="eup-input eup-image-meta-input" placeholder="Caption (optional)" maxLength={200} value={img.caption || ''} onChange={e => updateOldImageMeta(i, 'caption', e.target.value)} />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    <h3 className="eup-section-title" style={{ marginTop: oldImages.length > 0 ? '2rem' : '0' }}>Add New Images</h3>
                                    <div className="eup-upload-area">
                                        <input type="file" id="product-images" className="eup-file-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={handleNewImages} />
                                        <label htmlFor="product-images" className="eup-upload-label">
                                            <FiImage className="eup-upload-icon" />
                                            <span className="eup-upload-text">Click to upload new images</span>
                                            <span className="eup-upload-subtext">JPEG, PNG, WebP — max 10MB each</span>
                                        </label>
                                    </div>
                                    {/* FIX: new images now show alt/caption inputs */}
                                    {newImagePreviews.length > 0 && (
                                        <>
                                            <h3 className="eup-section-title" style={{ marginTop: '1.5rem' }}>New Images</h3>
                                            <div className="eup-image-grid">
                                                {newImagePreviews.map((img, i) => (
                                                    <div key={i} className="eup-image-card">
                                                        <img src={img.url} alt={img.alt || `New ${i+1}`} />
                                                        <div className="eup-image-overlay">
                                                            <button type="button" className="eup-image-btn eup-image-btn-danger" onClick={() => removeNewImage(i)} title="Remove"><FiTrash2 /></button>
                                                        </div>
                                                        <span className="eup-new-badge">New</span>
                                                        <div className="eup-image-meta">
                                                            <input type="text" className="eup-input eup-image-meta-input" placeholder="Alt text (SEO)" maxLength={125} value={img.alt} onChange={e => updateNewImageMeta(i, 'alt', e.target.value)} />
                                                            <input type="text" className="eup-input eup-image-meta-input" placeholder="Caption (optional)" maxLength={200} value={img.caption} onChange={e => updateNewImageMeta(i, 'caption', e.target.value)} />
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

                        {/* ══ VARIANTS ══ */}
                        {activeTab === 'variants' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <div className="eup-label-with-btn"><h3 className="eup-section-title">Product Variants</h3><button type="button" className="eup-btn-small" onClick={addVariant}><FiPlus /> Add Variant</button></div>
                                    {variants.length === 0 && <div className="eup-info-box"><FiAlertCircle style={{ marginRight: '0.5rem' }} /><span>Add variants if your product comes in different sizes, colors, or styles</span></div>}
                                    {variants.map((variant, vi) => (
                                        <div key={vi} className="eup-variant-card">
                                            <div className="eup-variant-header"><input type="text" className="eup-input" placeholder="Variant name" value={variant.name} onChange={e => updateVariantName(vi, e.target.value)} /><button type="button" className="eup-btn-icon-danger" onClick={() => removeVariant(vi)}><FiTrash2 /></button></div>
                                            <div className="eup-variant-options">
                                                {variant.options.map((opt, oi) => (
                                                    <div key={oi} className="eup-variant-option-row">
                                                        <input type="text" className="eup-input" placeholder="Value" value={opt.value} onChange={e => updateVariantOption(vi, oi, 'value', e.target.value)} />
                                                        <input type="number" className="eup-input" placeholder="Price +" value={opt.priceModifier} onChange={e => updateVariantOption(vi, oi, 'priceModifier', Number(e.target.value))} step="0.01" />
                                                        <input type="number" className="eup-input" placeholder="Stock" value={opt.stock} onChange={e => updateVariantOption(vi, oi, 'stock', Number(e.target.value))} min="0" />
                                                        <button type="button" className="eup-btn-icon-danger" onClick={() => removeVariantOption(vi, oi)}><FiX /></button>
                                                    </div>
                                                ))}
                                                <button type="button" className="eup-btn-secondary eup-btn-full" onClick={() => addVariantOption(vi)}><FiPlus /> Add Option</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ══ SEO ══ */}
                        {activeTab === 'seo' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Search Engine Optimization</h3>
                                    <div className="eup-form-group"><label className="eup-label">Meta Title <span className="eup-recommended">(max 60)</span></label><input type="text" className="eup-input" placeholder="Product meta title" name="seo.metaTitle" value={formData.seo.metaTitle} onChange={handleInputChange} maxLength={60} /><span className="eup-char-count">{formData.seo.metaTitle.length}/60</span></div>
                                    <div className="eup-form-group"><label className="eup-label">Meta Description <span className="eup-recommended">(120–160 recommended)</span></label><textarea className="eup-textarea" placeholder="Product meta description" name="seo.metaDescription" value={formData.seo.metaDescription} onChange={handleInputChange} rows={3} maxLength={160} /><span className="eup-char-count">{formData.seo.metaDescription.length}/160</span></div>
                                    <div className="eup-form-group">
                                        <label className="eup-label">Keywords</label>
                                        <div className="eup-input-with-btn"><input type="text" className="eup-input" placeholder="Add keyword" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newKeyword, setSeoKeywords, setNewKeyword))} /><button type="button" className="eup-btn-icon" onClick={() => addItem(newKeyword, setSeoKeywords, setNewKeyword)}><FiPlus /></button></div>
                                        <div className="eup-tags">{seoKeywords.map((k, i) => <span key={i} className="eup-tag">{k}<button type="button" onClick={() => removeItem(i, setSeoKeywords)}><FiX /></button></span>)}</div>
                                    </div>
                                    <div className="eup-form-group"><label className="eup-label">Canonical URL</label><input type="url" className="eup-input" placeholder="https://example.com/products/name" name="seo.canonicalUrl" value={formData.seo.canonicalUrl} onChange={handleInputChange} /></div>
                                    <div className="eup-form-group"><label className="eup-label">Focus Keyphrase</label><input type="text" className="eup-input" placeholder="Main keyphrase" name="seo.focusKeyphrase" value={formData.seo.focusKeyphrase} onChange={handleInputChange} /></div>
                                    <div className="eup-form-group">
                                        <div className="eup-label-with-btn"><label className="eup-label">Breadcrumbs</label><button type="button" className="eup-btn-small" onClick={addBreadcrumb} disabled={!newBreadcrumb.name || !newBreadcrumb.url}><FiPlus /> Add</button></div>
                                        <div className="eup-spec-row"><input type="text" className="eup-input" placeholder="Name (e.g., Home)" value={newBreadcrumb.name} onChange={e => setNewBreadcrumb(p => ({ ...p, name: e.target.value }))} /><input type="text" className="eup-input" placeholder="URL (e.g., /)" value={newBreadcrumb.url} onChange={e => setNewBreadcrumb(p => ({ ...p, url: e.target.value }))} /></div>
                                        <div className="eup-tags">{breadcrumbs.map((b, i) => <span key={i} className="eup-tag">{b.position}. {b.name}<button type="button" onClick={() => removeBreadcrumb(i)}><FiX /></button></span>)}</div>
                                    </div>
                                    <div className="eup-form-row">
                                        <div className="eup-form-group"><label className="eup-label">Schema Type</label><select className="eup-select" name="seo.schemaType" value={formData.seo.schemaType} onChange={handleInputChange}>{SCHEMA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                        <div className="eup-form-group"><label className="eup-label">Condition</label><select className="eup-select" name="seo.condition" value={formData.seo.condition} onChange={handleInputChange}>{CONDITIONS.map(c => <option key={c} value={c}>{c.replace('Condition','')}</option>)}</select></div>
                                    </div>
                                    <div className="eup-checkbox-grid">
                                        <label className="eup-checkbox"><input type="checkbox" name="seo.noIndex" checked={formData.seo.noIndex} onChange={handleInputChange} /><span>No Index</span></label>
                                        <label className="eup-checkbox"><input type="checkbox" name="seo.noFollow" checked={formData.seo.noFollow} onChange={handleInputChange} /><span>No Follow</span></label>
                                    </div>
                                    <div className="eup-form-group" style={{ marginTop: '2rem' }}>
                                        <label className="eup-label">Related Search Terms</label>
                                        <div className="eup-input-with-btn"><input type="text" className="eup-input" placeholder="Add related search term" value={newRelatedTerm} onChange={e => setNewRelatedTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, v => v.toLowerCase()))} /><button type="button" className="eup-btn-icon" onClick={() => addItem(newRelatedTerm, setRelatedSearchTerms, setNewRelatedTerm, v => v.toLowerCase())}><FiPlus /></button></div>
                                        <div className="eup-tags">{relatedSearchTerms.map((t, i) => <span key={i} className="eup-tag">{t}<button type="button" onClick={() => removeItem(i, setRelatedSearchTerms)}><FiX /></button></span>)}</div>
                                    </div>
                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Rich Snippets — FAQs</h3>
                                    <div className="eup-label-with-btn"><label className="eup-label">FAQs</label><button type="button" className="eup-btn-small" onClick={addFAQ}><FiPlus /> Add FAQ</button></div>
                                    {richSnippets.faqs.map((faq, i) => (
                                        <div key={i} className="eup-faq-card">
                                            <div className="eup-faq-header"><input type="text" className="eup-input" placeholder="Question" value={faq.question} onChange={e => updateFAQ(i, 'question', e.target.value)} maxLength={200} /><button type="button" className="eup-btn-icon-danger" onClick={() => removeFAQ(i)}><FiTrash2 /></button></div>
                                            <textarea className="eup-textarea" placeholder="Answer" value={faq.answer} onChange={e => updateFAQ(i, 'answer', e.target.value)} rows={3} maxLength={1000} />
                                        </div>
                                    ))}
                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Rich Snippets — Videos</h3>
                                    <div className="eup-label-with-btn"><label className="eup-label">Videos</label><button type="button" className="eup-btn-small" onClick={addVideo}><FiPlus /> Add Video</button></div>
                                    {richSnippets.videos.map((video, i) => (
                                        <div key={i} className="eup-video-card">
                                            <div className="eup-video-header"><input type="text" className="eup-input" placeholder="Video Name" value={video.name} onChange={e => updateVideo(i, 'name', e.target.value)} /><button type="button" className="eup-btn-icon-danger" onClick={() => removeVideo(i)}><FiTrash2 /></button></div>
                                            {[['description','Description'],['contentUrl','Content URL'],['thumbnailUrl','Thumbnail URL']].map(([field, ph]) => <input key={field} type={field.includes('Url')?'url':'text'} className="eup-input" placeholder={ph} value={video[field]} style={{ marginTop:'0.5rem' }} onChange={e => updateVideo(i, field, e.target.value)} />)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ══ ADVANCED SEO ══ */}
                        {activeTab === 'advanced' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Open Graph (Facebook / LinkedIn)</h3>
                                    {[['ogTitle','OG Title','text',60],['ogDescription','OG Description','textarea',160],['ogImage','OG Image URL','url',null],['ogType','OG Type','text',null]].map(([field,label,type,max]) => (
                                        <div key={field} className="eup-form-group">
                                            <label className="eup-label">{label}</label>
                                            {type==='textarea' ? <textarea className="eup-textarea" name={`seo.${field}`} value={formData.seo[field]} onChange={handleInputChange} rows={3} maxLength={max||undefined} /> : <input type={type} className="eup-input" name={`seo.${field}`} value={formData.seo[field]} onChange={handleInputChange} maxLength={max||undefined} />}
                                            {max && <span className="eup-char-count">{(formData.seo[field]||'').length}/{max}</span>}
                                        </div>
                                    ))}
                                    <h3 className="eup-section-title" style={{ marginTop:'2rem' }}>Twitter / X Card</h3>
                                    <div className="eup-form-group"><label className="eup-label">Card Type</label><select className="eup-select" name="seo.twitterCard" value={formData.seo.twitterCard} onChange={handleInputChange}>{TWITTER_CARDS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                    {[['twitterTitle','Twitter Title','text',70],['twitterDescription','Twitter Description','textarea',200],['twitterImage','Twitter Image URL','url',null]].map(([field,label,type,max]) => (
                                        <div key={field} className="eup-form-group">
                                            <label className="eup-label">{label}</label>
                                            {type==='textarea' ? <textarea className="eup-textarea" name={`seo.${field}`} value={formData.seo[field]} onChange={handleInputChange} rows={3} maxLength={max||undefined} /> : <input type={type} className="eup-input" name={`seo.${field}`} value={formData.seo[field]} onChange={handleInputChange} maxLength={max||undefined} />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ══ SETTINGS ══ */}
                        {activeTab === 'settings' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Product Flags</h3>
                                    <div className="eup-checkbox-grid">
                                        {[['isFeatured','Featured Product'],['isNewArrival','New Arrival'],['isBestseller','Bestseller']].map(([name,label]) => (
                                            <label key={name} className="eup-checkbox"><input type="checkbox" name={name} checked={formData[name]} onChange={handleInputChange} /><span>{label}</span></label>
                                        ))}
                                    </div>
                                    <div className="eup-form-group" style={{ marginTop:'2rem' }}>
                                        <label className="eup-label">Publication Status</label>
                                        <select className="eup-select" name="status" value={formData.status} onChange={handleInputChange}>
                                            <option value="draft">Draft</option>
                                            <option value="published">Published</option>
                                            <option value="archived">Archived</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ══ ACTIONS ══ */}
                        <div className="eup-actions">
                            <button type="button" className="eup-btn eup-btn-secondary" onClick={() => navigate('/admin/products')}>Cancel</button>
                            <button type="button" className="eup-btn eup-btn-primary" onClick={handleSubmit} disabled={loading}>{loading ? 'Updating...' : <><FiSave /> Update Product</>}</button>
                        </div>
                    </div>
                </div>
            </div>
            <Footer />
        </>
    );
}

export default UpdateProduct;