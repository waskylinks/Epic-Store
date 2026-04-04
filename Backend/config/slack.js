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
 * The preference value is checked in cronAlert.js before building the payload.
 */

export function getSlackConfig() {
  return Object.freeze({
    webhookUrl: process.env.SLACK_WEBHOOK_URL ?? null,
    channel:    process.env.SLACK_CRON_CHANNEL ?? '#cron-alerts',
    botName:    process.env.SLACK_BOT_NAME     ?? 'Cron Monitor',
    botEmoji:   process.env.SLACK_BOT_EMOJI    ?? ':robot_face:',

    // Per-job alert preferences
    // Keys match the jobName strings used in runCronJob() calls
    jobPreferences: {
      AbandonmentSweep:   process.env.SLACK_PREF_ABANDONMENT_SWEEP   ?? 'fail-only',
      DiscountCleanup:    process.env.SLACK_PREF_DISCOUNT_CLEANUP     ?? 'fail-only',
      AuditCleanup:       process.env.SLACK_PREF_AUDIT_CLEANUP        ?? 'fail-only',
      RecoveryEmailCron:  process.env.SLACK_PREF_RECOVERY_EMAIL       ?? 'fail-only',
    },
  });
}