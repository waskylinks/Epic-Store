/**
 * utils/cronAlert.js
 *
 * Fire-and-forget alert dispatcher for cron job failures and warnings.
 * Supports two channels:
 *   1. Generic webhook  — CRON_ALERT_WEBHOOK_URL (optional second channel)
 *   2. Slack            — SLACK_WEBHOOK_URL via config/slack.js
 
 */

import { buildSlackPayload } from './slackMessageBuilder.js';
import { getSlackConfig }    from '../config/slack.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 5_000; // 5 seconds — enough for any healthy endpoint

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendCronAlert
 *
 * @param {Object} opts
 * @param {string}  opts.jobName     - e.g. 'RecoveryEmailCron'
 * @param {string}  opts.runId       - unique run identifier
 * @param {string}  opts.status      - 'ok' | 'partial' | 'failed'
 * @param {string}  [opts.message]   - human-readable description
 * @param {*}       [opts.error]     - any error value (string, Error, object)
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
  if (!url) return; // Optional channel — skip silently if not configured

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
      WEBHOOK_TIMEOUT_MS,
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)');
      console.error(`[CronAlert] Generic webhook returned ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error('[CronAlert] Generic webhook error:', errorToString(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL: SLACK
// ─────────────────────────────────────────────────────────────────────────────

async function sendToSlack(payload) {
  const config = getSlackConfig();
  if (!config.webhookUrl) return;

  const jobPref = config.jobPreferences?.[payload.jobName];
  if (jobPref === 'none') return;
  if (jobPref === 'fail-only' && payload.status === 'ok') return;

  try {
    const slackPayload = buildSlackPayload({ ...payload, config });

    const res = await fetchWithTimeout(
      config.webhookUrl,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(slackPayload),
      },
      WEBHOOK_TIMEOUT_MS,
    );

    const body = await res.text().catch(() => '');
    if (!res.ok || body.trim() !== 'ok') {
      console.error(
        `[CronAlert] Slack webhook failed (${res.status}): ${body || '(empty body)'}`,
      );
    }
  } catch (err) {
    console.error('[CronAlert] Slack webhook error:', errorToString(err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 *
 * @param {string}      url
 * @param {RequestInit} options
 * @param {number}      timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = WEBHOOK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 *
 * @param {*} err
 * @returns {string}
 */
function errorToString(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.stack || err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * deriveSeverity
 *
 * @param {string} status
 * @returns {'critical' | 'warning' | 'info'}
 */
function deriveSeverity(status) {
  if (status === 'critical' || status === 'failed') return 'critical';
  if (status === 'warning'  || status === 'partial') return 'warning';
  return 'info';
}