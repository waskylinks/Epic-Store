import cron from 'node-cron';
import { markStaleCheckouts } from '../utils/markStaleCheckouts.js';

const CRON_SCHEDULE_PRODUCTION  = '0,30 * * * *';  // every 30 min
const CRON_SCHEDULE_DEVELOPMENT = '*/5 * * * *';   // every 5 min

const SWEEP_ERROR_ALERT_THRESHOLD =
  parseInt(process.env.SWEEP_ERROR_ALERT_THRESHOLD) || 5;

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
    const { marked, errors, reAbandoned } = await markStaleCheckouts();

    const durationMs = Date.now() - startedAt.getTime();

    console.log(
      `[AbandonmentSweep] Completed at ${new Date().toISOString()} ` +
      `| marked: ${marked} | reAbandoned: ${reAbandoned} | errors: ${errors} | duration: ${durationMs}ms`
    );

    if (errors > SWEEP_ERROR_ALERT_THRESHOLD) {
      console.error(
        `[AbandonmentSweep] ERROR THRESHOLD EXCEEDED — ${errors} checkout(s) failed to mark abandoned ` +
        `in the sweep at ${new Date().toISOString()}. Investigate immediately.`
      );
    }
  } catch (err) {
    console.error(
      `[AbandonmentSweep] Sweep failed at ${new Date().toISOString()}:`,
      err.message
    );
  } finally {
    isSweepRunning = false;
  }
};

export const startAbandonmentSweep = () => {
  const isProd        = process.env.NODE_ENV === 'production';
  const schedule      = isProd ? CRON_SCHEDULE_PRODUCTION : CRON_SCHEDULE_DEVELOPMENT;
  const intervalLabel = isProd ? '30 minutes' : '5 minutes';

  console.log(
    `[AbandonmentSweep] Starting — environment: ${process.env.NODE_ENV || 'development'}, ` +
    `interval: ${intervalLabel}, ` +
    `errorAlertThreshold: ${SWEEP_ERROR_ALERT_THRESHOLD}`
  );

  // Schedule the recurring job
  cron.schedule(schedule, runSweep, {
    scheduled: true,
    timezone:  'UTC'
  });

  // Run once immediately on boot so stale checkouts don't survive a restart
  console.log('[AbandonmentSweep] Running initial sweep on boot...');
  runSweep();
};

export default startAbandonmentSweep;