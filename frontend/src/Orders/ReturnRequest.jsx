// ReturnRequest.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import axios from 'axios';
import {
  FiPackage, FiAlertCircle, FiClock, FiSend, FiPaperclip,
  FiX, FiFile, FiVideo, FiMessageSquare, FiRotateCcw, FiInfo,
  FiArrowLeft, FiBox, FiCheckCircle, FiXCircle, FiTag, FiLoader,
  FiThumbsUp, FiThumbsDown, FiTruck,
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
  clearReturnState,
  clearReturnMessages,
  clearPendingAttachments,
  clearPleaError,
} from '../features/returns/returnSlice';

import '../OrderStyles/ReturnRequest.css';

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

// Full lifecycle order used for timeline and status display
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

// ─────────────────────────────────────────────
// CountdownTimer
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// ReturnStatusBadge
// ─────────────────────────────────────────────
const ReturnStatusBadge = ({ status }) => {
  const configs = {
    none:              { label: 'No Return',         className: 'rtr-return-badge-none'             },
    requested:         { label: 'Return Requested',  className: 'rtr-return-badge-requested'        },
    items_reviewed:    { label: 'Items Reviewed',    className: 'rtr-return-badge-items-reviewed'   },
    plea_submitted:    { label: 'Plea Submitted',    className: 'rtr-return-badge-plea-submitted'   },
    approved:          { label: 'Approved',          className: 'rtr-return-badge-approved'         },
    awaiting_discount: { label: 'Awaiting Discount', className: 'rtr-return-badge-awaiting-discount'},
    in_transit:        { label: 'In Transit',        className: 'rtr-return-badge-transit'          },
    received:          { label: 'Received',          className: 'rtr-return-badge-received'         },
    inspected:         { label: 'Inspecting',        className: 'rtr-return-badge-inspecting'       },
    completed:         { label: 'Completed',         className: 'rtr-return-badge-completed'        },
    rejected:          { label: 'Rejected',          className: 'rtr-return-badge-rejected'         },
    cancelled:         { label: 'Cancelled',         className: 'rtr-return-badge-cancelled'        },
  };
  const config = configs[status] ?? configs.none;
  return (
    <span className={`rtr-return-badge ${config.className}`}>
      <span className="rtr-return-badge-label">{config.label}</span>
    </span>
  );
};

