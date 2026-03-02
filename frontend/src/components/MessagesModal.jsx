import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  FiX,
  FiSend,
  FiCheck,
  FiMessageCircle,
  FiAlertCircle,
  FiRefreshCw,
} from "react-icons/fi";
import "../componentStyles/MessagesModal.css";

// ─── Date separator helper ───────────────────────────────────
function getDateLabel(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const toMidnight = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Math.floor prevents DST off-by-one where midnight messages
  // could flip between "Today" and "Yesterday" with Math.round
  const diffDays = Math.floor(
    (toMidnight(now) - toMidnight(date)) / 86400000
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)
    return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// ─── formatTime — defined outside component ───────────────────
// Pure function — no component state, no reason to recreate on every render.
// The live-update interval inside the component re-renders on a 60s cadence
// so "Just now" → "1m ago" etc. stays fresh without stale closures.
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// ─── Inline snake SVG ────────────────────────────────────────
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
        cx="25"
        cy="25"
        r="20"
        fill="none"
        strokeWidth="4"
      />
      <circle
        className="mm-snake-arc"
        cx="25"
        cy="25"
        r="20"
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
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSending] = useState(false);
  const [localMessages, setLocalMessages] = useState([]);
  const [newMsgKeys, setNewMsgKeys] = useState(new Set());
  const [failedMsgKeys, setFailedMsgKeys] = useState(new Set());
  // Dummy tick — incremented every 60s to keep relative timestamps live
  const [, setTick] = useState(0);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  // ─── THE FIX FOR THE 2-SECOND GLITCH ────────────────────────
  // Root cause: the old code had two separate effects — a "seed" effect and
  // a "merge incoming" effect. Both fired in the same React commit when
  // `loading` flipped to false. The seed called setLocalMessages(messages).
  // The merge effect ran immediately after, but because setState is async,
  // its `prev` closure still saw [] (the pre-seed state). So existingIds was
  // an empty Set, and every fetched message passed the filter — duplicating
  // the entire message list. That's the visible jump ~2 seconds after open.
  //
  // Fix: replace both effects with a single effect that uses seenIdsRef — a
  // ref (synchronous, not async) that tracks which message IDs have already
  // been added to localMessages. On the first run all messages are new; on
  // subsequent runs only genuinely new ones are appended. No race condition.
  const seenIdsRef = useRef(new Set());

  // Store all pending timeout IDs so we can cancel them on close/unmount
  const timeoutRefs = useRef([]);

  // ── Live timestamp refresh every 60s ────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [isOpen]);

  // ── Open / close lifecycle ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setSending(false);
      setLocalMessages([]);
      setNewMsgKeys(new Set());
      setFailedMsgKeys(new Set());
      setNewMessage("");
      // Clear the seenIds ref so next open starts fresh
      seenIdsRef.current = new Set();
      // Cancel any pending animation timeouts
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current = [];
    }
  }, [isOpen]);

  // ── Escape key closes modal ──────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Focus trap ───────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const modal = document.querySelector(".mm-modal");
    if (!modal) return;
    const focusable = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [isOpen, loading]);

  // ── THE UNIFIED SEED + MERGE EFFECT ─────────────────────────
  // Replaces the old separate seed and FIX #8 effects.
  // Runs whenever the parent `messages` prop changes (initial load
  // and any subsequent polling updates). Uses seenIdsRef — a synchronous
  // ref — to track what's already been added, so there's never a race
  // with React's async state queue. Optimistic messages added by handleSend
  // are registered in seenIdsRef immediately on creation, so they are
  // never accidentally duplicated by this effect.
  useEffect(() => {
    if (!isOpen || loading) return;

    const incoming = messages.filter(
      (m) => m._id && !seenIdsRef.current.has(m._id)
    );
    if (incoming.length === 0) return;

    // Register synchronously before the state update so a re-run
    // of this effect (e.g. from a fast poll) can't double-add
    incoming.forEach((m) => seenIdsRef.current.add(m._id));
    setLocalMessages((prev) => [...prev, ...incoming]);
  }, [isOpen, loading, messages]);

  // ── Scroll to bottom after messages update ───────────────────
  // useLayoutEffect fires after DOM paint — unlike useEffect, it won't
  // no-op when the new messages haven't been rendered yet
  useLayoutEffect(() => {
    if (!loading && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [localMessages, loading]);

  // ── Focus input on open ──────────────────────────────────────
  useEffect(() => {
    if (isOpen && !loading) {
      const id = setTimeout(() => inputRef.current?.focus(), 120);
      timeoutRefs.current.push(id);
    }
  }, [isOpen, loading]);

  // ── Mark as read — only when unread messages exist ──────────
  useEffect(() => {
    if (!isOpen || !order?._id) return;
    const hasUnread = messages.some(
      (m) =>
        !m.isRead &&
        (m.senderType || m.sender || "").toLowerCase() !== userType
    );
    if (!hasUnread) return;
    fetch(`/api/v1/orders/${order._id}/messages/read`, {
      method: "PUT",
      credentials: "include",
    }).catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[MessagesModal] mark-as-read failed:", err);
      }
    });
  }, [isOpen, order?._id, messages, userType]);

  // ── Dev warning for unknown userType ────────────────────────
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" &&
      userType !== "admin" &&
      userType !== "customer"
    ) {
      console.warn(
        `[MessagesModal] Unknown userType "${userType}". ` +
          `Expected "admin" or "customer". All messages will render as incoming.`
      );
    }
  }, [userType]);

  // ── Send handler ─────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = newMessage.trim();
    if (!text || !order || sendingMessage) return;

    setSending(true);
    setNewMessage("");

    const optimisticKey = `optimistic-${Date.now()}`;
    const optimisticMsg = {
      _id: optimisticKey,
      content: text,
      senderType: userType,
      sender: userType,
      isRead: false,
      createdAt: new Date().toISOString(),
      _optimistic: true,
      _failed: false,
    };

    // Register the optimistic ID synchronously so the unified effect
    // above never treats it as an "incoming" message from the parent prop
    seenIdsRef.current.add(optimisticKey);
    setLocalMessages((prev) => [...prev, optimisticMsg]);
    setNewMsgKeys((prev) => new Set([...prev, optimisticKey]));

    try {
      const realMsg = await onSendMessage(text);

      // ── CRITICAL: register the real server ID BEFORE any setState call ──
      // If we register after setLocalMessages, React can flush the state
      // update and re-run the unified seed/merge effect before this line
      // executes. The effect would see the real _id as unknown and append
      // a second bubble — the visible duplicate glitch.
      // Registering here (synchronously, before any setState) means the
      // ref is updated in the same JS microtask as the await resolution,
      // so the effect can never race ahead of it.
      if (realMsg?._id) {
        seenIdsRef.current.add(realMsg._id);
      }

      // Patch the optimistic entry with server fields.
      // We keep the optimistic _id as the React key — replacing it would
      // cause an unmount/remount flash. The real _id from the server is
      // stored as _serverId so retries and polling can reference it.
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === optimisticKey
            ? realMsg
              ? {
                  ...realMsg,
                  _id: optimisticKey,
                  _serverId: realMsg._id,
                  _optimistic: false,
                  _failed: false,
                }
              : { ...m, _optimistic: false, _failed: false }
            : m
        )
      );
    } catch {
      // Mark the bubble as failed — don't silently remove it.
      // The user sees an error indicator + Retry button directly on the bubble.
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === optimisticKey
            ? { ...m, _optimistic: false, _failed: true }
            : m
        )
      );
      setFailedMsgKeys((prev) => new Set([...prev, optimisticKey]));
    } finally {
      setSending(false);
      const animId = setTimeout(() => {
        setNewMsgKeys((prev) => {
          const next = new Set(prev);
          next.delete(optimisticKey);
          return next;
        });
      }, 400);
      timeoutRefs.current.push(animId);
      inputRef.current?.focus();
    }
  }, [newMessage, order, sendingMessage, onSendMessage, userType]);

  // ── Retry a failed message ───────────────────────────────────
  const handleRetry = useCallback(
    async (failedMsg) => {
      const text = failedMsg.content || failedMsg.text;
      if (!text) return;

      setLocalMessages((prev) =>
        prev.filter((m) => m._id !== failedMsg._id)
      );
      setFailedMsgKeys((prev) => {
        const next = new Set(prev);
        next.delete(failedMsg._id);
        return next;
      });
      // Remove from seenIds so a fresh optimistic entry can be tracked
      seenIdsRef.current.delete(failedMsg._id);

      const optimisticKey = `optimistic-${Date.now()}`;
      const optimisticMsg = {
        _id: optimisticKey,
        content: text,
        senderType: userType,
        sender: userType,
        isRead: false,
        createdAt: new Date().toISOString(),
        _optimistic: true,
        _failed: false,
      };

      seenIdsRef.current.add(optimisticKey);
      setLocalMessages((prev) => [...prev, optimisticMsg]);
      setNewMsgKeys((prev) => new Set([...prev, optimisticKey]));

      try {
        const realMsg = await onSendMessage(text);
        // Register before setState — same reason as handleSend
        if (realMsg?._id) seenIdsRef.current.add(realMsg._id);
        setLocalMessages((prev) =>
          prev.map((m) =>
            m._id === optimisticKey
              ? realMsg
                ? {
                    ...realMsg,
                    _id: optimisticKey,
                    _serverId: realMsg._id,
                    _optimistic: false,
                    _failed: false,
                  }
                : { ...m, _optimistic: false, _failed: false }
              : m
          )
        );
      } catch {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m._id === optimisticKey
              ? { ...m, _optimistic: false, _failed: true }
              : m
          )
        );
        setFailedMsgKeys((prev) => new Set([...prev, optimisticKey]));
      } finally {
        const animId = setTimeout(() => {
          setNewMsgKeys((prev) => {
            const next = new Set(prev);
            next.delete(optimisticKey);
            return next;
          });
        }, 400);
        timeoutRefs.current.push(animId);
      }
    },
    [onSendMessage, userType]
  );

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── resolveIsOutgoing ────────────────────────────────────────
  const resolveIsOutgoing = (msg) => {
    const senderType = (msg.senderType || msg.sender || "").toLowerCase();
    if (userType === "admin") return senderType === "admin";
    if (userType === "customer") return senderType === "customer";
    return false;
  };

  // ── Memoised message list ────────────────────────────────────
  // Prevents the entire list from re-rendering on every keystroke
  const renderedMessages = useMemo(() => {
    const items = [];
    let lastLabel = null;

    localMessages.forEach((msg, idx) => {
      const ts = msg.createdAt || msg.timestamp;
      const label = ts ? getDateLabel(ts) : null;

      if (label && label !== lastLabel) {
        lastLabel = label;
        items.push(
          <div key={`sep-${label}-${idx}`} className="mm-date-separator">
            <span>{label}</span>
          </div>
        );
      }

      const isOutgoing = resolveIsOutgoing(msg);
      const isFailed = msg._failed || failedMsgKeys.has(msg._id);

      const customerName =
        order?.user?.firstName && order?.user?.lastName
          ? `${order.user.firstName} ${order.user.lastName}`
          : order?.user?.name || "Customer";

      const senderName = isOutgoing
        ? "You"
        : userType === "admin"
        ? customerName
        : "Customer Service";

      const animClass = newMsgKeys.has(msg._id) ? " mm-message--new" : "";
      const failClass = isFailed ? " mm-message--failed" : "";

      items.push(
        <div
          key={msg._id || msg.id}
          className={`mm-message ${
            isOutgoing ? "mm-message-outgoing" : "mm-message-incoming"
          }${animClass}${failClass}`}
        >
          {!isOutgoing && (
            <div className="mm-avatar" aria-label={senderName}>
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

            <div
              className={`mm-message-footer ${
                isOutgoing ? "mm-footer-right" : "mm-footer-left"
              }`}
            >
              {isFailed ? (
                <span className="mm-failed-indicator">
                  <FiAlertCircle className="mm-fail-icon" aria-hidden="true" />
                  <span>Failed to send</span>
                  <button
                    className="mm-retry-btn"
                    onClick={() => handleRetry(msg)}
                    aria-label="Retry sending this message"
                  >
                    <FiRefreshCw size={10} aria-hidden="true" />
                    Retry
                  </button>
                </span>
              ) : (
                <>
                  <span className="mm-message-time">
                    {ts ? formatTime(ts) : ""}
                  </span>
                  {isOutgoing && (
                    <span
                      className={`mm-read-receipt ${
                        msg.isRead ? "mm-read" : ""
                      }`}
                      aria-label={msg.isRead ? "Read" : "Sent"}
                    >
                      <FiCheck className="mm-check" aria-hidden="true" />
                      {msg.isRead && (
                        <FiCheck
                          className="mm-check mm-check-2"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {isOutgoing && (
            <div
              className="mm-avatar mm-avatar-out"
              aria-label={
                userType === "admin" ? "Admin" : user?.firstName || "You"
              }
            >
              {userType === "admin"
                ? "A"
                : user?.firstName?.charAt(0) || "U"}
            </div>
          )}
        </div>
      );
    });

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    localMessages,
    newMsgKeys,
    failedMsgKeys,
    order,
    userType,
    user,
    handleRetry,
  ]);

  if (!isOpen) return null;

  return (
    <div
      className="mm-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Order messages"
    >
      <div className="mm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="mm-header">
          <div className="mm-header-info">
            <div className="mm-header-icon" aria-hidden="true">
              <FiMessageCircle />
            </div>
            <div>
              <h2>Messages</h2>
              <p className="mm-header-sub">
                Order #{order?._id?.slice(-8).toUpperCase()}
              </p>
            </div>
          </div>
          <button
            className="mm-close"
            onClick={onClose}
            aria-label="Close messages"
          >
            <FiX aria-hidden="true" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="mm-body">
          {loading ? (
            <div className="mm-loading">
              <SnakeSpinner />
              <p>Loading messages…</p>
            </div>
          ) : localMessages.length === 0 ? (
            <div className="mm-empty">
              <div className="mm-empty-icon" aria-hidden="true">
                <FiMessageCircle />
              </div>
              <p>No messages yet</p>
              <small>Send a message to start the conversation</small>
            </div>
          ) : (
            <div
              className="mm-list"
              ref={listRef}
              role="log"
              aria-live="polite"
              aria-label="Message history"
            >
              {renderedMessages}
              <div
                ref={bottomRef}
                style={{ height: 1 }}
                aria-hidden="true"
              />
            </div>
          )}

          {/* ── Input bar ── */}
          <div className="mm-input-bar">
            <input
              ref={inputRef}
              className="mm-input"
              placeholder="Type a message…"
              value={newMessage}
              // Only disabled during initial loading — not during send.
              // Keeps the input live while a message is in-flight (matches
              // WhatsApp / iMessage behaviour).
              disabled={loading}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
              aria-label="Message input"
            />
            <button
              className="mm-send"
              onClick={handleSend}
              disabled={!newMessage.trim() || sendingMessage || loading}
              aria-label="Send message"
            >
              {sendingMessage ? (
                <svg
                  style={{
                    width: 14,
                    height: 14,
                    animation: "mm-rotate 0.8s linear infinite",
                  }}
                  viewBox="0 0 50 50"
                  aria-hidden="true"
                >
                  <circle
                    cx="25"
                    cy="25"
                    r="18"
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth="5"
                  />
                  <circle
                    cx="25"
                    cy="25"
                    r="18"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray="40 90"
                    strokeDashoffset="0"
                  />
                </svg>
              ) : (
                <FiSend aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MessagesModal;