import React, { useState, useEffect, useRef, useCallback } from "react";
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
  FiChevronDown,
  FiClock,
} from "react-icons/fi";
import "../OrderStyles/RefundReturnMessagesModal.css";

/**
 * Shared message thread modal — customer & admin.
 *
 * Props
 * ─────
 * isOpen          boolean
 * onClose         () => void
 * orderId         string
 * orderInfo       { orderNumber, customerName }  — optional, admin enrichment
 * messages        Message[]
 * loading         boolean   — spinner shown only on initial empty load
 * onSendMessage   (text: string, files: File[]) => Promise<void>
 * onRefresh       () => void   — called when modal opens
 * type            "refund" | "return"    default "refund"
 * currentUserRole "customer" | "admin"  default "customer"
 *
 * Message shape
 * ─────────────
 * { _id, senderType, sender: {_id,firstName,lastName,email,role},
 *   message, content, attachments:[{url,filename,fileType,fileSize}],
 *   isRead, readAt, createdAt }
 */

// ── Module-level constants (stable across renders) ───────────────────────────
const MAX_FILES     = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_FILE_TYPES = {
  images:    ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
  videos:    ["video/mp4", "video/webm", "video/quicktime"],
  documents: ["application/pdf"],
};
const ALL_ALLOWED = [
  ...ALLOWED_FILE_TYPES.images,
  ...ALLOWED_FILE_TYPES.videos,
  ...ALLOWED_FILE_TYPES.documents,
];

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * WhatsApp-style timestamp:
 *   Today      → "14:32"
 *   Yesterday  → "Yesterday 14:32"
 *   Same year  → "Jan 12 14:32"
 *   Older      → "Jan 12 2023 14:32"
 */
