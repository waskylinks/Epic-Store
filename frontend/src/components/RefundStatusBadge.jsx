import React from 'react';
import '../componentStyles/RefundStatusBadge.css';

const RefundStatusBadge = ({ status }) => {
  const getStatusConfig = (status) => {
    const configs = {
      none: {
        label: 'No Refund',
        className: 'refund-badge-none',
        icon: '○'
      },
      requested: {
        label: 'Refund Requested',
        className: 'refund-badge-requested',
        icon: '⏳'
      },
      approved: {
        label: 'Approved',
        className: 'refund-badge-approved',
        icon: '✓'
      },
      rejected: {
        label: 'Rejected',
        className: 'refund-badge-rejected',
        icon: '✗'
      },
      processing: {
        label: 'Processing',
        className: 'refund-badge-processing',
        icon: '⟳'
      },
      completed: {
        label: 'Refunded',
        className: 'refund-badge-completed',
        icon: '✓'
      },
      failed: {
        label: 'Failed',
        className: 'refund-badge-failed',
        icon: '✗'
      }
    };

    return configs[status] || configs.none;
  };

  const config = getStatusConfig(status);

  return (
    <span className={`refund-badge ${config.className}`}>
      <span className="refund-badge-icon">{config.icon}</span>
      <span className="refund-badge-label">{config.label}</span>
    </span>
  );
};

export default RefundStatusBadge;