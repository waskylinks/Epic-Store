/**
 * backend/services/analytics/bigQueryService.js
 *
 * Phase 7 — BigQuery Export Pipeline
 *
 * Streams normalized analytics events into five structured BigQuery tables.
 * This is the analytical warehouse layer — separate from MongoDB which handles
 * operational queries. BigQuery is optimized for large-scale analytical queries
 * that would be slow or expensive in MongoDB.
 *
 * Five-table architecture (dimensional model):
 *
 *   events              — raw events table (every event, source of truth)
 *   sessions            — session grain (one row per session)
 *   users               — user grain (one row per user, lifetime metrics)
 *   attribution_snapshots — order grain (one row per order, attribution context)
 *   funnel_states       — checkout step grain (funnel analysis)
 *
 * Design decisions:
 *
 *   1. Transformation layer — MongoDB documents are NOT dumped directly into
 *      BigQuery. A transformation step normalizes the data to the warehouse
 *      schema. This prevents MongoDB schema changes from breaking BigQuery
 *      queries (Mongo operational ≠ BigQuery analytical).
 *
 *   2. Streaming inserts — events are streamed row-by-row rather than batch
 *      loaded. This gives near-real-time availability in BigQuery (seconds,
 *      not hours). The trade-off is slightly higher cost per row vs batch,
 *      but for the event volumes of an e-commerce store, streaming is correct.
 *
 *   3. Date partitioning — all tables are partitioned by their primary timestamp
 *      field. Queries that filter by date range only scan the relevant partitions,
 *      reducing cost significantly for historical queries.
 *
 *   4. insertId for deduplication — BigQuery streaming inserts use insertId
 *      to deduplicate rows within a 1-minute window. We use the event_id
 *      (UUID from Phase 1) as the insertId to prevent duplicate rows when
 *      the queue retries a failed BigQuery insert.
 *
 * Environment variables required:
 *   BIGQUERY_PROJECT_ID           — GCP project ID
 *   BIGQUERY_DATASET_ID           — Dataset name (e.g. epicstore_analytics)
 *   GOOGLE_APPLICATION_CREDENTIALS — Path to service account JSON
 */

import { BigQuery } from '@google-cloud/bigquery';
import fs           from 'fs';
import path         from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── BIGQUERY CLIENT ──────────────────────────────────────────────────────────

let _bigquery = null;

export const resetBigQueryClient = () => { _bigquery = null; };

/**
 * getBigQuery
 * Lazy singleton — only instantiated on first use.
 * This prevents startup failures when BigQuery credentials are not yet
 * configured (e.g. local development without GCP access).
 */
