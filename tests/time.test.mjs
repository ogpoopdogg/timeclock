import test from 'node:test';
import assert from 'node:assert';
// Brandon time (tc-core.js): Manitoba stays on UTC-5 all year from 2026-11-01, whatever the device's time zone data says.
// Run with: node --test tests/time.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tc-core.js'), 'utf8')
  .replace(/^import .*?;\n/gm, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), 'core.mjs');
fs.writeFileSync(tmp, 'const initializeApp=()=>({}),getAuth=()=>({}),initializeAuth=()=>({}),indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},getDatabase=()=>({});const firebaseConfig={};\n' + src);
const { keyToEpoch, dayKey, hhmmOf, fmtTime, fmtKey, zoned, shiftMs, longShift, settingsWithDefaults } = await import(pathToFileURL(tmp).href);
const H = 3600000;

test('before the change: summer time, UTC-5', () => {
  assert.strictEqual(new Date(keyToEpoch('2026-10-26', '08:00')).toISOString(), '2026-10-26T13:00:00.000Z');
  assert.strictEqual(fmtTime(Date.parse('2026-10-26T13:00:00Z')), '8:00 AM');
});

test('no fall back on 2026-11-01: still UTC-5', () => {
  for (const [key, hhmm, iso] of [['2026-11-01', '00:30', '2026-11-01T05:30:00.000Z'], ['2026-11-01', '01:30', '2026-11-01T06:30:00.000Z'],
    ['2026-11-01', '02:30', '2026-11-01T07:30:00.000Z'], ['2026-11-01', '08:00', '2026-11-01T13:00:00.000Z']]) {
    assert.strictEqual(new Date(keyToEpoch(key, hhmm)).toISOString(), iso, key + ' ' + hhmm);
    assert.strictEqual(hhmmOf(Date.parse(iso)), hhmm);
  }
});

test('winter and next spring stay on UTC-5', () => {
  assert.strictEqual(new Date(keyToEpoch('2026-12-15', '08:00')).toISOString(), '2026-12-15T13:00:00.000Z');
  assert.strictEqual(fmtTime(Date.parse('2026-12-15T13:00:00Z')), '8:00 AM');
  assert.strictEqual(new Date(keyToEpoch('2027-03-14', '02:30')).toISOString(), '2027-03-14T07:30:00.000Z');
  assert.strictEqual(new Date(keyToEpoch('2027-07-01', '08:00')).toISOString(), '2027-07-01T13:00:00.000Z');
});

test('days and weekdays come out right after the change', () => {
  assert.strictEqual(dayKey(Date.parse('2026-12-16T04:59:00Z')), '2026-12-15'); // 11:59 PM
  assert.strictEqual(dayKey(Date.parse('2026-12-16T05:00:00Z')), '2026-12-16'); // midnight
  assert.strictEqual(zoned(Date.parse('2026-12-16T05:00:00Z')).dow, 3);           // Wednesday
  assert.strictEqual(fmtKey('2026-12-16'), 'Wed, Dec 16');
});

test('a shift over the night of the change counts its real hours', () => {
  const s = { id: 'a', in: keyToEpoch('2026-10-31', '22:00'), out: keyToEpoch('2026-11-01', '06:00') };
  assert.strictEqual(shiftMs(s, 0) / H, 8);
});

test('long shifts: at or over the office limit (default 14 h)', () => {
  const s = (hours, out) => ({ in: Date.parse('2026-12-15T13:00:00Z'), out: out ? Date.parse('2026-12-15T13:00:00Z') + hours * H : undefined });
  assert.strictEqual(longShift(s(13.9, true), {}, 0), null);
  assert.strictEqual(longShift(s(14, true), {}, 0), 14 * H);
  assert.strictEqual(longShift(s(10, true), { longShiftHours: 10 }, 0), 10 * H);
  assert.strictEqual(longShift(s(0, false), {}, Date.parse('2026-12-16T05:00:00Z')), 16 * H); // still on the clock
  assert.strictEqual(settingsWithDefaults({ longShiftHours: 99 }).longShiftHours, 24);
  assert.strictEqual(settingsWithDefaults({ longShiftHours: 1 }).longShiftHours, 4);
});
