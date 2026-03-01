import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  FiX,
  FiSend,
  FiCheck,
  FiMessageCircle,
} from "react-icons/fi";
import "../componentStyles/MessagesModal.css";

// ─── Date separator helper ───────────────────────────────────
function getDateLabel(dateString) {
  const date = new Date(dateString);
  const now = new Date();

  const toMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (toMidnight(now) - toMidnight(date)) / 86400000
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)  return date.toLocaleDateString("en-US", { weekday: "long" });

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// ─── Inline snake SVG (bypasses Loader's min-height: 50vh container) ─
function SnakeSpinner() {
  return (
    <svg
      className="mm-snake-svg"
      viewBox="0 0 50 50"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Loading messages"
      role="status"
    >
      <circle
        className="mm-snake-track"
        cx="25" cy="25" r="20"
        fill="none"
        strokeWidth="4"
      />
      <circle
        className="mm-snake-arc"
        cx="25" cy="25" r="20"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────
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
  const [newMessage, setNewMessage]  = useState("");
  const [sendingMessage, setSending] = useState(false);

  // FIX #2 + #1: Maintain an internal optimistic message list.
  // On open, seed from the `messages` prop. While sending, we append
  // an optimistic bubble immediately — no spinner flash, no double render.
  const [localMessages, setLocalMessages] = useState([]);
  // Track which message IDs / keys are "new" for slide-in animation
  const [newMsgKeys, setNewMsgKeys] = useState(new Set());

  const listRef   = useRef(null);
  const inputRef  = useRef(null);
  const bottomRef = useRef(null);
  // Tracks whether we've done the initial seed from the messages prop.
  // Prevents the prop-sync from firing during sends/re-renders.
  const seededRef = useRef(false);

  // ── Open / close lifecycle ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      // Reset everything on close
      setSending(false);
      setLocalMessages([]);
      setNewMsgKeys(new Set());
      setNewMessage("");
      seededRef.current = false;
    }
  }, [isOpen]);

  // ── Seed once from prop when messages arrive ─────────────────
  // Parents open the modal with messages=[] and loading=true, then fetch
  // asynchronously and update the messages prop. We watch for that first
  // populated value and seed localMessages exactly once. After seeding,
  // localMessages is self-contained — handleSend manages it directly and
  // no further prop change can trigger a re-seed or glitch.
  useEffect(() => {
    if (!isOpen || seededRef.current) return;
    // Only seed once loading is done and we have the real data
    if (!loading) {
      seededRef.current = true;
      setLocalMessages(messages);
    }
  }, [isOpen, loading, messages]);

  // ── Auto-scroll to bottom whenever messages update ──────────
  useEffect(() => {
    if (!loading && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [localMessages, loading]);

  // ── Focus input when modal opens ────────────────────────────
  useEffect(() => {
    if (isOpen && !loading) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen, loading]);

  // ── Mark as read on open ────────────────────────────────────
  useEffect(() => {
    if (isOpen && order?._id) {
      fetch(`/api/v1/orders/${order._id}/messages/read`, {
        method: "PUT",
        credentials: "include",
      }).catch(() => {});
    }
  }, [isOpen, order?._id]);

  // ── Send handler ────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = newMessage.trim();
    if (!text || !order || sendingMessage) return;

    setSending(true);
    setNewMessage("");

    // Build an optimistic message bubble immediately — no flicker
    const optimisticKey = `optimistic-${Date.now()}`;
    const optimisticMsg = {
      _id: optimisticKey,
      content: text,
      senderType: userType,
      sender: userType,
      isRead: false,
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };

    setLocalMessages((prev) => [...prev, optimisticMsg]);
    setNewMsgKeys((prev) => new Set([...prev, optimisticKey]));

    try {
      const realMsg = await onSendMessage(text);
      // Merge real server fields into the optimistic entry rather than
      // replacing it outright. Replacing changes the _id, which changes
      // the React element key, causing an unmount/remount flash.
      // By keeping the optimistic _id as the key and just patching the
      // fields, the DOM element stays mounted and there is no visible glitch.
      if (realMsg) {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m._id === optimisticKey
              ? { ...realMsg, _id: optimisticKey, _optimistic: false }
              : m
          )
        );
      }
    } catch {
      // Roll back the optimistic message on failure
      setLocalMessages((prev) => prev.filter((m) => m._id !== optimisticKey));
      setNewMessage(text);
    } finally {
      setSending(false);
      // Remove animation class after it finishes
      setTimeout(() => {
        setNewMsgKeys((prev) => {
          const next = new Set(prev);
          next.delete(optimisticKey);
          return next;
        });
      }, 400);
      inputRef.current?.focus();
    }
  }, [newMessage, order, sendingMessage, onSendMessage, userType]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Timestamp formatter ─────────────────────────────────────
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now  = new Date();
    const diffMs   = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs  = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1)  return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs  < 24) return `${diffHrs}h ago`;
    if (diffDays < 7)  return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day:   "numeric",
      year:  date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  // ─── FIX #3: correct isOutgoing logic ────────────────────────
  // A message is "outgoing" (i.e. sent by the current viewer) when:
  //   - viewer is admin   AND senderType is "admin"
  //   - viewer is customer AND senderType is "customer"
  //
  // The old code used `!isAdminMessage` for customers, which meant any
  // message with an empty/undefined senderType was treated as outgoing.
  // Now we require an explicit match so unknown senders always render
  // as incoming.
  const resolveIsOutgoing = (msg) => {
    // Normalise: prefer canonical senderType, fall back to legacy sender field
    const senderType = (msg.senderType || msg.sender || "").toLowerCase();
    if (userType === "admin")    return senderType === "admin";
    if (userType === "customer") return senderType === "customer";
    return false;
  };

  // ── Build messages with date separators ─────────────────────
  const renderMessages = () => {
    const items = [];
    let lastLabel = null;

    localMessages.forEach((msg, idx) => {
      const ts    = msg.createdAt || msg.timestamp;
      const label = ts ? getDateLabel(ts) : null;

      // Inject separator when date changes
      if (label && label !== lastLabel) {
        lastLabel = label;
        items.push(
          <div key={`sep-${idx}`} className="mm-date-separator">
            <span>{label}</span>
          </div>
        );
      }

      const isOutgoing = resolveIsOutgoing(msg);

      const customerName =
        order?.user?.firstName && order?.user?.lastName
          ? `${order.user.firstName} ${order.user.lastName}`
          : order?.user?.name || "Customer";

      let senderName;
      if (isOutgoing) {
        senderName = "You";
      } else {
        senderName = userType === "admin" ? customerName : "Customer Service";
      }

      const animClass = newMsgKeys.has(msg._id) ? " mm-message--new" : "";

      items.push(
        <div
          key={msg._id || msg.id || idx}
          className={`mm-message ${isOutgoing ? "mm-message-outgoing" : "mm-message-incoming"}${animClass}`}
        >
          {!isOutgoing && (
            <div className="mm-avatar">
              {senderName.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="mm-message-content">
            {!isOutgoing && (
              <span className="mm-sender-name">{senderName}</span>
            )}

            <div className="mm-message-bubble">
              <p>{msg.content || msg.text}</p>
            </div>

            <div className={`mm-message-footer ${isOutgoing ? "mm-footer-right" : "mm-footer-left"}`}>
              <span className="mm-message-time">
                {ts ? formatTime(ts) : ""}
              </span>
              {isOutgoing && (
                <span className={`mm-read-receipt ${msg.isRead ? "mm-read" : ""}`}>
                  <FiCheck className="mm-check" />
                  {msg.isRead && <FiCheck className="mm-check mm-check-2" />}
                </span>
              )}
            </div>
          </div>

          {isOutgoing && (
            <div className="mm-avatar mm-avatar-out">
              {userType === "admin" ? "A" : (user?.firstName?.charAt(0) || "U")}
            </div>
          )}
        </div>
      );
    });

    return items;
  };

  if (!isOpen) return null;

  return (
    <div className="mm-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mm-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="mm-header">
          <div className="mm-header-info">
            <div className="mm-header-icon">
              <FiMessageCircle />
            </div>
            <div>
              <h2>Messages</h2>
              <p className="mm-header-sub">
                Order #{order?._id?.slice(-8).toUpperCase()}
              </p>
            </div>
          </div>
          <button className="mm-close" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="mm-body">

          {/* Loading state — only shown on initial load, never during send */}
          {loading ? (
            <div className="mm-loading">
              <SnakeSpinner />
              <p>Loading messages…</p>
            </div>
          ) : localMessages.length === 0 ? (
            <div className="mm-empty">
              <div className="mm-empty-icon">
                <FiMessageCircle />
              </div>
              <p>No messages yet</p>
              <small>Send a message to start the conversation</small>
            </div>
          ) : (
            <div className="mm-list" ref={listRef}>
              {renderMessages()}
              {/* Invisible anchor for auto-scroll */}
              <div ref={bottomRef} style={{ height: 1 }} />
            </div>
          )}

          {/* ── Input bar — always visible, never shows spinner ── */}
          <div className="mm-input-bar">
            <input
              ref={inputRef}
              className="mm-input"
              placeholder="Type a message…"
              value={newMessage}
              disabled={sendingMessage || loading}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
            />
            <button
              className="mm-send"
              onClick={handleSend}
              disabled={!newMessage.trim() || sendingMessage || loading}
              aria-label="Send message"
            >
              {sendingMessage ? (
                // Tiny inline spinner on the send button only — modal body untouched
                <svg
                  style={{ width: 14, height: 14, animation: "mm-rotate 0.8s linear infinite" }}
                  viewBox="0 0 50 50"
                >
                  <circle cx="25" cy="25" r="18" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="5" />
                  <circle
                    cx="25" cy="25" r="18"
                    fill="none" stroke="#fff" strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray="40 90"
                    strokeDashoffset="0"
                  />
                </svg>
              ) : (
                <FiSend />
              )}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default MessagesModal;