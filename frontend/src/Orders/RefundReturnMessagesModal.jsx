// RefundReturnMessagesModal.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  FiX,
  FiSend,
  FiCheck,
  FiMessageCircle,
  FiPaperclip,
  FiFile,
  FiImage,
  FiVideo,
  FiDownload,
} from "react-icons/fi";
import "../OrderStyles/RefundReturnMessagesModal.css";

function RefundReturnMessagesModal({
  isOpen,
  onClose,
  orderId,
  messages = [],
  loading,
  onSendMessage,
  onRefresh,
  type = "refund", // "refund" | "return"
}) {
  const [newMessage, setNewMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const MAX_FILES = 3;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_FILE_TYPES = {
    images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    videos: ['video/mp4', 'video/webm', 'video/quicktime'],
    documents: ['application/pdf']
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh messages when modal opens
  useEffect(() => {
    if (isOpen && onRefresh) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  const isFileTypeAllowed = (file) => {
    const allAllowedTypes = [
      ...ALLOWED_FILE_TYPES.images,
      ...ALLOWED_FILE_TYPES.videos,
      ...ALLOWED_FILE_TYPES.documents
    ];
    return allAllowedTypes.includes(file.type);
  };

  const getFileIcon = (fileType) => {
    if (ALLOWED_FILE_TYPES.images.includes(fileType)) return <FiImage />;
    if (ALLOWED_FILE_TYPES.videos.includes(fileType)) return <FiVideo />;
    if (ALLOWED_FILE_TYPES.documents.includes(fileType)) return <FiFile />;
    return <FiFile />;
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    
    if (selectedFiles.length + files.length > MAX_FILES) {
      alert(`You can only attach up to ${MAX_FILES} files`);
      return;
    }

    const validFiles = files.filter(file => {
      if (!isFileTypeAllowed(file)) {
        alert(`${file.name} is not a supported file type`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });

    setSelectedFiles(prev => [...prev, ...validFiles]);

    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreviews(prev => [...prev, {
          file,
          preview: reader.result,
          type: file.type
        }]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    e.target.value = '';
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setFilePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() && selectedFiles.length === 0) return;
    
    setSendingMessage(true);
    try {
      await onSendMessage(newMessage.trim(), selectedFiles);
      setNewMessage("");
      setSelectedFiles([]);
      setFilePreviews([]);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
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
    <div className="rrmm-modal-overlay" onClick={onClose}>
      <div className="rrmm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rrmm-modal-header">
          <div>
            <h2>{type === 'refund' ? 'Refund' : 'Return'} Messages</h2>
            <p className="rrmm-modal-subtitle">
              Order #{orderId?.slice(-8).toUpperCase()}
            </p>
          </div>
          <button className="rrmm-modal-close" onClick={onClose}>
            <FiX />
          </button>
        </div>

        <div className="rrmm-modal-body">
          {loading ? (
            <div className="rrmm-messages-loading">
              <div className="rrmm-loading-spinner" />
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="rrmm-no-messages">
              <FiMessageCircle className="rrmm-no-messages-icon" />
              <p>No messages yet</p>
              <small>Start a conversation about your {type}</small>
            </div>
          ) : (
            <div className="rrmm-messages-list">
              {messages.map((msg, idx) => {
                const isCustomer = msg.senderType === 'customer' || msg.sender === 'customer';

                return (
                  <div
                    key={idx}
                    className={`rrmm-message ${
                      isCustomer ? "rrmm-message-outgoing" : "rrmm-message-incoming"
                    }`}
                  >
                    {!isCustomer && (
                      <div className="rrmm-message-sender">
                        <span className="rrmm-sender-name">Customer Service</span>
                      </div>
                    )}

                    <div className="rrmm-message-content">
                      <div className="rrmm-message-bubble">
                        <p>{msg.content || msg.text}</p>
                        
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="rrmm-message-attachments">
                            {msg.attachments.map((attachment, i) => (
                              <a
                                key={i}
                                href={attachment.url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rrmm-attachment"
                              >
                                {getFileIcon(attachment.type)}
                                <span className="rrmm-attachment-name">{attachment.name}</span>
                                <FiDownload className="rrmm-download-icon" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rrmm-message-footer">
                        <span className="rrmm-message-time">
                          {formatTimestamp(msg.createdAt || msg.timestamp)}
                        </span>
                        {isCustomer && (
                          <span
                            className={`rrmm-message-status ${
                              msg.readBy?.includes('admin') || msg.isRead ? "rrmm-read" : ""
                            }`}
                          >
                            {msg.readBy?.includes('admin') || msg.isRead ? (
                              <>
                                <FiCheck className="rrmm-check" />
                                <FiCheck className="rrmm-check rrmm-check-double" />
                              </>
                            ) : (
                              <FiCheck className="rrmm-check" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {isCustomer && (
                      <div className="rrmm-message-sender">
                        <span className="rrmm-sender-name">You</span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* File Previews */}
          {filePreviews.length > 0 && (
            <div className="rrmm-file-previews">
              {filePreviews.map((item, index) => (
                <div key={index} className="rrmm-file-preview-item">
                  {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                    <img src={item.preview} alt={item.file.name} className="rrmm-preview-image" />
                  ) : (
                    <div className="rrmm-preview-placeholder">
                      {getFileIcon(item.type)}
                    </div>
                  )}
                  <span className="rrmm-file-name">{item.file.name}</span>
                  <button
                    className="rrmm-remove-file"
                    onClick={() => removeFile(index)}
                  >
                    <FiX />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Message Input */}
          <div className="rrmm-message-input-container">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            
            <button
              className="rrmm-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendingMessage || selectedFiles.length >= MAX_FILES}
              title="Attach file"
            >
              <FiPaperclip />
            </button>

            <input
              className="rrmm-message-input"
              placeholder="Type your message..."
              value={newMessage}
              disabled={sendingMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyPress}
            />
            
            <button
              className="rrmm-send-btn"
              onClick={handleSendMessage}
              disabled={(!newMessage.trim() && selectedFiles.length === 0) || sendingMessage}
            >
              <FiSend />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RefundReturnMessagesModal;