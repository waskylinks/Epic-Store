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
    jobName    = 'Unknown Job',
    runId,
    status     = 'ok',
    message,
    error,
    durationMs,
    counts     = {},
    severity,
    config     = {},
    timestamp,
  } = opts;

  // FIX #5 — Normalize status/severity once at the top so all downstream
  // logic (color, emoji, title, fields) uses consistent, non-contradictory values.
  const normalizedStatus   = status ?? 'ok';
  const normalizedSeverity =
    severity ??
    (normalizedStatus === 'failed'
      ? 'critical'
      : normalizedStatus === 'partial'
      ? 'warning'
      : 'info');

  const color      = SEVERITY_COLOR[normalizedSeverity] ?? SEVERITY_COLOR.info;
  const emoji      = severityEmoji(normalizedSeverity, normalizedStatus);
  const title      = buildTitle(jobName, normalizedStatus, normalizedSeverity);
  const fields     = buildFields({ runId, durationMs, counts, status: normalizedStatus });
  const footerText = `${config.botName ?? 'CronBot'} • ${formatTimestamp(timestamp)}`;

  // FIX #7 — Enrich fallback with message so Slack notification previews
  // (which strip Block Kit blocks) still carry useful context.
  const fallbackMsg = message ? ` — ${String(message)}` : '';

  return {
    username:   config.botName  ?? 'Cron Monitor',
    icon_emoji: config.botEmoji ?? ':robot_face:',
    attachments: [
      {
        color,
        fallback: `${emoji} ${title}${fallbackMsg}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *${title}*`,
            },
          },
          ...buildContextBlocks({ message, error }),
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
    if (jobName === 'AuditCleanup')     return `${jobName} — Partial Deletion Detected`;
    if (jobName === 'AbandonmentSweep') return `${jobName} — Error Threshold Exceeded`;
    return `${jobName} — Warning`;
  }
  return `${jobName} — Run Complete`;
}

function buildContextBlocks({ message, error }) {
  const blocks = [];

  if (message) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: String(message) },
    });
  }

  const normalizedError = normalizeError(error);

  if (normalizedError) {
    const truncated =
      normalizedError.length > 600
        ? normalizedError.slice(0, 597) + '…'
        : normalizedError;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Error:*\n\`\`\`${truncated}\`\`\`` },
    });
  }

  return blocks;
}

function buildFields({ runId, durationMs, counts, status }) {
  const fields = [];

  if (runId) {
    fields.push({ type: 'mrkdwn', text: `*Run ID*\n\`${runId}\`` });
  }

  if (durationMs !== undefined && durationMs !== null) {
    fields.push({ type: 'mrkdwn', text: `*Duration*\n${formatDuration(durationMs)}` });
  }

  Object.entries(counts)
    .slice(0, 8)
    .forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        fields.push({
          type: 'mrkdwn',
          text: `*${capitalize(key)}*\n${val}`,
        });
      }
    });

  fields.push({ type: 'mrkdwn', text: `*Status*\n${formatStatus(status)}` });

  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * normalizeError
 *
 * @param {*} error
 * @returns {string|null}
 */
function normalizeError(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.stack || error.message;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

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
  return map[status] ?? String(status);
}

function formatDuration(ms) {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * @param {string} iso - ISO 8601 timestamp string
 * @returns {string}
 */
function formatTimestamp(iso) {
  if (!iso) return 'Unknown time';
  return new Date(iso).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function capitalize(str) {
  return String(str).charAt(0).toUpperCase() + String(str).slice(1);
}