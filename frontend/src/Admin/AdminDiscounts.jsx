import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Search,
  Add,
  Refresh,
  Edit,
  Delete,
  Visibility,
  Close,
  Percent,
  AttachMoney,
  TrendingUp,
  People,
  Assessment,
  Warning,
  CheckCircle,
  CardGiftcard
} from '@mui/icons-material';
import {
  getAllDiscounts,
  getSingleDiscount,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  createCompensationDiscount,
  getDiscountStats
} from '../features/admin/adminDiscountSlice';
import '../AdminStyles/AdminDiscounts.css';

const AdminDiscounts = () => {
  const dispatch = useDispatch();

  // Redux state
  const {
    discounts,
    currentDiscount,
    stats,
    loading,
    discountsLoading,
    statsLoading,
    error,
    success,
    message: successMessage
  } = useSelector(state => state.adminDiscount);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    type: '',
    startDate: '',
    endDate: ''
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCompensationModal, setShowCompensationModal] = useState(false);
  const [selectedDiscount, setSelectedDiscount] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    code: '',
    type: 'percentage',
    value: 0,
    minCartValue: 0,
    usageLimit: 0,
    startDate: '',
    expiryDate: '',
    isActive: true
  });

  // Compensation form state
  const [compensationData, setCompensationData] = useState({
    customerRef: '',
    orderRef: '',
    value: 0,
    expiryDate: '',
    reason: ''
  });

  // Pagination
  const [currentPage] = useState(1);

  // Fetch discounts — stable reference via useCallback
  const handleFetchDiscounts = useCallback(() => {
    const queryFilters = {
      ...filters,
      search: searchQuery,
      page: currentPage,
      limit: 20
    };
    dispatch(getAllDiscounts(queryFilters));
  }, [filters, searchQuery, currentPage, dispatch]);

  // Fetch on mount + whenever deps change
  useEffect(() => {
    handleFetchDiscounts();
    dispatch(getDiscountStats());
  }, [handleFetchDiscounts, dispatch]);

  // Handle create discount
  const handleCreateDiscount = async (e) => {
    e.preventDefault();

    try {
      await dispatch(createDiscount(formData)).unwrap();

      setFormData({
        code: '',
        type: 'percentage',
        value: 0,
        minCartValue: 0,
        usageLimit: 0,
        startDate: '',
        expiryDate: '',
        isActive: true
      });
      setShowCreateModal(false);

      handleFetchDiscounts();
      dispatch(getDiscountStats());
    } catch (err) {
      console.error('Failed to create discount:', err);
    }
  };

  // Handle edit discount
  const handleEditDiscount = async (e) => {
    e.preventDefault();

    try {
      await dispatch(updateDiscount({
        id: selectedDiscount,
        discountData: formData
      })).unwrap();

      setShowEditModal(false);
      setSelectedDiscount(null);

      handleFetchDiscounts();
      dispatch(getDiscountStats());
    } catch (err) {
      console.error('Failed to update discount:', err);
    }
  };

  // Handle delete discount
  const handleDeleteDiscount = async (id) => {
    if (!window.confirm('Are you sure you want to deactivate this discount?')) return;

    try {
      await dispatch(deleteDiscount(id)).unwrap();
      handleFetchDiscounts();
      dispatch(getDiscountStats());
    } catch (err) {
      console.error('Failed to delete discount:', err);
    }
  };

  // Handle create compensation discount
  const handleCreateCompensation = async (e) => {
    e.preventDefault();

    try {
      await dispatch(createCompensationDiscount(compensationData)).unwrap();

      setCompensationData({
        customerRef: '',
        orderRef: '',
        value: 0,
        expiryDate: '',
        reason: ''
      });
      setShowCompensationModal(false);

      handleFetchDiscounts();
      dispatch(getDiscountStats());
    } catch (err) {
      console.error('Failed to create compensation discount:', err);
    }
  };

  // Handle view details
  const handleViewDetails = async (id) => {
    setSelectedDiscount(id);
    setShowDetailModal(true);
    await dispatch(getSingleDiscount(id));
  };

  // Handle open edit
  const handleOpenEdit = (discount) => {
    setSelectedDiscount(discount._id);
    setFormData({
      code: discount.code,
      type: discount.type,
      value: discount.value,
      minCartValue: discount.minCartValue || 0,
      usageLimit: discount.usageLimit || 0,
      startDate: discount.startDate ? discount.startDate.split('T')[0] : '',
      expiryDate: discount.expiryDate ? discount.expiryDate.split('T')[0] : '',
      isActive: discount.status === 'active'
    });
    setShowEditModal(true);
  };

  // ─── Render KPI Cards ──────────────────────────────────────────────────────
  const renderKPICards = () => {
    if (statsLoading) {
      return [...Array(5)].map((_, i) => (
        <div key={i} className="adc-kpi-card adc-kpi-skeleton">
          <div className="adc-skeleton-icon"></div>
          <div className="adc-skeleton-text" style={{ width: '60%' }}></div>
          <div className="adc-skeleton-value"></div>
        </div>
      ));
    }

    if (!stats) return null;

    const kpiData = [
      { label: 'Total Discounts',      value: stats.totalDiscounts || 0,                          icon: Assessment,  color: 'neutral'  },
      { label: 'Active Discounts',     value: stats.activeDiscounts || 0,                         icon: CheckCircle, color: 'positive' },
      { label: 'Total Usage',          value: stats.totalUsage || 0,                              icon: People,      color: 'neutral'  },
      { label: 'Revenue Impact',       value: `$${(stats.revenueImpact || 0).toLocaleString()}`,  icon: TrendingUp,  color: 'warning'  },
      { label: 'Compensation Issued',  value: stats.compensationDiscounts || 0,                   icon: CardGiftcard,color: 'neutral'  }
    ];

    return kpiData.map((kpi, index) => (
      <div key={index} className="adc-kpi-card">
        <div className="adc-kpi-header">
          <div className={`adc-kpi-icon ${kpi.color}`}>
            <kpi.icon />
          </div>
        </div>
        <p className="adc-kpi-label">{kpi.label}</p>
        <h3 className="adc-kpi-value">{typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}</h3>
      </div>
    ));
  };

  // ─── Render Table ──────────────────────────────────────────────────────────
  const renderTable = () => {
    if (discountsLoading) {
      return (
        <div className="adc-table-skeleton">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="adc-skeleton-row">
              {[...Array(4)].map((__, j) => (
                <div key={j} className="adc-skeleton-cell"></div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (!discounts || discounts.length === 0) {
      return (
        <div className="adc-empty-state">
          <div className="adc-empty-icon">🎫</div>
          <h3 className="adc-empty-title">No discounts found</h3>
          <p className="adc-empty-desc">Create your first discount code to get started</p>
        </div>
      );
    }

    return (
      <div className="adc-table-wrapper">
        <table className="adc-data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Type</th>
              <th>Value</th>
              <th>Usage</th>
              <th>Status</th>
              <th>Start Date</th>
              <th>Expiry Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {discounts.map((discount) => (
              <tr key={discount._id}>
                <td className="adc-td-mono">{discount.code}</td>
                <td>
                  <span className="adc-type-cell">
                    {discount.type === 'percentage'
                      ? <Percent style={{ fontSize: 16 }} />
                      : <AttachMoney style={{ fontSize: 16 }} />}
                    {discount.type}
                  </span>
                </td>
                <td className="adc-td-bold">
                  {discount.type === 'percentage'
                    ? `${discount.value}%`
                    : `$${discount.value.toFixed(2)}`}
                </td>
                <td>{discount.currentUsage || 0} / {discount.usageLimit || '∞'}</td>
                <td>
                  <span className={`adc-badge adc-badge--${discount.status?.toLowerCase()}`}>
                    <span className="adc-badge-dot"></span>
                    {discount.status}
                  </span>
                </td>
                <td>
                  {discount.startDate
                    ? new Date(discount.startDate).toLocaleDateString()
                    : <span className="adc-dash">—</span>}
                </td>
                <td>
                  {discount.expiryDate
                    ? new Date(discount.expiryDate).toLocaleDateString()
                    : 'No expiry'}
                </td>
                <td>
                  <div className="adc-row-actions">
                    <button
                      className="adc-icon-btn"
                      onClick={() => handleViewDetails(discount._id)}
                      title="View Details"
                    >
                      <Visibility style={{ fontSize: 18 }} />
                    </button>
                    <button
                      className="adc-icon-btn"
                      onClick={() => handleOpenEdit(discount)}
                      title="Edit"
                    >
                      <Edit style={{ fontSize: 18 }} />
                    </button>
                    <button
                      className="adc-icon-btn adc-icon-btn--danger"
                      onClick={() => handleDeleteDiscount(discount._id)}
                      title="Deactivate"
                    >
                      <Delete style={{ fontSize: 18 }} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Shared Form Fields ────────────────────────────────────────────────────
  const renderFormFields = () => (
    <>
      <div className="adc-form-group">
        <label className="adc-form-label">Discount Code *</label>
        <input
          type="text"
          className="adc-form-input"
          value={formData.code}
          onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
          placeholder="e.g., SUMMER2024"
          required
        />
      </div>

      <div className="adc-form-group">
        <label className="adc-form-label">Discount Type *</label>
        <select
          className="adc-form-select"
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
        >
          <option value="percentage">Percentage</option>
          <option value="fixed">Fixed Amount</option>
        </select>
      </div>

      <div className="adc-form-group">
        <label className="adc-form-label">
          Value * {formData.type === 'percentage' ? '(%)' : '($)'}
        </label>
        <input
          type="number"
          className="adc-form-input"
          value={formData.value}
          onChange={(e) => setFormData({ ...formData, value: Number(e.target.value) })}
          min="0"
          step={formData.type === 'percentage' ? '1' : '0.01'}
          required
        />
      </div>

      <div className="adc-form-group">
        <label className="adc-form-label">Minimum Cart Value ($)</label>
        <input
          type="number"
          className="adc-form-input"
          value={formData.minCartValue}
          onChange={(e) => setFormData({ ...formData, minCartValue: Number(e.target.value) })}
          min="0"
          step="0.01"
        />
        <p className="adc-form-hint">Set to 0 for no minimum</p>
      </div>

      <div className="adc-form-group">
        <label className="adc-form-label">Usage Limit</label>
        <input
          type="number"
          className="adc-form-input"
          value={formData.usageLimit}
          onChange={(e) => setFormData({ ...formData, usageLimit: Number(e.target.value) })}
          min="0"
        />
        <p className="adc-form-hint">Set to 0 for unlimited</p>
      </div>

      <div className="adc-form-group">
        <label className="adc-form-label">Start Date</label>
        <input
          type="date"
          className="adc-form-input"
          value={formData.startDate}
          onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
        />
      </div>

      <div className="adc-form-group">
        <label className="adc-form-label">Expiry Date</label>
        <input
          type="date"
          className="adc-form-input"
          value={formData.expiryDate}
          onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
        />
      </div>

      <div className="adc-form-group">
        <div className="adc-toggle-wrap">
          <div
            className={`adc-toggle${formData.isActive ? ' active' : ''}`}
            onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
          >
            <div className="adc-toggle-knob"></div>
          </div>
          <span className="adc-toggle-label">Active</span>
        </div>
      </div>
    </>
  );

  // ─── Main Render ───────────────────────────────────────────────────────────
  return (
    <div className="adc-container">
      {/* Header */}
      <header className="adc-header">
        <div className="adc-header-top">
          <h1 className="adc-header-title">Discount Management</h1>
          <div className="adc-header-actions">
            <button className="adc-btn adc-btn--secondary" onClick={() => setShowCompensationModal(true)}>
              <CardGiftcard style={{ fontSize: 18 }} />
              Create Compensation
            </button>
            <button className="adc-btn adc-btn--primary" onClick={() => setShowCreateModal(true)}>
              <Add style={{ fontSize: 18 }} />
              Create Discount
            </button>
            <button className="adc-btn adc-btn--secondary" onClick={handleFetchDiscounts}>
              <Refresh style={{ fontSize: 18 }} />
              Refresh
            </button>
          </div>
        </div>

        <div className="adc-controls">
          <div className="adc-filter-bar">
            <div className="adc-search-wrap">
              <Search className="adc-search-icon" />
              <input
                type="text"
                className="adc-search-input"
                placeholder="Search by code or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="adc-filter-select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="expired">Expired</option>
            </select>

            <select
              className="adc-filter-select"
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="">All Types</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed Amount</option>
            </select>

            <div className="adc-date-range">
              <input
                type="date"
                className="adc-date-input"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
              <span>to</span>
              <input
                type="date"
                className="adc-date-input"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="adc-error-banner">
          <Warning className="adc-error-icon" />
          <div>
            <h4 className="adc-error-title">Error</h4>
            <p className="adc-error-msg">{error}</p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="adc-kpi-grid">{renderKPICards()}</div>

      {/* Table */}
      <div className="adc-table-container">{renderTable()}</div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="adc-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="adc-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="adc-modal-header">
              <h2 className="adc-modal-title">Create Discount</h2>
              <button className="adc-modal-close" onClick={() => setShowCreateModal(false)}>
                <Close />
              </button>
            </div>
            <form onSubmit={handleCreateDiscount}>
              <div className="adc-modal-body">{renderFormFields()}</div>
              <div className="adc-modal-footer">
                <button type="submit" className="adc-btn adc-btn--primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Discount'}
                </button>
                <button type="button" className="adc-btn adc-btn--secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="adc-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="adc-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="adc-modal-header">
              <h2 className="adc-modal-title">Edit Discount</h2>
              <button className="adc-modal-close" onClick={() => setShowEditModal(false)}>
                <Close />
              </button>
            </div>
            <form onSubmit={handleEditDiscount}>
              <div className="adc-modal-body">{renderFormFields()}</div>
              <div className="adc-modal-footer">
                <button type="submit" className="adc-btn adc-btn--primary" disabled={loading}>
                  {loading ? 'Updating...' : 'Update Discount'}
                </button>
                <button type="button" className="adc-btn adc-btn--secondary" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Compensation Modal */}
      {showCompensationModal && (
        <div className="adc-modal-overlay" onClick={() => setShowCompensationModal(false)}>
          <div className="adc-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="adc-modal-header">
              <h2 className="adc-modal-title">Create Compensation Discount</h2>
              <button className="adc-modal-close" onClick={() => setShowCompensationModal(false)}>
                <Close />
              </button>
            </div>
            <form onSubmit={handleCreateCompensation}>
              <div className="adc-modal-body">
                <div className="adc-form-group">
                  <label className="adc-form-label">Customer Reference *</label>
                  <input
                    type="text"
                    className="adc-form-input"
                    value={compensationData.customerRef}
                    onChange={(e) => setCompensationData({ ...compensationData, customerRef: e.target.value })}
                    placeholder="Customer ID or email"
                    required
                  />
                </div>
                <div className="adc-form-group">
                  <label className="adc-form-label">Order Reference</label>
                  <input
                    type="text"
                    className="adc-form-input"
                    value={compensationData.orderRef}
                    onChange={(e) => setCompensationData({ ...compensationData, orderRef: e.target.value })}
                    placeholder="Order ID"
                  />
                </div>
                <div className="adc-form-group">
                  <label className="adc-form-label">Discount Value ($) *</label>
                  <input
                    type="number"
                    className="adc-form-input"
                    value={compensationData.value}
                    onChange={(e) => setCompensationData({ ...compensationData, value: Number(e.target.value) })}
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div className="adc-form-group">
                  <label className="adc-form-label">Expiry Date *</label>
                  <input
                    type="date"
                    className="adc-form-input"
                    value={compensationData.expiryDate}
                    onChange={(e) => setCompensationData({ ...compensationData, expiryDate: e.target.value })}
                    required
                  />
                </div>
                <div className="adc-form-group">
                  <label className="adc-form-label">Reason *</label>
                  <textarea
                    className="adc-form-textarea"
                    value={compensationData.reason}
                    onChange={(e) => setCompensationData({ ...compensationData, reason: e.target.value })}
                    placeholder="Reason for compensation (e.g., refund apology, return inconvenience)"
                    required
                  />
                </div>
              </div>
              <div className="adc-modal-footer">
                <button type="submit" className="adc-btn adc-btn--primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Compensation'}
                </button>
                <button type="button" className="adc-btn adc-btn--secondary" onClick={() => setShowCompensationModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && currentDiscount && (
        <div className="adc-modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="adc-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="adc-modal-header">
              <h2 className="adc-modal-title">Discount Details</h2>
              <button className="adc-modal-close" onClick={() => setShowDetailModal(false)}>
                <Close />
              </button>
            </div>
            <div className="adc-modal-body">
              <div className="adc-section">
                <div className="adc-info-grid">
                  <div className="adc-info-item">
                    <span className="adc-info-label">Code</span>
                    <span className="adc-info-value adc-mono">{currentDiscount.code}</span>
                  </div>
                  <div className="adc-info-item">
                    <span className="adc-info-label">Type</span>
                    <span className="adc-info-value">{currentDiscount.type}</span>
                  </div>
                  <div className="adc-info-item">
                    <span className="adc-info-label">Value</span>
                    <span className="adc-info-value">
                      {currentDiscount.type === 'percentage'
                        ? `${currentDiscount.value}%`
                        : `$${currentDiscount.value.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="adc-info-item">
                    <span className="adc-info-label">Min Cart Value</span>
                    <span className="adc-info-value">
                      ${currentDiscount.minCartValue?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div className="adc-info-item">
                    <span className="adc-info-label">Usage</span>
                    <span className="adc-info-value">
                      {currentDiscount.currentUsage || 0} / {currentDiscount.usageLimit || '∞'}
                    </span>
                  </div>
                  <div className="adc-info-item">
                    <span className="adc-info-label">Status</span>
                    <span className={`adc-badge adc-badge--${currentDiscount.status?.toLowerCase()}`}>
                      {currentDiscount.status}
                    </span>
                  </div>
                  <div className="adc-info-item">
                    <span className="adc-info-label">Created</span>
                    <span className="adc-info-value">
                      {new Date(currentDiscount.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {currentDiscount.expiryDate && (
                    <div className="adc-info-item">
                      <span className="adc-info-label">Expires</span>
                      <span className="adc-info-value">
                        {new Date(currentDiscount.expiryDate).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="adc-modal-footer">
              <button className="adc-btn adc-btn--secondary" onClick={() => setShowDetailModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {success && successMessage && (
        <div className="adc-toast-container">
          <div className="adc-toast adc-toast--success">
            <CheckCircle className="adc-toast-icon" />
            <div>
              <h4 className="adc-toast-title">Success</h4>
              <p className="adc-toast-msg">{successMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDiscounts;