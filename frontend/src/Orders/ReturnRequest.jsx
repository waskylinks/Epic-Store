// ReturnRequest.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import axios from 'axios';
import {
  FiPackage, FiAlertCircle, FiClock, FiSend, FiPaperclip,
  FiX, FiFile, FiVideo, FiMessageSquare, FiRotateCcw, FiInfo,
  FiArrowLeft, FiBox, FiCheckCircle, FiXCircle, FiTag, FiLoader,
  FiThumbsUp, FiThumbsDown, FiTruck, FiMapPin, FiDollarSign,
  FiGift,
} from 'react-icons/fi';

import PageTitle           from '../components/PageTitle';
import Navbar              from '../components/Navbar';
import Footer              from '../components/footer';
import Loader              from '../components/Loader';
import ReturnMessagesModal from './ReturnMessagesModal';

import { getOrderDetails } from '../features/cart/orderSlice';
import {
  requestReturn,
  getReturnStatus,
  sendReturnMessage,
  getReturnMessages,
  uploadReturnFiles,
  cancelReturn,
  submitPlea,
  acceptDecisions,
  confirmShipped,
  clearReturnState,
  clearReturnMessages,
  clearPendingAttachments,
  clearPleaError,
} from '../features/returns/returnSlice';

import '../OrderStyles/ReturnRequest.css';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const RETURN_REASONS = [
  { value: 'defective_product', label: 'Defective or Damaged Product' },
  { value: 'wrong_item',        label: 'Wrong Item Received'           },
  { value: 'wrong_size',        label: 'Wrong Size/Fit'                },
  { value: 'not_as_described',  label: 'Product Not As Described'      },
  { value: 'quality_issues',    label: 'Quality Issues'                },
  { value: 'changed_mind',      label: 'Changed My Mind'               },
  { value: 'better_price',      label: 'Found Better Price'            },
  { value: 'duplicate_order',   label: 'Duplicate Order'               },
  { value: 'no_longer_needed',  label: 'No Longer Needed'              },
  { value: 'other',             label: 'Other'                         },
];

const COURIERS = [
  { value: 'DHL',           label: 'DHL'             },
  { value: 'FedEx',         label: 'FedEx'           },
  { value: 'UPS',           label: 'UPS'             },
  { value: 'GIG Logistics', label: 'GIG Logistics'   },
  { value: 'Sendbox',       label: 'Sendbox'         },
  { value: 'Aramex',        label: 'Aramex'          },
  { value: 'GIGL',          label: 'GIGL'            },
  { value: 'Kwik',          label: 'Kwik'            },
  { value: 'Other',         label: 'Other (specify)' },
];

const RETURN_ADDRESS = {
  name:    'Epic Store Returns',
  line1:   '12 Wuse Zone 5',
  line2:   'Abuja, FCT 900288',
  country: 'Nigeria',
  phone:   '+234 906 161 4369',
};

const LIFECYCLE_ORDER = [
  'requested', 'items_reviewed', 'plea_submitted',
  'approved', 'in_transit', 'received', 'inspected',
  'awaiting_discount', 'completed',
];

const MAX_FILES      = 8;
const MAX_DESC_CHARS = 2000;
const MAX_PLEA_CHARS = 2000;
const MIN_PLEA_CHARS = 10;

