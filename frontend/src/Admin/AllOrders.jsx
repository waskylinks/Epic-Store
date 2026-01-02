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
    const [deleteModal, setDeleteModal] = useState({ open: false, order: null, loading: false });
    const [updateModal, setUpdateModal] = useState({ open: false, order: null, loading: false });
    const [viewModal, setViewModal] = useState({ open: false, order: null });

    useEffect(() => {
        dispatch(fetchAllOrders());
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setDeleteModal(prev => ({ ...prev, loading: false }));
            setUpdateModal(prev => ({ ...prev, loading: false }));
        }
        if (success) {
            toast.success('Action completed successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setDeleteModal({ open: false, order: null, loading: false });
            setUpdateModal({ open: false, order: null, loading: false });
        }
    }, [error, success, dispatch]);

    const filteredOrders = useMemo(() => {
        if (!searchTerm) return orders;
        const lower = searchTerm.toLowerCase();
        return orders.filter(order =>
            order._id.toLowerCase().includes(lower) ||
            order.user.name.toLowerCase().includes(lower)
        );
    }, [orders, searchTerm]);

    const processingOrders = orders.filter(o => o.orderStatus === 'Processing');

    const handleUpdateStatus = (status) => {
        if (updateModal.order) {
            setUpdateModal(prev => ({ ...prev, loading: true }));
            dispatch(updateOrder({ id: updateModal.order._id, status }));
        }
    };

    const handleDelete = () => {
        if (deleteModal.order) {
            setDeleteModal(prev => ({ ...prev, loading: true }));
            dispatch(deleteOrder(deleteModal.order._id));
        }
    };

    if (loading && orders.length === 0) return <Loader />;

    return (
        <>
            <PageTitle title="All Orders - Admin" />
            <Navbar />

            <div className="all-orders-container">
                <h1 className="all-orders-title">All Orders ({orders.length})</h1>

                {/* Processing Orders Highlight */}
                {processingOrders.length > 0 && (
                    <div className="processing-section">
                        <h2>Processing Orders ({processingOrders.length})</h2>
                        <div className="processing-grid">
                            {processingOrders.map(order => (
                                <div key={order._id} className="processing-card">
                                    <p><strong>Order ID:</strong> #{order._id.slice(-6)}</p>
                                    <p><strong>User:</strong> {order.user.name}</p>
                                    <p><strong>Total:</strong> ${order.totalPrice}</p>
                                    <p><strong>Date:</strong> {new Date(order.createdAt).toLocaleDateString()}</p>
                                    <div className="card-actions">
                                        <button onClick={() => setViewModal({ open: true, order })} className="view-btn">
                                            <Visibility fontSize="small" /> View
                                        </button>
                                        <button onClick={() => setUpdateModal({ open: true, order })} className="update-btn">
                                            Update Status
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="search-bar">
                    <input
                        type="text"
                        placeholder="Search by Order ID or User Name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                </div>

                {/* Orders Table */}
                <div className="table-container">
                    <table className="orders-table">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>User</th>
                                <th>Items</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.map(order => (
                                <tr key={order._id}>
                                    <td>#{order._id.slice(-6)}</td>
                                    <td>{order.user.name}</td>
                                    <td>{order.orderItems.length}</td>
                                    <td>${order.totalPrice}</td>
                                    <td>
                                        <span className={`status-badge ${order.orderStatus.toLowerCase()}`}>
                                            {order.orderStatus}
                                        </span>
                                    </td>
                                    <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                    <td className="actions">
                                        <button onClick={() => setViewModal({ open: true, order })} className="action-btn view">
                                            <Visibility fontSize="small" />
                                        </button>
                                        <button onClick={() => setUpdateModal({ open: true, order })} className="action-btn update">
                                            <Edit fontSize="small" />
                                        </button>
                                        <button onClick={() => setDeleteModal({ open: true, order })} className="action-btn delete">
                                            <Delete fontSize="small" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <Footer />

            {/* Delete Confirmation Modal */}
            {deleteModal.open && deleteModal.order && (
                <div className="modal-overlay" onClick={() => setDeleteModal({ open: false })}>
                    <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete Order</h2>
                        <p>Are you sure you want to permanently delete this order?</p>
                        <div className="order-info">
                            <p><strong>ID:</strong> #{deleteModal.order._id.slice(-6)}</p>
                            <p><strong>User:</strong> {deleteModal.order.user.name}</p>
                            <p><strong>Total:</strong> ${deleteModal.order.totalPrice}</p>
                        </div>
                        <div className="modal-buttons">
                            <button onClick={() => setDeleteModal({ open: false })} className="cancel-btn" disabled={deleteModal.loading}>
                                Cancel
                            </button>
                            <button onClick={handleDelete} className="confirm-btn" disabled={deleteModal.loading}>
                                {deleteModal.loading ? 'Deleting...' : 'Delete Order'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Update Status Modal */}
            {updateModal.open && updateModal.order && (
                <div className="modal-overlay" onClick={() => setUpdateModal({ open: false })}>
                    <div className="update-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Update Order Status</h2>
                        <p>Current: <strong>{updateModal.order.orderStatus}</strong></p>
                        <select 
                            value={updateModal.order.orderStatus} 
                            onChange={(e) => handleUpdateStatus(e.target.value)}
                            disabled={updateModal.loading}
                            className="status-select"
                        >
                            <option value="Processing">Processing</option>
                            <option value="Shipped">Shipped</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Cancelled">Cancelled</option>
                        </select>
                        <div className="modal-buttons">
                            <button onClick={() => setUpdateModal({ open: false })} className="cancel-btn" disabled={updateModal.loading}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* View Order Modal */}
            {viewModal.open && viewModal.order && (
                <div className="modal-overlay" onClick={() => setViewModal({ open: false })}>
                    <div className="view-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Order Details</h2>
                        <p><strong>ID:</strong> #{viewModal.order._id}</p>
                        <p><strong>User:</strong> {viewModal.order.user.name} ({viewModal.order.user.email})</p>
                        <p><strong>Total:</strong> ${viewModal.order.totalPrice}</p>
                        <p><strong>Status:</strong> 
                            <span className={`status-badge ${viewModal.order.orderStatus.toLowerCase()}`}>
                                {viewModal.order.orderStatus}
                            </span>
                        </p>
                        <p><strong>Date:</strong> {new Date(viewModal.order.createdAt).toLocaleString()}</p>
                        <h3>Items:</h3>
                        <ul>
                            {viewModal.order.orderItems.map(item => (
                                <li key={item.product}>
                                    {item.name} × {item.quantity} = ${item.price * item.quantity}
                                </li>
                            ))}
                        </ul>
                        <button onClick={() => setViewModal({ open: false })} className="close-btn">
                            Close
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

export default AllOrders;