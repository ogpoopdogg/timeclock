/* E&C Time Clock – who should get a punch-in reminder right now.
   Pure functions only (no Firebase), so they can be tested with `node --test`.
   The time helpers mirror tc-core.js in the web app: all schedule times are
   Brandon, MB wall-clock times (America/Winnipeg), whatever the server's zone. */
'use strict';

const crypto = require('crypto');

const TZ = 'America/Winnipeg';
const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_SETTINGS = { reminderMinutes: 10, weekStart: 5 };
// Stop trying this long after the reminder was due
// (e.g. a schedule edited late in the day: don't remind someone at 3 PM about 8 AM)
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
 * Today's single reminder for one employee, or null when there is none to send:
 * inactive, not scheduled today, or already past the point where a reminder is useful.
 * dueAt = scheduled start + reminder delay; until = dueAt + 2 h. Schedules only have a
 * start time (drivers work irregular hours); an old saved end time is ignored.
 */
function planFor(now, settings, emp) {
  if (!emp || emp.active === false) return null;
  const s = settingsWithDefaults(settings);
  const day = dayKey(now);
  const sched = scheduleFor(emp, day);
  if (!sched) return null;
  const dueAt = keyToEpoch(day, sched.start) + s.reminderMinutes * 60000;
  const until = dueAt + LATE_WINDOW_MS;
  if (now >= until) return null;
  return { day: day, start: sched.start, dueAt: dueAt, until: until };
}

/**
 * When to fire the one-shot timer for a plan, and its Cloud Tasks ID.
 * Normally it fires at dueAt. If the plan is made after dueAt (schedule changed to an
 * earlier time, or the daily planner ran late), it fires straight away instead.
 * The ID is the same for the same plan, so planning twice never queues two timers,
 * and it is a hash, which spreads IDs evenly the way Cloud Tasks recommends.
 */
function timerFor(ek, plan, now) {
  const fireAt = plan.dueAt > now ? plan.dueAt : Math.floor(now / 60000) * 60000;
  const id = 'tc-' + crypto.createHash('sha256').update(ek + '|' + plan.day + '|' + plan.dueAt + '|' + fireAt).digest('hex').slice(0, 40);
  return { id: id, fireAt: fireAt };
}

/** True when a timer that has just fired still matches the employee's current plan. */
function isCurrent(plan, payload) {
  return !!(plan && payload && plan.day === payload.day && plan.dueAt === payload.dueAt);
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
  scheduleFor, planFor, timerFor, isCurrent, hasPunchedToday, reminderMessage, firstName
};
