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
  FiEye, FiAlertCircle, FiCheck, FiFlag
} from 'react-icons/fi';

function CreateProduct() {
  const { success, loading, error } = useSelector((state) => state.admin);
  const dispatch = useDispatch();

  const [activeTab, setActiveTab] = useState('basic');
  const [images, setImages] = useState([]);
  const [imagePreview, setImagePreview] = useState([]);

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
    isNewArrival: true,
    isBestseller: false
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

  // Handle input changes (supports nested dot-notation names)
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
          setImagePreview(old => [...old, reader.result]);
          setImages(old => [...old, file]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages(old => old.filter((_, i) => i !== index));
    setImagePreview(old => old.filter((_, i) => i !== index));
  };

  const setPrimaryImage = (index) => {
    if (index === 0) return;
    const newImages = [...images];
    const newPreviews = [...imagePreview];
    [newImages[0], newImages[index]] = [newImages[index], newImages[0]];
    [newPreviews[0], newPreviews[index]] = [newPreviews[index], newPreviews[0]];
    setImages(newImages);
    setImagePreview(newPreviews);
  };

  // Subcategories
  const addSubcategory = () => {
    if (newSubcategory.trim()) {
      setSubcategories(prev => [...prev, newSubcategory.trim()]);
      setNewSubcategory('');
    }
  };
  const removeSubcategory = (index) => setSubcategories(prev => prev.filter((_, i) => i !== index));

  // Tags
  const addTag = () => {
    if (newTag.trim()) {
      setTags(prev => [...prev, newTag.trim().toLowerCase()]);
      setNewTag('');
    }
  };
  const removeTag = (index) => setTags(prev => prev.filter((_, i) => i !== index));

  // SEO keywords
  const addKeyword = () => {
    if (newKeyword.trim()) {
      setSeoKeywords(prev => [...prev, newKeyword.trim()]);
      setNewKeyword('');
    }
  };
  const removeKeyword = (index) => setSeoKeywords(prev => prev.filter((_, i) => i !== index));

  // Related search terms
  const addRelatedTerm = () => {
    if (newRelatedTerm.trim()) {
      setRelatedSearchTerms(prev => [...prev, newRelatedTerm.trim().toLowerCase()]);
      setNewRelatedTerm('');
    }
  };
  const removeRelatedTerm = (index) => setRelatedSearchTerms(prev => prev.filter((_, i) => i !== index));

  // Breadcrumbs
  const addBreadcrumb = () => {
    if (newBreadcrumb.name.trim() && newBreadcrumb.url.trim()) {
      setBreadcrumbs(prev => [...prev, {
        name: newBreadcrumb.name.trim(),
        url: newBreadcrumb.url.trim(),
        position: prev.length + 1
      }]);
      setNewBreadcrumb({ name: '', url: '' });
    }
  };
  const removeBreadcrumb = (index) => {
    setBreadcrumbs(prev => prev.filter((_, i) => i !== index).map((item, idx) => ({
      ...item,
      position: idx + 1
    })));
  };

  // Specifications
  const addSpecification = () => setSpecifications(prev => [...prev, { key: '', value: '' }]);
  const updateSpecification = (index, field, value) => {
    setSpecifications(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };
  const removeSpecification = (index) => setSpecifications(prev => prev.filter((_, i) => i !== index));

  // Variants
  const addVariant = () => {
    setVariants(prev => [...prev, { name: '', options: [{ value: '', priceModifier: 0, stock: 0 }] }]);
  };
  const updateVariantName = (index, name) => {
    setVariants(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], name };
      return updated;
    });
  };
  const addVariantOption = (variantIndex) => {
    setVariants(prev => {
      const updated = [...prev];
      updated[variantIndex] = {
        ...updated[variantIndex],
        options: [...updated[variantIndex].options, { value: '', priceModifier: 0, stock: 0 }]
      };
      return updated;
    });
  };
  const updateVariantOption = (variantIndex, optionIndex, field, value) => {
    setVariants(prev => {
      const updated = [...prev];
      const options = [...updated[variantIndex].options];
      options[optionIndex] = { ...options[optionIndex], [field]: value };
      updated[variantIndex] = { ...updated[variantIndex], options };
      return updated;
    });
  };
  const removeVariantOption = (variantIndex, optionIndex) => {
    setVariants(prev => {
      const updated = [...prev];
      updated[variantIndex] = {
        ...updated[variantIndex],
        options: updated[variantIndex].options.filter((_, i) => i !== optionIndex)
      };
      return updated;
    });
  };
  const removeVariant = (index) => setVariants(prev => prev.filter((_, i) => i !== index));

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

  // Form submission
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
    if (!formData.brand.trim()) {
      toast.error('Please enter brand name');
      setActiveTab('basic');
      return;
    }
    if (!formData.description.trim()) {
      toast.error('Please enter product description');
      setActiveTab('basic');
      return;
    }
    if (!formData.shortDescription.trim()) {
      toast.error('Please enter short description');
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
    if (!formData.pricing.cost) {
      toast.error('Please enter cost price');
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

    // Inventory validation
    if (formData.inventory.stock === '') {
      toast.error('Please enter stock quantity');
      setActiveTab('inventory');
      return;
    }
    if (!formData.inventory.sku.trim()) {
      toast.error('Please enter SKU');
      setActiveTab('inventory');
      return;
    }

    // Media validation
    if (images.length === 0) {
      toast.error('Please upload at least one product image');
      setActiveTab('media');
      return;
    }

    // Build FormData
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
      cost: Number(formData.pricing.cost),
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
      stock: Number(formData.inventory.stock),
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
    myForm.append('status', publishStatus || 'published');

    // Images - CRITICAL FIX: Use 'images' not 'image'
    images.forEach((img) => myForm.append('images', img));

    dispatch(createProduct(myForm));
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      shortDescription: '',
      category: '',
      brand: '',
      manufacturer: '',
      pricing: { regular: '', sale: '', cost: '', currency: 'USD', validFrom: '', validThrough: '' },
      inventory: {
        stock: '',
        sku: '',
        barcode: '',
        gtin: '',
        mpn: '',
        trackInventory: true,
        lowStockThreshold: 5
      },
      dimensions: { length: '', width: '', height: '', unit: 'cm' },
      weight: { value: '', unit: 'kg' },
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
      isNewArrival: true,
      isBestseller: false
    });
    setImages([]);
    setImagePreview([]);
    setSubcategories([]);
    setTags([]);
    setSpecifications([]);
    setVariants([]);
    setSeoKeywords([]);
    setRelatedSearchTerms([]);
    setBreadcrumbs([]);
    setRichSnippets({ faqs: [], howTo: { name: '', steps: [] }, videos: [] });
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
    { id: 'advanced', label: 'Advanced SEO', icon: <FiTag /> },
    { id: 'settings', label: 'Settings', icon: <FiFlag /> }
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
            <button type="button" className="ecp-btn ecp-btn-secondary" onClick={resetForm}>
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
                type="button"
                className={`ecp-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="ecp-form">
            {/* ── Basic Info ─────────────────────────────────────── */}
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
                      >
                        <option value="">Select Category</option>
                        {categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label required">Brand</label>
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
                    <label className="ecp-label">Manufacturer</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="Enter manufacturer name"
                      name="manufacturer"
                      value={formData.manufacturer}
                      onChange={handleInputChange}
                    />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label required">Short Description</label>
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
                        onChange={e => setNewSubcategory(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addSubcategory())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addSubcategory}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {subcategories.map((sub, idx) => (
                        <span key={idx} className="ecp-tag">
                          {sub}
                          <button type="button" onClick={() => removeSubcategory(idx)}><FiX /></button>
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
                        onChange={e => setNewTag(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addTag}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {tags.map((tag, idx) => (
                        <span key={idx} className="ecp-tag">
                          {tag}
                          <button type="button" onClick={() => removeTag(idx)}><FiX /></button>
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
                          onChange={e => updateSpecification(idx, 'key', e.target.value)}
                        />
                        <input
                          type="text"
                          className="ecp-input"
                          placeholder="Value (e.g., Cotton)"
                          value={spec.value}
                          onChange={e => updateSpecification(idx, 'value', e.target.value)}
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

                  {/* Breadcrumbs */}
                  <div className="ecp-form-group">
                    <div className="ecp-label-with-btn">
                      <label className="ecp-label">Breadcrumbs (SEO)</label>
                      <button
                        type="button"
                        className="ecp-btn-small"
                        onClick={addBreadcrumb}
                        disabled={!newBreadcrumb.name || !newBreadcrumb.url}
                      >
                        <FiPlus /> Add
                      </button>
                    </div>
                    <div className="ecp-spec-row">
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Name (e.g., Home)"
                        value={newBreadcrumb.name}
                        onChange={e => setNewBreadcrumb(prev => ({ ...prev, name: e.target.value }))}
                      />
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="URL (e.g., /)"
                        value={newBreadcrumb.url}
                        onChange={e => setNewBreadcrumb(prev => ({ ...prev, url: e.target.value }))}
                      />
                    </div>
                    <div className="ecp-tags">
                      {breadcrumbs.map((breadcrumb, idx) => (
                        <span key={idx} className="ecp-tag">
                          {breadcrumb.position}. {breadcrumb.name}
                          <button type="button" onClick={() => removeBreadcrumb(idx)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Pricing ────────────────────────────────────────── */}
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

                  {formData.pricing.regular !== '' && formData.pricing.sale !== '' &&
                    Number(formData.pricing.sale) < Number(formData.pricing.regular) && (
                    <div className="ecp-discount-preview">
                      <FiCheck className="ecp-discount-icon" />
                      <span>
                        Discount: {Math.round(
                          ((Number(formData.pricing.regular) - Number(formData.pricing.sale)) /
                            Number(formData.pricing.regular)) * 100
                        )}% off
                      </span>
                    </div>
                  )}

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label required">Cost Price</label>
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

                  {/* Price Validity Period */}
                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Price Valid From</label>
                      <input
                        type="date"
                        className="ecp-input"
                        name="pricing.validFrom"
                        value={formData.pricing.validFrom}
                        onChange={handleInputChange}
                      />
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label">Price Valid Through</label>
                      <input
                        type="date"
                        className="ecp-input"
                        name="pricing.validThrough"
                        value={formData.pricing.validThrough}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>

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
                    <label className="ecp-label">Dimensions (L × W × H)</label>
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

            {/* ── Inventory ──────────────────────────────────────── */}
            {activeTab === 'inventory' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Inventory Management</h3>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label required">Stock Quantity</label>
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
                      <label className="ecp-label required">SKU</label>
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

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">GTIN (Google Shopping)</label>
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Global Trade Item Number"
                        name="inventory.gtin"
                        value={formData.inventory.gtin}
                        onChange={handleInputChange}
                      />
                      <small className="ecp-help-text">UPC, EAN, JAN, ISBN, or ITF-14</small>
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label">MPN</label>
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Manufacturer Part Number"
                        name="inventory.mpn"
                        value={formData.inventory.mpn}
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

            {/* ── Media ──────────────────────────────────────────── */}
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
                    <>
                      <div className="ecp-info-box" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                        <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                        <span>The first image will be used as the primary product image</span>
                      </div>
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
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Variants ───────────────────────────────────────── */}
            {activeTab === 'variants' && (
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <div className="ecp-label-with-btn">
                    <h3 className="ecp-section-title">Product Variants (Optional)</h3>
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
                          onChange={e => updateVariantName(vIdx, e.target.value)}
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
                              onChange={e => updateVariantOption(vIdx, oIdx, 'value', e.target.value)}
                            />
                            <input
                              type="number"
                              className="ecp-input"
                              placeholder="Price +"
                              value={option.priceModifier}
                              onChange={e => updateVariantOption(vIdx, oIdx, 'priceModifier', Number(e.target.value))}
                              step="0.01"
                            />
                            <input
                              type="number"
                              className="ecp-input"
                              placeholder="Stock"
                              value={option.stock}
                              onChange={e => updateVariantOption(vIdx, oIdx, 'stock', Number(e.target.value))}
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

                  {variants.length === 0 && (
                    <div className="ecp-info-box">
                      <FiAlertCircle style={{ marginRight: '0.5rem' }} />
                      <span>Add variants if your product comes in different sizes, colors, or styles</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── SEO (Basic) ────────────────────────────────────── */}
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
                      placeholder="Product meta description (120-160 characters recommended)"
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
                        onChange={e => setNewKeyword(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addKeyword}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {seoKeywords.map((keyword, idx) => (
                        <span key={idx} className="ecp-tag">
                          {keyword}
                          <button type="button" onClick={() => removeKeyword(idx)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Canonical URL</label>
                    <input
                      type="url"
                      className="ecp-input"
                      placeholder="https://example.com/products/product-name"
                      name="seo.canonicalUrl"
                      value={formData.seo.canonicalUrl}
                      onChange={handleInputChange}
                    />
                    <small className="ecp-help-text">Specify the preferred URL for this product</small>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Focus Keyphrase</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="Main keyphrase for SEO optimization"
                      name="seo.focusKeyphrase"
                      value={formData.seo.focusKeyphrase}
                      onChange={handleInputChange}
                    />
                  </div>

                  <div className="ecp-form-row">
                    <div className="ecp-form-group">
                      <label className="ecp-label">Schema Type</label>
                      <select
                        className="ecp-select"
                        name="seo.schemaType"
                        value={formData.seo.schemaType}
                        onChange={handleInputChange}
                      >
                        {schemaTypes.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>

                    <div className="ecp-form-group">
                      <label className="ecp-label">Condition</label>
                      <select
                        className="ecp-select"
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

                  <div className="ecp-checkbox-grid">
                    <label className="ecp-checkbox">
                      <input
                        type="checkbox"
                        name="seo.noIndex"
                        checked={formData.seo.noIndex}
                        onChange={handleInputChange}
                      />
                      <span>No Index (Hide from search engines)</span>
                    </label>

                    <label className="ecp-checkbox">
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
                  <div className="ecp-form-group" style={{ marginTop: '2rem' }}>
                    <label className="ecp-label">Related Search Terms</label>
                    <div className="ecp-input-with-btn">
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Add related search term"
                        value={newRelatedTerm}
                        onChange={e => setNewRelatedTerm(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addRelatedTerm())}
                      />
                      <button type="button" className="ecp-btn-icon" onClick={addRelatedTerm}>
                        <FiPlus />
                      </button>
                    </div>
                    <div className="ecp-tags">
                      {relatedSearchTerms.map((term, idx) => (
                        <span key={idx} className="ecp-tag">
                          {term}
                          <button type="button" onClick={() => removeRelatedTerm(idx)}><FiX /></button>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Rich Snippets - FAQs */}
                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Rich Snippets - FAQs</h3>
                  <div className="ecp-label-with-btn">
                    <label className="ecp-label">Frequently Asked Questions</label>
                    <button type="button" className="ecp-btn-small" onClick={addFAQ}>
                      <FiPlus /> Add FAQ
                    </button>
                  </div>

                  {richSnippets.faqs.map((faq, idx) => (
                    <div key={idx} className="ecp-faq-card">
                      <div className="ecp-faq-header">
                        <input
                          type="text"
                          className="ecp-input"
                          placeholder="Question"
                          value={faq.question}
                          onChange={e => updateFAQ(idx, 'question', e.target.value)}
                          maxLength={200}
                        />
                        <button
                          type="button"
                          className="ecp-btn-icon-danger"
                          onClick={() => removeFAQ(idx)}
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                      <textarea
                        className="ecp-textarea"
                        placeholder="Answer"
                        value={faq.answer}
                        onChange={e => updateFAQ(idx, 'answer', e.target.value)}
                        rows={3}
                        maxLength={1000}
                      />
                    </div>
                  ))}

                  {/* Rich Snippets - Videos */}
                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Rich Snippets - Videos</h3>
                  <div className="ecp-label-with-btn">
                    <label className="ecp-label">Product Videos</label>
                    <button type="button" className="ecp-btn-small" onClick={addVideo}>
                      <FiPlus /> Add Video
                    </button>
                  </div>

                  {richSnippets.videos.map((video, idx) => (
                    <div key={idx} className="ecp-video-card">
                      <div className="ecp-video-header">
                        <input
                          type="text"
                          className="ecp-input"
                          placeholder="Video Name"
                          value={video.name}
                          onChange={e => updateVideo(idx, 'name', e.target.value)}
                        />
                        <button
                          type="button"
                          className="ecp-btn-icon-danger"
                          onClick={() => removeVideo(idx)}
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="ecp-input"
                        placeholder="Description"
                        value={video.description}
                        onChange={e => updateVideo(idx, 'description', e.target.value)}
                        style={{ marginTop: '0.5rem' }}
                      />
                      <input
                        type="url"
                        className="ecp-input"
                        placeholder="Content URL"
                        value={video.contentUrl}
                        onChange={e => updateVideo(idx, 'contentUrl', e.target.value)}
                        style={{ marginTop: '0.5rem' }}
                      />
                      <input
                        type="url"
                        className="ecp-input"
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
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Open Graph (Facebook)</h3>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Title</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="Title for social sharing"
                      name="seo.ogTitle"
                      value={formData.seo.ogTitle}
                      onChange={handleInputChange}
                      maxLength={60}
                    />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Description</label>
                    <textarea
                      className="ecp-textarea"
                      placeholder="Description for social sharing"
                      name="seo.ogDescription"
                      value={formData.seo.ogDescription}
                      onChange={handleInputChange}
                      rows={3}
                      maxLength={160}
                    />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Image URL</label>
                    <input
                      type="url"
                      className="ecp-input"
                      placeholder="https://example.com/image.jpg"
                      name="seo.ogImage"
                      value={formData.seo.ogImage}
                      onChange={handleInputChange}
                    />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">OG Type</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="product"
                      name="seo.ogType"
                      value={formData.seo.ogType}
                      onChange={handleInputChange}
                    />
                  </div>

                  <h3 className="ecp-section-title" style={{ marginTop: '2rem' }}>Twitter Card</h3>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Card Type</label>
                    <select
                      className="ecp-select"
                      name="seo.twitterCard"
                      value={formData.seo.twitterCard}
                      onChange={handleInputChange}
                    >
                      {twitterCardTypes.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Twitter Title</label>
                    <input
                      type="text"
                      className="ecp-input"
                      placeholder="Title for Twitter"
                      name="seo.twitterTitle"
                      value={formData.seo.twitterTitle}
                      onChange={handleInputChange}
                      maxLength={70}
                    />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Twitter Description</label>
                    <textarea
                      className="ecp-textarea"
                      placeholder="Description for Twitter"
                      name="seo.twitterDescription"
                      value={formData.seo.twitterDescription}
                      onChange={handleInputChange}
                      rows={3}
                      maxLength={200}
                    />
                  </div>

                  <div className="ecp-form-group">
                    <label className="ecp-label">Twitter Image URL</label>
                    <input
                      type="url"
                      className="ecp-input"
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
              <div className="ecp-tab-content">
                <div className="ecp-section">
                  <h3 className="ecp-section-title">Product Flags</h3>
                  <p className="ecp-help-text" style={{ marginBottom: '1.5rem' }}>
                    These flags control how the product appears in storefront sections and promotions.
                  </p>

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
                onClick={e => handleSubmit(e, 'draft')}
                disabled={loading}
              >
                <FiSave /> Save as Draft
              </button>
              <button
                type="button"
                className="ecp-btn ecp-btn-primary"
                onClick={e => handleSubmit(e, 'published')}
                disabled={loading}
              >
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