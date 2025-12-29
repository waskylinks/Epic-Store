import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import '../AdminStyles/UpdateProduct.css';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import { useDispatch, useSelector } from 'react-redux';
import { updateProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

function UpdateProduct() {
    const { id } = useParams();
    const navigate = useNavigate();
    const dispatch = useDispatch();

    const { products, loading, error, success } = useSelector((state) => state.admin);

    // Find the product from the already-loaded products list
    const product = products.find((p) => p._id === id);

    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [description, setDescription] = useState('');
    const [stock, setStock] = useState('');
    const [category, setCategory] = useState('');
    const [oldImages, setOldImages] = useState([]);
    const [imagesToDelete, setImagesToDelete] = useState([]);
    const [newImages, setNewImages] = useState([]);
    const [newImagePreviews, setNewImagePreviews] = useState([]);

    const categories = ['Trousers', 'Shirts', 'Shoes', 'Jackets'];

    // Pre-fill form when product is found
    useEffect(() => {
        if (product) {
            setName(product.name || '');
            setPrice(product.price || '');
            setDescription(product.description || '');
            setStock(product.stock || '');
            setCategory(product.category || '');
            setOldImages(product.image || []);
        } else if (products.length > 0) {
            // If product not found, redirect (optional safety)
            toast.error('Product not found', { position: 'top-center', autoClose: 3000 });
            navigate('/admin/products');
        }
    }, [product, products, navigate]);

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

    const updateProductSubmit = (e) => {
        e.preventDefault();

        if (!category) {
            toast.error('Please select a category', { position: 'top-center', autoClose: 3000 });
            return;
        }
        if (oldImages.length + newImages.length === 0) {
            toast.error('Product must have at least one image', { position: 'top-center', autoClose: 3000 });
            return;
        }

        const myForm = new FormData();
        myForm.append('name', name);
        myForm.append('price', price);
        myForm.append('description', description);
        myForm.append('category', category);
        myForm.append('stock', stock);

        if (imagesToDelete.length > 0) {
            myForm.append('imagesToDelete', JSON.stringify(imagesToDelete));
        }

        newImages.forEach((img) => {
            myForm.append('image', img);
        });

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

    // If products not loaded yet
    if (products.length === 0) {
        return <div>Loading product...</div>;
    }

    // If product not found
    if (!product) {
        return <div>Product not found</div>;
    }

    return (
        <>
            <PageTitle title="Update Product" />
            <Navbar />

            <div className="update-product-wrapper">
                <h1 className="update-product-ti">Update Product</h1>

                <form className="update-product-form" onSubmit={updateProductSubmit}>
                    <label>Product Name</label>
                    <input
                        type="text"
                        className="update-product-input"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />

                    <label>Product Price</label>
                    <input
                        type="number"
                        className="update-product-input"
                        required
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                    />

                    <label>Product Description</label>
                    <textarea
                        className="update-product-textarea"
                        required
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    <label>Product Category</label>
                    <select
                        className="update-product-select"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        required
                    >
                        <option value="">Choose Category</option>
                        {categories.map((item) => (
                            <option key={item} value={item}>{item}</option>
                        ))}
                    </select>

                    <label>Product Stock</label>
                    <input
                        type="number"
                        className="update-product-input"
                        required
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                    />

                    <label>Add New Images</label>
                    <div className="update-product-file-wrapper">
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="update-product-file-input"
                            onChange={handleNewImages}
                        />
                    </div>

                    {/* New Images Preview */}
                    {newImagePreviews.length > 0 && (
                        <div className="update-product-preview-wrapper">
                            <p>New Images:</p>
                            {newImagePreviews.map((img, index) => (
                                <div key={index} className="image-preview-wrapper">
                                    <img src={img} alt="New" className="update-product-preview-image" />
                                    <button type="button" className="remove-image-btn" onClick={() => removeNewImage(index)}>
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Old Images */}
                    <label>Current Images (Click X to remove)</label>
                    <div className="update-product-old-images-wrapper">
                        {oldImages.map((img, index) => (
                            <div key={index} className="image-preview-wrapper">
                                <img src={img.url} alt="Current" className="update-product-old-image" />
                                <button type="button" className="remove-image-btn" onClick={() => removeOldImage(img.public_id)}>
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>

                    <button type="submit" className="update-product-submit-btn" disabled={loading}>
                        {loading ? 'Updating...' : 'Update Product'}
                    </button>
                </form>
            </div>

            <Footer />
        </>
    );
}

export default UpdateProduct;