import React from 'react';
import { FiAlertTriangle, FiX, FiTrash2 } from 'react-icons/fi';
import '../CartStyles/ClearCartModal.css';

function ClearCartModal({ isOpen, onClose, onConfirm, isClearing }) {
  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !isClearing) {
      onClose();
    }
  };

  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    if (!isClearing) {
      onClose();
    }
  };

  return (
    <div className="clear-cart-modal-overlay" onClick={handleOverlayClick}>
      <div className="clear-cart-modal">
        {/* Header */}
        <div className="clear-cart-modal-header">
          <div className="clear-cart-modal-icon-wrapper">
            <FiAlertTriangle className="clear-cart-modal-icon" />
          </div>
          <button
            className="clear-cart-modal-close"
            onClick={handleCancel}
            disabled={isClearing}
            aria-label="Close modal"
          >
            <FiX />
          </button>
        </div>

        {/* Content */}
        <div className="clear-cart-modal-content">
          <h2 className="clear-cart-modal-title">Clear Cart?</h2>
          <p className="clear-cart-modal-message">
            Are you sure you want to remove all items from your cart? This action cannot be undone.
          </p>
        </div>

        {/* Actions */}
        <div className="clear-cart-modal-actions">
          <button
            className="clear-cart-modal-btn clear-cart-modal-btn-cancel"
            onClick={handleCancel}
            disabled={isClearing}
          >
            Cancel
          </button>
          <button
            className="clear-cart-modal-btn clear-cart-modal-btn-confirm"
            onClick={handleConfirm}
            disabled={isClearing}
          >
            {isClearing ? (
              <>
                <FiTrash2 className="clear-cart-modal-btn-spinner" />
                Clearing...
              </>
            ) : (
              <>
                <FiTrash2 />
                Clear Cart
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClearCartModal;