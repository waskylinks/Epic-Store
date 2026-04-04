/**
 * utils/slackMessageBuilder.js
 *
 * Builds Slack Block Kit message payloads for cron alert events.
 * Keeps all Slack-specific formatting logic out of cronAlert.js.
 *
 * Severity → color mapping:
 *   critical  → #EF4444 (red)
 *   warning   → #F59E0B (amber)
 *   partial   → #F59E0B (amber)
 *   info / ok → #10B981 (green)
 *
 * Special templates:
 *   - Audit cleanup partial deletion  → amber + mismatch detail
 *   - Abandonment sweep threshold     → amber + error count
 *   - Recovery cron full failure      → red   + distinct title
 *   - Generic job failure             → red   + stack-friendly error field
 */

// ─────────────────────────────────────────────────────────────────────────────
// COLOR MAP
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_COLOR = {
  critical: '#EF4444',
  warning:  '#F59E0B',
  partial:  '#F59E0B',
  info:     '#10B981',
  ok:       '#10B981',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildSlackPayload
 *
 * @param {Object} opts - merged payload + slack config
 * @returns {Object} Slack incoming webhook payload
 */
export function buildSlackPayload(opts) {
  const {
    jobName,
    runId,
    status,
    message,
    error,
    durationMs,
    counts = {},
    severity,
    config,
    timestamp,
  } = opts;

  const color      = SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.info;
  const emoji      = severityEmoji(severity, status);
  const title      = buildTitle(jobName, status, severity);
  const fields     = buildFields({ runId, durationMs, counts, status, error, message });
  const footerText = `${config?.botName ?? 'CronBot'} • ${formatTimestamp(timestamp)}`;

  return {
    username:    config?.botName    ?? 'Cron Monitor',
    icon_emoji:  config?.botEmoji   ?? ':robot_face:',
    channel:     config?.channel    ?? '#cron-alerts',
    attachments: [
      {
        color,
        fallback: `${emoji} ${title}`,
        blocks:   [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *${title}*`,
            },
          },
          ...buildContextBlocks({ jobName, status, message, error }),
          fields.length > 0 ? { type: 'section', fields } : null,
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: footerText }],
          },
        ].filter(Boolean),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildTitle(jobName, status, severity) {
  if (severity === 'critical' || status === 'failed') {
    return `${jobName} — Job Failed`;
  }
  if (status === 'partial' || severity === 'warning') {
    if (jobName === 'AuditCleanup') return `${jobName} — Partial Deletion Detected`;
    if (jobName === 'AbandonmentSweep') return `${jobName} — Error Threshold Exceeded`;
    return `${jobName} — Warning`;
  }
  return `${jobName} — Run Complete`;
}

function buildContextBlocks({ jobName, status, message, error }) {
  const blocks = [];

  if (message) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: message },
    });
  }

  if (error) {
    // Truncate long error messages — Slack has a 3000 char block limit
    const truncated = error.length > 600 ? error.slice(0, 597) + '…' : error;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Error:*\n\`\`\`${truncated}\`\`\`` },
    });
  }

  return blocks;
}

function buildFields({ runId, durationMs, counts, status, error, message }) {
  const fields = [];

  if (runId) {
    fields.push({ type: 'mrkdwn', text: `*Run ID*\n\`${runId}\`` });
  }

  if (durationMs !== undefined && durationMs !== null) {
    fields.push({ type: 'mrkdwn', text: `*Duration*\n${formatDuration(durationMs)}` });
  }

  // Counts — e.g. { sent: 5, failed: 2, evaluated: 10 }
  Object.entries(counts).forEach(([key, val]) => {
    if (val !== undefined && val !== null) {
      fields.push({ type: 'mrkdwn', text: `*${capitalize(key)}*\n${val}` });
    }
  });

  fields.push({ type: 'mrkdwn', text: `*Status*\n${formatStatus(status)}` });

  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function severityEmoji(severity, status) {
  if (severity === 'critical' || status === 'failed') return ':rotating_light:';
  if (severity === 'warning'  || status === 'partial') return ':warning:';
  return ':white_check_mark:';
}

function formatStatus(status) {
  const map = {
    ok:       '✅ OK',
    failed:   '❌ Failed',
    partial:  '⚠️ Partial',
    warning:  '⚠️ Warning',
    critical: '🚨 Critical',
  };
  return map[status] ?? status;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimestamp(iso) {
  if (!iso) return 'Unknown time';
  return new Date(iso).toLocaleString('en-US', {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}