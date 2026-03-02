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

/**
 * Shared message thread modal used by both:
 *  - Customer refund/return pages  (type="refund"|"return", currentUserRole="customer")
 *  - Admin refund management panel (type="refund"|"return", currentUserRole="admin")
 *
 * Props
 * ─────
 * isOpen          boolean
 * onClose         () => void
 * orderId         string
 * orderInfo       { orderNumber, customerName, date }   — optional, richer header for admin
 * messages        Message[]
 * loading         boolean
 * onSendMessage   (messageText: string, files: File[]) => Promise<void>
 * onRefresh       () => void   — optional; called when modal opens to re-fetch messages
 * type            "refund" | "return"   default "refund"
 * currentUserRole "customer" | "admin" default "customer"
 *
 * Message shape (from backend after populate)
 * ────────────────────────────────────────────
 * {
 *   senderType:  "customer" | "admin"
 *   sender:      { _id, name, email, role }  (populated ObjectId)
 *   content:     string   ← primary field name used by Mongoose schema
 *   message:     string   ← fallback (some controller paths)
 *   text:        string   ← legacy fallback
 *   attachments: [{ url, filename, fileType, fileSize }]
 *   readBy:      string[]
 *   createdAt:   Date
 * }
 */
function RefundReturnMessagesModal({
  isOpen,
  onClose,
  orderId,
  orderInfo,
  messages = [],
  loading,
  onSendMessage,
  onRefresh,
  type = "refund",
  currentUserRole = "customer",
}) {
  const [newMessage, setNewMessage] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const MAX_FILES = 3;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_FILE_TYPES = {
    images: ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
    videos: ["video/mp4", "video/webm", "video/quicktime"],
    documents: ["application/pdf"],
  };

  // Fix: derived helpers that depend on who is viewing the thread
  const isAdmin = currentUserRole === "admin";

  // Fix: safe type label with fallback so empty-state never shows "your undefined"
  const typeLabel = type === "return" ? "return" : "refund";

  // ── Scroll to latest message ──────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Refresh on open ───────────────────────────────────────────────────────
  // Only call onRefresh if the parent supplied one AND it hasn't already
  // dispatched a fresh fetch before opening the modal. The customer parent
  // (RefundRequest.jsx) already fetches before setting isOpen=true, so it
  // does NOT pass onRefresh. The guard keeps admin (also no onRefresh) safe.
  useEffect(() => {
    if (isOpen && onRefresh) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  // ── File helpers ──────────────────────────────────────────────────────────
  const isFileTypeAllowed = (file) => {
    const all = [
      ...ALLOWED_FILE_TYPES.images,
      ...ALLOWED_FILE_TYPES.videos,
      ...ALLOWED_FILE_TYPES.documents,
    ];
    return all.includes(file.type);
  };

  // Fix: use fileType (backend field name) and fall back to type for
  // locally-selected files before upload (File objects have .type).
  const getFileIcon = (mimeType) => {
    if (ALLOWED_FILE_TYPES.images.includes(mimeType)) return <FiImage />;
    if (ALLOWED_FILE_TYPES.videos.includes(mimeType)) return <FiVideo />;
    return <FiFile />;
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);

    if (selectedFiles.length + files.length > MAX_FILES) {
      alert(`You can only attach up to ${MAX_FILES} files`);
      return;
    }

    const validFiles = files.filter((file) => {
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

    setSelectedFiles((prev) => [...prev, ...validFiles]);

    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreviews((prev) => [
          ...prev,
          { file, preview: reader.result, type: file.type },
        ]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev) => prev.filter((_, i) => i !== index));
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "";
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

  // ── Header text ───────────────────────────────────────────────────────────
  // Fix: use orderInfo when provided (admin path) for a richer header;
  // fall back to orderId slice for the customer path.
  const headerOrderRef = orderInfo?.orderNumber
    ? `#${orderInfo.orderNumber}`
    : orderId
    ? `#${orderId.slice(-8).toUpperCase()}`
    : "";

  const headerSubtitle = isAdmin && orderInfo?.customerName
    ? `${orderInfo.customerName} · Order ${headerOrderRef}`
    : `Order ${headerOrderRef}`;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="rrmm-modal-overlay" onClick={onClose}>
      <div className="rrmm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="rrmm-modal-header">
          <div>
            <h2>
              {type === "return" ? "Return" : "Refund"} Messages
              {isAdmin && (
                <span className="rrmm-admin-badge"> — Admin View</span>
              )}
            </h2>
            <p className="rrmm-modal-subtitle">{headerSubtitle}</p>
          </div>
          <button className="rrmm-modal-close" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div className="rrmm-modal-body">
          {/* Message List */}
          {loading ? (
            <div className="rrmm-messages-loading">
              <div className="rrmm-loading-spinner" />
              <p>Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="rrmm-no-messages">
              <FiMessageCircle className="rrmm-no-messages-icon" />
              <p>No messages yet</p>
              {/* Fix: use typeLabel so this never shows "your undefined" */}
              <small>Start a conversation about your {typeLabel}</small>
            </div>
          ) : (
            <div className="rrmm-messages-list">
              {messages.map((msg, idx) => {
                // Fix: only use senderType for role detection.
                // msg.sender is a populated User object after populate(), so
                // comparing it to the string 'customer' always returns false.
                const senderIsCustomer = msg.senderType === "customer";

                // Fix: perspective-aware bubble alignment.
                // Customer viewer: their own messages (senderType=customer) → right (outgoing)
                // Admin viewer:    their own messages (senderType=admin)    → right (outgoing)
                const isOutgoing = isAdmin ? !senderIsCustomer : senderIsCustomer;

                // Fix: message body field — backend stores as `content`; add
                // `message` and `text` as fallbacks for resilience.
                const messageBody = msg.content || msg.message || msg.text || "";

                // Fix: read-receipt check is perspective-aware.
                // Customer wants to know if admin has read their message.
                // Admin wants to know if customer has read their message.
                const readByOther = isAdmin
                  ? msg.readBy?.includes("customer")
                  : msg.readBy?.includes("admin") || msg.isRead;

                // Sender display name
                // If the sender object is populated use its name; otherwise
                // fall back to role label.
                const senderDisplayName = senderIsCustomer
                  ? msg.sender?.name || "Customer"
                  : msg.sender?.name || "Customer Service";

                return (
                  <div
                    key={msg._id || idx}
                    className={`rrmm-message ${
                      isOutgoing ? "rrmm-message-outgoing" : "rrmm-message-incoming"
                    }`}
                  >
                    {/* Sender label — shown above incoming messages only */}
                    {!isOutgoing && (
                      <div className="rrmm-message-sender">
                        <span className="rrmm-sender-name">
                          {senderDisplayName}
                        </span>
                      </div>
                    )}

                    <div className="rrmm-message-content">
                      <div className="rrmm-message-bubble">
                        {messageBody && <p>{messageBody}</p>}

                        {/* Fix: use attachment.filename and attachment.fileType
                            to match the backend upload response shape:
                            { url, filename, fileType, fileSize } */}
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
                                {getFileIcon(
                                  attachment.fileType || attachment.type || ""
                                )}
                                <span className="rrmm-attachment-name">
                                  {attachment.filename ||
                                    attachment.name ||
                                    "Attachment"}
                                </span>
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

                        {/* Read receipt — only on outgoing messages */}
                        {isOutgoing && (
                          <span
                            className={`rrmm-message-status ${
                              readByOther ? "rrmm-read" : ""
                            }`}
                          >
                            {readByOther ? (
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

                    {/* Sender label — shown below outgoing messages */}
                    {isOutgoing && (
                      <div className="rrmm-message-sender">
                        <span className="rrmm-sender-name">
                          {isAdmin ? "You (Admin)" : "You"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Staged file previews */}
          {filePreviews.length > 0 && (
            <div className="rrmm-file-previews">
              {filePreviews.map((item, index) => (
                <div key={index} className="rrmm-file-preview-item">
                  {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                    <img
                      src={item.preview}
                      alt={item.file.name}
                      className="rrmm-preview-image"
                    />
                  ) : (
                    <div className="rrmm-preview-placeholder">
                      {getFileIcon(item.type)}
                    </div>
                  )}
                  <span className="rrmm-file-name">{item.file.name}</span>
                  <button
                    className="rrmm-remove-file"
                    onClick={() => removeFile(index)}
                    aria-label="Remove file"
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
              style={{ display: "none" }}
            />

            <button
              className="rrmm-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendingMessage || selectedFiles.length >= MAX_FILES}
              title="Attach file"
              type="button"
            >
              <FiPaperclip />
            </button>

            {/* Fix: changed to <textarea> so Shift+Enter line breaks are
                actually visible in the input area, consistent with the
                handleKeyDown behaviour that allows them */}
            <textarea
              className="rrmm-message-input"
              placeholder="Type your message... (Shift+Enter for new line)"
              value={newMessage}
              disabled={sendingMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />

            <button
              className="rrmm-send-btn"
              onClick={handleSendMessage}
              disabled={
                (!newMessage.trim() && selectedFiles.length === 0) ||
                sendingMessage
              }
              type="button"
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