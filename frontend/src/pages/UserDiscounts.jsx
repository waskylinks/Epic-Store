import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import {
  getActivePromos,
  getMyDiscounts,
  clearUserDiscountError,
} from '../features/discount/discountSlice';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';
import '../pageStyles/UserDiscounts.css';

// ── Copy hook ─────────────────────────────────────────────────────────────────
function useCopy() {
  const [copiedCode, setCopiedCode] = useState(null);
  const copy = useCallback((code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2200);
    });
  }, []);
  return { copiedCode, copy };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const getDaysUntil = (date) => {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / 86400000);
};

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-US', {
        month: 'short',
        day:   'numeric',
        year:  'numeric',
      })
    : '—';

const fmtCurrency = (n) =>
  typeof n === 'number' ? `$${n.toFixed(2)}` : '$0.00';

const getUrgency = (date) => {
  const days = getDaysUntil(date);
  if (days === null) return 'none';
  if (days < 0)      return 'expired';
  if (days <= 2)     return 'critical';
  if (days <= 7)     return 'warning';
  return 'safe';
};

const CATEGORY_META = {
  promo:     { label: 'Promo',     color: '#B45309', bg: '#FEF3C7' },
  refund:    { label: 'Refund',    color: '#B91C1C', bg: '#FEE2E2' },
  return:    { label: 'Return',    color: '#C2410C', bg: '#FFEDD5' },
  loyalty:   { label: 'Loyalty',   color: '#065F46', bg: '#D1FAE5' },
  affiliate: { label: 'Affiliate', color: '#5B21B6', bg: '#EDE9FE' },
  support:   { label: 'Support',   color: '#0369A1', bg: '#E0F2FE' },
};

// ── Countdown pill ────────────────────────────────────────────────────────────
const ExpiryPill = ({ validUntil }) => {
  const days    = getDaysUntil(validUntil);
  const urgency = getUrgency(validUntil);

  if (urgency === 'expired')
    return <span className="ud-expiry ud-expiry--expired">Expired</span>;
  if (days === null) return null;

  const label =
    days === 0 ? 'Expires today'
    : days === 1 ? 'Expires tomorrow'
    : `${days} days left`;

  return (
    <span className={`ud-expiry ud-expiry--${urgency}`}>
      {urgency === 'critical' && <span className="ud-expiry-dot" />}
      {label}
    </span>
  );
};

// ── Audience badge ─────────────────────────────────────────────────────────────
const AudienceBadge = ({ audience }) => {
  if (audience !== 'all') return null;
  return (
    <span className="ud-audience-badge" title="This discount is available to all customers">
      <svg
        width="10" height="10" viewBox="0 0 24 24"
        fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      Available to all
    </span>
  );
};

