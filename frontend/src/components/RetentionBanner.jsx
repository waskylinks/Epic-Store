
import React from 'react';

import '../componentStyles/RetensionBanner.css';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fmtRelative
 * Returns a human-readable relative time string from a date value.
 * e.g. "just now", "3 mins ago", "2 hours ago", "1 day ago"
 */
function fmtRelative(dateStr) {
  if (!dateStr) return '—';
  const diff    = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours   = Math.floor(diff / 3600000);
  const days    = Math.floor(diff / 86400000);
  if (minutes < 1)   return 'just now';
  if (minutes < 60)  return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24)    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function RetentionBanner({ job, onDismiss, label = 'Retention' }) {
  // Render nothing if no job data is available.
  // The parent controls visibility via the showBanner guard so this is a
  // safety net only.
  if (!job) return null;

  const isFailed  = job.status === 'failed';
  const isPartial = job.status === 'partial';

  // Count entries with a positive numeric value for the chips strip.
  // Filters out zero-value counts so the banner stays clean on quiet runs.
  const counts = job.counts ?? {};
  const countEntries = Object.entries(counts).filter(
    ([, v]) => typeof v === 'number' && v > 0
  );

  // Derive banner title from status and label prop
  const title = isFailed
    ? `${label} job failed`
    : isPartial
    ? `${label} completed with warnings`
    : `${label} ran successfully`;

  return (
    <div
      className={[
        'ck-retention-banner',
        isFailed  ? 'ck-retention-banner--error' : '',
        isPartial ? 'ck-retention-banner--warn'  : '',
      ].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      <div className="ck-retention-banner-left">
        <span className="ck-retention-banner-icon">
          {isFailed || isPartial ? '⚠' : '✓'}
        </span>

        <div className="ck-retention-banner-body">
          <span className="ck-retention-banner-title">{title}</span>

          <span className="ck-retention-banner-meta">
            {fmtRelative(job.startedAt)}

            {job.triggeredBy === 'manual' && (
              <span className="ck-retention-banner-source">· triggered manually</span>
            )}

            {countEntries.length > 0 && (
              <span className="ck-retention-banner-counts">
                {countEntries.map(([k, v]) => (
                  <span key={k} className="ck-retention-banner-count-chip">
                    {k}: <strong>{v}</strong>
                  </span>
                ))}
              </span>
            )}

            {(isFailed || isPartial) && job.error && (
              <span
                className="ck-retention-banner-error"
                title={job.error}
              >
                {job.error.length > 80
                  ? `${job.error.slice(0, 77)}…`
                  : job.error}
              </span>
            )}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="ck-retention-banner-dismiss"
        onClick={onDismiss}
        aria-label={`Dismiss ${label} notice`}
      >
        ✕
      </button>
    </div>
  );
}