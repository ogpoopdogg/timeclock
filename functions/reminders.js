/* E&C Time Clock – who should get a punch-in reminder right now.
   Pure functions only (no Firebase), so they can be tested with `node --test`.
   The time helpers mirror tc-core.js in the web app: all schedule times are
   Brandon, MB wall-clock times (America/Winnipeg), whatever the server's zone. */
'use strict';

const TZ = 'America/Winnipeg';
const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_SETTINGS = { reminderMinutes: 10, weekStart: 1 };
// With no scheduled end time, stop trying this long after the reminder was due
// (e.g. the function was down for a while: don't remind someone at 3 PM about 8 AM)
const LATE_WINDOW_MS = 2 * 60 * 60 * 1000;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});

function zoned(ts) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(ts))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: parseInt(o.hour, 10) % 24, mm: +o.minute, ss: +o.second, dow: DOW_SHORT.indexOf(o.weekday) };
}

function tzOffset(ts) {
  const z = zoned(ts);
  return Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm, z.ss) - Math.floor(ts / 1000) * 1000;
}

function epochFromZoned(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  return guess - tzOffset(guess - tzOffset(guess));
}

const pad2 = (n) => String(n).padStart(2, '0');
function dayKey(ts) { const z = zoned(ts); return z.y + '-' + pad2(z.m) + '-' + pad2(z.d); }
function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dowOfKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
function keyToEpoch(key, hhmm) {
  const [y, m, d] = key.split('-').map(Number);
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number);
  return epochFromZoned(y, m, d, hh, mm);
}

function settingsWithDefaults(v) {
  const s = Object.assign({}, DEFAULT_SETTINGS, v || {});
  const n = parseInt(s.reminderMinutes, 10);
  s.reminderMinutes = isFinite(n) ? Math.min(240, Math.max(0, n)) : DEFAULT_SETTINGS.reminderMinutes;
  return s;
}

function scheduleFor(emp, key) {
  const day = emp && emp.schedule ? emp.schedule[DOW_KEYS[dowOfKey(key)]] : null;
  return day && /^\d{2}:\d{2}$/.test(day.start || '') ? day : null;
}

function fmtHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h % 12 || 12) + ':' + pad2(m) + ' ' + (h < 12 ? 'AM' : 'PM');
}

function firstName(emp) {
  const name = emp && typeof emp.name === 'string' ? emp.name.trim() : '';
  if (name) return name.split(/\s+/)[0];
  const local = String((emp && emp.email) || '').split('@')[0].split(/[._-]+/)[0] || '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
}

/**
 * Employees whose reminder is due now and hasn't been handled today.
 * sentToday: { [ek]: anything } for today's date (reminders already sent or skipped).
 * Returns [{ ek, emp, start, dueAt }]. The caller still checks their punches.
 */
function dueCandidates(now, settings, employees, sentToday) {
  const s = settingsWithDefaults(settings);
  const today = dayKey(now);
  const out = [];
  for (const [ek, emp] of Object.entries(employees || {})) {
    if (!emp || emp.active === false) continue;
    if (sentToday && sentToday[ek]) continue;
    const sched = scheduleFor(emp, today);
    if (!sched) continue;
    const startTs = keyToEpoch(today, sched.start);
    const dueAt = startTs + s.reminderMinutes * 60000;
    let until = dueAt + LATE_WINDOW_MS;
    if (sched.end && /^\d{2}:\d{2}$/.test(sched.end)) {
      const endTs = keyToEpoch(today, sched.end);
      if (endTs > dueAt) until = endTs;
    }
    if (now >= dueAt && now < until) out.push({ ek: ek, emp: emp, start: sched.start, dueAt: dueAt });
  }
  return out;
}

/** True if any shift started today, or a shift is still open (punched in yesterday and never out). */
function hasPunchedToday(shiftsObj, today) {
  return Object.values(shiftsObj || {}).some((s) => s && typeof s.in === 'number' &&
    (dayKey(s.in) === today || typeof s.out !== 'number'));
}

function reminderMessage(emp, start) {
  const name = firstName(emp);
  return {
    title: 'Time to punch in',
    body: (name ? name + ', your' : 'Your') + ' shift started at ' + fmtHHMM(start) + '. Open the time clock and hold the button to punch in.'
  };
}

module.exports = {
  TZ, DOW_KEYS, LATE_WINDOW_MS, zoned, dayKey, addDaysKey, keyToEpoch, settingsWithDefaults,
  scheduleFor, dueCandidates, hasPunchedToday, reminderMessage, firstName
};
