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
const { vanTime, sentLate, farFromShop, distanceM, oilState, hadVehicle, settingsWithDefaults, rangeDays, keyToEpoch, vehicleList, vanKey, isManualVan,
  cleanOilPlan, oilPlanFor, oilNextDue, oilDue } = await import(pathToFileURL(tmp).href);
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

test('oil check: only shifts with a vehicle; checked, not yet, or missed', () => {
  const picked = { a: { at: t0, how: 'pick', vehicleId: 'g7', vehicleName: '7' } };
  assert.strictEqual(oilState({ in: t0, shop: true, vans: { a: { at: t0, how: 'shop' } } }), 'none');  // Shop
  assert.strictEqual(oilState({ in: t0 }), 'none');                                                    // Not driving today
  assert.strictEqual(hadVehicle({ in: t0, vans: picked }), true);  // had a vehicle, later taken or moved to the shop
  assert.strictEqual(oilState({ in: t0, vehicleId: 'g7' }), 'waiting');
  assert.strictEqual(oilState({ in: t0, vehicleId: 'g7', oil: { done: true, at: t0, how: 'box' } }), 'checked');
  assert.strictEqual(oilState({ in: t0, out: t0 + H, vans: picked }), 'missed');                      // never answered
  assert.strictEqual(oilState({ in: t0, out: t0 + H, vans: picked, oil: { done: false, at: t0 + H, how: 'out' } }), 'missed');
  assert.strictEqual(oilState({ in: t0, out: t0 + H, vans: picked, oil: { done: true, at: t0 + H, how: 'out' } }), 'checked');
});

test('oil check: a vehicle whose check wasn\'t due is left out', () => {
  assert.strictEqual(oilState({ in: t0, vehicleId: 'g7', oil: { due: false, at: t0 } }), 'notdue');
  assert.strictEqual(oilState({ in: t0, out: t0 + H, vehicleId: 'g7', oil: { due: false, at: t0 } }), 'notdue');
  assert.strictEqual(oilState({ in: t0, vehicleId: 'g7', oil: { due: true, at: t0 } }), 'waiting');
  assert.strictEqual(oilState({ in: t0, out: t0 + H, vehicleId: 'g7', oil: { due: true, at: t0 } }), 'missed');
});

// ---------- Oil check schedule ----------
// 2026-10-12 is a Monday
const day = (k, hhmm) => keyToEpoch(k, hhmm || '09:00');
const last = k => ({ at: day(k, '07:30') });
test('oil schedule: every shift unless the office picks something else', () => {
  assert.deepStrictEqual(cleanOilPlan(null), { mode: 'shift' });
  assert.deepStrictEqual(cleanOilPlan({ mode: 'nope' }), { mode: 'shift' });
  assert.strictEqual(oilDue(null, null, t0), true);
  assert.strictEqual(oilDue({ mode: 'shift' }, last('2026-10-12'), t0), true);  // even if checked earlier that day
  assert.strictEqual(oilDue({ mode: 'never' }, null, t0), false);
  assert.strictEqual(oilNextDue({ mode: 'never' }, null, t0), null);
});
test('oil schedule: once every few days, counted from the last check', () => {
  const p = { mode: 'every', every: 3 };
  assert.strictEqual(oilDue(p, null, t0), true);                                // never checked
  assert.strictEqual(oilNextDue(p, last('2026-10-12'), t0), '2026-10-15');
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-14')), false);
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-15')), true);
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-20')), true);   // nobody drove it for a while
  assert.strictEqual(oilDue({ mode: 'every', every: 1 }, last('2026-10-12'), day('2026-10-12', '15:00')), false); // once a day
  assert.strictEqual(oilDue({ mode: 'every', every: 1 }, last('2026-10-12'), day('2026-10-13', '06:00')), true);
  assert.strictEqual(cleanOilPlan({ mode: 'every', every: 500 }).every, 60);
  assert.strictEqual(cleanOilPlan({ mode: 'every', every: 'x' }).every, 1);
});
test('oil schedule: chosen days of the week, and a missed day carries over', () => {
  const p = { mode: 'days', days: { mon: true, thu: true } };
  assert.strictEqual(oilDue(p, null, day('2026-10-13')), true);                  // never checked
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-12', '15:00')), false); // Monday, already checked
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-14')), false);   // Wednesday
  assert.strictEqual(oilNextDue(p, last('2026-10-12'), day('2026-10-14')), '2026-10-15');
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-15')), true);    // Thursday
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-17')), true);    // nobody checked it Thursday
  assert.strictEqual(oilNextDue(p, last('2026-10-16'), day('2026-10-17')), '2026-10-19'); // next Monday
  assert.deepStrictEqual(cleanOilPlan({ mode: 'days', days: {} }), { mode: 'shift' });
  assert.deepStrictEqual(cleanOilPlan({ mode: 'days', days: { mon: true, xyz: true, tue: false } }).days, { mon: true });
});
test('oil schedule: the office can ask for a check on the next shift', () => {
  const p = { mode: 'every', every: 7, askFrom: day('2026-10-13', '08:00') };
  assert.strictEqual(oilDue(p, last('2026-10-12'), day('2026-10-13')), true);
  assert.strictEqual(oilDue(p, { at: day('2026-10-13', '10:00') }, day('2026-10-13', '11:00')), false); // checked since
  assert.strictEqual('askFrom' in cleanOilPlan({ mode: 'never', askFrom: 1 }), false);
});
test('oil schedule: each vehicle by its name, or the default', () => {
  const plans = { def: { mode: 'every', every: 2 }, vehicles: { '12': { mode: 'never' } } };
  assert.deepStrictEqual(oilPlanFor(plans, 'Van 12'), { mode: 'never', own: true });
  assert.deepStrictEqual(oilPlanFor(plans, '12'), { mode: 'never', own: true });
  assert.deepStrictEqual(oilPlanFor(plans, 'Van 3'), { mode: 'every', every: 2 });
  assert.deepStrictEqual(oilPlanFor(null, 'Van 3'), { mode: 'shift' });
  const asked = Object.assign({ ask: { '3': 5 } }, plans);
  assert.deepStrictEqual(oilPlanFor(asked, 'Van 3'), { mode: 'every', every: 2, askFrom: 5 });
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
  assert.equal(vanKey('Vehicle 12'), '12');
  assert.equal(vanKey('van12'), '12');
  assert.equal(vanKey(' 12 '), '12');
  const vans = { van_a: { name: 'Van 12' } };
  assert.deepEqual(vehicleList({}, vans).map(v => v.id), ['van_a']);
  assert.deepEqual(vehicleList({ g12: { name: '12', deviceId: 'x' } }, vans).map(v => v.id), ['g12']);
  assert.deepEqual(vehicleList({ g12: { name: 'VAN 12', deviceId: 'x' } }, vans).map(v => v.id), ['g12']);
});