const getBigQuery = () => {
  if (!_bigquery) {
    _bigquery = new BigQuery({
      projectId:   process.env.BIGQUERY_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }
  return _bigquery;
};

const getDataset = () =>
  getBigQuery().dataset(process.env.BIGQUERY_DATASET_ID);

// ─── TABLE SCHEMAS ────────────────────────────────────────────────────────────

/**
 * TABLE_SCHEMAS
 *
 * Inline schema definitions for all five tables.
 * These are also saved as JSON files (schemas/) for reference and version control.
 *
 * Field types: STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, JSON
 * NULLABLE vs REQUIRED — analytics data always uses NULLABLE to handle
 * events created before new fields were added (schema evolution).
 */
const TABLE_SCHEMAS = {

  events: {
    fields: [
      // ── Identity ────────────────────────────────────────────────────────────
      { name: 'event_id',             type: 'STRING',    mode: 'REQUIRED' },
      { name: 'event_type',           type: 'STRING',    mode: 'REQUIRED' },
      { name: 'event_source',         type: 'STRING',    mode: 'NULLABLE' }, // "client" | "server"
      { name: 'schema_version',       type: 'STRING',    mode: 'NULLABLE' },

      // ── Timestamps ──────────────────────────────────────────────────────────
      { name: 'event_time_client',    type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'event_time_server',    type: 'TIMESTAMP', mode: 'REQUIRED' }, // partition field
      { name: 'event_time_processed', type: 'TIMESTAMP', mode: 'NULLABLE' },

      // ── User identity ────────────────────────────────────────────────────────
      { name: 'user_id',              type: 'STRING',    mode: 'NULLABLE' },
      { name: 'anonymous_id',         type: 'STRING',    mode: 'NULLABLE' },
      { name: 'session_id',           type: 'STRING',    mode: 'NULLABLE' },

      // ── Attribution ──────────────────────────────────────────────────────────
      { name: 'source',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'medium',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'campaign',             type: 'STRING',    mode: 'NULLABLE' },
      { name: 'referrer',             type: 'STRING',    mode: 'NULLABLE' },
      { name: 'landing_page',         type: 'STRING',    mode: 'NULLABLE' },
      { name: 'gclid',                type: 'STRING',    mode: 'NULLABLE' },
      { name: 'fbclid',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'ttclid',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'confidence_score',     type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'confidence_level',     type: 'STRING',    mode: 'NULLABLE' },
      { name: 'is_reconstructed',     type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'reconstruction_rule',  type: 'STRING',    mode: 'NULLABLE' },

      // ── Device ───────────────────────────────────────────────────────────────
      { name: 'device',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'browser',              type: 'STRING',    mode: 'NULLABLE' },

      // ── Event properties (JSON) ──────────────────────────────────────────────
      { name: 'properties',           type: 'JSON',      mode: 'NULLABLE' },
    ],
    timePartitioningField: 'event_time_server',
  },

  sessions: {
    fields: [
      { name: 'session_id',           type: 'STRING',    mode: 'REQUIRED' },
      { name: 'user_id',              type: 'STRING',    mode: 'NULLABLE' },
      { name: 'anonymous_id',         type: 'STRING',    mode: 'NULLABLE' },
      { name: 'session_start',        type: 'TIMESTAMP', mode: 'REQUIRED' },
      { name: 'session_end',          type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'page_views',           type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'entry_page',           type: 'STRING',    mode: 'NULLABLE' },
      { name: 'source',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'medium',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'campaign',             type: 'STRING',    mode: 'NULLABLE' },
      { name: 'device',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'confidence_level',     type: 'STRING',    mode: 'NULLABLE' },
      { name: 'converted',            type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'conversion_value',     type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'recorded_at',          type: 'TIMESTAMP', mode: 'REQUIRED' },
    ],
    timePartitioningField: 'session_start',
  },

  users: {
    fields: [
      { name: 'user_id',              type: 'STRING',    mode: 'REQUIRED' },
      { name: 'anonymous_ids',        type: 'STRING',    mode: 'REPEATED' }, // array of historical anon IDs
      { name: 'first_seen_at',        type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'first_purchase_at',    type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'last_seen_at',         type: 'TIMESTAMP', mode: 'NULLABLE' },
      { name: 'total_orders',         type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'total_revenue',        type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'first_touch_source',   type: 'STRING',    mode: 'NULLABLE' },
      { name: 'first_touch_medium',   type: 'STRING',    mode: 'NULLABLE' },
      { name: 'last_touch_source',    type: 'STRING',    mode: 'NULLABLE' },
      { name: 'last_touch_medium',    type: 'STRING',    mode: 'NULLABLE' },
      { name: 'recorded_at',          type: 'TIMESTAMP', mode: 'REQUIRED' },
    ],
    timePartitioningField: 'recorded_at',
  },

  attribution_snapshots: {
    fields: [
      { name: 'event_id',             type: 'STRING',    mode: 'REQUIRED' },
      { name: 'order_id',             type: 'STRING',    mode: 'REQUIRED' },
      { name: 'payment_reference',    type: 'STRING',    mode: 'NULLABLE' },
      { name: 'user_id',              type: 'STRING',    mode: 'NULLABLE' },
      { name: 'anonymous_id',         type: 'STRING',    mode: 'NULLABLE' },
      { name: 'session_id',           type: 'STRING',    mode: 'NULLABLE' },
      { name: 'revenue',              type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'currency',             type: 'STRING',    mode: 'NULLABLE' },
      { name: 'source',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'medium',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'campaign',             type: 'STRING',    mode: 'NULLABLE' },
      { name: 'gclid',                type: 'STRING',    mode: 'NULLABLE' },
      { name: 'fbclid',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'confidence_score',     type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'confidence_level',     type: 'STRING',    mode: 'NULLABLE' },
      { name: 'is_reconstructed',     type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'reconstruction_rule',  type: 'STRING',    mode: 'NULLABLE' },
      { name: 'is_first_purchase',    type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'purchase_number',      type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'item_count',           type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'coupon_code',          type: 'STRING',    mode: 'NULLABLE' },
      { name: 'purchased_at',         type: 'TIMESTAMP', mode: 'REQUIRED' },
    ],
    timePartitioningField: 'purchased_at',
  },

  funnel_states: {
    fields: [
      { name: 'event_id',             type: 'STRING',    mode: 'REQUIRED' },
      { name: 'checkout_id',          type: 'STRING',    mode: 'NULLABLE' },
      { name: 'user_id',              type: 'STRING',    mode: 'NULLABLE' },
      { name: 'anonymous_id',         type: 'STRING',    mode: 'NULLABLE' },
      { name: 'session_id',           type: 'STRING',    mode: 'NULLABLE' },
      { name: 'step',                 type: 'STRING',    mode: 'NULLABLE' },
      { name: 'step_number',          type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'cart_value',           type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'item_count',           type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'currency',             type: 'STRING',    mode: 'NULLABLE' },
      { name: 'has_discount',         type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'source',               type: 'STRING',    mode: 'NULLABLE' },
      { name: 'confidence_level',     type: 'STRING',    mode: 'NULLABLE' },
      { name: 'abandoned',            type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'recorded_at',          type: 'TIMESTAMP', mode: 'REQUIRED' },
    ],
    timePartitioningField: 'recorded_at',
  },
};

// ─── SCHEMA INITIALIZATION ────────────────────────────────────────────────────
 
/**
 * initializeBigQuerySchema
 *
 * Creates all five tables in the BigQuery dataset if they do not exist.
 * Idempotent — safe to call on every server startup.
 *
 * Validates that GOOGLE_APPLICATION_CREDENTIALS points to a readable file
 * before attempting any BigQuery API calls. A missing or unreadable credentials
 * file will fail silently at the client instantiation level otherwise, causing
 * confusing errors in queue lastError fields rather than a clear startup warning.
 *
 * Call this from server.js after MongoDB connection is established:
 *   await initializeBigQuerySchema();
 *
 * @returns {Promise<void>}
 */
export const initializeBigQuerySchema = async () => {
  if (!process.env.BIGQUERY_PROJECT_ID || !process.env.BIGQUERY_DATASET_ID) {
    console.warn('[BigQuery] BIGQUERY_PROJECT_ID or BIGQUERY_DATASET_ID not set — skipping schema init');
    return;
  }
 
  // Eagerly validate credentials file existence at startup so failures surface
  // here with a clear message rather than appearing later in queue lastError fields.
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsPath) {
    try {
      fs.accessSync(path.resolve(credsPath), fs.constants.R_OK);
    } catch {
      console.warn(
        `[BigQuery] GOOGLE_APPLICATION_CREDENTIALS file not readable at "${credsPath}". ` +
        'BigQuery streaming inserts will fail until this is resolved. Server starting normally.'
      );
      // Do not proceed — getBigQuery() will fail the same way and pollute queue error fields
      return;
    }
  }
 
  const dataset = getDataset();
 
  for (const [tableName, config] of Object.entries(TABLE_SCHEMAS)) {
    try {
      const table = dataset.table(tableName);
      const [exists] = await table.exists();
 
      if (!exists) {
        await dataset.createTable(tableName, {
          schema: config,
          timePartitioning: {
            type:  'DAY',
            field: config.timePartitioningField,
          },
        });
        console.info(`[BigQuery] ✅ Table created: ${tableName}`);
      } else {
        console.debug(`[BigQuery] Table already exists: ${tableName}`);
      }
    } catch (err) {
      console.error(`[BigQuery] Failed to initialize table ${tableName}:`, err.message);
      // Do not throw — allow server to start even if BigQuery is misconfigured
    }
  }
};

// ─── ROW TRANSFORMERS ─────────────────────────────────────────────────────────

/**
 * toTimestamp
 * Converts a date string or Date object to BigQuery TIMESTAMP format.
 * Returns null for missing values — BigQuery accepts null for NULLABLE fields.
 */
const toTimestamp = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * transformToEventRow
 * Converts a normalized analytics event (from buildAnalyticsEvent) to
 * the BigQuery events table row format.
 */
const transformToEventRow = (event) => ({
  event_id:             event.event_id,
  event_type:           event.event_type,
  event_source:         event.event_source         || null,
  schema_version:       event.schema_version        || '1.0',
  event_time_client:    toTimestamp(event.event_time_client),
  event_time_server:    toTimestamp(event.event_time_server) || new Date().toISOString(),
  event_time_processed: new Date().toISOString(),
  user_id:              event.user_id               || null,
  anonymous_id:         event.anonymous_id          || null,
  session_id:           event.session_id            || null,
  source:               event.attribution?.source          || 'direct',
  medium:               event.attribution?.medium          || null,
  campaign:             event.attribution?.campaign        || null,
  referrer:             event.attribution?.referrer        || null,
  landing_page:         event.attribution?.landing_page    || null,
  gclid:                event.attribution?.gclid           || null,
  fbclid:               event.attribution?.fbclid          || null,
  ttclid:               event.attribution?.ttclid          || null,
  confidence_score:     event.attribution?.confidence_score ?? null,
  confidence_level:     event.attribution?.confidence_level || null,
  is_reconstructed:     event.attribution?.is_reconstructed || false,
  reconstruction_rule:  event.attribution?.reconstruction_rule || null,
  device:               event.attribution?.device          || null,
  browser:              event.attribution?.browser         || null,
  properties:           JSON.stringify(event.properties || {}),
});

/**
 * transformToAttributionSnapshotRow
 * Converts a purchase analytics event to the attribution_snapshots table format.
 * This table is the primary source for revenue-by-attribution queries.
 */
const transformToAttributionSnapshotRow = (event) => {
  const props = event.properties || {};
  return {
    event_id:            event.event_id,
    order_id:            props.order_id            || null,
    payment_reference:   props.payment_reference   || null,
    user_id:             event.user_id             || null,
    anonymous_id:        event.anonymous_id        || null,
    session_id:          event.session_id          || null,
    revenue:             props.revenue             ?? null,
    currency:            props.currency            || 'USD',
    source:              event.attribution?.source          || 'direct',
    medium:              event.attribution?.medium          || null,
    campaign:            event.attribution?.campaign        || null,
    gclid:               event.attribution?.gclid           || null,
    fbclid:              event.attribution?.fbclid          || null,
    confidence_score:    event.attribution?.confidence_score ?? null,
    confidence_level:    event.attribution?.confidence_level || null,
    is_reconstructed:    event.attribution?.is_reconstructed || false,
    reconstruction_rule: event.attribution?.reconstruction_rule || null,
    is_first_purchase:   props.is_first_purchase   ?? null,
    purchase_number:     props.purchase_number     ?? null,
    item_count:          props.item_count          ?? null,
    coupon_code:         props.coupon               || null,
    purchased_at:        toTimestamp(event.event_time_server) || new Date().toISOString(),
  };
};

/**
 * transformToFunnelStateRow
 * Converts a checkout_step analytics event to the funnel_states table format.
 */
const transformToFunnelStateRow = (event) => {
  const props = event.properties || {};
  const STEP_NUMBERS = {
    shipping_info:     1,
    payment_selection: 2,
    order_review:      3,
  };

  return {
    event_id:        event.event_id,
    checkout_id:     props.checkout_id   || null,
    user_id:         event.user_id       || null,
    anonymous_id:    event.anonymous_id  || null,
    session_id:      event.session_id    || null,
    step:            props.step          || null,
    step_number:     STEP_NUMBERS[props.step] || null,
    cart_value:      props.cart_value    ?? null,
    item_count:      props.item_count    ?? null,
    currency:        props.currency      || 'USD',
    has_discount:    props.has_discount  ?? false,
    source:          event.attribution?.source || 'direct',
    confidence_level: event.attribution?.confidence_level || null,
    abandoned:       props.abandoned     ?? false,
    recorded_at:     toTimestamp(event.event_time_server) || new Date().toISOString(),
  };
};

// ─── STREAMING INSERT HELPERS ─────────────────────────────────────────────────
 
/**
 * insertRows
 *
 * Inserts rows into a BigQuery table with insertId for deduplication.
 * The insertId uses the event_id (UUID from Phase 1) to prevent duplicate
 * rows when the queue retries a failed BigQuery insert.
 *
 * BigQuery streaming inserts can return HTTP 200 with insertErrors in the
 * response body — a successful API call does not guarantee successful ingestion.
 * This function inspects the response for partial failures and throws if any
 * row was rejected, so the queue worker records the real error rather than
 * silently treating a rejected row as a success.
 *
 * @param {string} tableName - One of the five table names
 * @param {Object[]} rows    - Array of row objects matching the table schema
 * @param {string} eventId   - UUID used as insertId for deduplication
 */
const insertRows = async (tableName, rows, eventId) => {
  const table = getDataset().table(tableName);
 
  const rawRows = rows.map(row => ({
    insertId: `${eventId}_${tableName}`,
    json:     row,
  }));
 
  // table.insert returns [apiResponse] — BigQuery may return HTTP 200 with
  // insertErrors for individual rows. We must inspect this rather than treating
  // a non-throwing call as success.
  const [apiResponse] = await table.insert(rawRows, { raw: true });
 
  // insertErrors is an array when present; each entry has { index, errors[] }
  const insertErrors = apiResponse?.insertErrors;
  if (insertErrors && insertErrors.length > 0) {
    const details = insertErrors
      .map(e => e.errors?.map(err => err.message).join(', '))
      .join('; ');
    throw new Error(`[BigQuery] Partial insert failure in ${tableName}: ${details}`);
  }
};

// ─── MAIN STREAMING FUNCTION ──────────────────────────────────────────────────
 
/**
 * streamEventToBigQuery
 *
 * Streams a normalized analytics event payload to the appropriate BigQuery tables.
 * Called by the queue worker (analyticsQueue.js) for every event.
 *
 * When BigQuery is not configured (missing BIGQUERY_PROJECT_ID), the function
 * returns a skipped result rather than throwing. This prevents development
 * environments from polluting queue lastError fields with configuration errors
 * and keeps BigQuery as a best-effort platform — the queue worker only gates
 * allSucceeded on GA4 + Meta, so a BigQuery skip is non-fatal by design.
 *
 * Table routing:
 *   ALL events         → events table (raw events)
 *   purchase events    → attribution_snapshots table
 *   checkout_step      → funnel_states table
 *   checkout_abandon   → funnel_states table (with abandoned: true)
 *
 * @param {Object} payload - Full analytics event payload from the queue
 * @returns {Promise<Object>}
 */
export const streamEventToBigQuery = async (payload) => {
  // Return a skipped result rather than throwing when BigQuery is not configured.
  // Throwing here causes the queue to record a lastError on every event in
  // development, polluting observability data and making dead_letter counts
  // misleading. BigQuery is best-effort — the worker does not gate allSucceeded
  // on BigQuery, so skipping is the correct signal.
  if (!process.env.BIGQUERY_PROJECT_ID) {
    return {
      success: true,
      skipped: true,
      reason:  'BIGQUERY_PROJECT_ID not configured',
    };
  }
 
  const event   = payload;
  const eventId = event.event_id;
 
  if (!eventId) {
    throw new Error('[BigQuery] event_id is required for streaming insert');
  }
 
  const insertPromises = [];
  const tablesWritten  = [];
 
  // ── Always insert into events table ──────────────────────────────────────
  const eventRow = transformToEventRow(event);
  insertPromises.push(
    insertRows('events', [eventRow], eventId).then(() => tablesWritten.push('events'))
  );
 
  // ── Route to specialized tables based on event type ───────────────────────
  switch (event.event_type) {
    case 'purchase': {
      const snapshotRow = transformToAttributionSnapshotRow(event);
      insertPromises.push(
        insertRows('attribution_snapshots', [snapshotRow], eventId)
          .then(() => tablesWritten.push('attribution_snapshots'))
      );
      break;
    }
 
    case 'checkout_step':
    case 'begin_checkout': {
      const funnelRow = transformToFunnelStateRow(event);
      insertPromises.push(
        insertRows('funnel_states', [funnelRow], eventId)
          .then(() => tablesWritten.push('funnel_states'))
      );
      break;
    }
 
    case 'checkout_abandon': {
      const funnelRow = transformToFunnelStateRow({
        ...event,
        properties: { ...event.properties, abandoned: true },
      });
      insertPromises.push(
        insertRows('funnel_states', [funnelRow], eventId)
          .then(() => tablesWritten.push('funnel_states'))
      );
      break;
    }
  }
 
  // Run all table inserts in parallel. A partial failure in any table throws
  // and propagates to the queue worker, which records it in platforms.bigquery.error.
  await Promise.all(insertPromises);
 
  return {
    success:       true,
    skipped:       false,
    tablesWritten,
    eventId,
    insertedAt:    new Date().toISOString(),
  };
};
 

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

/**
 * checkBigQueryConfig
 *
 * Validates BigQuery environment variables and optionally pings the dataset.
 * Called by server.js on startup and by the observability controller (Phase 8).
 *
 * @returns {Promise<Object>}
 */
export const checkBigQueryConfig = async () => {
  const required = ['BIGQUERY_PROJECT_ID', 'BIGQUERY_DATASET_ID', 'GOOGLE_APPLICATION_CREDENTIALS'];
  const missing  = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    return { configured: false, missing, connected: false };
  }

  try {
    const [exists] = await getDataset().exists();
    return {
      configured:  true,
      missing:     [],
      connected:   exists,
      datasetId:   process.env.BIGQUERY_DATASET_ID,
      projectId:   process.env.BIGQUERY_PROJECT_ID,
    };
  } catch (err) {
    return {
      configured: true,
      missing:    [],
      connected:  false,
      error:      err.message,
    };
  }
};

// ─── SCHEMA EXPORT FOR REFERENCE ─────────────────────────────────────────────

export { TABLE_SCHEMAS };