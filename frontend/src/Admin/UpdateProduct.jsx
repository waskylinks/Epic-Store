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

function UpdateProduct() {
    const { id } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const { products, loading, error, success } = useSelector((state) => state.admin);
    const product = products.find((p) => p._id === id);

    const [activeTab, setActiveTab] = useState('basic');
    const [oldImages, setOldImages] = useState([]);
    const [imagesToDelete, setImagesToDelete] = useState([]);
    const [newImages, setNewImages] = useState([]);
    const [newImagePreviews, setNewImagePreviews] = useState([]);

    // Form state - complete with all backend fields
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        shortDescription: '',
        category: '',
        brand: '',
        manufacturer: '',
        pricing: {
            regular: '',
            sale: '',
            cost: '',
            currency: 'USD',
            validFrom: '',
            validThrough: ''
        },
        inventory: {
            stock: '',
            sku: '',
            barcode: '',
            gtin: '',
            mpn: '',
            trackInventory: true,
            lowStockThreshold: 5
        },
        dimensions: {
            length: '',
            width: '',
            height: '',
            unit: 'cm'
        },
        weight: {
            value: '',
            unit: 'kg'
        },
        seo: {
            metaTitle: '',
            metaDescription: '',
            keywords: [],
            canonicalUrl: '',
            noIndex: false,
            noFollow: false,
            ogTitle: '',
            ogDescription: '',
            ogImage: '',
            ogType: 'product',
            twitterCard: 'summary_large_image',
            twitterTitle: '',
            twitterDescription: '',
            twitterImage: '',
            schemaType: 'Product',
            condition: 'NewCondition',
            focusKeyphrase: '',
            relatedSearchTerms: []
        },
        isFeatured: false,
        isNewArrival: false,
        isBestseller: false,
        status: 'published'
    });

    const [subcategories, setSubcategories] = useState([]);
    const [tags, setTags] = useState([]);
    const [specifications, setSpecifications] = useState([]);
    const [variants, setVariants] = useState([]);
    const [seoKeywords, setSeoKeywords] = useState([]);
    const [relatedSearchTerms, setRelatedSearchTerms] = useState([]);
    const [breadcrumbs, setBreadcrumbs] = useState([]);
    const [richSnippets, setRichSnippets] = useState({
        faqs: [],
        howTo: { name: '', steps: [] },
        videos: []
    });

    // Input states
    const [newSubcategory, setNewSubcategory] = useState('');
    const [newTag, setNewTag] = useState('');
    const [newKeyword, setNewKeyword] = useState('');
    const [newRelatedTerm, setNewRelatedTerm] = useState('');
    const [newBreadcrumb, setNewBreadcrumb] = useState({ name: '', url: '' });

    const categories = [
        'Electronics',
        'Clothing & Apparel',
        'Home & Living',
        'Sports & Outdoors',
        'Beauty & Personal Care',
        'Books & Media',
        'Food & Beverages'
    ];

    const currencies = ['USD', 'EUR', 'GBP', 'NGN'];
    const weightUnits = ['kg', 'lb', 'g'];
    const dimensionUnits = ['cm', 'in'];
    const schemaTypes = ['Product', 'Book', 'Course', 'SoftwareApplication'];
    const conditions = ['NewCondition', 'UsedCondition', 'RefurbishedCondition', 'DamagedCondition'];
    const twitterCardTypes = ['summary', 'summary_large_image'];

    // Pre-fill form when product is found
    useEffect(() => {
        if (product) {
            setFormData({
                name: product.name || '',
                description: product.description || '',
                shortDescription: product.shortDescription || '',
                category: product.category || '',
                brand: product.brand || '',
                manufacturer: product.manufacturer || '',
                pricing: {
                    regular: product.pricing?.regular ?? product.price ?? '',
                    sale: product.pricing?.sale ?? '',
                    cost: product.pricing?.cost ?? '',
                    currency: product.pricing?.currency || 'USD',
                    validFrom: product.pricing?.validFrom || '',
                    validThrough: product.pricing?.validThrough || ''
                },
                inventory: {
                    stock: product.inventory?.stock ?? product.stock ?? '',
                    sku: product.inventory?.sku || '',
                    barcode: product.inventory?.barcode || '',
                    gtin: product.inventory?.gtin || '',
                    mpn: product.inventory?.mpn || '',
                    trackInventory: product.inventory?.trackInventory ?? true,
                    lowStockThreshold: product.inventory?.lowStockThreshold ?? 5
                },
                dimensions: product.dimensions || {
                    length: '',
                    width: '',
                    height: '',
                    unit: 'cm'
                },
                weight: {
                    value: product.weight?.value ?? '',
                    unit: product.weight?.unit || 'kg'
                },
                seo: {
                    metaTitle: product.seo?.metaTitle || '',
                    metaDescription: product.seo?.metaDescription || '',
                    keywords: product.seo?.keywords || [],
                    canonicalUrl: product.seo?.canonicalUrl || '',
                    noIndex: product.seo?.noIndex || false,
                    noFollow: product.seo?.noFollow || false,
                    ogTitle: product.seo?.ogTitle || '',
                    ogDescription: product.seo?.ogDescription || '',
                    ogImage: product.seo?.ogImage || '',
                    ogType: product.seo?.ogType || 'product',
                    twitterCard: product.seo?.twitterCard || 'summary_large_image',
                    twitterTitle: product.seo?.twitterTitle || '',
                    twitterDescription: product.seo?.twitterDescription || '',
                    twitterImage: product.seo?.twitterImage || '',
                    schemaType: product.seo?.schemaType || 'Product',
                    condition: product.seo?.condition || 'NewCondition',
                    focusKeyphrase: product.seo?.focusKeyphrase || '',
                    relatedSearchTerms: product.seo?.relatedSearchTerms || []
                },
                isFeatured: product.isFeatured || false,
                isNewArrival: product.isNewArrival || false,
                isBestseller: product.isBestseller || false,
                status: product.status || 'published'
            });

            setOldImages(product.images || product.image || []);
            setSubcategories(product.subcategories || []);
            setTags(product.tags || []);
            setSpecifications(product.specifications || []);
            setVariants(product.variants || []);
            setSeoKeywords(product.seo?.keywords || []);
            setRelatedSearchTerms(product.seo?.relatedSearchTerms || []);
            setBreadcrumbs(product.breadcrumbs || []);
            setRichSnippets(product.richSnippets || { faqs: [], howTo: { name: '', steps: [] }, videos: [] });
        } else if (products.length > 0) {
            toast.error('Product not found', { position: 'top-center', autoClose: 3000 });
            navigate('/admin/products');
        }
    }, [product, products, navigate]);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        
        if (name.includes('.')) {
            const [parent, child] = name.split('.');
            setFormData(prev => ({
                ...prev,
                [parent]: {
                    ...prev[parent],
                    [child]: type === 'checkbox' ? checked : value
                }
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                [name]: type === 'checkbox' ? checked : value
            }));
        }
    };

    // Image handling
    const handleNewImages = (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.readyState === 2) {
                    setNewImagePreviews((old) => [...old, reader.result]);
                    setNewImages((old) => [...old, file]);
                }
            };
            reader.readAsDataURL(file);
        });
    };

    const removeOldImage = (publicId) => {
        if (!publicId) return;
        setOldImages((prev) => prev.filter((img) => img.public_id !== publicId));
        setImagesToDelete((prev) => [...prev, publicId]);
    };

    const removeNewImage = (index) => {
        setNewImages((prev) => prev.filter((_, i) => i !== index));
        setNewImagePreviews((prev) => prev.filter((_, i) => i !== index));
    };

    const setPrimaryOldImage = (index) => {
        const newOldImages = [...oldImages];
        const [primary] = newOldImages.splice(index, 1);
        setOldImages([primary, ...newOldImages]);
    };

    // Subcategories
    const addSubcategory = () => {
        if (newSubcategory.trim()) {
            setSubcategories([...subcategories, newSubcategory.trim()]);
            setNewSubcategory('');
        }
    };
    const removeSubcategory = (index) => {
        setSubcategories(subcategories.filter((_, i) => i !== index));
    };

    // Tags
    const addTag = () => {
        if (newTag.trim()) {
            setTags([...tags, newTag.trim().toLowerCase()]);
            setNewTag('');
        }
    };
    const removeTag = (index) => {
        setTags(tags.filter((_, i) => i !== index));
    };

    // SEO keywords
    const addKeyword = () => {
        if (newKeyword.trim()) {
            setSeoKeywords([...seoKeywords, newKeyword.trim()]);
            setNewKeyword('');
        }
    };
    const removeKeyword = (index) => {
        setSeoKeywords(seoKeywords.filter((_, i) => i !== index));
    };

    // Related search terms
    const addRelatedTerm = () => {
        if (newRelatedTerm.trim()) {
            setRelatedSearchTerms([...relatedSearchTerms, newRelatedTerm.trim().toLowerCase()]);
            setNewRelatedTerm('');
        }
    };
    const removeRelatedTerm = (index) => {
        setRelatedSearchTerms(relatedSearchTerms.filter((_, i) => i !== index));
    };

    // Breadcrumbs
    const addBreadcrumb = () => {
        if (newBreadcrumb.name.trim() && newBreadcrumb.url.trim()) {
            setBreadcrumbs([...breadcrumbs, {
                name: newBreadcrumb.name.trim(),
                url: newBreadcrumb.url.trim(),
                position: breadcrumbs.length + 1
            }]);
            setNewBreadcrumb({ name: '', url: '' });
        }
    };
    const removeBreadcrumb = (index) => {
        setBreadcrumbs(breadcrumbs.filter((_, i) => i !== index).map((item, idx) => ({
            ...item,
            position: idx + 1
        })));
    };

    // Specifications
    const addSpecification = () => {
        setSpecifications([...specifications, { key: '', value: '' }]);
    };
    const updateSpecification = (index, field, value) => {
        const newSpecs = [...specifications];
        newSpecs[index][field] = value;
        setSpecifications(newSpecs);
    };
    const removeSpecification = (index) => {
        setSpecifications(specifications.filter((_, i) => i !== index));
    };

    // Variants
    const addVariant = () => {
        setVariants([...variants, { name: '', options: [{ value: '', priceModifier: 0, stock: 0 }] }]);
    };
    const updateVariantName = (index, name) => {
        const newVariants = [...variants];
        newVariants[index].name = name;
        setVariants(newVariants);
    };
    const addVariantOption = (variantIndex) => {
        const newVariants = [...variants];
        newVariants[variantIndex].options.push({ value: '', priceModifier: 0, stock: 0 });
        setVariants(newVariants);
    };
    const updateVariantOption = (variantIndex, optionIndex, field, value) => {
        const newVariants = [...variants];
        newVariants[variantIndex].options[optionIndex][field] = value;
        setVariants(newVariants);
    };
    const removeVariantOption = (variantIndex, optionIndex) => {
        const newVariants = [...variants];
        newVariants[variantIndex].options = newVariants[variantIndex].options.filter((_, i) => i !== optionIndex);
        setVariants(newVariants);
    };
    const removeVariant = (index) => {
        setVariants(variants.filter((_, i) => i !== index));
    };

    // Rich Snippets - FAQs
    const addFAQ = () => {
        setRichSnippets(prev => ({
            ...prev,
            faqs: [...prev.faqs, { question: '', answer: '' }]
        }));
    };
    const updateFAQ = (index, field, value) => {
        setRichSnippets(prev => ({
            ...prev,
            faqs: prev.faqs.map((faq, i) => i === index ? { ...faq, [field]: value } : faq)
        }));
    };
    const removeFAQ = (index) => {
        setRichSnippets(prev => ({
            ...prev,
            faqs: prev.faqs.filter((_, i) => i !== index)
        }));
    };

    // Rich Snippets - Videos
    const addVideo = () => {
        setRichSnippets(prev => ({
            ...prev,
            videos: [...prev.videos, { name: '', description: '', thumbnailUrl: '', contentUrl: '' }]
        }));
    };
    const updateVideo = (index, field, value) => {
        setRichSnippets(prev => ({
            ...prev,
            videos: prev.videos.map((video, i) => i === index ? { ...video, [field]: value } : video)
        }));
    };
    const removeVideo = (index) => {
        setRichSnippets(prev => ({
            ...prev,
            videos: prev.videos.filter((_, i) => i !== index)
        }));
    };

    const handleSubmit = (e, publishStatus) => {
        e.preventDefault();

        // Basic validation
        if (!formData.name.trim()) {
            toast.error('Please enter product name');
            setActiveTab('basic');
            return;
        }
        if (!formData.category) {
            toast.error('Please select a category');
            setActiveTab('basic');
            return;
        }
        if (!formData.description.trim()) {
            toast.error('Please enter product description');
            setActiveTab('basic');
            return;
        }

        // Pricing validation
        if (!formData.pricing.regular) {
            toast.error('Please enter regular price');
            setActiveTab('pricing');
            return;
        }
        if (formData.pricing.sale !== '' && Number(formData.pricing.sale) >= Number(formData.pricing.regular)) {
            toast.error('Sale price must be less than regular price');
            setActiveTab('pricing');
            return;
        }

        // Pricing date validation
        if (formData.pricing.validFrom && formData.pricing.validThrough) {
            if (new Date(formData.pricing.validFrom) > new Date(formData.pricing.validThrough)) {
                toast.error('Price valid from date must be before valid through date');
                setActiveTab('pricing');
                return;
            }
        }

        // Image validation
        if (oldImages.length + newImages.length === 0) {
            toast.error('Product must have at least one image');
            setActiveTab('media');
            return;
        }

        const myForm = new FormData();
        
        // Basic info
        myForm.append('name', formData.name.trim());
        myForm.append('description', formData.description.trim());
        myForm.append('shortDescription', formData.shortDescription.trim());
        myForm.append('category', formData.category);
        myForm.append('brand', formData.brand.trim());
        myForm.append('manufacturer', formData.manufacturer.trim() || '');

        // Pricing
        const pricingData = {
            regular: Number(formData.pricing.regular),
            cost: Number(formData.pricing.cost) || 0,
            currency: formData.pricing.currency
        };
        if (formData.pricing.sale !== '') {
            pricingData.sale = Number(formData.pricing.sale);
        }
        if (formData.pricing.validFrom) {
            pricingData.validFrom = formData.pricing.validFrom;
        }
        if (formData.pricing.validThrough) {
            pricingData.validThrough = formData.pricing.validThrough;
        }
        myForm.append('pricing', JSON.stringify(pricingData));

        // Inventory
        const inventoryData = {
            stock: Number(formData.inventory.stock) || 0,
            sku: formData.inventory.sku.trim(),
            barcode: formData.inventory.barcode.trim(),
            trackInventory: formData.inventory.trackInventory,
            lowStockThreshold: Number(formData.inventory.lowStockThreshold)
        };
        if (formData.inventory.gtin) {
            inventoryData.gtin = formData.inventory.gtin.trim();
        }
        if (formData.inventory.mpn) {
            inventoryData.mpn = formData.inventory.mpn.trim();
        }
        myForm.append('inventory', JSON.stringify(inventoryData));

        // Arrays
        myForm.append('subcategories', JSON.stringify(subcategories));
        myForm.append('tags', JSON.stringify(tags));

        // Specifications
        const validSpecs = specifications.filter(s => s.key && s.value);
        if (validSpecs.length > 0) {
            myForm.append('specifications', JSON.stringify(validSpecs));
        }

        // Variants
        const validVariants = variants.filter(v => v.name && v.options.length > 0);
        if (validVariants.length > 0) {
            myForm.append('variants', JSON.stringify(validVariants));
        }

        // Dimensions & Weight
        myForm.append('dimensions', JSON.stringify({
            length: Number(formData.dimensions.length) || 0,
            width: Number(formData.dimensions.width) || 0,
            height: Number(formData.dimensions.height) || 0,
            unit: formData.dimensions.unit
        }));

        myForm.append('weight', JSON.stringify({
            value: Number(formData.weight.value) || 0,
            unit: formData.weight.unit
        }));

        // SEO - Complete
        const seoData = {
            metaTitle: formData.seo.metaTitle.trim(),
            metaDescription: formData.seo.metaDescription.trim(),
            keywords: seoKeywords,
            canonicalUrl: formData.seo.canonicalUrl || '',
            noIndex: formData.seo.noIndex || false,
            noFollow: formData.seo.noFollow || false,
            ogTitle: formData.seo.ogTitle || '',
            ogDescription: formData.seo.ogDescription || '',
            ogImage: formData.seo.ogImage || '',
            ogType: formData.seo.ogType || 'product',
            twitterCard: formData.seo.twitterCard || 'summary_large_image',
            twitterTitle: formData.seo.twitterTitle || '',
            twitterDescription: formData.seo.twitterDescription || '',
            twitterImage: formData.seo.twitterImage || '',
            schemaType: formData.seo.schemaType || 'Product',
            condition: formData.seo.condition || 'NewCondition',
            focusKeyphrase: formData.seo.focusKeyphrase || '',
            relatedSearchTerms: relatedSearchTerms
        };
        myForm.append('seo', JSON.stringify(seoData));

        // Breadcrumbs
        if (breadcrumbs.length > 0) {
            myForm.append('breadcrumbs', JSON.stringify(breadcrumbs));
        }

        // Rich Snippets
        const richSnippetsData = {
            faqs: richSnippets.faqs.filter(f => f.question && f.answer),
            howTo: richSnippets.howTo,
            videos: richSnippets.videos.filter(v => v.name && v.contentUrl)
        };
        myForm.append('richSnippets', JSON.stringify(richSnippetsData));

        // Flags
        myForm.append('isFeatured', formData.isFeatured);
        myForm.append('isNewArrival', formData.isNewArrival);
        myForm.append('isBestseller', formData.isBestseller);
        myForm.append('status', publishStatus || formData.status);

        // Images to delete
        if (imagesToDelete.length > 0) {
            myForm.append('imagesToDelete', JSON.stringify(imagesToDelete));
        }

        // Existing images with metadata
        const existingImagesData = oldImages.map((img, index) => ({
            public_id: img.public_id,
            url: img.url,
            alt: img.alt || '',
            isPrimary: index === 0,
            order: index,
            width: img.width || null,
            height: img.height || null,
            caption: img.caption || ''
        }));
        myForm.append('existingImages', JSON.stringify(existingImagesData));

        // CRITICAL FIX: Use 'images' not 'image'
        newImages.forEach((img) => myForm.append('images', img));

        dispatch(updateProduct({ id, productData: myForm }));
    };

    useEffect(() => {
        if (error) {
            toast.error(error.message || error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
        if (success) {
            toast.success('Product updated successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            navigate('/admin/products');
        }
    }, [error, success, dispatch, navigate]);

    if (products.length === 0) {
        return <Loader />;
    }

    if (!product) {
        return (
            <div className="eup-not-found">
                <FiAlertCircle />
                <h2>Product not found</h2>
                <button onClick={() => navigate('/admin/products')}>
                    Back to Products
                </button>
            </div>
        );
    }

    const tabs = [
        { id: 'basic', label: 'Basic Info', icon: <FiPackage /> },
        { id: 'pricing', label: 'Pricing', icon: <FiDollarSign /> },
        { id: 'inventory', label: 'Inventory', icon: <FiPackage /> },
        { id: 'media', label: 'Media', icon: <FiImage /> },
        { id: 'variants', label: 'Variants', icon: <FiSettings /> },
        { id: 'seo', label: 'SEO', icon: <FiTrendingUp /> },
        { id: 'advanced', label: 'Advanced SEO', icon: <FiTag /> },
        { id: 'settings', label: 'Settings', icon: <FiFlag /> }
    ];

    return (
        <>
            <PageTitle title="Update Product" />
            <Navbar />

            <div className="eup-container">
                <div className="eup-header">
                    <div className="eup-header-content">
                        <button className="eup-back-btn" onClick={() => navigate('/admin/products')}>
                            <FiArrowLeft /> Back to Products
                        </button>
                        <h1 className="eup-title">Update Product</h1>
                        <p className="eup-subtitle">Update {product.name}</p>
                    </div>
                </div>

                <div className="eup-content">
                    {/* Tab Navigation */}
                    <div className="eup-tabs">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                className={`eup-tab ${activeTab === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="eup-form">
                        {/* ── Basic Info ─────────────────────────────────────── */}
                        {activeTab === 'basic' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Product Information</h3>
                                    
                                    <div className="eup-form-group">
                                        <label className="eup-label required">Product Name</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="Enter product name"
                                            name="name"
                                            value={formData.name}
                                            onChange={handleInputChange}
                                            maxLength={200}
                                        />
                                        <span className="eup-char-count">{formData.name.length}/200</span>
                                    </div>

                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label required">Category</label>
                                            <select
                                                className="eup-select"
                                                name="category"
                                                value={formData.category}
                                                onChange={handleInputChange}
                                            >
                                                <option value="">Select Category</option>
                                                {categories.map(cat => (
                                                    <option key={cat} value={cat}>{cat}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Brand</label>
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Enter brand name"
                                                name="brand"
                                                value={formData.brand}
                                                onChange={handleInputChange}
                                            />
                                        </div>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Manufacturer</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="Enter manufacturer name"
                                            name="manufacturer"
                                            value={formData.manufacturer}
                                            onChange={handleInputChange}
                                        />
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Short Description</label>
                                        <textarea
                                            className="eup-textarea"
                                            placeholder="Brief product description"
                                            name="shortDescription"
                                            value={formData.shortDescription}
                                            onChange={handleInputChange}
                                            rows={3}
                                            maxLength={500}
                                        />
                                        <span className="eup-char-count">{formData.shortDescription.length}/500</span>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label required">Full Description</label>
                                        <textarea
                                            className="eup-textarea"
                                            placeholder="Detailed product description"
                                            name="description"
                                            value={formData.description}
                                            onChange={handleInputChange}
                                            rows={6}
                                            maxLength={5000}
                                        />
                                        <span className="eup-char-count">{formData.description.length}/5000</span>
                                    </div>

                                    {/* Subcategories */}
                                    <div className="eup-form-group">
                                        <label className="eup-label">Subcategories</label>
                                        <div className="eup-input-with-btn">
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Add subcategory"
                                                value={newSubcategory}
                                                onChange={(e) => setNewSubcategory(e.target.value)}
                                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSubcategory())}
                                            />
                                            <button type="button" className="eup-btn-icon" onClick={addSubcategory}>
                                                <FiPlus />
                                            </button>
                                        </div>
                                        <div className="eup-tags">
                                            {subcategories.map((sub, idx) => (
                                                <span key={idx} className="eup-tag">
                                                    {sub}
                                                    <button type="button" onClick={() => removeSubcategory(idx)}>
                                                        <FiX />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Tags */}
                                    <div className="eup-form-group">
                                        <label className="eup-label">Tags</label>
                                        <div className="eup-input-with-btn">
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Add tag"
                                                value={newTag}
                                                onChange={(e) => setNewTag(e.target.value)}
                                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                                            />
                                            <button type="button" className="eup-btn-icon" onClick={addTag}>
                                                <FiPlus />
                                            </button>
                                        </div>
                                        <div className="eup-tags">
                                            {tags.map((tag, idx) => (
                                                <span key={idx} className="eup-tag">
                                                    {tag}
                                                    <button type="button" onClick={() => removeTag(idx)}>
                                                        <FiX />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Specifications */}
                                    <div className="eup-form-group">
                                        <div className="eup-label-with-btn">
                                            <label className="eup-label">Specifications</label>
                                            <button type="button" className="eup-btn-small" onClick={addSpecification}>
                                                <FiPlus /> Add Spec
                                            </button>
                                        </div>
                                        {specifications.map((spec, idx) => (
                                            <div key={idx} className="eup-spec-row">
                                                <input
                                                    type="text"
                                                    className="eup-input"
                                                    placeholder="Key (e.g., Material)"
                                                    value={spec.key}
                                                    onChange={(e) => updateSpecification(idx, 'key', e.target.value)}
                                                />
                                                <input
                                                    type="text"
                                                    className="eup-input"
                                                    placeholder="Value (e.g., Cotton)"
                                                    value={spec.value}
                                                    onChange={(e) => updateSpecification(idx, 'value', e.target.value)}
                                                />
                                                <button 
                                                    type="button" 
                                                    className="eup-btn-icon-danger" 
                                                    onClick={() => removeSpecification(idx)}
                                                >
                                                    <FiTrash2 />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                </div>
                            </div>
                        )}

                        {/* ── Pricing ────────────────────────────────────────── */}
                        {activeTab === 'pricing' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Pricing Information</h3>
                                    
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label required">Regular Price</label>
                                            <div className="eup-input-with-icon">
                                                <FiDollarSign className="eup-input-icon" />
                                                <input
                                                    type="number"
                                                    className="eup-input eup-input-with-padding"
                                                    placeholder="0.00"
                                                    name="pricing.regular"
                                                    value={formData.pricing.regular}
                                                    onChange={handleInputChange}
                                                    min="0"
                                                    step="0.01"
                                                />
                                            </div>
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Sale Price</label>
                                            <div className="eup-input-with-icon">
                                                <FiDollarSign className="eup-input-icon" />
                                                <input
                                                    type="number"
                                                    className="eup-input eup-input-with-padding"
                                                    placeholder="0.00"
                                                    name="pricing.sale"
                                                    value={formData.pricing.sale}
                                                    onChange={handleInputChange}
                                                    min="0"
                                                    step="0.01"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {formData.pricing.regular !== '' && formData.pricing.sale !== '' && 
                                     Number(formData.pricing.sale) < Number(formData.pricing.regular) && (
                                        <div className="eup-discount-preview">
                                            <FiCheck className="eup-discount-icon" />
                                            <span>
                                                Discount: {Math.round(((Number(formData.pricing.regular) - Number(formData.pricing.sale)) / Number(formData.pricing.regular)) * 100)}% off
                                            </span>
                                        </div>
                                    )}

                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Cost Price</label>
                                            <div className="eup-input-with-icon">
                                                <FiDollarSign className="eup-input-icon" />
                                                <input
                                                    type="number"
                                                    className="eup-input eup-input-with-padding"
                                                    placeholder="0.00"
                                                    name="pricing.cost"
                                                    value={formData.pricing.cost}
                                                    onChange={handleInputChange}
                                                    min="0"
                                                    step="0.01"
                                                />
                                            </div>
                                            <small className="eup-help-text">Your cost for this product</small>
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Currency</label>
                                            <select
                                                className="eup-select"
                                                name="pricing.currency"
                                                value={formData.pricing.currency}
                                                onChange={handleInputChange}
                                            >
                                                {currencies.map(curr => (
                                                    <option key={curr} value={curr}>{curr}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Price Validity Period */}
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Price Valid From</label>
                                            <input
                                                type="date"
                                                className="eup-input"
                                                name="pricing.validFrom"
                                                value={formData.pricing.validFrom}
                                                onChange={handleInputChange}
                                            />
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Price Valid Through</label>
                                            <input
                                                type="date"
                                                className="eup-input"
                                                name="pricing.validThrough"
                                                value={formData.pricing.validThrough}
                                                onChange={handleInputChange}
                                            />
                                        </div>
                                    </div>

                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Shipping Information</h3>
                                    
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Weight</label>
                                            <div className="eup-input-group">
                                                <input
                                                    type="number"
                                                    className="eup-input"
                                                    placeholder="0"
                                                    name="weight.value"
                                                    value={formData.weight.value}
                                                    onChange={handleInputChange}
                                                    min="0"
                                                    step="0.01"
                                                />
                                                <select
                                                    className="eup-select-addon"
                                                    name="weight.unit"
                                                    value={formData.weight.unit}
                                                    onChange={handleInputChange}
                                                >
                                                    {weightUnits.map(unit => (
                                                        <option key={unit} value={unit}>{unit}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Dimensions (L × W × H)</label>
                                        <div className="eup-dimensions-grid">
                                            <input
                                                type="number"
                                                className="eup-input"
                                                placeholder="Length"
                                                name="dimensions.length"
                                                value={formData.dimensions.length}
                                                onChange={handleInputChange}
                                                min="0"
                                                step="0.01"
                                            />
                                            <input
                                                type="number"
                                                className="eup-input"
                                                placeholder="Width"
                                                name="dimensions.width"
                                                value={formData.dimensions.width}
                                                onChange={handleInputChange}
                                                min="0"
                                                step="0.01"
                                            />
                                            <input
                                                type="number"
                                                className="eup-input"
                                                placeholder="Height"
                                                name="dimensions.height"
                                                value={formData.dimensions.height}
                                                onChange={handleInputChange}
                                                min="0"
                                                step="0.01"
                                            />
                                            <select
                                                className="eup-select"
                                                name="dimensions.unit"
                                                value={formData.dimensions.unit}
                                                onChange={handleInputChange}
                                            >
                                                {dimensionUnits.map(unit => (
                                                    <option key={unit} value={unit}>{unit}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Inventory ──────────────────────────────────────── */}
                        {activeTab === 'inventory' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Inventory Management</h3>
                                    
                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Stock Quantity</label>
                                            <input
                                                type="number"
                                                className="eup-input"
                                                placeholder="0"
                                                name="inventory.stock"
                                                value={formData.inventory.stock}
                                                onChange={handleInputChange}
                                                min="0"
                                            />
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Low Stock Threshold</label>
                                            <input
                                                type="number"
                                                className="eup-input"
                                                placeholder="5"
                                                name="inventory.lowStockThreshold"
                                                value={formData.inventory.lowStockThreshold}
                                                onChange={handleInputChange}
                                                min="0"
                                            />
                                        </div>
                                    </div>

                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">SKU</label>
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="PROD-001"
                                                name="inventory.sku"
                                                value={formData.inventory.sku}
                                                onChange={handleInputChange}
                                            />
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Barcode</label>
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="123456789"
                                                name="inventory.barcode"
                                                value={formData.inventory.barcode}
                                                onChange={handleInputChange}
                                            />
                                        </div>
                                    </div>

                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">GTIN (Google Shopping)</label>
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Global Trade Item Number"
                                                name="inventory.gtin"
                                                value={formData.inventory.gtin}
                                                onChange={handleInputChange}
                                            />
                                            <small className="eup-help-text">UPC, EAN, JAN, ISBN, or ITF-14</small>
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">MPN</label>
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Manufacturer Part Number"
                                                name="inventory.mpn"
                                                value={formData.inventory.mpn}
                                                onChange={handleInputChange}
                                            />
                                        </div>
                                    </div>

                                    <div className="eup-checkbox-group">
                                        <label className="eup-checkbox">
                                            <input
                                                type="checkbox"
                                                name="inventory.trackInventory"
                                                checked={formData.inventory.trackInventory}
                                                onChange={handleInputChange}
                                            />
                                            <span>Track inventory for this product</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Media ──────────────────────────────────────────── */}
                        {activeTab === 'media' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Current Images</h3>
                                    
                                    {oldImages.length > 0 && (
                                        <div className="eup-image-grid">
                                            {oldImages.map((img, idx) => (
                                                <div key={idx} className="eup-image-card">
                                                    <img src={img.url} alt={`Current ${idx + 1}`} />
                                                    <div className="eup-image-overlay">
                                                        <button
                                                            type="button"
                                                            className="eup-image-btn"
                                                            onClick={() => setPrimaryOldImage(idx)}
                                                            title="Set as primary"
                                                        >
                                                            {idx === 0 ? <FiCheck /> : <FiEye />}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="eup-image-btn eup-image-btn-danger"
                                                            onClick={() => removeOldImage(img.public_id)}
                                                            title="Remove image"
                                                        >
                                                            <FiTrash2 />
                                                        </button>
                                                    </div>
                                                    {idx === 0 && <span className="eup-primary-badge">Primary</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Add New Images</h3>
                                    
                                    <div className="eup-upload-area">
                                        <input
                                            type="file"
                                            id="product-images"
                                            className="eup-file-input"
                                            accept="image/*"
                                            multiple
                                            onChange={handleNewImages}
                                        />
                                        <label htmlFor="product-images" className="eup-upload-label">
                                            <FiImage className="eup-upload-icon" />
                                            <span className="eup-upload-text">Click to upload new images</span>
                                            <span className="eup-upload-subtext">PNG, JPG up to 10MB</span>
                                        </label>
                                    </div>

                                    {newImagePreviews.length > 0 && (
                                        <>
                                            <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>New Images</h3>
                                            <div className="eup-image-grid">
                                                {newImagePreviews.map((img, idx) => (
                                                    <div key={idx} className="eup-image-card">
                                                        <img src={img} alt={`New ${idx + 1}`} />
                                                        <div className="eup-image-overlay">
                                                            <button
                                                                type="button"
                                                                className="eup-image-btn eup-image-btn-danger"
                                                                onClick={() => removeNewImage(idx)}
                                                                title="Remove image"
                                                            >
                                                                <FiTrash2 />
                                                            </button>
                                                        </div>
                                                        <span className="eup-new-badge">New</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── Variants ───────────────────────────────────────── */}
                        {activeTab === 'variants' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <div className="eup-label-with-btn">
                                        <h3 className="eup-section-title">Product Variants</h3>
                                        <button type="button" className="eup-btn-small" onClick={addVariant}>
                                            <FiPlus /> Add Variant
                                        </button>
                                    </div>

                                    {variants.map((variant, vIdx) => (
                                        <div key={vIdx} className="eup-variant-card">
                                            <div className="eup-variant-header">
                                                <input
                                                    type="text"
                                                    className="eup-input"
                                                    placeholder="Variant name (e.g., Size, Color)"
                                                    value={variant.name}
                                                    onChange={(e) => updateVariantName(vIdx, e.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    className="eup-btn-icon-danger"
                                                    onClick={() => removeVariant(vIdx)}
                                                >
                                                    <FiTrash2 />
                                                </button>
                                            </div>

                                            <div className="eup-variant-options">
                                                {variant.options.map((option, oIdx) => (
                                                    <div key={oIdx} className="eup-variant-option-row">
                                                        <input
                                                            type="text"
                                                            className="eup-input"
                                                            placeholder="Value"
                                                            value={option.value}
                                                            onChange={(e) => updateVariantOption(vIdx, oIdx, 'value', e.target.value)}
                                                        />
                                                        <input
                                                            type="number"
                                                            className="eup-input"
                                                            placeholder="Price +"
                                                            value={option.priceModifier}
                                                            onChange={(e) => updateVariantOption(vIdx, oIdx, 'priceModifier', Number(e.target.value))}
                                                            step="0.01"
                                                        />
                                                        <input
                                                            type="number"
                                                            className="eup-input"
                                                            placeholder="Stock"
                                                            value={option.stock}
                                                            onChange={(e) => updateVariantOption(vIdx, oIdx, 'stock', Number(e.target.value))}
                                                            min="0"
                                                        />
                                                        <button
                                                            type="button"
                                                            className="eup-btn-icon-danger"
                                                            onClick={() => removeVariantOption(vIdx, oIdx)}
                                                        >
                                                            <FiX />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    className="eup-btn-secondary eup-btn-full"
                                                    onClick={() => addVariantOption(vIdx)}
                                                >
                                                    <FiPlus /> Add Option
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {variants.length === 0 && (
                                        <div className="eup-info-box">
                                            <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                                            <span>Add variants if your product comes in different sizes, colors, or styles</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── SEO (Basic) ────────────────────────────────────── */}
                        {activeTab === 'seo' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Search Engine Optimization</h3>
                                    
                                    <div className="eup-form-group">
                                        <label className="eup-label">Meta Title</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="Product meta title"
                                            name="seo.metaTitle"
                                            value={formData.seo.metaTitle}
                                            onChange={handleInputChange}
                                            maxLength={60}
                                        />
                                        <span className="eup-char-count">{formData.seo.metaTitle.length}/60</span>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Meta Description</label>
                                        <textarea
                                            className="eup-textarea"
                                            placeholder="Product meta description (120-160 characters recommended)"
                                            name="seo.metaDescription"
                                            value={formData.seo.metaDescription}
                                            onChange={handleInputChange}
                                            rows={3}
                                            maxLength={160}
                                        />
                                        <span className="eup-char-count">{formData.seo.metaDescription.length}/160</span>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Keywords</label>
                                        <div className="eup-input-with-btn">
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Add keyword"
                                                value={newKeyword}
                                                onChange={(e) => setNewKeyword(e.target.value)}
                                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                                            />
                                            <button type="button" className="eup-btn-icon" onClick={addKeyword}>
                                                <FiPlus />
                                            </button>
                                        </div>
                                        <div className="eup-tags">
                                            {seoKeywords.map((keyword, idx) => (
                                                <span key={idx} className="eup-tag">
                                                    {keyword}
                                                    <button type="button" onClick={() => removeKeyword(idx)}>
                                                        <FiX />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Canonical URL</label>
                                        <input
                                            type="url"
                                            className="eup-input"
                                            placeholder="https://example.com/products/product-name"
                                            name="seo.canonicalUrl"
                                            value={formData.seo.canonicalUrl}
                                            onChange={handleInputChange}
                                        />
                                        <small className="eup-help-text">Specify the preferred URL for this product</small>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Focus Keyphrase</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="Main keyphrase for SEO optimization"
                                            name="seo.focusKeyphrase"
                                            value={formData.seo.focusKeyphrase}
                                            onChange={handleInputChange}
                                        />
                                    </div>

                                    {/* Breadcrumbs */}
                                    
                                    <div className="eup-form-group">
                                        <div className="eup-label-with-btn">
                                            <label className="eup-label">Breadcrumbs (SEO)</label>
                                            <button
                                                type="button"
                                                className="eup-btn-small"
                                                onClick={addBreadcrumb}
                                                disabled={!newBreadcrumb.name || !newBreadcrumb.url}
                                            >
                                                <FiPlus /> Add
                                            </button>
                                        </div>
                                        <div className="eup-spec-row">
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Name (e.g., Home)"
                                                value={newBreadcrumb.name}
                                                onChange={e => setNewBreadcrumb(prev => ({ ...prev, name: e.target.value }))}
                                            />
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="URL (e.g., /)"
                                                value={newBreadcrumb.url}
                                                onChange={e => setNewBreadcrumb(prev => ({ ...prev, url: e.target.value }))}
                                            />
                                        </div>
                                        <div className="eup-tags">
                                            {breadcrumbs.map((breadcrumb, idx) => (
                                                <span key={idx} className="eup-tag">
                                                    {breadcrumb.position}. {breadcrumb.name}
                                                    <button type="button" onClick={() => removeBreadcrumb(idx)}><FiX /></button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="eup-form-row">
                                        <div className="eup-form-group">
                                            <label className="eup-label">Schema Type</label>
                                            <select
                                                className="eup-select"
                                                name="seo.schemaType"
                                                value={formData.seo.schemaType}
                                                onChange={handleInputChange}
                                            >
                                                {schemaTypes.map(type => (
                                                    <option key={type} value={type}>{type}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="eup-form-group">
                                            <label className="eup-label">Condition</label>
                                            <select
                                                className="eup-select"
                                                name="seo.condition"
                                                value={formData.seo.condition}
                                                onChange={handleInputChange}
                                            >
                                                {conditions.map(cond => (
                                                    <option key={cond} value={cond}>{cond.replace('Condition', '')}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="eup-checkbox-grid">
                                        <label className="eup-checkbox">
                                            <input
                                                type="checkbox"
                                                name="seo.noIndex"
                                                checked={formData.seo.noIndex}
                                                onChange={handleInputChange}
                                            />
                                            <span>No Index (Hide from search engines)</span>
                                        </label>

                                        <label className="eup-checkbox">
                                            <input
                                                type="checkbox"
                                                name="seo.noFollow"
                                                checked={formData.seo.noFollow}
                                                onChange={handleInputChange}
                                            />
                                            <span>No Follow (Don&apos;t follow links)</span>
                                        </label>
                                    </div>

                                    {/* Related Search Terms */}
                                    <div className="eup-form-group" style={{ marginTop: '2rem' }}>
                                        <label className="eup-label">Related Search Terms</label>
                                        <div className="eup-input-with-btn">
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Add related search term"
                                                value={newRelatedTerm}
                                                onChange={e => setNewRelatedTerm(e.target.value)}
                                                onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addRelatedTerm())}
                                            />
                                            <button type="button" className="eup-btn-icon" onClick={addRelatedTerm}>
                                                <FiPlus />
                                            </button>
                                        </div>
                                        <div className="eup-tags">
                                            {relatedSearchTerms.map((term, idx) => (
                                                <span key={idx} className="eup-tag">
                                                    {term}
                                                    <button type="button" onClick={() => removeRelatedTerm(idx)}><FiX /></button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Rich Snippets - FAQs */}
                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Rich Snippets - FAQs</h3>
                                    <div className="eup-label-with-btn">
                                        <label className="eup-label">Frequently Asked Questions</label>
                                        <button type="button" className="eup-btn-small" onClick={addFAQ}>
                                            <FiPlus /> Add FAQ
                                        </button>
                                    </div>

                                    {richSnippets.faqs.map((faq, idx) => (
                                        <div key={idx} className="eup-faq-card">
                                            <div className="eup-faq-header">
                                                <input
                                                    type="text"
                                                    className="eup-input"
                                                    placeholder="Question"
                                                    value={faq.question}
                                                    onChange={e => updateFAQ(idx, 'question', e.target.value)}
                                                    maxLength={200}
                                                />
                                                <button
                                                    type="button"
                                                    className="eup-btn-icon-danger"
                                                    onClick={() => removeFAQ(idx)}
                                                >
                                                    <FiTrash2 />
                                                </button>
                                            </div>
                                            <textarea
                                                className="eup-textarea"
                                                placeholder="Answer"
                                                value={faq.answer}
                                                onChange={e => updateFAQ(idx, 'answer', e.target.value)}
                                                rows={3}
                                                maxLength={1000}
                                            />
                                        </div>
                                    ))}

                                    {/* Rich Snippets - Videos */}
                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Rich Snippets - Videos</h3>
                                    <div className="eup-label-with-btn">
                                        <label className="eup-label">Product Videos</label>
                                        <button type="button" className="eup-btn-small" onClick={addVideo}>
                                            <FiPlus /> Add Video
                                        </button>
                                    </div>

                                    {richSnippets.videos.map((video, idx) => (
                                        <div key={idx} className="eup-video-card">
                                            <div className="eup-video-header">
                                                <input
                                                    type="text"
                                                    className="eup-input"
                                                    placeholder="Video Name"
                                                    value={video.name}
                                                    onChange={e => updateVideo(idx, 'name', e.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    className="eup-btn-icon-danger"
                                                    onClick={() => removeVideo(idx)}
                                                >
                                                    <FiTrash2 />
                                                </button>
                                            </div>
                                            <input
                                                type="text"
                                                className="eup-input"
                                                placeholder="Description"
                                                value={video.description}
                                                onChange={e => updateVideo(idx, 'description', e.target.value)}
                                                style={{ marginTop: '0.5rem' }}
                                            />
                                            <input
                                                type="url"
                                                className="eup-input"
                                                placeholder="Content URL"
                                                value={video.contentUrl}
                                                onChange={e => updateVideo(idx, 'contentUrl', e.target.value)}
                                                style={{ marginTop: '0.5rem' }}
                                            />
                                            <input
                                                type="url"
                                                className="eup-input"
                                                placeholder="Thumbnail URL"
                                                value={video.thumbnailUrl}
                                                onChange={e => updateVideo(idx, 'thumbnailUrl', e.target.value)}
                                                style={{ marginTop: '0.5rem' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Advanced SEO (Social Media) ────────────────────── */}
                        {activeTab === 'advanced' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Open Graph (Facebook)</h3>

                                    <div className="eup-form-group">
                                        <label className="eup-label">OG Title</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="Title for social sharing"
                                            name="seo.ogTitle"
                                            value={formData.seo.ogTitle}
                                            onChange={handleInputChange}
                                            maxLength={60}
                                        />
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">OG Description</label>
                                        <textarea
                                            className="eup-textarea"
                                            placeholder="Description for social sharing"
                                            name="seo.ogDescription"
                                            value={formData.seo.ogDescription}
                                            onChange={handleInputChange}
                                            rows={3}
                                            maxLength={160}
                                        />
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">OG Image URL</label>
                                        <input
                                            type="url"
                                            className="eup-input"
                                            placeholder="https://example.com/image.jpg"
                                            name="seo.ogImage"
                                            value={formData.seo.ogImage}
                                            onChange={handleInputChange}
                                        />
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">OG Type</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="product"
                                            name="seo.ogType"
                                            value={formData.seo.ogType}
                                            onChange={handleInputChange}
                                        />
                                    </div>

                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Twitter Card</h3>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Card Type</label>
                                        <select
                                            className="eup-select"
                                            name="seo.twitterCard"
                                            value={formData.seo.twitterCard}
                                            onChange={handleInputChange}
                                        >
                                            {twitterCardTypes.map(type => (
                                                <option key={type} value={type}>{type}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Twitter Title</label>
                                        <input
                                            type="text"
                                            className="eup-input"
                                            placeholder="Title for Twitter"
                                            name="seo.twitterTitle"
                                            value={formData.seo.twitterTitle}
                                            onChange={handleInputChange}
                                            maxLength={70}
                                        />
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Twitter Description</label>
                                        <textarea
                                            className="eup-textarea"
                                            placeholder="Description for Twitter"
                                            name="seo.twitterDescription"
                                            value={formData.seo.twitterDescription}
                                            onChange={handleInputChange}
                                            rows={3}
                                            maxLength={200}
                                        />
                                    </div>

                                    <div className="eup-form-group">
                                        <label className="eup-label">Twitter Image URL</label>
                                        <input
                                            type="url"
                                            className="eup-input"
                                            placeholder="https://example.com/image.jpg"
                                            name="seo.twitterImage"
                                            value={formData.seo.twitterImage}
                                            onChange={handleInputChange}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Settings (Flags) ───────────────────────────────── */}
                        {activeTab === 'settings' && (
                            <div className="eup-tab-content">
                                <div className="eup-section">
                                    <h3 className="eup-section-title">Product Flags</h3>
                                    <p className="eup-help-text" style={{ marginBottom: '1.5rem' }}>
                                        These flags control how the product appears in storefront sections and promotions.
                                    </p>

                                    <div className="eup-checkbox-grid">
                                        <label className="eup-checkbox">
                                            <input
                                                type="checkbox"
                                                name="isFeatured"
                                                checked={formData.isFeatured}
                                                onChange={handleInputChange}
                                            />
                                            <span>Featured Product</span>
                                        </label>

                                        <label className="eup-checkbox">
                                            <input
                                                type="checkbox"
                                                name="isNewArrival"
                                                checked={formData.isNewArrival}
                                                onChange={handleInputChange}
                                            />
                                            <span>New Arrival</span>
                                        </label>

                                        <label className="eup-checkbox">
                                            <input
                                                type="checkbox"
                                                name="isBestseller"
                                                checked={formData.isBestseller}
                                                onChange={handleInputChange}
                                            />
                                            <span>Bestseller</span>
                                        </label>
                                    </div>

                                    <div className="eup-form-group" style={{ marginTop: '2rem' }}>
                                        <label className="eup-label">Publication Status</label>
                                        <select
                                            className="eup-select"
                                            name="status"
                                            value={formData.status}
                                            onChange={handleInputChange}
                                        >
                                            <option value="draft">Draft</option>
                                            <option value="published">Published</option>
                                            <option value="archived">Archived</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="eup-actions">
                            <button
                                type="button"
                                className="eup-btn eup-btn-secondary"
                                onClick={() => navigate('/admin/products')}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="eup-btn eup-btn-primary"
                                onClick={(e) => handleSubmit(e)}
                                disabled={loading}
                            >
                                {loading ? 'Updating...' : <><FiSave /> Update Product</>}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default UpdateProduct;