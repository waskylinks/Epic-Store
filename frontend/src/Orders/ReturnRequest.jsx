// ReturnRequest.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import axios from 'axios';
import {
  FiPackage,
  FiAlertCircle,
  FiClock,
  FiSend,
  FiPaperclip,
  FiX,
  FiFile,
  FiVideo,
  FiMessageSquare,
  FiRotateCcw,
  FiInfo,
  FiArrowLeft,
  FiBox,
  FiCheckCircle,
  FiXCircle,
  FiTag,
  FiLoader,
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

const MAX_FILES       = 8;
const MAX_DESC_CHARS  = 2000;
const MAX_PLEA_CHARS  = 2000;
const MIN_PLEA_CHARS  = 10;

const ALLOWED_FILE_TYPES = {
  images:    ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  videos:    ['video/mp4', 'video/webm', 'video/quicktime'],
  documents: ['application/pdf'],
};

// ─────────────────────────────────────────────
// CountdownTimer
// Reusable countdown — takes a deadline ISO string or Date.
// Shows "Expired" when past. Updates every second, cleans up on unmount.
// ─────────────────────────────────────────────
const CountdownTimer = ({ deadline, label, expiredLabel = 'Expired' }) => {
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (!deadline) return;

    const tick = () => {
      const diff = new Date(deadline) - Date.now();
      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ d, h, m, s, expired: false });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;

  // isExpired is derived from timeLeft state only — Date.now() must not be
  // called during render (impure function, violates react-hooks/purity rule).
  // The interval already nulls timeLeft when diff <= 0, so null reliably
  // means expired.
  const isExpired = !timeLeft;

  return (
    <div className={`rtr-countdown ${isExpired ? 'rtr-countdown-expired' : ''}`}>
      <FiClock className="rtr-countdown-icon" />
      {label && <span className="rtr-countdown-label">{label}</span>}
      <span className="rtr-countdown-value">
        {isExpired
          ? expiredLabel
          : `${timeLeft.d}d ${timeLeft.h}h ${timeLeft.m}m ${timeLeft.s}s`}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────
// ReturnStatusBadge
// ─────────────────────────────────────────────
const ReturnStatusBadge = ({ status }) => {
  const configs = {
    none:              { label: 'No Return',           className: 'rtr-return-badge-none',             icon: '○'  },
    requested:         { label: 'Return Requested',    className: 'rtr-return-badge-requested',        icon: '⏳' },
    items_reviewed:    { label: 'Items Reviewed',      className: 'rtr-return-badge-items-reviewed',   icon: '📋' },
    plea_submitted:    { label: 'Plea Submitted',      className: 'rtr-return-badge-plea-submitted',   icon: '📨' },
    awaiting_discount: { label: 'Awaiting Discount',   className: 'rtr-return-badge-awaiting-discount',icon: '🏷️' },
    approved:          { label: 'Approved',            className: 'rtr-return-badge-approved',         icon: '✓'  },
    rejected:          { label: 'Rejected',            className: 'rtr-return-badge-rejected',         icon: '✗'  },
    in_transit:        { label: 'In Transit',          className: 'rtr-return-badge-transit',          icon: '🚚' },
    received:          { label: 'Received',            className: 'rtr-return-badge-received',         icon: '📦' },
    inspected:         { label: 'Inspecting',          className: 'rtr-return-badge-inspecting',       icon: '🔍' },
    completed:         { label: 'Completed',           className: 'rtr-return-badge-completed',        icon: '✓'  },
    cancelled:         { label: 'Cancelled',           className: 'rtr-return-badge-cancelled',        icon: '✗'  },
  };
  const config = configs[status] ?? configs.none;

  return (
    <span className={`rtr-return-badge ${config.className}`}>
      <span className="rtr-return-badge-icon">{config.icon}</span>
      <span className="rtr-return-badge-label">{config.label}</span>
    </span>
  );
};

// ─────────────────────────────────────────────
// PolicyGate
// Full-screen blocking acknowledgment — local state only, resets on reload.
// NOT a checkbox. Three statements + one CTA button.
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
          <span>Your discount value is calculated based on <strong>approved items only</strong>. Rejected items are not credited.</span>
        </div>
      </div>
      <button className="rtr-btn-primary rtr-policy-gate-btn" onClick={onAccept}>
        I Understand, Continue to Return Form
      </button>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// ReturnRequest
// ─────────────────────────────────────────────
function ReturnRequest() {
  const { id: orderId } = useParams();
  const navigate        = useNavigate();
  const dispatch        = useDispatch();
  const fileInputRef    = useRef(null);
  const pleaFileInputRef = useRef(null);
  const location        = useLocation();

  const { order, loading: orderLoading } = useSelector((s) => s.order);

  const {
    messages,
    loading,
    messagesLoading,
    messageSendLoading,
    uploadLoading,
    pleaLoading,
    pleaError,
    hasMoreMessages,
    totalMessages,
    messagesPage,
    pendingAttachments,
    errorStage,
    error,
    success,
  } = useSelector((s) => s.return);

  // ── Policy gate — local state, intentionally NOT persisted ──────────────
  // Resets on every page load so the user re-acknowledges on each visit.
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);

  const [formData, setFormData] = useState({
    reason:        '',
    description:   '',
    itemsToReturn: [],
  });
  const [formErrors,        setFormErrors]        = useState({});
  const [selectedFiles,     setSelectedFiles]     = useState([]);
  const [filePreviews,      setFilePreviews]      = useState([]);
  const [showCancelModal,   setShowCancelModal]   = useState(false);
  const [showMessagesModal, setShowMessagesModal] = useState(false);

  // ── Plea form state ──────────────────────────────────────────────────────
  const [pleaText,          setPleaText]          = useState('');
  const [pleaFiles,         setPleaFiles]         = useState([]);
  const [pleaFilePreviews,  setPleaFilePreviews]  = useState([]);
  const [pleaUploading,     setPleaUploading]     = useState(false);

  // ── Data sources ─────────────────────────────────────────────────────────
  // Primary source of truth for return data: order.returnInfo (from orderSlice).
  // getOrderDetails fetches the full order doc including all returnInfo fields.
  // The returnSlice mirrors (pleaDeadline etc.) keep s.return in sync but the
  // component reads directly from order.returnInfo to avoid a two-source problem.
  const returnInfo  = order?.returnInfo ?? null;
  const returnItems = returnInfo?.itemsToReturn ?? [];
  const status      = returnInfo?.status ?? 'none';

  const isTracking = !!(status && status !== 'none');

  // Derived new-flow state — read directly from returnInfo (full subdoc)
  const pleaDeadline       = returnInfo?.pleaDeadline ?? null;
  const pleaAttempts       = returnInfo?.pleaAttempts ?? 0;
  const discountValue      = returnInfo?.discountValue ?? null;
  const pleaInfo           = returnInfo?.pleaInfo ?? null;

  // Per-item decisions for items_reviewed / plea_submitted display
  const approvedItems = returnItems.filter((i) => i.adminDecision === 'approved');
  const rejectedItems = returnItems.filter((i) => i.adminDecision === 'rejected');

  // Plea window: only show form if items_reviewed, no prior plea, deadline not expired.
  // useMemo is used here instead of a bare expression because Date.now() is an
  // impure function — calling it directly during render violates react-hooks/purity.
  // useMemo is React's sanctioned way to compute derived values that depend on
  // impure sources; the value is stable within a single render pass.
  const pleaWindowOpen = React.useMemo(
    () =>
      status === 'items_reviewed' &&
      pleaAttempts === 0 &&
      !!pleaDeadline &&
      new Date(pleaDeadline) > new Date(),
    [status, pleaAttempts, pleaDeadline]
  );

  // Back navigation
  const fromMyRefunds = location.state?.from === 'my-refunds-returns';
  const backPath      = fromMyRefunds ? '/my-refunds-returns' : `/order/${orderId}`;
  const backLabel     = fromMyRefunds ? 'Back' : 'Back to Order Details';

  const unreadCount = messages.filter(
    (msg) => msg.senderType === 'admin' && !msg.isRead
  ).length;

  // ── Fetch on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    if (orderId) dispatch(getOrderDetails(orderId));
  }, [dispatch, orderId]);

  // Keep returnSlice in sync when tracking — needed so other parts of the app
  // that read s.return.pleaDeadline / pleaAttempts / discountValue stay current.
  useEffect(() => {
    if (isTracking && orderId) dispatch(getReturnStatus(orderId));
  }, [isTracking, orderId, dispatch]);

  const fetchMessages = useCallback(
    (page = 1) => {
      if (orderId) dispatch(getReturnMessages({ orderId, page }));
    },
    [dispatch, orderId]
  );

  useEffect(() => {
    if (isTracking) fetchMessages(1);
  }, [isTracking, fetchMessages]);

  // ── Pre-populate items for new-return form ───────────────────────────────
  const itemsPopulated = useRef(false);
  useEffect(() => {
    if (order?.orderItems && !isTracking && !itemsPopulated.current) {
      itemsPopulated.current = true;
      const items = order.orderItems.map((item) => ({
        product:        item.product || item._id,
        name:           item.name    || '',
        price:          item.price   || 0,
        image:          item.image   || '',
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

  // ── Global error / success toasts ────────────────────────────────────────
  useEffect(() => {
    if (error) {
      toast.error(error, { position: 'top-center' });
      dispatch(clearReturnState());
    }
    if (success) {
      toast.success('Return request submitted successfully', {
        position:  'top-center',
        autoClose: 3000,
      });
      dispatch(clearReturnState());
    }
  }, [success, error, dispatch]);

  // Plea error is isolated — does not go through the global effect above
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
    const item        = formData.itemsToReturn[index];
    const newQuantity = Math.max(1, Math.min(quantity, item.quantity));
    setFormData((prev) => ({
      ...prev,
      itemsToReturn: prev.itemsToReturn.map((it, i) =>
        i === index ? { ...it, returnQuantity: newQuantity } : it
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

  // ── File handling (return form) ──────────────────────────────────────────
  const isFileTypeAllowed = (file) => {
    const all = [
      ...ALLOWED_FILE_TYPES.images,
      ...ALLOWED_FILE_TYPES.videos,
      ...ALLOWED_FILE_TYPES.documents,
    ];
    return all.includes(file.type);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (selectedFiles.length + files.length > MAX_FILES) {
      toast.error(`You can only upload up to ${MAX_FILES} files`, { position: 'top-center' });
      return;
    }
    const validFiles = files.filter((file) => {
      if (!isFileTypeAllowed(file)) {
        toast.error(`${file.name} is not a supported file type`, { position: 'top-center' });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10 MB limit`, { position: 'top-center' });
        return false;
      }
      return true;
    });
    setSelectedFiles((prev) => [...prev, ...validFiles]);
    validFiles.forEach((file) => {
      const reader     = new FileReader();
      reader.onloadend = () => {
        setFilePreviews((prev) => [
          ...prev,
          { file, preview: reader.result, type: file.type },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePreviews((prev)  => prev.filter((_, i) => i !== index));
  };

  // ── File handling (plea evidence) ────────────────────────────────────────
  const handlePleaFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (pleaFiles.length + files.length > MAX_FILES) {
      toast.error(`You can only upload up to ${MAX_FILES} files`, { position: 'top-center' });
      return;
    }
    const validFiles = files.filter((file) => {
      if (!isFileTypeAllowed(file)) {
        toast.error(`${file.name} is not a supported file type`, { position: 'top-center' });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10 MB limit`, { position: 'top-center' });
        return false;
      }
      return true;
    });
    setPleaFiles((prev) => [...prev, ...validFiles]);
    validFiles.forEach((file) => {
      const reader     = new FileReader();
      reader.onloadend = () => {
        setPleaFilePreviews((prev) => [
          ...prev,
          { file, preview: reader.result, type: file.type },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePleaFile = (index) => {
    setPleaFiles((prev)        => prev.filter((_, i) => i !== index));
    setPleaFilePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Plea submit ──────────────────────────────────────────────────────────
  // File uploads go to the plea/upload endpoint BEFORE the text submission so
  // they are already stored in pleaInfo.pleaDocuments when the plea is saved.
  // The plea/upload route accepts items_reviewed status (pre-submit uploads).
  const handleSubmitPlea = async () => {
    if (pleaText.trim().length < MIN_PLEA_CHARS) {
      toast.error(`Plea description must be at least ${MIN_PLEA_CHARS} characters.`, { position: 'top-center' });
      return;
    }

    // Upload evidence files first (best-effort — failure warns, does not block plea)
    if (pleaFiles.length > 0) {
      setPleaUploading(true);
      try {
        const formData = new FormData();
        pleaFiles.forEach((f) => formData.append('attachments', f));
        await axios.post(
          `/api/v1/orders/${orderId}/return/plea/upload`,
          formData,
          { withCredentials: true }
        );
      } catch {
        toast.warn('Evidence files could not be uploaded, but your plea will still be submitted.', {
          position:  'top-center',
          autoClose: 4000,
        });
      } finally {
        setPleaUploading(false);
      }
    }

    try {
      await dispatch(submitPlea({ orderId, pleaDescription: pleaText.trim() })).unwrap();
      toast.success('Plea submitted. The admin will respond within 48 hours.', {
        position:  'top-center',
        autoClose: 4000,
      });
      setPleaText('');
      setPleaFiles([]);
      setPleaFilePreviews([]);
      // Refresh order so the status badge and plea submitted view update immediately
      dispatch(getOrderDetails(orderId));
    } catch {
      // pleaError in the slice handles the toast via the useEffect above.
      // .unwrap() re-throws on rejection — caught here to prevent an
      // unhandled promise rejection without needing the error value.
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
    const selectedItems = formData.itemsToReturn.filter((i) => i.selected);
    if (selectedItems.length === 0) errors.items = 'Please select at least one item to return';
    selectedItems.forEach((item) => {
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
          product, quantity: returnQuantity, name, price, image, reason,
        }));

      await dispatch(
        requestReturn({
          orderId,
          returnData: {
            reason:      formData.reason,
            description: formData.description,
            items:       selectedItems,
            attachments: [],
          },
        })
      ).unwrap();

      if (selectedFiles.length > 0) {
        try {
          await dispatch(uploadReturnFiles({ orderId, files: selectedFiles })).unwrap();
        } catch {
          toast.warn(
            'Return submitted but file upload failed. You can retry from the messages panel.',
            { position: 'top-center', autoClose: 5000 }
          );
        }
      }

      dispatch(getOrderDetails(orderId));
    } catch (err) {
      toast.error(err?.message || err || 'Failed to submit return request', {
        position:  'top-center',
        autoClose: 3000,
      });
    }
  };

  // ── Message send ─────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (content, files, pendingUrls = []) => {
      if (messageSendLoading) return;
      await dispatch(
        sendReturnMessage({ orderId, content, files, pendingUrls })
      ).unwrap();
      fetchMessages(1);
    },
    [dispatch, orderId, fetchMessages, messageSendLoading]
  );

  const handleRefreshMessages = useCallback(() => fetchMessages(1), [fetchMessages]);

  const handleLoadMore = useCallback(() => {
    if (messagesLoading) return;
    fetchMessages(messagesPage + 1);
  }, [fetchMessages, messagesPage, messagesLoading]);

  const handleCloseModal = useCallback(() => {
    dispatch(clearReturnMessages());
    setShowMessagesModal(false);
  }, [dispatch]);

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
    new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2,
    }).format(amount);

  const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
    d ? new Date(d).toLocaleDateString('en-US', opts) : 'N/A';

  const reasonLabel = (value) =>
    RETURN_REASONS.find((r) => r.value === value)?.label ??
    value?.replace(/_/g, ' ') ?? '—';

  // ── Render guards ────────────────────────────────────────────────────────
  if (orderLoading)
    return (
      <>
        <Navbar />
        <Loader type="snake" size="md" />
        <Footer />
      </>
    );

  if (!order?._id)
    return (
      <>
        <PageTitle title="Order Not Found" />
        <Navbar />
        <div className="rtr-return-error-container">
          <div className="rtr-error-card">
            <FiAlertCircle className="rtr-error-icon" />
            <h2>Order not found</h2>
            <p>
              The order you&apos;re looking for doesn&apos;t exist or you
              don&apos;t have permission to view it.
            </p>
            <button onClick={() => navigate(backPath)} className="rtr-btn-back-nav">
              <FiArrowLeft /> {backLabel}
            </button>
          </div>
        </div>
        <Footer />
      </>
    );

  // ── Policy gate — only shown before the new-return form ──────────────────
  // NOT shown when isTracking (user already submitted, gate is irrelevant).
  if (!isTracking && !policyAcknowledged) {
    return (
      <>
        <PageTitle title={`Request Return - Order ${orderId}`} />
        <Navbar />
        <PolicyGate onAccept={() => setPolicyAcknowledged(true)} />
        <Footer />
      </>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle
        title={
          isTracking
            ? `Return Status - Order ${orderId}`
            : `Request Return - Order ${orderId}`
        }
      />
      <Navbar />

      <div className="rtr-return-request-container">

        {/* ── Back button ── */}
        <button onClick={() => navigate(backPath)} className="rtr-btn-back-nav">
          <FiArrowLeft /> {backLabel}
        </button>

        {/* ── Header ── */}
        <div className="rtr-return-header">
          <div className="rtr-header-content">
            <FiRotateCcw className="rtr-header-icon" />
            <div>
              <h1>{isTracking ? 'Return Status' : 'Request Return'}</h1>
              <p className="rtr-order-reference">
                Order: #{orderId.slice(-8).toUpperCase()}
              </p>
            </div>
          </div>

          {isTracking && (
            <button
              className="rtr-btn-messages"
              onClick={() => setShowMessagesModal(true)}
            >
              <FiMessageSquare />
              <span>Messages</span>
              {unreadCount > 0 && (
                <span className="rtr-message-badge">{unreadCount}</span>
              )}
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

                {/* ── Timeline ── */}
                <div className="rtr-status-timeline">
                  <div className="rtr-timeline-item">
                    <div className="rtr-timeline-dot rtr-active" />
                    <div className="rtr-timeline-content">
                      <span className="rtr-timeline-label">Requested</span>
                      <span className="rtr-timeline-date">{fmtDate(returnInfo.requestedAt)}</span>
                    </div>
                  </div>

                  {/* Items reviewed step */}
                  {['items_reviewed','plea_submitted','awaiting_discount','in_transit','received','inspected','completed'].includes(status) && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Items Reviewed</span>
                        {returnInfo.approvedAt && (
                          <span className="rtr-timeline-date">{fmtDate(returnInfo.approvedAt)}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Plea submitted step */}
                  {['plea_submitted','awaiting_discount','completed'].includes(status) && pleaInfo?.pleaSubmittedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Plea Submitted</span>
                        <span className="rtr-timeline-date">{fmtDate(pleaInfo.pleaSubmittedAt)}</span>
                      </div>
                    </div>
                  )}

                  {/* Awaiting discount step */}
                  {['awaiting_discount','completed'].includes(status) && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Awaiting Discount</span>
                      </div>
                    </div>
                  )}

                  {returnInfo.approvedAt && !['items_reviewed','plea_submitted','awaiting_discount'].includes(status) && (
                    <div className="rtr-timeline-item">
                      <div className={`rtr-timeline-dot ${status !== 'rejected' ? 'rtr-active' : 'rtr-rejected'}`} />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">
                          {status === 'rejected' ? 'Rejected' : 'Approved'}
                        </span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.approvedAt)}</span>
                      </div>
                    </div>
                  )}

                  {returnInfo.shippedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">In Transit</span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.shippedAt)}</span>
                      </div>
                    </div>
                  )}

                  {returnInfo.receivedAt && (
                    <div className="rtr-timeline-item">
                      <div className="rtr-timeline-dot rtr-active" />
                      <div className="rtr-timeline-content">
                        <span className="rtr-timeline-label">Received</span>
                        <span className="rtr-timeline-date">{fmtDate(returnInfo.receivedAt)}</span>
                      </div>
                    </div>
                  )}

                  {returnInfo.completedAt && (
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

                {/* ══ NEW: items_reviewed — per-item decision preview ══ */}
                {['items_reviewed', 'plea_submitted', 'awaiting_discount', 'completed'].includes(status) && returnItems.length > 0 && (
                  <div className="rtr-item-decisions">
                    <h3>Item Decisions</h3>
                    <div className="rtr-decisions-columns">
                      {approvedItems.length > 0 && (
                        <div className="rtr-decisions-col rtr-decisions-approved">
                          <div className="rtr-decisions-col-header">
                            <FiCheckCircle />
                            <span>Approved ({approvedItems.length})</span>
                          </div>
                          {approvedItems.map((item, i) => (
                            <div key={i} className="rtr-decision-item">
                              {item.image && (
                                <img src={item.image} alt={item.name} className="rtr-item-image" />
                              )}
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
                            <FiXCircle />
                            <span>Rejected ({rejectedItems.length})</span>
                          </div>
                          {rejectedItems.map((item, i) => (
                            <div key={i} className="rtr-decision-item">
                              {item.image && (
                                <img src={item.image} alt={item.name} className="rtr-item-image" />
                              )}
                              <div className="rtr-item-details">
                                <span className="rtr-item-name">{item.name || item.product?.name}</span>
                                <span className="rtr-item-quantity">Qty: {item.quantity}</span>
                                {item.adminRejectionReason && (
                                  <span className="rtr-rejection-reason">
                                    Reason: {item.adminRejectionReason}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Countdown timer — plea window during items_reviewed */}
                    {status === 'items_reviewed' && pleaDeadline && (
                      <CountdownTimer
                        deadline={pleaDeadline}
                        label="Time remaining to submit plea:"
                        expiredLabel="Plea window closed — proceeding to discount"
                      />
                    )}
                  </div>
                )}

                {/* ══ NEW: Plea submission form ══
                    Shown when: items_reviewed, no prior plea, window open */}
                {pleaWindowOpen && (
                  <div className="rtr-plea-section">
                    <div className="rtr-plea-header">
                      <FiInfo className="rtr-plea-header-icon" />
                      <div>
                        <h3>Dispute Rejected Items</h3>
                        <p>
                          You have one opportunity to submit a plea for items that were rejected.
                          Provide a clear explanation and any supporting evidence.
                        </p>
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
                        placeholder="Explain why you believe the rejected items should be reconsidered…"
                        disabled={pleaLoading || pleaUploading}
                      />
                      <div className="rtr-char-counter">
                        <span className={pleaText.length > MAX_PLEA_CHARS - 100 ? 'rtr-char-warn' : ''}>
                          {pleaText.length}
                        </span>
                        /{MAX_PLEA_CHARS}
                        {pleaText.length < MIN_PLEA_CHARS && pleaText.length > 0 && (
                          <span className="rtr-char-warn rtr-char-min">
                            &nbsp;(minimum {MIN_PLEA_CHARS} characters)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Plea evidence upload */}
                    <div className="rtr-form-group">
                      <label className="rtr-form-label">Supporting Evidence (Optional)</label>
                      <p className="rtr-helper-text">
                        Upload photos, videos, or documents to support your plea.
                      </p>
                      <input
                        ref={pleaFileInputRef}
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf"
                        onChange={handlePleaFileSelect}
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        className="rtr-btn-upload"
                        onClick={() => pleaFileInputRef.current?.click()}
                        disabled={pleaFiles.length >= MAX_FILES || pleaLoading || pleaUploading}
                      >
                        <FiPaperclip /> Add Evidence Files
                      </button>

                      {pleaFilePreviews.length > 0 && (
                        <div className="rtr-file-previews" style={{ marginTop: '10px' }}>
                          {pleaFilePreviews.map((item, index) => (
                            <div key={index} className="rtr-file-preview-item">
                              {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                                <img src={item.preview} alt={item.file.name} className="rtr-preview-image" />
                              ) : ALLOWED_FILE_TYPES.videos.includes(item.type) ? (
                                <div className="rtr-preview-placeholder"><FiVideo /></div>
                              ) : (
                                <div className="rtr-preview-placeholder"><FiFile /></div>
                              )}
                              <div className="rtr-file-info">
                                <span className="rtr-file-name">{item.file.name}</span>
                                <span className="rtr-file-size">
                                  {(item.file.size / 1024 / 1024).toFixed(2)} MB
                                </span>
                              </div>
                              <button
                                type="button"
                                className="rtr-btn-remove-file"
                                onClick={() => removePleaFile(index)}
                                disabled={pleaLoading || pleaUploading}
                              >
                                <FiX />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="rtr-btn-primary"
                      onClick={handleSubmitPlea}
                      disabled={
                        pleaLoading ||
                        pleaUploading ||
                        pleaText.trim().length < MIN_PLEA_CHARS
                      }
                    >
                      {pleaLoading || pleaUploading ? (
                        <><FiClock className="rtr-spin" /> Submitting Plea…</>
                      ) : (
                        <><FiSend /> Submit Plea</>
                      )}
                    </button>
                  </div>
                )}

                {/* ══ NEW: plea_submitted — confirmation panel ══ */}
                {status === 'plea_submitted' && pleaInfo && (
                  <div className="rtr-plea-submitted-panel">
                    <div className="rtr-plea-submitted-header">
                      <FiCheckCircle className="rtr-plea-submitted-icon" />
                      <div>
                        <h3>Plea Submitted</h3>
                        <p>Your plea is under review. The admin will respond within 48 hours.</p>
                      </div>
                    </div>

                    {pleaInfo.pleaDescription && (
                      <div className="rtr-plea-submitted-text">
                        <span className="rtr-info-label">Your Plea:</span>
                        <p>{pleaInfo.pleaDescription}</p>
                      </div>
                    )}

                    {pleaInfo.pleaDocuments?.length > 0 && (
                      <div className="rtr-plea-evidence-thumbs">
                        <span className="rtr-info-label">Submitted Evidence:</span>
                        <div className="rtr-evidence-grid">
                          {pleaInfo.pleaDocuments.map((doc, i) => (
                            <a
                              key={i}
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rtr-evidence-thumb"
                            >
                              {doc.mimeType?.startsWith('image/') ? (
                                <img src={doc.url} alt={doc.filename} />
                              ) : (
                                <div className="rtr-evidence-thumb-placeholder">
                                  <FiFile />
                                  <span>{doc.filename}</span>
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Admin response countdown */}
                    {pleaDeadline && (
                      <CountdownTimer
                        deadline={pleaDeadline}
                        label="Admin response window:"
                        expiredLabel="Response window closed — proceeding to discount"
                      />
                    )}
                  </div>
                )}

                {/* ══ NEW: awaiting_discount status view ══ */}
                {status === 'awaiting_discount' && (
                  <div className="rtr-awaiting-discount">
                    <div className="rtr-awaiting-discount-icon-wrap">
                      <FiLoader className="rtr-awaiting-spin" />
                    </div>
                    <h3>Your Discount Code Is Being Prepared</h3>
                    <p>Our team is generating your store credit discount code. You will be notified when it is ready.</p>
                    {discountValue != null && discountValue > 0 && (
                      <div className="rtr-awaiting-discount-value">
                        Expected discount:{' '}
                        <strong>{formatCurrency(discountValue, order.paymentInfo?.currency)}</strong>
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

                {/* ══ NEW: completed status — discount code display ══
                    The discount code lives on a Discount document, not on the order.
                    Direct the customer to My Discounts to find their code. */}
                {status === 'completed' && (
                  <div className="rtr-completed-panel">
                    <FiCheckCircle className="rtr-completed-icon" />
                    <h3>Return Completed</h3>
                    <p>Your store credit discount code has been issued.</p>
                    <button
                      className="rtr-btn-primary"
                      onClick={() => navigate('/my-discounts')}
                      style={{ marginTop: '12px' }}
                    >
                      <FiTag /> View My Discount Codes
                    </button>
                  </div>
                )}

                {/* Items list (original view for non-decision statuses) */}
                {!['items_reviewed','plea_submitted','awaiting_discount','completed'].includes(status) && returnItems.length > 0 && (
                  <div className="rtr-return-items">
                    <h3>Items Being Returned</h3>
                    <div className="rtr-items-list">
                      {returnItems.map((item, index) => (
                        <div key={index} className="rtr-return-item-card">
                          {item.image && (
                            <img src={item.image} alt={item.name} className="rtr-item-image" />
                          )}
                          <div className="rtr-item-details">
                            <span className="rtr-item-name">{item.name}</span>
                            <span className="rtr-item-quantity">Quantity: {item.quantity}</span>
                            {item.reason && (
                              <span className="rtr-item-reason">Reason: {reasonLabel(item.reason)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cancel button — ONLY shown when status=requested */}
                {status === 'requested' && (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="rtr-btn-cancel-return"
                    disabled={loading}
                  >
                    <FiX /> Cancel Return Request
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Order summary (always shown) ── */}
          <div className="rtr-summary-card">
            <div className="rtr-card-header">
              <FiPackage className="rtr-card-icon" />
              <h2>Order Summary</h2>
            </div>
            <div className="rtr-summary-details">
              <div className="rtr-summary-row">
                <span className="rtr-label">Total Amount:</span>
                <span className="rtr-value rtr-strong">
                  {formatCurrency(order.totalPrice, order.paymentInfo?.currency)}
                </span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Order Status:</span>
                <span className="rtr-value">
                  <span className={`rtr-status-badge rtr-status-${order.orderStatus.toLowerCase()}`}>
                    {order.orderStatus}
                  </span>
                </span>
              </div>
              <div className="rtr-summary-row">
                <span className="rtr-label">Ordered Date:</span>
                <span className="rtr-value">
                  {fmtDate(order.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
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

                {/* Item selection */}
                <div className="rtr-form-section">
                  <label className="rtr-section-label">Items in Your Order</label>
                  <div className="rtr-items-grid">
                    {formData.itemsToReturn.map((item, index) => (
                      <div
                        key={index}
                        className={`rtr-item-card ${item.selected ? 'rtr-selected' : ''}`}
                      >
                        <div className="rtr-item-checkbox">
                          <input
                            type="checkbox"
                            id={`item-${index}`}
                            checked={item.selected}
                            onChange={() => handleItemToggle(index)}
                          />
                          <label htmlFor={`item-${index}`} />
                        </div>

                        {item.image && (
                          <img src={item.image} alt={item.name} className="rtr-item-image" />
                        )}

                        <div className="rtr-item-info">
                          <span className="rtr-item-name">{item.name}</span>
                          <span className="rtr-item-price">
                            {formatCurrency(item.price, order.paymentInfo?.currency)}
                          </span>
                        </div>

                        {item.selected && (
                          <>
                            <div className="rtr-quantity-selector">
                              <label>Quantity:</label>
                              <div className="rtr-quantity-controls">
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(index, item.returnQuantity - 1)}
                                  disabled={item.returnQuantity <= 1}
                                >
                                  -
                                </button>
                                <span>{item.returnQuantity}</span>
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(index, item.returnQuantity + 1)}
                                  disabled={item.returnQuantity >= item.quantity}
                                >
                                  +
                                </button>
                              </div>
                              <span className="rtr-max-qty">Max: {item.quantity}</span>
                            </div>

                            <div className="rtr-item-reason-selector">
                              <label
                                htmlFor={`item-reason-${index}`}
                                className="rtr-item-reason-label"
                              >
                                Reason for this item *
                              </label>
                              <select
                                id={`item-reason-${index}`}
                                className={`rtr-form-select rtr-item-reason-select ${
                                  formErrors[`itemReason_${index}`] ? 'rtr-error' : ''
                                }`}
                                value={item.reason}
                                onChange={(e) => handleItemReasonChange(index, e.target.value)}
                              >
                                <option value="">Select a reason</option>
                                {RETURN_REASONS.map((r) => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                              {formErrors[`itemReason_${index}`] && (
                                <span className="rtr-error-message">
                                  <FiAlertCircle /> {formErrors[`itemReason_${index}`]}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  {formErrors.items && (
                    <span className="rtr-error-message">
                      <FiAlertCircle /> {formErrors.items}
                    </span>
                  )}
                </div>

                {/* Overall return reason */}
                <div className="rtr-form-group">
                  <label htmlFor="reason" className="rtr-form-label">
                    Overall Return Category *
                  </label>
                  <select
                    id="reason"
                    name="reason"
                    className={`rtr-form-select ${formErrors.reason ? 'rtr-error' : ''}`}
                    value={formData.reason}
                    onChange={handleChange}
                  >
                    <option value="">Select a reason</option>
                    {RETURN_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {formErrors.reason && (
                    <span className="rtr-error-message">
                      <FiAlertCircle /> {formErrors.reason}
                    </span>
                  )}
                </div>

                {/* Description */}
                <div className="rtr-form-group">
                  <label htmlFor="description" className="rtr-form-label">Description *</label>
                  <p className="rtr-helper-text">
                    Provide a general description covering all items in this return.
                  </p>
                  <textarea
                    id="description"
                    name="description"
                    className={`rtr-form-textarea ${formErrors.description ? 'rtr-error' : ''}`}
                    value={formData.description}
                    onChange={handleChange}
                    rows={4}
                    maxLength={MAX_DESC_CHARS}
                    placeholder="Describe the issue(s) with your order…"
                  />
                  <div className="rtr-char-counter">
                    <span className={formData.description.length > MAX_DESC_CHARS - 100 ? 'rtr-char-warn' : ''}>
                      {formData.description.length}
                    </span>
                    /{MAX_DESC_CHARS}
                  </div>
                  {formErrors.description && (
                    <span className="rtr-error-message">
                      <FiAlertCircle /> {formErrors.description}
                    </span>
                  )}
                </div>

                {/* File upload */}
                <div className="rtr-form-group">
                  <label className="rtr-form-label">Supporting Documents (Optional)</label>
                  <p className="rtr-helper-text">
                    Upload up to {MAX_FILES} files (images, videos, or PDFs). Max 10 MB each.
                  </p>
                  <div className="rtr-file-upload-area">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov,.pdf"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      className="rtr-btn-upload"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={selectedFiles.length >= MAX_FILES}
                    >
                      <FiPaperclip /> Choose Files
                    </button>

                    {filePreviews.length > 0 && (
                      <div className="rtr-file-previews">
                        {filePreviews.map((item, index) => (
                          <div key={index} className="rtr-file-preview-item">
                            {ALLOWED_FILE_TYPES.images.includes(item.type) ? (
                              <img src={item.preview} alt={item.file.name} className="rtr-preview-image" />
                            ) : ALLOWED_FILE_TYPES.videos.includes(item.type) ? (
                              <div className="rtr-preview-placeholder"><FiVideo /></div>
                            ) : (
                              <div className="rtr-preview-placeholder"><FiFile /></div>
                            )}
                            <div className="rtr-file-info">
                              <span className="rtr-file-name">{item.file.name}</span>
                              <span className="rtr-file-size">
                                {(item.file.size / 1024 / 1024).toFixed(2)} MB
                              </span>
                            </div>
                            <button type="button" className="rtr-btn-remove-file" onClick={() => removeFile(index)}>
                              <FiX />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Policy notice (updated wording — no refund mention) ── */}
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

                {/* Actions */}
                <div className="rtr-form-actions">
                  <button
                    type="button"
                    onClick={() => navigate(backPath)}
                    className="rtr-btn-secondary"
                    disabled={loading || uploadLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rtr-btn-primary"
                    disabled={loading || uploadLoading}
                  >
                    {loading || uploadLoading ? (
                      <><FiClock className="rtr-spin" /> Submitting…</>
                    ) : (
                      <><FiSend /> Submit Return Request</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ── Cancel modal ── */}
      {showCancelModal && (
        <div className="rtr-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="rtr-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="rtr-modal-header">
              <h3>Cancel Return Request?</h3>
              <button onClick={() => setShowCancelModal(false)} className="rtr-modal-close">
                <FiX />
              </button>
            </div>
            <div className="rtr-modal-body">
              <p>Are you sure you want to cancel this return request? This action cannot be undone.</p>
            </div>
            <div className="rtr-modal-actions">
              <button
                onClick={() => setShowCancelModal(false)}
                className="rtr-btn-secondary"
                disabled={loading}
              >
                Keep Request
              </button>
              <button onClick={handleCancelReturn} className="rtr-btn-danger" disabled={loading}>
                {loading ? 'Cancelling…' : 'Yes, Cancel Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Return Messages modal ── */}
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