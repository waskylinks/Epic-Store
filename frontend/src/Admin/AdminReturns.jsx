import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Search, Refresh, Visibility, CheckCircle, Cancel, Inventory,
  Assessment, Message, AttachFile, CloudUpload,
  Timeline as TimelineIcon, Description, Warning, Schedule,
  ChevronLeft, ChevronRight, ArrowBack, HourglassEmpty,
  ReportProblem, SwapHoriz, Discount, Gavel, RateReview,
  PendingActions, LocalShipping, ThumbUp, Add, Remove,
  ContentCopy, Done, Person,
} from '@mui/icons-material';
import {
  getAllReturns, getSingleReturn, reviewReturn, submitAdminPleaReview,
  generateDiscountCode, updateReturnStatus, sendReturnMessage,
  getReturnMessages, getReturnTimeline, getReturnDocuments,
  uploadReturnFiles, getReturnsWithUnreadMessages, clearCurrentReturn,
  clearAdminReturnState, clearReturnMessages, clearPendingAttachments,
  clearReturnDiscountData,
} from '../features/admin/adminReturnSlice';
import {
  createCompensationDiscount,
  clearAdminDiscountState,
  clearCompensationConflict,
} from '../features/admin/adminDiscountSlice';
import ReturnMessagesModal from '../Orders/ReturnMessagesModal';
import Footer from '../components/footer';
import Navbar from '../components/Navbar';
import '../AdminStyles/AdminReturns.css';

// ── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Copy hook ─────────────────────────────────────────────────────────────────
function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);
  return { copied, copy };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const getCustomerName = (user) => {
  if (!user) return 'N/A';
  const first = user.firstName?.trim() ?? '';
  const last  = user.lastName?.trim()  ?? '';
  if (first || last) return [first, last].filter(Boolean).join(' ');
  return user.name?.trim() || user.email || 'N/A';
};

const getCustomerPhone = (order) => {
  if (!order) return 'N/A';
  const s = order.shippingInfo;
  if (s?.phoneNo) return s.phoneNo;
  if (s?.phone)   return s.phone;
  if (s?.mobile)  return s.mobile;
  const u = order.user;
  if (u?.phoneNo) return u.phoneNo;
  if (u?.phone)   return u.phone;
  return 'N/A';
};

const fmt         = (n) => (typeof n === 'number' ? n.toFixed(2) : '0.00');
const fmtCurrency = (n) => `$${fmt(typeof n === 'number' ? n : 0)}`;
const fmtDate     = (d) => d ? new Date(d).toLocaleString() : 'N/A';

// Resolve the best display name for a customer from returnDataForDiscount.
const resolveCustomerDisplayName = (returnData) => {
  if (!returnData) return 'N/A';
  const name = returnData.customerName?.trim();
  if (name) return name;
  return returnData.customerEmail || 'N/A';
};

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_COLOR = {
  requested: 'requested', items_reviewed: 'items_reviewed',
  plea_submitted: 'plea_submitted', awaiting_discount: 'awaiting_discount',
  approved: 'approved', in_transit: 'in_transit', received: 'received',
  inspected: 'inspected', completed: 'completed', rejected: 'rejected', cancelled: 'cancelled',
};

const TERMINAL_STATUSES  = new Set(['completed', 'rejected', 'cancelled']);
const LIFECYCLE_STATUSES = ['approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed'];

const NEXT_STATUS_MAP = {
  in_transit: ['received'],
  received:   ['inspected'],
  inspected:  ['awaiting_discount'],
};

const DRAWER_TABS = ['overview', 'review', 'plea', 'status', 'timeline', 'documents'];

const STATUS_FILTERS = [
  { value: '',                  label: 'All'               },
  { value: 'requested',         label: 'Requested'         },
  { value: 'items_reviewed',    label: 'Items Reviewed'    },
  { value: 'plea_submitted',    label: 'Plea Submitted'    },
  { value: 'approved',          label: 'Approved'          },
  { value: 'in_transit',        label: 'In Transit'        },
  { value: 'received',          label: 'Received'          },
  { value: 'inspected',         label: 'Inspected'         },
  { value: 'awaiting_discount', label: 'Awaiting Discount' },
  { value: 'completed',         label: 'Completed'         },
  { value: 'rejected',          label: 'Rejected'          },
  { value: 'cancelled',         label: 'Cancelled'         },
];

const SORT_OPTIONS = [
  { value: 'requestedAt', label: 'Date Requested' },
  { value: 'totalPrice',  label: 'Order Total'    },
  { value: 'status',      label: 'Status'         },
];

const RETURN_DISCOUNT_VALID_DAYS = 30;
const LIMIT = 20;

