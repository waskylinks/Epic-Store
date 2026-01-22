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
  FiEye, FiAlertCircle, FiCheck, FiArrowLeft 
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

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        shortDescription: '',
        category: '',
        brand: '',
        pricing: {
            regular: '',
            sale: '',
            cost: '',
            currency: 'USD'
        },
        inventory: {
            stock: '',
            sku: '',
            barcode: '',
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
            keywords: []
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

    // Input states
    const [newSubcategory, setNewSubcategory] = useState('');
    const [newTag, setNewTag] = useState('');
    const [newKeyword, setNewKeyword] = useState('');

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

    // Pre-fill form when product is found
    useEffect(() => {
        if (product) {
            setFormData({
                name: product.name || '',
                description: product.description || '',
                shortDescription: product.shortDescription || '',
                category: product.category || '',
                brand: product.brand || '',
                pricing: {
                    regular: product.pricing?.regular || product.price || '',
                    sale: product.pricing?.sale || '',
                    cost: product.pricing?.cost || '',
                    currency: product.pricing?.currency || 'USD'
                },
                inventory: {
                    stock: product.inventory?.stock ?? product.stock ?? '',
                    sku: product.inventory?.sku || '',
                    barcode: product.inventory?.barcode || '',
                    trackInventory: product.inventory?.trackInventory ?? true,
                    lowStockThreshold: product.inventory?.lowStockThreshold || 5
                },
                dimensions: product.dimensions || {
                    length: '',
                    width: '',
                    height: '',
                    unit: 'cm'
                },
                weight: product.weight || {
                    value: '',
                    unit: 'kg'
                },
                seo: product.seo || {
                    metaTitle: '',
                    metaDescription: '',
                    keywords: []
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

    // Add/Remove subcategories
    const addSubcategory = () => {
        if (newSubcategory.trim()) {
            setSubcategories([...subcategories, newSubcategory.trim()]);
            setNewSubcategory('');
        }
    };

    const removeSubcategory = (index) => {
        setSubcategories(subcategories.filter((_, i) => i !== index));
    };

    // Add/Remove tags
    const addTag = () => {
        if (newTag.trim()) {
            setTags([...tags, newTag.trim().toLowerCase()]);
            setNewTag('');
        }
    };

    const removeTag = (index) => {
        setTags(tags.filter((_, i) => i !== index));
    };

    // Add/Remove SEO keywords
    const addKeyword = () => {
        if (newKeyword.trim()) {
            setSeoKeywords([...seoKeywords, newKeyword.trim()]);
            setNewKeyword('');
        }
    };

    const removeKeyword = (index) => {
        setSeoKeywords(seoKeywords.filter((_, i) => i !== index));
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

    const handleSubmit = (e, publishStatus) => {
        e.preventDefault();

        if (!formData.category) {
            toast.error('Please select a category', { position: 'top-center', autoClose: 3000 });
            return;
        }
        if (oldImages.length + newImages.length === 0) {
            toast.error('Product must have at least one image', { position: 'top-center', autoClose: 3000 });
            return;
        }

        const myForm = new FormData();
        
        // Basic info
        myForm.append('name', formData.name);
        myForm.append('description', formData.description);
        myForm.append('shortDescription', formData.shortDescription);
        myForm.append('category', formData.category);
        myForm.append('brand', formData.brand);
        
        // Pricing (legacy fields)
        myForm.append('price', formData.pricing.regular);
        if (formData.pricing.sale) {
            myForm.append('salePrice', formData.pricing.sale);
        }
        myForm.append('currency', formData.pricing.currency);
        
        // Inventory (legacy field)
        myForm.append('stock', formData.inventory.stock || 0);
        if (formData.inventory.sku) {
            myForm.append('sku', formData.inventory.sku);
        }
        
        // Arrays
        subcategories.forEach(sub => myForm.append('subcategories', sub));
        tags.forEach(tag => myForm.append('tags', tag));
        
        // Specifications
        if (specifications.length > 0) {
            myForm.append('specifications', JSON.stringify(specifications.filter(s => s.key && s.value)));
        }
        
        // Variants
        if (variants.length > 0) {
            myForm.append('variants', JSON.stringify(variants.filter(v => v.name && v.options.length > 0)));
        }
        
        // Dimensions & Weight
        if (formData.dimensions.length || formData.dimensions.width || formData.dimensions.height) {
            myForm.append('dimensions', JSON.stringify(formData.dimensions));
        }
        if (formData.weight.value) {
            myForm.append('weight', JSON.stringify(formData.weight));
        }
        
        // SEO
        const seoData = {
            ...formData.seo,
            keywords: seoKeywords
        };
        myForm.append('seo', JSON.stringify(seoData));
        
        // Flags
        myForm.append('isFeatured', formData.isFeatured);
        myForm.append('isNewArrival', formData.isNewArrival);
        myForm.append('isBestseller', formData.isBestseller);
        myForm.append('status', publishStatus || formData.status);
        
        // Images to delete
        if (imagesToDelete.length > 0) {
            myForm.append('imagesToDelete', JSON.stringify(imagesToDelete));
        }
        
        // New images
        newImages.forEach((img) => myForm.append('image', img));

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
                                className={`eup-tab ${activeTab === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    <form className="eup-form" onSubmit={(e) => handleSubmit(e)}>
                        {/* Basic Info Tab */}
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
                                            required
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
                                                required
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
                                            required
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

                        {/* Pricing Tab - Same as Create Product */}
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
                                                    required
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

                                    {formData.pricing.regular && formData.pricing.sale && (
                                        <div className="eup-discount-preview">
                                            <FiCheck className="eup-discount-icon" />
                                            <span>
                                                Discount: {Math.round(((formData.pricing.regular - formData.pricing.sale) / formData.pricing.regular) * 100)}% off
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

                                    {/* Shipping */}
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
                                        <label className="eup-label">Dimensions</label>
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

                        {/* Inventory Tab */}
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

                        {/* Media Tab */}
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

                        {/* Variants Tab - Similar to Create */}
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
                                </div>
                            </div>
                        )}

                        {/* SEO Tab */}
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
                                            placeholder="Product meta description"
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

                                    <h3 className="eup-section-title" style={{ marginTop: '2rem' }}>Product Flags</h3>
                                    
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
                                type="submit"
                                className="eup-btn eup-btn-primary"
                                disabled={loading}
                            >
                                {loading ? 'Updating...' : <><FiSave /> Update Product</>}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <Footer />
        </>
    );
}

export default UpdateProduct;