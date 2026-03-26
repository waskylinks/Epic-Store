import cron from 'node-cron';
import { markStaleCheckouts } from '../utils/markStaleCheckouts.js';



const CRON_SCHEDULE_PRODUCTION  = '0,30 * * * *';   // every 30 min
const CRON_SCHEDULE_DEVELOPMENT = '*/5 * * * *';     // every 5 min

let isSweepRunning = false;

const runSweep = async () => {
  if (isSweepRunning) {
    console.warn(
      '[AbandonmentSweep] Previous sweep still running — skipping this interval.'
    );
    return;
  }

  isSweepRunning = true;
  const startedAt = new Date();

  try {
    const { marked, errors } = await markStaleCheckouts();

    const durationMs = Date.now() - startedAt.getTime();

    console.log(
      `[AbandonmentSweep] Completed at ${new Date().toISOString()} ` +
      `| marked: ${marked} | errors: ${errors} | duration: ${durationMs}ms`
    );
  } catch (err) {
    // Top-level catch — markStaleCheckouts has its own per-document
    // try/catch, so this only fires if something catastrophic happens
    // (e.g. the DB query itself throws).
    console.error(
      `[AbandonmentSweep] Sweep failed at ${new Date().toISOString()}:`,
      err.message
    );
  } finally {
    isSweepRunning = false;
  }
};

/**
 * startAbandonmentSweep
 *
 * Call once after the database connection is ready.
 * Schedules the cron and runs an immediate sweep on boot so the first
 * interval doesn't have to wait up to 30 minutes for stale data to clear.
 */
export const startAbandonmentSweep = () => {
  const isProd     = process.env.NODE_ENV === 'production';
  const schedule   = isProd ? CRON_SCHEDULE_PRODUCTION : CRON_SCHEDULE_DEVELOPMENT;
  const intervalLabel = isProd ? '30 minutes' : '5 minutes';

  console.log(
    `[AbandonmentSweep] Starting — environment: ${process.env.NODE_ENV || 'development'}, ` +
    `interval: ${intervalLabel}`
  );

  // Schedule the recurring job
  cron.schedule(schedule, runSweep, {
    scheduled: true,
    timezone: 'UTC'
  });

  // Run once immediately on boot so stale checkouts don't survive a restart
  console.log('[AbandonmentSweep] Running initial sweep on boot...');
  runSweep();
};

export default startAbandonmentSweep;