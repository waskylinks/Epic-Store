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
  FiAlertTriangle,
  FiRefreshCw,
  FiChevronUp,
} from "react-icons/fi";
import "../OrderStyles/RefundReturnMessagesModal.css";

/**
 * ReturnMessagesModal
 * Message thread modal for return conversations — customer & admin.
 *
 * Props
 * ─────
 * isOpen              boolean
 * onClose             () => void
 * orderId             string
 * orderInfo           { orderNumber, customerName }  — optional, admin enrichment
 * messages            Message[]
 * loading             boolean        — spinner on initial empty load only
 * hasMoreMessages     boolean        — show "Load earlier" button at top
 * totalMessages       number         — total message count from backend
 * onSendMessage       (text: string, files: File[], pendingUrls: string[]) => Promise<void>
 * onRefresh           () => void     — called when modal opens
 * onLoadMore          () => void     — called when "Load earlier" clicked
 * pendingAttachments  string[]       — Cloudinary URLs from a failed send (retry path)
 * errorStage          "upload"|"send"|null  — drives retry banner copy
 * onClearPending      () => void     — called when user dismisses retry banner
 * currentUserRole     "customer"|"admin"    default "customer"
 * isSendingExternal   boolean        — FIX BUG-P1: slice-level messageSendLoading
 *                                      passed from parent; disables send button
 *                                      when a send is in-flight from outside the
 *                                      modal (e.g. retry banner tap while modal
 *                                      local state has already been reset).
 *
 * Message shape (return schema)
 * ──────────────────────────────
 * { _id, senderType: "customer"|"admin",
 *   sender: { _id, firstName, lastName, email, role },
 *   content,                        ← return messages use "content" not "message"
 *   attachments: [{ url, filename, fileType, fileSize }],
 *   isRead, readAt, createdAt }
 */

// ── Module-level constants ────────────────────────────────────────────────────
const MAX_FILES     = 8;
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

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
 * Date separator label: "Today", "Yesterday", "Mon, Jan 12", or "Mon, Jan 12 2023"
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

/**
 * isDifferentDay
 * FIX BUG-M2 — added explicit null/undefined guards on both arguments.
 * Previously, passing an optimistic message with no createdAt yet would
 * cause `new Date(undefined).toDateString()` to return "Invalid Date",
 * which always compares as different from any real date string, inserting
 * a spurious date separator above every optimistic message.
 */
const isDifferentDay = (a, b) => {
  if (!a || !b) return true;
  const da = new Date(a);
  const db = new Date(b);
  // Guard against invalid timestamps (e.g. optimistic messages pre-server round-trip)
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return true;
  return da.toDateString() !== db.toDateString();
};