// ─────────────────────────────────────────────
// PolicyGate
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
function ReturnRequest() {
  const { id: orderId } = useParams();
  const navigate        = useNavigate();
  const dispatch        = useDispatch();
  const fileInputRef    = useRef(null);
  const pleaFileInputRef = useRef(null);
  const location        = useLocation();
  const trackingTopRef  = useRef(null);

  const { order, loading: orderLoading } = useSelector((s) => s.order);
  const {
    messages, loading, messagesLoading, messageSendLoading,
    uploadLoading, pleaLoading, acceptLoading, pleaError,
    hasMoreMessages, totalMessages, messagesPage,
    pendingAttachments, errorStage, error, success,
  } = useSelector((s) => s.return);

  const [policyAcknowledged,    setPolicyAcknowledged]    = useState(false);
  const [formData,              setFormData]              = useState({ reason: '', description: '', itemsToReturn: [] });
  const [formErrors,            setFormErrors]            = useState({});
  const [selectedFiles,         setSelectedFiles]         = useState([]);
  const [filePreviews,          setFilePreviews]          = useState([]);
  const [showCancelModal,       setShowCancelModal]       = useState(false);
  const [showMessagesModal,     setShowMessagesModal]     = useState(false);
  const [pleaText,              setPleaText]              = useState('');
  const [pleaFiles,             setPleaFiles]             = useState([]);
  const [pleaFilePreviews,      setPleaFilePreviews]      = useState([]);
  const [pleaUploading,         setPleaUploading]         = useState(false);
  // 'choice' | 'plea' | 'accept' | 'accepted' | null
  const [itemsReviewedChoice,   setItemsReviewedChoice]   = useState(null);
  const [showAcceptConfirm,     setShowAcceptConfirm]     = useState(false);

  // ── Derived state ─────────────────────────────────────────────────────────
  const returnInfo    = order?.returnInfo ?? null;
  const returnItems   = returnInfo?.itemsToReturn ?? [];
  const status        = returnInfo?.status ?? 'none';
  const isTracking    = !!(status && status !== 'none');
  const pleaDeadline  = returnInfo?.pleaDeadline ?? null;
  const pleaAttempts  = returnInfo?.pleaAttempts ?? 0;
  const discountValue = returnInfo?.discountValue ?? null;
  const pleaInfo      = returnInfo?.pleaInfo ?? null;

  const approvedItems    = returnItems.filter((i) => i.adminDecision === 'approved');
  const rejectedItems    = returnItems.filter((i) => i.adminDecision === 'rejected');
  const hasRejectedItems = rejectedItems.length > 0;

  // Plea window open: items_reviewed, no prior plea, deadline not expired
  const pleaWindowOpen = React.useMemo(
    () =>
      status === 'items_reviewed' &&
      pleaAttempts === 0 &&
      !!pleaDeadline &&
      new Date(pleaDeadline) > new Date(),
    [status, pleaAttempts, pleaDeadline]
  );

  // When all items are approved at items_reviewed, no choice needed — show approved state
  const allApproved = status === 'items_reviewed' && !hasRejectedItems && approvedItems.length > 0;

  const fromMyRefunds = location.state?.from === 'my-refunds-returns';
  const backPath      = fromMyRefunds ? '/my-refunds-returns' : `/order/${orderId}`;
  const backLabel     = fromMyRefunds ? 'Back' : 'Back to Order Details';

  const unreadCount = messages.filter((m) => m.senderType === 'admin' && !m.isRead).length;

  // ── Fetch on mount ───────────────────────────────────────────────────────
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

  // FIX: scroll to top when tracking view first appears (after submission)
  useEffect(() => {
    if (isTracking && trackingTopRef.current) {
      trackingTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isTracking]);

  // When all items are approved at items_reviewed, auto-advance choice to 'accepted'
  // so the UI shows the approved state without requiring user interaction
  useEffect(() => {
    if (allApproved && !itemsReviewedChoice) {
      setItemsReviewedChoice('accepted');
    }
  }, [allApproved, itemsReviewedChoice]);

  // ── Pre-populate items for new-return form ───────────────────────────────
  const itemsPopulated = useRef(false);
  useEffect(() => {
    if (order?.orderItems && !isTracking && !itemsPopulated.current) {
      itemsPopulated.current = true;
      const items = order.orderItems.map((item) => ({
        // FIX: always use product ObjectId, never the orderItem subdoc _id
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

  // ── Pre-populate form when viewing existing return ───────────────────────
  const returnInfoPopulated = useRef(false);
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

  // ── Global error/success toasts ──────────────────────────────────────────
  // Only fires for requestReturn (success=true only set by requestReturn.fulfilled)
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

  // ── Form handlers ────────────────────────────────────────────────────────
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

  // ── File handling ────────────────────────────────────────────────────────
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
  const handlePleaFileSelect = (e) => { addFiles(Array.from(e.target.files), setPleaFiles, setPleaFilePreviews, pleaFiles.length);     e.target.value = ''; };
  const removeFile     = (i) => { setSelectedFiles((p) => p.filter((_, j) => j !== i)); setFilePreviews((p) => p.filter((_, j) => j !== i)); };
  const removePleaFile = (i) => { setPleaFiles((p) => p.filter((_, j) => j !== i));     setPleaFilePreviews((p) => p.filter((_, j) => j !== i)); };

  // ── Accept decisions ─────────────────────────────────────────────────────
  const handleAcceptDecisions = async () => {
    try {
      await dispatch(acceptDecisions(orderId)).unwrap();
      toast.success('Decisions accepted. Your return is approved — please ship your items back.', {
        position: 'top-center', autoClose: 5000,
      });
      setItemsReviewedChoice('accepted');
      setShowAcceptConfirm(false);
      dispatch(getOrderDetails(orderId));
    } catch (err) {
      toast.error(typeof err === 'string' ? err : err?.message ?? 'Failed to accept decisions.', { position: 'top-center' });
    }
  };

  // ── Plea submit ──────────────────────────────────────────────────────────
  // FIX: Upload runs in parallel/background — does NOT block text submission.
  // Plea text is submitted immediately for faster UX.
  const handleSubmitPlea = async () => {
    if (pleaText.trim().length < MIN_PLEA_CHARS) {
      toast.error(`Plea description must be at least ${MIN_PLEA_CHARS} characters.`, { position: 'top-center' });
      return;
    }

    // FIX: Fire plea text submission immediately — don't wait for file upload
    const pleaPromise = dispatch(submitPlea({ orderId, pleaDescription: pleaText.trim() })).unwrap();

    // Upload evidence files in parallel (fire-and-forget, best-effort)
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
      // FIX: single toast here only — slice no longer sets success=true
      toast.success('Plea submitted. The admin will respond within 48 hours.', {
        position: 'top-center', autoClose: 4000,
      });
      setPleaText('');
      setPleaFiles([]);
      setPleaFilePreviews([]);
      setItemsReviewedChoice(null);
      dispatch(getOrderDetails(orderId));
    } catch {
      // pleaError in slice triggers toast via useEffect above
    }
  };

  // ── Validation ───────────────────────────────────────────────────────────
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

  // ── Submit return form ───────────────────────────────────────────────────
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
          // FIX: ensure product is always a plain ObjectId string, not a nested object
          product: product?._id?.toString() ?? product?.toString() ?? product,
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
      // FIX: scroll to top so tracking view is immediately visible
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error(err?.message || err || 'Failed to submit return request', { position: 'top-center', autoClose: 3000 });
    }
  };

  // ── Message handlers ─────────────────────────────────────────────────────
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

  // ── Cancel return ────────────────────────────────────────────────────────
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

  // ── Utilities ────────────────────────────────────────────────────────────
  const formatCurrency = (amount, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount ?? 0);

  const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
    d ? new Date(d).toLocaleDateString('en-US', opts) : 'N/A';

  const reasonLabel = (value) =>
    RETURN_REASONS.find((r) => r.value === value)?.label ?? value?.replace(/_/g, ' ') ?? '—';

  // Returns true if the given status has been reached in the lifecycle
  const hasReached = (targetStatus) => {
    const currentIdx = LIFECYCLE_ORDER.indexOf(status);
    const targetIdx  = LIFECYCLE_ORDER.indexOf(targetStatus);
    return currentIdx >= targetIdx && targetIdx !== -1;
  };

  // ── Render guards ────────────────────────────────────────────────────────
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

  // ── Main render ──────────────────────────────────────────────────────────
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
            <FiRotateCcw className="rtr-header-icon" />
            <div>
              <h1>{isTracking ? 'Return Status' : 'Request Return'}</h1>
              <p className="rtr-order-reference">Order: #{orderId.slice(-8).toUpperCase()}</p>
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

          {/* ── Tracking view ── */}
          {isTracking && (
            <div className="rtr-return-status-card">
              <div className="rtr-card-header">
                <FiInfo className="rtr-card-icon" />
                <h2>Return Information</h2>
                <ReturnStatusBadge status={status} />
              </div>

              <div className="rtr-status-details">

                {/* ── Timeline — correct order per spec ───────────────────────
                    requested → items_reviewed → plea_submitted → approved →
                    in_transit → received → inspected → awaiting_discount → completed */}
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

                  {/* Approved step — shown once return moves past items_reviewed phase */}
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

                  {hasReached('received') && returnInfo.receivedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Received</span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.receivedAt)}</span>
                      </div>
                    </div>
                  )}

                  {hasReached('inspected') && returnInfo.inspectedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Inspected</span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.inspectedAt)}</span>
                      </div>
                    </div>
                  )}

                  {/* FIX: awaiting_discount is LAST before completed */}
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

                {/* ── Info grid ── */}
                <div className="rtr-return-info-grid">
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Return Reason:</span>
                    <span className="rtr-info-value">{reasonLabel(returnInfo.reason)}</span>
                  </div>
                  <div className="rtr-info-item">
                    <span className="rtr-info-label">Items to Return:</span>
                    <span className="rtr-info-value">{returnItems.length} item(s)</span>
                  </div>
                  {/* FIX: discountValue only shown after items are reviewed and value > 0 */}
                  {discountValue != null && discountValue > 0 && hasReached('items_reviewed') && (
                    <div className="rtr-info-item">
                      <span className="rtr-info-label">Discount Value:</span>
                      <span className="rtr-info-value rtr-strong">
                        {formatCurrency(discountValue, order.paymentInfo?.currency)}
                      </span>
                    </div>
                  )}
                  {returnInfo.description && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">Description:</span>
                      <span className="rtr-info-value">{returnInfo.description}</span>
                    </div>
                  )}
                  {returnInfo.rmaNumber && (
                    <div className="rtr-info-item rtr-full-width">
                      <span className="rtr-info-label">RMA Number:</span>
                      <span className="rtr-info-value rtr-tracking">{returnInfo.rmaNumber}</span>
                    </div>
                  )}
                  {returnInfo.adminNote && (
                    <div className="rtr-info-item rtr-full-width rtr-admin-note">
                      <span className="rtr-info-label">Admin Note:</span>
                      <span className="rtr-info-value">{returnInfo.adminNote}</span>
                    </div>
                  )}
                </div>

                {/* ══ items_reviewed — decision cards + user choice ══ */}
                {status === 'items_reviewed' && returnItems.length > 0 && (
                  <div className="rtr-item-decisions">
                    <h3>Item Decisions</h3>
                    <div className="rtr-decisions-columns">
                      {approvedItems.length > 0 && (
                        <div className="rtr-decisions-col rtr-decisions-approved">
                          <div className="rtr-decisions-col-header">
                            <FiCheckCircle /><span>Approved ({approvedItems.length})</span>
                          </div>
                          {approvedItems.map((item, i) => (
                            <div key={i} className="rtr-decision-item">
                              {item.image && <img src={item.image} alt={item.name} className="rtr-item-image" />}
                              <div className="rtr-item-details">
                                <span className="rtr-item-name">{item.name || item.product?.name}</span>
                                <span className="rtr-item-quantity">Qty: {item.quantity}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {rejectedItems.length > 0 && (
                        <div className="rtr-decisions-col rtr-decisions-rejected">
                          <div className="rtr-decisions-col-header">
                            <FiXCircle /><span>Rejected ({rejectedItems.length})</span>
                          </div>
                          {rejectedItems.map((item, i) => (
                            <div key={i} className="rtr-decision-item">
                              {item.image && <img src={item.image} alt={item.name} className="rtr-item-image" />}
                              <div className="rtr-item-details">
                                <span className="rtr-item-name">{item.name || item.product?.name}</span>
                                <span className="rtr-item-quantity">Qty: {item.quantity}</span>
                                {item.adminRejectionReason && (
                                  <span className="rtr-rejection-reason">Reason: {item.adminRejectionReason}</span>
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

                    {/* All items approved — no choice needed, show proceed message */}
                    {!hasRejectedItems && pleaWindowOpen && (
                      <div className="rtr-accept-section">
                        <div className="rtr-accept-header">
                          <FiCheckCircle className="rtr-accept-icon" />
                          <div>
                            <h3>All Items Approved</h3>
                            <p>All your items have been approved. Accept the decisions to begin the return process.</p>
                          </div>
                        </div>
                        <div className="rtr-accept-actions">
                          <button
                            type="button"
                            className="rtr-btn-primary"
                            onClick={() => setShowAcceptConfirm(true)}
                            disabled={acceptLoading}
                          >
                            {acceptLoading ? <><FiClock className="rtr-spin" /> Processing…</> : <><FiCheckCircle /> Accept & Proceed</>}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Some items rejected — show choice */}
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
                          <button
                            type="button"
                            className="rtr-btn-choice rtr-btn-choice--accept"
                            onClick={() => setShowAcceptConfirm(true)}
                          >
                            <FiThumbsUp />
                            Accept Decisions
                            <span className="rtr-choice-sub">Proceed with approved items only</span>
                          </button>
                          <button
                            type="button"
                            className="rtr-btn-choice rtr-btn-choice--dispute"
                            onClick={() => setItemsReviewedChoice('plea')}
                          >
                            <FiThumbsDown />
                            Dispute Rejections
                            <span className="rtr-choice-sub">Submit a plea for rejected items</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Plea window expired — show info */}
                    {hasRejectedItems && !pleaWindowOpen && status === 'items_reviewed' && (
                      <div className="rtr-info-banner-neutral">
                        <FiInfo />
                        <span>The response window has closed. Your return is being automatically processed.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* ══ Accept confirmation modal ══ */}
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
                            {approvedItems.map((item, i) => (
                              <div key={i} className="rtr-accept-preview-item">
                                {item.image && <img src={item.image} alt={item.name} className="rtr-accept-preview-img" />}
                                <span>{item.name || item.product?.name}</span>
                                <span className="rtr-accept-preview-qty">×{item.quantity}</span>
                              </div>
                            ))}
                            {rejectedItems.length > 0 && (
                              <p className="rtr-accept-preview-rejected">
                                {rejectedItems.length} rejected item(s) will not be credited.
                              </p>
                            )}
                          </div>
                        )}
                        <p>This action cannot be undone. You will need to ship your approved items back.</p>
                      </div>
                      <div className="rtr-modal-actions">
                        <button onClick={() => setShowAcceptConfirm(false)} className="rtr-btn-secondary" disabled={acceptLoading}>
                          Go Back
                        </button>
                        <button onClick={handleAcceptDecisions} className="rtr-btn-primary" disabled={acceptLoading}>
                          {acceptLoading ? 'Processing…' : 'Confirm & Accept'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ══ Plea form ══ */}
                {status === 'items_reviewed' && itemsReviewedChoice === 'plea' && (
                  <div className="rtr-plea-section">
                    <div className="rtr-plea-header">
                      <FiInfo className="rtr-plea-header-icon" />
                      <div>
                        <h3>Dispute Rejected Items</h3>
                        <p>You have one opportunity to submit a plea. Provide a clear explanation and any supporting evidence.</p>
                      </div>
                    </div>

                    <div className="rtr-form-group">
                      <label className="rtr-form-label">Your Plea *</label>
                      <textarea
                        className="rtr-form-textarea"
                        value={pleaText}
                        onChange={(e) => setPleaText(e.target.value)}
                        rows={5}
                        maxLength={MAX_PLEA_CHARS}
                        placeholder="Explain why the rejected items should be reconsidered…"
                        disabled={pleaLoading}
                      />
                      <div className="rtr-char-counter">
                        <span className={pleaText.length > MAX_PLEA_CHARS - 100 ? 'rtr-char-warn' : ''}>{pleaText.length}</span>
                        /{MAX_PLEA_CHARS}
                        {pleaText.length < MIN_PLEA_CHARS && pleaText.length > 0 && (
                          <span className="rtr-char-warn rtr-char-min">&nbsp;(minimum {MIN_PLEA_CHARS} characters)</span>
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
                      <button type="button" className="rtr-btn-secondary" onClick={() => setItemsReviewedChoice(null)} disabled={pleaLoading}>
                        Go Back
                      </button>
                      <button type="button" className="rtr-btn-primary" onClick={handleSubmitPlea} disabled={pleaLoading || pleaText.trim().length < MIN_PLEA_CHARS}>
                        {pleaLoading
                          ? <><FiClock className="rtr-spin" /> Submitting…</>
                          : <><FiSend /> Submit Plea</>
                        }
                      </button>
                    </div>
                  </div>
                )}

                {/* ══ plea_submitted confirmation ══ */}
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
                    {pleaInfo?.pleaDocuments?.length > 0 && (
                      <div className="rtr-plea-evidence-thumbs">
                        <span className="rtr-info-label">Submitted Evidence:</span>
                        <div className="rtr-evidence-grid">
                          {pleaInfo.pleaDocuments.map((doc, i) => (
                            <a key={i} href={doc.url} target="_blank" rel="noopener noreferrer" className="rtr-evidence-thumb">
                              {doc.mimeType?.startsWith('image/')
                                ? <img src={doc.url} alt={doc.filename} />
                                : <div className="rtr-evidence-thumb-placeholder"><FiFile /><span>{doc.filename}</span></div>
                              }
                            </a>
                          ))}
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

                {/* ══ approved — ship items back ══ */}
                {status === 'approved' && (
                  <div className="rtr-approved-panel">
                    <FiTruck className="rtr-approved-icon" />
                    <h3>Return Approved — Ship Your Items</h3>
                    <p>Your return has been approved. Please ship the following items back to us.</p>
                    {approvedItems.length > 0 && (
                      <div className="rtr-awaiting-approved-items">
                        {approvedItems.map((item, i) => (
                          <span key={i} className="rtr-awaiting-item-pill">
                            {item.name || item.product?.name} ×{item.quantity}
                          </span>
                        ))}
                      </div>
                    )}
                    {returnInfo.adminNote && (
                      <p className="rtr-approved-note"><strong>Note:</strong> {returnInfo.adminNote}</p>
                    )}
                  </div>
                )}

                {/* ══ awaiting_discount — FIX: last step before complete ══ */}
                {status === 'awaiting_discount' && (
                  <div className="rtr-awaiting-discount">
                    <div className="rtr-awaiting-discount-icon-wrap">
                      <FiLoader className="rtr-awaiting-spin" />
                    </div>
                    <h3>Your Discount Code Is Being Prepared</h3>
                    <p>Your items have been inspected. Our team is generating your store credit discount code.</p>
                    {discountValue != null && discountValue > 0 && (
                      <div className="rtr-awaiting-discount-value">
                        Expected discount: <strong>{formatCurrency(discountValue, order.paymentInfo?.currency)}</strong>
                      </div>
                    )}
                    {approvedItems.length > 0 && (
                      <div className="rtr-awaiting-approved-items">
                        <span className="rtr-info-label">Approved items:</span>
                        {approvedItems.map((item, i) => (
                          <span key={i} className="rtr-awaiting-item-pill">
                            {item.name || item.product?.name} ×{item.quantity}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ══ completed ══ */}
                {status === 'completed' && (
                  <div className="rtr-completed-panel">
                    <FiCheckCircle className="rtr-completed-icon" />
                    <h3>Return Completed</h3>
                    <p>Your store credit discount code has been issued.</p>
                    <button className="rtr-btn-primary" onClick={() => navigate('/my-discounts')} style={{ marginTop: 12 }}>
                      <FiTag /> View My Discount Codes
                    </button>
                  </div>
                )}

                {/* Items list (non-decision statuses) */}
                {!['items_reviewed', 'plea_submitted', 'approved', 'awaiting_discount', 'completed'].includes(status) && returnItems.length > 0 && (
                  <div className="rtr-return-items">
                    <h3>Items Being Returned</h3>
                    <div className="rtr-items-list">
                      {returnItems.map((item, index) => (
                        <div key={index} className="rtr-return-item-card">
                          {item.image && <img src={item.image} alt={item.name} className="rtr-item-image" />}
                          <div className="rtr-item-details">
                            <span className="rtr-item-name">{item.name}</span>
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

          {/* ── Order summary ── */}
          <div className="rtr-summary-card">
            <div className="rtr-card-header">
              <FiPackage className="rtr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rtr-summary-details">
              <div className="rtr-summary-row">
                <span className="rtr-label">Total Amount:</span>
                <span className="rtr-value rtr-strong">{formatCurrency(order.totalPrice, order.paymentInfo?.currency)}</span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Order Status:</span>
                <span className="rtr-value">
                  <span className={`rtr-status-badge rtr-status-${order.orderStatus.toLowerCase()}`}>{order.orderStatus}</span>
                </span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Ordered Date:</span>
                <span className="rtr-value">{fmtDate(order.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          {/* ── New-return form ── */}
          {!isTracking && (
            <div className="rtr-return-form-card">
              <div className="rtr-card-header">
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
                          <span className="rtr-item-price">{formatCurrency(item.price, order.paymentInfo?.currency)}</span>
                        </div>
                        {item.selected && (
                          <>
                            <div className="rtr-quantity-selector">
                              <label>Quantity:</label>
                              <div className="rtr-quantity-controls">
                                <button type="button" onClick={() => handleQuantityChange(index, item.returnQuantity - 1)} disabled={item.returnQuantity <= 1}>-</button>
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
                    rows={4} maxLength={MAX_DESC_CHARS} placeholder="Describe the issue(s) with your order…"
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