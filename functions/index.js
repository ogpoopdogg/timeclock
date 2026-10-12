/* E&C Time Clock – punch-in reminders that reach the phone even when the
   time clock app is closed.

   Every minute, timeclockPunchReminders looks for active employees whose
   scheduled start (admin panel → Employees) plus the reminder delay (admin
   panel → Settings) has passed today and who haven't punched in. Each of them
   gets one web push notification per day on every phone that turned on
   reminders. Phones save their push token under
   timeclock/push_tokens/<ek>/<key> (see setupPush in ../index.html).

   This is its own Firebase "codebase" (see ../firebase.json), so deploying it
   never touches the dispatch app's functions in the same project. */
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueWritten } = require('firebase-functions/v2/database');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const R = require('./reminders');

admin.initializeApp();

// The default Realtime Database lives in us-central1; database triggers must run in the same region.
const REGION = 'us-central1';
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

exports.timeclockPunchReminders = onSchedule(
  { schedule: 'every 1 minutes', timeZone: R.TZ, region: REGION, retryCount: 0, maxInstances: 1 },
  async () => {
    const db = admin.database();
    const now = Date.now();
    const today = R.dayKey(now);
    const [settingsSnap, employeesSnap, sentSnap] = await Promise.all([
      db.ref('timeclock/settings').once('value'),
      db.ref('timeclock/employees').once('value'),
      db.ref(`timeclock/reminders_sent/${today}`).once('value')
    ]);
    const due = R.dueCandidates(now, settingsSnap.val(), employeesSnap.val(), sentSnap.val());

    for (const c of due) {
      const sentRef = db.ref(`timeclock/reminders_sent/${today}/${c.ek}`);
      const shifts = (await db.ref(`timeclock/shifts/${c.ek}`)
        .orderByChild('in').startAt(now - 2 * DAY_MS).once('value')).val();
      if (R.hasPunchedToday(shifts, today)) {
        await sentRef.set({ at: now, skipped: 'punched in' });
        continue;
      }
      // Claim the reminder first so an overlapping run can never send it twice
      const claim = await sentRef.transaction((cur) => (cur ? undefined : { at: now }));
      if (!claim.committed) continue;
      try {
        const msg = R.reminderMessage(c.emp, c.start);
        const result = await sendTo(c.ek, { title: msg.title, body: msg.body, tag: 'tc-punch-reminder' });
        await sentRef.update(result);
        logger.info('Punch-in reminder', { ek: c.ek, start: c.start, ...result });
      } catch (err) {
        await sentRef.update({ error: String((err && err.message) || err).slice(0, 300) });
        logger.error('Punch-in reminder failed', { ek: c.ek, message: err && err.message });
      }
    }

    // Once a day, drop the per-day "already reminded" records older than KEEP_SENT_DAYS
    const z = R.zoned(now);
    if (z.hh === 3 && z.mm === 0) {
      const cutoff = R.addDaysKey(today, -KEEP_SENT_DAYS);
      const old = (await db.ref('timeclock/reminders_sent').orderByKey().endAt(cutoff).once('value')).val() || {};
      await Promise.all(Object.keys(old).map((k) => db.ref(`timeclock/reminders_sent/${k}`).remove()));
    }
  }
);

// "Send a test" in the time clock's Reminders card writes timeclock/push_tests/<ek>
exports.timeclockTestPush = onValueWritten({ ref: '/timeclock/push_tests/{ek}', region: REGION }, async (event) => {
  if (!event.data.after.exists()) return;
  const ek = event.params.ek;
  const result = await sendTo(ek, {
    title: 'Test notification',
    body: 'Punch-in reminders are working on this phone, even with the time clock closed.',
    tag: 'tc-test'
  });
  logger.info('Test push', { ek, ...result });
  await admin.database().ref(`timeclock/push_tests/${ek}`).remove();
});
