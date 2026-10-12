// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('./reminders');

const at = (iso) => Date.parse(iso);
const mon = { start: '08:00', end: '16:30' };
const emp = (over) => Object.assign({ email: 'matt@ec.com', name: 'Matt Smith', active: true, schedule: { mon } }, over);
// Monday 2026-10-12. Central Daylight Time is UTC-5, so 08:00 in Brandon is 13:00 UTC.
const MON_0800 = at('2026-10-12T13:00:00Z');
const MIN = 60000;

test('schedule times are Brandon time, across daylight saving changes', () => {
  assert.strictEqual(R.keyToEpoch('2026-10-12', '08:00'), MON_0800);
  assert.strictEqual(R.keyToEpoch('2026-03-07', '08:00'), at('2026-03-07T14:00:00Z')); // CST, UTC-6
  assert.strictEqual(R.keyToEpoch('2026-03-08', '08:00'), at('2026-03-08T13:00:00Z')); // CDT from 2 AM that day
  assert.strictEqual(R.keyToEpoch('2026-11-01', '08:00'), at('2026-11-01T14:00:00Z')); // back to CST
  assert.strictEqual(R.dayKey(at('2026-10-13T04:59:00Z')), '2026-10-12'); // 11:59 PM Monday in Brandon
  assert.strictEqual(R.dayKey(at('2026-10-13T05:00:00Z')), '2026-10-13');
});

test('not due before start + reminder minutes', () => {
  const e = { 'matt@ec,com': emp() };
  assert.deepStrictEqual(R.dueCandidates(MON_0800 + 9 * MIN, { reminderMinutes: 10 }, e, null), []);
});

test('due from start + reminder minutes', () => {
  const e = { 'matt@ec,com': emp() };
  const due = R.dueCandidates(MON_0800 + 10 * MIN, { reminderMinutes: 10 }, e, null);
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].ek, 'matt@ec,com');
  assert.strictEqual(due[0].dueAt, MON_0800 + 10 * MIN);
});

test('uses the admin reminder setting, and 10 minutes when unset', () => {
  const e = { 'matt@ec,com': emp() };
  assert.strictEqual(R.dueCandidates(MON_0800 + 10 * MIN, null, e, null).length, 1);
  assert.strictEqual(R.dueCandidates(MON_0800 + 10 * MIN, { reminderMinutes: 15 }, e, null).length, 0);
  assert.strictEqual(R.dueCandidates(MON_0800 + 15 * MIN, { reminderMinutes: 15 }, e, null).length, 1);
});

test('skips inactive employees, days off, and people already handled today', () => {
  const t = MON_0800 + 20 * MIN;
  assert.strictEqual(R.dueCandidates(t, null, { a: emp({ active: false }) }, null).length, 0);
  assert.strictEqual(R.dueCandidates(t, null, { a: emp({ schedule: { tue: mon } }) }, null).length, 0);
  assert.strictEqual(R.dueCandidates(t, null, { a: emp() }, { a: { at: 1 } }).length, 0);
  assert.strictEqual(R.dueCandidates(t, null, { a: emp(), b: emp() }, { a: { at: 1 } }).length, 1);
});

test('stops at the scheduled end, or 2 hours after due when there is no end', () => {
  const e = { a: emp() };
  const end = R.keyToEpoch('2026-10-12', '16:30');
  assert.strictEqual(R.dueCandidates(end - MIN, null, e, null).length, 1);
  assert.strictEqual(R.dueCandidates(end, null, e, null).length, 0);
  const noEnd = { a: emp({ schedule: { mon: { start: '08:00' } } }) };
  assert.strictEqual(R.dueCandidates(MON_0800 + 10 * MIN + R.LATE_WINDOW_MS - MIN, null, noEnd, null).length, 1);
  assert.strictEqual(R.dueCandidates(MON_0800 + 10 * MIN + R.LATE_WINDOW_MS, null, noEnd, null).length, 0);
});

test('punched in today, or still on the clock from yesterday, counts as punched', () => {
  const today = '2026-10-12';
  assert.strictEqual(R.hasPunchedToday(null, today), false);
  assert.strictEqual(R.hasPunchedToday({ s: { in: MON_0800 - 30 * MIN, out: MON_0800 } }, today), true);
  assert.strictEqual(R.hasPunchedToday({ s: { in: MON_0800 - 20 * 3600000 } }, today), true); // open since Sunday
  assert.strictEqual(R.hasPunchedToday({ s: { in: MON_0800 - 24 * 3600000, out: MON_0800 - 16 * 3600000 } }, today), false);
});

test('reminder text uses the first name and the scheduled start', () => {
  assert.deepStrictEqual(R.reminderMessage(emp(), '08:00'), {
    title: 'Time to punch in',
    body: 'Matt, your shift started at 8:00 AM. Open the time clock and hold the button to punch in.'
  });
  assert.strictEqual(R.reminderMessage({ email: 'gil@ec.com' }, '13:30').body.slice(0, 33), 'Gil, your shift started at 1:30 P');
});