// ── Discount Card ─────────────────────────────────────────────────────────────
const DiscountCard = ({ discount, onCopy, copiedCode, onShopNow, index }) => {
  const isCopied  = copiedCode === discount.code;
  const urgency   = getUrgency(discount.validUntil);
  const isExpired = urgency === 'expired';
  const meta      = CATEGORY_META[discount.category] ?? CATEGORY_META.promo;

  const valueDisplay =
    discount.type === 'percentage'
      ? `${discount.value}%`
      : fmtCurrency(discount.value);

  return (
    <div
      className={`ud-card${isExpired ? ' ud-card--expired' : ''} ud-card--${urgency}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div
        className="ud-card-strip"
        style={{ background: isExpired ? '#E5E7EB' : meta.bg }}
      />

      <div className="ud-card-inner">
        <div className="ud-card-top">
          <div className="ud-card-top-left">
            <span
              className="ud-category-chip"
              style={{
                color:      isExpired ? '#9CA3AF' : meta.color,
                background: isExpired ? '#F3F4F6' : meta.bg,
              }}
            >
              {meta.label}
            </span>
            <AudienceBadge audience={discount.audience} />
            {discount.conditions?.firstOrderOnly && (
              <span className="ud-first-order-chip">First order</span>
            )}
          </div>
          <ExpiryPill validUntil={discount.validUntil} />
        </div>

        <div className={`ud-value${isExpired ? ' ud-value--expired' : ''}`}>
          <span className="ud-value-amount">{valueDisplay}</span>
          <span className="ud-value-label">off your order</span>
          
            {discount.type === 'fixed' && discount.remainingBalance != null && (
              <p className="ud-card-balance">
                ${Number(discount.remainingBalance).toFixed(2)} remaining of ${Number(discount.value).toFixed(2)}
              </p>
            )}
        </div>

        {discount.description && (
          <p className="ud-card-desc">{discount.description}</p>
        )}

        {discount.conditions?.minPurchaseAmount > 0 && (
          <p className="ud-card-condition">
            Min. spend {fmtCurrency(discount.conditions.minPurchaseAmount)}
          </p>
        )}
        {discount.conditions?.maxDiscountAmount &&
          discount.type === 'percentage' && (
            <p className="ud-card-condition">
              Up to {fmtCurrency(discount.conditions.maxDiscountAmount)} discount
            </p>
          )}

        <div className="ud-card-footer">
          <div className="ud-code-box">
            <span className="ud-code">{discount.code}</span>
            <button
              type="button"
              className={`ud-copy-btn${isCopied ? ' ud-copy-btn--done' : ''}`}
              onClick={() => !isExpired && onCopy(discount.code)}
              disabled={isExpired}
              aria-label={isCopied ? 'Copied!' : `Copy code ${discount.code}`}
            >
              {isCopied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="3"
                  strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              <span>{isCopied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
          {!isExpired && (
            <button
              type="button"
              className="ud-shop-btn"
              onClick={() => onShopNow(discount.code)}
              aria-label="Shop now and apply this discount"
            >
              Shop now →
            </button>
          )}
        </div>

        {!isExpired && discount.validUntil && (
          <p className="ud-valid-until">
            Valid until {fmtDate(discount.validUntil)}
          </p>
        )}
      </div>
    </div>
  );
};

// ── Skeleton card ─────────────────────────────────────────────────────────────
const SkeletonCard = ({ index }) => (
  <div
    className="ud-card ud-card--skeleton"
    style={{ animationDelay: `${index * 80}ms` }}
  >
    <div className="ud-card-strip" style={{ background: '#F3F4F6' }} />
    <div className="ud-card-inner">
      <div className="ud-skel" style={{ width: 64,    height: 20, marginBottom: 16 }} />
      <div className="ud-skel" style={{ width: '40%', height: 36, marginBottom: 8  }} />
      <div className="ud-skel" style={{ width: '75%', height: 14, marginBottom: 6  }} />
      <div className="ud-skel" style={{ width: '55%', height: 12, marginBottom: 20 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="ud-skel" style={{ flex: 1,   height: 38 }} />
        <div className="ud-skel" style={{ width: 88, height: 38 }} />
      </div>
    </div>
  </div>
);

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState = ({ type }) => (
  <div className="ud-empty">
    <div className="ud-empty-icon">
      {type === 'personal' ? (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12V22H4V12" />
          <path d="M22 7H2v5h20V7z" />
          <path d="M12 22V7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      ) : (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14l-5-5 5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      )}
    </div>
    <h3 className="ud-empty-title">
      {type === 'personal'
        ? 'No personal discounts yet'
        : 'No active promos right now'}
    </h3>
    <p className="ud-empty-desc">
      {type === 'personal'
        ? 'Personal discount codes from returns or loyalty rewards will appear here.'
        : 'Check back soon — we regularly add new promotional offers.'}
    </p>
    {type === 'personal' && (
      <Link to="/orders/user" className="ud-empty-link">
        View my orders →
      </Link>
    )}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────
const UserDiscounts = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const {
    broadcastDiscounts,
    personalDiscounts,
    activePromos,
    myDiscountsLoading,
    promosLoading,
    error,
  } = useSelector((state) => state.userDiscount);

  const { copiedCode, copy } = useCopy();

  const [activeTab,    setActiveTab]    = useState('personal');
  const [codeInput,    setCodeInput]    = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  // Local checker result — searched client-side from already-loaded discounts.
  // No network call: avoids triggering recordUsage outside of checkout.
  const [checkerResult, setCheckerResult] = useState(null); // discount object | 'not-found' | null

  useEffect(() => {
    dispatch(getMyDiscounts());
    dispatch(getActivePromos());
    return () => {
      dispatch(clearUserDiscountError());
    };
  }, [dispatch]);

  // Reset checker when input clears.
  useEffect(() => {
    if (!codeInput) setCheckerResult(null);
  }, [codeInput]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  // FIX: allLoaded includes broadcastDiscounts so the checker finds broadcast codes.
  // Previously broadcastDiscounts was populated in Redux but never merged here,
  // causing broadcast codes to always return "not found" in the checker.
  const allLoaded = useMemo(
    () => [...broadcastDiscounts, ...personalDiscounts, ...(activePromos ?? [])],
    [broadcastDiscounts, personalDiscounts, activePromos]
  );

  const handleCheck = useCallback(() => {
    const trimmed = codeInput.trim().toUpperCase();
    if (!trimmed) return;
    const match = allLoaded.find((d) => d.code === trimmed);
    setCheckerResult(match ?? 'not-found');
  }, [codeInput, allLoaded]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCheck();
  };

  const handleShopNow = useCallback((code) => {
    navigate('/shop', { state: { applyCode: code } });
  }, [navigate]);

  const handleApplyFound = useCallback((code) => {
    navigate('/cart', { state: { applyCode: code } });
  }, [navigate]);


  const { activePersonal, expiredPersonal } = useMemo(() => {
    const all = [...broadcastDiscounts, ...personalDiscounts];
    const active = all.filter(
      (d) => getUrgency(d.validUntil) !== 'expired' && d.status !== 'inactive'
    );
    const expired = all.filter(
      (d) => getUrgency(d.validUntil) === 'expired' || d.status === 'inactive'
    );
    return { activePersonal: active, expiredPersonal: expired };
  }, [broadcastDiscounts, personalDiscounts]);

  const totalActive = activePersonal.length;

  const checkerIsFound   = checkerResult && checkerResult !== 'not-found';
  const checkerIsExpired = checkerIsFound && getUrgency(checkerResult.validUntil) === 'expired';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div className="ud-page">

        {/* ── Hero band ───────────────────────────────────────────────── */}
        <div className="ud-hero">
          <div className="ud-hero-inner">
            <div className="ud-hero-text">
              <div className="ud-hero-eyebrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                My Discounts
              </div>
              <h1 className="ud-hero-title">
                Your savings,<br />all in one place
              </h1>
              <p className="ud-hero-sub">
                {totalActive > 0
                  ? `You have ${totalActive} active discount${totalActive !== 1 ? 's' : ''} ready to use`
                  : 'Manage and apply your discount codes at checkout'}
              </p>
            </div>

            {/* ── Check a code ──────────────────────────────────────── */}
            <div className="ud-checker">
              <p className="ud-checker-label">Check a discount code</p>
              <div
                className={[
                  'ud-checker-input-wrap',
                  inputFocused  ? 'ud-checker-input-wrap--focused'  : '',
                  checkerResult === 'not-found'
                                ? 'ud-checker-input-wrap--error'    : '',
                  checkerIsFound && !checkerIsExpired
                                ? 'ud-checker-input-wrap--success'  : '',
                ].filter(Boolean).join(' ')}
              >
                <svg className="ud-checker-icon" width="16" height="16"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                <input
                  type="text"
                  className="ud-checker-input"
                  placeholder="Enter code e.g. SAVE20"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value.toUpperCase());
                    setCheckerResult(null);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setInputFocused(true)}
                  onBlur={()  => setInputFocused(false)}
                  aria-label="Enter discount code to check"
                  maxLength={40}
                />
                {codeInput && (
                  <button
                    type="button"
                    className="ud-checker-clear"
                    onClick={() => {
                      setCodeInput('');
                      setCheckerResult(null);
                    }}
                    aria-label="Clear"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6"  x2="6"  y2="18" />
                      <line x1="6"  y1="6"  x2="18" y2="18" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  className="ud-checker-btn"
                  onClick={handleCheck}
                  disabled={!codeInput.trim()}
                  aria-label="Check code"
                >
                  Check
                </button>
              </div>

              {/* Checker result */}
              {checkerResult === 'not-found' && (
                <div className="ud-checker-result ud-checker-result--error" role="alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8"  x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Code not found in your discounts
                </div>
              )}

              {checkerIsFound && checkerIsExpired && (
                <div className="ud-checker-result ud-checker-result--error" role="alert">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8"  x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  This code has expired
                </div>
              )}

              {checkerIsFound && !checkerIsExpired && (
                <div className="ud-checker-result ud-checker-result--success" role="status">
                  <div className="ud-checker-success-row">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <div>
                      <span className="ud-checker-success-label">Valid code</span>
                      <span className="ud-checker-success-value">
                        {checkerResult.type === 'percentage'
                          ? `${checkerResult.value}% off`
                          : fmtCurrency(checkerResult.value) + ' off'}
                      </span>
                      {checkerResult.description && (
                        <span className="ud-checker-success-desc">
                          {checkerResult.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ud-checker-apply-btn"
                    onClick={() => handleApplyFound(checkerResult.code)}
                  >
                    Apply to cart →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="ud-body">

          {/* Tab bar */}
          <div className="ud-tabs-wrap">
            <div className="ud-tabs">
              <button
                type="button"
                className={`ud-tab${activeTab === 'personal' ? ' ud-tab--active' : ''}`}
                onClick={() => setActiveTab('personal')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                My Discounts
                {activePersonal.length > 0 && (
                  <span className="ud-tab-count">{activePersonal.length}</span>
                )}
              </button>
              <button
                type="button"
                className={`ud-tab${activeTab === 'promos' ? ' ud-tab--active' : ''}`}
                onClick={() => setActiveTab('promos')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14l-5-5 5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </svg>
                Current Promos
                {(activePromos?.length ?? 0) > 0 && (
                  <span className="ud-tab-count ud-tab-count--promo">
                    {activePromos.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* General error */}
          {error && (
            <div className="ud-alert ud-alert--error" role="alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8"  x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* ── PERSONAL TAB ─────────────────────────────────────────── */}
          {activeTab === 'personal' && (
            <>
              {myDiscountsLoading ? (
                <div className="ud-grid">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <SkeletonCard key={i} index={i} />
                  ))}
                </div>
              ) : activePersonal.length === 0 && expiredPersonal.length === 0 ? (
                <EmptyState type="personal" />
              ) : (
                <>
                  {activePersonal.length > 0 && (
                    <>
                      <div className="ud-section-hd">
                        <span className="ud-section-title">Ready to use</span>
                        <span className="ud-section-count">{activePersonal.length}</span>
                      </div>
                      <div className="ud-grid">
                        {activePersonal.map((d, i) => (
                          <DiscountCard
                            key={d._id ?? d.code}
                            discount={d}
                            onCopy={copy}
                            copiedCode={copiedCode}
                            onShopNow={handleShopNow}
                            index={i}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {expiredPersonal.length > 0 && (
                    <>
                      <div className="ud-section-hd ud-section-hd--muted">
                        <span className="ud-section-title">Expired</span>
                        <span className="ud-section-count ud-section-count--muted">
                          {expiredPersonal.length}
                        </span>
                      </div>
                      <div className="ud-grid ud-grid--faded">
                        {expiredPersonal.map((d, i) => (
                          <DiscountCard
                            key={d._id ?? d.code}
                            discount={d}
                            onCopy={copy}
                            copiedCode={copiedCode}
                            onShopNow={handleShopNow}
                            index={i}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ── PROMOS TAB ───────────────────────────────────────────── */}
          {activeTab === 'promos' && (
            <>
              {promosLoading ? (
                <div className="ud-grid">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonCard key={i} index={i} />
                  ))}
                </div>
              ) : (activePromos?.length ?? 0) === 0 ? (
                <EmptyState type="promos" />
              ) : (
                <>
                  <div className="ud-section-hd">
                    <span className="ud-section-title">Available now</span>
                    <span className="ud-section-count">{activePromos.length}</span>
                  </div>
                  <div className="ud-grid">
                    {activePromos.map((d, i) => (
                      <DiscountCard
                        key={d._id ?? d.code}
                        discount={d}
                        onCopy={copy}
                        copiedCode={copiedCode}
                        onShopNow={handleShopNow}
                        index={i}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── How to use ───────────────────────────────────────────── */}
          <div className="ud-how">
            <h2 className="ud-how-title">How to use a discount</h2>
            <div className="ud-how-steps">
              {[
                {
                  n:     '1',
                  title: 'Copy your code',
                  desc:  'Click the copy button on any active discount card above.',
                },
                {
                  n:     '2',
                  title: 'Add items to cart',
                  desc:  'Browse the store and add your favourite items to the cart.',
                },
                {
                  n:     '3',
                  title: 'Apply at checkout',
                  desc:  'Paste the code in the discount field before placing your order.',
                },
              ].map((step) => (
                <div key={step.n} className="ud-how-step">
                  <div className="ud-how-num">{step.n}</div>
                  <div>
                    <h3 className="ud-how-step-title">{step.title}</h3>
                    <p className="ud-how-step-desc">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
      <Footer />
    </>
  );
};

export default UserDiscounts;