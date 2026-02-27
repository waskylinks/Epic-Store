import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import MessagesModal from '../components/MessagesModal';
import '../AdminStyles/AllOrders.css';
import {
    Delete, Edit, Visibility, Message, LocalShipping,
    Cancel, History, ArrowBack, Search
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

// ─── Debounce hook ───────────────────────────────────────────
function useDebounce(value, delay) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}

// ─── Status tabs config ──────────────────────────────────────
const TABS = [
    { key: 'all',        label: 'All' },
    { key: 'Processing', label: 'Processing' },
    { key: 'Shipped',    label: 'Shipped' },
    { key: 'Delivered',  label: 'Delivered' },
    { key: 'Cancelled',  label: 'Cancelled' },
];

// ─── Sort options ────────────────────────────────────────────
const SORT_OPTIONS = [
    { value: 'newest',    label: 'Newest First' },
    { value: 'oldest',    label: 'Oldest First' },
    { value: 'amount_hi', label: 'Amount: High → Low' },
    { value: 'amount_lo', label: 'Amount: Low → High' },
    { value: 'status_az', label: 'Status: A → Z' },
    { value: 'status_za', label: 'Status: Z → A' },
];

// ─── Helpers ─────────────────────────────────────────────────
const getUnreadCount = (order) => {
    if (!order.messages || !Array.isArray(order.messages)) return 0;
    return order.messages.filter(
        msg => !msg.isRead && (msg.sender === 'customer' || msg.senderType === 'customer')
    ).length;
};

const getCustomerName = (user) => {
    if (!user) return 'N/A';
    const first = user.firstName || '';
    const last  = user.lastName  || '';
    if (first && last) return `${first} ${last}`;
    return user.name || 'N/A';
};

