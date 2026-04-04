import cron              from 'node-cron';
import { markStaleCheckouts } from '../utils/markStaleCheckouts.js';
import { runCronJob }    from '../utils/runCronJob.js';
import { sendCronAlert } from '../utils/cronAlert.js';
import { cronConfig }    from '../config/cronConfig.js';
 
let cronJob = null;
 
// ─────────────────────────────────────────────────────────────────────────────
// CORE LOGIC
// ─────────────────────────────────────────────────────────────────────────────
 
async function runSweep() {
  const { marked, errors, reAbandoned } = await markStaleCheckouts();
 
  const durationMs = undefined; // runCronJob tracks this
 
  console.log(
    `[AbandonmentSweep] marked: ${marked} | reAbandoned: ${reAbandoned} | errors: ${errors}`
  );
 
  const threshold = cronConfig.abandonmentSweep.errorAlertThreshold;
 
  if (errors > threshold) {
    console.error(
      `[AbandonmentSweep] ERROR THRESHOLD EXCEEDED — ${errors} checkout(s) failed to mark abandoned. ` +
      `Threshold: ${threshold}. Investigate immediately.`
    );
 
    // Fire Slack alert for threshold breach (separate from run-level failure)
    await sendCronAlert({
      jobName:  'AbandonmentSweep',
      runId:    `sweep_threshold_${Date.now()}`,
      status:   'warning',
      severity: 'warning',
      message:  `Error threshold exceeded: ${errors} checkout(s) failed to mark abandoned (threshold: ${threshold})`,
      counts:   { marked, reAbandoned, errors },
    });
  }
 
  return { marked, reAbandoned, errors };
}
 
// ─────────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────────
 
export function startAbandonmentSweep() {
  const isProd        = process.env.NODE_ENV === 'production';
  const schedule      = isProd
    ? cronConfig.abandonmentSweep.scheduleProduction
    : cronConfig.abandonmentSweep.scheduleDevelopment;
  const intervalLabel = isProd ? '30 minutes' : '5 minutes';
 
  console.log(
    `[AbandonmentSweep] Starting — environment: ${process.env.NODE_ENV || 'development'}, ` +
    `interval: ${intervalLabel}, ` +
    `errorAlertThreshold: ${cronConfig.abandonmentSweep.errorAlertThreshold}`
  );
 
  const wrappedFn = runCronJob({
    jobName:     'AbandonmentSweep',
    jobFn:       runSweep,
    alertOnFail: true,
  });
 
  cronJob = cron.schedule(schedule, wrappedFn, {
    scheduled: true,
    timezone:  cronConfig.global.timezone,
  });
 
  // Run once immediately on boot
  console.log('[AbandonmentSweep] Running initial sweep on boot…');
  wrappedFn();
}
 
export function stopAbandonmentSweep() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[AbandonmentSweep] Stopped');
  }
}
 
export default startAbandonmentSweep;