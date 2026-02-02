import React from 'react';
import { FiX, FiAlertCircle } from 'react-icons/fi';
import '../CartStyles/CartModal.css';

function CartModal({ isOpen, onClose, onConfirm, itemName, isLoading }) {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="cm-overlay" onClick={handleBackdropClick}>
      <div className="cm-modal">
        <button className="cm-close" onClick={onClose} aria-label="Close modal">
          <FiX />
        </button>

        <div className="cm-header">
          <div className="cm-icon">
            <FiAlertCircle />
          </div>
          <h2 className="cm-title">Remove Item</h2>
        </div>

        <div className="cm-content">
          <p className="cm-message">
            Are you sure you want to remove <strong>{itemName}</strong> from your cart?
          </p>
          <p className="cm-note">This action cannot be undone.</p>
        </div>

        <div className="cm-actions">
          <button 
            className="cm-btn cm-btn-cancel" 
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button 
            className="cm-btn cm-btn-confirm" 
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Removing...' : 'Remove Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CartModal;