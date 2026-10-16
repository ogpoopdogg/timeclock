import test from 'node:test';
import assert from 'node:assert';
// Helpers behind the new features (tc-core.js). Run with: node --test tests/features.test.mjs
// tc-core.js loads Firebase from the web, so this test copies it with those imports stubbed out (as overtime.test.mjs does).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tc-core.js'), 'utf8')
  .replace(/^import .*?;\n/gm, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), 'core.mjs');
fs.writeFileSync(tmp, 'const initializeApp=()=>({}),getAuth=()=>({}),getDatabase=()=>({});const firebaseConfig={};\n' + src);
const { vanTime, sentLate, farFromShop, distanceM, timeOffOn, workdayFor, settingsWithDefaults, rangeDays, keyToEpoch, vehicleList, vanKey, isManualVan } = await import(pathToFileURL(tmp).href);
const H = 3600000, M = 60000;
const t0 = keyToEpoch('2026-10-12', '08:00');

test('hours per van: picks and swaps split the shift', () => {
  const shift = { in: t0, out: t0 + 9 * H, vans: {
    a: { at: t0 + 5 * M, how: 'pick', vehicleId: 'g7', vehicleName: '7' },
    b: { at: t0 + 3 * H, how: 'swap', vehicleId: 'g3', vehicleName: '3' }
  } };
  const r = Object.fromEntries(vanTime(shift, 0).map(v => [v.vehicleName, v.ms]));
  assert.deepStrictEqual(r, { 7: 3 * H - 5 * M, 3: 6 * H });
});

test('hours per van: taken and shop end a van\'s time; no history uses the shift\'s van', () => {
  const shift = { in: t0, out: t0 + 8 * H, vans: {
    a: { at: t0, how: 'pick', vehicleId: 'g7', vehicleName: '7' },
    b: { at: t0 + 2 * H, how: 'taken', takenId: 'g7' },
    c: { at: t0 + 2.5 * H, how: 'pick', vehicleId: 'g3', vehicleName: '3' },
    d: { at: t0 + 6 * H, how: 'shop' }
  } };
  const r = Object.fromEntries(vanTime(shift, 0).map(v => [v.vehicleName, v.ms]));
  assert.deepStrictEqual(r, { 7: 2 * H, 3: 3.5 * H });
  assert.deepStrictEqual(vanTime({ in: t0, out: t0 + H, vehicleId: 'g1', vehicleName: '1' }, 0), [{ vehicleId: 'g1', vehicleName: '1', ms: H }]);
  assert.deepStrictEqual(vanTime({ in: t0, out: t0 + H, shop: true }, 0), []);
});

test('hours per van: an admin change made after the shift corrects the whole shift', () => {
  const shift = { in: t0, out: t0 + 8 * H, vans: {
    a: { at: t0, how: 'pick', vehicleId: 'g7', vehicleName: '7' },
    b: { at: t0 + 30 * H, how: 'admin', vehicleId: 'g9', vehicleName: '9' }
  } };
  assert.deepStrictEqual(vanTime(shift, 0), [{ vehicleId: 'g9', vehicleName: '9', ms: 8 * H }]);
});

test('hours per van: an open shift counts up to now', () => {
  const shift = { in: t0, vans: { a: { at: t0, how: 'pick', vehicleId: 'g7', vehicleName: '7' } } };
  assert.deepStrictEqual(vanTime(shift, t0 + 2 * H), [{ vehicleId: 'g7', vehicleName: '7', ms: 2 * H }]);
});

test('punches sent late (no signal) are noticed after 2 minutes', () => {
  assert.deepStrictEqual(sentLate({ in: t0 + 40 * M, tap: t0, out: t0 + 9 * H, outTap: t0 + 9 * H - M }), { in: t0, out: null });
  assert.deepStrictEqual(sentLate({ in: t0, out: t0 + H }), { in: null, out: null });
});

test('far from the shop: only past the radius, only when a shop is set', () => {
  const shop = settingsWithDefaults({ shopLat: 49.8485, shopLng: -99.9501, shopRadius: 500 });
  assert.strictEqual(farFromShop({ lat: 49.8486, lng: -99.9502 }, shop), null);
  const d = farFromShop({ lat: 49.8485, lng: -99.9301 }, shop); // ~1.4 km east
  assert.ok(d > 1300 && d < 1500, String(d));
  assert.strictEqual(farFromShop({ lat: 49.9, lng: -99.9 }, settingsWithDefaults({})), null);
  assert.strictEqual(farFromShop({ err: 'denied' }, shop), null);
  assert.ok(Math.abs(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 10);
});

test('settings keep the shop location; a half-filled one is dropped', () => {
  assert.deepStrictEqual([settingsWithDefaults({}).shopRadius, 'shopLat' in settingsWithDefaults({ shopLat: 49 })], [500, false]);
  assert.strictEqual(settingsWithDefaults({ shopLat: '49.5', shopLng: '-99.9' }).shopLat, 49.5);
});

test('time off: only approved days take a day off the schedule', () => {
  const emp = { schedule: { mon: { start: '08:00' } } };
  const off = { a: { from: '2026-10-12', to: '2026-10-13', status: 'approved' }, b: { from: '2026-10-19', to: '2026-10-19', status: 'pending' } };
  assert.ok(timeOffOn(off, '2026-10-12'));
  assert.strictEqual(timeOffOn(off, '2026-10-19'), null);
  assert.strictEqual(workdayFor(emp, '2026-10-12', off), null);
  assert.deepStrictEqual(workdayFor(emp, '2026-10-19', off), { start: '08:00' });
});

test('date ranges include both ends', () => {
  assert.deepStrictEqual(rangeDays('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

// ---------- Vans without GPS ----------
test('vans without GPS are blended into the van list in name order', () => {
  const drivers = { g7: { name: '7', deviceId: 'x7' }, g3: { name: 'Van 3', deviceId: 'x3' }, gx: { name: 'No device' } };
  const vans = { van_a: { name: 'Van 12' }, van_b: { name: 'Van 5' }, van_c: { name: '' }, bad: { name: 'Van 9' } };
  const list = vehicleList(drivers, vans);
  assert.deepEqual(list.map(v => v.name), ['7', 'Van 3', 'Van 5', 'Van 12']);
  assert.deepEqual(list.map(v => !!v.manual), [false, false, true, true]);
  assert.equal(isManualVan('van_a'), true);
  assert.equal(isManualVan('g7'), false);
});

test('once a GPS unit is named after a van without GPS, the GPS unit replaces it', () => {
  assert.equal(vanKey('Van 12'), '12');
  assert.equal(vanKey('van12'), '12');
  assert.equal(vanKey(' 12 '), '12');
  const vans = { van_a: { name: 'Van 12' } };
  assert.deepEqual(vehicleList({}, vans).map(v => v.id), ['van_a']);
  assert.deepEqual(vehicleList({ g12: { name: '12', deviceId: 'x' } }, vans).map(v => v.id), ['g12']);
  assert.deepEqual(vehicleList({ g12: { name: 'VAN 12', deviceId: 'x' } }, vans).map(v => v.id), ['g12']);
});
