import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import MessagesModal from '../components/MessagesModal';
import '../AdminStyles/AllOrders.css';
import {
    Delete,
    Edit,
    Visibility,
    Message,
    LocalShipping,
    Cancel,
    History,
    ArrowBack,
    Search,
    ChevronLeft,
    ChevronRight
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
    removeSuccess,
    setPage
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

// ─── Constants ───────────────────────────────────────────────
const TABS = [
    { key: 'all',        label: 'All' },
    { key: 'Processing', label: 'Processing' },
    { key: 'Shipped',    label: 'Shipped' },
    { key: 'Delivered',  label: 'Delivered' },
    { key: 'Cancelled',  label: 'Cancelled' },
];

const SORT_OPTIONS = [
    { value: 'newest',    label: 'Newest First' },
    { value: 'oldest',    label: 'Oldest First' },
    { value: 'amount_hi', label: 'Amount: High to Low' },
    { value: 'amount_lo', label: 'Amount: Low to High' },
    { value: 'status_az', label: 'Status: A to Z' },
    { value: 'status_za', label: 'Status: Z to A' },
];

// Valid next statuses per current status — mirrors backend transition matrix
const VALID_NEXT_STATUSES = {
    Processing: ['Shipped', 'Cancelled'],
    Shipped:    ['Delivered'],
    Delivered:  [],
    Cancelled:  []
};

const PAGE_LIMIT = 20;

// ─── Pure helpers (defined outside component — stable references) ─
const getUnreadCount = (order) => {
    // Schema field is orderMessages, not messages
    if (!Array.isArray(order.orderMessages)) return 0;
    return order.orderMessages.filter(
        msg => !msg.isRead && msg.senderType === 'customer'
    ).length;
};

const getCustomerName = (user) => {
    if (!user) return 'N/A';
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return name || 'N/A';
};

// Audit performer — User model has firstName/lastName, not a name field
const getPerformerName = (performedBy) => {
    if (!performedBy) return 'System';
    const name = `${performedBy.firstName || ''} ${performedBy.lastName || ''}`.trim();
    return name || performedBy.email || 'System';
};

// ─── Component ───────────────────────────────────────────────
function AllOrders() {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const {
        orders,
        loading,
        error,
        success,
        // FIX #1: We no longer pass `orderMessages` or `messageLoading` from
        // Redux into MessagesModal. Instead we manage messages locally so that
        // dispatching addOrderMessage never flips `messageLoading: true` inside
        // an already-open modal (which caused the spinner-flash bug).
        auditLog,
        totalOrders,
        totalPages,
        currentPage,
        stats
    } = useSelector(state => state.admin);

    // ── Server-side filter state ──────────────────────────────
    const [activeTab,      setActiveTab]      = useState('all');
    const [searchRaw,      setSearchRaw]      = useState('');
    const [dateFrom,       setDateFrom]       = useState('');
    const [dateTo,         setDateTo]         = useState('');
    const [sortBy,         setSortBy]         = useState('newest');
    const [selectedStatus, setSelectedStatus] = useState('');
    const [cancelForm,     setCancelForm]     = useState({ reason: '', skipRefund: false });
    const [trackingForm,   setTrackingForm]   = useState({ carrier: '', trackingNumber: '', estimatedDelivery: '' });

    // Debounce search so we don't fire on every keystroke
    const searchTerm = useDebounce(searchRaw, 400);

    // Modal state — stores orderId, not the order object, to avoid stale snapshots
    const [modal,         setModal]         = useState({ type: '', open: false, orderId: null, loading: false });

    // FIX #1: MessagesModal owns its own local message list and loading flag.
    // We seed it once on open and append to it ourselves on send — Redux is
    // only used to persist, never to control the modal's render state.
    const [messagesModal, setMessagesModal] = useState({
        open: false,
        order: null,
        messages: [],      // local copy — not from Redux
        loading: false,    // local loading — not from Redux messageLoading
    });

    // Derive the live order from state on every render — never stale
    const modalOrder = useMemo(
        () => (modal.orderId ? (orders.find(o => o._id === modal.orderId) || null) : null),
        [modal.orderId, orders]
    );

    // Available next statuses for the update modal
    const availableStatuses = modalOrder
        ? (VALID_NEXT_STATUSES[modalOrder.orderStatus] || [])
        : [];

    // ── Fetch whenever filter / page changes ──────────────────
    useEffect(() => {
        const params = { page: currentPage, limit: PAGE_LIMIT, sort: sortBy };
        if (activeTab !== 'all')  params.status = activeTab;
        if (dateFrom)             params.from   = dateFrom;
        if (dateTo)               params.to     = dateTo;
        if (searchTerm.trim())    params.search = searchTerm.trim();
        dispatch(fetchAllOrders(params));
    }, [dispatch, currentPage, activeTab, dateFrom, dateTo, sortBy, searchTerm]);

    // Reset to page 1 whenever a filter changes (not page itself)
    useEffect(() => {
        dispatch(setPage(1));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, dateFrom, dateTo, sortBy, searchTerm]);

    // ── Error / success side effects ──────────────────────────
    useEffect(() => {
        if (error) {
            toast.error(error, { position: 'top-center', autoClose: 3000 });
            dispatch(removeErrors());
            setModal(prev => ({ ...prev, loading: false }));
        }
        if (success) {
            toast.success('Action completed successfully!', { position: 'top-center', autoClose: 3000 });
            dispatch(removeSuccess());
            setModal({ type: '', open: false, orderId: null, loading: false });
            setCancelForm({ reason: '', skipRefund: false });
            setTrackingForm({ carrier: '', trackingNumber: '', estimatedDelivery: '' });
            setSelectedStatus('');
        }
    }, [error, success, dispatch]);

    // ── Tab counts — from server stats (correct across all pages) ──
    const tabCounts = useMemo(() => ({
        all:        stats?.total      ?? totalOrders,
        Processing: stats?.processing ?? 0,
        Shipped:    stats?.shipped    ?? 0,
        Delivered:  stats?.delivered  ?? 0,
        Cancelled:  stats?.cancelled  ?? 0
    }), [stats, totalOrders]);

    // ── Unread dots — from current page orders ────────────────
    const tabHasUnread = useMemo(() => {
        const map = { all: false, Processing: false, Shipped: false, Delivered: false, Cancelled: false };
        orders.forEach(order => {
            if (getUnreadCount(order) > 0) {
                map.all = true;
                if (order.orderStatus) map[order.orderStatus] = true;
            }
        });
        return map;
    }, [orders]);

    // ── Pagination page numbers (max 7 buttons) ───────────────
    const pageNumbers = useMemo(() => {
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }
        const pages = [];
        const left  = Math.max(2, currentPage - 2);
        const right = Math.min(totalPages - 1, currentPage + 2);
        pages.push(1);
        if (left > 2) pages.push('...');
        for (let i = left; i <= right; i++) pages.push(i);
        if (right < totalPages - 1) pages.push('...');
        pages.push(totalPages);
        return pages;
    }, [totalPages, currentPage]);

    // ── Handlers ──────────────────────────────────────────────
    const handlePageChange = useCallback((page) => {
        if (page < 1 || page > totalPages) return;
        dispatch(setPage(page));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [dispatch, totalPages]);

    // FIX #1: Open messages modal by fetching directly — no Redux messageLoading
    const handleAction = useCallback((type, order) => {
        if (type === 'messages') {
            setMessagesModal({ open: true, order, messages: [], loading: true });

            // Fetch messages directly; never touch Redux messageLoading
            fetch(`/api/v1/orders/${order._id}/messages`, { credentials: 'include' })
                .then(res => (res.ok ? res.json() : Promise.reject()))
                .then(data => {
                    setMessagesModal(prev => ({
                        ...prev,
                        messages: data.messages || [],
                        loading: false,
                    }));
                })
                .catch(() => {
                    setMessagesModal(prev => ({ ...prev, loading: false }));
                    toast.error('Failed to load messages', { position: 'top-center', autoClose: 3000 });
                });
        } else {
            if (type === 'update') {
                const nextStatuses = VALID_NEXT_STATUSES[order.orderStatus] || [];
                setSelectedStatus(nextStatuses[0] || '');
            }
            setModal({ type, open: true, orderId: order._id, loading: false });
            if (type === 'audit') dispatch(getOrderAuditLog(order._id));
        }
    }, [dispatch]);

    // FIX #1 + #2: Send appends to LOCAL state only; Redux persists in background.
    // MessagesModal will show the optimistic bubble via its own internal state,
    // and we keep localMessages in sync so re-opening shows the full history.
    const handleSendMessage = useCallback(async (content) => {
        if (!messagesModal.order) return;

        // Persist via Redux and return the real message so MessagesModal can
        // upgrade its optimistic bubble to the canonical server record.
        const result = await dispatch(addOrderMessage({
            orderId: messagesModal.order._id,
            content
        })).unwrap(); // throws on failure — MessagesModal catches and rolls back

        return result?.orderMessage || result;
    }, [dispatch, messagesModal.order]);

    const handleCloseMessagesModal = useCallback(() => {
        setMessagesModal({ open: false, order: null, messages: [], loading: false });
        // Refresh page to update unread badge counts in the table
        const params = { page: currentPage, limit: PAGE_LIMIT, sort: sortBy };
        if (activeTab !== 'all') params.status = activeTab;
        if (dateFrom)            params.from   = dateFrom;
        if (dateTo)              params.to     = dateTo;
        if (searchTerm.trim())   params.search = searchTerm.trim();
        dispatch(fetchAllOrders(params));
    }, [dispatch, currentPage, activeTab, dateFrom, dateTo, sortBy, searchTerm]);

    const closeModal = useCallback(() => {
        if (!modal.loading) {
            setModal({ type: '', open: false, orderId: null, loading: false });
        }
    }, [modal.loading]);

    const executeAction = useCallback(() => {
        if (!modalOrder) return;
        setModal(prev => ({ ...prev, loading: true }));

        switch (modal.type) {
            case 'update':
                dispatch(updateOrder({ id: modalOrder._id, status: selectedStatus }));
                break;
            case 'delete':
                dispatch(deleteOrder(modalOrder._id));
                break;
            case 'cancel': {
                if (!cancelForm.reason.trim()) {
                    toast.error('Cancellation reason is required', { position: 'top-center', autoClose: 3000 });
                    setModal(prev => ({ ...prev, loading: false }));
                    return;
                }
                dispatch(cancelOrderWithRefund({
                    orderId:    modalOrder._id,
                    reason:     cancelForm.reason,
                    skipRefund: cancelForm.skipRefund
                }));
                break;
            }
            case 'tracking': {
                if (!trackingForm.carrier || !trackingForm.trackingNumber.trim()) {
                    toast.error('Carrier and tracking number are required', { position: 'top-center', autoClose: 3000 });
                    setModal(prev => ({ ...prev, loading: false }));
                    return;
                }
                dispatch(addTrackingInfo({ orderId: modalOrder._id, ...trackingForm }));
                break;
            }
            default:
                setModal(prev => ({ ...prev, loading: false }));
        }
    }, [modal.type, modalOrder, selectedStatus, cancelForm, trackingForm, dispatch]);

    // ─── Render ───────────────────────────────────────────────
    if (loading && orders.length === 0) {
        return (
            <>
                <Navbar />
                <Loader type="snake" size="md" />
                <Footer />
            </>
        );
    }

    return (
        <>
            <PageTitle title="All Orders - Admin" />
            <Navbar />

            <div className="ao-page">
                <div className="ao-container">

                    {/* Back */}
                    <button
                        type="button"
                        className="ao-back-btn"
                        onClick={() => navigate('/admin/dashboard')}
                    >
                        <ArrowBack style={{ fontSize: 15 }} />
                        Back to Dashboard
                    </button>

                    {/* Header */}
                    <div className="ao-header">
                        <h1 className="ao-header-title">All Orders ({tabCounts.all})</h1>
                        <p className="ao-header-sub">Manage, filter and track all customer orders</p>
                    </div>

                    {/* Status Tabs */}
                    <div className="ao-tabs-wrap">
                        {TABS.map(tab => (
                            <button
                                key={tab.key}
                                type="button"
                                className={`ao-tab${activeTab === tab.key ? ' ao-tab--active' : ''}`}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                {tab.label}
                                <span className="ao-tab-count">({tabCounts[tab.key] ?? 0})</span>
                                {tabHasUnread[tab.key] && (
                                    <span className="ao-tab-dot" title="Unread messages" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Stats Bar */}
                    <div className="ao-stats-bar">
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Total</div>
                            <div className="ao-stat-value">{tabCounts.all}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Processing</div>
                            <div className="ao-stat-value">{tabCounts.Processing}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Shipped</div>
                            <div className="ao-stat-value">{tabCounts.Shipped}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Delivered</div>
                            <div className="ao-stat-value">{tabCounts.Delivered}</div>
                        </div>
                        <div className="ao-stat-card">
                            <div className="ao-stat-label">Cancelled</div>
                            <div className="ao-stat-value">{tabCounts.Cancelled}</div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="ao-filters">
                        <div className="ao-search-wrap">
                            <span className="ao-search-icon">
                                <Search style={{ fontSize: 16 }} />
                            </span>
                            <input
                                type="text"
                                className="ao-search-input"
                                placeholder="Search by Order ID or reference..."
                                value={searchRaw}
                                onChange={e => setSearchRaw(e.target.value)}
                            />
                        </div>

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

                    {/* Table Card */}
                    <div className="ao-table-card">
                        <div className="ao-table-header">
                            <h2 className="ao-table-title">Orders</h2>
                            <span className="ao-results-count">
                                {loading ? 'Loading...' : `${totalOrders} total`}
                            </span>
                        </div>

                        {/* Thin loading bar while paginating — doesn't replace table */}
                        {loading && orders.length > 0 && (
                            <div className="ao-loading-bar" />
                        )}

                        <div className="ao-table-scroll">
                            <table className="ao-table">
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Customer</th>
                                        <th>Items</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                        <th>Date</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders.length === 0 ? (
                                        <tr>
                                            <td colSpan={7}>
                                                <div className="ao-no-results">
                                                    <div className="ao-no-results-icon">📦</div>
                                                    <div className="ao-no-results-text">No orders found</div>
                                                    <div className="ao-no-results-sub">Try adjusting your search or filters</div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        orders.map(order => {
                                            const unread    = getUnreadCount(order);
                                            const name      = getCustomerName(order.user);
                                            const canCancel = (
                                                order.orderStatus !== 'Cancelled' &&
                                                order.orderStatus !== 'Delivered' &&
                                                order.orderStatus !== 'Shipped'
                                            );
                                            const canUpdate = (
                                                order.orderStatus !== 'Delivered' &&
                                                order.orderStatus !== 'Cancelled'
                                            );
                                            return (
                                                <tr
                                                    key={order._id}
                                                    className={order.orderStatus === 'Processing' ? 'ao-row--processing' : ''}
                                                >
                                                    <td>
                                                        <span
                                                            className="ao-order-id"
                                                            onClick={() => handleAction('view', order)}
                                                            role="button"
                                                            tabIndex={0}
                                                            onKeyDown={e => e.key === 'Enter' && handleAction('view', order)}
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
                                                            {new Date(order.createdAt).toLocaleDateString()}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="ao-actions">
                                                            <button
                                                                type="button"
                                                                className="ao-action-btn view"
                                                                onClick={() => handleAction('view', order)}
                                                                title="View Details"
                                                            >
                                                                <Visibility style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="ao-action-btn update"
                                                                onClick={() => handleAction('update', order)}
                                                                title="Update Status"
                                                                disabled={!canUpdate}
                                                            >
                                                                <Edit style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                type="button"
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
                                                                type="button"
                                                                className="ao-action-btn tracking"
                                                                onClick={() => handleAction('tracking', order)}
                                                                title="Add Tracking"
                                                            >
                                                                <LocalShipping style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="ao-action-btn cancel"
                                                                onClick={() => handleAction('cancel', order)}
                                                                title="Cancel Order"
                                                                disabled={!canCancel}
                                                            >
                                                                <Cancel style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="ao-action-btn audit"
                                                                onClick={() => handleAction('audit', order)}
                                                                title="Audit Log"
                                                            >
                                                                <History style={{ fontSize: 15 }} />
                                                            </button>
                                                            <button
                                                                type="button"
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

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="ao-pagination">
                                <button
                                    type="button"
                                    className="ao-page-btn ao-page-btn--nav"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    title="Previous page"
                                >
                                    <ChevronLeft style={{ fontSize: 18 }} />
                                </button>

                                {pageNumbers.map((p, idx) =>
                                    p === '...' ? (
                                        // eslint-disable-next-line react/no-array-index-key
                                        <span key={`ellipsis-${idx}`} className="ao-page-ellipsis">…</span>
                                    ) : (
                                        <button
                                            key={p}
                                            type="button"
                                            className={`ao-page-btn${currentPage === p ? ' ao-page-btn--active' : ''}`}
                                            onClick={() => handlePageChange(p)}
                                        >
                                            {p}
                                        </button>
                                    )
                                )}

                                <button
                                    type="button"
                                    className="ao-page-btn ao-page-btn--nav"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    title="Next page"
                                >
                                    <ChevronRight style={{ fontSize: 18 }} />
                                </button>

                                <span className="ao-page-info">
                                    Page {currentPage} of {totalPages}
                                </span>
                            </div>
                        )}
                    </div>

                </div>
            </div>

            <Footer />

            {/* Messages Modal — FIX #1: passes local messages + local loading */}
            <MessagesModal
                isOpen={messagesModal.open}
                onClose={handleCloseMessagesModal}
                order={messagesModal.order}
                messages={messagesModal.messages}
                loading={messagesModal.loading}
                userType="admin"
                onSendMessage={handleSendMessage}
            />

            {/* Unified Action Modal */}
            {modal.open && modalOrder && (
                <div
                    className="ao-modal-overlay"
                    onClick={closeModal}
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="ao-modal" onClick={e => e.stopPropagation()}>

                        {/* Modal Header */}
                        <div className="ao-modal-header">
                            <h2 className="ao-modal-title">
                                {modal.type === 'view'     && 'Order Details'}
                                {modal.type === 'update'   && 'Update Order Status'}
                                {modal.type === 'delete'   && 'Delete Order'}
                                {modal.type === 'cancel'   && 'Cancel Order'}
                                {modal.type === 'tracking' && 'Add Tracking Information'}
                                {modal.type === 'audit'    && 'Order Audit Log'}
                            </h2>
                            <button type="button" className="ao-modal-close" onClick={closeModal}>✕</button>
                        </div>

                        {/* Modal Body */}
                        <div className="ao-modal-body">

                            {/* VIEW */}
                            {modal.type === 'view' && (
                                <>
                                    <div className="ao-info-grid">
                                        <div>
                                            <strong>Order ID</strong>
                                            <p>#{modalOrder._id}</p>
                                        </div>
                                        <div>
                                            <strong>Status</strong>
                                            <p>
                                                <span className={`ao-status-badge ${modalOrder.orderStatus.toLowerCase()}`}>
                                                    {modalOrder.orderStatus}
                                                </span>
                                            </p>
                                        </div>
                                        <div>
                                            <strong>Customer</strong>
                                            <p>{getCustomerName(modalOrder.user)}</p>
                                            <p style={{ fontSize: 12, color: 'var(--ao-text-muted)', marginTop: 2 }}>
                                                {modalOrder.user?.email || ''}
                                            </p>
                                        </div>
                                        <div>
                                            <strong>Total</strong>
                                            <p style={{ fontWeight: 700 }}>${modalOrder.totalPrice?.toFixed(2)}</p>
                                        </div>
                                    </div>

                                    {modalOrder.shippingInfo && (
                                        <>
                                            <h3 className="ao-modal-section-title">Shipping Address</h3>
                                            <div className="ao-shipping-info">
                                                <p>{modalOrder.shippingInfo.address}</p>
                                                <p>
                                                    {modalOrder.shippingInfo.city},{' '}
                                                    {modalOrder.shippingInfo.state}{' '}
                                                    {modalOrder.shippingInfo.pinCode}
                                                </p>
                                                <p>{modalOrder.shippingInfo.country}</p>
                                                <p>Phone: {modalOrder.shippingInfo.phoneNo}</p>
                                            </div>
                                        </>
                                    )}

                                    <h3 className="ao-modal-section-title">Order Items</h3>
                                    <div className="ao-items-table">
                                        <div className="ao-items-head">
                                            <span>Product</span>
                                            <span>Qty</span>
                                            <span>Price</span>
                                            <span>Total</span>
                                        </div>
                                        {modalOrder.orderItems?.map((item, idx) => (
                                            <div key={item.product ? String(item.product) : idx} className="ao-items-row">
                                                <span>{item.name}</span>
                                                <span>{item.quantity}</span>
                                                <span>${(item.price || 0).toFixed(2)}</span>
                                                <span>${((item.price || 0) * (item.quantity || 0)).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        <div className="ao-items-footer">
                                            <span>Grand Total</span>
                                            <span />
                                            <span />
                                            <span>${modalOrder.totalPrice?.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {modalOrder.tracking?.trackingNumber && (
                                        <>
                                            <h3 className="ao-modal-section-title">Tracking</h3>
                                            <div className="ao-tracking-display">
                                                <p><strong>Carrier:</strong> {modalOrder.tracking.carrier}</p>
                                                <p><strong>Tracking #:</strong> {modalOrder.tracking.trackingNumber}</p>
                                                {modalOrder.tracking.estimatedDelivery && (
                                                    <p>
                                                        <strong>Est. Delivery:</strong>{' '}
                                                        {new Date(modalOrder.tracking.estimatedDelivery).toLocaleDateString()}
                                                    </p>
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
                                        <span className={`ao-status-badge ${modalOrder.orderStatus.toLowerCase()}`}>
                                            {modalOrder.orderStatus}
                                        </span>
                                    </div>
                                    {availableStatuses.length === 0 ? (
                                        <p className="ao-info-text">
                                            This order cannot be transitioned further.
                                        </p>
                                    ) : (
                                        <>
                                            <label className="ao-form-label">Select New Status</label>
                                            <select
                                                className="ao-form-select"
                                                value={selectedStatus}
                                                onChange={e => setSelectedStatus(e.target.value)}
                                            >
                                                {availableStatuses.map(s => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                        </>
                                    )}
                                </>
                            )}

                            {/* DELETE */}
                            {modal.type === 'delete' && (
                                <>
                                    <div className="ao-warning-text">
                                        This action is permanent and cannot be undone.
                                    </div>
                                    <div className="ao-order-summary-box">
                                        <p><strong>ID:</strong> #{modalOrder._id.slice(-8).toUpperCase()}</p>
                                        <p><strong>Customer:</strong> {getCustomerName(modalOrder.user)}</p>
                                        <p><strong>Total:</strong> ${modalOrder.totalPrice?.toFixed(2)}</p>
                                    </div>
                                </>
                            )}

                            {/* CANCEL */}
                            {modal.type === 'cancel' && (
                                <>
                                    <div className="ao-order-summary-box" style={{ marginBottom: 14 }}>
                                        <p><strong>Order:</strong> #{modalOrder._id.slice(-8).toUpperCase()}</p>
                                        <p><strong>Customer:</strong> {getCustomerName(modalOrder.user)}</p>
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
                                        <p><strong>Order:</strong> #{modalOrder._id.slice(-8).toUpperCase()}</p>
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
                                    {auditLog.length === 0 ? (
                                        <p style={{ color: 'var(--ao-text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                                            No audit log entries available.
                                        </p>
                                    ) : (
                                        auditLog.map((entry, idx) => (
                                            <div key={entry._id || entry.timestamp || idx} className="ao-audit-item">
                                                <div className="ao-audit-header">
                                                    <strong>{entry.action}</strong>
                                                    <small>{new Date(entry.timestamp).toLocaleString()}</small>
                                                </div>
                                                <p>By: {getPerformerName(entry.performedBy)}</p>
                                                {entry.changes?.field && (
                                                    <p className="ao-audit-details">
                                                        {entry.changes.field}: {String(entry.changes.oldValue)} to {String(entry.changes.newValue)}
                                                    </p>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                        </div>

                        {/* Modal Footer */}
                        <div className="ao-modal-footer">
                            <button
                                type="button"
                                className="ao-btn ao-btn--cancel"
                                onClick={closeModal}
                                disabled={modal.loading}
                            >
                                {['view', 'audit'].includes(modal.type) ? 'Close' : 'Cancel'}
                            </button>

                            {/* Hide confirm for view/audit and for update when no transitions available */}
                            {!['view', 'audit'].includes(modal.type) &&
                             !(modal.type === 'update' && availableStatuses.length === 0) && (
                                <button
                                    type="button"
                                    className={`ao-btn ${modal.type === 'delete' ? 'ao-btn--danger' : 'ao-btn--confirm'}`}
                                    onClick={executeAction}
                                    disabled={modal.loading}
                                >
                                    {modal.loading ? 'Processing...' :
                                        modal.type === 'update'   ? 'Update Status' :
                                        modal.type === 'delete'   ? 'Delete Order'  :
                                        modal.type === 'cancel'   ? 'Cancel Order'  :
                                        modal.type === 'tracking' ? 'Add Tracking'  :
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