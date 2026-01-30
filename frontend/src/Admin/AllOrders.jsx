import React, { useEffect, useState, useMemo } from 'react';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../AdminStyles/AllOrders.css';
import { 
    Delete, Edit, Visibility, Message, LocalShipping, 
    Cancel, AttachMoney, Assessment, History, Block 
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { 
    fetchAllOrders, 
    updateOrder, 
    deleteOrder, 
    cancelOrderWithRefund,
    addOrderMessage,
    getOrderMessages,
    addTrackingInfo,
    getOrderAuditLog,
    removeErrors, 
    removeSuccess 
} from '../features/admin/adminSlice';
import { toast } from 'react-toastify';
import Loader from '../components/Loader';

function AllOrders() {
    const dispatch = useDispatch();
    const { orders, loading, error, success, orderMessages, auditLog, messageLoading } = useSelector(state => state.admin);

    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [modal, setModal] = useState({ 
        type: '', 
        open: false, 
        order: null, 
        loading: false 
    });

    // Form states for different modals
    const [cancelForm, setCancelForm] = useState({ reason: '', skipRefund: false });
    const [messageForm, setMessageForm] = useState({ content: '', attachments: [] });
    const [trackingForm, setTrackingForm] = useState({
        carrier: '',
        trackingNumber: '',
        estimatedDelivery: ''
    });

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
            // Reset forms
            setCancelForm({ reason: '', skipRefund: false });
            setMessageForm({ content: '', attachments: [] });
            setTrackingForm({ carrier: '', trackingNumber: '', estimatedDelivery: '' });
        }
    }, [error, success, dispatch]);

    // Enhanced search with status filter
    const filteredOrders = useMemo(() => {
        let filtered = orders;

        // Status filter
        if (statusFilter !== 'all') {
            filtered = filtered.filter(order => 
                order.orderStatus.toLowerCase() === statusFilter.toLowerCase()
            );
        }

        // Search filter
        if (!searchTerm.trim()) return filtered;

        const lower = searchTerm.toLowerCase();
        return filtered.filter(order =>
            order._id.toLowerCase().includes(lower) ||
            order.user?.name?.toLowerCase().includes(lower) ||
            order.user?.email?.toLowerCase().includes(lower) ||
            order.orderStatus.toLowerCase().includes(lower)
        );
    }, [orders, searchTerm, statusFilter]);

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
        
        // Load additional data for specific modals
        if (type === 'messages') {
            dispatch(getOrderMessages(order._id));
        } else if (type === 'audit') {
            dispatch(getOrderAuditLog(order._id));
        }
    };

    const executeAction = () => {
        if (!modal.order) return;
        setModal(prev => ({ ...prev, loading: true }));

        switch (modal.type) {
            case 'update':
                const status = document.getElementById('status-select').value;
                dispatch(updateOrder({ id: modal.order._id, status }));
                break;
                
            case 'delete':
                dispatch(deleteOrder(modal.order._id));
                break;
                
            case 'cancel':
                dispatch(cancelOrderWithRefund({
                    orderId: modal.order._id,
                    reason: cancelForm.reason,
                    skipRefund: cancelForm.skipRefund
                }));
                break;
                
            case 'tracking':
                dispatch(addTrackingInfo({
                    orderId: modal.order._id,
                    ...trackingForm
                }));
                break;
                
            case 'send-message':
                dispatch(addOrderMessage({
                    orderId: modal.order._id,
                    content: messageForm.content,
                    attachments: messageForm.attachments
                }));
                break;
                
            default:
                setModal(prev => ({ ...prev, loading: false }));
        }
    };

    const getStatusCounts = () => {
        return {
            all: orders.length,
            processing: orders.filter(o => o.orderStatus === 'Processing').length,
            shipped: orders.filter(o => o.orderStatus === 'Shipped').length,
            delivered: orders.filter(o => o.orderStatus === 'Delivered').length,
            cancelled: orders.filter(o => o.orderStatus === 'Cancelled').length,
        };
    };

    const statusCounts = getStatusCounts();

    if (loading && orders.length === 0) return <Loader />;

    return (
        <>
            <PageTitle title="All Orders - Admin" />
            <Navbar />

            <div className="all-orders-container">
                <div className="orders-header">
                    <h1 className="all-orders-title">All Orders ({orders.length})</h1>
                    
                    {/* Status Filter Pills */}
                    <div className="status-filters">
                        <button 
                            className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('all')}
                        >
                            All ({statusCounts.all})
                        </button>
                        <button 
                            className={`filter-pill ${statusFilter === 'processing' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('processing')}
                        >
                            Processing ({statusCounts.processing})
                        </button>
                        <button 
                            className={`filter-pill ${statusFilter === 'shipped' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('shipped')}
                        >
                            Shipped ({statusCounts.shipped})
                        </button>
                        <button 
                            className={`filter-pill ${statusFilter === 'delivered' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('delivered')}
                        >
                            Delivered ({statusCounts.delivered})
                        </button>
                        <button 
                            className={`filter-pill ${statusFilter === 'cancelled' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('cancelled')}
                        >
                            Cancelled ({statusCounts.cancelled})
                        </button>
                    </div>
                </div>

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

                {/* Orders Table */}
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
                                            No orders found matching your criteria.
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
                                            <td>{order.orderItems?.length || 0}</td>
                                            <td>${order.totalPrice?.toFixed(2) || '0.00'}</td>
                                            <td>
                                                <span className={`status-badge ${order.orderStatus.toLowerCase()}`}>
                                                    {order.orderStatus}
                                                </span>
                                            </td>
                                            <td>{new Date(order.createdAt).toLocaleString()}</td>
                                            <td className="actions">
                                                <button 
                                                    onClick={() => handleAction('view', order)} 
                                                    className="action-btn view"
                                                    title="View Details"
                                                >
                                                    <Visibility fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('update', order)} 
                                                    className="action-btn update"
                                                    title="Update Status"
                                                >
                                                    <Edit fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('messages', order)} 
                                                    className="action-btn message"
                                                    title="Messages"
                                                >
                                                    <Message fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('tracking', order)} 
                                                    className="action-btn tracking"
                                                    title="Add Tracking"
                                                >
                                                    <LocalShipping fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('cancel', order)} 
                                                    className="action-btn cancel"
                                                    title="Cancel Order"
                                                    disabled={order.orderStatus === 'Cancelled' || order.orderStatus === 'Delivered'}
                                                >
                                                    <Cancel fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('audit', order)} 
                                                    className="action-btn audit"
                                                    title="Audit Log"
                                                >
                                                    <History fontSize="small" />
                                                </button>
                                                <button 
                                                    onClick={() => handleAction('delete', order)} 
                                                    className="action-btn delete"
                                                    title="Delete Order"
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

            {/* Unified Modal System */}
            {modal.open && modal.order && (
                <div className="modal-overlay" onClick={() => !modal.loading && setModal({ type: '', open: false, order: null })}>
                    <div className="enterprise-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {modal.type === 'view' && 'Order Details'}
                                {modal.type === 'update' && 'Update Order Status'}
                                {modal.type === 'delete' && 'Delete Order'}
                                {modal.type === 'cancel' && 'Cancel Order'}
                                {modal.type === 'messages' && 'Order Messages'}
                                {modal.type === 'send-message' && 'Send Message'}
                                {modal.type === 'tracking' && 'Add Tracking Information'}
                                {modal.type === 'audit' && 'Order Audit Log'}
                            </h2>
                        </div>

                        <div className="modal-body">
                            {/* VIEW MODAL */}
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
                                            <p className="amount">${modal.order.totalPrice?.toFixed(2)}</p>
                                        </div>
                                        <div>
                                            <strong>Status</strong>
                                            <span className={`status-badge ${modal.order.orderStatus.toLowerCase()}`}>
                                                {modal.order.orderStatus}
                                            </span>
                                        </div>
                                    </div>

                                    {modal.order.shippingInfo && (
                                        <>
                                            <h3>Shipping Address</h3>
                                            <div className="shipping-info">
                                                <p>{modal.order.shippingInfo.address}</p>
                                                <p>{modal.order.shippingInfo.city}, {modal.order.shippingInfo.state} {modal.order.shippingInfo.postalCode}</p>
                                                <p>{modal.order.shippingInfo.country}</p>
                                                <p>Phone: {modal.order.shippingInfo.phoneNo}</p>
                                            </div>
                                        </>
                                    )}

                                    <h3>Order Items</h3>
                                    <div className="items-table">
                                        <div className="table-header-row">
                                            <span>Product</span>
                                            <span>Qty</span>
                                            <span>Price</span>
                                            <span>Total</span>
                                        </div>
                                        {modal.order.orderItems?.map(item => (
                                            <div key={item.product} className="table-row">
                                                <span>{item.name}</span>
                                                <span>{item.quantity}</span>
                                                <span>${item.price?.toFixed(2)}</span>
                                                <span>${(item.price * item.quantity).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        <div className="table-footer">
                                            <span><strong>Grand Total</strong></span>
                                            <span></span>
                                            <span></span>
                                            <span><strong>${modal.order.totalPrice?.toFixed(2)}</strong></span>
                                        </div>
                                    </div>

                                    {modal.order.tracking && (
                                        <>
                                            <h3>Tracking Information</h3>
                                            <div className="tracking-info">
                                                <p><strong>Carrier:</strong> {modal.order.tracking.carrier}</p>
                                                <p><strong>Tracking Number:</strong> {modal.order.tracking.trackingNumber}</p>
                                                {modal.order.tracking.estimatedDelivery && (
                                                    <p><strong>Estimated Delivery:</strong> {new Date(modal.order.tracking.estimatedDelivery).toLocaleDateString()}</p>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* UPDATE STATUS MODAL */}
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

                            {/* DELETE MODAL */}
                            {modal.type === 'delete' && (
                                <div className="delete-content">
                                    <p className="warning-text">
                                        This action is permanent and cannot be undone.
                                    </p>
                                    <div className="order-summary-box">
                                        <p><strong>ID:</strong> #{modal.order._id.slice(-8)}</p>
                                        <p><strong>Customer:</strong> {modal.order.user?.name}</p>
                                        <p><strong>Total:</strong> ${modal.order.totalPrice?.toFixed(2)}</p>
                                    </div>
                                </div>
                            )}

                            {/* CANCEL ORDER MODAL */}
                            {modal.type === 'cancel' && (
                                <div className="cancel-content">
                                    <p className="order-summary">
                                        Order: <strong>#{modal.order._id.slice(-8)}</strong>
                                    </p>
                                    
                                    <label className="form-label">Cancellation Reason</label>
                                    <textarea
                                        className="form-textarea"
                                        rows="4"
                                        placeholder="Enter reason for cancellation..."
                                        value={cancelForm.reason}
                                        onChange={(e) => setCancelForm(prev => ({ ...prev, reason: e.target.value }))}
                                    />

                                    <div className="form-checkbox">
                                        <input
                                            type="checkbox"
                                            id="skip-refund"
                                            checked={cancelForm.skipRefund}
                                            onChange={(e) => setCancelForm(prev => ({ ...prev, skipRefund: e.target.checked }))}
                                        />
                                        <label htmlFor="skip-refund">Skip automatic refund initiation</label>
                                    </div>

                                    {!cancelForm.skipRefund && (
                                        <p className="info-text">
                                            A refund will be automatically initiated for this order.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* MESSAGES MODAL */}
                            {modal.type === 'messages' && (
                                <div className="messages-content">
                                    <div className="messages-list">
                                        {orderMessages.length === 0 ? (
                                            <p className="no-messages">No messages yet</p>
                                        ) : (
                                            orderMessages.map((msg, idx) => (
                                                <div key={idx} className={`message-item ${msg.sender === 'admin' ? 'admin-message' : 'user-message'}`}>
                                                    <div className="message-header">
                                                        <strong>{msg.sender === 'admin' ? 'Admin' : modal.order.user?.name}</strong>
                                                        <small>{new Date(msg.timestamp).toLocaleString()}</small>
                                                    </div>
                                                    <p className="message-text">{msg.content}</p>
                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                        <div className="message-attachments">
                                                            {msg.attachments.map((att, i) => (
                                                                <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
                                                                    {att.filename}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    <button 
                                        className="send-message-btn"
                                        onClick={() => setModal(prev => ({ ...prev, type: 'send-message' }))}
                                    >
                                        Send New Message
                                    </button>
                                </div>
                            )}

                            {/* SEND MESSAGE MODAL */}
                            {modal.type === 'send-message' && (
                                <div className="send-message-content">
                                    <label className="form-label">Message</label>
                                    <textarea
                                        className="form-textarea"
                                        rows="5"
                                        placeholder="Type your message..."
                                        value={messageForm.content}
                                        onChange={(e) => setMessageForm(prev => ({ ...prev, content: e.target.value }))}
                                    />
                                </div>
                            )}

                            {/* TRACKING MODAL */}
                            {modal.type === 'tracking' && (
                                <div className="tracking-content">
                                    <p className="order-summary">
                                        Order: <strong>#{modal.order._id.slice(-8)}</strong>
                                    </p>

                                    <label className="form-label">Carrier</label>
                                    <select 
                                        className="form-select"
                                        value={trackingForm.carrier}
                                        onChange={(e) => setTrackingForm(prev => ({ ...prev, carrier: e.target.value }))}
                                    >
                                        <option value="">Select Carrier</option>
                                        <option value="FedEx">FedEx</option>
                                        <option value="UPS">UPS</option>
                                        <option value="USPS">USPS</option>
                                        <option value="DHL">DHL</option>
                                        <option value="Other">Other</option>
                                    </select>

                                    <label className="form-label">Tracking Number</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Enter tracking number"
                                        value={trackingForm.trackingNumber}
                                        onChange={(e) => setTrackingForm(prev => ({ ...prev, trackingNumber: e.target.value }))}
                                    />

                                    <label className="form-label">Estimated Delivery (Optional)</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={trackingForm.estimatedDelivery}
                                        onChange={(e) => setTrackingForm(prev => ({ ...prev, estimatedDelivery: e.target.value }))}
                                    />
                                </div>
                            )}

                            {/* AUDIT LOG MODAL */}
                            {modal.type === 'audit' && (
                                <div className="audit-content">
                                    {auditLog.length === 0 ? (
                                        <p className="no-audit">No audit log available</p>
                                    ) : (
                                        <div className="audit-log">
                                            {auditLog.map((log, idx) => (
                                                <div key={idx} className="audit-item">
                                                    <div className="audit-header">
                                                        <strong>{log.action}</strong>
                                                        <small>{new Date(log.timestamp).toLocaleString()}</small>
                                                    </div>
                                                    <p>By: {log.performedBy?.name || 'System'}</p>
                                                    {log.details && <p className="audit-details">{log.details}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button
                                onClick={() => setModal({ type: '', open: false, order: null, loading: false })}
                                className="modal-btn cancel"
                                disabled={modal.loading || messageLoading}
                            >
                                {modal.type === 'view' || modal.type === 'messages' || modal.type === 'audit' ? 'Close' : 'Cancel'}
                            </button>
                            {!['view', 'messages', 'audit'].includes(modal.type) && (
                                <button
                                    onClick={executeAction}
                                    className={`modal-btn confirm ${modal.type === 'delete' ? 'danger' : ''}`}
                                    disabled={modal.loading || messageLoading}
                                >
                                    {modal.loading || messageLoading ? 'Processing...' :
                                        modal.type === 'update' ? 'Update Status' :
                                        modal.type === 'delete' ? 'Delete Order' :
                                        modal.type === 'cancel' ? 'Cancel Order' :
                                        modal.type === 'send-message' ? 'Send Message' :
                                        modal.type === 'tracking' ? 'Add Tracking' :
                                        'Confirm'}
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