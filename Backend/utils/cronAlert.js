/**
 * utils/cronAlert.js
 *
 * Fire-and-forget alert dispatcher for cron job failures and warnings.
 * Supports two channels:
 *   1. Generic webhook  — CRON_ALERT_WEBHOOK_URL (existing)
 *   2. Slack            — loaded from config/slack.js
 *
 * Rules:
 *   - NEVER throws. All errors are swallowed and logged to console.
 *   - Always returns a resolved promise so callers can safely await if needed.
 *   - Severity levels: 'info' | 'warning' | 'critical'
 *   - Imports slackMessageBuilder for Slack-specific payload construction.
 */

import { buildSlackPayload } from './slackMessageBuilder.js';
import { getSlackConfig }    from '../config/slack.js';

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendCronAlert
 *
 * @param {Object} opts
 * @param {string}  opts.jobName     - e.g. 'RecoveryEmailCron'
 * @param {string}  opts.runId       - unique run identifier
 * @param {string}  opts.status      - 'ok' | 'warning' | 'critical' | 'partial'
 * @param {string}  [opts.message]   - human-readable description
 * @param {string}  [opts.error]     - error message if failed
 * @param {number}  [opts.durationMs]
 * @param {Object}  [opts.counts]    - e.g. { sent: 5, failed: 2 }
 * @param {string}  [opts.severity]  - 'info' | 'warning' | 'critical'
 */
export async function sendCronAlert({
  jobName,
  runId,
  status,
  message,
  error,
  durationMs,
  counts = {},
  severity,
}) {
  // Derive severity from status if not explicitly provided
  const resolvedSeverity = severity ?? deriveSeverity(status);

  const payload = {
    jobName,
    runId,
    status,
    message,
    error,
    durationMs,
    counts,
    severity:  resolvedSeverity,
    timestamp: new Date().toISOString(),
  };

  // Fire both channels concurrently — neither blocks the other
  await Promise.allSettled([
    sendToGenericWebhook(payload),
    sendToSlack(payload),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL: GENERIC WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────

async function sendToGenericWebhook(payload) {
  const url = process.env.CRON_ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[CronAlert] Generic webhook failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL: SLACK
// ─────────────────────────────────────────────────────────────────────────────

async function sendToSlack(payload) {
  const config = getSlackConfig();
  if (!config.webhookUrl) return;

  // Check per-job alert preferences
  const jobPref = config.jobPreferences?.[payload.jobName];
  if (jobPref === 'none') return;
  if (jobPref === 'fail-only' && payload.status === 'ok') return;

  try {
    const slackPayload = buildSlackPayload({ ...payload, config });
    await fetch(config.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(slackPayload),
    });
  } catch (err) {
    console.error('[CronAlert] Slack webhook failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function deriveSeverity(status) {
  if (status === 'critical' || status === 'failed') return 'critical';
  if (status === 'warning'  || status === 'partial') return 'warning';
  return 'info';
}