const ALLOWED_FILE_TYPES = {
  images:    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos:    ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf'],
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Resolves the best product name from a returnInfo item, falling back through
// item.name, item.product.name, and then matching against order.orderItems.
const resolveItemName = (item, orderItems, idx) => {
  if (item.name?.trim())          return item.name.trim();
  if (item.product?.name?.trim()) return item.product.name.trim();
  const pid = item.product?._id?.toString() ?? item.product?.toString();
  const match = orderItems?.find((oi) => {
    const oiPid = oi.product?._id?.toString() ?? oi.product?.toString();
    return oiPid === pid;
  });
  return match?.product?.name ?? match?.name ?? `Item ${(idx ?? 0) + 1}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// getRejectedUnits
//
// Returns a normalised list of items that have ANY rejected/unapproved units.
//
// With the UNIFIED MODEL from reviewReturnRequest:
//   - adminDecision='rejected'  → approvedQuantity=0  → fully rejected
//   - adminDecision='approved'  → approvedQuantity>0  → either full or partial
//     If approvedQuantity < quantity, the remainder is appealable.
//
// The 'rejected' branch uses (item.quantity - (item.approvedQuantity ?? 0))
// rather than item.quantity because the unified model guarantees
// approvedQuantity=0 for fully-rejected items, making both equivalent —
// but the subtraction form is explicit and correct for any future state.
//
// Returns: [{ item, idx, pid, rejectedQty, isPartial }]
// ─────────────────────────────────────────────────────────────────────────────
const getRejectedUnits = (returnItems) =>
  returnItems.reduce((acc, item, idx) => {
    const pid        = item.product?._id?.toString() ?? item.product?.toString() ?? String(idx);
    const totalQty   = item.quantity ?? 1;
    const approvedQty = item.approvedQuantity ?? 0;
    const decision   = item.adminDecision;

    if (decision === 'rejected') {
      // Unified model: adminDecision='rejected' always means approvedQuantity=0.
      // rejectedQty = totalQty - approvedQty = totalQty - 0 = totalQty.
      const rejectedQty = totalQty - approvedQty;
      if (rejectedQty > 0) {
        acc.push({ item, idx, pid, rejectedQty, isPartial: false });
      }
    } else if (decision === 'approved') {
      // Partial approval: some units approved, the remainder is unapproved.
      const remainder = totalQty - approvedQty;
      if (remainder > 0) {
        acc.push({ item, idx, pid, rejectedQty: remainder, isPartial: true });
      }
    }
    return acc;
  }, []);

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const CountdownTimer = ({ deadline, label, expiredLabel = 'Expired' }) => {
  const [timeLeft, setTimeLeft] = useState(null);
  useEffect(() => {
    if (!deadline) return;
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
    <div className={`rtr-countdown ${isExpired ? 'rtr-countdown-expired' : ''}`}>
      <FiClock className="rtr-countdown-icon" />
      {label && <span className="rtr-countdown-label">{label}</span>}
      <span className="rtr-countdown-value">
        {isExpired ? expiredLabel : `${timeLeft.d}d ${timeLeft.h}h ${timeLeft.m}m ${timeLeft.s}s`}
      </span>
    </div>
  );
};

const ReturnStatusBadge = ({ status }) => {
  const configs = {
    none:              { label: 'No Return',         className: 'rtr-return-badge-none'              },
    requested:         { label: 'Return Requested',  className: 'rtr-return-badge-requested'         },
    items_reviewed:    { label: 'Items Reviewed',    className: 'rtr-return-badge-items-reviewed'    },
    plea_submitted:    { label: 'Plea Submitted',    className: 'rtr-return-badge-plea-submitted'    },
    approved:          { label: 'Approved',          className: 'rtr-return-badge-approved'          },
    awaiting_discount: { label: 'Awaiting Discount', className: 'rtr-return-badge-awaiting-discount' },
    in_transit:        { label: 'In Transit',        className: 'rtr-return-badge-transit'           },
    received:          { label: 'Received',          className: 'rtr-return-badge-received'          },
    inspected:         { label: 'Inspected',         className: 'rtr-return-badge-inspected'         },
    completed:         { label: 'Completed',         className: 'rtr-return-badge-completed'         },
    rejected:          { label: 'Rejected',          className: 'rtr-return-badge-rejected'          },
    cancelled:         { label: 'Cancelled',         className: 'rtr-return-badge-cancelled'         },
  };
  const config = configs[status] ?? configs.none;
  return <span className={`rtr-return-badge ${config.className}`}>{config.label}</span>;
};

// ─────────────────────────────────────────────────────────────────────────────
// CreditBreakdown
// ─────────────────────────────────────────────────────────────────────────────
const CreditBreakdown = ({ returnInfo, currency = 'USD', showPleaDetail = false, orderItems = [] }) => {
  const {
    requestedGross   = 0,
    approvedGross    = 0,
    rejectedGross    = 0,
    approvedDiscount = 0,
    shippingDeducted = 0,
    discountValue    = 0,
    itemsToReturn    = [],
  } = returnInfo ?? {};
 
  const fmt = (n) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(n ?? 0);
 
  // Determine whether any item has plea-pool data worth showing.
  const hasPleaDetail = showPleaDetail && itemsToReturn.some(
    (i) => (i.pleaApprovedQty != null && i.pleaApprovedQty > 0) ||
            (i.pleaRejectedQty != null && i.pleaRejectedQty > 0) ||
            (i.silentAcceptedQuantity != null && i.silentAcceptedQuantity > 0)
  );
 
  return (
    <div className="rtr-credit-breakdown">
      <div className="rtr-credit-hd">
        <FiDollarSign className="rtr-credit-hd-icon" />
        <span>Return Credit Breakdown</span>
      </div>
      <div className="rtr-credit-rows">
        <div className="rtr-credit-row">
          <span className="rtr-credit-label">Requested Total</span>
          <span className="rtr-credit-val">{fmt(requestedGross)}</span>
        </div>
        <div className="rtr-credit-row rtr-credit-row--approved">
          <span className="rtr-credit-label">Approved Total</span>
          <span className="rtr-credit-val rtr-credit-green">{fmt(approvedGross)}</span>
        </div>
        {rejectedGross > 0 && (
          <div className="rtr-credit-row rtr-credit-row--rejected">
            <span className="rtr-credit-label">Rejected Total</span>
            <span className="rtr-credit-val rtr-credit-red">−{fmt(rejectedGross)}</span>
          </div>
        )}
        {approvedDiscount > 0 && (
          <div className="rtr-credit-row rtr-credit-row--deduct">
            <span className="rtr-credit-label">Discount Applied</span>
            <span className="rtr-credit-val rtr-credit-amber">−{fmt(approvedDiscount)}</span>
          </div>
        )}
        <div className="rtr-credit-row rtr-credit-row--deduct">
          <span className="rtr-credit-label">Shipping Deducted</span>
          <span className="rtr-credit-val rtr-credit-amber">−{fmt(shippingDeducted)}</span>
        </div>
        <div className="rtr-credit-divider" />
        <div className="rtr-credit-row rtr-credit-row--total">
          <span className="rtr-credit-label-total">Return Credit Value</span>
          <span className="rtr-credit-val-total">{fmt(discountValue)}</span>
        </div>
      </div>
 
      {/* ── PLEA POOL DETAIL ──────────────────────────────────────────────────
          Uses only existing rtr- CSS classes. No new class names introduced.
          Structure mirrors the .rtr-item-decisions section elsewhere on the
          page so the visual language is consistent.
      ──────────────────────────────────────────────────────────────────────── */}
      {hasPleaDetail && (
        <div className="rtr-item-decisions" style={{ marginTop: 16 }}>
          {/* Section heading — reuses .rtr-decisions-col-header pattern */}
          <div className="rtr-decisions-col-header" style={{ marginBottom: 10 }}>
            <FiInfo />
            <span>Plea Decision Breakdown</span>
          </div>
 
          {itemsToReturn.map((item, idx) => {
            const totalQty       = item.quantity ?? 1;
            const approvedQty    = item.approvedQuantity ?? 0;
            const pleaApproved   = item.pleaApprovedQty        ?? null;
            const pleaRejected   = item.pleaRejectedQty        ?? null;
            const silentAccepted = item.silentAcceptedQuantity ?? 0;
 
            // Only render items that went through a plea round
            const hadPlea = (pleaApproved != null && pleaApproved > 0) ||
                            (pleaRejected != null && pleaRejected > 0) ||
                            silentAccepted > 0;
            if (!hadPlea) return null;
 
            // R1 locked = units approved before the plea (never contested).
            // Guard against null pleaApproved so r1Locked stays meaningful.
            const r1Locked = (pleaApproved != null)
              ? Math.max(0, approvedQty - pleaApproved)
              : approvedQty;
 
            // FIX: use resolveItemName so the product name is always shown,
            // never falling back to "Item 1 / Item 2 / Item 4"
            const name = resolveItemName(item, orderItems, idx);
 
            return (
              <div key={idx} className="rtr-decision-item" style={{ marginBottom: 10 }}>
                {/* Item name row — reuses .rtr-item-details */}
                <div className="rtr-item-details">
                  <span className="rtr-item-name">{name}</span>
 
                  {/* R1 locked approved */}
                  {r1Locked > 0 && (
                    <span className="rtr-item-quantity" style={{ color: '#10B981' }}>
                      <FiCheckCircle style={{ fontSize: 11, marginRight: 3 }} />
                      Round 1 approved: {r1Locked} unit{r1Locked !== 1 ? 's' : ''}
                    </span>
                  )}
 
                  {/* Plea approved */}
                  {pleaApproved != null && pleaApproved > 0 && (
                    <span className="rtr-item-quantity" style={{ color: '#10B981' }}>
                      <FiCheckCircle style={{ fontSize: 11, marginRight: 3 }} />
                      Plea approved: {pleaApproved} unit{pleaApproved !== 1 ? 's' : ''}
                    </span>
                  )}
 
                  {/* Plea rejected */}
                  {pleaRejected != null && pleaRejected > 0 && (
                    <span className="rtr-item-quantity" style={{ color: '#EF4444' }}>
                      <FiXCircle style={{ fontSize: 11, marginRight: 3 }} />
                      Plea rejected: {pleaRejected} unit{pleaRejected !== 1 ? 's' : ''}
                    </span>
                  )}
 
                  {/* Silently accepted (not contested) */}
                  {silentAccepted > 0 && (
                    <span className="rtr-rejection-reason">
                      <FiXCircle style={{ fontSize: 11, marginRight: 3 }} />
                      Accepted as rejected: {silentAccepted} unit{silentAccepted !== 1 ? 's' : ''}
                    </span>
                  )}
 
                  {/* Final summary line */}
                  <span className="rtr-rejection-reason" style={{ marginTop: 3, fontStyle: 'normal', fontWeight: 500 }}>
                    Final: {approvedQty} approved · {totalQty - approvedQty} rejected
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
 

const PolicyGate = ({ onAccept }) => (
  <div className="rtr-policy-gate">
    <div className="rtr-policy-gate-card">
      <div className="rtr-policy-gate-header">
        <FiInfo className="rtr-policy-gate-icon" />
        <h2>Before You Continue</h2>
        <p>Please read and acknowledge our return policy:</p>
      </div>
      <div className="rtr-policy-statements">
        <div className="rtr-policy-statement">
          <FiTag className="rtr-policy-statement-icon" />
          <span>All returns are processed as <strong>store credit discount codes</strong>. No cash or card refunds are issued.</span>
        </div>
        <div className="rtr-policy-statement">
          <FiXCircle className="rtr-policy-statement-icon rtr-policy-icon-red" />
          <span>Item prices and shipping costs are <strong>non-refundable</strong>.</span>
        </div>
        <div className="rtr-policy-statement">
          <FiCheckCircle className="rtr-policy-statement-icon rtr-policy-icon-green" />
          <span>Your discount value is calculated based on <strong>approved items only</strong>.</span>
        </div>
      </div>
      <button className="rtr-btn-primary rtr-policy-gate-btn" onClick={onAccept}>
        I Understand, Continue to Return Form
      </button>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ReturnRequest() {
  const { id: orderId } = useParams();
  const navigate         = useNavigate();
  const dispatch         = useDispatch();
  const fileInputRef     = useRef(null);
  const pleaFileInputRef = useRef(null);
  const location         = useLocation();
  const trackingTopRef   = useRef(null);

  const { order, loading: orderLoading } = useSelector((s) => s.order);

  const {
    messages, loading, messagesLoading, messageSendLoading,
    uploadLoading, pleaLoading, acceptLoading, confirmShippedLoading,
    pleaError, hasMoreMessages, totalMessages, messagesPage,
    pendingAttachments, errorStage, error, success,
    // FIX: destructure local courier/tracking values from the slice so the
    // in_transit panel can display them immediately after confirmShipped,
    // before the server re-fetch completes or in case the server omits them.
    courierName:    sliceCourierName,
    trackingNumber: sliceTrackingNumber,
  } = useSelector((s) => s.return);

  // ── Local state ───────────────────────────────────────────────────────────
  const [policyAcknowledged,  setPolicyAcknowledged]  = useState(false);
  const [formData,            setFormData]            = useState({ reason: '', description: '', itemsToReturn: [] });
  const [formErrors,          setFormErrors]          = useState({});
  const [selectedFiles,       setSelectedFiles]       = useState([]);
  const [filePreviews,        setFilePreviews]        = useState([]);
  const [showCancelModal,     setShowCancelModal]     = useState(false);
  const [showMessagesModal,   setShowMessagesModal]   = useState(false);

  // Plea state
  const [pleaText,            setPleaText]            = useState('');
  const [pleaFiles,           setPleaFiles]           = useState([]);
  const [pleaFilePreviews,    setPleaFilePreviews]    = useState([]);
  const [pleaUploading,       setPleaUploading]       = useState(false);
  // Map of productId → how many units user is appealing
  const [pleaQuantities,      setPleaQuantities]      = useState({});

  // items_reviewed choice: null | 'plea' | 'accepted'
  const [itemsReviewedChoice, setItemsReviewedChoice] = useState(null);
  const [showAcceptConfirm,   setShowAcceptConfirm]   = useState(false);

  // confirm-shipped state
  const [selectedCourier,     setSelectedCourier]     = useState('');
  const [otherCourier,        setOtherCourier]        = useState('');
  const [trackingInput,       setTrackingInput]       = useState('');

  // ── Derived state ─────────────────────────────────────────────────────────
  const returnInfo    = order?.returnInfo ?? null;
  const returnItems   = returnInfo?.itemsToReturn ?? [];
  const status        = returnInfo?.status ?? 'none';
  const isTracking    = !!(status && status !== 'none');
  const pleaDeadline  = returnInfo?.pleaDeadline ?? null;
  const pleaAttempts  = returnInfo?.pleaAttempts ?? 0;
  const pleaInfo      = returnInfo?.pleaInfo ?? null;

  // FIX: approvedItems — filters by adminDecision === 'approved'.
  // With the unified model this is correct: all items with any approved units
  // (whether from approve-path or reject-path) have adminDecision='approved'.
  // Fully-rejected items (approvedQuantity=0) have adminDecision='rejected'
  // and are correctly excluded.
  const approvedItems = returnItems.filter((i) => i.adminDecision === 'approved');

  // Uses getRejectedUnits so partially-approved items (where approvedQuantity
  // is less than quantity) are also included — their unapproved remainder is
  // appealable and should appear in the rejected column.
  const rejectedUnitsList = getRejectedUnits(returnItems);
  const hasRejectedItems  = rejectedUnitsList.length > 0;

  // FIX: allItemsRejectedAfterPlea — with the unified model, adminDecision='rejected'
  // only applies to fully-rejected items (approvedQuantity=0). So checking that
  // every item has adminDecision='rejected' correctly identifies the case where
  // zero units were approved across all items after plea resolution.
  const allItemsRejectedAfterPlea =
    status === 'approved' &&
    returnItems.length > 0 &&
    returnItems.every((i) => i.adminDecision === 'rejected') &&
    pleaAttempts > 0;

  const pleaWindowOpen = React.useMemo(
    () =>
      status === 'items_reviewed' &&
      pleaAttempts === 0 &&
      !!pleaDeadline &&
      new Date(pleaDeadline) > new Date(),
    [status, pleaAttempts, pleaDeadline]
  );

  const allApproved = status === 'items_reviewed' && !hasRejectedItems && approvedItems.length > 0;

  const fromMyRefunds = location.state?.from === 'my-refunds-returns';
  const backPath      = fromMyRefunds ? '/my-refunds-returns' : `/order/${orderId}`;
  const backLabel     = fromMyRefunds ? 'Back' : 'Back to Order Details';

  const unreadCount = messages.filter((m) => m.senderType === 'admin' && !m.isRead).length;

  const effectiveCourier = selectedCourier === 'Other' ? otherCourier.trim() : selectedCourier;
  const currency         = order?.paymentInfo?.currency ?? 'USD';
  const orderItems       = order?.orderItems ?? [];

  // FIX: resolve courierName and trackingNumber using both server returnInfo
  // and local slice state as fallback. The slice stores these immediately after
  // confirmShipped.fulfilled, before the server re-fetch resolves.
  const displayCourierName    = returnInfo?.courierName    ?? sliceCourierName    ?? null;
  const displayTrackingNumber = returnInfo?.trackingNumber ?? sliceTrackingNumber ?? null;

  // Whether the return has gone through a plea round — used to decide whether
  // to show the per-item plea pool detail in CreditBreakdown.
  const hasPleaRound = pleaAttempts > 0;

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (orderId) dispatch(getOrderDetails(orderId));
  }, [dispatch, orderId]);

  useEffect(() => {
    if (isTracking && orderId) dispatch(getReturnStatus(orderId));
  }, [isTracking, orderId, dispatch]);

  const fetchMessages = useCallback(
    (page = 1) => { if (orderId) dispatch(getReturnMessages({ orderId, page })); },
    [dispatch, orderId]
  );

  useEffect(() => {
    if (isTracking) fetchMessages(1);
  }, [isTracking, fetchMessages]);

  useEffect(() => {
    if (isTracking && trackingTopRef.current) {
      trackingTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isTracking]);

  useEffect(() => {
    if (allApproved && !itemsReviewedChoice) setItemsReviewedChoice('accepted');
  }, [allApproved, itemsReviewedChoice]);

  // FIX: Seed pleaQuantities using rejectedUnitsList so the stepper defaults
  // to the actual unapproved/rejected quantity for each item, not item.quantity.
  // For partially-approved items (isPartial=true) this means the stepper starts
  // at (quantity - approvedQuantity), not the full quantity. The stepper is also
  // capped at rejectedQty so the customer cannot accidentally plea for already-
  // approved units.
  useEffect(() => {
    if (itemsReviewedChoice !== 'plea' || rejectedUnitsList.length === 0) return;
    const initial = {};
    rejectedUnitsList.forEach(({ pid, rejectedQty }) => {
      initial[pid] = rejectedQty;
    });
    setPleaQuantities(initial);
  }, [itemsReviewedChoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate items for new-return form
  const itemsPopulated = useRef(false);
  useEffect(() => {
    if (order?.orderItems && !isTracking && !itemsPopulated.current) {
      itemsPopulated.current = true;
      const items = order.orderItems.map((item) => ({
        product:        item.product?._id ?? item.product,
        name:           item.product?.name ?? item.name ?? '',
        price:          item.price   || 0,
        image:          item.product?.images?.[0]?.url ?? item.image ?? '',
        quantity:       parseInt(item.quantity, 10) || 1,
        returnQuantity: parseInt(item.quantity, 10) || 1,
        reason:         '',
        selected:       true,
      }));
      setFormData((prev) => ({ ...prev, itemsToReturn: items }));
    }
  }, [order?.orderItems, isTracking]);

  // Reset returnInfoPopulated when orderId changes
  const returnInfoPopulated = useRef(false);
  useEffect(() => {
    returnInfoPopulated.current = false;
  }, [orderId]);

  useEffect(() => {
    if (isTracking && returnInfo && !returnInfoPopulated.current) {
      returnInfoPopulated.current = true;
      setFormData({
        reason:        returnInfo.reason        || '',
        description:   returnInfo.description   || '',
        itemsToReturn: returnInfo.itemsToReturn ?? [],
      });
    }
  }, [isTracking, returnInfo]);

  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center' });
      dispatch(clearReturnState());
    }
    if (success) {
      toast.success('Return request submitted successfully', { position: 'top-center', autoClose: 3000 });
      dispatch(clearReturnState());
    }
  }, [success, error, dispatch]);

  useEffect(() => {
    if (pleaError) {
      toast.error(pleaError, { position: 'top-center' });
      dispatch(clearPleaError());
    }
  }, [pleaError, dispatch]);

  // ── Form handlers ─────────────────────────────────────────────────────────

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) setFormErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleItemToggle = (index) => {
    setFormData((prev) => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item
      ),
    }));
  };

  const handleQuantityChange = (index, quantity) => {
    const item = formData.itemsToReturn[index];
    setFormData((prev) => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((it, i) =>
        i === index ? { ...it, returnQuantity: Math.max(1, Math.min(quantity, item.quantity)) } : it
      ),
    }));
  };

  const handleItemReasonChange = (index, value) => {
    setFormData((prev) => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((it, i) =>
        i === index ? { ...it, reason: value } : it
      ),
    }));
    if (formErrors[`itemReason_${index}`]) {
      setFormErrors((prev) => ({ ...prev, [`itemReason_${index}`]: '' }));
    }
  };

  // ── File handling ─────────────────────────────────────────────────────────

  const isFileTypeAllowed = (file) => {
    const all = [...ALLOWED_FILE_TYPES.images, ...ALLOWED_FILE_TYPES.videos, ...ALLOWED_FILE_TYPES.documents];
    return all.includes(file.type);
  };

  const addFiles = (files, setFiles, setPreviews, existingCount) => {
    if (existingCount + files.length > MAX_FILES) {
      toast.error(`You can only upload up to ${MAX_FILES} files`, { position: 'top-center' });
      return;
    }
    const valid = files.filter((file) => {
      if (!isFileTypeAllowed(file)) { toast.error(`${file.name} is not a supported file type`, { position: 'top-center' }); return false; }
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} exceeds 10 MB limit`, { position: 'top-center' }); return false; }
      return true;
    });
    setFiles((prev) => [...prev, ...valid]);
    valid.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => setPreviews((prev) => [...prev, { file, preview: reader.result, type: file.type }]);
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect     = (e) => { addFiles(Array.from(e.target.files), setSelectedFiles, setFilePreviews, selectedFiles.length); e.target.value = ''; };
  const handlePleaFileSelect = (e) => { addFiles(Array.from(e.target.files), setPleaFiles, setPleaFilePreviews, pleaFiles.length); e.target.value = ''; };
  const removeFile     = (i) => { setSelectedFiles((p) => p.filter((_, j) => j !== i)); setFilePreviews((p) => p.filter((_, j) => j !== i)); };
  const removePleaFile = (i) => { setPleaFiles((p) => p.filter((_, j) => j !== i)); setPleaFilePreviews((p) => p.filter((_, j) => j !== i)); };

  // ── Accept decisions ──────────────────────────────────────────────────────

  const handleAcceptDecisions = async () => {
    try {
      await dispatch(acceptDecisions(orderId)).unwrap();
      toast.success('Decisions accepted. Please ship your approved items back to us.', {
        position: 'top-center', autoClose: 5000,
      });
      setItemsReviewedChoice('accepted');
      setShowAcceptConfirm(false);
      await dispatch(getOrderDetails(orderId));
      dispatch(getReturnStatus(orderId));
    } catch (err) {
      toast.error(typeof err === 'string' ? err : err?.message ?? 'Failed to accept decisions.', { position: 'top-center' });
    }
  };

  // ── Confirm shipped ───────────────────────────────────────────────────────

  const handleConfirmShipped = async () => {
    if (!selectedCourier) {
      toast.error('Please select a courier.', { position: 'top-center' });
      return;
    }
    if (selectedCourier === 'Other' && !otherCourier.trim()) {
      toast.error('Please specify your courier name.', { position: 'top-center' });
      return;
    }
    try {
      await dispatch(confirmShipped({
        orderId,
        courierName:    effectiveCourier || undefined,
        trackingNumber: trackingInput.trim() || undefined,
      })).unwrap();
      toast.success('Shipment confirmed! We will notify you when we receive your items.', {
        position: 'top-center', autoClose: 5000,
      });
      await dispatch(getOrderDetails(orderId));
      dispatch(getReturnStatus(orderId));
    } catch (err) {
      toast.error(typeof err === 'string' ? err : err?.message ?? 'Failed to confirm shipment.', { position: 'top-center' });
    }
  };

  // ── Plea submit ───────────────────────────────────────────────────────────

  const handleSubmitPlea = async () => {
    if (pleaText.trim().length < MIN_PLEA_CHARS) {
      toast.error(`Plea description must be at least ${MIN_PLEA_CHARS} characters.`, { position: 'top-center' });
      return;
    }

    // FIX: Build pleaItems from rejectedUnitsList — covers both fully-rejected
    // items (adminDecision='rejected') and partially-approved items whose
    // unapproved remainder is being appealed (adminDecision='approved',
    // approvedQuantity < quantity). rejectedQty in both cases is already the
    // correct contestable quantity (computed in getRejectedUnits as
    // totalQty - approvedQty for the partial case), so capping at rejectedQty
    // ensures the customer cannot appeal already-approved units.
    const pleaItems = rejectedUnitsList.map(({ pid, rejectedQty }) => {
      const chosen = pleaQuantities[pid] ?? rejectedQty;
      return {
        productId:    pid,
        pleaQuantity: Math.min(Math.max(1, chosen), rejectedQty),
      };
    });

    const pleaPromise = dispatch(submitPlea({
      orderId,
      pleaDescription: pleaText.trim(),
      pleaItems,
    })).unwrap();

    if (pleaFiles.length > 0) {
      setPleaUploading(true);
      const uploadFormData = new FormData();
      pleaFiles.forEach((f) => uploadFormData.append('attachments', f));
      axios.post(`/api/v1/orders/${orderId}/return/plea/upload`, uploadFormData, { withCredentials: true })
        .catch(() => {
          toast.warn('Evidence files could not be uploaded, but your plea was still submitted.', {
            position: 'top-center', autoClose: 4000,
          });
        })
        .finally(() => setPleaUploading(false));
    }

    try {
      await pleaPromise;
      toast.success('Plea submitted. The admin will respond within 48 hours.', {
        position: 'top-center', autoClose: 4000,
      });
      setPleaText('');
      setPleaFiles([]);
      setPleaFilePreviews([]);
      setPleaQuantities({});
      setItemsReviewedChoice(null);
      await dispatch(getOrderDetails(orderId));
      dispatch(getReturnStatus(orderId));
    } catch {
      // pleaError in slice triggers toast via useEffect
    }
  };

  // ── Validation ────────────────────────────────────────────────────────────

  const validateForm = () => {
    const errors = {};
    if (!formData.reason) errors.reason = 'Please select a return reason';
    if (!formData.description || formData.description.trim().length < 5)
      errors.description = 'Please provide a description of at least 5 characters';
    if (formData.description && formData.description.length > MAX_DESC_CHARS)
      errors.description = `Description cannot exceed ${MAX_DESC_CHARS} characters`;
    const selected = formData.itemsToReturn.filter((i) => i.selected);
    if (selected.length === 0) errors.items = 'Please select at least one item to return';
    selected.forEach((item) => {
      const originalIndex = formData.itemsToReturn.indexOf(item);
      if (!item.reason || item.reason.trim().length < 5)
        errors[`itemReason_${originalIndex}`] = 'Please select a reason for this item';
    });
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Submit return form ────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error('Please fix the errors in the form', { position: 'top-center' });
      return;
    }
    try {
      const selectedItems = formData.itemsToReturn
        .filter((item) => item.selected)
        .map(({ product, returnQuantity, name, price, image, reason }) => ({
          product:  product?._id?.toString() ?? product?.toString() ?? product,
          quantity: returnQuantity,
          name, price, image, reason,
        }));

      await dispatch(requestReturn({
        orderId,
        returnData: { reason: formData.reason, description: formData.description, items: selectedItems, attachments: [] },
      })).unwrap();

      if (selectedFiles.length > 0) {
        try {
          await dispatch(uploadReturnFiles({ orderId, files: selectedFiles })).unwrap();
        } catch {
          toast.warn('Return submitted but file upload failed. You can retry from the messages panel.', {
            position: 'top-center', autoClose: 5000,
          });
        }
      }

      dispatch(getOrderDetails(orderId));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error(err?.message || err || 'Failed to submit return request', { position: 'top-center', autoClose: 3000 });
    }
  };

  // ── Message handlers ──────────────────────────────────────────────────────

  const handleSendMessage = useCallback(
    async (content, files, pendingUrls = []) => {
      if (messageSendLoading) return;
      await dispatch(sendReturnMessage({ orderId, content, files, pendingUrls })).unwrap();
      fetchMessages(1);
    },
    [dispatch, orderId, fetchMessages, messageSendLoading]
  );

  const handleRefreshMessages = useCallback(() => fetchMessages(1), [fetchMessages]);
  const handleLoadMore        = useCallback(() => { if (!messagesLoading) fetchMessages(messagesPage + 1); }, [fetchMessages, messagesPage, messagesLoading]);
  const handleCloseModal      = useCallback(() => { dispatch(clearReturnMessages()); setShowMessagesModal(false); }, [dispatch]);

  // ── Cancel return ─────────────────────────────────────────────────────────

  const handleCancelReturn = async () => {
    try {
      await dispatch(cancelReturn(orderId)).unwrap();
      dispatch(clearReturnState());
      toast.success('Return request cancelled', { position: 'top-center', autoClose: 2000 });
      dispatch(getOrderDetails(orderId));
    } catch (err) {
      toast.error(err?.message || err || 'Failed to cancel return', { position: 'top-center' });
    } finally {
      setShowCancelModal(false);
    }
  };

  // ── Utilities ─────────────────────────────────────────────────────────────

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount ?? 0);

  const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
    d ? new Date(d).toLocaleDateString('en-US', opts) : 'N/A';

  const reasonLabel = (value) =>
    RETURN_REASONS.find((r) => r.value === value)?.label ?? value?.replace(/_/g, ' ') ?? '—';

  const hasReached = (targetStatus) => {
    const currentIdx = LIFECYCLE_ORDER.indexOf(status);
    const targetIdx  = LIFECYCLE_ORDER.indexOf(targetStatus);
    return currentIdx >= targetIdx && targetIdx !== -1;
  };

  const showBreakdown = ['items_reviewed', 'plea_submitted', 'approved',
    'in_transit', 'awaiting_discount', 'completed'].includes(status)
    && (returnInfo?.discountValue != null);

  // ── Render guards ─────────────────────────────────────────────────────────

  if (orderLoading) return (<><Navbar /><Loader type="snake" size="md" /><Footer /></>);

  if (!order?._id) return (
    <>
      <PageTitle title="Order Not Found" />
      <Navbar />
      <div className="rtr-return-error-container">
        <div className="rtr-error-card">
          <FiAlertCircle className="rtr-error-icon" />
          <h2>Order not found</h2>
          <p>The order you're looking for doesn't exist or you don't have permission to view it.</p>
          <button onClick={() => navigate(backPath)} className="rtr-btn-back-nav">
            <FiArrowLeft /> {backLabel}
          </button>
        </div>
      </div>
      <Footer />
    </>
  );

  if (!isTracking && !policyAcknowledged) return (
    <>
      <PageTitle title={`Request Return - Order ${orderId}`} />
      <Navbar />
      <PolicyGate onAccept={() => setPolicyAcknowledged(true)} />
      <Footer />
    </>
  );

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <>
      <PageTitle title={isTracking ? `Return Status - Order ${orderId}` : `Request Return - Order ${orderId}`} />
      <Navbar />

      <div className="rtr-return-request-container">
        <button onClick={() => navigate(backPath)} className="rtr-btn-back-nav">
          <FiArrowLeft /> {backLabel}
        </button>

        {/* ── Header ── */}
        <div className="rtr-return-header" ref={trackingTopRef}>
          <div className="rtr-header-content">
            <span className="rtr-header-icon-wrap">
              <FiRotateCcw className="rtr-header-icon" />
            </span>
            <div>
              <h1>{isTracking ? 'Return Status' : 'Request Return'}</h1>
              <p className="rtr-order-reference">Order #{orderId.slice(-8).toUpperCase()}</p>
            </div>
          </div>
          {isTracking && (
            <button className="rtr-btn-messages" onClick={() => setShowMessagesModal(true)}>
              <FiMessageSquare />
              <span>Messages</span>
              {unreadCount > 0 && <span className="rtr-message-badge">{unreadCount}</span>}
            </button>
          )}
        </div>

        <div className="rtr-return-content">

          {/* ════════════════════════════════════════════════════
              TRACKING VIEW
          ════════════════════════════════════════════════════ */}
          {isTracking && (
            <div className="rtr-return-status-card">
              <div className="rtr-card-header">
                <span className="rtr-card-header-bar" />
                <FiInfo className="rtr-card-icon" />
                <h2>Return Information</h2>
                <ReturnStatusBadge status={status} />
              </div>

              <div className="rtr-status-details">

                {/* Timeline — received and inspected hidden from customer */}
                <div className="rtr-status-timeline">
                  <div className="rtr-timeline-item">
                    <div className="rtr-timeline-dot rtr-active" />
                    <div className="rtr-timeline-content">
                      <span className="rtr-timeline-label">Requested</span>
                      <span className="rtr-timeline-date">{fmtDate(returnInfo.requestedAt)}</span>
                    </div>
                  </div>
                  {hasReached('items_reviewed') && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Items Reviewed</span>
                        {returnInfo.approvedAt && <span className="rtr-timeline-date">{fmtDate(returnInfo.approvedAt)}</span>}
                      </div>
                    </div>
                  )}
                  {hasReached('plea_submitted') && pleaInfo?.pleaSubmittedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Plea Submitted</span>
                        <span className="rtr-timeline-date">{fmtDate(pleaInfo.pleaSubmittedAt)}</span>
                      </div>
                    </div>
                  )}
                  {hasReached('approved') && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Approved</span>
                        {returnInfo.approvedAt && <span className="rtr-timeline-date">{fmtDate(returnInfo.approvedAt)}</span>}
                      </div>
                    </div>
                  )}
                  {hasReached('in_transit') && returnInfo.shippedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">In Transit</span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.shippedAt)}</span>
                      </div>
                    </div>
                  )}
                  {/* received and inspected are hidden — customer sees awaiting_discount next */}
                  {hasReached('awaiting_discount') && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Awaiting Discount</span>
                      </div>
                    </div>
                  )}
                  {hasReached('completed') && returnInfo.completedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Completed</span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.completedAt)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Info grid */}
                <div className="rtr-return-info-grid">
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Return Reason</span>
                    <span className="rtr-info-value">{reasonLabel(returnInfo.reason)}</span>
                  </div>
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Items to Return</span>
                    <span className="rtr-info-value">{returnItems.length} item(s)</span>
                  </div>
                  {returnInfo.description && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">Description</span>
                      <span className="rtr-info-value">{returnInfo.description}</span>
                    </div>
                  )}
                  {returnInfo.rmaNumber && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">RMA Number</span>
                      <span className="rtr-info-value rtr-tracking">{returnInfo.rmaNumber}</span>
                    </div>
                  )}
                  {returnInfo.adminNote && (
                    <div className="rtr-info-item rtr-full-width rtr-admin-note">
                      <span className="rtr-info-label">Admin Note</span>
                      <span className="rtr-info-value">{returnInfo.adminNote}</span>
                    </div>
                  )}
                </div>

                {/* FIX: Credit breakdown — pass showPleaDetail=true so the
                    four-pool breakdown is shown on stages where the plea has
                    already been resolved (approved, in_transit, awaiting_discount,
                    completed). At items_reviewed and plea_submitted the plea is
                    not yet resolved so we omit the detail. */}
                  {showBreakdown && (
                    <CreditBreakdown
                      returnInfo={returnInfo}
                      currency={currency}
                      orderItems={orderItems}
                      showPleaDetail={
                        hasPleaRound &&
                        ['approved', 'in_transit', 'received', 'inspected', 'awaiting_discount', 'completed'].includes(status)
                      }
                    />
                  )}

                {/* Plea rejected — all items rejected after plea resolution */}
                {allItemsRejectedAfterPlea && (
                  <div className="rtr-plea-rejected-panel">
                    <div className="rtr-plea-rejected-header">
                      <FiXCircle className="rtr-plea-rejected-icon" />
                      <div>
                        <h3>Plea Not Accepted</h3>
                        <p>We have reviewed your plea and unfortunately all items have been rejected. No store credit will be issued.</p>
                      </div>
                    </div>
                    {returnInfo.adminNote && (
                      <div className="rtr-plea-rejected-note">
                        <span className="rtr-info-label">Admin Note:</span>
                        <p>{returnInfo.adminNote}</p>
                      </div>
                    )}
                    <div className="rtr-plea-rejected-items">
                      <span className="rtr-info-label">Rejected Items:</span>
                      {returnItems.map((item, i) => (
                        <div key={i} className="rtr-plea-rejected-item">
                          {item.image && <img src={item.image} alt={resolveItemName(item, orderItems, i)} className="rtr-item-image" />}
                          <div className="rtr-item-details">
                            <span className="rtr-item-name">{resolveItemName(item, orderItems, i)}</span>
                            {item.adminRejectionReason && (
                              <span className="rtr-rejection-reason">Reason: {item.adminRejectionReason}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* items_reviewed — decision cards + user choice */}
                {status === 'items_reviewed' && returnItems.length > 0 && (
                  <div className="rtr-item-decisions">
                    <h3>Item Decisions</h3>
                    <div className="rtr-decisions-columns">
                      {/* FIX: Approved column — approvedItems already correctly
                          includes only items with adminDecision='approved' (which
                          with the unified model means approvedQuantity > 0).
                          We show approvedQuantity for the count, and note the
                          partial qty if less than total was approved. */}
                      {approvedItems.length > 0 && (
                        <div className="rtr-decisions-col rtr-decisions-approved">
                          <div className="rtr-decisions-col-header">
                            <FiCheckCircle /><span>Approved ({approvedItems.length})</span>
                          </div>
                          {approvedItems.map((item, i) => {
                            const approvedQty = item.approvedQuantity ?? item.quantity;
                            return (
                              <div key={i} className="rtr-decision-item">
                                {item.image && <img src={item.image} alt={resolveItemName(item, orderItems, i)} className="rtr-item-image" />}
                                <div className="rtr-item-details">
                                  <span className="rtr-item-name">{resolveItemName(item, orderItems, i)}</span>
                                  <span className="rtr-item-quantity">
                                    Qty: {approvedQty}
                                    {item.approvedQuantity != null && item.approvedQuantity !== item.quantity && (
                                      <span className="rtr-item-qty-note"> (of {item.quantity} requested)</span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* FIX: Rejected column — uses getRejectedUnits which now
                          correctly handles both:
                          1. Fully rejected (adminDecision='rejected', approvedQty=0)
                             → rejectedQty = item.quantity
                          2. Partially approved (adminDecision='approved', approvedQty<qty)
                             → rejectedQty = quantity - approvedQuantity
                          isPartial=true for case 2, showing the correct partial label. */}
                      {rejectedUnitsList.length > 0 && (
                        <div className="rtr-decisions-col rtr-decisions-rejected">
                          <div className="rtr-decisions-col-header">
                            <FiXCircle /><span>Rejected ({rejectedUnitsList.length})</span>
                          </div>
                          {rejectedUnitsList.map(({ item, idx, rejectedQty, isPartial }) => (
                            <div key={idx} className="rtr-decision-item">
                              {item.image && <img src={item.image} alt={resolveItemName(item, orderItems, idx)} className="rtr-item-image" />}
                              <div className="rtr-item-details">
                                <span className="rtr-item-name">{resolveItemName(item, orderItems, idx)}</span>
                                <span className="rtr-item-quantity">
                                  {isPartial
                                    ? `${rejectedQty} of ${item.quantity} units not approved`
                                    : `Qty: ${rejectedQty}`}
                                </span>
                                {!isPartial && item.adminRejectionReason && (
                                  <span className="rtr-rejection-reason">Reason: {item.adminRejectionReason}</span>
                                )}
                                {isPartial && (
                                  <span className="rtr-rejection-reason">
                                    {item.approvedQuantity} unit{item.approvedQuantity !== 1 ? 's' : ''} approved, {rejectedQty} not approved
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {pleaDeadline && (
                      <CountdownTimer
                        deadline={pleaDeadline}
                        label="Time remaining to respond:"
                        expiredLabel="Response window closed — return automatically approved"
                      />
                    )}

                    {/* All approved — single accept button */}
                    {!hasRejectedItems && pleaWindowOpen && (
                      <div className="rtr-accept-section">
                        <div className="rtr-accept-header">
                          <FiCheckCircle className="rtr-accept-icon" />
                          <div>
                            <h3>All Items Approved</h3>
                            <p>All your items have been approved. Accept to begin the return process.</p>
                          </div>
                        </div>
                        <button type="button" className="rtr-btn-primary" onClick={() => setShowAcceptConfirm(true)} disabled={acceptLoading}>
                          {acceptLoading ? <><FiClock className="rtr-spin" /> Processing…</> : <><FiCheckCircle /> Accept &amp; Proceed</>}
                        </button>
                      </div>
                    )}

                    {/* Some rejected — show accept vs dispute choice */}
                    {hasRejectedItems && pleaWindowOpen && !itemsReviewedChoice && (
                      <div className="rtr-choice-section">
                        <div className="rtr-choice-header">
                          <FiInfo className="rtr-choice-icon" />
                          <div>
                            <h3>Some items were rejected</h3>
                            <p>You can accept the decisions and proceed, or dispute the rejected items with a plea.</p>
                          </div>
                        </div>
                        <div className="rtr-choice-actions">
                          <button type="button" className="rtr-btn-choice rtr-btn-choice--accept" onClick={() => setShowAcceptConfirm(true)}>
                            <FiThumbsUp />
                            Accept Decisions
                            <span className="rtr-choice-sub">Proceed with approved items only</span>
                          </button>
                          <button type="button" className="rtr-btn-choice rtr-btn-choice--dispute" onClick={() => setItemsReviewedChoice('plea')}>
                            <FiThumbsDown />
                            Dispute Rejections
                            <span className="rtr-choice-sub">Submit a plea for rejected items</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {hasRejectedItems && !pleaWindowOpen && status === 'items_reviewed' && (
                      <div className="rtr-info-banner-neutral">
                        <FiInfo />
                        <span>The response window has closed. Your return is being automatically processed.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Accept confirmation modal */}
                {showAcceptConfirm && (
                  <div className="rtr-modal-overlay" onClick={() => setShowAcceptConfirm(false)}>
                    <div className="rtr-modal-content" onClick={(e) => e.stopPropagation()}>
                      <div className="rtr-modal-header">
                        <h3>Accept Decisions?</h3>
                        <button onClick={() => setShowAcceptConfirm(false)} className="rtr-modal-close"><FiX /></button>
                      </div>
                      <div className="rtr-modal-body">
                        {approvedItems.length > 0 && (
                          <div className="rtr-accept-preview">
                            <p className="rtr-accept-preview-label">Approved items that will be credited:</p>
                            {approvedItems.map((item, i) => {
                              const qty          = item.approvedQuantity ?? item.quantity;
                              const resolvedName = resolveItemName(item, orderItems, i);
                              return (
                                <div key={i} className="rtr-accept-preview-item">
                                  {item.image && <img src={item.image} alt={resolvedName} className="rtr-accept-preview-img" />}
                                  <span>{resolvedName}</span>
                                  <span className="rtr-accept-preview-qty">×{qty}</span>
                                </div>
                              );
                            })}
                            {rejectedUnitsList.length > 0 && (
                              <p className="rtr-accept-preview-rejected">
                                {rejectedUnitsList.length} rejected item(s) will not be credited.
                              </p>
                            )}
                          </div>
                        )}
                        <p>This action cannot be undone. You will need to ship your approved items back to us.</p>
                      </div>
                      <div className="rtr-modal-actions">
                        <button onClick={() => setShowAcceptConfirm(false)} className="rtr-btn-secondary" disabled={acceptLoading}>Go Back</button>
                        <button onClick={handleAcceptDecisions} className="rtr-btn-primary" disabled={acceptLoading}>
                          {acceptLoading ? 'Processing…' : 'Confirm & Accept'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Plea form */}
                {status === 'items_reviewed' && itemsReviewedChoice === 'plea' && (
                  <div className="rtr-plea-section">
                    <div className="rtr-plea-header">
                      <FiInfo className="rtr-plea-header-icon" />
                      <div>
                        <h3>Dispute Rejected Items</h3>
                        <p>
                          Choose how many units to appeal for each item.
                          Units you don't appeal are accepted as rejected — no credit will be issued for them.
                        </p>
                      </div>
                    </div>

                    {/* FIX: Plea quantity stepper — uses rejectedUnitsList entries which
                        already carry the correct contestable quantity (rejectedQty) for
                        each item. The stepper max is capped at rejectedQty so the
                        customer cannot plea for more units than were actually rejected
                        or unapproved. For partially-approved items (isPartial=true),
                        rejectedQty = quantity - approvedQuantity, not item.quantity,
                        so already-approved units are never included in the stepper range. */}
                    {rejectedUnitsList.length > 0 && (
                      <div className="rtr-plea-items">
                        <label className="rtr-form-label">Appeal Quantity per Item</label>
                        <p className="rtr-helper-text">Select how many units you are disputing for each rejected item.</p>
                        {rejectedUnitsList.map(({ item, idx, pid, rejectedQty, isPartial }) => {
                          const current = pleaQuantities[pid] ?? rejectedQty;
                          const silent  = rejectedQty - current;
                          const name    = resolveItemName(item, orderItems, idx);

                          return (
                            <div key={pid} className="rtr-plea-item-row">
                              {item.image && (
                                <img src={item.image} alt={name} className="rtr-plea-item-img" />
                              )}
                              <div className="rtr-plea-item-info">
                                <span className="rtr-plea-item-name">{name}</span>
                                <span className="rtr-plea-item-rejected">
                                  {isPartial
                                    ? `${rejectedQty} of ${item.quantity} units not approved`
                                    : `Rejected: ${rejectedQty} unit${rejectedQty !== 1 ? 's' : ''}`}
                                </span>
                              </div>
                              <div className="rtr-plea-qty-controls">
                                <span className="rtr-plea-qty-label">Appealing:</span>
                                <div className="rtr-plea-stepper">
                                  <button
                                    type="button"
                                    className="rtr-plea-stepper-btn"
                                    onClick={() => setPleaQuantities((prev) => ({ ...prev, [pid]: Math.max(1, current - 1) }))}
                                    disabled={pleaLoading || current <= 1}
                                    aria-label="Decrease appeal quantity"
                                  >−</button>
                                  <span className="rtr-plea-stepper-val">{current}</span>
                                  <button
                                    type="button"
                                    className="rtr-plea-stepper-btn"
                                    onClick={() => setPleaQuantities((prev) => ({ ...prev, [pid]: Math.min(rejectedQty, current + 1) }))}
                                    disabled={pleaLoading || current >= rejectedQty}
                                    aria-label="Increase appeal quantity"
                                  >+</button>
                                </div>
                                <span className="rtr-plea-qty-of">of {rejectedQty}</span>
                                {silent > 0 && (
                                  <span className="rtr-plea-qty-silent">({silent} accepted as rejected)</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="rtr-form-group">
                      <label className="rtr-form-label">Your Plea *</label>
                      <textarea
                        className="rtr-form-textarea"
                        value={pleaText}
                        onChange={(e) => setPleaText(e.target.value)}
                        rows={5} maxLength={MAX_PLEA_CHARS}
                        placeholder="Explain why the rejected items should be reconsidered…"
                        disabled={pleaLoading}
                      />
                      <div className="rtr-char-counter">
                        <span className={pleaText.length > MAX_PLEA_CHARS - 100 ? 'rtr-char-warn' : ''}>{pleaText.length}</span>
                        /{MAX_PLEA_CHARS}
                        {pleaText.length > 0 && pleaText.length < MIN_PLEA_CHARS && (
                          <span className="rtr-char-warn rtr-char-min">&nbsp;(min {MIN_PLEA_CHARS} chars)</span>
                        )}
                      </div>
                    </div>

                    <div className="rtr-form-group">
                      <label className="rtr-form-label">Supporting Evidence (Optional)</label>
                      <input ref={pleaFileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf" onChange={handlePleaFileSelect} style={{ display: 'none' }} />
                      <button type="button" className="rtr-btn-upload" onClick={() => pleaFileInputRef.current?.click()} disabled={pleaFiles.length >= MAX_FILES || pleaLoading}>
                        <FiPaperclip /> Add Evidence Files
                      </button>
                      {pleaFilePreviews.length > 0 && (
                        <div className="rtr-file-previews" style={{ marginTop: 10 }}>
                          {pleaFilePreviews.map((item, index) => (
                            <div key={index} className="rtr-file-preview-item">
                              {ALLOWED_FILE_TYPES.images.includes(item.type)
                                ? <img src={item.preview} alt={item.file.name} className="rtr-preview-image" />
                                : ALLOWED_FILE_TYPES.videos.includes(item.type)
                                  ? <div className="rtr-preview-placeholder"><FiVideo /></div>
                                  : <div className="rtr-preview-placeholder"><FiFile /></div>
                              }
                              <div className="rtr-file-info">
                                <span className="rtr-file-name">{item.file.name}</span>
                                <span className="rtr-file-size">{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                              </div>
                              <button type="button" className="rtr-btn-remove-file" onClick={() => removePleaFile(index)} disabled={pleaLoading}><FiX /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rtr-plea-form-actions">
                      <button type="button" className="rtr-btn-secondary" onClick={() => setItemsReviewedChoice(null)} disabled={pleaLoading}>Go Back</button>
                      <button type="button" className="rtr-btn-primary" onClick={handleSubmitPlea} disabled={pleaLoading || pleaText.trim().length < MIN_PLEA_CHARS}>
                        {pleaLoading ? <><FiClock className="rtr-spin" /> Submitting…</> : <><FiSend /> Submit Plea</>}
                      </button>
                    </div>
                  </div>
                )}

                {/* plea_submitted */}
                {status === 'plea_submitted' && (
                  <div className="rtr-plea-submitted-panel">
                    <div className="rtr-plea-submitted-header">
                      <FiCheckCircle className="rtr-plea-submitted-icon" />
                      <div>
                        <h3>Plea Submitted</h3>
                        <p>Your plea is under review. The admin will respond within 48 hours.</p>
                      </div>
                    </div>
                    {pleaInfo?.pleaDescription && (
                      <div className="rtr-plea-submitted-text">
                        <span className="rtr-info-label">Your Plea:</span>
                        <p>{pleaInfo.pleaDescription}</p>
                      </div>
                    )}
                    {/* Show the per-item silentAcceptedQuantity so the customer
                        can see which units they chose not to contest while waiting
                        for the admin's response. */}
                    {returnItems.some((i) => (i.silentAcceptedQuantity ?? 0) > 0) && (
                      <div className="rtr-return-info-grid" style={{ marginTop: 12 }}>
                        <div className="rtr-info-item rtr-full-width">
                          <span className="rtr-info-label">
                            Units accepted as rejected (not contested):
                          </span>
                          {returnItems
                            .filter((i) => (i.silentAcceptedQuantity ?? 0) > 0)
                            .map((item, i) => (
                              <div key={i} className="rtr-decision-item" style={{ marginTop: 6 }}>
                                <div className="rtr-item-details">
                                  <span className="rtr-item-name">
                                    {resolveItemName(item, orderItems, i)}
                                  </span>
                                  <span className="rtr-rejection-reason">
                                    {item.silentAcceptedQuantity} unit
                                    {item.silentAcceptedQuantity !== 1 ? 's' : ''} silently accepted
                                  </span>
                                </div>
                              </div>
                            ))
                          }
                        </div>
                      </div>
                    )}

                    {pleaDeadline && (
                      <CountdownTimer
                        deadline={pleaDeadline}
                        label="Admin response window:"
                        expiredLabel="Response window closed — return automatically approved"
                      />
                    )}
                  </div>
                )}

                {/* approved — ship items back */}
                {status === 'approved' && !allItemsRejectedAfterPlea && (
                  <div className="rtr-approved-panel">
                    <div className="rtr-approved-panel-header">
                      <FiTruck className="rtr-approved-icon" />
                      <div>
                        <h3>Return Approved — Ship Your Items</h3>
                        <p className="rtr-approved-note">
                          Pack your approved items securely and send them to the address below.
                          Once shipped, confirm here with your courier details.
                        </p>
                      </div>
                    </div>

                    {approvedItems.length > 0 && (
                      <div className="rtr-awaiting-approved-items">
                        <span className="rtr-info-label">Items to ship back:</span>
                        <div className="rtr-awaiting-pills">
                          {approvedItems.map((item, i) => {
                            const qty  = item.approvedQuantity ?? item.quantity;
                            const name = resolveItemName(item, orderItems, i);
                            return (
                              <span key={i} className="rtr-awaiting-item-pill">
                                {name} ×{qty}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="rtr-approved-address-box">
                      <div className="rtr-approved-address-header">
                        <FiMapPin className="rtr-approved-address-icon" />
                        <span>Return Address</span>
                      </div>
                      <div className="rtr-approved-address-body">
                        <strong>{RETURN_ADDRESS.name}</strong>
                        <span>{RETURN_ADDRESS.line1}</span>
                        <span>{RETURN_ADDRESS.line2}</span>
                        <span>{RETURN_ADDRESS.country}</span>
                        <span>{RETURN_ADDRESS.phone}</span>
                      </div>
                    </div>

                    <div className="rtr-form-group">
                      <label className="rtr-form-label">Select Courier *</label>
                      <div className="rtr-courier-list">
                        {COURIERS.map((courier) => (
                          <button
                            key={courier.value} type="button"
                            className={`rtr-courier-option${selectedCourier === courier.value ? ' rtr-courier-option--selected' : ''}`}
                            onClick={() => { setSelectedCourier(courier.value); if (courier.value !== 'Other') setOtherCourier(''); }}
                            disabled={confirmShippedLoading}
                          >
                            {courier.label}
                          </button>
                        ))}
                      </div>
                      {selectedCourier === 'Other' && (
                        <input
                          type="text" className="rtr-form-input" style={{ marginTop: 8 }}
                          placeholder="Enter courier name…" value={otherCourier}
                          onChange={(e) => setOtherCourier(e.target.value)}
                          maxLength={80} disabled={confirmShippedLoading}
                        />
                      )}
                    </div>

                    <div className="rtr-form-group">
                      <label className="rtr-form-label">
                        Tracking Number <span className="rtr-tracking-optional">(optional)</span>
                      </label>
                      <p className="rtr-helper-text">If your courier provided a tracking number, enter it here.</p>
                      <input
                        type="text" className="rtr-form-input rtr-tracking-input"
                        placeholder="e.g. 1234567890" value={trackingInput}
                        onChange={(e) => setTrackingInput(e.target.value)}
                        maxLength={100} disabled={confirmShippedLoading}
                      />
                    </div>

                    <button
                      type="button" className="rtr-btn-primary rtr-confirm-ship-btn"
                      onClick={handleConfirmShipped}
                      disabled={confirmShippedLoading || !selectedCourier || (selectedCourier === 'Other' && !otherCourier.trim())}
                    >
                      {confirmShippedLoading
                        ? <><FiClock className="rtr-spin" /> Confirming…</>
                        : <><FiTruck /> Confirm Shipment</>}
                    </button>
                  </div>
                )}

                {/* in_transit — FIX: use displayCourierName/displayTrackingNumber
                    which fall back to slice local state when returnInfo fields
                    are not yet populated from the server after confirmShipped */}
                {status === 'in_transit' && (
                  <div className="rtr-in-transit-panel">
                    <div className="rtr-in-transit-header">
                      <FiTruck className="rtr-in-transit-icon" />
                      <div>
                        <h3>Package In Transit</h3>
                        <p>Your items are on their way to us. We'll notify you when we receive them.</p>
                      </div>
                    </div>
                    <div className="rtr-transit-details">
                      {displayCourierName && (
                        <div className="rtr-transit-detail">
                          <span className="rtr-info-label">Courier</span>
                          <span className="rtr-info-value">{displayCourierName}</span>
                        </div>
                      )}
                      {displayTrackingNumber && (
                        <div className="rtr-transit-detail">
                          <span className="rtr-info-label">Tracking Number</span>
                          <span className="rtr-info-value rtr-tracking">{displayTrackingNumber}</span>
                        </div>
                      )}
                      {returnInfo.shippedAt && (
                        <div className="rtr-transit-detail">
                          <span className="rtr-info-label">Shipped On</span>
                          <span className="rtr-info-value">{fmtDate(returnInfo.shippedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* received/inspected — hidden stages, show neutral holding banner */}
                {(status === 'received' || status === 'inspected') && (
                  <div className="rtr-info-banner-neutral">
                    <FiInfo />
                    <span>Your items have been received and are being processed. Your discount code will be ready soon.</span>
                  </div>
                )}

                {/* awaiting_discount */}
                {status === 'awaiting_discount' && (
                  <div className="rtr-awaiting-discount">
                    <div className="rtr-awaiting-discount-icon-wrap">
                      <FiLoader className="rtr-awaiting-spin" />
                    </div>
                    <h3>Your Discount Code Is Being Prepared</h3>
                    <p>Your items have been verified. Our team is generating your store credit discount code.</p>
                    {approvedItems.length > 0 && (
                      <div className="rtr-awaiting-approved-items" style={{ marginTop: 12 }}>
                        <span className="rtr-info-label">Approved items:</span>
                        <div className="rtr-awaiting-pills">
                          {approvedItems.map((item, i) => {
                            const qty  = item.approvedQuantity ?? item.quantity;
                            const name = resolveItemName(item, orderItems, i);
                            return (
                              <span key={i} className="rtr-awaiting-item-pill">
                                {name} ×{qty}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── COMPLETED PANEL ── */}
                {status === 'completed' && (
                  <div className="rtr-completed-panel">
                    <FiCheckCircle className="rtr-completed-icon" />
                    <h3>Return Request Completed</h3>
                    <p>
                      Your return has been fully processed. A store credit discount code has been
                      issued and added to your account.
                    </p>

                    {/* Approved items summary so the customer knows what they're credited for */}
                    {approvedItems.length > 0 && (
                      <>
                        <div className="rtr-completed-divider" />
                        <div className="rtr-completed-items-list">
                          <span className="rtr-info-label" style={{ marginBottom: 6, display: 'block' }}>
                            Items credited:
                          </span>
                          {approvedItems.map((item, i) => {
                            const qty  = item.approvedQuantity ?? item.quantity;
                            const name = resolveItemName(item, orderItems, i);
                            return (
                              <div key={i} className="rtr-completed-item">
                                {item.image && (
                                  <img src={item.image} alt={name} className="rtr-item-image" />
                                )}
                                <span className="rtr-completed-item-name">{name}</span>
                                <span className="rtr-completed-item-qty">×{qty}</span>
                              </div>
                            );
                          })}
                          {returnInfo?.discountValue > 0 && (
                            <div className="rtr-completed-credit-total">
                              <span>Total credit value</span>
                              <span className="rtr-completed-credit-amount">
                                {formatCurrency(returnInfo.discountValue)}
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Link styled as a banner card — distinct from solid button */}
                    <Link to="/my-discounts" className="rtr-completed-discount-link">
                      <FiGift className="rtr-completed-discount-link-icon" />
                      <div className="rtr-completed-discount-link-text">
                        <span className="rtr-completed-discount-link-title">View your discount code</span>
                        <span className="rtr-completed-discount-link-sub">
                          Your code is waiting in My Discounts →
                        </span>
                      </div>
                    </Link>
                  </div>
                )}

                {/* Items list for statuses that don't have their own item display */}
                {!['items_reviewed', 'plea_submitted', 'approved', 'in_transit', 'awaiting_discount', 'completed'].includes(status) && returnItems.length > 0 && (
                  <div className="rtr-return-items">
                    <h3>Items Being Returned</h3>
                    <div className="rtr-items-list">
                      {returnItems.map((item, index) => (
                        <div key={index} className="rtr-return-item-card">
                          {item.image && <img src={item.image} alt={resolveItemName(item, orderItems, index)} className="rtr-item-image" />}
                          <div className="rtr-item-details">
                            <span className="rtr-item-name">{resolveItemName(item, orderItems, index)}</span>
                            <span className="rtr-item-quantity">Quantity: {item.quantity}</span>
                            {item.reason && <span className="rtr-item-reason">Reason: {reasonLabel(item.reason)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {status === 'requested' && (
                  <button onClick={() => setShowCancelModal(true)} className="rtr-btn-cancel-return" disabled={loading}>
                    <FiX /> Cancel Return Request
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Order summary */}
          <div className="rtr-summary-card">
            <div className="rtr-card-header">
              <span className="rtr-card-header-bar" />
              <FiPackage className="rtr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rtr-summary-details">
              <div className="rtr-summary-row">
                <span className="rtr-label">Total Amount</span>
                <span className="rtr-value rtr-strong">{formatCurrency(order.totalPrice)}</span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Order Status</span>
                <span className="rtr-value">
                  <span className={`rtr-status-badge rtr-status-${order.orderStatus?.toLowerCase()}`}>{order.orderStatus}</span>
                </span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Ordered Date</span>
                <span className="rtr-value">{fmtDate(order.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          {/* New-return form */}
          {!isTracking && (
            <div className="rtr-return-form-card">
              <div className="rtr-card-header">
                <span className="rtr-card-header-bar" />
                <FiBox className="rtr-card-icon" />
                <h2>Select Items to Return</h2>
              </div>

              <form onSubmit={handleSubmit} className="rtr-return-form">
                <div className="rtr-form-section">
                  <label className="rtr-section-label">Items in Your Order</label>
                  <div className="rtr-items-grid">
                    {formData.itemsToReturn.map((item, index) => (
                      <div key={index} className={`rtr-item-card ${item.selected ? 'rtr-selected' : ''}`}>
                        <div className="rtr-item-checkbox">
                          <input type="checkbox" id={`item-${index}`} checked={item.selected} onChange={() => handleItemToggle(index)} />
                          <label htmlFor={`item-${index}`} />
                        </div>
                        {item.image && <img src={item.image} alt={item.name} className="rtr-item-image" />}
                        <div className="rtr-item-info">
                          <span className="rtr-item-name">{item.name}</span>
                          <span className="rtr-item-price">{formatCurrency(item.price)}</span>
                        </div>
                        {item.selected && (
                          <>
                            <div className="rtr-quantity-selector">
                              <label>Quantity:</label>
                              <div className="rtr-quantity-controls">
                                <button type="button" onClick={() => handleQuantityChange(index, item.returnQuantity - 1)} disabled={item.returnQuantity <= 1}>−</button>
                                <span>{item.returnQuantity}</span>
                                <button type="button" onClick={() => handleQuantityChange(index, item.returnQuantity + 1)} disabled={item.returnQuantity >= item.quantity}>+</button>
                              </div>
                              <span className="rtr-max-qty">Max: {item.quantity}</span>
                            </div>
                            <div className="rtr-item-reason-selector">
                              <label htmlFor={`item-reason-${index}`} className="rtr-item-reason-label">Reason for this item *</label>
                              <select
                                id={`item-reason-${index}`}
                                className={`rtr-form-select rtr-item-reason-select ${formErrors[`itemReason_${index}`] ? 'rtr-error' : ''}`}
                                value={item.reason}
                                onChange={(e) => handleItemReasonChange(index, e.target.value)}
                              >
                                <option value="">Select a reason</option>
                                {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                              {formErrors[`itemReason_${index}`] && (
                                <span className="rtr-error-message"><FiAlertCircle /> {formErrors[`itemReason_${index}`]}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  {formErrors.items && <span className="rtr-error-message"><FiAlertCircle /> {formErrors.items}</span>}
                </div>

                <div className="rtr-form-group">
                  <label htmlFor="reason" className="rtr-form-label">Overall Return Category *</label>
                  <select id="reason" name="reason" className={`rtr-form-select ${formErrors.reason ? 'rtr-error' : ''}`} value={formData.reason} onChange={handleChange}>
                    <option value="">Select a reason</option>
                    {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  {formErrors.reason && <span className="rtr-error-message"><FiAlertCircle /> {formErrors.reason}</span>}
                </div>

                <div className="rtr-form-group">
                  <label htmlFor="description" className="rtr-form-label">Description *</label>
                  <p className="rtr-helper-text">Provide a general description covering all items in this return.</p>
                  <textarea
                    id="description" name="description"
                    className={`rtr-form-textarea ${formErrors.description ? 'rtr-error' : ''}`}
                    value={formData.description} onChange={handleChange}
                    rows={4} maxLength={MAX_DESC_CHARS}
                    placeholder="Describe the issue(s) with your order…"
                  />
                  <div className="rtr-char-counter">
                    <span className={formData.description.length > MAX_DESC_CHARS - 100 ? 'rtr-char-warn' : ''}>{formData.description.length}</span>
                    /{MAX_DESC_CHARS}
                  </div>
                  {formErrors.description && <span className="rtr-error-message"><FiAlertCircle /> {formErrors.description}</span>}
                </div>

                <div className="rtr-form-group">
                  <label className="rtr-form-label">Supporting Documents (Optional)</label>
                  <p className="rtr-helper-text">Upload up to {MAX_FILES} files (images, videos, or PDFs). Max 10 MB each.</p>
                  <div className="rtr-file-upload-area">
                    <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf" onChange={handleFileSelect} style={{ display: 'none' }} />
                    <button type="button" className="rtr-btn-upload" onClick={() => fileInputRef.current?.click()} disabled={selectedFiles.length >= MAX_FILES}>
                      <FiPaperclip /> Choose Files
                    </button>
                    {filePreviews.length > 0 && (
                      <div className="rtr-file-previews">
                        {filePreviews.map((item, index) => (
                          <div key={index} className="rtr-file-preview-item">
                            {ALLOWED_FILE_TYPES.images.includes(item.type)
                              ? <img src={item.preview} alt={item.file.name} className="rtr-preview-image" />
                              : ALLOWED_FILE_TYPES.videos.includes(item.type)
                                ? <div className="rtr-preview-placeholder"><FiVideo /></div>
                                : <div className="rtr-preview-placeholder"><FiFile /></div>
                            }
                            <div className="rtr-file-info">
                              <span className="rtr-file-name">{item.file.name}</span>
                              <span className="rtr-file-size">{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                            <button type="button" className="rtr-btn-remove-file" onClick={() => removeFile(index)}><FiX /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rtr-notice-box">
                  <FiInfo className="rtr-notice-icon" />
                  <div className="rtr-notice-content">
                    <h4>Return Policy</h4>
                    <ul>
                      <li>Items must be unused and in original packaging</li>
                      <li>Returns are processed as store credit discount codes — no cash refunds</li>
                      <li>Shipping costs are non-refundable</li>
                      <li>Discount value is based on admin-approved items only</li>
                      <li>Returns are reviewed within 5–7 business days</li>
                    </ul>
                  </div>
                </div>

                <div className="rtr-form-actions">
                  <button type="button" onClick={() => navigate(backPath)} className="rtr-btn-secondary" disabled={loading || uploadLoading}>Cancel</button>
                  <button type="submit" className="rtr-btn-primary" disabled={loading || uploadLoading}>
                    {loading || uploadLoading ? <><FiClock className="rtr-spin" /> Submitting…</> : <><FiSend /> Submit Return Request</>}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Cancel modal */}
      {showCancelModal && (
        <div className="rtr-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="rtr-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="rtr-modal-header">
              <h3>Cancel Return Request?</h3>
              <button onClick={() => setShowCancelModal(false)} className="rtr-modal-close"><FiX /></button>
            </div>
            <div className="rtr-modal-body">
              <p>Are you sure you want to cancel this return request? This action cannot be undone.</p>
            </div>
            <div className="rtr-modal-actions">
              <button onClick={() => setShowCancelModal(false)} className="rtr-btn-secondary" disabled={loading}>Keep Request</button>
              <button onClick={handleCancelReturn} className="rtr-btn-danger" disabled={loading}>
                {loading ? 'Cancelling…' : 'Yes, Cancel Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ReturnMessagesModal
        isOpen={showMessagesModal}
        onClose={handleCloseModal}
        orderId={orderId}
        messages={messages}
        loading={messagesLoading}
        hasMoreMessages={hasMoreMessages}
        totalMessages={totalMessages}
        onSendMessage={handleSendMessage}
        onRefresh={handleRefreshMessages}
        onLoadMore={handleLoadMore}
        pendingAttachments={pendingAttachments}
        errorStage={errorStage}
        onClearPending={() => dispatch(clearPendingAttachments())}
        currentUserRole="customer"
        isSendingExternal={messageSendLoading}
      />

      <Footer />
    </>
  );
}

export default ReturnRequest;