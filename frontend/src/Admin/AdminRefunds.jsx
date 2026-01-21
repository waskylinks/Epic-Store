// Frontend/src/pages/Admin/AdminRefunds.jsx

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import Loader from '../components/Loader';
import RefundStatusBadge from '../componentStyles/RefundStatusBadge.css';
import {
    fetchAllRefunds,
    reviewRefundRequest,
    processRefundPayment,
    removeErrors,
    removeSuccess
} from '../features/admin/adminSlice';
import {
    Dashboard as DashboardIcon,
    FilterList,
    CheckCircle,
    Cancel,
    HourglassEmpty,
    Visibility,
    Close as CloseIcon
} from '@mui/icons-material';
import '../AdminStyles/Dashboard.css';
import '../AdminStyles/AdminRefunds.css';

function AdminRefunds() {
    const dispatch = useDispatch();
    const { refunds, refundStats, loading, error, success } = useSelector((state) => state.admin);

    const [statusFilter, setStatusFilter] = useState('');
    const [selectedRefund, setSelectedRefund] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [action, setAction] = useState('');
    const [adminNote, setAdminNote] = useState('');
    const [refundAmount, setRefundAmount] = useState('');
    const [merchantNote, setMerchantNote] = useState('');
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        dispatch(fetchAllRefunds({ status: statusFilter }));
    }, [dispatch, statusFilter]);

    useEffect(() => {
        if (success) {
            toast.success('Action completed successfully', { position: 'top-center' });
            dispatch(removeSuccess());
            setShowModal(false);
            setSelectedRefund(null);
            setAdminNote('');
            setRefundAmount('');
            setMerchantNote('');
            setProcessing(false);
            // Refresh data
            dispatch(fetchAllRefunds({ status: statusFilter }));
        }

        if (error) {
            toast.error(error, { position: 'top-center' });
            dispatch(removeErrors());
            setProcessing(false);
        }
    }, [success, error, dispatch, statusFilter]);

    const handleViewRefund = (refund) => {
        setSelectedRefund(refund);
        setShowModal(true);
        setAction('');
    };

    const handleReviewRefund = async (reviewAction) => {
        if (!selectedRefund) return;

        if (reviewAction === 'reject' && !adminNote.trim()) {
            toast.error('Please provide a reason for rejection', { position: 'top-center' });
            return;
        }

        setProcessing(true);
        await dispatch(reviewRefundRequest({
            orderId: selectedRefund._id,
            action: reviewAction,
            adminNote: adminNote
        }));
    };

    const handleProcessRefund = async () => {
        if (!selectedRefund) return;

        setProcessing(true);
        await dispatch(processRefundPayment({
            orderId: selectedRefund._id,
            refundAmount: refundAmount ? parseFloat(refundAmount) : undefined,
            merchantNote: merchantNote
        }));
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN'
        }).format(amount || 0);
    };

    const getActionButtons = (refund) => {
        const status = refund.refundInfo?.status;

        if (status === 'requested') {
            return (
                <div className="action-buttons">
                    <button
                        onClick={() => {
                            setSelectedRefund(refund);
                            setAction('approve');
                            setShowModal(true);
                        }}
                        className="btn-approve"
                    >
                        <CheckCircle fontSize="small" /> Approve
                    </button>
                    <button
                        onClick={() => {
                            setSelectedRefund(refund);
                            setAction('reject');
                            setShowModal(true);
                        }}
                        className="btn-reject"
                    >
                        <Cancel fontSize="small" /> Reject
                    </button>
                </div>
            );
        }

        if (status === 'approved') {
            return (
                <button
                    onClick={() => {
                        setSelectedRefund(refund);
                        setAction('process');
                        setShowModal(true);
                    }}
                    className="btn-process"
                >
                    Process Refund
                </button>
            );
        }

        return null;
    };

    if (loading && !refunds) return <Loader />;

    return (
        <>
            <PageTitle title="Manage Refunds - Admin" />
            <Navbar />

            <div className="admin-container">
                <div className="admin-header">
                    <div>
                        <h1 className="admin-title">Refund Management</h1>
                        <p className="admin-subtitle">Review and process customer refund requests</p>
                    </div>
                </div>

                {/* Stats Cards */}
                {refundStats && (
                    <div className="refund-stats-grid">
                        <div className="stat-card">
                            <div className="stat-icon" style={{ backgroundColor: '#fef3c7' }}>
                                <HourglassEmpty style={{ color: '#f59e0b' }} />
                            </div>
                            <div className="stat-info">
                                <h3>Pending Review</h3>
                                <p className="stat-value">{refundStats.requested || 0}</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon" style={{ backgroundColor: '#dbeafe' }}>
                                <CheckCircle style={{ color: '#3b82f6' }} />
                            </div>
                            <div className="stat-info">
                                <h3>Approved</h3>
                                <p className="stat-value">{refundStats.approved || 0}</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon" style={{ backgroundColor: '#dcfce7' }}>
                                <DashboardIcon style={{ color: '#16a34a' }} />
                            </div>
                            <div className="stat-info">
                                <h3>Completed</h3>
                                <p className="stat-value">{refundStats.completed || 0}</p>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon" style={{ backgroundColor: '#fee2e2' }}>
                                <Cancel style={{ color: '#dc2626' }} />
                            </div>
                            <div className="stat-info">
                                <h3>Total Refunded</h3>
                                <p className="stat-value">{formatCurrency(refundStats.totalRefundedAmount)}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="filter-section">
                    <FilterList className="filter-icon" />
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="filter-select"
                    >
                        <option value="">All Refunds</option>
                        <option value="requested">Requested</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="processing">Processing</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                    </select>
                </div>

                {/* Refunds Table */}
                <div className="table-container">
                    {loading ? (
                        <Loader />
                    ) : refunds && refunds.length > 0 ? (
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Order ID</th>
                                    <th>Customer</th>
                                    <th>Amount</th>
                                    <th>Reason</th>
                                    <th>Status</th>
                                    <th>Requested</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {refunds.map((refund) => (
                                    <tr key={refund._id}>
                                        <td>{refund._id.slice(-8)}</td>
                                        <td>{refund.user?.name || refund.user?.email || 'N/A'}</td>
                                        <td>{formatCurrency(refund.totalPrice)}</td>
                                        <td>
                                            <span className="reason-badge">
                                                {refund.refundInfo?.reason?.replace(/_/g, ' ') || 'N/A'}
                                            </span>
                                        </td>
                                        <td>
                                            <RefundStatusBadge status={refund.refundInfo?.status} />
                                        </td>
                                        <td>
                                            {refund.refundInfo?.requestedAt
                                                ? new Date(refund.refundInfo.requestedAt).toLocaleDateString()
                                                : 'N/A'}
                                        </td>
                                        <td>
                                            <div className="table-actions">
                                                <button
                                                    onClick={() => handleViewRefund(refund)}
                                                    className="btn-view"
                                                >
                                                    <Visibility fontSize="small" /> View
                                                </button>
                                                {getActionButtons(refund)}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="empty-state">
                            <DashboardIcon style={{ fontSize: 64, color: '#cbd5e1' }} />
                            <p>No refund requests found</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Refund Details Modal */}
            {showModal && selectedRefund && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Refund Details</h2>
                            <button onClick={() => setShowModal(false)} className="modal-close">
                                <CloseIcon />
                            </button>
                        </div>

                        <div className="modal-body">
                            {/* Order Info */}
                            <div className="detail-section">
                                <h3>Order Information</h3>
                                <div className="detail-grid">
                                    <div className="detail-item">
                                        <span>Order ID:</span>
                                        <strong>{selectedRefund._id}</strong>
                                    </div>
                                    <div className="detail-item">
                                        <span>Customer:</span>
                                        <strong>{selectedRefund.user?.name || selectedRefund.user?.email}</strong>
                                    </div>
                                    <div className="detail-item">
                                        <span>Total Amount:</span>
                                        <strong>{formatCurrency(selectedRefund.totalPrice)}</strong>
                                    </div>
                                    <div className="detail-item">
                                        <span>Payment Method:</span>
                                        <strong>{selectedRefund.paymentInfo?.method}</strong>
                                    </div>
                                </div>
                            </div>

                            {/* Refund Info */}
                            <div className="detail-section">
                                <h3>Refund Request</h3>
                                <div className="detail-grid">
                                    <div className="detail-item">
                                        <span>Status:</span>
                                        <RefundStatusBadge status={selectedRefund.refundInfo?.status} />
                                    </div>
                                    <div className="detail-item">
                                        <span>Type:</span>
                                        <strong>{selectedRefund.refundInfo?.refundType || 'N/A'}</strong>
                                    </div>
                                    <div className="detail-item">
                                        <span>Reason:</span>
                                        <strong>{selectedRefund.refundInfo?.reason?.replace(/_/g, ' ')}</strong>
                                    </div>
                                    <div className="detail-item full-width">
                                        <span>Description:</span>
                                        <p>{selectedRefund.refundInfo?.description}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Review Action */}
                            {action === 'approve' && (
                                <div className="action-section">
                                    <h3>Approve Refund</h3>
                                    <textarea
                                        value={adminNote}
                                        onChange={(e) => setAdminNote(e.target.value)}
                                        placeholder="Add a note (optional)"
                                        rows="3"
                                        className="admin-textarea"
                                    />
                                    <button
                                        onClick={() => handleReviewRefund('approve')}
                                        disabled={processing}
                                        className="btn-confirm-approve"
                                    >
                                        {processing ? 'Processing...' : 'Confirm Approval'}
                                    </button>
                                </div>
                            )}

                            {action === 'reject' && (
                                <div className="action-section">
                                    <h3>Reject Refund</h3>
                                    <textarea
                                        value={adminNote}
                                        onChange={(e) => setAdminNote(e.target.value)}
                                        placeholder="Provide a reason for rejection (required)"
                                        rows="3"
                                        className="admin-textarea"
                                        required
                                    />
                                    <button
                                        onClick={() => handleReviewRefund('reject')}
                                        disabled={processing || !adminNote.trim()}
                                        className="btn-confirm-reject"
                                    >
                                        {processing ? 'Processing...' : 'Confirm Rejection'}
                                    </button>
                                </div>
                            )}

                            {action === 'process' && (
                                <div className="action-section">
                                    <h3>Process Refund Payment</h3>
                                    <div className="form-group">
                                        <label>Refund Amount (Optional - leave empty for full refund)</label>
                                        <input
                                            type="number"
                                            value={refundAmount}
                                            onChange={(e) => setRefundAmount(e.target.value)}
                                            placeholder={`Max: ${selectedRefund.totalPrice}`}
                                            step="0.01"
                                            max={selectedRefund.totalPrice}
                                            className="admin-input"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Merchant Note (Optional)</label>
                                        <textarea
                                            value={merchantNote}
                                            onChange={(e) => setMerchantNote(e.target.value)}
                                            placeholder="Internal note for this refund"
                                            rows="2"
                                            className="admin-textarea"
                                        />
                                    </div>
                                    <button
                                        onClick={handleProcessRefund}
                                        disabled={processing}
                                        className="btn-confirm-process"
                                    >
                                        {processing ? 'Processing...' : 'Process Refund Now'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <Footer />
        </>
    );
}

export default AdminRefunds;