// ── CountdownTimer ────────────────────────────────────────────────────────────
const CountdownTimer = ({ deadline, label, expiredLabel = 'Expired' }) => {
  const [timeLeft, setTimeLeft] = useState(null);
  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => {
      const diff = new Date(deadline) - Date.now();
      if (diff <= 0) { setTimeLeft(null); return; }
      setTimeLeft({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  const isExpired = !timeLeft;
  return (
    <div className={`rt-countdown${isExpired ? ' rt-countdown--expired' : ''}`}>
      <Schedule style={{ fontSize: 14, flexShrink: 0 }} />
      {label && <span className="rt-countdown-label">{label}</span>}
      <span className="rt-countdown-value">
        {isExpired ? expiredLabel : `${timeLeft.d}d ${timeLeft.h}h ${timeLeft.m}m ${timeLeft.s}s`}
      </span>
    </div>
  );
};

// ── CreditBreakdown ───────────────────────────────────────────────────────────
const CreditBreakdown = ({ returnInfo }) => {
  const {
    requestedGross = 0, approvedGross = 0, rejectedGross = 0,
    approvedDiscount = 0, shippingDeducted = 0, discountValue = 0,
  } = returnInfo ?? {};

  return (
    <div className="rt-credit-breakdown">
      <div className="rt-credit-breakdown-hd">
        <Discount style={{ fontSize: 15 }} />
        <span>Return Credit Breakdown</span>
      </div>
      <div className="rt-credit-rows">
        <div className="rt-credit-row">
          <span className="rt-credit-label">Requested Total</span>
          <span className="rt-credit-val">{fmtCurrency(requestedGross)}</span>
        </div>
        <div className="rt-credit-row rt-credit-row--approved">
          <span className="rt-credit-label">Approved Total</span>
          <span className="rt-credit-val rt-credit-val--approved">{fmtCurrency(approvedGross)}</span>
        </div>
        {rejectedGross > 0 && (
          <div className="rt-credit-row rt-credit-row--rejected">
            <span className="rt-credit-label">Rejected Total</span>
            <span className="rt-credit-val rt-credit-val--rejected">−{fmtCurrency(rejectedGross)}</span>
          </div>
        )}
        {approvedDiscount > 0 && (
          <div className="rt-credit-row rt-credit-row--deduct">
            <span className="rt-credit-label">Discount Applied</span>
            <span className="rt-credit-val rt-credit-val--deduct">−{fmtCurrency(approvedDiscount)}</span>
          </div>
        )}
        <div className="rt-credit-row rt-credit-row--deduct">
          <span className="rt-credit-label">Shipping Deducted</span>
          <span className="rt-credit-val rt-credit-val--deduct">−{fmtCurrency(shippingDeducted)}</span>
        </div>
        <div className="rt-credit-divider" />
        <div className="rt-credit-row rt-credit-row--total">
          <span className="rt-credit-label">Return Credit Value</span>
          <span className="rt-credit-val rt-credit-val--total">{fmtCurrency(discountValue)}</span>
        </div>
      </div>
    </div>
  );
};

// ── PerItemDecisionForm ───────────────────────────────────────────────────────
const PerItemDecisionForm = ({
  items,
  decisions,
  onDecisionChange,
  disabled,
  lockedProductIds = new Set(),
  pleaRoundApproveMax = new Map(),
  round1ApprovedQty = new Map(),
  isPleaRound = false,
}) => {
  if (!items?.length) return <div className="rt-empty" style={{ minHeight: 80 }}><span>No items to review</span></div>;

  return (
    <div className="rt-per-item-decisions">
      {items.map((item, idx) => {
        const pid      = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        const name     = item.product?.name ?? item.name ?? `Item ${idx + 1}`;
        const image    = item.product?.images?.[0]?.url ?? item.image ?? null;
        const maxQty   = item.quantity ?? 1;
        const isLocked = lockedProductIds.has(pid);

        const lockedFromR1  = round1ApprovedQty.get(pid) ?? 0;
        const isPartialPlea = isPleaRound && lockedFromR1 > 0 && !isLocked;

        const approveMax = isPleaRound
          ? (pleaRoundApproveMax.get(pid) ?? item.pleaQuantity ?? maxQty)
          : maxQty;

        const dec = decisions[pid] ?? {
          decision:         '',
          rejectionReason:  '',
          approvedQuantity: approveMax,
          rejectedQuantity: approveMax,
        };

        const currentApproved = dec.approvedQuantity ?? approveMax;
        const currentRejected = dec.rejectedQuantity ?? approveMax;
        const approveRemainder = approveMax - currentApproved;
        const rejectRemainder  = approveMax - currentRejected;

        return (
          <div key={pid} className={`rt-item-decision-card${isLocked ? ' rt-item-decision-card--locked' : ''}`}>
            <div className="rt-item-decision-info">
              {image && <img src={image} alt={name} className="rt-item-decision-img" />}
              <div className="rt-item-decision-meta">
                <span className="rt-item-name">{name}</span>
                <span className="rt-item-meta">
                  Qty: {maxQty}{item.price ? ` · ${fmtCurrency(item.price)} ea` : ''}
                </span>
                {item.reason && <span className="rt-item-reason">{item.reason.replace(/_/g, ' ')}</span>}
                {isPartialPlea && (
                  <span className="rt-item-locked-badge" style={{ marginTop: 4 }}>
                    <CheckCircle style={{ fontSize: 11 }} />
                    {lockedFromR1} unit{lockedFromR1 !== 1 ? 's' : ''} approved in round 1 — locked
                  </span>
                )}
                {isPleaRound && !isLocked && item.pleaQuantity != null && (
                  <span className="rt-item-plea-note">
                    Customer appealed {item.pleaQuantity} of {maxQty} unit{maxQty !== 1 ? 's' : ''}
                    {(item.silentAcceptedQuantity ?? 0) > 0 && (
                      <span className="rt-item-silent-note">
                        {' '}· {item.silentAcceptedQuantity} silently accepted
                      </span>
                    )}
                  </span>
                )}
                {isLocked && (
                  <span className="rt-item-locked-badge">
                    <CheckCircle style={{ fontSize: 11 }} /> Approved — locked
                    {item.approvedQuantity != null && item.approvedQuantity !== maxQty && (
                      <span className="rt-item-locked-qty"> · Qty approved: {item.approvedQuantity}</span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {isPartialPlea && (
              <div className="rt-info-banner rt-info-banner--info" style={{ margin: '2px 0 0', padding: '8px 12px', fontSize: 12 }}>
                <CheckCircle style={{ fontSize: 14, flexShrink: 0 }} />
                <span>
                  <strong>{lockedFromR1} unit{lockedFromR1 !== 1 ? 's' : ''} already approved</strong> and cannot be changed.
                  You are deciding on the remaining <strong>{approveMax} unit{approveMax !== 1 ? 's' : ''}</strong> only.
                </span>
              </div>
            )}

            {!isLocked && (
              <div className="rt-item-decision-controls">
                <button
                  type="button"
                  className={`rt-decision-btn rt-decision-btn--approve${dec.decision === 'approved' ? ' rt-decision-btn--active-approve' : ''}`}
                  onClick={() => onDecisionChange(pid, 'decision', 'approved')}
                  disabled={disabled}
                >
                  <CheckCircle style={{ fontSize: 14 }} /> Approve
                </button>
                <button
                  type="button"
                  className={`rt-decision-btn rt-decision-btn--reject${dec.decision === 'rejected' ? ' rt-decision-btn--active-reject' : ''}`}
                  onClick={() => onDecisionChange(pid, 'decision', 'rejected')}
                  disabled={disabled}
                >
                  <Cancel style={{ fontSize: 14 }} /> Reject
                </button>
              </div>
            )}

            {!isLocked && dec.decision === 'approved' && (
              <div className="rt-qty-stepper rt-qty-stepper--approve">
                <span className="rt-qty-stepper-label">Approved Qty:</span>
                <div className="rt-qty-stepper-controls">
                  <button
                    type="button" className="rt-qty-btn"
                    onClick={() => onDecisionChange(pid, 'approvedQuantity', Math.max(1, currentApproved - 1))}
                    disabled={disabled || currentApproved <= 1}
                    aria-label="Decrease approved quantity"
                  >
                    <Remove style={{ fontSize: 13 }} />
                  </button>
                  <span className="rt-qty-value">{currentApproved}</span>
                  <button
                    type="button" className="rt-qty-btn"
                    onClick={() => onDecisionChange(pid, 'approvedQuantity', Math.min(approveMax, currentApproved + 1))}
                    disabled={disabled || currentApproved >= approveMax}
                    aria-label="Increase approved quantity"
                  >
                    <Add style={{ fontSize: 13 }} />
                  </button>
                </div>
                <span className="rt-qty-max">of {approveMax}</span>
                {approveRemainder > 0 && (
                  <span className="rt-qty-remainder rt-qty-remainder--rejected">
                    {approveRemainder} auto-rejected
                  </span>
                )}
              </div>
            )}

            {!isLocked && dec.decision === 'approved' && approveRemainder > 0 && (
              <div className="rt-item-rejection-reason">
                <input
                  type="text" className="rt-form-input"
                  placeholder={`Reason for ${approveRemainder} auto-rejected unit${approveRemainder !== 1 ? 's' : ''} (required)…`}
                  value={dec.rejectionReason ?? ''}
                  onChange={(e) => onDecisionChange(pid, 'rejectionReason', e.target.value)}
                  disabled={disabled} maxLength={500}
                />
              </div>
            )}

            {!isLocked && dec.decision === 'rejected' && (
              <>
                <div className="rt-qty-stepper rt-qty-stepper--reject">
                  <span className="rt-qty-stepper-label rt-qty-stepper-label--reject">Rejected Qty:</span>
                  <div className="rt-qty-stepper-controls">
                    <button
                      type="button" className="rt-qty-btn rt-qty-btn--reject"
                      onClick={() => onDecisionChange(pid, 'rejectedQuantity', Math.max(1, currentRejected - 1))}
                      disabled={disabled || currentRejected <= 1}
                      aria-label="Decrease rejected quantity"
                    >
                      <Remove style={{ fontSize: 13 }} />
                    </button>
                    <span className="rt-qty-value rt-qty-value--reject">{currentRejected}</span>
                    <button
                      type="button" className="rt-qty-btn rt-qty-btn--reject"
                      onClick={() => onDecisionChange(pid, 'rejectedQuantity', Math.min(approveMax, currentRejected + 1))}
                      disabled={disabled || currentRejected >= approveMax}
                      aria-label="Increase rejected quantity"
                    >
                      <Add style={{ fontSize: 13 }} />
                    </button>
                  </div>
                  <span className="rt-qty-max">of {approveMax}</span>
                  {rejectRemainder > 0 && (
                    <span className="rt-qty-remainder rt-qty-remainder--approved">
                      {rejectRemainder} auto-approved
                    </span>
                  )}
                </div>
                <div className="rt-item-rejection-reason">
                  <input
                    type="text" className="rt-form-input"
                    placeholder="Rejection reason (required)…"
                    value={dec.rejectionReason ?? ''}
                    onChange={(e) => onDecisionChange(pid, 'rejectionReason', e.target.value)}
                    disabled={disabled} maxLength={500}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── PleaPreviewModal ──────────────────────────────────────────────────────────
const PleaPreviewModal = ({ items, decisions, adminNote, onConfirm, onCancel, loading, r1Map = new Map() }) => {
  const approved = items.filter((item, idx) => {
    const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
    return decisions[pid]?.decision === 'approved';
  });
  const rejected = items.filter((item, idx) => {
    const pid = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
    return decisions[pid]?.decision === 'rejected';
  });
 
  // Compute grand totals for the summary footer
  let totalApprovedUnits = 0;
  let totalRejectedUnits = 0;
 
  // For fully-approved locked items (not in decisions as approved/rejected),
  // count their approvedQuantity toward the approved total
  items.forEach((item, idx) => {
    const pid     = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
    const maxQty  = item.quantity ?? 1;
    const dec     = decisions[pid];
    const lockedR1 = r1Map.get(pid) ?? 0;
 
    if (!dec?.decision) {
      // Fully locked approved item — all units approved
      totalApprovedUnits += item.approvedQuantity ?? maxQty;
    } else if (dec.decision === 'approved') {
      const pleaApproved = dec.approvedQuantity ?? (item.pleaQuantity ?? maxQty);
      totalApprovedUnits += pleaApproved + lockedR1;
      // Rejected = contested units that weren't approved
      const pleaMax = item.pleaQuantity ?? (maxQty - lockedR1);
      totalRejectedUnits += Math.max(0, pleaMax - pleaApproved);
      // Add silent accepted units
      totalRejectedUnits += item.silentAcceptedQuantity ?? 0;
    } else if (dec.decision === 'rejected') {
      // R1 locked units are still approved even though plea was rejected
      totalApprovedUnits += lockedR1;
      const pleaMax = item.pleaQuantity ?? (maxQty - lockedR1);
      totalRejectedUnits += pleaMax;
      totalRejectedUnits += item.silentAcceptedQuantity ?? 0;
    }
  });
 
  return (
    <div className="rt-modal-overlay" onClick={onCancel} role="presentation">
      <div className="rt-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="rt-modal-hd">
          <h3>Review Final Decisions</h3>
          <button type="button" className="rt-drawer-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="rt-modal-body">
          <p className="rt-modal-intro">
            Please review your final plea decisions before submitting. This cannot be changed afterwards.
          </p>
 
          {approved.length > 0 && (
            <div className="rt-modal-decision-group rt-modal-approved">
              <div className="rt-modal-decision-group-hd">
                <CheckCircle style={{ fontSize: 14 }} />
                <span>Approved ({approved.length})</span>
              </div>
              {approved.map((item, i) => {
                const pid      = item.product?._id?.toString() ?? item.product?.toString() ?? String(i);
                const maxQty   = item.quantity ?? 1;
                const lockedR1 = r1Map.get(pid) ?? 0;
 
                // FIX: total approved = plea-approved portion + R1 locked units
                const pleaApproved    = decisions[pid]?.approvedQuantity ?? (item.pleaQuantity ?? maxQty);
                const finalApprovedQty = pleaApproved + lockedR1;
 
                // Units rejected in this plea round (contested but not approved)
                const pleaMax      = item.pleaQuantity ?? (maxQty - lockedR1);
                const pleaRejected = Math.max(0, pleaMax - pleaApproved);
                const silentAccepted = item.silentAcceptedQuantity ?? 0;
                const finalRejectedQty = pleaRejected + silentAccepted;
 
                return (
                  <div key={i} className="rt-modal-item">
                    <div style={{ flex: 1 }}>
                      <span>{item.product?.name ?? item.name ?? `Item ${i + 1}`}</span>
                      {lockedR1 > 0 && (
                        <div className="rt-modal-item-breakdown">
                          <span className="rt-modal-pool-note rt-modal-pool-note--r1">
                            R1 locked: {lockedR1}
                          </span>
                          <span className="rt-modal-pool-note rt-modal-pool-note--plea">
                            Plea approved: {pleaApproved}
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span className="rt-td-muted">
                        ✓ {finalApprovedQty} approved
                        {finalApprovedQty !== maxQty && (
                          <span style={{ color: '#9CA3AF', marginLeft: 4 }}>(of {maxQty})</span>
                        )}
                      </span>
                      {finalRejectedQty > 0 && (
                        <span className="rt-modal-item-rejected-note">
                          ✗ {finalRejectedQty} rejected
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
 
          {rejected.length > 0 && (
            <div className="rt-modal-decision-group rt-modal-rejected">
              <div className="rt-modal-decision-group-hd">
                <Cancel style={{ fontSize: 14 }} />
                <span>Plea Rejected ({rejected.length})</span>
              </div>
              {rejected.map((item, idx) => {
                const pid      = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
                const maxQty   = item.quantity ?? 1;
                const lockedR1 = r1Map.get(pid) ?? 0;
                const reason   = decisions[pid]?.rejectionReason;
 
                // Contested units that are now rejected
                const pleaMax        = item.pleaQuantity ?? (maxQty - lockedR1);
                const silentAccepted = item.silentAcceptedQuantity ?? 0;
                const totalRejected  = pleaMax + silentAccepted;
                // R1 locked units are still approved
                const stillApproved  = lockedR1;
 
                return (
                  <div key={idx} className="rt-modal-item">
                    <div style={{ flex: 1 }}>
                      <span>{item.product?.name ?? item.name ?? `Item ${idx + 1}`}</span>
                      {reason && (
                        <span className="rt-td-muted rt-modal-reason">— {reason}</span>
                      )}
                      {lockedR1 > 0 && (
                        <div className="rt-modal-item-breakdown">
                          <span className="rt-modal-pool-note rt-modal-pool-note--r1">
                            R1 locked: {lockedR1} (still approved)
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      {stillApproved > 0 && (
                        <span className="rt-td-muted" style={{ fontSize: 11 }}>
                          ✓ {stillApproved} approved
                        </span>
                      )}
                      <span className="rt-modal-item-rejected-note">
                        ✗ {totalRejected} rejected
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
 
          {/* Grand total summary across ALL items including locked ones */}
          <div className="rt-modal-summary-footer">
            <div className="rt-modal-summary-row">
              <CheckCircle style={{ fontSize: 13, color: '#10B981' }} />
              <span>Total approved units:</span>
              <strong style={{ color: '#10B981' }}>{totalApprovedUnits}</strong>
            </div>
            <div className="rt-modal-summary-row">
              <Cancel style={{ fontSize: 13, color: '#EF4444' }} />
              <span>Total rejected units:</span>
              <strong style={{ color: '#EF4444' }}>{totalRejectedUnits}</strong>
            </div>
          </div>
 
          {adminNote && (
            <div className="rt-modal-note">
              <span className="rt-form-label">Your Note:</span>
              <p>{adminNote}</p>
            </div>
          )}
        </div>
        <div className="rt-modal-footer">
          <button type="button" className="rt-btn rt-btn--secondary" onClick={onCancel} disabled={loading}>
            Go Back
          </button>
          <button type="button" className="rt-btn rt-btn--primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Submitting…' : 'Confirm & Submit Final Decisions'}
          </button>
        </div>
      </div>
    </div>
  );
};
 

// ── StepIndicator ─────────────────────────────────────────────────────────────
const StepIndicator = ({ currentStep }) => (
  <div className="rt-step-indicator">
    <div className="rt-step-node">
      <div className={`rt-step-dot ${currentStep >= 1 ? 'rt-step-dot--active' : ''} ${currentStep >= 2 ? 'rt-step-dot--done' : ''}`}>
        {currentStep >= 2 ? <Done style={{ fontSize: 13 }} /> : '1'}
      </div>
      <span className="rt-step-label">Preview</span>
    </div>
    <div className={`rt-step-connector ${currentStep >= 2 ? 'rt-step-connector--done' : ''}`} />
    <div className="rt-step-node">
      <div className={`rt-step-dot ${currentStep >= 2 ? 'rt-step-dot--done rt-step-dot--active' : ''}`}>
        {currentStep >= 2 ? <Done style={{ fontSize: 13 }} /> : '2'}
      </div>
      <span className="rt-step-label">Complete</span>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
const AdminReturns = () => {
  const dispatch = useDispatch();

  const {
    returns, unreadReturns, stats, currentReturn,
    messages, messagesPage, hasMoreMessages, totalMessages, pendingAttachments,
    errorStage, timeline, documents, pagination, loading, returnsLoading,
    unreadLoading, messageSendLoading, messagesLoading, timelineLoading,
    documentsLoading, uploadLoading, pleaReviewLoading, discountCodeLoading,
    error, success, message: successMessage,
    returnDataForDiscount,
  } = useSelector((state) => state.adminReturn);

  const {
    actionLoading: discountActionLoading,
    compensationConflict,
  } = useSelector((state) => state.adminDiscount);

  const { currentPage, totalPages, totalReturns } = pagination;

  // Filters
  const [localPage,      setLocalPage]      = useState(1);
  const [filterStatus,   setFilterStatus]   = useState('');
  const [fromDate,       setFromDate]       = useState('');
  const [toDate,         setToDate]         = useState('');
  const [rmaSearch,      setRmaSearch]      = useState('');
  const [sortBy,         setSortBy]         = useState('requestedAt');
  const [sortOrder,      setSortOrder]      = useState('desc');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // Panel / modal
  const [selectedId,       setSelectedId]       = useState(null);
  const [showDetailPanel,  setShowDetailPanel]  = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [showPleaPreview,  setShowPleaPreview]  = useState(false);
  const [activeTab,        setActiveTab]        = useState('overview');

  // Review tab
  const [itemDecisions, setItemDecisions] = useState({});
  const [adminNote,     setAdminNote]     = useState('');

  // Plea review tab
  const [pleaDecisions, setPleaDecisions] = useState({});
  const [pleaAdminNote, setPleaAdminNote] = useState('');

  // Status tab
  const [newStatus,       setNewStatus]       = useState('');
  const [inspectionNotes, setInspectionNotes] = useState('');

  // Return discount inline flow
  const [returnDiscountStep,    setReturnDiscountStep]    = useState(0);
  const [generatedDiscountCode, setGeneratedDiscountCode] = useState(null);
  const [returnDiscountError,   setReturnDiscountError]   = useState(null);
  const [returnDiscountLoading, setReturnDiscountLoading] = useState(false);

  const { copied: codeCopied, copy: copyCode } = useCopyToClipboard();

  const rmaDebounced = useDebounce(rmaSearch, 400);

  const filtersRef = useRef({});
  useEffect(() => {
    filtersRef.current = { localPage, filterStatus, fromDate, toDate, rmaDebounced, sortBy, sortOrder, showUnreadOnly };
  });

  const buildListParams = useCallback(() => {
    const f = filtersRef.current;
    const p = { page: f.localPage, limit: LIMIT, sortBy: f.sortBy, order: f.sortOrder };
    if (f.filterStatus)         p.status = f.filterStatus;
    if (f.fromDate)             p.from   = f.fromDate;
    if (f.toDate)               p.to     = f.toDate;
    if (f.rmaDebounced?.trim()) p.rma    = f.rmaDebounced.trim();
    return p;
  }, []);

  const [fetchTick, setFetchTick] = useState(0);
  const triggerFetch = useCallback(() => setFetchTick((n) => n + 1), []);

  useEffect(() => {
    if (filtersRef.current.showUnreadOnly) dispatch(getReturnsWithUnreadMessages());
    else dispatch(getAllReturns(buildListParams()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTick, dispatch]);

  useEffect(() => {
    setLocalPage(1);
    triggerFetch();
  }, [filterStatus, fromDate, toDate, rmaDebounced, sortBy, sortOrder, showUnreadOnly, triggerFetch]);

  useEffect(() => {
    triggerFetch();
  }, [localPage, triggerFetch]);

  const handleFetchReturns = useCallback(() => triggerFetch(), [triggerFetch]);

  useEffect(() => {
    if (!success) return undefined;
    const t = setTimeout(() => dispatch(clearAdminReturnState()), 3000);
    return () => clearTimeout(t);
  }, [success, dispatch]);

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => dispatch(clearAdminReturnState()), 5000);
    return () => clearTimeout(t);
  }, [error, dispatch]);

  useEffect(() => {
    if (activeTab === 'status' && currentReturn) {
      const current = currentReturn.returnInfo?.status;
      const options = NEXT_STATUS_MAP[current] ?? [];
      if (options.length === 1 && !newStatus) setNewStatus(options[0]);
    }
  }, [activeTab, currentReturn, newStatus]);

  useEffect(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn) return;
    const items = currentReturn.returnInfo.itemsToReturn;

    setItemDecisions((prev) => {
      const next = { ...prev };
      items.forEach((item, idx) => {
        const pid    = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        const maxQty = item.quantity ?? 1;
        if (!next[pid]) {
          next[pid] = {
            decision:         item.adminDecision        ?? '',
            rejectionReason:  item.adminRejectionReason ?? '',
            approvedQuantity: item.approvedQuantity      ?? maxQty,
            rejectedQuantity: maxQty,
          };
        }
      });
      return next;
    });

    if (activeTab === 'plea') {
      const fresh = {};
      items.forEach((item, idx) => {
        const pid    = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        const maxQty = item.quantity ?? 1;

        // FIX: use approvedQuantity directly (not adminDecision label) to
        // determine whether the item is fully approved and should be locked.
        // With the unified model, adminDecision='approved' always means
        // approvedQuantity > 0, but fully-approved means approvedQty === maxQty.
        const approvedQty     = item.approvedQuantity ?? 0;
        const isFullyApproved = approvedQty >= maxQty;

        if (isFullyApproved) {
          // Fully approved → locked, no plea decision needed
          fresh[pid] = {
            decision:         'approved',
            rejectionReason:  '',
            approvedQuantity: approvedQty,
            rejectedQuantity: maxQty,
          };
        } else {
          // Partially approved or fully rejected → plea round
          // contestableQty is the number of units the customer could appeal.
          // pleaQuantity is how many they actually appealed (set by submitPlea).
          const pleaQty = item.pleaQuantity ?? (maxQty - approvedQty);
          fresh[pid] = {
            decision:         '',
            rejectionReason:  '',
            approvedQuantity: pleaQty,
            rejectedQuantity: pleaQty,
          };
        }
      });
      setPleaDecisions(fresh);
    }
  }, [currentReturn, activeTab]);

  // Derived
  const displayList  = showUnreadOnly ? unreadReturns : returns;
  const tableLoading = showUnreadOnly ? unreadLoading : returnsLoading;

  const hasUnreadByStatus = useMemo(() => {
    const map = { all: false };
    displayList.forEach((item) => {
      const count = item.unreadMessages ?? 0;
      if (count > 0) {
        map.all = true;
        const s = item.returnInfo?.status;
        if (s) map[s] = true;
      }
    });
    return map;
  }, [displayList]);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = [];
    const left  = Math.max(2, currentPage - 2);
    const right = Math.min(totalPages - 1, currentPage + 2);
    pages.push(1);
    if (left > 2) pages.push('...');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [totalPages, currentPage]);

  const validNextStatuses = useMemo(() => {
    if (!currentReturn) return [];
    return NEXT_STATUS_MAP[currentReturn.returnInfo?.status] ?? [];
  }, [currentReturn]);

  const reviewDecisionsComplete = useMemo(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn?.length) return false;
    return currentReturn.returnInfo.itemsToReturn.every((item, idx) => {
      const pid    = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const dec    = itemDecisions[pid];
      const maxQty = item.quantity ?? 1;
      if (!dec?.decision) return false;
      if (dec.decision === 'rejected') return !!dec.rejectionReason?.trim();
      if (dec.decision === 'approved') {
        const approveRemainder = maxQty - (dec.approvedQuantity ?? maxQty);
        if (approveRemainder > 0) return !!dec.rejectionReason?.trim();
        return true;
      }
      return false;
    });
  }, [currentReturn, itemDecisions]);

  // FIX: pleaDecisionsComplete — use approvedQuantity directly (not
  // adminDecision label) to determine whether an item is fully approved
  // (locked) vs needs a plea decision. contestedQty is always
  // item.pleaQuantity for items that are not fully approved, because
  // submitPlea now correctly sets pleaQuantity = contestableQty - silentAccepted.
  const pleaDecisionsComplete = useMemo(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn?.length) return false;
    return currentReturn.returnInfo.itemsToReturn.every((item, idx) => {
      const pid             = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const maxQty          = item.quantity ?? 1;
      const approvedQty     = item.approvedQuantity ?? 0;
      const isFullyApproved = approvedQty >= maxQty;

      // Fully approved items are locked — no decision required
      if (isFullyApproved) return true;

      // Contested units: how many the customer actually appealed
      // (pleaQuantity set by submitPlea, always ≤ contestableQty)
      const contestedQty = item.pleaQuantity ?? (maxQty - approvedQty);

      const dec = pleaDecisions[pid];
      if (!dec?.decision) return false;
      if (dec.decision === 'rejected') return !!dec.rejectionReason?.trim();
      if (dec.decision === 'approved') {
        const approveRemainder = contestedQty - (dec.approvedQuantity ?? contestedQty);
        if (approveRemainder > 0) return !!dec.rejectionReason?.trim();
        return true;
      }
      return false;
    });
  }, [currentReturn, pleaDecisions]);

  // FIX: pleaLockedProductIds — use approvedQuantity >= quantity (not
  // adminDecision label) so items from both approve-path and reject-path
  // that are fully approved are correctly locked.
  const pleaLockedProductIds = useMemo(() => {
    if (!currentReturn?.returnInfo?.itemsToReturn) return new Set();
    return new Set(
      currentReturn.returnInfo.itemsToReturn
        .filter((item) => {
          const approvedQty = item.approvedQuantity ?? 0;
          return approvedQty >= (item.quantity ?? 1);
        })
        .map((item, idx) => item.product?._id?.toString() ?? item.product?.toString() ?? String(idx))
    );
  }, [currentReturn]);

  // FIX: pleaRoundApproveMax — use approvedQuantity directly (not adminDecision)
  // to compute the contestable remainder for partially-approved items.
  // For fully-approved items these are already in pleaLockedProductIds so the
  // map entry is never read, but we skip them anyway for clarity.
  const pleaRoundApproveMax = useMemo(() => {
    const map = new Map();
    if (!currentReturn?.returnInfo?.itemsToReturn) return map;
    currentReturn.returnInfo.itemsToReturn.forEach((item, idx) => {
      const pid         = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const maxQty      = item.quantity ?? 1;
      const approvedQty = item.approvedQuantity ?? 0;
      const isFullyApproved = approvedQty >= maxQty;

      if (isFullyApproved) return; // locked — no entry needed

      // For partially-approved or fully-rejected items the admin can approve
      // up to pleaQuantity (what the customer actually appealed).
      map.set(pid, item.pleaQuantity ?? (maxQty - approvedQty));
    });
    return map;
  }, [currentReturn]);

  // FIX: round1ApprovedQty — read approvedQuantity directly regardless of
  // adminDecision label. With the unified model all partially-approved items
  // (whether originally via approve-path or reject-path) have
  // adminDecision='approved', so filtering by adminDecision is now correct.
  // We keep the logic label-agnostic anyway for robustness: capture any item
  // whose approvedQuantity is > 0 but < quantity, regardless of label.
  const round1ApprovedQty = useMemo(() => {
    const map = new Map();
    if (!currentReturn?.returnInfo?.itemsToReturn) return map;
    currentReturn.returnInfo.itemsToReturn.forEach((item, idx) => {
      const pid         = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const maxQty      = item.quantity ?? 1;
      const approvedQty = item.approvedQuantity ?? 0;
      // Capture partially-approved items (R1 locked units > 0 but < total)
      if (approvedQty > 0 && approvedQty < maxQty) {
        map.set(pid, approvedQty);
      }
    });
    return map;
  }, [currentReturn]);

  // Handlers
  const handlePageChange = useCallback((page) => {
    if (page < 1 || page > totalPages) return;
    setLocalPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [totalPages]);

  const handleViewReturn = useCallback(async (orderId) => {
    setSelectedId(orderId); setActiveTab('overview');
    setItemDecisions({}); setAdminNote('');
    setPleaDecisions({}); setPleaAdminNote('');
    setNewStatus(''); setInspectionNotes('');
    setReturnDiscountStep(0);
    setGeneratedDiscountCode(null);
    setReturnDiscountError(null);
    setShowDetailPanel(true);
    await dispatch(getSingleReturn(orderId));
    triggerFetch();
    dispatch(getReturnTimeline(orderId));
    dispatch(getReturnDocuments(orderId));
    dispatch(getReturnMessages({ orderId, page: 1 }));
  }, [dispatch, triggerFetch]);

  const handleOpenMessageModal = useCallback(async (orderId) => {
    setSelectedId(orderId);
    await dispatch(getSingleReturn(orderId));
    triggerFetch();
    dispatch(getReturnMessages({ orderId, page: 1 }));
    setShowMessageModal(true);
  }, [dispatch, triggerFetch]);

  const handleLoadMoreMessages = useCallback(() => {
    if (!selectedId || !hasMoreMessages || messagesLoading) return;
    dispatch(getReturnMessages({ orderId: selectedId, page: messagesPage + 1 }));
  }, [dispatch, selectedId, hasMoreMessages, messagesPage, messagesLoading]);

  const handleItemDecisionChange = useCallback((pid, field, value) =>
    setItemDecisions((p) => ({ ...p, [pid]: { ...p[pid], [field]: value } })), []);

  const handlePleaDecisionChange = useCallback((pid, field, value) =>
    setPleaDecisions((p) => ({ ...p, [pid]: { ...p[pid], [field]: value } })), []);

  // buildDecisionsArray serialises the admin's decisions into the array the
  // backend expects.
  //
  // FIX A — 'approved' in plea round:
  //   pleaApproved = admin-chosen contested units to approve
  //   lockedR1     = R1 locked units from round1ApprovedQty map
  //   Total approvedQuantity = pleaApproved + lockedR1, capped at item.quantity.
  //
  // FIX B — 'rejected' in plea round:
  //   For partially-approved items, the R1 locked units must be preserved.
  //   Send approvedQuantity = lockedR1 for rejected plea decisions so the
  //   backend resolveAfterPlea preserves them (item.approvedQuantity = r1Locked).
  //   For round-1 (isPlea=false), rejected items have no prior approvals so
  //   approvedQuantity is derived server-side from quantity - rejectedQuantity.
  const buildDecisionsArray = (decisionsMap, items, isPlea = false, r1Map = new Map()) =>
    items.map((item, idx) => {
      const pid    = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
      const maxQty = item.quantity ?? 1;
      const dec    = decisionsMap[pid] ?? {};
      const base   = {
        productId:       pid,
        decision:        dec.decision,
        rejectionReason: dec.rejectionReason ?? '',
      };
      if (dec.decision === 'approved') {
        const pleaApproved = dec.approvedQuantity ?? maxQty;
        const lockedR1     = isPlea ? (r1Map.get(pid) ?? 0) : 0;
        base.approvedQuantity = Math.min(pleaApproved + lockedR1, maxQty);
      } else if (dec.decision === 'rejected') {
        base.rejectedQuantity = Math.min(dec.rejectedQuantity ?? maxQty, maxQty);
        // For plea-round rejections on partially-approved items, send the
        // R1 locked units as approvedQuantity so the backend preserves them.
        if (isPlea) {
          base.approvedQuantity = r1Map.get(pid) ?? 0;
        }
      }
      return base;
    });

  const handleReviewReturn = useCallback(async () => {
    if (!selectedId || !currentReturn?.returnInfo?.itemsToReturn) return;
    const decisionsArray = buildDecisionsArray(itemDecisions, currentReturn.returnInfo.itemsToReturn);
    try {
      await dispatch(reviewReturn({ orderId: selectedId, itemDecisions: decisionsArray, adminNote: adminNote || undefined })).unwrap();
      setItemDecisions({}); setAdminNote('');
      triggerFetch();
    } catch (err) { void err; }
  }, [dispatch, selectedId, currentReturn, itemDecisions, adminNote, triggerFetch]);

  const handlePleaReviewConfirm = useCallback(async () => {
    if (!selectedId || !currentReturn?.returnInfo?.itemsToReturn) return;
    const decisionsArray = buildDecisionsArray(
      pleaDecisions,
      currentReturn.returnInfo.itemsToReturn,
      true,
      round1ApprovedQty,
    );
    try {
      await dispatch(submitAdminPleaReview({
        orderId: selectedId, itemDecisions: decisionsArray, adminNote: pleaAdminNote || undefined,
      })).unwrap();
      setPleaDecisions({}); setPleaAdminNote('');
      setShowPleaPreview(false);
      setActiveTab('status');
      triggerFetch();
    } catch (err) {
      setShowPleaPreview(false);
      void err;
    }
  }, [dispatch, selectedId, currentReturn, pleaDecisions, pleaAdminNote, round1ApprovedQty, triggerFetch]);

  const handleGenerateDiscount = useCallback(async () => {
    if (!selectedId) return;
    setReturnDiscountError(null);
    try {
      await dispatch(generateDiscountCode(selectedId)).unwrap();
      setReturnDiscountStep(1);
      setActiveTab('status');
      triggerFetch();
    } catch (err) {
      void err;
    }
  }, [dispatch, selectedId, triggerFetch]);

  const handleCompleteReturnWithDiscount = useCallback(async () => {
    if (!returnDataForDiscount) return;
    setReturnDiscountLoading(true);
    setReturnDiscountError(null);

    const compensationPayload = {
      userId:        returnDataForDiscount.customerId,
      category:      'return',
      amount:        returnDataForDiscount.discountValue,
      reason:        `Return compensation — ${returnDataForDiscount.orderReference}`,
      validDays:     RETURN_DISCOUNT_VALID_DAYS,
      relatedReturn: returnDataForDiscount.orderId,
      relatedOrder:  returnDataForDiscount.orderId,
    };

    let discountCode = null;

    try {
      const discountResult = await dispatch(
        createCompensationDiscount(compensationPayload)
      ).unwrap();
      discountCode = discountResult?.discount?.code ?? null;
    } catch (err) {
      const message = err?.message ?? 'Failed to create discount code';
      const existingCode = err?.existingCode ?? null;
      setReturnDiscountError(
        existingCode
          ? `A discount code already exists for this return: ${existingCode}`
          : message
      );
      setReturnDiscountLoading(false);
      return;
    }

    try {
      await dispatch(
        updateReturnStatus({ orderId: returnDataForDiscount.orderId, status: 'completed' })
      ).unwrap();
    } catch (err) {
      setReturnDiscountError(
        `Discount code ${discountCode ? `(${discountCode}) ` : ''}was generated but the return status could not be updated to completed. Please update the status manually.`
      );
      setReturnDiscountLoading(false);
      if (discountCode) setGeneratedDiscountCode(discountCode);
      return;
    }

    setGeneratedDiscountCode(discountCode);
    setReturnDiscountStep(2);
    setReturnDiscountLoading(false);
    triggerFetch();
  }, [dispatch, returnDataForDiscount, triggerFetch]);

  const handleReturnDiscountDone = useCallback(() => {
    setReturnDiscountStep(0);
    setGeneratedDiscountCode(null);
    setReturnDiscountError(null);
    setReturnDiscountLoading(false);
    dispatch(clearReturnDiscountData());
    dispatch(clearAdminDiscountState());
    dispatch(clearCompensationConflict());
    handleClosePanel();
  }, [dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdateStatus = useCallback(async () => {
    if (!newStatus || !selectedId) return;
    try {
      await dispatch(updateReturnStatus({
        orderId: selectedId, status: newStatus,
        inspectionNotes: newStatus === 'inspected' ? (inspectionNotes || undefined) : undefined,
      })).unwrap();
      setNewStatus(''); setInspectionNotes('');
      triggerFetch();
    } catch (err) { void err; }
  }, [dispatch, newStatus, inspectionNotes, selectedId, triggerFetch]);

  const handleSendMessage = useCallback(async (text, files, pendingUrls = []) => {
    if (!selectedId) return;
    await dispatch(sendReturnMessage({ orderId: selectedId, content: text, files: files ?? [], pendingUrls: pendingUrls ?? [] })).unwrap();
  }, [dispatch, selectedId]);

  const handleRetryMessage = useCallback(() => {
    if (!selectedId || !pendingAttachments.length) return;
    dispatch(sendReturnMessage({ orderId: selectedId, content: '', pendingUrls: pendingAttachments }));
  }, [dispatch, selectedId, pendingAttachments]);

  const handleFileUpload = useCallback(async (files) => {
    if (!selectedId) return;
    try {
      await dispatch(uploadReturnFiles({ orderId: selectedId, files })).unwrap();
      dispatch(getReturnDocuments(selectedId));
    } catch (err) { void err; }
  }, [dispatch, selectedId]);

  const handleCloseMessageModal = useCallback(() => {
    setShowMessageModal(false); dispatch(clearReturnMessages()); triggerFetch();
  }, [dispatch, triggerFetch]);

  const handleClosePanel = useCallback(() => {
    setShowDetailPanel(false); setShowMessageModal(false); setSelectedId(null);
    setActiveTab('overview'); setItemDecisions({}); setAdminNote('');
    setPleaDecisions({}); setPleaAdminNote('');
    setNewStatus(''); setInspectionNotes('');
    setShowPleaPreview(false);
    setReturnDiscountStep(0);
    setGeneratedDiscountCode(null);
    setReturnDiscountError(null);
    setReturnDiscountLoading(false);
    dispatch(clearCurrentReturn());
    dispatch(clearReturnDiscountData());
    dispatch(clearAdminDiscountState());
    dispatch(clearCompensationConflict());
    triggerFetch();
  }, [dispatch, triggerFetch]);

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const renderKPICards = () => {
    if (!stats) {
      return Array.from({ length: 11 }).map((_, i) => (
        <div key={i} className="rt-kpi" style={{ '--kpi-color': '#E5E7EB' }}>
          <div className="rt-kpi-top"><div className="rt-skel" style={{ width: 40, height: 40, borderRadius: 10 }} /></div>
          <div className="rt-skel" style={{ width: '55%', height: 11, marginBottom: 8 }} />
          <div className="rt-skel" style={{ width: '70%', height: 26 }} />
        </div>
      ));
    }

    const cards = [
      { label: 'Total Returns',     value: stats.total             ?? 0, icon: Assessment,    color: '#6366F1', isCount: true  },
      { label: 'Pending Review',    value: stats.requested         ?? 0, icon: Schedule,      color: '#F59E0B', isCount: true  },
      { label: 'Items Reviewed',    value: stats.items_reviewed    ?? 0, icon: RateReview,    color: '#3B82F6', isCount: true  },
      { label: 'Plea Submitted',    value: stats.plea_submitted    ?? 0, icon: Gavel,         color: '#8B5CF6', isCount: true  },
      { label: 'In Transit',        value: stats.in_transit        ?? 0, icon: LocalShipping, color: '#06B6D4', isCount: true  },
      { label: 'Inspected', value: stats.inspected ?? 0, icon: RateReview, color: '#F97316', isCount: true },
      { label: 'Awaiting Discount', value: stats.awaiting_discount ?? 0, icon: PendingActions, color: '#F97316', isCount: true  },
      { label: 'Completed',         value: stats.completed         ?? 0, icon: CheckCircle,   color: '#10B981', isCount: true  },
      { label: 'Rejected',          value: stats.rejected          ?? 0, icon: Cancel,        color: '#EF4444', isCount: true  },
      { label: 'Requested Revenue', value: typeof stats.totalRequestedAmount === 'number' ? stats.totalRequestedAmount : 0, icon: Discount,     color: '#0EA5E9', isCount: false },
      { label: 'Approved Value',    value: typeof stats.totalApprovedAmount  === 'number' ? stats.totalApprovedAmount  : 0, icon: ThumbUp,      color: '#10B981', isCount: false },
      { label: 'Rejected Value',    value: typeof stats.totalRejectedAmount  === 'number' ? stats.totalRejectedAmount  : 0, icon: ReportProblem,color: '#EF4444', isCount: false },
    ];

    return cards.map((c) => (
      <div key={c.label} className="rt-kpi" style={{ '--kpi-color': c.color }}>
        <div className="rt-kpi-top">
          <span className="rt-kpi-icon" style={{ background: `${c.color}18`, color: c.color }}>
            <c.icon style={{ fontSize: 20 }} />
          </span>
        </div>
        <div className="rt-kpi-label">{c.label}</div>
        <div className="rt-kpi-value">
          {c.isCount
            ? c.value.toLocaleString()
            : `$${c.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        </div>
      </div>
    ));
  };

  // ── Table ─────────────────────────────────────────────────────────────────
  const renderTable = () => {
    if (tableLoading && !displayList.length) {
      return (
        <div style={{ padding: '20px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {Array.from({ length: 8 }).map((__, j) => <div key={j} className="rt-skel" style={{ height: 16, flex: 1 }} />)}
            </div>
          ))}
        </div>
      );
    }
    if (!tableLoading && !displayList.length) {
      return (
        <div className="rt-empty">
          <Inventory style={{ fontSize: 36, color: '#D1D5DB' }} />
          <span>{showUnreadOnly ? 'No returns with unread messages' : 'No return requests found'}</span>
        </div>
      );
    }
    return (
      <div className="rt-tbl-wrap">
        {tableLoading && displayList.length > 0 && <div className="rt-loading-bar" />}
        <table className="rt-tbl">
          <thead>
            <tr>
              <th>Order ID</th><th>Customer</th><th>RMA</th>
              <th>Requested Amt</th><th>Reason</th><th>Requested</th>
              <th>Status</th><th>Msgs</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayList.map((item) => {
              const s        = item.returnInfo?.status ?? 'unknown';
              const orderRef = (item.orderId ?? item._id)?.toString().slice(-6).toUpperCase() ?? 'N/A';
              const rowId    = item.orderId ?? item._id;
              const unread   = item.unreadMessages ?? 0;
              return (
                <tr key={rowId}>
                  <td className="rt-td-name">#{orderRef}</td>
                  <td>{getCustomerName(item.user)}</td>
                  <td className="rt-td-mono">{item.returnInfo?.rmaNumber ?? '—'}</td>
                  <td className="rt-td-money">{fmtCurrency(item.returnInfo?.requestedAmount ?? 0)}</td>
                  <td className="rt-td-reason">{item.returnInfo?.reason?.replace(/_/g, ' ') ?? 'N/A'}</td>
                  <td className="rt-td-muted">
                    {item.returnInfo?.requestedAt ? new Date(item.returnInfo.requestedAt).toLocaleDateString() : 'N/A'}
                  </td>
                  <td>
                    <span className={`rt-status rt-status--${STATUS_COLOR[s] ?? 'cancelled'}`}>
                      {s.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="rt-icon-btn" onClick={() => handleOpenMessageModal(rowId)} title="Open Messages">
                      <Message style={{ fontSize: 16 }} />
                      {unread > 0 && <span className="rt-msg-badge">{unread > 99 ? '99+' : unread}</span>}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="rt-icon-btn" onClick={() => handleViewReturn(rowId)} title="View Details">
                      <Visibility style={{ fontSize: 16 }} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderPagination = () => {
    if (showUnreadOnly || totalPages <= 1) return null;
    return (
      <div className="rt-pagination">
        <button type="button" className="rt-page-btn rt-page-btn--nav" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
          <ChevronLeft style={{ fontSize: 18 }} />
        </button>
        {pageNumbers.map((p, i) =>
          p === '...'
            ? <span key={`e${i}`} className="rt-page-ellipsis">…</span>
            : <button key={p} type="button" className={`rt-page-btn${currentPage === p ? ' rt-page-btn--active' : ''}`} onClick={() => handlePageChange(p)}>{p}</button>
        )}
        <button type="button" className="rt-page-btn rt-page-btn--nav" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>
          <ChevronRight style={{ fontSize: 18 }} />
        </button>
        <span className="rt-page-info">Page {currentPage} of {totalPages}</span>
      </div>
    );
  };


const renderItemDecisionBadges = (returnInfo) => {
  const items = returnInfo?.itemsToReturn ?? [];
  const reviewed = items.filter((i) => i.adminDecision && i.adminDecision !== 'pending');

  // Show if any item has a decision OR is fully approved (no plea needed)
  const hasAnything = reviewed.length > 0 || items.some((i) => (i.approvedQuantity ?? 0) >= (i.quantity ?? 1));
  if (!hasAnything) return null;

  return (
    <div className="rt-item-decision-badges">
      {items.map((item, idx) => {
        const pid          = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
        const name         = item.product?.name ?? item.name ?? `Item ${idx + 1}`;
        const dec          = item.adminDecision;
        const totalQty     = item.quantity ?? 1;
        const approvedQty  = item.approvedQuantity ?? 0;
        const rejectedQty  = totalQty - approvedQty;
        const isPartial    = approvedQty > 0 && rejectedQty > 0;

        // Fully approved item that never went through plea — show approved badge
        if (!dec || dec === 'pending') {
          if (approvedQty >= totalQty) {
            return (
              <div key={pid} className="rt-decision-badge rt-decision-badge--approved">
                <CheckCircle style={{ fontSize: 13 }} />
                <span>{name}</span>
                <span className="rt-decision-badge-qty">Approved: {approvedQty}</span>
              </div>
            );
          }
          return null;
        }

        // Plea-round pool fields (set by resolveAfterPlea)
        const pleaApprovedQty = item.pleaApprovedQty        ?? null;
        const pleaRejectedQty = item.pleaRejectedQty        ?? null;
        const silentAccepted  = item.silentAcceptedQuantity ?? 0;
        const r1Locked        = (pleaApprovedQty != null) ? approvedQty - pleaApprovedQty : null;

        const hasPleaDetail =
          (pleaApprovedQty != null && pleaApprovedQty > 0) ||
          (pleaRejectedQty != null && pleaRejectedQty > 0) ||
          silentAccepted > 0;

        return (
          <React.Fragment key={pid}>
            {/* Approved badge — shown when any units are approved */}
            {approvedQty > 0 && (
              <div className="rt-decision-badge rt-decision-badge--approved">
                <CheckCircle style={{ fontSize: 13 }} />
                <span>{name}</span>
                {approvedQty !== totalQty && (
                  <span className="rt-decision-badge-qty">×{approvedQty} of {totalQty}</span>
                )}
              </div>
            )}

            {/* Rejected badge — shown when any units are rejected */}
            {rejectedQty > 0 && (
              <div className="rt-decision-badge rt-decision-badge--rejected">
                <Cancel style={{ fontSize: 13 }} />
                <span>{name}</span>
                {isPartial && (
                  <span className="rt-decision-badge-qty">{rejectedQty} of {totalQty} rejected</span>
                )}
                {item.adminRejectionReason && (
                  <span className="rt-decision-badge-reason">— {item.adminRejectionReason}</span>
                )}
              </div>
            )}

            {/* Plea pool breakdown — shown after plea resolution */}
            {hasPleaDetail && (
              <div className="rt-decision-badge-plea-detail">
                {r1Locked != null && r1Locked > 0 && (
                  <span className="rt-plea-pool-chip rt-plea-pool-chip--r1">R1 locked: {r1Locked}</span>
                )}
                {pleaApprovedQty != null && pleaApprovedQty > 0 && (
                  <span className="rt-plea-pool-chip rt-plea-pool-chip--approved">Plea approved: {pleaApprovedQty}</span>
                )}
                {pleaRejectedQty != null && pleaRejectedQty > 0 && (
                  <span className="rt-plea-pool-chip rt-plea-pool-chip--rejected">Plea rejected: {pleaRejectedQty}</span>
                )}
                {silentAccepted > 0 && (
                  <span className="rt-plea-pool-chip rt-plea-pool-chip--silent">Silent: {silentAccepted}</span>
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

  // ── Status tab: inline discount flow panels ───────────────────────────────

  const renderDiscountConfirmStep = () => {
    const rd = returnDataForDiscount;
    if (!rd) {
      return (
        <div className="rt-resume-banner">
          <Warning style={{ fontSize: 16, flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Discount generation in progress</p>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#6B7280' }}>
              The discount preview data was lost after a page refresh. Close this drawer, reopen the return from the list, and click "Generate Discount Code" again to resume.
            </p>
          </div>
        </div>
      );
    }

    const displayName = resolveCustomerDisplayName(rd);
    const expiryDate  = new Date();
    expiryDate.setDate(expiryDate.getDate() + RETURN_DISCOUNT_VALID_DAYS);
    const expiryStr = expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return (
      <div className="rt-discount-preview-panel">
        <StepIndicator currentStep={1} />

        <div className="rt-section" style={{ margin: '16px 0 10px' }}>
          <span className="rt-section-text">Discount Preview</span>
          <span className="rt-section-line" />
        </div>

        <div className="rt-customer-strip">
          <Person style={{ fontSize: 17, color: '#4F46E5', flexShrink: 0 }} />
          <div>
            <span className="rt-customer-strip-name">{displayName}</span>
            {rd.customerEmail && (
              <span className="rt-customer-strip-email">{rd.customerEmail}</span>
            )}
          </div>
        </div>

        <div className="rt-card" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="rt-card-body">
            <div className="rt-metric-row">
              <span className="rt-metric-label">Discount Type</span>
              <span className="rt-metric-val">Fixed Amount</span>
            </div>
            <div className="rt-metric-row">
              <span className="rt-metric-label">Credit Value</span>
              <span className="rt-metric-val rt-preview-value--amount">
                {fmtCurrency(rd.discountValue)}
              </span>
            </div>
            <div className="rt-metric-row">
              <span className="rt-metric-label">Category</span>
              <span className="rt-metric-val">Return Compensation</span>
            </div>
            <div className="rt-metric-row">
              <span className="rt-metric-label">Valid For</span>
              <span className="rt-metric-val">{RETURN_DISCOUNT_VALID_DAYS} days (expires {expiryStr})</span>
            </div>
            <div className="rt-metric-row">
              <span className="rt-metric-label">Restriction</span>
              <span className="rt-metric-val">This customer only · 1 use</span>
            </div>
            <div className="rt-metric-row" style={{ borderBottom: 'none' }}>
              <span className="rt-metric-label">Order Reference</span>
              <span className="rt-metric-val rt-td-mono">{rd.orderReference}</span>
            </div>
          </div>
        </div>

        {rd.approvedItems?.length > 0 && (
          <>
            <div className="rt-section" style={{ margin: '14px 0 10px' }}>
              <span className="rt-section-text">Approved Items</span>
              <span className="rt-section-line" />
            </div>
            <div className="rt-approved-summary">
              {rd.approvedItems.map((item, i) => (
                <div key={item.productId ?? i} className="rt-approved-summary-item">
                  <CheckCircle style={{ fontSize: 13, color: '#10B981' }} />
                  <span>{item.name ?? 'Product'}</span>
                  <span className="rt-td-muted">×{item.quantity ?? 1}</span>
                  {item.unitPrice > 0 && (
                    <span className="rt-td-money">{fmtCurrency((item.unitPrice ?? 0) * (item.quantity ?? 1))}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {returnDiscountError && (
          <div className="rt-discount-inline-error" role="alert">
            <Warning style={{ fontSize: 15, flexShrink: 0 }} />
            <span>{returnDiscountError}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            className="rt-btn rt-btn--ghost"
            onClick={handleReturnDiscountDone}
            disabled={returnDiscountLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rt-btn rt-btn--generate-discount"
            style={{ flex: 1 }}
            onClick={handleCompleteReturnWithDiscount}
            disabled={returnDiscountLoading || discountActionLoading}
          >
            {returnDiscountLoading || discountActionLoading ? (
              <><span className="rt-spinner" style={{ width: 14, height: 14, borderWidth: 2, marginRight: 8 }} />Generating…</>
            ) : (
              <><Discount style={{ fontSize: 16, marginRight: 6 }} />Generate & Complete Return</>
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderDiscountSuccessStep = () => (
    <div className="rt-return-success-panel">
      <StepIndicator currentStep={2} />

      <div className="rt-return-success-body">
        <div className="rt-return-success-icon-wrap">
          <CheckCircle style={{ fontSize: 30, color: '#10B981' }} />
        </div>
        <h3 className="rt-return-success-title">Return Completed</h3>
        <p className="rt-return-success-desc">
          The discount code has been generated and the return is now marked as completed.
          The customer can see it in their My Discounts page.
        </p>

        {generatedDiscountCode && (
          <>
            <div className="rt-code-box">
              <span className="rt-code-box-text">{generatedDiscountCode}</span>
              <button
                type="button"
                className={`rt-code-copy-btn${codeCopied ? ' rt-code-copy-btn--done' : ''}`}
                onClick={() => copyCode(generatedDiscountCode)}
                aria-label={codeCopied ? 'Copied!' : 'Copy code'}
                title={codeCopied ? 'Copied!' : 'Copy to clipboard'}
              >
                {codeCopied
                  ? <Done style={{ fontSize: 15 }} />
                  : <ContentCopy style={{ fontSize: 15 }} />
                }
              </button>
            </div>
            <p className="rt-customer-note">
              This code is restricted to the customer and valid for {RETURN_DISCOUNT_VALID_DAYS} days.
              It will appear in their My Discounts page automatically.
            </p>
          </>
        )}

        <button
          type="button"
          className="rt-btn rt-btn--primary"
          style={{ marginTop: 20, width: '100%' }}
          onClick={handleReturnDiscountDone}
        >
          Done — Back to Returns
        </button>
      </div>
    </div>
  );

  // ── Detail panel ──────────────────────────────────────────────────────────
  const renderDetailPanel = () => {
    if (!showDetailPanel) return null;

    if (!currentReturn) {
      return (
        <div className="rt-drawer-overlay" onClick={handleClosePanel} role="presentation">
          <div className="rt-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="rt-drawer-hd">
              <h2 className="rt-drawer-title">Loading…</h2>
              <button type="button" className="rt-drawer-close" onClick={handleClosePanel} aria-label="Close">×</button>
            </div>
            <div className="rt-drawer-body">
              <div className="rt-loading"><div className="rt-spinner" /><span>Fetching return…</span></div>
            </div>
          </div>
        </div>
      );
    }

    const returnInfo = currentReturn.returnInfo ?? {};
    const retStatus  = returnInfo.status ?? 'unknown';
    const isTerminal = TERMINAL_STATUSES.has(retStatus);
    const orderRef   = currentReturn._id?.toString().slice(-6).toUpperCase() ?? 'N/A';
    const rma        = returnInfo.rmaNumber ?? null;

    const showBreakdown = ['items_reviewed', 'plea_submitted', 'approved', 'in_transit',
      'received', 'inspected', 'awaiting_discount', 'completed'].includes(retStatus);

    const visibleTabs = DRAWER_TABS.filter((t) => t !== 'plea' || retStatus === 'plea_submitted');

    return (
      <div className="rt-drawer-overlay" onClick={handleClosePanel} role="presentation">
        <div className="rt-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rt-drawer-heading">

          <div className="rt-drawer-hd">
            <div className="rt-drawer-hd-info">
              <h2 className="rt-drawer-title" id="rt-drawer-heading">Return — #{orderRef}</h2>
              {rma && <span className="rt-rma-badge">RMA: {rma}</span>}
            </div>
            <button type="button" className="rt-drawer-close" onClick={handleClosePanel} aria-label="Close">×</button>
          </div>

          <div className="rt-drawer-tabs">
            <div className="rt-tf rt-drawer-tab-row">
              {visibleTabs.map((tab) => (
                <button
                  key={tab} type="button"
                  className={`rt-tf-btn${activeTab === tab ? ' rt-tf-btn--active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'plea' ? 'Plea Review' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="rt-drawer-body">

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <>
                <div className="rt-section"><span className="rt-section-text">Return Info</span><span className="rt-section-line" /></div>
                <div className="rt-card">
                  <div className="rt-card-body">
                    {[
                      ['Customer',        getCustomerName(currentReturn.user)],
                      ['Email',           currentReturn.user?.email ?? 'N/A'],
                      ['Phone',           getCustomerPhone(currentReturn)],
                      ['Requested Value', fmtCurrency(currentReturn.returnInfo?.requestedAmount ?? 0)],
                      ['Reason',          returnInfo.reason?.replace(/_/g, ' ') ?? 'N/A'],
                    ].map(([label, val]) => (
                      <div key={label} className="rt-metric-row">
                        <span className="rt-metric-label">{label}</span>
                        <span className="rt-metric-val">{val}</span>
                      </div>
                    ))}
                    <div className="rt-metric-row">
                      <span className="rt-metric-label">Status</span>
                      <span className={`rt-status rt-status--${STATUS_COLOR[retStatus] ?? 'cancelled'}`}>
                        {retStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="rt-metric-row">
                      <span className="rt-metric-label">Requested On</span>
                      <span className="rt-metric-val">
                        {returnInfo.requestedAt ? new Date(returnInfo.requestedAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    {['in_transit','received','inspected','awaiting_discount','completed'].includes(retStatus) && returnInfo.courierName && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Courier</span>
                        <span className="rt-metric-val">{returnInfo.courierName}</span>
                      </div>
                    )}
                    {['in_transit','received','inspected','awaiting_discount','completed'].includes(retStatus) && returnInfo.shippedAt && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Shipped On</span>
                        <span className="rt-metric-val">{fmtDate(returnInfo.shippedAt)}</span>
                      </div>
                    )}
                    {returnInfo.trackingNumber && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Tracking #</span>
                        <span className="rt-metric-val rt-td-mono">{returnInfo.trackingNumber}</span>
                      </div>
                    )}
                    {returnInfo.adminNote && (
                      <div className="rt-metric-row">
                        <span className="rt-metric-label">Admin Note</span>
                        <span className="rt-metric-val">{returnInfo.adminNote}</span>
                      </div>
                    )}
                  </div>
                </div>

                {showBreakdown && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Credit Breakdown</span><span className="rt-section-line" /></div>
                    <CreditBreakdown returnInfo={returnInfo} />
                  </>
                )}

                {returnInfo.description && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Customer Description</span><span className="rt-section-line" /></div>
                    <div className="rt-card"><div className="rt-card-body">
                      <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{returnInfo.description}</p>
                    </div></div>
                  </>
                )}

                {returnInfo.itemsToReturn?.length > 0 && (() => {
                  const POST_REVIEW = [
                    'items_reviewed', 'plea_submitted', 'approved',
                    'in_transit', 'received', 'inspected',
                    'awaiting_discount', 'completed',
                  ];
                
                  if (POST_REVIEW.includes(retStatus)) {
                    if (!['items_reviewed', 'plea_submitted'].includes(retStatus)) {
                      return (
                        <>
                          <div className="rt-section">
                            <span className="rt-section-text">Item Decisions</span>
                            <span className="rt-section-line" />
                          </div>
                          <div className="rt-card">
                            <div className="rt-card-body">
                              {renderItemDecisionBadges(returnInfo)}
                            </div>
                          </div>
                        </>
                      );
                    }
                    return null; // items_reviewed and plea_submitted already render badges above
                  }
                
                  // requested — no decisions yet, show raw items list
                  return (
                    <>
                      <div className="rt-section">
                        <span className="rt-section-text">Items to Return</span>
                        <span className="rt-section-line" />
                      </div>
                      <div className="rt-card">
                        <div className="rt-card-body">
                          {returnInfo.itemsToReturn.map((item, idx) => (
                            <div key={item.product?._id ?? idx} className="rt-item-row">
                              <div className="rt-item-info">
                                <span className="rt-item-name">{item.product?.name ?? `Item ${idx + 1}`}</span>
                                <span className="rt-item-meta">
                                  Qty: {item.quantity ?? 1}
                                  {item.condition ? ` · ${item.condition}` : ''}
                                </span>
                              </div>
                              {item.reason && (
                                <span className="rt-item-reason">{item.reason.replace(/_/g, ' ')}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {retStatus === 'plea_submitted' && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Plea Submitted</span><span className="rt-section-line" /></div>
                    <div className="rt-card"><div className="rt-card-body">
                      <div className="rt-plea-submitted-badge">
                        <Gavel style={{ fontSize: 15 }} />
                        <span>Customer has submitted a plea for reconsideration</span>
                      </div>
                      {returnInfo.pleaInfo?.pleaDescription && (
                        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                          {returnInfo.pleaInfo.pleaDescription}
                        </p>
                      )}
                      {returnInfo.pleaDeadline && (
                        <div style={{ marginTop: 12 }}>
                          <CountdownTimer deadline={returnInfo.pleaDeadline} label="Admin response window:" expiredLabel="Response window closed" />
                        </div>
                      )}
                      {renderItemDecisionBadges(returnInfo)}
                    </div></div>
                  </>
                )}

                {returnInfo.inspectionNotes && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Inspection Notes</span><span className="rt-section-line" /></div>
                    <div className="rt-card"><div className="rt-card-body">
                      <p style={{ margin: 0, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{returnInfo.inspectionNotes}</p>
                    </div></div>
                  </>
                )}

                {!['items_reviewed', 'plea_submitted'].includes(retStatus) && returnInfo.itemsToReturn?.length > 0 && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Items to Return</span><span className="rt-section-line" /></div>
                    <div className="rt-card"><div className="rt-card-body">
                      {returnInfo.itemsToReturn.map((item, idx) => (
                        <div key={item.product?._id ?? idx} className="rt-item-row">
                          <div className="rt-item-info">
                            <span className="rt-item-name">{item.product?.name ?? `Item ${idx + 1}`}</span>
                            <span className="rt-item-meta">
                              Qty: {item.quantity ?? 1}
                              {item.approvedQuantity != null && (
                                <span className="rt-item-approved-qty">
                                  {' · '}Approved: {item.approvedQuantity}
                                </span>
                              )}
                              {(() => {
                                const totalQty    = item.quantity ?? 1;
                                const approvedQty = item.approvedQuantity ?? 0;
                                const rejectedQty = totalQty - approvedQty;
                                if (rejectedQty > 0 && rejectedQty < totalQty) {
                                  return <span className="rt-item-rejected-qty"> · Rejected: {rejectedQty}</span>;
                                }
                                return null;
                              })()}
                              {item.condition ? ` · ${item.condition}` : ''}
                            </span>
                          </div>
                          {item.reason && <span className="rt-item-reason">{item.reason.replace(/_/g, ' ')}</span>}
                        </div>
                      ))}
                    </div></div>
                  </>
                )}

                {currentReturn.orderItems?.length > 0 && (
                  <>
                    <div className="rt-section"><span className="rt-section-text">Order Items</span><span className="rt-section-line" /></div>
                    <div className="rt-card"><div className="rt-card-body">
                      {currentReturn.orderItems.map((item, idx) => (
                        <div key={item._id ?? idx} className="rt-item-row">
                          <div className="rt-item-info">
                            <span className="rt-item-name">{item.product?.name ?? `Item ${idx + 1}`}</span>
                            <span className="rt-item-meta">Qty: {item.quantity ?? 1} · {fmtCurrency(item.price ?? 0)} ea</span>
                          </div>
                        </div>
                      ))}
                    </div></div>
                  </>
                )}
              </>
            )}

            {/* ── REVIEW TAB ── */}
            {activeTab === 'review' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title">Review Return Request</h3>
                    <p className="rt-card-sub">Make a per-item approve / reject decision</p>
                  </div>
                </div>
                <div className="rt-card-body">
                  {retStatus !== 'requested' && (
                    <div className={`rt-info-banner rt-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                      {isTerminal ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} /> : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                      <span>This return is <strong>{retStatus.replace(/_/g, ' ')}</strong> and cannot be re-reviewed here.</span>
                    </div>
                  )}
                  {retStatus === 'requested' && (
                    <>
                      <PerItemDecisionForm
                        items={returnInfo.itemsToReturn ?? []}
                        decisions={itemDecisions}
                        onDecisionChange={handleItemDecisionChange}
                        disabled={loading}
                      />
                      <div className="rt-form-group" style={{ marginTop: 14 }}>
                        <label className="rt-form-label" htmlFor="rt-admin-note">Admin Note</label>
                        <textarea id="rt-admin-note" className="rt-form-textarea" rows={3} value={adminNote}
                          onChange={(e) => setAdminNote(e.target.value)} placeholder="Add a note for the customer…" disabled={loading}
                        />
                      </div>
                      <button type="button" className="rt-btn rt-btn--primary" onClick={handleReviewReturn}
                        disabled={loading || !reviewDecisionsComplete}
                        title={!reviewDecisionsComplete ? 'All items must have a decision' : ''}
                      >
                        {loading ? 'Processing…' : 'Submit Item Decisions'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── PLEA REVIEW TAB ── */}
            {activeTab === 'plea' && retStatus === 'plea_submitted' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title"><Gavel style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Plea Review</h3>
                    <p className="rt-card-sub">Second-round decisions — fully approved items are locked · partially approved items show the unapproved remainder · approve max capped at customer's appeal quantity</p>
                  </div>
                </div>
                <div className="rt-card-body">
                  {returnInfo.pleaInfo?.pleaDescription && (
                    <div className="rt-plea-text-block">
                      <span className="rt-form-label">Customer Plea:</span>
                      <p>{returnInfo.pleaInfo.pleaDescription}</p>
                    </div>
                  )}
                  {returnInfo.pleaInfo?.pleaDocuments?.length > 0 && (
                    <div className="rt-plea-evidence">
                      <span className="rt-form-label">Submitted Evidence:</span>
                      <div className="rt-plea-evidence-grid">
                        {returnInfo.pleaInfo.pleaDocuments.map((doc, i) => (
                          <a key={doc._id ?? i} href={doc.url} target="_blank" rel="noopener noreferrer" className="rt-plea-evidence-thumb">
                            {doc.mimeType?.startsWith('image/') || doc.fileType === 'image'
                              ? <img src={doc.url} alt={doc.filename ?? 'Evidence'} />
                              : <div className="rt-plea-evidence-placeholder"><AttachFile style={{ fontSize: 20 }} /><span>{doc.filename ?? 'File'}</span></div>}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {pleaLockedProductIds.size > 0 && (
                    <div className="rt-info-banner rt-info-banner--info" style={{ marginBottom: 12 }}>
                      <CheckCircle style={{ fontSize: 16, flexShrink: 0 }} />
                      <span>
                        <strong>Fully approved items are locked.</strong> Items where only some units were approved
                        remain open — you can approve up to the quantity the customer appealed for those units.
                      </span>
                    </div>
                  )}
                  <div className="rt-section" style={{ margin: '14px 0 10px' }}>
                    <span className="rt-section-text">Second-Round Decisions</span>
                    <span className="rt-section-line" />
                  </div>
                  <PerItemDecisionForm
                    items={returnInfo.itemsToReturn ?? []}
                    decisions={pleaDecisions}
                    onDecisionChange={handlePleaDecisionChange}
                    disabled={pleaReviewLoading}
                    lockedProductIds={pleaLockedProductIds}
                    pleaRoundApproveMax={pleaRoundApproveMax}
                    round1ApprovedQty={round1ApprovedQty}
                    isPleaRound={true}
                  />
                  <div className="rt-form-group" style={{ marginTop: 14 }}>
                    <label className="rt-form-label" htmlFor="rt-plea-admin-note">Admin Note</label>
                    <textarea id="rt-plea-admin-note" className="rt-form-textarea" rows={3} value={pleaAdminNote}
                      onChange={(e) => setPleaAdminNote(e.target.value)} placeholder="Final note for the customer…" disabled={pleaReviewLoading}
                    />
                  </div>
                  <button type="button" className="rt-btn rt-btn--primary"
                    onClick={() => setShowPleaPreview(true)}
                    disabled={pleaReviewLoading || !pleaDecisionsComplete}
                    title={!pleaDecisionsComplete ? 'All items must have a decision' : ''}
                  >
                    Review &amp; Submit Final Decisions
                  </button>
                </div>
              </div>
            )}

            {/* ── STATUS TAB ── */}
            {activeTab === 'status' && (
              <div className="rt-card">
                <div className="rt-card-hd">
                  <div>
                    <h3 className="rt-card-title"><SwapHoriz style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Update Status</h3>
                    <p className="rt-card-sub">Advance through the return lifecycle</p>
                  </div>
                </div>
                <div className="rt-card-body">

                  {retStatus === 'completed' && returnDiscountStep === 2 && renderDiscountSuccessStep()}

                  {retStatus === 'awaiting_discount' && returnDiscountStep === 1 && renderDiscountConfirmStep()}

                  {retStatus === 'awaiting_discount' && returnDiscountStep === 0 && (
                    <>
                      <div className="rt-progress-row">
                        {LIFECYCLE_STATUSES.map((s, idx) => {
                          const currentIdx = LIFECYCLE_STATUSES.indexOf(retStatus);
                          const isPast     = idx < currentIdx;
                          const isCurrent  = s === retStatus;
                          return (
                            <React.Fragment key={s}>
                              <div className={`rt-progress-step${isCurrent ? ' rt-progress-step--current' : isPast ? ' rt-progress-step--done' : ''}`}>
                                <div className="rt-progress-dot" />
                                <span className="rt-progress-label">{s.replace(/_/g, ' ')}</span>
                              </div>
                              {idx < LIFECYCLE_STATUSES.length - 1 && (
                                <div className={`rt-progress-line${isPast || isCurrent ? ' rt-progress-line--done' : ''}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      <div className="rt-info-banner rt-info-banner--info">
                        <Discount style={{ fontSize: 16, flexShrink: 0 }} />
                        <span>
                          Discount code generation was initiated but not completed. Click below to resume and generate the code.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="rt-btn rt-btn--generate-discount"
                        style={{ marginTop: 16 }}
                        onClick={handleGenerateDiscount}
                        disabled={discountCodeLoading}
                      >
                        <Discount style={{ fontSize: 16, marginRight: 6 }} />
                        {discountCodeLoading ? 'Initiating…' : 'Generate Discount Code'}
                      </button>
                    </>
                  )}

                  {retStatus === 'inspected' && (() => {
                    const allItems = returnInfo.itemsToReturn ?? [];

                    return (
                      <>
                        <div className="rt-info-banner rt-info-banner--info">
                          <Discount style={{ fontSize: 16, flexShrink: 0 }} />
                          <span>
                            Items inspected and verified. Review the per-item breakdown carefully
                            before generating the discount code — once generated the credit value is locked.
                          </span>
                        </div>

                        {allItems.length > 0 && (
                          <>
                            <div className="rt-section" style={{ margin: '14px 0 10px' }}>
                              <span className="rt-section-text">Item Breakdown</span>
                              <span className="rt-section-line" />
                            </div>
                            <div className="rt-item-breakdown-table">
                              <div className="rt-ibt-header">
                                <span className="rt-ibt-col rt-ibt-col--name">Item</span>
                                <span className="rt-ibt-col rt-ibt-col--req">Requested</span>
                                <span className="rt-ibt-col rt-ibt-col--approved">Approved</span>
                                <span className="rt-ibt-col rt-ibt-col--rejected">Rejected</span>
                              </div>
                              {allItems.map((item, idx) => {
                                const pid         = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
                                const name        = item.product?.name ?? item.name ?? `Item ${idx + 1}`;
                                const image       = item.product?.images?.[0]?.url ?? item.image ?? null;
                                const totalQty    = item.quantity ?? 1;
                                const approvedQty = item.approvedQuantity ?? 0;
                                const rejectedQty = totalQty - approvedQty;
                                const unitPrice   = item.price ?? item.product?.price ?? 0;
                                const approvedAmt = approvedQty * unitPrice;
                                const rejectedAmt = rejectedQty * unitPrice;
                                const isFullApproved = approvedQty >= totalQty;
                                const isFullRejected = approvedQty === 0;

                                // Plea breakdown detail (if available)
                                const pleaApprovedQty = item.pleaApprovedQty ?? null;
                                const pleaRejectedQty = item.pleaRejectedQty ?? null;
                                const silentAccepted  = item.silentAcceptedQuantity ?? 0;

                                return (
                                  <div key={pid} className={`rt-ibt-row${isFullApproved ? ' rt-ibt-row--approved' : isFullRejected ? ' rt-ibt-row--rejected' : ' rt-ibt-row--partial'}`}>
                                    <div className="rt-ibt-col rt-ibt-col--name">
                                      <div className="rt-ibt-item-info">
                                        {image && <img src={image} alt={name} className="rt-ibt-img" />}
                                        <div className="rt-ibt-meta">
                                          <span className="rt-ibt-name">{name}</span>
                                          {unitPrice > 0 && (
                                            <span className="rt-ibt-unit-price">{fmtCurrency(unitPrice)} each</span>
                                          )}
                                          {item.adminRejectionReason && rejectedQty > 0 && (
                                            <span className="rt-ibt-rejection-note">{item.adminRejectionReason}</span>
                                          )}
                                          {/* Show plea breakdown detail when available */}
                                          {pleaApprovedQty != null && pleaApprovedQty > 0 && (
                                            <span className="rt-ibt-plea-note rt-ibt-plea-note--approved">
                                              Plea: +{pleaApprovedQty} approved
                                            </span>
                                          )}
                                          {pleaRejectedQty != null && pleaRejectedQty > 0 && (
                                            <span className="rt-ibt-plea-note rt-ibt-plea-note--rejected">
                                              Plea: {pleaRejectedQty} rejected
                                            </span>
                                          )}
                                          {silentAccepted > 0 && (
                                            <span className="rt-ibt-plea-note rt-ibt-plea-note--silent">
                                              {silentAccepted} silently accepted
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="rt-ibt-col rt-ibt-col--req">
                                      <span className="rt-ibt-qty">{totalQty}</span>
                                      {unitPrice > 0 && (
                                        <span className="rt-ibt-subtotal">{fmtCurrency(totalQty * unitPrice)}</span>
                                      )}
                                    </div>

                                    <div className="rt-ibt-col rt-ibt-col--approved">
                                      {approvedQty > 0 ? (
                                        <>
                                          <span className="rt-ibt-qty rt-ibt-qty--approved">
                                            <CheckCircle style={{ fontSize: 11 }} />
                                            {approvedQty}
                                          </span>
                                          {unitPrice > 0 && (
                                            <span className="rt-ibt-subtotal rt-ibt-subtotal--approved">
                                              {fmtCurrency(approvedAmt)}
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <span className="rt-ibt-none">—</span>
                                      )}
                                    </div>

                                    <div className="rt-ibt-col rt-ibt-col--rejected">
                                      {rejectedQty > 0 ? (
                                        <>
                                          <span className="rt-ibt-qty rt-ibt-qty--rejected">
                                            <Cancel style={{ fontSize: 11 }} />
                                            {rejectedQty}
                                          </span>
                                          {unitPrice > 0 && (
                                            <span className="rt-ibt-subtotal rt-ibt-subtotal--rejected">
                                              {fmtCurrency(rejectedAmt)}
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <span className="rt-ibt-none">—</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                              <div className="rt-ibt-footer">
                                <div className="rt-ibt-col rt-ibt-col--name">
                                  <span className="rt-ibt-footer-label">Totals</span>
                                </div>
                                <div className="rt-ibt-col rt-ibt-col--req">
                                  <span className="rt-ibt-footer-val">
                                    {fmtCurrency(returnInfo.requestedGross ?? 0)}
                                  </span>
                                </div>
                                <div className="rt-ibt-col rt-ibt-col--approved">
                                  <span className="rt-ibt-footer-val rt-ibt-footer-val--approved">
                                    {fmtCurrency(returnInfo.approvedGross ?? 0)}
                                  </span>
                                </div>
                                <div className="rt-ibt-col rt-ibt-col--rejected">
                                  <span className="rt-ibt-footer-val rt-ibt-footer-val--rejected">
                                    {fmtCurrency(returnInfo.rejectedGross ?? 0)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        <div style={{ marginTop: 14 }}>
                          <CreditBreakdown returnInfo={returnInfo} />
                        </div>

                        <button
                          type="button"
                          className="rt-btn rt-btn--generate-discount"
                          style={{ marginTop: 16 }}
                          onClick={handleGenerateDiscount}
                          disabled={discountCodeLoading}
                        >
                          <Discount style={{ fontSize: 16, marginRight: 6 }} />
                          {discountCodeLoading ? 'Initiating…' : 'Generate Discount Code'}
                        </button>
                      </>
                    );
                  })()}

                  {retStatus === 'approved' && (
                    <>
                      <div className="rt-progress-row">
                        {LIFECYCLE_STATUSES.map((s, idx) => {
                          const currentIdx = LIFECYCLE_STATUSES.indexOf(retStatus);
                          const isPast     = idx < currentIdx;
                          const isCurrent  = s === retStatus;
                          return (
                            <React.Fragment key={s}>
                              <div className={`rt-progress-step${isCurrent ? ' rt-progress-step--current' : isPast ? ' rt-progress-step--done' : ''}`}>
                                <div className="rt-progress-dot" />
                                <span className="rt-progress-label">{s.replace(/_/g, ' ')}</span>
                              </div>
                              {idx < LIFECYCLE_STATUSES.length - 1 && (
                                <div className={`rt-progress-line${isPast || isCurrent ? ' rt-progress-line--done' : ''}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      <div className="rt-info-banner rt-info-banner--info rt-approved-waiting-banner">
                        <LocalShipping style={{ fontSize: 16, flexShrink: 0 }} />
                        <span>
                          Waiting for the customer to confirm shipment. No action required —
                          status will advance to <strong>in transit</strong> automatically once the customer ships their items.
                        </span>
                      </div>
                    </>
                  )}

                  {retStatus === 'completed' && returnDiscountStep !== 2 && (
                    <>
                      <div className="rt-progress-row">
                        {LIFECYCLE_STATUSES.map((s, idx) => {
                          const currentIdx = LIFECYCLE_STATUSES.indexOf(retStatus);
                          const isPast     = idx < currentIdx;
                          const isCurrent  = s === retStatus;
                          return (
                            <React.Fragment key={s}>
                              <div className={`rt-progress-step${isCurrent ? ' rt-progress-step--current' : isPast ? ' rt-progress-step--done' : ''}`}>
                                <div className="rt-progress-dot" />
                                <span className="rt-progress-label">{s.replace(/_/g, ' ')}</span>
                              </div>
                              {idx < LIFECYCLE_STATUSES.length - 1 && (
                                <div className={`rt-progress-line${isPast || isCurrent ? ' rt-progress-line--done' : ''}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      <div className="rt-info-banner rt-info-banner--info">
                        <CheckCircle style={{ fontSize: 16, flexShrink: 0 }} />
                        <span>This return has been completed and the discount code has been issued to the customer.</span>
                      </div>
                    </>
                  )}

                  {!['inspected', 'approved', 'awaiting_discount', 'completed'].includes(retStatus) && (
                    <>
                      <div className="rt-progress-row">
                        {LIFECYCLE_STATUSES.map((s, idx) => {
                          const currentIdx = LIFECYCLE_STATUSES.indexOf(retStatus);
                          const isPast     = idx < currentIdx;
                          const isCurrent  = s === retStatus;
                          return (
                            <React.Fragment key={s}>
                              <div className={`rt-progress-step${isCurrent ? ' rt-progress-step--current' : isPast ? ' rt-progress-step--done' : ''}`}>
                                <div className="rt-progress-dot" />
                                <span className="rt-progress-label">{s.replace(/_/g, ' ')}</span>
                              </div>
                              {idx < LIFECYCLE_STATUSES.length - 1 && (
                                <div className={`rt-progress-line${isPast || isCurrent ? ' rt-progress-line--done' : ''}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      {validNextStatuses.length === 0 && (
                        <div className={`rt-info-banner rt-info-banner--${isTerminal ? 'warning' : 'info'}`}>
                          {isTerminal
                            ? <ReportProblem style={{ fontSize: 16, flexShrink: 0 }} />
                            : <HourglassEmpty style={{ fontSize: 16, flexShrink: 0 }} />}
                          <span>
                            {isTerminal
                              ? `This return is ${retStatus.replace(/_/g, ' ')} — no further updates.`
                              : `No status update available at this stage. Current: ${retStatus.replace(/_/g, ' ')}.`}
                          </span>
                        </div>
                      )}
                      {validNextStatuses.length > 0 && (
                        <>
                          <div className="rt-form-group">
                            <label className="rt-form-label" htmlFor="rt-new-status">Next Status *</label>
                            <select id="rt-new-status" className="rt-form-select" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} disabled={loading}>
                              <option value="">Select status</option>
                              {validNextStatuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                            </select>
                          </div>
                          {newStatus === 'inspected' && (
                            <div className="rt-form-group">
                              <label className="rt-form-label" htmlFor="rt-inspection-notes">Inspection Notes</label>
                              <textarea id="rt-inspection-notes" className="rt-form-textarea" rows={3} value={inspectionNotes}
                                onChange={(e) => setInspectionNotes(e.target.value)}
                                placeholder="Describe the condition of returned items…" disabled={loading}
                              />
                            </div>
                          )}
                          <button type="button" className="rt-btn rt-btn--primary" onClick={handleUpdateStatus} disabled={!newStatus || loading}>
                            {loading ? 'Updating…' : `Mark as ${newStatus.replace(/_/g, ' ') || '…'}`}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── TIMELINE TAB ── */}
            {activeTab === 'timeline' && (
              <div className="rt-card">
                <div className="rt-card-hd"><div><h3 className="rt-card-title"><TimelineIcon style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Timeline</h3></div></div>
                <div className="rt-card-body">
                  {timelineLoading
                    ? <div className="rt-loading"><div className="rt-spinner" /><span>Loading…</span></div>
                    : timeline.length > 0
                    ? (
                      <div className="rt-timeline">
                        {timeline.map((ev, idx) => (
                          <div key={ev._id ?? idx} className="rt-timeline-item">
                            <div className="rt-timeline-dot" />
                            <div className="rt-timeline-content">
                              <div className="rt-tl-row">
                                <strong>{ev.title ?? ev.action ?? ev.event ?? 'Event'}</strong>
                                <span className="rt-td-muted">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''}</span>
                              </div>
                              {ev.description && <p className="rt-tl-desc">{ev.description}</p>}
                              {ev.performedBy?.name && <p className="rt-tl-by">by {ev.performedBy.name}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                    : <div className="rt-empty" style={{ minHeight: 120 }}><TimelineIcon style={{ fontSize: 28, color: '#D1D5DB' }} /><span>No timeline events yet</span></div>}
                </div>
              </div>
            )}

            {/* ── DOCUMENTS TAB ── */}
            {activeTab === 'documents' && (
              <div className="rt-card">
                <div className="rt-card-hd"><div><h3 className="rt-card-title"><Description style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 6 }} />Documents</h3></div></div>
                <div className="rt-card-body">
                  <input type="file" multiple id="rt-file-upload" style={{ display: 'none' }} aria-label="Upload return documents"
                    onChange={(e) => { if (e.target.files?.length) { handleFileUpload(Array.from(e.target.files)); e.target.value = ''; } }}
                  />
                  <label htmlFor="rt-file-upload">
                    <div className="rt-upload-zone" role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}>
                      <CloudUpload className="rt-upload-icon" />
                      <p className="rt-upload-text">Click to upload documents</p>
                      <p className="rt-upload-hint">Max 8 files · Images, PDFs, Videos</p>
                    </div>
                  </label>
                  {uploadLoading && <div className="rt-loading" style={{ padding: '1rem' }}><div className="rt-spinner" /><span>Uploading…</span></div>}
                  {documentsLoading
                    ? <div className="rt-loading"><div className="rt-spinner" /><span>Loading documents…</span></div>
                    : documents.length > 0
                    ? (
                      <div className="rt-file-list">
                        {documents.map((doc, idx) => (
                          <div key={doc._id ?? idx} className="rt-file-item">
                            <div className="rt-file-info">
                              <AttachFile style={{ fontSize: 16 }} />
                              <span>{doc.filename ?? 'File'}</span>
                              {doc.fileSize && <span className="rt-file-size">{(doc.fileSize / 1024).toFixed(0)} KB</span>}
                            </div>
                            <a href={doc.url} download className="rt-btn rt-btn--ghost" target="_blank" rel="noopener noreferrer">Download</a>
                          </div>
                        ))}
                      </div>
                    )
                    : <div className="rt-empty" style={{ minHeight: 100 }}><Description style={{ fontSize: 28, color: '#D1D5DB' }} /><span>No documents uploaded yet</span></div>}
                </div>
              </div>
            )}
          </div>

          <div className="rt-drawer-footer">
            <button type="button" className="rt-btn rt-btn--primary" onClick={() => setShowMessageModal(true)}>
              <Message style={{ marginRight: 6, fontSize: 16 }} />
              Messages
              {currentReturn.returnInfo?.messages?.length > 0 && (
                <span className="rt-footer-msg-count">{currentReturn.returnInfo.messages.length}</span>
              )}
            </button>
            <button type="button" className="rt-btn rt-btn--secondary" onClick={handleClosePanel}>Close</button>
          </div>
        </div>

          {showPleaPreview && currentReturn && (
            <PleaPreviewModal
              items={currentReturn.returnInfo?.itemsToReturn ?? []}
              decisions={pleaDecisions}
              adminNote={pleaAdminNote}
              onConfirm={handlePleaReviewConfirm}
              onCancel={() => setShowPleaPreview(false)}
              loading={pleaReviewLoading}
              r1Map={round1ApprovedQty}
            />
          )}
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="rt-page">
        <div className="rt-body">
          <Link to="/admin/dashboard" className="rt-back-btn"><ArrowBack style={{ fontSize: 15 }} />Dashboard</Link>

          <div className="rt-hd">
            <div className="rt-hd-left">
              <span className="rt-hd-icon" style={{ background: '#6366F115', color: '#6366F1' }}>
                <Inventory style={{ fontSize: 24 }} />
              </span>
              <div>
                <h1 className="rt-hd-title">Returns Management</h1>
                <p className="rt-hd-sub">Review, approve and process customer return requests</p>
              </div>
            </div>
            <div className="rt-hd-right">
              <button type="button"
                className={`rt-icon-btn${(returnsLoading || unreadLoading) ? ' rt-icon-btn--spin' : ''}`}
                onClick={handleFetchReturns} disabled={returnsLoading || unreadLoading} title="Refresh"
              >
                <Refresh style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>

          <div className="rt-kpi-grid">{renderKPICards()}</div>

          <div className="rt-section"><span className="rt-section-text">Return Requests</span><span className="rt-section-line" /></div>

          <div className="rt-filters">
            <div className="rt-search-wrap">
              <Search className="rt-search-icon" style={{ fontSize: 16 }} />
              <input type="text" className="rt-search-input" placeholder="Search RMA number…" value={rmaSearch}
                onChange={(e) => setRmaSearch(e.target.value)} aria-label="Search by RMA number"
              />
            </div>
            <div className="rt-tf rt-filter-pills">
              {STATUS_FILTERS.map((opt) => (
                <button key={opt.value || 'all'} type="button"
                  className={`rt-tf-btn${filterStatus === opt.value ? ' rt-tf-btn--active' : ''}`}
                  onClick={() => setFilterStatus(opt.value)}
                >
                  {opt.label}
                  {hasUnreadByStatus[opt.value || 'all'] && <span className="rt-tab-dot" />}
                </button>
              ))}
            </div>
            <div className="rt-date-wrap">
              <input type="date" className="rt-date-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
              <span className="rt-date-sep">—</span>
              <input type="date" className="rt-date-input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
            </div>
            <div className="rt-sort-wrap">
              <select className="rt-form-select rt-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort by">
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="button" className="rt-icon-btn rt-sort-dir-btn" onClick={() => setSortOrder((o) => o === 'desc' ? 'asc' : 'desc')}>
                <span className={`rt-sort-arrow${sortOrder === 'asc' ? ' rt-sort-arrow--up' : ''}`}>↓</span>
              </button>
            </div>
            <div className="rt-toggle-wrap">
              <button type="button" role="switch" aria-checked={showUnreadOnly}
                className={`rt-toggle${showUnreadOnly ? ' rt-toggle--active' : ''}`}
                onClick={() => setShowUnreadOnly((v) => !v)} aria-label="Show unread only"
              >
                <span className="rt-toggle-knob" />
              </button>
              <span className="rt-toggle-label">Unread Only</span>
            </div>
          </div>

          {error && (
            <div className="rt-error-banner" role="alert">
              <Warning style={{ fontSize: 18, flexShrink: 0 }} />
              <div><strong className="rt-error-title">Error</strong><p className="rt-error-msg">{error}</p></div>
            </div>
          )}

          {errorStage === 'send' && pendingAttachments.length > 0 && (
            <div className="rt-retry-banner" role="alert">
              <Warning style={{ fontSize: 16, flexShrink: 0 }} />
              <span className="rt-retry-msg">Files uploaded but message failed to send.</span>
              <div className="rt-retry-actions">
                <button type="button" className="rt-btn rt-btn--primary" onClick={handleRetryMessage} disabled={messageSendLoading}>
                  {messageSendLoading ? 'Retrying…' : 'Retry Send'}
                </button>
                <button type="button" className="rt-btn rt-btn--ghost" onClick={() => dispatch(clearPendingAttachments())}>Dismiss</button>
              </div>
            </div>
          )}

          <div className="rt-card">
            <div className="rt-card-hd">
              <div>
                <h3 className="rt-card-title">{showUnreadOnly ? 'Unread Returns' : 'All Returns'}</h3>
                <p className="rt-card-sub">
                  {returnsLoading || unreadLoading ? 'Loading…' : showUnreadOnly ? `${unreadReturns.length} with unread messages` : `${totalReturns} total`}
                </p>
              </div>
            </div>
            <div className="rt-card-body--np">
              {renderTable()}
              {renderPagination()}
            </div>
          </div>

          {success && successMessage && (
            <div className="rt-toast-wrap" role="status" aria-live="polite">
              <div className="rt-toast rt-toast--success">
                <CheckCircle style={{ fontSize: 18 }} />
                <div><strong>Success</strong><p>{successMessage}</p></div>
              </div>
            </div>
          )}
        </div>

        {renderDetailPanel()}

        {showMessageModal && currentReturn && (
          <ReturnMessagesModal
            isOpen={showMessageModal} onClose={handleCloseMessageModal}
            orderId={selectedId}
            orderInfo={{ orderNumber: currentReturn._id?.toString().slice(-6).toUpperCase() ?? '', customerName: getCustomerName(currentReturn.user) }}
            messages={messages} loading={messagesLoading}
            hasMoreMessages={hasMoreMessages} totalMessages={totalMessages}
            onSendMessage={handleSendMessage} onRefresh={() => dispatch(getReturnMessages({ orderId: selectedId, page: 1 }))}
            onLoadMore={handleLoadMoreMessages} pendingAttachments={pendingAttachments}
            errorStage={errorStage} onClearPending={() => dispatch(clearPendingAttachments())}
            currentUserRole="admin" isSendingExternal={messageSendLoading}
          />
        )}
      </div>
      <Footer />
    </>
  );
};

export default AdminReturns;