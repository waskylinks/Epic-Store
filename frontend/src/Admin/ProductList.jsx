import React, { useEffect, useState } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/ProductsList.css';
import { Link } from 'react-router-dom';
import { Delete, Edit } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdminProducts, deleteProduct, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function ProductList() {
    const { products, loading, error, success } = useSelector(state => state.admin);
    const dispatch = useDispatch();

    // Modal state
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [productToDelete, setProductToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false); // ← NEW: track deletion in progress

    useEffect(() => {
        dispatch(fetchAdminProducts());
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setDeleting(false); // Allow retry if error
        }
        if (success) {
            toast.success('Product deleted successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setDeleteModalOpen(false);
            setProductToDelete(null);
            setDeleting(false);
        }
    }, [error, success, dispatch]);

    const openDeleteModal = (product) => {
        setProductToDelete(product);
        setDeleteModalOpen(true);
        setDeleting(false); // Reset deleting state
    };

    const closeDeleteModal = () => {
        if (deleting) return; // Prevent closing during deletion
        setDeleteModalOpen(false);
        setProductToDelete(null);
    };

    const confirmDelete = () => {
        if (!productToDelete || deleting) return;
        setDeleting(true);
        dispatch(deleteProduct(productToDelete._id));
    };

    if (!products || products.length === 0) {
        return (
            <div className="product-list-container">
                <Loader type='classic'/>
                <h2>No Products Found</h2>
            </div>
        );
    }

    return (
        <>
            {loading ? (
                <Loader />
            ) : (
                <>
                    <PageTitle title='Admin Products'/>
                    <Navbar />

                    <div className="product-list-container">
                        <h1 className="product-list-title">
                            All Products
                        </h1>
                        <table className="product-table">
                            <thead>
                                <tr>
                                    <th>S1 NO</th>
                                    <th>Product Image</th>
                                    <th>Product Name</th>
                                    <th>Price</th>
                                    <th>Ratings</th>
                                    <th>Category</th>
                                    <th>Stock</th>
                                    <th>Created At</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((product, index) => (
                                    <tr key={product._id}>
                                        <td>{index + 1}</td>
                                        <td>
                                            <img src={product.image[0].url} alt={product.name} className='admin-product-image'/>
                                        </td>
                                        <td>{product.name}</td>
                                        <td>{product.price}</td>
                                        <td>{product.ratings}</td>
                                        <td>{product.category}</td>
                                        <td>{product.stock}</td>
                                        <td>{new Date(product.createdAt).toLocaleString()}</td>
                                        <td>
                                            <Link 
                                                to={`/admin/product/${product._id}`}
                                                className='edit-icon'
                                            >
                                                <Edit />
                                            </Link>
                                            <button
                                                onClick={() => openDeleteModal(product)}
                                                className='delete-icon'
                                            >
                                                <Delete />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <Footer />
                </>
            )}

            {/* Delete Confirmation Modal */}
            {deleteModalOpen && (
                <div className="delete-modal-overlay" onClick={closeDeleteModal}>
                    <div className="delete-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>Confirm Delete</h2>
                        <p>Are you sure you want to permanently delete this product?</p>
                        {productToDelete && (
                            <div className="delete-modal-product">
                                <img
                                    src={productToDelete.image[0]?.url}
                                    alt={productToDelete.name}
                                    className="delete-modal-image"
                                />
                                <h3>{productToDelete.name}</h3>
                                <p>Price: ${productToDelete.price} | Stock: {productToDelete.stock}</p>
                            </div>
                        )}
                        <div className="delete-modal-buttons">
                            <button 
                                onClick={closeDeleteModal} 
                                className="delete-modal-cancel"
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmDelete} 
                                className="delete-modal-confirm"
                                disabled={deleting}
                            >
                                {deleting ? 'Deleting...' : 'Delete Product'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default ProductList;