import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import '../AdminStyles/CreateProduct.css';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { createProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import { 
  FiImage, FiDollarSign, FiPackage, FiTag, FiSettings, 
  FiTrendingUp, FiX, FiPlus, FiTrash2, FiSave, 
  FiEye, FiAlertCircle, FiCheck 
} from 'react-icons/fi';

function CreateProduct() {
  const { success, loading, error } = useSelector((state) => state.admin);
  const dispatch = useDispatch();

  const [activeTab, setActiveTab] = useState('basic');
  const [images, setImages] = useState([]);
  const [imagePreview, setImagePreview] = useState([]);

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
    isNewArrival: true,
    isBestseller: false,
    status: 'draft'
  });

  const [subcategories, setSubcategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [specifications, setSpecifications] = useState([]);
  const [variants, setVariants] = useState([]);
  const [seoKeywords, setSeoKeywords] = useState([]);

  // Input states for adding items
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

  // Handle input changes
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
  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.readyState === 2) {
          setImagePreview((old) => [...old, reader.result]);
          setImages((old) => [...old, file]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages((old) => old.filter((_, i) => i !== index));
    setImagePreview((old) => old.filter((_, i) => i !== index));
  };

  const setPrimaryImage = (index) => {
    const newPreviews = [...imagePreview];
    const newImages = [...images];
    
    const [primaryPreview] = newPreviews.splice(index, 1);
    const [primaryImage] = newImages.splice(index, 1);
    
    setImagePreview([primaryPreview, ...newPreviews]);
    setImages([primaryImage, ...newImages]);
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

  // Form submission
  const handleSubmit = (e, publishStatus = 'draft') => {
    e.preventDefault();

    if (!formData.category) {
      toast.error('Please select a category');
      return;
    }
    if (images.length === 0) {
      toast.error('Please upload at least one image');
      return;
    }
    if (!formData.pricing.regular) {
      toast.error('Please enter regular price');
      return;
    }

    const myForm = new FormData();
    
    // Basic info
    myForm.append('name', formData.name);
    myForm.append('description', formData.description);
    myForm.append('shortDescription', formData.shortDescription);
    myForm.append('category', formData.category);
    myForm.append('brand', formData.brand);
    
    // Pricing (legacy fields for backward compatibility)
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
    myForm.append('status', publishStatus);
    
    // Images
    images.forEach((img) => myForm.append('image', img));

    dispatch(createProduct(myForm));
  };

  const resetForm = () => {
    setFormData({
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
      isNewArrival: true,
      isBestseller: false,
      status: 'draft'
    });
    setImages([]);
    setImagePreview([]);
    setSubcategories([]);
    setTags([]);
    setSpecifications([]);
    setVariants([]);
    setSeoKeywords([]);
    setActiveTab('basic');
  };

  useEffect(() => {
    if (error) {
      toast.error(error.message || error, { position: 'top-center', autoClose: 3000 });
      dispatch(removeErrors());
    }
    if (success) {
      toast.success('Product created successfully!', { position: 'top-center', autoClose: 3000 });
      dispatch(removeSuccess());
      resetForm();
    }
  }, [dispatch, error, success]);

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
      <PageTitle title="Create Product" />
      <Navbar />

      <div className="ecp-container">
        <div className="ecp-header">
          <div className="ecp-header-content">
            <h1 className="ecp-title">Create New Product</h1>
            <p className="ecp-subtitle">Add a new product to your catalog</p>
          </div>
          <div className="ecp-header-actions">
            <button 
              type="button" 
              className="ecp-btn ecp-btn-secondary"
              onClick={resetForm}
            >
              <FiX /> Cancel
            </button>
          </div>
        </div>

        <div className="ecp-content">
          {/* Tab Navigation */}
          <div className="ecp-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`ecp-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <form className="ecp-form" onSubmit={(e) => handleSubmit(e, 'draft')}>
            {/* Basic Info Tab */}
            {activeTab === 'basic' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Information</h3>
                  
                  <div className="ecp-form-group">
                    <label className="ecp-label required">Product Name</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="Enter product name"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      required
                      maxLength={200}
                    />
                    <span className="ecp-char-count">{formData.name.length}/200</span>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label required">Category</label>
                      <select
                        className="ecp-select"
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

                    <div className="ecp-form-group">
                      <label className="ecp-label">Brand</label>
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Enter brand name"
                        name="brand"
                        value={formData.brand}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Short Description</label>
                    <textarea
                      className="ecp-textarea"
                      placeholder="Brief product description"
                      name="shortDescription"
                      value={formData.shortDescription}
                      onChange={handleInputChange}
                      rows={3}
                      maxLength={500}
                    />
                    <span className="ecp-char-count">{formData.shortDescription.length}/500</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label required">Full Description</label>
                    <textarea
                      className="ecp-textarea"
                      placeholder="Detailed product description"
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      rows={6}
                      required
                      maxLength={5000}
                    />
                    <span className="ecp-char-count">{formData.description.length}/5000</span>
                  </div>

                  {/* Subcategories */}
                  <div className="ecp-form-group">
                    <label className="ecp-label">Subcategories</label>
                    <div className="ecp-input-with-btn">
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Add subcategory"
                        value={newSubcategory}
                        onChange={(e) => setNewSubcategory(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSubcategory())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addSubcategory}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {subcategories.map((sub, idx) => (
                        <span key={idx} className="ecp-tag">
                          {sub}
                          <button type="button" onClick={() => removeSubcategory(idx)}>
                            <FiX />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="ecp-form-group">
                    <label className="ecp-label">Tags</label>
                    <div className="ecp-input-with-btn">
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Add tag"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addTag}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {tags.map((tag, idx) => (
                        <span key={idx} className="ecp-tag">
                          {tag}
                          <button type="button" onClick={() => removeTag(idx)}>
                            <FiX />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Specifications */}
                  <div className="ecp-form-group">
                    <div className="ecp-label-with-btn">
                      <label className="ecp-label">Specifications</label>
                      <button type="button" className="ecp-btn-small" onClick={addSpecification}>
                        <FiPlus /> Add Spec
                      </button>
                    </div>
                    {specifications.map((spec, idx) => (
                      <div key={idx} className="ecp-spec-row">
                        <input
                          type="text"
                          className="ecp-input"
                          placeholder="Key (e.g., Material)"
                          value={spec.key}
                          onChange={(e) => updateSpecification(idx, 'key', e.target.value)}
                        />
                        <input
                          type="text"
                          className="ecp-input"
                          placeholder="Value (e.g., Cotton)"
                          value={spec.value}
                          onChange={(e) => updateSpecification(idx, 'value', e.target.value)}
                        />
                        <button 
                          type="button" 
                          className="ecp-btn-icon-danger" 
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

            {/* Pricing Tab */}
            {activeTab === 'pricing' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Pricing Information</h3>
                  
                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label required">Regular Price</label>
                      <div className="ecp-input-with-icon">
                        <FiDollarSign className="ecp-input-icon" />
                        <input
                          type="number"
                          className="ecp-input ecp-input-with-padding"
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

                    <div className="ecp-form-group">
                      <label className="ecp-label">Sale Price</label>
                      <div className="ecp-input-with-icon">
                        <FiDollarSign className="ecp-input-icon" />
                        <input
                          type="number"
                          className="ecp-input ecp-input-with-padding"
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
                    <div className="ecp-discount-preview">
                      <FiCheck className="ecp-discount-icon" />
                      <span>
                        Discount: {Math.round(((formData.pricing.regular - formData.pricing.sale) / formData.pricing.regular) * 100)}% off
                      </span>
                    </div>
                  )}

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Cost Price</label>
                      <div className="ecp-input-with-icon">
                        <FiDollarSign className="ecp-input-icon" />
                        <input
                          type="number"
                          className="ecp-input ecp-input-with-padding"
                          placeholder="0.00"
                          name="pricing.cost"
                          value={formData.pricing.cost}
                          onChange={handleInputChange}
                          min="0"
                          step="0.01"
                        />
                      </div>
                      <small className="ecp-help-text">Your cost for this product</small>
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label">Currency</label>
                      <select
                        className="ecp-select"
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
                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Shipping Information</h3>
                  
                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Weight</label>
                      <div className="ecp-input-group">
                        <input
                          type="number"
                          className="ecp-input"
                          placeholder="0"
                          name="weight.value"
                          value={formData.weight.value}
                          onChange={handleInputChange}
                          min="0"
                          step="0.01"
                        />
                        <select
                          className="ecp-select-addon"
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

                  <div className="ecp-form-group">
                    <label className="ecp-label">Dimensions</label>
                    <div className="ecp-dimensions-grid">
                      <input
                        type="number"
                        className="ecp-input"
                        placeholder="Length"
                        name="dimensions.length"
                        value={formData.dimensions.length}
                        onChange={handleInputChange}
                        min="0"
                        step="0.01"
                      />
                      <input
                        type="number"
                        className="ecp-input"
                        placeholder="Width"
                        name="dimensions.width"
                        value={formData.dimensions.width}
                        onChange={handleInputChange}
                        min="0"
                        step="0.01"
                      />
                      <input
                        type="number"
                        className="ecp-input"
                        placeholder="Height"
                        name="dimensions.height"
                        value={formData.dimensions.height}
                        onChange={handleInputChange}
                        min="0"
                        step="0.01"
                      />
                      <select
                        className="ecp-select"
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
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Inventory Management</h3>
                  
                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Stock Quantity</label>
                      <input
                        type="number"
                        className="ecp-input"
                        placeholder="0"
                        name="inventory.stock"
                        value={formData.inventory.stock}
                        onChange={handleInputChange}
                        min="0"
                      />
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label">Low Stock Threshold</label>
                      <input
                        type="number"
                        className="ecp-input"
                        placeholder="5"
                        name="inventory.lowStockThreshold"
                        value={formData.inventory.lowStockThreshold}
                        onChange={handleInputChange}
                        min="0"
                      />
                    </div>
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">SKU</label>
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="PROD-001"
                        name="inventory.sku"
                        value={formData.inventory.sku}
                        onChange={handleInputChange}
                      />
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label">Barcode</label>
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="123456789"
                        name="inventory.barcode"
                        value={formData.inventory.barcode}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>

                  <div className="ecp-checkbox-group">
                    <label className="ecp-checkbox">
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
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Images</h3>
                  
                  <div className="ecp-upload-area">
                    <input
                      type="file"
                      id="product-images"
                      className="ecp-file-input"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                    />
                    <label htmlFor="product-images" className="ecp-upload-label">
                      <FiImage className="ecp-upload-icon" />
                      <span className="ecp-upload-text">Click to upload images</span>
                      <span className="ecp-upload-subtext">PNG, JPG up to 10MB</span>
                    </label>
                  </div>

                  {imagePreview.length > 0 && (
                    <div className="ecp-image-grid">
                      {imagePreview.map((img, idx) => (
                        <div key={idx} className="ecp-image-card">
                          <img src={img} alt={`Product ${idx + 1}`} />
                          <div className="ecp-image-overlay">
                            <button
                              type="button"
                              className="ecp-image-btn"
                              onClick={() => setPrimaryImage(idx)}
                              title="Set as primary"
                            >
                              {idx === 0 ? <FiCheck /> : <FiEye />}
                            </button>
                            <button
                              type="button"
                              className="ecp-image-btn ecp-image-btn-danger"
                              onClick={() => removeImage(idx)}
                              title="Remove image"
                            >
                              <FiTrash2 />
                            </button>
                          </div>
                          {idx === 0 && <span className="ecp-primary-badge">Primary</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Variants Tab */}
            {activeTab === 'variants' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <div className="ecp-label-with-btn">
                    <h3 className="ecp-section-title">Product Variants</h3>
                    <button type="button" className="ecp-btn-small" onClick={addVariant}>
                      <FiPlus /> Add Variant
                    </button>
                  </div>

                  {variants.map((variant, vIdx) => (
                    <div key={vIdx} className="ecp-variant-card">
                      <div className="ecp-variant-header">
                        <input
                          type="text"
                          className="ecp-input"
                          placeholder="Variant name (e.g., Size, Color)"
                          value={variant.name}
                          onChange={(e) => updateVariantName(vIdx, e.target.value)}
                        />
                        <button
                          type="button"
                          className="ecp-btn-icon-danger"
                          onClick={() => removeVariant(vIdx)}
                        >
                          <FiTrash2 />
                        </button>
                      </div>

                      <div className="ecp-variant-options">
                        {variant.options.map((option, oIdx) => (
                          <div key={oIdx} className="ecp-variant-option-row">
                            <input
                              type="text"
                              className="ecp-input"
                              placeholder="Value"
                              value={option.value}
                              onChange={(e) => updateVariantOption(vIdx, oIdx, 'value', e.target.value)}
                            />
                            <input
                              type="number"
                              className="ecp-input"
                              placeholder="Price +"
                              value={option.priceModifier}
                              onChange={(e) => updateVariantOption(vIdx, oIdx, 'priceModifier', Number(e.target.value))}
                              step="0.01"
                            />
                            <input
                              type="number"
                              className="ecp-input"
                              placeholder="Stock"
                              value={option.stock}
                              onChange={(e) => updateVariantOption(vIdx, oIdx, 'stock', Number(e.target.value))}
                              min="0"
                            />
                            <button
                              type="button"
                              className="ecp-btn-icon-danger"
                              onClick={() => removeVariantOption(vIdx, oIdx)}
                            >
                              <FiX />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="ecp-btn-secondary ecp-btn-full"
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
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Search Engine Optimization</h3>
                  
                  <div className="ecp-form-group">
                    <label className="ecp-label">Meta Title</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="Product meta title"
                      name="seo.metaTitle"
                      value={formData.seo.metaTitle}
                      onChange={handleInputChange}
                      maxLength={60}
                    />
                    <span className="ecp-char-count">{formData.seo.metaTitle.length}/60</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Meta Description</label>
                    <textarea
                      className="ecp-textarea"
                      placeholder="Product meta description"
                      name="seo.metaDescription"
                      value={formData.seo.metaDescription}
                      onChange={handleInputChange}
                      rows={3}
                      maxLength={160}
                    />
                    <span className="ecp-char-count">{formData.seo.metaDescription.length}/160</span>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Keywords</label>
                    <div className="ecp-input-with-btn">
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Add keyword"
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addKeyword}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {seoKeywords.map((keyword, idx) => (
                        <span key={idx} className="ecp-tag">
                          {keyword}
                          <button type="button" onClick={() => removeKeyword(idx)}>
                            <FiX />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Product Flags</h3>
                  
                  <div className="ecp-checkbox-grid">
                    <label className="ecp-checkbox">
                      <input
                        type="checkbox"
                        name="isFeatured"
                        checked={formData.isFeatured}
                        onChange={handleInputChange}
                      />
                      <span>Featured Product</span>
                    </label>

                    <label className="ecp-checkbox">
                      <input
                        type="checkbox"
                        name="isNewArrival"
                        checked={formData.isNewArrival}
                        onChange={handleInputChange}
                      />
                      <span>New Arrival</span>
                    </label>

                    <label className="ecp-checkbox">
                      <input
                        type="checkbox"
                        name="isBestseller"
                        checked={formData.isBestseller}
                        onChange={handleInputChange}
                      />
                      <span>Bestseller</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="ecp-actions">
              <button
                type="button"
                className="ecp-btn ecp-btn-secondary"
                onClick={(e) => handleSubmit(e, 'draft')}
                disabled={loading}
              >
                <FiSave /> Save as Draft
              </button>
              <button
                type="button"
                className="ecp-btn ecp-btn-primary"
                onClick={(e) => handleSubmit(e, 'published')}
                disabled={loading}
              >
                {loading ? 'Publishing...' : 'Publish Product'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default CreateProduct;