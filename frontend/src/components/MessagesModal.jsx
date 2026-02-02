import React, { useState } from "react";
import {
  FiX,
  FiSend,
  FiUser,
  FiCheck,
  FiMessageCircle,
} from "react-icons/fi";
import "../componentStyles/MessagesModal.css";

function MessagesModal({ 
  isOpen, 
  onClose, 
  order, 
  messages, 
  loading, 
  user,
  userType = "customer", // "customer" or "admin"
  onSendMessage 
}) {
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !order) return;

    setSendingMessage(true);
    try {
      await onSendMessage(newMessage.trim());
      setNewMessage("");
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSendingMessage(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  if (!isOpen) return null;

  return (
    <div className="mm-modal-overlay" onClick={onClose}>
      <div className="mm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mm-modal-header">
          <div>
            <h2>Order Messages</h2>
            <p className="mm-modal-subtitle">
              Order #{order?._id?.slice(-8).toUpperCase()}
            </p>
          </div>
          <button 
            className="mm-modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <FiX />
          </button>
        </div>
        
        <div className="mm-modal-body">
          {loading ? (
            <div className="mm-messages-loading">
              <div className="mm-loading-spinner"></div>
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="mm-no-messages">
              <FiMessageCircle className="mm-no-messages-icon" />
              <p>No messages yet</p>
              <small>Start a conversation</small>
            </div>
          ) : (
            <div className="mm-messages-list">
              {messages.map((msg, idx) => {
                // Determine if message is from admin
                const isAdminMessage = msg.sender === 'admin' || msg.senderType === 'admin';
                
                // Determine if current user sent this message
                const isCurrentUser = userType === 'admin' ? isAdminMessage : !isAdminMessage;
                
                // Get customer info from order
                const customerName = order?.user?.firstName && order?.user?.lastName 
                  ? `${order.user.firstName} ${order.user.lastName}`
                  : order?.user?.name || 'Customer';
                
                const customerAvatar = order?.user?.avatar?.url;
                
                return (
                  <div
                    key={idx}
                    className={`mm-message ${isCurrentUser ? 'mm-message-sent' : 'mm-message-received'}`}
                  >
                    {!isCurrentUser && (
                      <div className="mm-message-avatar">
                        {userType === 'admin' && customerAvatar ? (
                          <img src={customerAvatar} alt={customerName} />
                        ) : (
                          <div className={userType === 'admin' ? 'mm-customer-avatar-icon' : 'mm-support-avatar-icon'}>
                            <FiUser />
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="mm-message-content">
                      <span className="mm-message-sender">
                        {isCurrentUser 
                          ? 'You' 
                          : (userType === 'admin' ? customerName : 'Support Team')
                        }
                      </span>
                      
                      <div className="mm-message-bubble">
                        <p>{msg.content || msg.text}</p>
                      </div>
                      
                      <div className="mm-message-footer">
                        <span className="mm-message-time">
                          {formatTimestamp(msg.createdAt || msg.timestamp)}
                        </span>
                        {isCurrentUser && (
                          <span className={`mm-message-status ${msg.isRead ? 'mm-read' : ''}`}>
                            {msg.isRead ? (
                              <>
                                <FiCheck className="mm-check" />
                                <FiCheck className="mm-check mm-check-double" />
                              </>
                            ) : (
                              <FiCheck className="mm-check" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {isCurrentUser && (
                      <div className="mm-message-avatar">
                        {userType === 'customer' && user?.avatar?.url ? (
                          <img src={user.avatar.url} alt={user.firstName} />
                        ) : (
                          <div className={userType === 'admin' ? 'mm-support-avatar-icon' : 'mm-customer-avatar-icon'}>
                            <FiUser />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Message Input */}
          <div className="mm-message-input-container">
            <input
              type="text"
              className="mm-message-input"
              placeholder="Type your message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              disabled={sendingMessage}
            />
            <button
              type="button"
              className="mm-send-btn"
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || sendingMessage}
            >
              <FiSend />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MessagesModal;