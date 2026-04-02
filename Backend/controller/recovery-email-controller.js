import handleAsyncError from '../middleware/handleAsyncError.js';
import HandleError from '../utils/handleError.js';
import Checkout from '../models/checkout-model.js';
import { sendRecoveryEmail, sendBulkRecoveryEmails } from '../Services/recoveryEmailService.js';

// ============================================
// SEND SINGLE RECOVERY EMAIL
// @route  POST /api/v1/admin/checkout/:id/send-recovery
// @access Admin | SuperAdmin
// ============================================

export const sendSingleRecoveryEmail = handleAsyncError(async (req, res, next) => {
  const { id } = req.params;

  // ── 1. Load the checkout with all fields the service and template need ────
  const checkout = await Checkout.findById(id)
    .populate('user',          'firstName lastName email')
    .populate('items.product', 'name images pricing status');

  if (!checkout) {
    return next(new HandleError('Checkout not found', 404));
  }

  // ── 2. Early guard — controller-level checks before touching the service ──

  // Deleted user — populate returns null for the ref doc
  if (!checkout.user || typeof checkout.user !== 'object') {
    return next(
      new HandleError(
        'The account associated with this checkout no longer exists', 400
      )
    );
  }

  if (checkout.conversion?.isConverted) {
    return next(new HandleError('This checkout has already been converted to an order', 400));
  }

  if (checkout.abandonment?.recovered) {
    return next(new HandleError('This checkout has already been recovered', 400));
  }

  // ── 3. Delegate to service — service owns the full send sequence ──────────
  // We do NOT call canSendRecoveryEmail() here deliberately — the service
  // is the authoritative check. Calling it twice in the controller would
  // create a confusing double-message if the reasons differ (e.g. the
  // cooldown elapsed between the two checks).
  //
  // The service throws with err.code === 'SKIPPED' for expected non-error
  // conditions (cooldown, max attempts, etc.) and plain errors for failures.

  let result;

  try {
    result = await sendRecoveryEmail(checkout);
  } catch (err) {
    // SKIPPED = expected business-logic gate (cooldown, max attempts, etc.)
    // Surface as 400 with the exact reason so the admin UI can display it
    // inline on the row without treating it as a system failure.
    if (err.code === 'SKIPPED') {
      return res.status(400).json({
        success: false,
        skipped: true,
        reason:  err.message,
      });
    }

    // Unexpected failure (provider down, DB error, FRONTEND_URL missing, etc.)
    // Log for ops visibility, return structured 500 so the frontend can
    // show a retry option on the row rather than a generic crash.
    console.error(
      `[recoveryEmailController] Single send failed for checkout ${id}:`,
      err.message
    );

    return res.status(500).json({
      success: false,
      error:   err.message,
    });
  }

  // ── 4. Success response ───────────────────────────────────────────────────
  return res.status(200).json({
    success:    true,
    message:    `Recovery email #${result.attempt} sent successfully`,
    emailCount: result.emailCount,    // updated count — for row display
    sentAt:     result.sentAt,        // timestamp — for row display
    recipient:  result.recipient,
    attempt:    result.attempt,
    messageId:  result.messageId,     // provider message ID — for debugging
    accepted:   result.accepted,      // provider-confirmed addresses
  });
});

// ============================================
// SEND BULK RECOVERY EMAILS
// @route  POST /api/v1/admin/checkout/bulk-send-recovery
// @access Admin | SuperAdmin
//
// NOTE: This route MUST be registered BEFORE /:id/send-recovery
// in the router file, otherwise Express matches 'bulk-send-recovery'
// as an :id param. Same pattern as GET /recover before GET /:id
// in the checkout router.
// ============================================

export const sendBulkRecoveryEmailsController = handleAsyncError(async (req, res, next) => {
  const { checkoutIds } = req.body;

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (!checkoutIds || !Array.isArray(checkoutIds)) {
    return next(new HandleError('checkoutIds must be an array', 400));
  }

  if (checkoutIds.length === 0) {
    return next(new HandleError('checkoutIds array is empty', 400));
  }

  // Hard cap enforced here AND inside the service.
  // Two layers: the controller returns early with a clear message before
  // the service even starts processing, keeping the error fast and cheap.
  if (checkoutIds.length > 100) {
    return next(
      new HandleError(
        `Cannot process more than 100 checkouts per request. Received ${checkoutIds.length}.`,
        400
      )
    );
  }

  // Basic ID format check — catches obviously malformed IDs before hitting
  // MongoDB. Not an exhaustive ObjectId validation; Mongoose will reject
  // truly invalid IDs at query time and those land in the failed[] array.
  const invalidIds = checkoutIds.filter(
    id => typeof id !== 'string' || id.trim().length === 0
  );

  if (invalidIds.length > 0) {
    return next(
      new HandleError(
        `${invalidIds.length} invalid ID(s) in checkoutIds — must be non-empty strings`,
        400
      )
    );
  }

  // ── 2. Admin identity for audit logging ───────────────────────────────────
  const triggeredBy = req.user?._id?.toString() || 'unknown';

  console.log(
    `[recoveryEmailController] Bulk send initiated`,
    `| Admin: ${triggeredBy}`,
    `| IDs: ${checkoutIds.length}`,
    `| Time: ${new Date().toISOString()}`
  );

  // ── 3. Delegate to service ────────────────────────────────────────────────
  // sendBulkRecoveryEmails never throws — it always resolves with a
  // results object. Failures per-checkout are captured inside failed[].
  // The only reason this would throw is a programming error (wrong arg type),
  // which is caught by handleAsyncError and sent to the global error handler.
  const results = await sendBulkRecoveryEmails(checkoutIds);

  // ── 4. Logging ────────────────────────────────────────────────────────────
  console.log(
    `[recoveryEmailController] Bulk send completed`,
    `| Admin: ${triggeredBy}`,
    `| Sent: ${results.summary.sent}`,
    `| Skipped: ${results.summary.skipped}`,
    `| Failed: ${results.summary.failed}`,
    `| Time: ${new Date().toISOString()}`
  );

  if (results.summary.failed > 0) {
    console.error(
      `[recoveryEmailController] ${results.summary.failed} failure(s) in bulk send:`,
      results.failed.map(f => `${f.id}: ${f.error}`).join(' | ')
    );
  }

  // ── 5. Response ───────────────────────────────────────────────────────────
  // Always 200 — the bulk operation itself succeeded even if individual
  // sends failed. The frontend reads results.summary to determine how to
  // display the outcome. A 500 from this endpoint means the endpoint
  // itself crashed, not that individual sends failed.
  return res.status(200).json({
    success: true,
    message: buildSummaryMessage(results.summary),
    results: {
      sent:    results.sent,
      skipped: results.skipped,
      failed:  results.failed,
    },
    summary: results.summary,
  });
});

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Build a human-readable summary message for the bulk send response.
 * Shown directly in the admin UI after the operation completes.
 */
const buildSummaryMessage = ({ sent, skipped, failed }) => {
  const parts = [];

  if (sent > 0)    parts.push(`${sent} email${sent     === 1 ? '' : 's'} sent`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0)  parts.push(`${failed} failed`);

  if (parts.length === 0) return 'No emails processed';

  const base = parts.join(', ');

  if (failed > 0)  return `${base} — check failed entries and retry`;
  if (skipped > 0 && sent === 0) return `${base} — all eligible checkouts already processed`;

  return base;
};

export default {
  sendSingleRecoveryEmail,
  sendBulkRecoveryEmailsController,
};