const formatMessageTime = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now  = new Date();

  const hhmm = date.toLocaleTimeString("en-US", {
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (date.toDateString() === now.toDateString()) return hhmm;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${hhmm}`;

  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
    year:  date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${datePart} ${hhmm}`;
};

/**
 * Date separator label:
 *   "Today", "Yesterday", "Mon, Jan 12", or "Mon, Jan 12 2023"
 */
const formatDateSeparator = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now  = new Date();

  if (date.toDateString() === now.toDateString()) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    year:    date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const isDifferentDay = (a, b) => {
  if (!a || !b) return true;
  return new Date(a).toDateString() !== new Date(b).toDateString();
};

const getSenderDisplayName = (msg) => {
  const { firstName, lastName } = msg.sender ?? {};
  if (firstName || lastName) {
    return `${firstName ?? ""} ${lastName ?? ""}`.trim();
  }
  return msg.senderType === "customer" ? "Customer" : "Support";
};

const getFileIcon = (mimeType = "") => {
  if (ALLOWED_FILE_TYPES.images.includes(mimeType)) return <FiImage />;
  if (ALLOWED_FILE_TYPES.videos.includes(mimeType)) return <FiVideo />;
  return <FiFile />;
};

/**
 * Returns the position of message[idx] within its consecutive same-sender group.
 * Used to apply the correct border-radius CSS class.
 * "solo" | "first" | "middle" | "last"
 */
const getGroupPosition = (messages, idx) => {
  const cur  = messages[idx];
  const prev = messages[idx - 1];
  const next = messages[idx + 1];

  const samePrev =
    prev &&
    prev.senderType === cur.senderType &&
    !isDifferentDay(prev.createdAt, cur.createdAt);

  const sameNext =
    next &&
    next.senderType === cur.senderType &&
    !isDifferentDay(cur.createdAt, next.createdAt);

  if (!samePrev && !sameNext) return "solo";
  if (!samePrev &&  sameNext) return "first";
  if ( samePrev &&  sameNext) return "middle";
  return "last";
};

// ── Component ────────────────────────────────────────────────────────────────
function RefundReturnMessagesModal({
  isOpen,
  onClose,
  orderId,
  orderInfo,
  messages = [],
  loading,
  onSendMessage,
  onRefresh,
  type            = "refund",
  currentUserRole = "customer",
}) {
  const [newMessage,    setNewMessage]    = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews,  setFilePreviews]  = useState([]);
  const [isSending,     setIsSending]     = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const messagesListRef = useRef(null);
  const messagesEndRef  = useRef(null);
  const fileInputRef    = useRef(null);
  const textareaRef     = useRef(null);
  // FIX-10: ref-based send guard. setState is async so isSending state
  // is still false in a synchronous second call (e.g. two rapid Enter presses).
  // The ref is set synchronously before await, so the second call is blocked.
  const isSendingRef    = useRef(false);

  const isAdmin   = currentUserRole === "admin";
  const typeLabel = type === "return" ? "return" : "refund";

  // ── Scroll helpers ───────────────────────────────────────────────────────
  const scrollToBottom = useCallback((behavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Auto-scroll to bottom when new messages arrive — only if already near bottom.
  // FIX-7: defer via rAF so the new bubble has painted and scrollHeight is updated
  // before the nearBottom check runs. Without rAF the old scrollHeight is used
  // and the check can incorrectly conclude the user has scrolled away.
  useEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const raf = requestAnimationFrame(() => {
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
      if (nearBottom) scrollToBottom();
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, scrollToBottom]);

  // Show/hide scroll-to-bottom chevron.
  // FIX-8: read ref inside the handler rather than capturing it at effect-time.
  // Avoids stale-ref issues if the DOM node is replaced (HMR / StrictMode).
  useEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const handleScroll = () => {
      const el = messagesListRef.current;
      if (!el) return;
      setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
    };
    list.addEventListener("scroll", handleScroll, { passive: true });
    return () => list.removeEventListener("scroll", handleScroll);
  }, [isOpen]);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && onRefresh) onRefresh();
  }, [isOpen, onRefresh]);

  // Instant scroll on open (before animation)
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [isOpen, scrollToBottom]);

  // Reset transient state on close.
  // FIX-9: also reset textarea height so re-opening the modal after typing
  // a multi-line message doesn't show a tall empty textarea.
  useEffect(() => {
    if (!isOpen) {
      setNewMessage("");
      setSelectedFiles([]);
      setFilePreviews([]);
      setIsSending(false);
      setShowScrollBtn(false);
      isSendingRef.current = false;
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  }, [isOpen]);

  // ── Textarea auto-grow ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`; // cap ~5 lines
  }, [newMessage]);

  // ── File handling ────────────────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ""; // allow reselecting the same file after removal

    if (selectedFiles.length + files.length > MAX_FILES) {
      alert(`You can only attach up to ${MAX_FILES} files`);
      return;
    }

    const validFiles = files.filter((file) => {
      if (!ALL_ALLOWED.includes(file.type)) {
        alert(`${file.name} is not a supported file type`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} exceeds the 10 MB limit`);
        return false;
      }
      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    validFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        setFilePreviews((prev) => [
          ...prev,
          { file, preview: reader.result, type: file.type },
        ]);
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev)  => prev.filter((_, i) => i !== index));
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSendMessage = async () => {
    const trimmed = newMessage.trim();
    // FIX-10: check isSendingRef.current (synchronous) FIRST before the async
    // isSending state. Two rapid Enter presses both read isSending=false from
    // the same render closure, so the state check alone doesn't prevent the
    // second call from slipping through. The ref is set synchronously below.
    if ((!trimmed && selectedFiles.length === 0) || isSendingRef.current) return;

    // Capture before clearing — all three restored together on failure
    const capturedText     = trimmed;
    const capturedFiles    = [...selectedFiles];
    const capturedPreviews = [...filePreviews];

    // Set ref synchronously — blocks any re-entrant call in the same tick
    isSendingRef.current = true;

    // Clear immediately for instant feedback (WhatsApp behaviour)
    setNewMessage("");
    setSelectedFiles([]);
    setFilePreviews([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsSending(true);

    try {
      await onSendMessage(capturedText, capturedFiles);
      requestAnimationFrame(() => scrollToBottom());
    } catch (err) {
      // Restore all input state so the user doesn't lose their message or files
      setNewMessage(capturedText);
      setSelectedFiles(capturedFiles);
      setFilePreviews(capturedPreviews);
      console.error("Send message error:", err);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ── Early exit ───────────────────────────────────────────────────────────
  if (!isOpen) return null;

  const headerOrderRef = orderInfo?.orderNumber
    ? `#${orderInfo.orderNumber}`
    : orderId
    ? `#${orderId.slice(-8).toUpperCase()}`
    : "";

  const headerSubtitle =
    isAdmin && orderInfo?.customerName
      ? `${orderInfo.customerName} · Order ${headerOrderRef}`
      : `Order ${headerOrderRef}`;

  // Spinner only on the very first load when there is nothing to show yet.
  // Background refreshes are silent — the list stays visible.
  const showInitialLoader = loading && messages.length === 0;

  return (
    <div className="rrmm-modal-overlay" onClick={onClose}>
      <div className="rrmm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="rrmm-modal-header">
          <div className="rrmm-header-info">
            <h2 className="rrmm-header-title">
              {type === "return" ? "Return" : "Refund"} Messages
              {isAdmin && (
                <span className="rrmm-admin-badge"> — Admin View</span>
              )}
            </h2>
            <p className="rrmm-modal-subtitle">{headerSubtitle}</p>
          </div>
          <button
            className="rrmm-modal-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            <FiX />
          </button>
        </div>

        <div className="rrmm-modal-body">

          {/* Scrollable message area */}
          <div className="rrmm-messages-scroll" ref={messagesListRef}>
            {showInitialLoader ? (
              <div className="rrmm-messages-loading">
                <div className="rrmm-loading-spinner" />
                <p>Loading messages…</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="rrmm-no-messages">
                <FiMessageCircle className="rrmm-no-messages-icon" />
                <p>No messages yet</p>
                <small>Start a conversation about your {typeLabel}</small>
              </div>
            ) : (
              <div className="rrmm-messages-list">
                {messages.map((msg, idx) => {
                  const senderIsCustomer = msg.senderType === "customer";
                  const isOutgoing       = isAdmin
                    ? !senderIsCustomer   // admin's own messages are outgoing for admin
                    : senderIsCustomer;   // customer's own messages are outgoing for customer

                  const messageBody = msg.message || msg.content || msg.text || "";
                  const readByOther = msg.isRead === true;
                  const groupPos    = getGroupPosition(messages, idx);

                  // Show sender name only on the first bubble of an incoming group
                  const showSenderName =
                    !isOutgoing && (groupPos === "first" || groupPos === "solo");

                  // Date separator before the first message of each calendar day
                  const prevMsg  = messages[idx - 1];
                  const showDate = idx === 0 || isDifferentDay(prevMsg?.createdAt, msg.createdAt);

                  return (
                    <React.Fragment key={msg._id || idx}>
                      {showDate && (
                        // FIX-11: aria-label removed from wrapper div — screen readers
                        // would read it AND the visible span text, causing duplication.
                        // The span's visible text is the correct and sufficient label.
                        <div className="rrmm-date-separator" role="separator">
                          <span className="rrmm-date-separator-label">
                            {formatDateSeparator(msg.createdAt)}
                          </span>
                        </div>
                      )}

                      <div
                        className={[
                          "rrmm-message",
                          isOutgoing
                            ? "rrmm-message-outgoing"
                            : "rrmm-message-incoming",
                          `rrmm-group-${groupPos}`,
                        ].join(" ")}
                      >
                        {/* Incoming sender name — first bubble of group only */}
                        {showSenderName && (
                          <span className="rrmm-sender-name">
                            {getSenderDisplayName(msg)}
                          </span>
                        )}

                        <div className="rrmm-message-bubble">
                          {messageBody && (
                            <p className="rrmm-message-text">{messageBody}</p>
                          )}

                          {msg.attachments?.length > 0 && (
                            <div className="rrmm-message-attachments">
                              {msg.attachments.map((att, i) => (
                                <a
                                  key={i}
                                  href={att.url}
                                  download
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rrmm-attachment"
                                >
                                  {getFileIcon(att.fileType || att.type)}
                                  <span className="rrmm-attachment-name">
                                    {att.filename || att.name || "Attachment"}
                                  </span>
                                  <FiDownload className="rrmm-download-icon" />
                                </a>
                              ))}
                            </div>
                          )}

                          {/* Time + read receipt — inside bubble, bottom-right */}
                          <div className="rrmm-message-meta">
                            <span className="rrmm-message-time">
                              {formatMessageTime(msg.createdAt || msg.timestamp)}
                            </span>

                            {/* Read receipt only on outgoing bubbles.
                                NO "You" label — alignment makes authorship obvious. */}
                            {isOutgoing && (
                              <span
                                className={`rrmm-ticks ${readByOther ? "rrmm-ticks-read" : ""}`}
                                aria-label={readByOther ? "Read" : "Sent"}
                              >
                                <FiCheck className="rrmm-tick" />
                                {readByOther && (
                                  <FiCheck className="rrmm-tick rrmm-tick-overlap" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Scroll-to-bottom button */}
            {showScrollBtn && (
              <button
                className="rrmm-scroll-to-bottom"
                onClick={() => scrollToBottom()}
                aria-label="Scroll to latest message"
                type="button"
              >
                <FiChevronDown />
              </button>
            )}
          </div>

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
                    type="button"
                  >
                    <FiX />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
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
              disabled={selectedFiles.length >= MAX_FILES || isSending}
              title="Attach file"
              type="button"
            >
              <FiPaperclip />
            </button>

            <textarea
              ref={textareaRef}
              className="rrmm-message-input"
              placeholder="Message… (Enter to send, Shift+Enter for new line)"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              rows={1}
            />

            <button
              className={`rrmm-send-btn${isSending ? " rrmm-send-btn-sending" : ""}`}
              onClick={handleSendMessage}
              disabled={(!newMessage.trim() && selectedFiles.length === 0) || isSending}
              type="button"
              aria-label="Send message"
            >
              {isSending ? <FiClock className="rrmm-spin" /> : <FiSend />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RefundReturnMessagesModal;