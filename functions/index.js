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
   A driver who turned the punch-in reminder off (timeclock/prefs/<ek>) isn't sent it.

   Vehicle swaps (see swaps.js):
   - timeclockVanTaken runs when a van changes hands in timeclock/vehicle_claims.
     The driver who had it is unassigned and notified straight away, and a timer
     is set for a reminder 10 minutes later.
   - timeclockVanSwapReminder is that timer: if they still haven't picked a van,
     it reminds them and sets the next one (3 reminders at most).

   New sign-ins (see signups.js):
   - timeclockBeforeUserCreated runs inside Firebase Authentication before any new
     account is saved. It refuses a new @ec.com account unless an admin already put
     that email on the time clock, so nobody can make themselves a staff sign-in
     through Request Pickup or by calling Firebase directly. Needs Firebase
     Authentication with Identity Platform (see README).

   This is its own Firebase "codebase" (see ../firebase.json), so deploying it
   never touches the dispatch app's functions in the same project.
   Memory is set explicitly (with the default 1 vCPU) so running costs are
   predictable; see README "Running cost". */
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { beforeUserCreated, HttpsError } = require('firebase-functions/v2/identity');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const R = require('./reminders');
const S = require('./swaps');
const G = require('./signups');

admin.initializeApp();

// The default Realtime Database lives in us-central1; database triggers must run in the same region.
const REGION = 'us-central1';
const MEMORY = '256MiB';
const REMINDER_FUNCTION = 'timeclockPunchReminder';
const SWAP_REMINDER_FUNCTION = 'timeclockVanSwapReminder';
const CLOCK_URL = S.CLOCK_URL;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_SENT_DAYS = 30;

// Tokens FCM reports as gone for good (site data cleared, notifications turned off, token rotated)
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

/** Sends one notification to every phone the employee registered. Returns { sent, failed, removed }. */
async function sendTo(ek, { title, body, tag, url }) {
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
    data: { title, body, tag, url: url || CLOCK_URL },
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
    await db.ref('timeclock/swap_reminders_sent').remove(); // only guards against a timer firing twice, minutes apart
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
    if (!S.wantsPunchReminder((await db.ref(`timeclock/prefs/${ek}`).once('value')).val())) {
      logger.info('Punch-in reminder turned off by the employee; skipped', { ek, day });
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
    const settingsSnap = await admin.database().ref('timeclock/settings').once('value');
    const result = await planEmployee(event.params.ek, emp, settingsSnap.val(), Date.now());
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

// ---------- Van swaps ----------

async function setSwapTimer(ek, shiftId, takenAt, n) {
  const timer = S.swapTimerFor(ek, shiftId, takenAt, n);
  try {
    await getFunctions().taskQueue(`locations/${REGION}/functions/${SWAP_REMINDER_FUNCTION}`).enqueue(
      { ek, shiftId, takenAt, n },
      { id: timer.id, scheduleTime: new Date(Math.max(timer.fireAt, Date.now())) }
    );
  } catch (err) {
    if (!(err && err.code === 'functions/task-already-exists')) throw err;
  }
}

// A driver picked a van another driver had (Van swap in the time clock, or the admin moved it):
// unassign the driver who had it and tell them to pick the van they're in now.
exports.timeclockVanTaken = onValueWritten(
  { ref: '/timeclock/vehicle_claims/{gpsId}', region: REGION, memory: MEMORY },
  async (event) => {
    const bump = S.bumpFrom(event.data.before.val(), event.data.after.val(), event.params.gpsId);
    if (!bump) return;
    // The database the trigger fired on (in the emulator, admin.database() can point at another namespace)
    const shiftRef = event.data.after.ref.root.child(`timeclock/shifts/${bump.ek}/${bump.shiftId}`);
    const takenAt = Date.now();
    const entryId = shiftRef.child('vans').push().key;
    // null in, null out: the first try may run before the shift is loaded, and is then retried with it
    const res = await shiftRef.transaction((cur) => (cur === null ? null : S.unassign(cur, bump, takenAt, entryId)));
    const shift = res.snapshot.val();
    if (!res.committed || !S.stillNeedsSwap(shift, takenAt)) {
      logger.info('Van changed hands; previous driver already off it', { gpsId: bump.gpsId, ek: bump.ek });
      return;
    }
    const msg = S.swapMessage(shift.swapHint, 0);
    const result = await sendTo(bump.ek, { title: msg.title, body: msg.body, tag: 'tc-van-swap', url: S.SWAP_URL });
    logger.info('Van taken; driver unassigned and notified', { gpsId: bump.gpsId, ek: bump.ek, by: bump.byEk, ...result });
    await setSwapTimer(bump.ek, bump.shiftId, takenAt, 1);
  }
);

// Follow-up reminder while the bumped driver still has no van
exports.timeclockVanSwapReminder = onTaskDispatched(
  { region: REGION, memory: MEMORY, retryConfig: { maxAttempts: 3, minBackoffSeconds: 60 }, rateLimits: { maxConcurrentDispatches: 6 } },
  async (req) => {
    const { ek, shiftId, takenAt, n } = req.data || {};
    if (typeof ek !== 'string' || typeof shiftId !== 'string' || typeof takenAt !== 'number' || typeof n !== 'number') return;
    const db = admin.database();
    const shift = (await db.ref(`timeclock/shifts/${ek}/${shiftId}`).once('value')).val();
    if (!S.stillNeedsSwap(shift, takenAt)) return; // picked a van, punched out, or lost another van since (that has its own reminders)
    // Claim this reminder first, so a repeated timer can never send it twice
    const sentRef = db.ref(`timeclock/swap_reminders_sent/${ek}/${shiftId}/${takenAt}_${n}`);
    const claim = await sentRef.transaction((cur) => (cur ? undefined : { at: Date.now() }));
    if (!claim.committed) return;
    const msg = S.swapMessage(shift.swapHint, n);
    const result = await sendTo(ek, { title: msg.title, body: msg.body, tag: 'tc-van-swap', url: S.SWAP_URL });
    logger.info('Van swap reminder', { ek, shiftId, n, ...result });
    if (n < S.SWAP_REMINDERS) await setSwapTimer(ek, shiftId, takenAt, n + 1);
  }
);

// Must answer within 7 seconds, or Firebase Authentication fails the sign-up
exports.timeclockBeforeUserCreated = beforeUserCreated(
  { region: REGION, memory: MEMORY },
  async (event) => {
    const email = event.data && event.data.email;
    if (!G.isStaffEmail(email)) return;
    const employee = (await admin.database().ref(`timeclock/employees/${G.emailKey(email)}`).once('value')).val();
    if (G.signupAllowed(email, employee)) return;
    logger.warn('Refused a new @ec.com sign-in that is not on the time clock', { email: G.normEmail(email) });
    throw new HttpsError('permission-denied', 'This email can only be added by an E&C admin.');
  }
);
