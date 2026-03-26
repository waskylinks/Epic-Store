import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { abandonCheckout, selectCheckoutId } from '../features/checkout/checkoutSlice';

/**
 * useCheckoutAbandonment
 *
 * Custom hook that detects when a user leaves a checkout page without
 * intentionally proceeding forward, and dispatches abandonCheckout.
 *
 * Usage:
 *   const { setIntentionalProceed } = useCheckoutAbandonment(checkoutId, 'shipping_info');
 *
 *   // Inside your "Continue" / "Proceed" handler, before navigate():
 *   setIntentionalProceed();
 *
 * How it works:
 *   - Registers a beforeunload listener (tab close / browser refresh).
 *   - On component unmount (navigation away), checks the intentional ref.
 *     If the user did NOT click a forward action, abandons the checkout.
 *   - If setIntentionalProceed() was called first, the abandon is suppressed.
 *
 * @param {string|null} checkoutId  - The active checkout _id from Redux.
 * @param {string}      currentStep - The step this page represents.
 *                                    Used for logging; the model records
 *                                    currentStep at the time of abandonment.
 */
const useCheckoutAbandonment = (checkoutId, currentStep) => {
  const dispatch            = useDispatch();
  const reduxCheckoutId     = useSelector(selectCheckoutId);

  // Prefer the explicitly passed checkoutId; fall back to Redux state.
  const resolvedCheckoutId  = checkoutId || reduxCheckoutId;

  /**
   * intentionalProceedRef
   *
   * Tracks whether the user clicked a forward action on this page.
   * Starts as false. Set to true via setIntentionalProceed() before
   * any navigate() call so the cleanup effect does not fire the abandon.
   *
   * A ref is used (not state) because:
   *   1. We never want a re-render when it flips.
   *   2. The cleanup function in useEffect closes over the ref object,
   *      so it always reads the latest .current value at teardown time.
   */
  const intentionalProceedRef = useRef(false);

  /**
   * setIntentionalProceed
   *
   * Call this inside your forward-navigation handler (handleSubmit,
   * proceedToPayment, handleStripeSuccess, etc.) BEFORE navigate().
   * Suppresses the abandon dispatch on unmount.
   */
  const setIntentionalProceed = () => {
    intentionalProceedRef.current = true;
  };

  useEffect(() => {
    // Nothing to track if there is no active session.
    if (!resolvedCheckoutId) return;

    // ── beforeunload: fires on tab close / browser refresh ──────────────
    // We can't reliably dispatch async thunks here because the browser
    // gives us only a few milliseconds. We use sendBeacon via the thunk
    // if available, or simply set the flag so the server-side cron handles
    // it. The primary abandonment signal is the unmount cleanup below.
    const handleBeforeUnload = (e) => {
      // Suppress if user is intentionally proceeding (e.g. form submit
      // that triggers a full-page reload on an older browser).
      if (intentionalProceedRef.current) return;

      // Standard cross-browser way to trigger the "leave page?" dialog.
      // Modern browsers ignore the custom message but still show the dialog.
      e.preventDefault();
      e.returnValue = '';

      // Best-effort fire-and-forget — browser may cancel it mid-flight.
      // The cron sweep is the authoritative abandonment signal.
      dispatch(abandonCheckout(resolvedCheckoutId));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // ── Cleanup: runs when the component unmounts ────────────────────────
    // This is the primary, reliable signal for SPA navigation away from
    // the checkout page (React Router replaces the component in the tree).
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (!intentionalProceedRef.current) {
        // User navigated away without clicking a forward action.
        // Could be: back button, sidebar link, logo click, etc.
        console.debug(
          `[useCheckoutAbandonment] Unmounting ${currentStep} without intentional proceed — dispatching abandon for checkout ${resolvedCheckoutId}`
        );
        dispatch(abandonCheckout(resolvedCheckoutId));
      } else {
        console.debug(
          `[useCheckoutAbandonment] Unmounting ${currentStep} with intentional proceed — abandon suppressed.`
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedCheckoutId]);
  // ↑ Intentionally omitting dispatch and currentStep from deps:
  //   dispatch is stable across renders (Redux guarantee).
  //   currentStep is a label only — changing it must not re-register
  //   the listener and reset intentionalProceedRef mid-session.

  return { setIntentionalProceed };
};

export default useCheckoutAbandonment;