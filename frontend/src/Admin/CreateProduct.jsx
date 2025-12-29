import React, { useEffect, useState, useRef } from 'react';
import PageTitle from '../components/PageTitle';
import '../AdminStyles/CreateProduct.css';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { createProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';

function CreateProduct() {
    const { success, loading, error } = useSelector((state) => state.admin);
    const dispatch = useDispatch();

    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [description, setDescription] = useState('');
    const [stock, setStock] = useState('');
    const [category, setCategory] = useState('');
    const [image, setImage] = useState([]);           // actual File objects
    const [imagePreview, setImagePreview] = useState([]); // data URLs for preview

    const fileInputRef = useRef(null);

    const categories = ['Trousers', 'Shirts', 'Shoes', 'Jackets'];

    const resetForm = () => {
        setName('');
        setPrice('');
        setDescription('');
        setStock('');
        setCategory('');
        setImage([]);
        setImagePreview([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const createProductSubmit = (e) => {
        e.preventDefault();

        if (!category) {
            toast.error('Please select a category');
            return;
        }
        if (image.length === 0) {
            toast.error('Please upload at least one image');
            return;
        }

        const myForm = new FormData();
        myForm.append('name', name);
        myForm.append('price', price);
        myForm.append('description', description);
        myForm.append('category', category);
        myForm.append('stock', stock);

        image.forEach((img) => myForm.append('image', img));

        dispatch(createProduct(myForm));
    };

    const createProductImage = (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        // Reset previous selection
        setImage([]);
        setImagePreview([]);

        files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.readyState === 2) {
                    setImagePreview((old) => [...old, reader.result]);
                    setImage((old) => [...old, file]);
                }
            };
            reader.readAsDataURL(file);
        });
    };

    // Remove specific image from selection
    const removeImage = (index) => {
        setImage((old) => old.filter((_, i) => i !== index));
        setImagePreview((old) => old.filter((_, i) => i !== index));
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

    return (
        <>
            <PageTitle title="Create Product" />
            <Navbar />

            <div className="create-product-container">
                <h1 className="form-title">Create Product</h1>

                <form className="product-form" encType="multipart/form-data" onSubmit={createProductSubmit}>
                    <input type="text" className="form-input" placeholder="Enter Product Name" required value={name} onChange={(e) => setName(e.target.value)} />

                    <input type="number" className="form-input" placeholder="Enter Product Price" required min="0" value={price} onChange={(e) => setPrice(e.target.value)} />

                    <textarea className="form-input" placeholder="Enter Product Description" required rows="4" value={description} onChange={(e) => setDescription(e.target.value)} />

                    <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)} required>
                        <option value="">Choose Category</option>
                        {categories.map((item) => (
                            <option key={item} value={item}>{item}</option>
                        ))}
                    </select>

                    <input type="number" className="form-input" placeholder="Enter Product Stock" required min="0" value={stock} onChange={(e) => setStock(e.target.value)} />

                    <div className="file-input-container">
                        <input
                            type="file"
                            className="form-input-file"
                            accept="image/*"
                            multiple
                            ref={fileInputRef}
                            onChange={createProductImage}
                        />
                    </div>

                    <div className="image-preview-container">
                        {imagePreview.map((img, index) => (
                            <div key={index} className="image-preview-wrapper">
                                <img src={img} alt={`Preview ${index + 1}`} className="image-preview" />
                                <button
                                    type="button"
                                    className="remove-image-btn"
                                    onClick={() => removeImage(index)}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>

                    <button type="submit" className="submit-btn" disabled={loading}>
                        {loading ? 'Creating Product...' : 'Create Product'}
                    </button>
                </form>
            </div>

            <Footer />
        </>
    );
}

export default CreateProduct;