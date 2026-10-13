/* E&C Time Clock – punch-in reminders that reach the phone even when the
   time clock app is closed.

   One-shot timers (Cloud Tasks), not polling:
   - timeclockPlanReminders runs once a day just after midnight (Brandon time)
     and sets one timer per employee scheduled that day, for their scheduled
     start (admin panel → Employees) plus the reminder delay (admin panel →
     Settings).
   - timeclockPunchReminder is what each timer runs. If the employee hasn't
     punched in, it sends one web push notification to every phone they turned
     reminders on for (timeclock/push_tokens/<ek>, see setupPush in
     ../index.html). Otherwise it does nothing.
   - timeclockReplanEmployee / timeclockReplanAll set a new timer when a
     schedule or the reminder delay changes during the day. A timer whose time
     no longer matches the current schedule does nothing when it fires.
   - timeclockTestPush powers the "Send test" button.

   This is its own Firebase "codebase" (see ../firebase.json), so deploying it
   never touches the dispatch app's functions in the same project.
   Memory is set explicitly (with the default 1 vCPU) so running costs are
   predictable; see README "Running cost". */
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const R = require('./reminders');

admin.initializeApp();

// The default Realtime Database lives in us-central1; database triggers must run in the same region.
const REGION = 'us-central1';
const MEMORY = '256MiB';
const REMINDER_FUNCTION = 'timeclockPunchReminder';
const CLOCK_URL = 'https://app.eandccourier.ca/timeclock/';
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_SENT_DAYS = 30;

// Tokens FCM reports as gone for good (site data cleared, notifications turned off, token rotated)
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

/** Sends one notification to every phone the employee registered. Returns { sent, failed, removed }. */
async function sendTo(ek, { title, body, tag }) {
  const db = admin.database();
  const devices = (await db.ref(`timeclock/push_tokens/${ek}`).once('value')).val() || {};
  const targets = Object.entries(devices)
    .filter(([, d]) => d && typeof d.token === 'string' && d.token)
    .map(([key, d]) => ({ token: d.token, path: `timeclock/push_tokens/${ek}/${key}` }));
  if (!targets.length) return { sent: 0, failed: 0, removed: 0 };

  // Data-only message: the time clock's service worker (sw.js) shows it, the same way
  // as the in-page reminder, so the two replace each other instead of doubling up.
  const res = await admin.messaging().sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    data: { title, body, tag, url: CLOCK_URL },
    webpush: { headers: { Urgency: 'high', TTL: '7200' } }
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error && r.error.code;
    if (DEAD_TOKEN_CODES.has(code)) dead.push(db.ref(targets[i].path).remove());
    else logger.warn('Push failed', { ek, code, message: r.error && r.error.message });
  });
  await Promise.all(dead);
  return { sent: res.successCount, failed: res.failureCount, removed: dead.length };
}

/** Sets today's one-shot timer for one employee, if they have a reminder to come. */
async function planEmployee(ek, emp, settings, now) {
  const plan = R.planFor(now, settings, emp);
  if (!plan) return 'none today';
  const timer = R.timerFor(ek, plan, now);
  try {
    await getFunctions().taskQueue(`locations/${REGION}/functions/${REMINDER_FUNCTION}`).enqueue(
      { ek, day: plan.day, dueAt: plan.dueAt },
      { id: timer.id, scheduleTime: new Date(timer.fireAt) }
    );
    return 'set for ' + new Date(timer.fireAt).toISOString();
  } catch (err) {
    if (err && err.code === 'functions/task-already-exists') return 'already set';
    throw err;
  }
}

async function planEveryone(now) {
  const db = admin.database();
  const [settingsSnap, employeesSnap] = await Promise.all([
    db.ref('timeclock/settings').once('value'),
    db.ref('timeclock/employees').once('value')
  ]);
  const settings = settingsSnap.val();
  const results = {};
  for (const [ek, emp] of Object.entries(employeesSnap.val() || {})) {
    results[ek] = await planEmployee(ek, emp, settings, now);
  }
  logger.info('Punch-in reminder timers', results);
}

