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
    const [image, setImage] = useState([]);
    const [imagePreview, setImagePreview] = useState([]);

    const fileInputRef = useRef(null); // To clear file input

    const categories = ['Trousers', 'Shirts', 'Shoes', 'Jackets'];

    const resetForm = () => {
        setName('');
        setPrice('');
        setDescription('');
        setStock('');
        setCategory('');
        setImage([]);
        setImagePreview([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // Clear file input
        }
    };

    const createProductSubmit = (e) => {
        e.preventDefault();

        // Optional: Basic validation
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

        image.forEach((img) => {
            myForm.append('image', img);
        });

        dispatch(createProduct(myForm));
    };

    const createProductImage = (e) => {
        const files = Array.from(e.target.files);

        if (files.length === 0) return;

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

    useEffect(() => {
        if (error) {
            toast.error(error.message || error, {
                position: 'top-center',
                autoClose: 3000,
            });
            dispatch(removeErrors());
        }

        if (success) {
            toast.success('Product created successfully!', {
                position: 'top-center',
                autoClose: 3000,
            });
            dispatch(removeSuccess());
            resetForm(); // Clean reset
        }
    }, [dispatch, error, success]);

    return (
        <>
            <PageTitle title="Create Product" />
            <Navbar />

            <div className="create-product-container">
                <h1 className="form-title">Create Product</h1>

                <form
                    className="product-form"
                    encType="multipart/form-data"
                    onSubmit={createProductSubmit}
                >
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Enter Product Name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />

                    <input
                        type="number"
                        className="form-input"
                        placeholder="Enter Product Price"
                        required
                        min="0"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                    />

                    <textarea
                        className="form-input"
                        placeholder="Enter Product Description"
                        required
                        rows="4"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    <select
                        className="form-select"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        required
                    >
                        <option value="">Choose Category</option>
                        {categories.map((item) => (
                            <option key={item} value={item}>
                                {item}
                            </option>
                        ))}
                    </select>

                    <input
                        type="number"
                        className="form-input"
                        placeholder="Enter Product Stock"
                        required
                        min="0"
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                    />

                    <div className="file-input-container">
                        <input
                            type="file"
                            className="form-input-file"
                            accept="image/*" // Fixed: was 'image/'
                            multiple
                            ref={fileInputRef}
                            onChange={createProductImage}
                        />
                    </div>

                    <div className="image-preview-container">
                        {imagePreview.map((img, index) => (
                            <img
                                src={img}
                                alt={`Preview ${index + 1}`}
                                className="image-preview"
                                key={index}
                            />
                        ))}
                    </div>

                    <button
                        type="submit"
                        className="submit-btn"
                        disabled={loading}
                    >
                        {loading ? 'Creating Product...' : 'Create Product'}
                    </button>
                </form>
            </div>

            <Footer />
        </>
    );
}

export default CreateProduct;