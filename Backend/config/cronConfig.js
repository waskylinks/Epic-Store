/**
 * config/cronConfig.js
 *
 * Single source of truth for every cron-related environment variable.
 *
 * Previously these were scattered across four job files, each doing its own
 * process.env reads with inconsistent fallbacks. This file centralises them
 * all into one frozen config object that is imported by job files and the
 * cron registry.
 *
 * Import pattern in job files:
 *   import { cronConfig } from '../config/cronConfig.js';
 *   const schedule = cronConfig.auditCleanup.cronExpression;
 */

const env = (key, fallback) => process.env[key] ?? fallback;
const int = (key, fallback) => parseInt(process.env[key] ?? fallback, 10);
const flt = (key, fallback) => parseFloat(process.env[key] ?? fallback);
const boo = (key)           => process.env[key] === 'true';

export const cronConfig = Object.freeze({

  // ── Abandonment Sweep ────────────────────────────────────────────────────
  abandonmentSweep: {
    scheduleProduction:  env('ABANDONMENT_SWEEP_CRON_PRODUCTION',  '0,30 * * * *'),
    scheduleDevelopment: env('ABANDONMENT_SWEEP_CRON_DEVELOPMENT', '*/5 * * * *'),
    errorAlertThreshold: int('SWEEP_ERROR_ALERT_THRESHOLD', 5),
  },

  // ── Discount Cleanup ─────────────────────────────────────────────────────
  discountCleanup: {
    cronExpression: env('CLEANUP_CRON',             '0 2 * * *'),
    hardDeleteDays: int('HARD_DELETE_AFTER_DAYS',   90),
    batchSize:      int('CLEANUP_BATCH_SIZE',        1000),
  },

  // ── Audit Log Cleanup ────────────────────────────────────────────────────
  auditCleanup: {
    cronExpression: env('AUDIT_CLEANUP_CRON',        '0 3 * * *'),
    retentionDays:  int('AUDIT_RETENTION_DAYS',      365),
    graceDays:      int('AUDIT_GRACE_DAYS',          30),
    batchSize:      int('CLEANUP_BATCH_SIZE',        1000),
  },

  // ── Recovery Email Cron ──────────────────────────────────────────────────
  recoveryEmail: {
    enabled:        env('RECOVERY_CRON_ENABLED',     'true') !== 'false',
    schedule:       env('RECOVERY_CRON_SCHEDULE',    '*/30 * * * *'),
    maxPerRun:      int('RECOVERY_CRON_MAX_PER_RUN', 200),
    dryRun:         boo('RECOVERY_CRON_DRY_RUN'),
    maxAgeDays:     int('RECOVERY_MAX_AGE_DAYS',     7),
    maxAttempts:    int('MAX_RECOVERY_ATTEMPTS',     3),
    cooldownHours:  int('RECOVERY_COOLDOWN_HOURS',   24),
    tokenTTL:       int('RECOVERY_TOKEN_TTL_SECONDS', 72 * 60 * 60),
    staleAckMins:   int('RECOVERY_STALE_ACK_MINS',   10),
    delayHours: {
      1: flt('RECOVERY_ATTEMPT1_DELAY_HOURS', 1),
      2: flt('RECOVERY_ATTEMPT2_DELAY_HOURS', 24),
      3: flt('RECOVERY_ATTEMPT3_DELAY_HOURS', 72),
    },
  },

  // ── Global ───────────────────────────────────────────────────────────────
  global: {
    timezone: env('CRON_TIMEZONE', 'UTC'),
  },
});

/**
 * validateCronEnv
 *
 * Called from server.js validateEnvVariables() to surface missing cron vars
 * at boot time alongside other required env checks. Only validates vars that
 * have no safe fallback (i.e. are operationally required in production).
 *
 * @returns {string[]} Array of missing variable names (empty = all present)
 */
export function validateCronEnv() {
  const warnings = [];

  if (!process.env.CRON_ALERT_WEBHOOK_URL && !process.env.SLACK_WEBHOOK_URL) {
    warnings.push(
      'CRON_ALERT_WEBHOOK_URL or SLACK_WEBHOOK_URL — no cron alert channel configured'
    );
  }

  return warnings;
}