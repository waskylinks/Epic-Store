import React, { useEffect, useState, useMemo } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/AllReviews.css';
import { Delete, Visibility, Star, StarBorder } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllReviews, deleteReview, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function AllReviews() {
    const dispatch = useDispatch();
    const { reviews, loading, error, success } = useSelector(state => state.admin);

    const [searchTerm, setSearchTerm] = useState('');
    const [filterRating, setFilterRating] = useState('all');
    const [modal, setModal] = useState({ type: '', open: false, review: null, loading: false });

    useEffect(() => {
        dispatch(fetchAllReviews());
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setModal(prev => ({ ...prev, loading: false }));
        }
        if (success) {
            toast.success('Review deleted successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setModal({ type: '', open: false, review: null, loading: false });
        }
    }, [error, success, dispatch]);

    // Filter and search reviews
    const filteredReviews = useMemo(() => {
        let filtered = reviews;

        // Filter by rating
        if (filterRating !== 'all') {
            filtered = filtered.filter(review => review.rating === Number(filterRating));
        }

        // Search by product name, reviewer name, or comment
        if (searchTerm.trim()) {
            const lower = searchTerm.toLowerCase();
            filtered = filtered.filter(review =>
                review.productName?.toLowerCase().includes(lower) ||
                review.name?.toLowerCase().includes(lower) ||
                review.comment?.toLowerCase().includes(lower)
            );
        }

        return filtered;
    }, [reviews, searchTerm, filterRating]);

    // Sort by date (most recent first)
    const sortedReviews = useMemo(() => {
        return [...filteredReviews].sort((a, b) => 
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        );
    }, [filteredReviews]);

    const handleAction = (type, review) => {
        setModal({ type, open: true, review, loading: false });
    };

    const executeDelete = () => {
        if (!modal.review) return;
        setModal(prev => ({ ...prev, loading: true }));
        dispatch(deleteReview({ 
            reviewId: modal.review._id, 
            productId: modal.review.productId 
        }));
    };

    const renderStars = (rating) => {
        return [...Array(5)].map((_, index) => (
            index < rating ? 
                <Star key={index} className="star filled" /> : 
                <StarBorder key={index} className="star empty" />
        ));
    };

    if (loading && reviews.length === 0) return <Loader />;

    return (
        <>
            <PageTitle title="All Reviews - Admin" />
            <Navbar />

            <div className="all-reviews-container">
                <h1 className="all-reviews-title">All Reviews ({reviews.length})</h1>

                {/* Search and Filter Bar */}
                <div className="reviews-controls">
                    <div className="reviews-search-bar">
                        <input
                            type="text"
                            placeholder="Search by product, reviewer, or comment..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="reviews-search-input"
                        />
                    </div>
                    
                    <div className="reviews-filter">
                        <label>Filter by Rating:</label>
                        <select 
                            value={filterRating} 
                            onChange={(e) => setFilterRating(e.target.value)}
                            className="filter-select"
                        >
                            <option value="all">All Ratings</option>
                            <option value="5">5 Stars</option>
                            <option value="4">4 Stars</option>
                            <option value="3">3 Stars</option>
                            <option value="2">2 Stars</option>
                            <option value="1">1 Star</option>
                        </select>
                    </div>
                </div>

                {/* Reviews Table */}
                <div className="reviews-table-section">
                    <div className="reviews-table-container">
                        <table className="reviews-table">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Reviewer</th>
                                    <th>Rating</th>
                                    <th>Comment</th>
                                    <th>Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedReviews.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="no-results">
                                            No reviews found matching your criteria.
                                        </td>
                                    </tr>
                                ) : (
                                    sortedReviews.map(review => (
                                        <tr key={review._id}>
                                            <td>
                                                <div className="product-cell">
                                                    {review.productImage && (
                                                        <img 
                                                            src={review.productImage} 
                                                            alt={review.productName}
                                                            className="product-thumb"
                                                        />
                                                    )}
                                                    <span className="product-name">{review.productName}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <strong>{review.name || 'Anonymous'}</strong>
                                            </td>
                                            <td>
                                                <div className="rating-cell">
                                                    {renderStars(review.rating)}
                                                    <span className="rating-number">({review.rating})</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="comment-cell">
                                                    {review.comment || 'No comment'}
                                                </div>
                                            </td>
                                            <td>
                                                {review.createdAt ? 
                                                    new Date(review.createdAt).toLocaleDateString() : 
                                                    'N/A'
                                                }
                                            </td>
                                            <td className="actions">
                                                <button 
                                                    onClick={() => handleAction('view', review)} 
                                                    className="action-btn view"
                                                >
                                                    <Visibility fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('delete', review)} 
                                                    className="action-btn delete"
                                                >
                                                    <Delete fontSize="small" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <Footer />

            {/* Modal */}
            {modal.open && modal.review && (
                <div className="modal-overlay" onClick={() => setModal({ type: '', open: false, review: null })}>
                    <div className="enterprise-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {modal.type === 'view' ? 'Review Details' : 'Delete Review'}
                            </h2>
                        </div>

                        <div className="modal-body">
                            {modal.type === 'view' && (
                                <div className="view-content">
                                    <div className="review-detail-grid">
                                        <div className="detail-item">
                                            <strong>Product</strong>
                                            <p>{modal.review.productName}</p>
                                        </div>
                                        <div className="detail-item">
                                            <strong>Reviewer</strong>
                                            <p>{modal.review.name}</p>
                                        </div>
                                        <div className="detail-item">
                                            <strong>Rating</strong>
                                            <div className="rating-display">
                                                {renderStars(modal.review.rating)}
                                                <span>({modal.review.rating}/5)</span>
                                            </div>
                                        </div>
                                        <div className="detail-item">
                                            <strong>Date</strong>
                                            <p>
                                                {modal.review.createdAt ? 
                                                    new Date(modal.review.createdAt).toLocaleString() : 
                                                    'N/A'
                                                }
                                            </p>
                                        </div>
                                    </div>

                                    <div className="comment-section">
                                        <strong>Review Comment</strong>
                                        <p className="full-comment">{modal.review.comment || 'No comment provided'}</p>
                                    </div>

                                    {modal.review.productImage && (
                                        <div className="product-preview">
                                            <strong>Product Image</strong>
                                            <img 
                                                src={modal.review.productImage} 
                                                alt={modal.review.productName}
                                                className="modal-product-image"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {modal.type === 'delete' && (
                                <div className="delete-content">
                                    <p className="warning-text">
                                        This action is permanent and cannot be undone.
                                    </p>
                                    <div className="review-summary-box">
                                        <p><strong>Product:</strong> {modal.review.productName}</p>
                                        <p><strong>Reviewer:</strong> {modal.review.name}</p>
                                        <p><strong>Rating:</strong> {modal.review.rating} stars</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button
                                onClick={() => setModal({ type: '', open: false, review: null })}
                                className="modal-btn cancel"
                                disabled={modal.loading}
                            >
                                {modal.type === 'view' ? 'Close' : 'Cancel'}
                            </button>
                            {modal.type === 'delete' && (
                                <button
                                    onClick={executeDelete}
                                    className="modal-btn confirm danger"
                                    disabled={modal.loading}
                                >
                                    {modal.loading ? 'Deleting...' : 'Delete Review'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default AllReviews;