const getSenderDisplayName = (msg) => {
  const { firstName, lastName } = msg.sender ?? {};
  if (firstName || lastName) return `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return msg.senderType === "customer" ? "Customer" : "Support";
};

const getFileIcon = (mimeType = "") => {
  if (ALLOWED_FILE_TYPES.images.includes(mimeType))  return <FiImage />;
  if (ALLOWED_FILE_TYPES.videos.includes(mimeType))  return <FiVideo />;
  return <FiFile />;
};

/**
 * Returns the bubble's position within its consecutive same-sender group.
 * Drives border-radius CSS: "solo" | "first" | "middle" | "last"
 *
 * FIX BUG-M2 — isDifferentDay now handles null createdAt safely (see above),
 * so getGroupPosition no longer needs its own null guard; isDifferentDay
 * returns true for any missing timestamp, correctly breaking the group.
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

// ── Component ─────────────────────────────────────────────────────────────────
function ReturnMessagesModal({
  isOpen,
  onClose,
  orderId,
  orderInfo,
  messages            = [],
  loading             = false,
  hasMoreMessages     = false,
  totalMessages       = 0,
  onSendMessage,
  onRefresh,
  onLoadMore,
  pendingAttachments  = [],
  errorStage          = null,
  onClearPending,
  currentUserRole     = "customer",
  // FIX BUG-P1: slice-level messageSendLoading passed from ReturnRequest.jsx.
  // Disables the send button and textarea when a send is already in-flight
  // at the Redux level — covers the edge case where the modal's own local
  // isSendingRef has been reset (e.g. after an unmount/remount) but the
  // slice thunk is still pending.
  isSendingExternal   = false,
}) {
  const [newMessage,    setNewMessage]    = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews,  setFilePreviews]  = useState([]);
  const [isSending,     setIsSending]     = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);

  const messagesListRef        = useRef(null);
  const messagesEndRef         = useRef(null);
  const fileInputRef           = useRef(null);
  const textareaRef            = useRef(null);
  const isSendingRef           = useRef(false);
  const scrollHeightBeforeLoad = useRef(0);

  const isAdmin = currentUserRole === "admin";

  // FIX BUG-P1: combined send-disabled flag — true when EITHER the local send
  // ref is active OR the slice reports messageSendLoading. Centralising this
  // into one boolean keeps all disabled checks consistent.
  const isSendDisabled = isSending || isSendingExternal;

  // ── Scroll helpers ───────────────────────────────────────────────────────
  const scrollToBottom = useCallback((behavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    const list = messagesListRef.current;
    if (!list) return;
    const raf = requestAnimationFrame(() => {
      const nearBottom =
        list.scrollHeight - list.scrollTop - list.clientHeight < 120;
      if (nearBottom) scrollToBottom();
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!loadingMore || !messagesListRef.current) return;
    const list = messagesListRef.current;
    const newScrollHeight = list.scrollHeight;
    list.scrollTop = newScrollHeight - scrollHeightBeforeLoad.current;
    setLoadingMore(false);
  }, [messages, loadingMore]);

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

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => scrollToBottom("auto"));
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) {
      setNewMessage("");
      setSelectedFiles([]);
      setFilePreviews([]);
      setIsSending(false);
      setShowScrollBtn(false);
      setLoadingMore(false);
      isSendingRef.current = false;
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  }, [isOpen]);

  // ── Textarea auto-grow ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [newMessage]);

  // ── File handling ────────────────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = "";

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

  // ── Load earlier ─────────────────────────────────────────────────────────
  const handleLoadMore = useCallback(() => {
    if (!onLoadMore || loadingMore) return;
    if (messagesListRef.current) {
      scrollHeightBeforeLoad.current = messagesListRef.current.scrollHeight;
    }
    setLoadingMore(true);
    onLoadMore();
  }, [onLoadMore, loadingMore]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    const trimmed = newMessage.trim();
    if (
      (!trimmed && selectedFiles.length === 0 && pendingAttachments.length === 0) ||
      isSendingRef.current ||
      isSendingExternal   // FIX BUG-P1: also bail if slice-level send is in flight
    ) return;

    const capturedText     = trimmed;
    const capturedFiles    = [...selectedFiles];
    const capturedPreviews = [...filePreviews];

    isSendingRef.current = true;

    setNewMessage("");
    setSelectedFiles([]);
    setFilePreviews([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsSending(true);

    try {
      await onSendMessage(capturedText, capturedFiles, pendingAttachments);
      requestAnimationFrame(() => scrollToBottom());
    } catch {
      setNewMessage(capturedText);
      setSelectedFiles(capturedFiles);
      setFilePreviews(capturedPreviews);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [newMessage, selectedFiles, filePreviews, pendingAttachments, onSendMessage, scrollToBottom, isSendingExternal]);

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

  const showInitialLoader = loading && messages.length === 0;

  const retryBannerText = errorStage === "upload"
    ? "File upload failed. Re-select your files and try again."
    : errorStage === "send" && pendingAttachments.length > 0
    ? `Message failed to send. Your ${pendingAttachments.length} file(s) are saved — tap Send to retry.`
    : errorStage === "send"
    ? "Message failed to send. Tap Send to retry."
    : null;

  // Unread count: messages from the other party not yet read.
  const unreadCount = messages.filter(
    (msg) =>
      msg.senderType !== (isAdmin ? "admin" : "customer") && !msg.isRead
  ).length;

  return (
    <div className="rrmm-modal-overlay" onClick={onClose}>
      <div className="rrmm-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="rrmm-modal-header">
          <div>
            {/* Title row — h2 already has the coral bar via ::before in CSS */}
            <h2>
              Return Messages
              {isAdmin && (
                <span style={{ fontWeight: 400, color: "var(--rrmm-text-muted)" }}>
                  {" — Admin View"}
                </span>
              )}
              {unreadCount > 0 && (
                <span
                  className="rr-message-badge"
                  aria-label={`${unreadCount} unread`}
                  style={{ position: "static", marginLeft: 8 }}
                >
                  {unreadCount}
                </span>
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

          {/* ── Retry / Error banner ──────────────────────────────────── */}
          {retryBannerText && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                background: "var(--rrmm-danger-bg)",
                borderBottom: "1px solid var(--rrmm-border)",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--rrmm-danger-text)",
                flexShrink: 0,
              }}
            >
              <FiAlertTriangle style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{retryBannerText}</span>
              <div style={{ display: "flex", gap: 6 }}>
                {errorStage === "send" && (
                  <button
                    onClick={handleSendMessage}
                    disabled={isSendDisabled}  // FIX BUG-P1: use combined flag
                    type="button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 10px",
                      background: "var(--rrmm-coral)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "var(--rrmm-radius-xs)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    <FiRefreshCw /> Retry
                  </button>
                )}
                <button
                  onClick={onClearPending}
                  type="button"
                  aria-label="Dismiss"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--rrmm-danger-text)",
                  }}
                >
                  <FiX />
                </button>
              </div>
            </div>
          )}

          {/* ── Scrollable message area ───────────────────────────────── */}
          <div className="rrmm-messages-list" ref={messagesListRef}>

            {/* Load-earlier button */}
            {hasMoreMessages && !showInitialLoader && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  type="button"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 14px",
                    background: "var(--rrmm-card)",
                    border: "1px solid var(--rrmm-border)",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--rrmm-text-sec)",
                    cursor: loadingMore ? "not-allowed" : "pointer",
                    opacity: loadingMore ? 0.6 : 1,
                  }}
                >
                  {loadingMore ? (
                    <><FiClock className="rrmm-spin" /> Loading…</>
                  ) : (
                    <>
                      <FiChevronUp />
                      Load earlier
                      {totalMessages > messages.length && (
                        <span style={{ opacity: 0.6 }}>
                          ({totalMessages - messages.length} more)
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
            )}

            {showInitialLoader ? (
              <div className="rrmm-messages-loading">
                <div className="rrmm-loading-spinner" />
                <p>Loading messages…</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="rrmm-no-messages">
                <FiMessageCircle className="rrmm-no-messages-icon" />
                <p>No messages yet</p>
                <small>Start a conversation about your return</small>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  const senderIsCustomer = msg.senderType === "customer";
                  const isOutgoing = isAdmin ? !senderIsCustomer : senderIsCustomer;

                  const messageBody = msg.content || msg.message || msg.text || "";
                  const readByOther = msg.isRead === true;
                  const groupPos    = getGroupPosition(messages, idx);

                  const showSenderName =
                    !isOutgoing && (groupPos === "first" || groupPos === "solo");

                  const prevMsg  = messages[idx - 1];
                  const showDate =
                    idx === 0 || isDifferentDay(prevMsg?.createdAt, msg.createdAt);

                  return (
                    <React.Fragment key={msg._id || idx}>
                      {showDate && (
                        <div
                          role="separator"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            margin: "8px 0",
                          }}
                        >
                          <span style={{ flex: 1, height: 1, background: "var(--rrmm-border)" }} />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "var(--rrmm-text-muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatDateSeparator(msg.createdAt)}
                          </span>
                          <span style={{ flex: 1, height: 1, background: "var(--rrmm-border)" }} />
                        </div>
                      )}

                      <div
                        className={[
                          "rrmm-message",
                          isOutgoing ? "rrmm-message-outgoing" : "rrmm-message-incoming",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {/* CSS expects .rrmm-message-content wrapping content + footer */}
                        <div className="rrmm-message-content">
                          {showSenderName && (
                            <span className="rrmm-message-sender">
                              {getSenderDisplayName(msg)}
                            </span>
                          )}

                          <div className="rrmm-message-bubble">
                            {messageBody && (
                              <p>{messageBody}</p>
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
                          </div>

                          {/* Footer: time + read receipt */}
                          <div className="rrmm-message-footer">
                            <span style={{ fontSize: "10.5px", fontWeight: 500 }}>
                              {formatMessageTime(msg.createdAt || msg.timestamp)}
                            </span>

                            {isOutgoing && (
                              <span
                                className={`rrmm-message-status${readByOther ? " rrmm-read" : ""}`}
                                aria-label={readByOther ? "Read" : "Sent"}
                              >
                                <FiCheck className="rrmm-check" />
                                {readByOther && (
                                  <FiCheck className="rrmm-check rrmm-check-double" />
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
              </>
            )}

            {/* Scroll-to-bottom button */}
            {showScrollBtn && (
              <button
                onClick={() => scrollToBottom()}
                aria-label="Scroll to latest message"
                type="button"
                style={{
                  position: "sticky",
                  bottom: 12,
                  alignSelf: "flex-end",
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--rrmm-card)",
                  border: "1px solid var(--rrmm-border)",
                  boxShadow: "var(--rrmm-shadow)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "var(--rrmm-text-sec)",
                  marginLeft: "auto",
                  marginRight: 4,
                }}
              >
                <FiChevronDown />
              </button>
            )}
          </div>

          {/* ── Staged file previews ──────────────────────────────────── */}
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

          {/* ── Input bar ─────────────────────────────────────────────── */}
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
              disabled={selectedFiles.length >= MAX_FILES || isSendDisabled}  // FIX BUG-P1
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
              disabled={isSendDisabled}  // FIX BUG-P1: use combined flag
              rows={1}
            />

            <button
              className="rrmm-send-btn"
              onClick={handleSendMessage}
              disabled={
                (!newMessage.trim() &&
                  selectedFiles.length === 0 &&
                  pendingAttachments.length === 0) ||
                isSendDisabled  // FIX BUG-P1: use combined flag
              }
              type="button"
              aria-label="Send message"
            >
              {isSendDisabled
                ? <FiClock className="rrmm-spin" />
                : <FiSend />
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReturnMessagesModal;