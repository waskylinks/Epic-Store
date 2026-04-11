import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { abandonCheckout, selectCheckoutId } from '../features/checkout/checkoutSlice';

const ABANDON_GRACE_MS = 800;

const useCheckoutAbandonment = (checkoutId, currentStep) => {
  const dispatch           = useDispatch();
  const reduxCheckoutId    = useSelector(selectCheckoutId);
  const resolvedCheckoutId = checkoutId || reduxCheckoutId;

  const intentionalProceedRef = useRef(false);
  const abandonTimerRef       = useRef(null);

  // Capture latest currentStep in a ref so the grace-period callback always
  // logs the real step even though it runs after render.
  const currentStepRef = useRef(currentStep);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  const setIntentionalProceed = useCallback(() => {
    intentionalProceedRef.current = true;
    if (abandonTimerRef.current) {
      clearTimeout(abandonTimerRef.current);
      abandonTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!resolvedCheckoutId) return;

    // FIX: reset intentional flag INSIDE the effect, not as a side-effect of
    // the dep change. The previous version reset it at the top of the effect
    // body, which ran AFTER the cleanup of the previous effect — meaning the
    // old cleanup fired with intentionalProceedRef.current = false and
    // incorrectly dispatched abandon when the user navigated between steps.
    // Resetting here (at effect start) guarantees the NEW effect's flag is
    // clean while the OLD effect's cleanup still sees the flag the user set.
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
        // FIX: capture values for the closure at cleanup time, not at render
        // time, so the timer always has the correct id and step.
        const idAtCleanup   = resolvedCheckoutId;
        const stepAtCleanup = currentStepRef.current;

        abandonTimerRef.current = setTimeout(() => {
          if (!intentionalProceedRef.current) {
            console.debug(
              `[useCheckoutAbandonment] Grace period elapsed — abandoning checkout ${idAtCleanup} at step ${stepAtCleanup}`
            );
            dispatch(abandonCheckout(idAtCleanup));
          }
        }, ABANDON_GRACE_MS);
      }
    };
  }, [resolvedCheckoutId, dispatch]);

  // Global timer cleanup on unmount
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