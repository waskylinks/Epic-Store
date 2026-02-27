import React, { useState, useEffect } from "react";
import {
  FiX,
  FiSend,
  FiCheck,
  FiMessageCircle,
} from "react-icons/fi";
import "../componentStyles/MessagesModal.css";
import Loader from "./Loader";

function MessagesModal({
  isOpen,
  onClose,
  order,
  messages = [],
  loading,
  user,
  userType = "customer", // "customer" | "admin"
  onSendMessage,
}) {
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  // Mark messages as read when modal opens
  useEffect(() => {
    if (isOpen && order?._id) {
      const markAsRead = async () => {
        try {
          await fetch(`/api/v1/orders/${order._id}/messages/read`, {
            method: 'PUT',
            credentials: 'include'
          });
        } catch (err) {
          console.error('Failed to mark messages as read:', err);
        }
      };
      markAsRead();
    }
  }, [isOpen, order?._id]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !order) return;
    setSendingMessage(true);
    try {
      await onSendMessage(newMessage.trim());
      setNewMessage("");
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

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
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
          <button className="mm-modal-close" onClick={onClose}>
            <FiX />
          </button>
        </div>

        <div className="mm-modal-body">
          {loading ? (
            <div className="mm-messages-loading">
               <Loader type="snake" size="md" />
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
                const isAdminMessage =
                  msg.sender === "admin" || msg.senderType === "admin";

                const isOutgoing =
                  (userType === "admin" && isAdminMessage) ||
                  (userType === "customer" && !isAdminMessage);

                const customerName =
                  order?.user?.firstName && order?.user?.lastName
                    ? `${order.user.firstName} ${order.user.lastName}`
                    : order?.user?.name || "Customer";

                // Determine sender name to display
                let senderName;
                if (isOutgoing) {
                  senderName = "You";
                } else {
                  // Incoming message
                  if (userType === "admin") {
                    senderName = customerName;
                  } else {
                    senderName = "Customer Service";
                  }
                }

                return (
                  <div
                    key={idx}
                    className={`mm-message ${
                      isOutgoing ? "mm-message-outgoing" : "mm-message-incoming"
                    }`}
                  >
                    {!isOutgoing && (
                      <div className="mm-message-sender">
                        <span className="mm-sender-name">{senderName}</span>
                      </div>
                    )}

                    <div className="mm-message-content">
                      <div className="mm-message-bubble">
                        <p>{msg.content || msg.text}</p>
                      </div>

                      <div className="mm-message-footer">
                        <span className="mm-message-time">
                          {formatTimestamp(msg.createdAt || msg.timestamp)}
                        </span>
                        {isOutgoing && (
                          <span
                            className={`mm-message-status ${
                              msg.isRead ? "mm-read" : ""
                            }`}
                          >
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

                    {isOutgoing && (
                      <div className="mm-message-sender">
                        <span className="mm-sender-name">{senderName}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mm-message-input-container">
            <input
              className="mm-message-input"
              placeholder="Message…"
              value={newMessage}
              disabled={sendingMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            />
            <button
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