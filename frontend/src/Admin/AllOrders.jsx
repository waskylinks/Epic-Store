import React, { useEffect, useState, useMemo } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/AllOrders.css';
import { Delete, Edit, Visibility } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllOrders, updateOrder, deleteOrder, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function AllOrders() {
    const dispatch = useDispatch();
    const { orders, loading, error, success } = useSelector(state => state.admin);

    const [searchTerm, setSearchTerm] = useState('');
    const [modal, setModal] = useState({ type: '', open: false, order: null, loading: false });

    useEffect(() => {
        dispatch(fetchAllOrders());
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setModal(prev => ({ ...prev, loading: false }));
        }
        if (success) {
            toast.success('Action completed successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setModal({ type: '', open: false, order: null, loading: false });
        }
    }, [error, success, dispatch]);

    // Enhanced search: Order ID, User Name, Email, Status
    const filteredOrders = useMemo(() => {
        if (!searchTerm.trim()) return orders;

        const lower = searchTerm.toLowerCase();
        return orders.filter(order =>
            order._id.toLowerCase().includes(lower) ||
            order.user?.name?.toLowerCase().includes(lower) ||
            order.user?.email?.toLowerCase().includes(lower) ||
            order.orderStatus.toLowerCase().includes(lower)
        );
    }, [orders, searchTerm]);

    // Sort: Processing orders first, then by date descending
    const sortedOrders = useMemo(() => {
        return [...filteredOrders].sort((a, b) => {
            if (a.orderStatus === 'Processing' && b.orderStatus !== 'Processing') return -1;
            if (a.orderStatus !== 'Processing' && b.orderStatus === 'Processing') return 1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
    }, [filteredOrders]);

    const handleAction = (type, order) => {
        setModal({ type, open: true, order, loading: false });
    };

    const executeAction = () => {
        if (!modal.order) return;
        setModal(prev => ({ ...prev, loading: true }));

        if (modal.type === 'update') {
            const status = document.getElementById('status-select').value;
            dispatch(updateOrder({ id: modal.order._id, status }));
        } else if (modal.type === 'delete') {
            dispatch(deleteOrder(modal.order._id));
        }
    };

    if (loading && orders.length === 0) return <Loader />;

    return (
        <>
            <PageTitle title="All Orders - Admin" />
            <Navbar />

            <div className="all-orders-container">
                <h1 className="all-orders-title">All Orders ({orders.length})</h1>

                {/* Search Bar */}
                <div className="search-bar">
                    <input
                        type="text"
                        placeholder="Search by Order ID, Name, Email, or Status..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                </div>

                {/* Single Unified Table with Processing at Top */}
                <div className="table-section">
                    <div className="table-container">
                        <table className="orders-table">
                            <thead>
                                <tr>
                                    <th>Order ID</th>
                                    <th>Customer</th>
                                    <th>Items</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                    <th>Date & Time</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="no-results">
                                            No orders found matching your search.
                                        </td>
                                    </tr>
                                ) : (
                                    sortedOrders.map(order => (
                                        <tr 
                                            key={order._id} 
                                            className={order.orderStatus === 'Processing' ? 'processing-row' : ''}
                                        >
                                            <td>#{order._id.slice(-8)}</td>
                                            <td>
                                                <div>
                                                    <strong>{order.user?.name || 'N/A'}</strong>
                                                    <br />
                                                    <small>{order.user?.email || ''}</small>
                                                </div>
                                            </td>
                                            <td>{order.orderItems.length}</td>
                                            <td>${order.totalPrice.toFixed(2)}</td>
                                            <td>
                                                <span className={`status-badge ${order.orderStatus.toLowerCase()}`}>
                                                    {order.orderStatus}
                                                </span>
                                            </td>
                                            <td>{new Date(order.createdAt).toLocaleString()}</td>
                                            <td className="actions">
                                                <button onClick={() => handleAction('view', order)} className="action-btn view">
                                                    <Visibility fontSize="small" />
                                                </button>
                                                <button onClick={() => handleAction('update', order)} className="action-btn update">
                                                    <Edit fontSize="small" />
                                                </button>
                                                <button onClick={() => handleAction('delete', order)} className="action-btn delete">
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

            {/* Unified Enterprise Modal */}
            {modal.open && modal.order && (
                <div className="modal-overlay" onClick={() => setModal({ type: '', open: false })}>
                    <div className="enterprise-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {modal.type === 'view' && 'Order Details'}
                                {modal.type === 'update' && 'Update Order Status'}
                                {modal.type === 'delete' && 'Delete Order'}
                            </h2>
                        </div>

                        <div className="modal-body">
                            {modal.type === 'view' && (
                                <div className="view-content">
                                    <div className="info-grid">
                                        <div>
                                            <strong>Order ID</strong>
                                            <p>#{modal.order._id}</p>
                                        </div>
                                        <div>
                                            <strong>Customer</strong>
                                            <p>{modal.order.user?.name}</p>
                                            <p>{modal.order.user?.email}</p>
                                        </div>
                                        <div>
                                            <strong>Total</strong>
                                            <p className="amount">${modal.order.totalPrice.toFixed(2)}</p>
                                        </div>
                                        <div>
                                            <strong>Status</strong>
                                            <span className={`status-badge ${modal.order.orderStatus.toLowerCase()}`}>
                                                {modal.order.orderStatus}
                                            </span>
                                        </div>
                                    </div>

                                    <h3>Order Items</h3>
                                    <div className="items-table">
                                        <div className="table-header-row">
                                            <span>Product</span>
                                            <span>Qty</span>
                                            <span>Price</span>
                                            <span>Total</span>
                                        </div>
                                        {modal.order.orderItems.map(item => (
                                            <div key={item.product} className="table-row">
                                                <span>{item.name}</span>
                                                <span>{item.quantity}</span>
                                                <span>${item.price.toFixed(2)}</span>
                                                <span>${(item.price * item.quantity).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        <div className="table-footer">
                                            <span><strong>Grand Total</strong></span>
                                            <span></span>
                                            <span></span>
                                            <span><strong>${modal.order.totalPrice.toFixed(2)}</strong></span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {modal.type === 'update' && (
                                <div className="update-content">
                                    <p className="order-summary">
                                        Order: <strong>#{modal.order._id.slice(-8)}</strong>
                                    </p>
                                    <p className="current-status">
                                        Current Status: 
                                        <span className={`status-badge ${modal.order.orderStatus.toLowerCase()}`}>
                                            {modal.order.orderStatus}
                                        </span>
                                    </p>

                                    <label className="status-label">Select New Status</label>
                                    <select id="status-select" className="status-select" defaultValue={modal.order.orderStatus}>
                                        <option value="Processing">Processing</option>
                                        <option value="Shipped">Shipped</option>
                                        <option value="Delivered">Delivered</option>
                                        <option value="Cancelled">Cancelled</option>
                                    </select>

                                    {document.getElementById('status-select')?.value === 'Cancelled' && (
                                        <p className="warning-text">
                                            Stock will be restored to inventory.
                                        </p>
                                    )}
                                </div>
                            )}

                            {modal.type === 'delete' && (
                                <div className="delete-content">
                                    <p className="warning-text">
                                        This action is permanent and cannot be undone.
                                    </p>
                                    <div className="order-summary-box">
                                        <p><strong>ID:</strong> #{modal.order._id.slice(-8)}</p>
                                        <p><strong>Customer:</strong> {modal.order.user?.name}</p>
                                        <p><strong>Total:</strong> ${modal.order.totalPrice.toFixed(2)}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button
                                onClick={() => setModal({ type: '', open: false })}
                                className="modal-btn cancel"
                                disabled={modal.loading}
                            >
                                {modal.type === 'view' ? 'Close' : 'Cancel'}
                            </button>
                            {modal.type !== 'view' && (
                                <button
                                    onClick={executeAction}
                                    className={`modal-btn confirm ${modal.type === 'delete' ? 'danger' : ''}`}
                                    disabled={modal.loading}
                                >
                                    {modal.loading ? 'Processing...' :
                                        modal.type === 'update' ? 'Update Status' :
                                        'Delete Order'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default AllOrders;