// Once a day, just after midnight Brandon time: today's timers, and tidy up old records
exports.timeclockPlanReminders = onSchedule(
  { schedule: '1 0 * * *', timeZone: R.TZ, region: REGION, retryCount: 2, maxInstances: 1, memory: MEMORY },
  async () => {
    const now = Date.now();
    await planEveryone(now);
    const cutoff = R.addDaysKey(R.dayKey(now), -KEEP_SENT_DAYS);
    const db = admin.database();
    const old = (await db.ref('timeclock/reminders_sent').orderByKey().endAt(cutoff).once('value')).val() || {};
    await Promise.all(Object.keys(old).map((k) => db.ref(`timeclock/reminders_sent/${k}`).remove()));
  }
);

// One timer firing: remind this employee once, if they still haven't punched in
exports.timeclockPunchReminder = onTaskDispatched(
  { region: REGION, memory: MEMORY, retryConfig: { maxAttempts: 3, minBackoffSeconds: 60 }, rateLimits: { maxConcurrentDispatches: 6 } },
  async (req) => {
    const { ek, day, dueAt } = req.data || {};
    if (typeof ek !== 'string' || typeof day !== 'string' || typeof dueAt !== 'number') return;
    const db = admin.database();
    const now = Date.now();
    const [settingsSnap, empSnap] = await Promise.all([
      db.ref('timeclock/settings').once('value'),
      db.ref(`timeclock/employees/${ek}`).once('value')
    ]);
    const emp = empSnap.val();
    const plan = R.planFor(now, settingsSnap.val(), emp);
    if (!R.isCurrent(plan, { day, dueAt })) {
      logger.info('Reminder timer no longer matches the schedule; skipped', { ek, day, dueAt });
      return;
    }
    const shifts = (await db.ref(`timeclock/shifts/${ek}`).orderByChild('in').startAt(now - 2 * DAY_MS).once('value')).val();
    if (R.hasPunchedToday(shifts, day)) return;

    // Claim today's reminder first, so a repeated timer can never send it twice
    const sentRef = db.ref(`timeclock/reminders_sent/${day}/${ek}`);
    const claim = await sentRef.transaction((cur) => (cur ? undefined : { at: now }));
    if (!claim.committed) return;
    try {
      const msg = R.reminderMessage(emp, plan.start);
      const result = await sendTo(ek, { title: msg.title, body: msg.body, tag: 'tc-punch-reminder' });
      await sentRef.update(result);
      logger.info('Punch-in reminder', { ek, start: plan.start, ...result });
    } catch (err) {
      await sentRef.remove(); // let Cloud Tasks retry the timer
      throw err;
    }
  }
);

// A schedule edited or an employee added during the day: set their timer for the new time
exports.timeclockReplanEmployee = onValueWritten(
  { ref: '/timeclock/employees/{ek}', region: REGION, memory: MEMORY },
  async (event) => {
    const emp = event.data.after.val();
    if (!emp) return;
    const settings = (await admin.database().ref('timeclock/settings').once('value')).val();
    const result = await planEmployee(event.params.ek, emp, settings, Date.now());
    logger.info('Reminder timer after schedule change', { ek: event.params.ek, result });
  }
);

// The reminder delay changed: everyone's time today moves
exports.timeclockReplanAll = onValueWritten(
  { ref: '/timeclock/settings', region: REGION, memory: MEMORY },
  async () => { await planEveryone(Date.now()); }
);

// "Send test" in the time clock's Reminders card writes timeclock/push_tests/<ek>
exports.timeclockTestPush = onValueWritten(
  { ref: '/timeclock/push_tests/{ek}', region: REGION, memory: MEMORY },
  async (event) => {
    if (!event.data.after.exists()) return;
    const ek = event.params.ek;
    const result = await sendTo(ek, {
      title: 'Test notification',
      body: 'Punch-in reminders are working on this phone, even with the time clock closed.',
      tag: 'tc-test'
    });
    logger.info('Test push', { ek, ...result });
    await admin.database().ref(`timeclock/push_tests/${ek}`).remove();
  }
);
