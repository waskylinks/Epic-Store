import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';

import PageTitle from '../components/PageTitle';
import Navbar from '../components/Navbar';
import Footer from '../components/footer';

import { redeemRecoveryToken, removeErrors, removeMessage } from '../features/checkout/checkoutSlice';
import { syncCartFromRecovery } from '../features/cart/cartSlice';

import '../CartStyles/RecoverCart.css';

// ─── Icons (inline SVG — no extra dep) ───────────────────────────────────────
const IconCart    = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);
const IconCheck   = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconExpired = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const IconBag     = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
);
const IconArrow   = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);

// ─── Phases: 'loading' | 'success' | 'expired' | 'invalid' | 'converted'

export default function RecoverCart() {
  const [searchParams]  = useSearchParams();
  const navigate         = useNavigate();
  const dispatch         = useDispatch();
  const token            = searchParams.get('token');

  const { recovery, error } = useSelector(s => s.checkout);

  const [phase, setPhase]               = useState('loading');
  const [unavailableItems, setUnavail]  = useState([]);
  const [restoredCart, setRestoredCart] = useState(null);
  const hasRun = useRef(false);

  // ── 1. Token redemption ───────────────────────────────────────────────────
  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    if (!token) {
      setPhase('invalid');
      return;
    }

    dispatch(redeemRecoveryToken(token))
      .unwrap()
      .then(data => {
        if (data.alreadyConverted) {
          setPhase('converted');
          return;
        }

        // Surface any unavailable items before redirecting
        if (data.checkout.unavailableItems?.length > 0) {
          setUnavail(data.checkout.unavailableItems);
          toast.warning(
            `${data.checkout.unavailableItems.length} item(s) are no longer available and were removed from your cart.`,
            { position: 'top-center', autoClose: 5000 }
          );
        }

        setRestoredCart(data.checkout);

        // Sync items back into the cart slice so OrderConfirm.jsx
        // can read them via cartDetails
        if (data.checkout.items?.length > 0) {
          dispatch(syncCartFromRecovery(data.checkout.items));
        }

        setPhase('success');
      })
      .catch(err => {
        // err comes from rejectWithValue: { message, status }
        const status = err?.status || recovery?.errorStatus;
        if (status === 410) {
          setPhase('expired');
        } else {
          setPhase('invalid');
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Clean up slice messages on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      dispatch(removeErrors());
      dispatch(removeMessage());
    };
  }, [dispatch]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (v, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(v || 0);

  const totalItems = restoredCart?.items?.reduce((s, i) => s + (i.quantity || 1), 0) || 0;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <PageTitle title="Recover Your Cart — Epic Store" />
      <Navbar />

      <div className="rcv-page">

        {/* ── LOADING ──────────────────────────────────────────────────── */}
        {phase === 'loading' && (
          <div className="rcv-center">
            <div className="rcv-spinner-wrap">
              <div className="rcv-icon-ring rcv-icon-ring--spin">
                <IconCart />
              </div>
              <h2 className="rcv-heading">Restoring your cart…</h2>
              <p className="rcv-sub">Just a moment while we retrieve your items.</p>
            </div>
          </div>
        )}

        {/* ── SUCCESS ──────────────────────────────────────────────────── */}
        {phase === 'success' && restoredCart && (
          <div className="rcv-center">
            <div className="rcv-card rcv-card--success">

              {/* tick animation */}
              <div className="rcv-icon-ring rcv-icon-ring--success">
                <IconCheck />
              </div>

              <h1 className="rcv-heading rcv-heading--lg">Your cart is back!</h1>
              <p className="rcv-sub">
                We've restored <strong>{totalItems} item{totalItems !== 1 ? 's' : ''}</strong> from your previous session.
              </p>

              {/* Unavailable items warning */}
              {unavailableItems.length > 0 && (
                <div className="rcv-warning-box">
                  <strong>Heads up:</strong> The following items are no longer available and were removed:
                  <ul className="rcv-warning-list">
                    {unavailableItems.map((item, i) => (
                      <li key={i}>{item.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cart summary */}
              <div className="rcv-summary">
                <div className="rcv-summary-row">
                  <span>Items</span>
                  <span>{totalItems}</span>
                </div>
                {restoredCart.pricing?.totalPrice > 0 && (
                  <div className="rcv-summary-row rcv-summary-row--total">
                    <span>Cart Total</span>
                    <span>{fmt(restoredCart.pricing.totalPrice, restoredCart.pricing.currency)}</span>
                  </div>
                )}
              </div>

              {/* CTA */}
              <button
                className="rcv-btn rcv-btn--primary"
                onClick={() => navigate('/order/confirm')}
              >
                Continue to Checkout
                <span className="rcv-btn-icon"><IconArrow /></span>
              </button>
            </div>
          </div>
        )}

        {/* ── ALREADY CONVERTED ────────────────────────────────────────── */}
        {phase === 'converted' && (
          <div className="rcv-center">
            <div className="rcv-card rcv-card--converted">
              <div className="rcv-icon-ring rcv-icon-ring--converted">
                <IconBag />
              </div>
              <h1 className="rcv-heading rcv-heading--lg">Order already placed!</h1>
              <p className="rcv-sub">
                This cart has already been completed. Your order is on its way.
              </p>
              <div className="rcv-btn-group">
                <button className="rcv-btn rcv-btn--primary" onClick={() => navigate('/orders/user')}>
                  View My Orders <span className="rcv-btn-icon"><IconArrow /></span>
                </button>
                <button className="rcv-btn rcv-btn--ghost" onClick={() => navigate('/products')}>
                  Continue Shopping
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── EXPIRED ──────────────────────────────────────────────────── */}
        {phase === 'expired' && (
          <div className="rcv-center">
            <div className="rcv-card rcv-card--error">
              <div className="rcv-icon-ring rcv-icon-ring--error">
                <IconExpired />
              </div>
              <h1 className="rcv-heading rcv-heading--lg">This link has expired</h1>
              <p className="rcv-sub">
                Recovery links are valid for <strong>72 hours</strong>. This one has passed its expiry.
              </p>
              <p className="rcv-hint">
                If you'd still like to complete your purchase, browse our store and rebuild your cart — it only takes a minute.
              </p>
              <div className="rcv-btn-group">
                <button className="rcv-btn rcv-btn--primary" onClick={() => navigate('/products')}>
                  Shop Now <span className="rcv-btn-icon"><IconArrow /></span>
                </button>
                <button className="rcv-btn rcv-btn--ghost" onClick={() => navigate('/')}>
                  Go Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── INVALID / GENERIC ERROR ───────────────────────────────────── */}
        {phase === 'invalid' && (
          <div className="rcv-center">
            <div className="rcv-card rcv-card--error">
              <div className="rcv-icon-ring rcv-icon-ring--error">
                <IconExpired />
              </div>
              <h1 className="rcv-heading rcv-heading--lg">Invalid recovery link</h1>
              <p className="rcv-sub">
                This link doesn't look right. It may have already been used or the URL may be incomplete.
              </p>
              <p className="rcv-hint">
                Check the email for the original link, or contact support if you continue to have issues.
              </p>
              <div className="rcv-btn-group">
                <button className="rcv-btn rcv-btn--primary" onClick={() => navigate('/products')}>
                  Start Shopping <span className="rcv-btn-icon"><IconArrow /></span>
                </button>
                <button className="rcv-btn rcv-btn--ghost" onClick={() => navigate('/')}>
                  Go Home
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      <Footer />
    </>
  );
}