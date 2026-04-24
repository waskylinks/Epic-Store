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
 * EDIT SUMMARY (vs previous version):
 *   - Added checkoutRetention block for the new three-pass retention job
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
    scheduleDevelopment: env('ABANDONMENT_SWEEP_CRON_DEVELOPMENT', '*/3 * * * *'),
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
    schedule:       env('RECOVERY_CRON_SCHEDULE',    '*/3 * * * *'),
    maxPerRun:      int('RECOVERY_CRON_MAX_PER_RUN', 200),
    dryRun:         boo('RECOVERY_CRON_DRY_RUN'),
    maxAgeDays:     int('RECOVERY_MAX_AGE_DAYS',     7),
    maxAttempts:    int('MAX_RECOVERY_ATTEMPTS',     3),
    cooldownHours:  flt('RECOVERY_COOLDOWN_HOURS',   1),
    tokenTTL:       int('RECOVERY_TOKEN_TTL_SECONDS', 72 * 60 * 60),
    staleAckMins:   int('RECOVERY_STALE_ACK_MINS',   10),
    delayHours: {
      1: flt('RECOVERY_ATTEMPT1_DELAY_HOURS', 1),
      2: flt('RECOVERY_ATTEMPT2_DELAY_HOURS', 24),
      3: flt('RECOVERY_ATTEMPT3_DELAY_HOURS', 72),
    },
  },

  // ── Checkout Retention ───────────────────────────────────────────────────
  //
  // Three-pass lifecycle management for the Checkout collection:
  //   Pass 1 — Warm prune:  strip expensive sub-arrays from 90–365 day docs
  //   Pass 2 — Cold archive: move 365+ day docs to checkouts_archive
  //   Pass 3 — Hard delete:  purge archive docs older than hardDeleteYears
  //                          (production only)
  //
  // Default schedule: 4 AM on the 1st of every month.
  // This runs AFTER the abandonment sweep (which fires every 30 min) so all
  // stale checkouts are already marked abandoned before archiving begins.
  //
  // batchSize        — rows per $unset batch in the warm prune pass
  // archiveBatchSize — rows per insertMany+deleteMany cycle in the archive pass
  //                    Kept smaller than batchSize because each cycle issues
  //                    two MongoDB operations (insert + delete).
  checkoutRetention: {
    cronExpression:  env('CHECKOUT_RETENTION_CRON',          '0 4 1 * *'),
    warmTierDays:    int('CHECKOUT_WARM_TIER_DAYS',           90),
    coldTierDays:    int('CHECKOUT_COLD_TIER_DAYS',           365),
    hardDeleteYears: int('CHECKOUT_HARD_DELETE_YEARS',        7),
    batchSize:       int('CHECKOUT_RETENTION_BATCH_SIZE',     500),
    archiveBatchSize:int('CHECKOUT_ARCHIVE_BATCH_SIZE',       200),
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