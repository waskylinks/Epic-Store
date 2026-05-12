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
 *
 *   - Added RecoveryEmailRetention to jobPreferences driven by
 *     SLACK_PREF_RECOVERY_EMAIL_RETENTION env var, defaulting to 'fail-only'.
 *     Same rationale as CheckoutRetention — monthly schedule means success
 *     alerts are low-value noise. Admins who want monthly confirmation can
 *     set SLACK_PREF_RECOVERY_EMAIL_RETENTION=all in their environment.
 *
 *   - Added AnalyticsQueue to jobPreferences driven by
 *     SLACK_PREF_ANALYTICS_QUEUE env var, defaulting to 'fail-only'.
 *     AnalyticsQueue runs every 60 seconds — alerting on every successful
 *     sweep would be extreme noise. fail-only ensures dead_letter promotions
 *     and sweep errors surface in Slack while healthy runs stay silent.
 *     The dead_letter path already calls sendCronAlert directly from
 *     analyticsQueue.js; this preference gate ensures the job-level alert
 *     from runCronJob follows the same policy.
 */

export function getSlackConfig() {
  return Object.freeze({
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? null,

    botName:  process.env.SLACK_BOT_NAME  ?? 'Cron Monitor',
    botEmoji: process.env.SLACK_BOT_EMOJI ?? ':robot_face:',

    jobPreferences: {
      AbandonmentSweep:        process.env.SLACK_PREF_ABANDONMENT_SWEEP          ?? 'fail-only',
      DiscountCleanup:         process.env.SLACK_PREF_DISCOUNT_CLEANUP           ?? 'fail-only',
      AuditCleanup:            process.env.SLACK_PREF_AUDIT_CLEANUP              ?? 'fail-only',
      RecoveryEmailCron:       process.env.SLACK_PREF_RECOVERY_EMAIL             ?? 'fail-only',
      CheckoutRetention:       process.env.SLACK_PREF_CHECKOUT_RETENTION         ?? 'fail-only',
      RecoveryEmailRetention:  process.env.SLACK_PREF_RECOVERY_EMAIL_RETENTION   ?? 'fail-only',
      AnalyticsQueue:          process.env.SLACK_PREF_ANALYTICS_QUEUE            ?? 'fail-only',
    },
  });
}