// ─── Main Component ──────────────────────────────────────────
function AllOrders() {
    const dispatch   = useDispatch();
    const navigate   = useNavigate();
    const { orders, loading, error, success, orderMessages, auditLog, messageLoading } =
        useSelector(state => state.admin);

    // ── Filters ───────────────────────────────────────────────
    const [activeTab,   setActiveTab]   = useState('all');
    const [searchRaw,   setSearchRaw]   = useState('');
    const [dateFrom,    setDateFrom]    = useState('');
    const [dateTo,      setDateTo]      = useState('');
    const [sortBy,      setSortBy]      = useState('newest');
    const searchTerm = useDebounce(searchRaw, 300);

    // ── Modals ────────────────────────────────────────────────
    const [modal, setModal] = useState({ type: '', open: false, order: null, loading: false });
    const [messagesModal, setMessagesModal] = useState({ open: false, order: null });

    // ── Form states ───────────────────────────────────────────
    const [cancelForm,    setCancelForm]   = useState({ reason: '', skipRefund: false });
    const [trackingForm,  setTrackingForm] = useState({ carrier: '', trackingNumber: '', estimatedDelivery: '' });
    // Fix #3 & #8: controlled state for status select — replaces getElementById + defaultValue anti-pattern
    const [selectedStatus, setSelectedStatus] = useState('');

    // ── Fetch on mount ────────────────────────────────────────
    useEffect(() => { dispatch(fetchAllOrders()); }, [dispatch]);

    // ── Error / success toasts ────────────────────────────────
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
            setCancelForm({ reason: '', skipRefund: false });
            setTrackingForm({ carrier: '', trackingNumber: '', estimatedDelivery: '' });
            setSelectedStatus('');
        }
    }, [error, success, dispatch]);

    // ── Tab counts ────────────────────────────────────────────
    const tabCounts = useMemo(() => ({
        all:        orders.length,
        Processing: orders.filter(o => o.orderStatus === 'Processing').length,
        Shipped:    orders.filter(o => o.orderStatus === 'Shipped').length,
        Delivered:  orders.filter(o => o.orderStatus === 'Delivered').length,
        Cancelled:  orders.filter(o => o.orderStatus === 'Cancelled').length,
    }), [orders]);

    // ── Unread dots per tab ───────────────────────────────────
    const tabHasUnread = useMemo(() => {
        const map = { all: false, Processing: false, Shipped: false, Delivered: false, Cancelled: false };
        orders.forEach(order => {
            if (getUnreadCount(order) > 0) {
                map.all = true;
                map[order.orderStatus] = true;
            }
        });
        return map;
    }, [orders]);

    // ── Stats bar ─────────────────────────────────────────────
    const totalRevenue = useMemo(() =>
        orders
            .filter(o => o.orderStatus !== 'Cancelled')
            .reduce((sum, o) => sum + (o.totalPrice || 0), 0),
        [orders]
    );

    // ── Filter + sort ─────────────────────────────────────────
    const processedOrders = useMemo(() => {
        let result = [...orders];

        // Tab filter
        if (activeTab !== 'all') {
            result = result.filter(o => o.orderStatus === activeTab);
        }

        // Search
        if (searchTerm.trim()) {
            const lower = searchTerm.toLowerCase();
            result = result.filter(o =>
                o._id.toLowerCase().includes(lower) ||
                getCustomerName(o.user).toLowerCase().includes(lower) ||
                (o.user?.email || '').toLowerCase().includes(lower)
            );
        }

        // Date range
        if (dateFrom) {
            const from = new Date(dateFrom);
            result = result.filter(o => new Date(o.createdAt) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(23, 59, 59, 999);
            result = result.filter(o => new Date(o.createdAt) <= to);
        }

        // Sort
        result.sort((a, b) => {
            switch (sortBy) {
                case 'newest':    return new Date(b.createdAt) - new Date(a.createdAt);
                case 'oldest':    return new Date(a.createdAt) - new Date(b.createdAt);
                case 'amount_hi': return (b.totalPrice || 0) - (a.totalPrice || 0);
                case 'amount_lo': return (a.totalPrice || 0) - (b.totalPrice || 0);
                case 'status_az': return a.orderStatus.localeCompare(b.orderStatus);
                case 'status_za': return b.orderStatus.localeCompare(a.orderStatus);
                default:          return new Date(b.createdAt) - new Date(a.createdAt);
            }
        });

        return result;
    }, [orders, activeTab, searchTerm, dateFrom, dateTo, sortBy]);

    // ── Actions ───────────────────────────────────────────────
    const handleAction = useCallback((type, order) => {
        if (type === 'messages') {
            setMessagesModal({ open: true, order });
            dispatch(getOrderMessages(order._id));
        } else {
            // Fix #8: seed controlled status select from the order's current status
            if (type === 'update') setSelectedStatus(order.orderStatus);
            setModal({ type, open: true, order, loading: false });
            if (type === 'audit') dispatch(getOrderAuditLog(order._id));
        }
    }, [dispatch]);

    const handleSendMessage = useCallback(async (content) => {
        if (!messagesModal.order) return;
        try {
            await dispatch(addOrderMessage({
                orderId: messagesModal.order._id,
                content,
                sender: 'admin'
            })).unwrap();
            dispatch(getOrderMessages(messagesModal.order._id));
        } catch (err) {
            toast.error(err?.message || 'Failed to send message', { position: 'top-center', autoClose: 3000 });
        }
    }, [dispatch, messagesModal.order]);

    const handleCloseMessagesModal = useCallback(() => {
        setMessagesModal({ open: false, order: null });
        dispatch(fetchAllOrders());
    }, [dispatch]);

    const executeAction = useCallback(() => {
        if (!modal.order) return;
        setModal(prev => ({ ...prev, loading: true }));
        switch (modal.type) {
            case 'update': {
                // Fix #2 & #3: block scope + controlled state instead of getElementById
                dispatch(updateOrder({ id: modal.order._id, status: selectedStatus }));
                break;
            }
            case 'delete': {
                dispatch(deleteOrder(modal.order._id));
                break;
            }
            case 'cancel': {
                dispatch(cancelOrderWithRefund({
                    orderId: modal.order._id,
                    reason: cancelForm.reason,
                    skipRefund: cancelForm.skipRefund
                }));
                break;
            }
            case 'tracking': {
                dispatch(addTrackingInfo({ orderId: modal.order._id, ...trackingForm }));
                break;
            }
            default: {
                setModal(prev => ({ ...prev, loading: false }));
            }
        }
    }, [modal.order, modal.type, selectedStatus, cancelForm, trackingForm, dispatch]);

    const closeModal = useCallback(() => {
        if (!modal.loading) {
            setModal({ type: '', open: false, order: null, loading: false });
        }
    }, [modal.loading]);

    // ── Loading state ─────────────────────────────────────────
    if (loading && orders.length === 0)
        return (
            <>
                <Navbar />
                <Loader type="snake" size="md" />
                <Footer />
            </>
        );

    // ─────────────────────────────────────────────────────────
    return (
        <>
            <PageTitle title="All Orders - Admin" />
            <Navbar />

            <div className="ao-page">
                <div className="ao-container">

                    {/* ── Back Button ────────────────────────── */}
                    <button className="ao-back-btn" onClick={() => navigate('/admin/dashboard')}>
                        <ArrowBack style={{ fontSize: 15 }} />
                        Back to Dashboard
                    </button>

                    {/* ── Page Header ────────────────────────── */}
                    <div className="ao-header">
                        <h1 className="ao-header-title">All Orders ({orders.length})</h1>
                        <p className="ao-header-sub">Manage, filter and track all customer orders</p>
                    </div>

                    {/* ── Status Tabs ────────────────────────── */}
                    <div className="ao-tabs-wrap">
                        {TABS.map(tab => (
                            <button
                                key={tab.key}
                                className={`ao-tab${activeTab === tab.key ? ' ao-tab--active' : ''}`}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                {tab.label}
                                <span className="ao-tab-count">
                                    ({tabCounts[tab.key] ?? 0})
                                </span>
                                {tabHasUnread[tab.key] && (
                                    <span className="ao-tab-dot" title="Unread messages" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* ── Stats Bar ──────────────────────────── */}
                    <div className="ao-stats-bar">
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Total Orders</div>
                            <div className="ao-stat-value">{orders.length}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Processing</div>
                            <div className="ao-stat-value">{tabCounts.Processing}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Delivered</div>
                            <div className="ao-stat-value">{tabCounts.Delivered}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Total Revenue</div>
                            <div className="ao-stat-value">
                                ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>
                    </div>

                    {/* ── Filters ────────────────────────────── */}
                    <div className="ao-filters">
                        {/* Search */}
                        <div className="ao-search-wrap">
                            <span className="ao-search-icon">
                                <Search style={{ fontSize: 16 }} />
                            </span>
                            <input
                                type="text"
                                className="ao-search-input"
                                placeholder="Search by Order ID, customer name, or email..."
                                value={searchRaw}
                                onChange={e => setSearchRaw(e.target.value)}
                            />
                        </div>

                        {/* Date range */}
                        <div className="ao-date-wrap">
                            <span className="ao-date-label">From</span>
                            <input
                                type="date"
                                className="ao-date-input"
                                value={dateFrom}
                                onChange={e => setDateFrom(e.target.value)}
                            />
                            <span className="ao-date-sep">—</span>
                            <span className="ao-date-label">To</span>
                            <input
                                type="date"
                                className="ao-date-input"
                                value={dateTo}
                                onChange={e => setDateTo(e.target.value)}
                            />
                        </div>

                        {/* Sort */}
                        <select
                            className="ao-sort-select"
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value)}
                        >
                            {SORT_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* ── Orders Table ───────────────────────── */}
                    <div className="ao-table-card">
                        <div className="ao-table-header">
                            <h2 className="ao-table-title">Orders</h2>
                            <span className="ao-results-count">
                                {processedOrders.length} result{processedOrders.length !== 1 ? 's' : ''}
                            </span>
                        </div>

                        <div className="ao-table-scroll">
                            <table className="ao-table">
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
                                    {processedOrders.length === 0 ? (
                                        <tr>
                                            <td colSpan="7">
                                                <div className="ao-no-results">
                                                    <div className="ao-no-results-icon">📦</div>
                                                    <div className="ao-no-results-text">No orders found</div>
                                                    <div className="ao-no-results-sub">
                                                        Try adjusting your search or filters
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        processedOrders.map(order => {
                                            const unread = getUnreadCount(order);
                                            const name   = getCustomerName(order.user);
                                            return (
                                                <tr
                                                    key={order._id}
                                                    className={order.orderStatus === 'Processing' ? 'ao-row--processing' : ''}
                                                >
                                                    <td>
                                                        <span
                                                            className="ao-order-id"
                                                            onClick={() => handleAction('view', order)}
                                                            title="View order details"
                                                        >
                                                            #{order._id.slice(-8).toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="ao-customer-name">{name}</div>
                                                        <div className="ao-customer-email">{order.user?.email || '—'}</div>
                                                    </td>
                                                    <td>{order.orderItems?.length || 0}</td>
                                                    <td>
                                                        <span className="ao-amount">
                                                            ${(order.totalPrice || 0).toFixed(2)}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className={`ao-status-badge ${order.orderStatus.toLowerCase()}`}>
                                                            {order.orderStatus}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div className="ao-date-cell">
                                                            {new Date(order.createdAt).toLocaleString()}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="ao-actions">
                                                            <button
                                                                className="ao-action-btn view"
                                                                onClick={() => handleAction('view', order)}
                                                                title="View Details"
                                                            >
                                                                <Visibility style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                className="ao-action-btn update"
                                                                onClick={() => handleAction('update', order)}
                                                                title="Update Status"
                                                            >
                                                                <Edit style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                className="ao-action-btn message"
                                                                onClick={() => handleAction('messages', order)}
                                                                title="Messages"
                                                            >
                                                                <Message style={{ fontSize: 15 }} />
                                                                {unread > 0 && (
                                                                    <span className="ao-msg-badge">{unread}</span>
                                                                )}
                                                            </button>
                                                            <button
                                                                className="ao-action-btn tracking"
                                                                onClick={() => handleAction('tracking', order)}
                                                                title="Add Tracking"
                                                            >
                                                                <LocalShipping style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                className="ao-action-btn cancel"
                                                                onClick={() => handleAction('cancel', order)}
                                                                title="Cancel Order"
                                                                disabled={
                                                                    order.orderStatus === 'Cancelled' ||
                                                                    order.orderStatus === 'Delivered'
                                                                }
                                                            >
                                                                <Cancel style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                className="ao-action-btn audit"
                                                                onClick={() => handleAction('audit', order)}
                                                                title="Audit Log"
                                                            >
                                                                <History style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                className="ao-action-btn delete"
                                                                onClick={() => handleAction('delete', order)}
                                                                title="Delete Order"
                                                            >
                                                                <Delete style={{ fontSize: 15 }} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>

            <Footer />

            {/* ── Messages Modal ────────────────────────────── */}
            <MessagesModal
                isOpen={messagesModal.open}
                onClose={handleCloseMessagesModal}
                order={messagesModal.order}
                messages={orderMessages}
                loading={messageLoading}
                userType="admin"
                onSendMessage={handleSendMessage}
            />

            {/* ── Unified Modal ─────────────────────────────── */}
            {modal.open && modal.order && (
                <div className="ao-modal-overlay" onClick={closeModal}>
                    <div className="ao-modal" onClick={e => e.stopPropagation()}>

                        <div className="ao-modal-header">
                            <h2 className="ao-modal-title">
                                {modal.type === 'view'     && 'Order Details'}
                                {modal.type === 'update'   && 'Update Order Status'}
                                {modal.type === 'delete'   && 'Delete Order'}
                                {modal.type === 'cancel'   && 'Cancel Order'}
                                {modal.type === 'tracking' && 'Add Tracking Information'}
                                {modal.type === 'audit'    && 'Order Audit Log'}
                            </h2>
                            <button className="ao-modal-close" onClick={closeModal}>✕</button>
                        </div>

                        <div className="ao-modal-body">

                            {/* VIEW */}
                            {modal.type === 'view' && (
                                <>
                                    <div className="ao-info-grid">
                                        <div>
                                            <strong>Order ID</strong>
                                            <p>#{modal.order._id}</p>
                                        </div>
                                        <div>
                                            <strong>Status</strong>
                                            <p>
                                                <span className={`ao-status-badge ${modal.order.orderStatus.toLowerCase()}`}>
                                                    {modal.order.orderStatus}
                                                </span>
                                            </p>
                                        </div>
                                        <div>
                                            <strong>Customer</strong>
                                            <p>{getCustomerName(modal.order.user)}</p>
                                            <p style={{ fontSize: 12, color: 'var(--ao-text-muted)', marginTop: 2 }}>
                                                {modal.order.user?.email || ''}
                                            </p>
                                        </div>
                                        <div>
                                            <strong>Total</strong>
                                            <p style={{ fontWeight: 700 }}>${modal.order.totalPrice?.toFixed(2)}</p>
                                        </div>
                                    </div>

                                    {modal.order.shippingInfo && (
                                        <>
                                            <h3 className="ao-modal-section-title">Shipping Address</h3>
                                            <div className="ao-shipping-info" style={{ marginBottom: 20 }}>
                                                <p>{modal.order.shippingInfo.address}</p>
                                                <p>{modal.order.shippingInfo.city}, {modal.order.shippingInfo.state} {modal.order.shippingInfo.postalCode}</p>
                                                <p>{modal.order.shippingInfo.country}</p>
                                                <p>Phone: {modal.order.shippingInfo.phoneNo}</p>
                                            </div>
                                        </>
                                    )}

                                    <h3 className="ao-modal-section-title">Order Items</h3>
                                    <div className="ao-items-table">
                                        <div className="ao-items-head">
                                            <span>Product</span><span>Qty</span><span>Price</span><span>Total</span>
                                        </div>
                                        {modal.order.orderItems?.map(item => (
                                            <div key={item.product} className="ao-items-row">
                                                <span>{item.name}</span>
                                                <span>{item.quantity}</span>
                                                <span>${item.price?.toFixed(2)}</span>
                                                <span>${(item.price * item.quantity).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        <div className="ao-items-footer">
                                            <span>Grand Total</span><span></span><span></span>
                                            <span>${modal.order.totalPrice?.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {modal.order.tracking && (
                                        <>
                                            <h3 className="ao-modal-section-title">Tracking</h3>
                                            <div className="ao-tracking-display">
                                                <p><strong>Carrier:</strong> {modal.order.tracking.carrier}</p>
                                                <p><strong>Tracking #:</strong> {modal.order.tracking.trackingNumber}</p>
                                                {modal.order.tracking.estimatedDelivery && (
                                                    <p><strong>Est. Delivery:</strong> {new Date(modal.order.tracking.estimatedDelivery).toLocaleDateString()}</p>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                            {/* UPDATE STATUS */}
                            {modal.type === 'update' && (
                                <>
                                    <div className="ao-current-status">
                                        <span>Current:</span>
                                        <span className={`ao-status-badge ${modal.order.orderStatus.toLowerCase()}`}>
                                            {modal.order.orderStatus}
                                        </span>
                                    </div>
                                    <label className="ao-form-label">Select New Status</label>
                                    <select
                                        id="ao-status-select"
                                        className="ao-form-select"
                                        value={selectedStatus}
                                        onChange={e => setSelectedStatus(e.target.value)}
                                    >
                                        <option value="Processing">Processing</option>
                                        <option value="Shipped">Shipped</option>
                                        <option value="Delivered">Delivered</option>
                                        <option value="Cancelled">Cancelled</option>
                                    </select>
                                </>
                            )}

                            {/* DELETE */}
                            {modal.type === 'delete' && (
                                <>
                                    <div className="ao-warning-text">
                                        ⚠️ This action is permanent and cannot be undone.
                                    </div>
                                    <div className="ao-order-summary-box">
                                        <p><strong>ID:</strong> #{modal.order._id.slice(-8).toUpperCase()}</p>
                                        <p><strong>Customer:</strong> {getCustomerName(modal.order.user)}</p>
                                        <p><strong>Total:</strong> ${modal.order.totalPrice?.toFixed(2)}</p>
                                    </div>
                                </>
                            )}

                            {/* CANCEL */}
                            {modal.type === 'cancel' && (
                                <>
                                    <div className="ao-order-summary-box" style={{ marginBottom: 14 }}>
                                        <p><strong>Order:</strong> #{modal.order._id.slice(-8).toUpperCase()}</p>
                                        <p><strong>Customer:</strong> {getCustomerName(modal.order.user)}</p>
                                    </div>
                                    <label className="ao-form-label">Cancellation Reason</label>
                                    <textarea
                                        className="ao-form-textarea"
                                        placeholder="Enter reason for cancellation..."
                                        value={cancelForm.reason}
                                        onChange={e => setCancelForm(prev => ({ ...prev, reason: e.target.value }))}
                                    />
                                    <label className="ao-form-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={cancelForm.skipRefund}
                                            onChange={e => setCancelForm(prev => ({ ...prev, skipRefund: e.target.checked }))}
                                        />
                                        Skip automatic refund initiation
                                    </label>
                                    {!cancelForm.skipRefund && (
                                        <div className="ao-info-text">
                                            A refund will be automatically initiated for this order.
                                        </div>
                                    )}
                                </>
                            )}

                            {/* TRACKING */}
                            {modal.type === 'tracking' && (
                                <>
                                    <div className="ao-order-summary-box" style={{ marginBottom: 6 }}>
                                        <p><strong>Order:</strong> #{modal.order._id.slice(-8).toUpperCase()}</p>
                                    </div>
                                    <label className="ao-form-label">Carrier</label>
                                    <select
                                        className="ao-form-select"
                                        value={trackingForm.carrier}
                                        onChange={e => setTrackingForm(prev => ({ ...prev, carrier: e.target.value }))}
                                    >
                                        <option value="">Select Carrier</option>
                                        <option value="FedEx">FedEx</option>
                                        <option value="UPS">UPS</option>
                                        <option value="USPS">USPS</option>
                                        <option value="DHL">DHL</option>
                                        <option value="Other">Other</option>
                                    </select>
                                    <label className="ao-form-label">Tracking Number</label>
                                    <input
                                        type="text"
                                        className="ao-form-input"
                                        placeholder="Enter tracking number"
                                        value={trackingForm.trackingNumber}
                                        onChange={e => setTrackingForm(prev => ({ ...prev, trackingNumber: e.target.value }))}
                                    />
                                    <label className="ao-form-label">Estimated Delivery (Optional)</label>
                                    <input
                                        type="date"
                                        className="ao-form-input"
                                        value={trackingForm.estimatedDelivery}
                                        onChange={e => setTrackingForm(prev => ({ ...prev, estimatedDelivery: e.target.value }))}
                                    />
                                </>
                            )}

                            {/* AUDIT LOG */}
                            {modal.type === 'audit' && (
                                <div className="ao-audit-log">
                                    {!auditLog || auditLog.length === 0 ? (
                                        <p style={{ color: 'var(--ao-text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                                            No audit log entries available.
                                        </p>
                                    ) : (
                                        auditLog.map((log, idx) => (
                                            <div key={log._id || log.timestamp || idx} className="ao-audit-item">
                                                <div className="ao-audit-header">
                                                    <strong>{log.action}</strong>
                                                    <small>{new Date(log.timestamp).toLocaleString()}</small>
                                                </div>
                                                <p>By: {log.performedBy?.name || 'System'}</p>
                                                {log.details && (
                                                    <p className="ao-audit-details">{log.details}</p>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                        </div>

                        <div className="ao-modal-footer">
                            <button
                                className="ao-btn ao-btn--cancel"
                                onClick={closeModal}
                                disabled={modal.loading}
                            >
                                {['view', 'audit'].includes(modal.type) ? 'Close' : 'Cancel'}
                            </button>
                            {!['view', 'audit'].includes(modal.type) && (
                                <button
                                    className={`ao-btn ${modal.type === 'delete' ? 'ao-btn--danger' : 'ao-btn--confirm'}`}
                                    onClick={executeAction}
                                    disabled={modal.loading}
                                >
                                    {modal.loading ? 'Processing…' :
                                        modal.type === 'update'   ? 'Update Status'  :
                                        modal.type === 'delete'   ? 'Delete Order'   :
                                        modal.type === 'cancel'   ? 'Cancel Order'   :
                                        modal.type === 'tracking' ? 'Add Tracking'   :
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