import test from 'node:test';
import assert from 'node:assert';
// Overtime rules (tc-core.js weekTotals). Run with: node --test tests/overtime.test.mjs
// tc-core.js loads Firebase from the web, so this test copies it with those imports stubbed out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tc-core.js'), 'utf8')
  .replace(/^import .*?;\n/gm, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), 'core.mjs');
fs.writeFileSync(tmp, 'const initializeApp=()=>({}),getAuth=()=>({}),initializeAuth=()=>({}),indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},getDatabase=()=>({});const firebaseConfig={},ALLOWED_EMAIL="justin@ec.com";\n' + src);
const { weekTotals, weekDays, keyToEpoch, punchMinute, shiftMs } = await import(pathToFileURL(tmp).href);
const H = 3600000, days = weekDays('2026-10-12'); // Mon 12 – Sun 18
const at = (k, hh) => keyToEpoch(k, hh);
let n = 0;
const shift = (k, start, hours) => ({ id: 's' + (n++), in: at(k, start), out: at(k, start) + hours * H });
const h = ms => ms / H;
const sum = (list) => { const r = weekTotals(list, days, Date.now()); return { total: h(r.total), reg: h(r.regular), ot: h(r.overtime), r }; };

test('no overtime: five 8-hour days', () => {
  const r = sum(days.slice(0, 5).map(k => shift(k, '08:00', 8)));
  assert.deepStrictEqual([r.total, r.reg, r.ot], [40, 40, 0]);
});
test('daily overtime: one 10-hour day = 8 regular + 2 OT', () => {
  const r = sum([shift(days[0], '07:00', 10)]);
  assert.deepStrictEqual([r.reg, r.ot], [8, 2]);
  assert.deepStrictEqual([h(r.r.byDay[days[0]].regular), h(r.r.byDay[days[0]].overtime)], [8, 2]);
});
test('daily threshold counts all shifts that day: 5 h + 5 h = 8 regular + 2 OT (OT on the 2nd shift)', () => {
  const a = shift(days[0], '06:00', 5), b = shift(days[0], '13:00', 5);
  const r = sum([b, a]); // out of order on purpose
  assert.deepStrictEqual([r.reg, r.ot], [8, 2]);
  assert.deepStrictEqual([h(r.r.byShift[a.id].overtime), h(r.r.byShift[b.id].overtime)], [0, 2]);
});
test('five 9-hour days = 40 regular + 5 OT (daily OT not counted toward 40)', () => {
  const r = sum(days.slice(0, 5).map(k => shift(k, '08:00', 9)));
  assert.deepStrictEqual([r.total, r.reg, r.ot], [45, 40, 5]);
});
test('no weekly overtime: six 8-hour days = 48 regular + 0 OT', () => {
  const r = sum(days.slice(0, 6).map(k => shift(k, '08:00', 8)));
  assert.deepStrictEqual([r.total, r.reg, r.ot], [48, 48, 0]);
  assert.strictEqual(h(r.r.byDay[days[5]].overtime), 0);
});
test('mixed: 10,10,10,10,6 = 38 regular (8+8+8+8+6) + 8 daily OT', () => {
  const r = sum([10, 10, 10, 10, 6].map((x, i) => shift(days[i], '07:00', x)));
  assert.deepStrictEqual([r.total, r.reg, r.ot], [46, 38, 8]);
});
test('only daily OT past 40 h: 4×10 h then 9 h = 40 reg + 9 daily OT', () => {
  const r = sum([10, 10, 10, 10, 9].map((x, i) => shift(days[i], '07:00', x)));
  // Mon–Thu: 8 reg + 2 OT each; the 5th day: 8 reg + 1 OT
  assert.deepStrictEqual([r.total, r.reg, r.ot], [49, 40, 9]);
});
test('no weekly overtime: 7×7 h = 49 regular + 0 OT', () => {
  const r = sum(days.map(k => shift(k, '08:00', 7)));
  assert.deepStrictEqual([r.total, r.reg, r.ot], [49, 49, 0]);
});
test('long week of daily OT: 7×10 h = 56 regular + 14 OT', () => {
  const r = sum(days.map(k => shift(k, '07:00', 10)));
  assert.deepStrictEqual([r.total, r.reg, r.ot], [70, 56, 14]);
  days.forEach(k => assert.deepStrictEqual([h(r.r.byDay[k].regular), h(r.r.byDay[k].overtime)], [8, 2]));
});
test('shifts outside the week are ignored; open shift counts up to now', () => {
  const now = at(days[0], '18:00');
  const r = weekTotals([{ id: 'x', in: at('2026-10-11', '08:00'), out: at('2026-10-11', '20:00') }, { id: 'o', in: at(days[0], '08:00') }], days, now);
  assert.deepStrictEqual([h(r.total), h(r.regular), h(r.overtime)], [10, 8, 2]);
});

// Hours count to the minute: each punch is the minute on the clock, seconds don't count
test('punches count to the minute', () => {
  const t = (hhmm, sec) => at(days[0], hhmm) + (sec || 0) * 1000;
  assert.equal(punchMinute(t('17:01')), t('17:01'));
  assert.equal(punchMinute(t('17:07', 59)), t('17:07')); // seconds don't count
  assert.equal(punchMinute(t('17:08', 1)), t('17:08'));
  assert.equal(punchMinute(t('23:59', 59)), t('23:59'));
});

test('hours and overtime count to the minute', () => {
  // 7:58:40 to 4:03:10 counts as 7:58 to 4:03: 8 h 05 m, so 8 regular + 5 minutes overtime
  const s = { id: 'r', in: at(days[0], '07:58') + 40000, out: at(days[0], '16:03') + 10000 };
  assert.equal(shiftMs(s), 8 * H + 5 * 60000);
  const r = sum([s]);
  assert.equal(r.r.regular, 8 * H); assert.equal(r.r.overtime, 5 * 60000);
  // 6:53 to 3:08 is 8 h 15 m: no rounding to quarter hours any more
  assert.equal(shiftMs({ in: at(days[0], '06:53'), out: at(days[0], '15:08') }), 8 * H + 15 * 60000);
  // A 5-minute punch counts as 5 minutes
  assert.equal(shiftMs({ in: at(days[0], '09:01'), out: at(days[0], '09:06') }), 5 * 60000);
  // One minute past 8 hours is one minute of overtime
  const one = sum([{ id: 'o', in: at(days[0], '08:00'), out: at(days[0], '16:01') }]).r;
  assert.equal(one.regular, 8 * H); assert.equal(one.overtime, 60000);
});
