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

test('plans one reminder at start + reminder minutes', () => {
  const p = R.planFor(MON_0800 - 8 * 3600000, { reminderMinutes: 10 }, emp()); // planned at midnight
  assert.deepStrictEqual(p, { day: '2026-10-12', start: '08:00', dueAt: MON_0800 + 10 * MIN, until: MON_0800 + 10 * MIN + R.LATE_WINDOW_MS });
});

test('uses the admin reminder setting, and 10 minutes when unset', () => {
  assert.strictEqual(R.planFor(MON_0800, null, emp()).dueAt, MON_0800 + 10 * MIN);
  assert.strictEqual(R.planFor(MON_0800, { reminderMinutes: 15 }, emp()).dueAt, MON_0800 + 15 * MIN);
  assert.strictEqual(R.planFor(MON_0800, { reminderMinutes: 0 }, emp()).dueAt, MON_0800);
});

test('no reminder for inactive employees or days off', () => {
  assert.strictEqual(R.planFor(MON_0800, null, emp({ active: false })), null);
  assert.strictEqual(R.planFor(MON_0800, null, emp({ schedule: { tue: mon } })), null);
  assert.strictEqual(R.planFor(MON_0800, null, null), null);
});

test('no reminder more than 2 hours after it was due; an old saved end time is ignored', () => {
  for (const e of [emp(), emp({ schedule: { mon: { start: '08:00' } } })]) {
    assert.ok(R.planFor(MON_0800 + 10 * MIN + R.LATE_WINDOW_MS - MIN, null, e));
    assert.strictEqual(R.planFor(MON_0800 + 10 * MIN + R.LATE_WINDOW_MS, null, e), null);
  }
});

test('timer fires at the due time, or straight away when planned late', () => {
  const p = R.planFor(MON_0800 - 8 * 3600000, null, emp());
  assert.strictEqual(R.timerFor('a', p, MON_0800 - 8 * 3600000).fireAt, MON_0800 + 10 * MIN);
  const late = R.planFor(MON_0800 + 42 * MIN + 17000, null, emp()); // schedule changed at 8:42:17
  assert.strictEqual(R.timerFor('a', late, MON_0800 + 42 * MIN + 17000).fireAt, MON_0800 + 42 * MIN);
});

test('timer IDs: same plan -> same ID (never queued twice), different plan -> different ID', () => {
  const t0 = MON_0800 - 8 * 3600000;
  const p = R.planFor(t0, null, emp());
  const a = R.timerFor('matt@ec,com', p, t0).id;
  assert.strictEqual(a, R.timerFor('matt@ec,com', p, t0 + 3600000).id);
  assert.match(a, /^tc-[0-9a-f]{40}$/);
  assert.notStrictEqual(a, R.timerFor('gil@ec,com', p, t0).id);
  assert.notStrictEqual(a, R.timerFor('matt@ec,com', R.planFor(t0, { reminderMinutes: 15 }, emp()), t0).id);
  // Re-planned after the due time (fires immediately): a fresh ID, so it isn't blocked by the earlier timer
  assert.notStrictEqual(a, R.timerFor('matt@ec,com', p, MON_0800 + 20 * MIN).id);
});

test('a fired timer only counts if it still matches the current schedule', () => {
  const p = R.planFor(MON_0800 + 10 * MIN, null, emp());
  assert.strictEqual(R.isCurrent(p, { day: '2026-10-12', dueAt: MON_0800 + 10 * MIN }), true);
  const moved = R.planFor(MON_0800 + 10 * MIN, null, emp({ schedule: { mon: { start: '09:00', end: '17:00' } } }));
  assert.strictEqual(R.isCurrent(moved, { day: '2026-10-12', dueAt: MON_0800 + 10 * MIN }), false);
  assert.strictEqual(R.isCurrent(null, { day: '2026-10-12', dueAt: MON_0800 + 10 * MIN }), false);
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
