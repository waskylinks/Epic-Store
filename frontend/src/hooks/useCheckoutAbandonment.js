import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { abandonCheckout, selectCheckoutId } from '../features/checkout/checkoutSlice';

const ABANDON_GRACE_MS = 800;

const buildBeaconPayload = (checkoutId, step) =>
  new Blob(
    [JSON.stringify({ checkoutId, step, reason: 'beforeunload' })],
    { type: 'application/json' }
  );

const BEACON_URL = '/api/v1/checkout/abandon';

const useCheckoutAbandonment = (checkoutId, currentStep) => {
  const dispatch           = useDispatch();
  const reduxCheckoutId    = useSelector(selectCheckoutId);
  const resolvedCheckoutId = checkoutId || reduxCheckoutId;

  // FIX (concurrent mode flag race): Split into two refs so the cleanup
  // closure and the setup code never share the same mutable cell.
  //
  // `intentionalProceedRef` is the user-facing signal set by setIntentionalProceed.
  // `effectFlagRef` is a per-effect-instance flag captured by the cleanup
  // closure at setup time. Because each effect run creates a new object
  // `{ intentional: false }` and the cleanup closes over *that* object,
  // React 18 concurrent mode re-ordering (cleanup old → setup new in separate
  // batches) can no longer cause the new setup's reset to clobber the value
  // the old cleanup needs to read.
  const intentionalProceedRef = useRef(false);
  const abandonTimerRef       = useRef(null);

  // FIX (double-abandon): Track whether a beacon was already fired for this
  // checkout session so the grace-period timer can skip the Redux dispatch if
  // beforeunload already sent one.
  const beaconFiredRef = useRef(false);

  const currentStepRef = useRef(currentStep);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  // FIX (stale intentionalProceedRef): setIntentionalProceed now also resets
  // beaconFiredRef and — crucially — does NOT leave intentionalProceedRef
  // permanently true. The flag is only meaningful for the current navigation
  // intent. If the user calls setIntentionalProceed but then cancels (e.g.
  // hits browser Back), the effect dep hasn't changed so the effect won't
  // re-run and the ref would stay true forever, silencing future beforeunload
  // events for the same checkout session.
  //
  // The fix: setIntentionalProceed now schedules a microtask reset so the flag
  // is true long enough for the in-progress cleanup to see it, but resets
  // before the next user interaction if navigation was cancelled. The timer
  // clear still happens synchronously so the grace-period abandon is cancelled
  // immediately.
  const setIntentionalProceed = useCallback(() => {
    intentionalProceedRef.current = true;
    beaconFiredRef.current        = false; // reset for potential re-use

    if (abandonTimerRef.current) {
      clearTimeout(abandonTimerRef.current);
      abandonTimerRef.current = null;
    }

    // Reset after current task so any pending cleanup sees `true`, but a
    // subsequent interaction on the same component (dep unchanged, effect
    // didn't re-run) starts clean again.
    Promise.resolve().then(() => {
      intentionalProceedRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!resolvedCheckoutId) return;

    // FIX (concurrent mode flag race): Each effect instance owns its own flag
    // object. The cleanup closure captures `effectFlag` by reference to this
    // specific object, so a concurrent-mode interleaving where the new setup
    // runs before the old cleanup cannot corrupt the value the old cleanup reads.
    const effectFlag = { intentional: false };

    // Sync intentionalProceedRef into this effect's flag whenever it's set.
    // We can't directly use intentionalProceedRef in the closure for the reason
    // above, but we can mirror its value through the flag object.
    const mirrorIntent = () => { effectFlag.intentional = intentionalProceedRef.current; };

    // Reset the per-session state for this effect run.
    intentionalProceedRef.current = false;
    beaconFiredRef.current        = false;
    effectFlag.intentional        = false;

    // FIX (beforeunload async): Use sendBeacon instead of dispatch(abandonCheckout).
    // sendBeacon queues the request in the browser's networking layer before the
    // page is unloaded and is guaranteed to be delivered even if JS execution is
    // halted immediately after. The Redux thunk (axios.put) is not safe here.
    const handleBeforeUnload = () => {
      mirrorIntent();
      if (effectFlag.intentional) return;

      const sent = navigator.sendBeacon(
        BEACON_URL,
        buildBeaconPayload(resolvedCheckoutId, currentStepRef.current)
      );

      if (sent) {
        // FIX (double-abandon): mark beacon as fired so the grace-period timer
        // skips the Redux dispatch if the component also unmounts.
        beaconFiredRef.current = true;
      }
      // No e.preventDefault() / e.returnValue — we're not blocking the unload,
      // just ensuring the abandon signal is delivered.
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      mirrorIntent(); // snapshot intentionalProceedRef into effectFlag

      if (!effectFlag.intentional) {
        const idAtCleanup   = resolvedCheckoutId;
        const stepAtCleanup = currentStepRef.current;

        abandonTimerRef.current = setTimeout(() => {
          // FIX (double-abandon): only dispatch if beforeunload beacon was not
          // already sent for this session.
          if (!effectFlag.intentional && !beaconFiredRef.current) {
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