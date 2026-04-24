/**
 * config/slack.js
 *
 * Slack alert configuration for cron job monitoring.
 *
 * jobPreferences controls per-job alert verbosity:
 *   'fail-only'  — alert only when the job fails or hits a warning threshold
 *   'all'        — alert on success and failure
 *   'none'       — never alert for this job
 *
 * EDIT SUMMARY (vs previous version):
 *   - Added CheckoutRetention to jobPreferences driven by
 *     SLACK_PREF_CHECKOUT_RETENTION env var, defaulting to 'fail-only'.
 *     CheckoutRetention runs monthly so success noise would be low-value;
 *     fail-only is the correct default. Admins can set 'all' if they want
 *     a monthly confirmation that the job ran cleanly.
 */

export function getSlackConfig() {
  return Object.freeze({
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? null,

    botName:  process.env.SLACK_BOT_NAME  ?? 'Cron Monitor',
    botEmoji: process.env.SLACK_BOT_EMOJI ?? ':robot_face:',

    jobPreferences: {
      AbandonmentSweep:  process.env.SLACK_PREF_ABANDONMENT_SWEEP  ?? 'fail-only',
      DiscountCleanup:   process.env.SLACK_PREF_DISCOUNT_CLEANUP   ?? 'fail-only',
      AuditCleanup:      process.env.SLACK_PREF_AUDIT_CLEANUP      ?? 'fail-only',
      RecoveryEmailCron: process.env.SLACK_PREF_RECOVERY_EMAIL     ?? 'fail-only',
      CheckoutRetention: process.env.SLACK_PREF_CHECKOUT_RETENTION ?? 'fail-only',
    },
  });
}