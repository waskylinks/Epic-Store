import React, { useEffect, useState, useMemo } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/AllOrders.css';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllOrders, updateOrder, removeErrors, removeSuccess } from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';
import { ArrowDownward, ArrowUpward, Visibility, CheckCircleOutline } from '@mui/icons-material';

function AllOrders() {
    const dispatch = useDispatch();
    const { orders, loading, error, success } = useSelector(state => state.admin);

    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('createdAt');
    const [sortDir, setSortDir] = useState('desc');
    const [page, setPage] = useState(1);
    const [perPage] = useState(10);
    const [updateModal, setUpdateModal] = useState({ open: false, order: null, loading: false });
    const [viewModal, setViewModal] = useState({ open: false, order: null });

    useEffect(() => {
        dispatch(fetchAllOrders());
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
        }
        if (success) {
            toast.success('Order updated successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setUpdateModal({ open: false, order: null, loading: false });
        }
    }, [error, success, dispatch]);

    // Filtered & Sorted Orders
    const processedOrders = useMemo(() => {
        let list = [...orders];
        
        // Search
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            list = list.filter(order => 
                order.user.name.toLowerCase().includes(lower) ||
                order._id.toLowerCase().includes(lower) ||
                order.shippingInfo.address.toLowerCase().includes(lower)
            );
        }

        // Sort
        list.sort((a, b) => {
            let valA = a[sortBy];
            let valB = b[sortBy];
            if (sortBy === 'createdAt') {
                valA = new Date(valA);
                valB = new Date(valB);
            }
            if (sortBy === 'totalPrice') {
                valA = Number(valA);
                valB = Number(valB);
            }
            return sortDir === 'asc' ? valA - valB : valB - valA;
        });

        return list;
    }, [orders, searchTerm, sortBy, sortDir]);

    // Pagination
    const paginatedOrders = processedOrders.slice((page - 1) * perPage, page * perPage);

    // Processing Orders (at top)
    const processingOrders = orders.filter(order => order.orderStatus === 'Processing');

    const handleUpdateStatus = (newStatus) => {
        if (updateModal.order) {
            setUpdateModal(prev => ({ ...prev, loading: true }));
            dispatch(updateOrder({ id: updateModal.order._id, status: newStatus }));
        }
    };

    const toggleSort = (field) => {
        if (sortBy === field) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir('desc');
        }
        setPage(1);
    };

    if (loading && orders.length === 0) return <Loader />;

    return (
        <>
            <PageTitle title="All Orders - Admin" />
            <Navbar />

            <div className="all-orders-container">
                <h1 className="all-orders-title">All Orders</h1>

                {/* Processing Orders Section */}
                {processingOrders.length > 0 && (
                    <div className="processing-orders-section">
                        <h2 className="processing-title">Processing Orders ({processingOrders.length})</h2>
                        <div className="processing-grid">
                            {processingOrders.map(order => (
                                <div key={order._id} className="processing-card">
                                    <div className="card-header">
                                        <span className="order-id">#{order._id.slice(-6)}</span>
                                        <span className="status-badge processing">Processing</span>
                                    </div>
                                    <p className="user-info">User: {order.user.name}</p>
                                    <p className="amount">${order.totalPrice}</p>
                                    <p className="date">{new Date(order.createdAt).toLocaleDateString()}</p>
                                    <div className="card-actions">
                                        <button 
                                            onClick={() => setViewModal({ open: true, order })}
                                            className="view-btn"
                                        >
                                            <Visibility fontSize="small" /> View
                                        </button>
                                        <button 
                                            onClick={() => setUpdateModal({ open: true, order, loading: false })}
                                            className="update-btn"
                                        >
                                            <CheckCircleOutline fontSize="small" /> Update Status
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Full Orders Table */}
                <div className="orders-table-section">
                    <div className="table-header">
                        <h2>All Orders ({processedOrders.length})</h2>
                        <input
                            type="text"
                            placeholder="Search orders..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input"
                        />
                    </div>

                    <div className="table-container">
                        <table className="orders-table">
                            <thead>
                                <tr>
                                    <th onClick={() => toggleSort('_id')}>
                                        Order ID {sortBy === '_id' && (sortDir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />)}
                                    </th>
                                    <th onClick={() => toggleSort('user.name')}>
                                        User {sortBy === 'user.name' && (sortDir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />)}
                                    </th>
                                    <th onClick={() => toggleSort('totalPrice')}>
                                        Amount {sortBy === 'totalPrice' && (sortDir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />)}
                                    </th>
                                    <th onClick={() => toggleSort('orderStatus')}>
                                        Status {sortBy === 'orderStatus' && (sortDir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />)}
                                    </th>
                                    <th onClick={() => toggleSort('createdAt')}>
                                        Date {sortBy === 'createdAt' && (sortDir === 'asc' ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />)}
                                    </th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedOrders.map(order => (
                                    <tr key={order._id}>
                                        <td>#{order._id.slice(-6)}</td>
                                        <td>{order.user.name}</td>
                                        <td>${order.totalPrice}</td>
                                        <td>
                                            <span className={`status-badge ${order.orderStatus.toLowerCase()}`}>
                                                {order.orderStatus}
                                            </span>
                                        </td>
                                        <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                        <td className="actions">
                                            <button 
                                                onClick={() => setViewModal({ open: true, order })}
                                                className="action-btn view"
                                            >
                                                <Visibility fontSize="small" />
                                            </button>
                                            <button 
                                                onClick={() => setUpdateModal({ open: true, order, loading: false })}
                                                className="action-btn update"
                                            >
                                                <Edit fontSize="small" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="pagination">
                        <button 
                            disabled={page === 1}
                            onClick={() => setPage(prev => prev - 1)}
                            className="pag-btn"
                        >
                            Previous
                        </button>
                        <span>Page {page} of {Math.ceil(processedOrders.length / perPage)}</span>
                        <button 
                            disabled={page >= Math.ceil(processedOrders.length / perPage)}
                            onClick={() => setPage(prev => prev + 1)}
                            className="pag-btn"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            <Footer />

            {/* View Order Modal */}
            {viewModal.open && viewModal.order && (
                <div className="modal-overlay" onClick={() => setViewModal({ open: false, order: null })}>
                    <div className="view-order-modal">
                        <h2>Order Details #{viewModal.order._id.slice(-6)}</h2>
                        <div className="view-section">
                            <h3>Customer Info</h3>
                            <p>Name: {viewModal.order.user.name}</p>
                            <p>Email: {viewModal.order.user.email}</p>
                        </div>
                        <div className="view-section">
                            <h3>Shipping</h3>
                            <p>Address: {viewModal.order.shippingInfo.address}</p>
                            <p>City: {viewModal.order.shippingInfo.city}</p>
                            <p>Phone: {viewModal.order.shippingInfo.phoneNo}</p>
                        </div>
                        <div className="view-section">
                            <h3>Order Items</h3>
                            <table className="items-table">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Qty</th>
                                        <th>Price</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {viewModal.order.orderItems.map(item => (
                                        <tr key={item.product}>
                                            <td>{item.name}</td>
                                            <td>{item.quantity}</td>
                                            <td>${item.price}</td>
                                            <td>${item.price * item.quantity}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="grand-total">Grand Total: ${viewModal.order.totalPrice}</p>
                        </div>
                        <div className="view-section">
                            <h3>Status</h3>
                            <span className={`status-badge ${viewModal.order.orderStatus.toLowerCase()}`}>
                                {viewModal.order.orderStatus}
                            </span>
                            <p>Payment: {viewModal.order.paymentInfo.status}</p>
                            <p>Ordered on: {new Date(viewModal.order.createdAt).toLocaleString()}</p>
                        </div>
                        <button 
                            onClick={() => setViewModal({ open: false, order: null })}
                            className="close-btn"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {/* Update Status Modal */}
            {updateModal.open && updateModal.order && (
                <div className="modal-overlay" onClick={() => setUpdateModal({ open: false })}>
                    <div className="update-order-modal">
                        <h2>Update Order Status</h2>
                        <p>Current Status: <span className={`status-badge ${updateModal.order.orderStatus.toLowerCase()}`}>{updateModal.order.orderStatus}</span></p>
                        <select
                            className="status-select"
                            value={updateModal.order.orderStatus}
                            onChange={(e) => handleUpdateStatus(e.target.value)}
                            disabled={updateModal.loading}
                        >
                            <option value="Processing">Processing</option>
                            <option value="Shipped">Shipped</option>
                            <option value="Delivered">Delivered</option>
                        </select>
                        <div className="modal-buttons">
                            <button onClick={() => setUpdateModal({ open: false })} className="cancel-btn" disabled={updateModal.loading}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default AllOrders;