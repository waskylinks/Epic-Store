import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { abandonCheckout, selectCheckoutId } from '../features/checkout/checkoutSlice';

const useCheckoutAbandonment = (checkoutId, currentStep) => {
  const dispatch           = useDispatch();
  const reduxCheckoutId    = useSelector(selectCheckoutId);
  const resolvedCheckoutId = checkoutId || reduxCheckoutId;

  const intentionalProceedRef = useRef(false);

  const ABANDON_GRACE_MS = 800;
  const abandonTimerRef = useRef(null);

  const setIntentionalProceed = useCallback(() => {
    intentionalProceedRef.current = true;
    // Also clear any pending abandon timer that may have started
    if (abandonTimerRef.current) {
      clearTimeout(abandonTimerRef.current);
      abandonTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!resolvedCheckoutId) return;

    // Reset intentional flag when the checkout ID changes (new session)
    intentionalProceedRef.current = false;

    const handleBeforeUnload = (e) => {
      if (intentionalProceedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
      dispatch(abandonCheckout(resolvedCheckoutId));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (!intentionalProceedRef.current) {
        abandonTimerRef.current = setTimeout(() => {
          if (!intentionalProceedRef.current) {
            console.debug(
              `[useCheckoutAbandonment] Grace period elapsed — abandoning checkout ${resolvedCheckoutId} at step ${currentStep}`
            );
            dispatch(abandonCheckout(resolvedCheckoutId));
          }
        }, ABANDON_GRACE_MS);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedCheckoutId]);

  // Clean up the timer if the component unmounts for any reason
  useEffect(() => {
    return () => {
      if (abandonTimerRef.current) {
        clearTimeout(abandonTimerRef.current);
      }
    };
  }, []);

  return { setIntentionalProceed };
};

export default useCheckoutAbandonment;