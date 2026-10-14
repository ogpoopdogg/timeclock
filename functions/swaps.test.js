// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('./swaps');

const claim = (over) => Object.assign({ ek: 'matt@ec,com', name: 'Matt Smith', nickname: 'Matt', shiftId: 's1', vehicleName: '7', at: 1 }, over);
const justin = { ek: 'justin@ec,com', name: 'Justin Reid', nickname: 'Justin', shiftId: 's9', vehicleName: '7', at: 2, fromId: 'g3', fromName: '3' };

test('a van changing hands bumps the driver who had it, and suggests the van the taker left', () => {
  assert.deepStrictEqual(S.bumpFrom(claim(), justin, 'g7'), {
    ek: 'matt@ec,com', shiftId: 's1', gpsId: 'g7', vehicleName: '7', by: 'Justin', byEk: 'justin@ec,com', suggestId: 'g3', suggestName: '3'
  });
  // Taker had no van before: nothing to suggest
  const b = S.bumpFrom(claim(), Object.assign({}, justin, { fromId: null, fromName: null }), 'g7');
  assert.strictEqual(b.suggestId, null);
  assert.strictEqual(b.suggestName, null);
});

test('new claims, releases and re-picks are not swaps', () => {
  assert.strictEqual(S.bumpFrom(null, justin, 'g7'), null);              // van was free
  assert.strictEqual(S.bumpFrom(claim(), null, 'g7'), null);             // van released
  assert.strictEqual(S.bumpFrom(claim(), claim({ at: 5 }), 'g7'), null); // same driver
  assert.strictEqual(S.bumpFrom(claim({ shiftId: '' }), justin, 'g7'), null);
});

const bump = S.bumpFrom(claim(), justin, 'g7');
const openShift = () => ({ in: 100, vehicleId: 'g7', vehicleName: '7', nickname: 'Matt', vans: { a: { at: 100, vehicleId: 'g7', vehicleName: '7', how: 'pick' } } });

test('unassigning clears the van, records it in the history, and leaves a hint for the van picker', () => {
  const next = S.unassign(openShift(), bump, 500, 'b');
  assert.strictEqual(next.vehicleId, null);
  assert.strictEqual(next.vehicleName, null);
  assert.strictEqual(next.nickname, null);
  assert.deepStrictEqual(next.swapHint, { at: 500, by: 'Justin', byEk: 'justin@ec,com', vehicleId: 'g7', vehicleName: '7', suggestId: 'g3', suggestName: '3' });
  assert.deepStrictEqual(next.vans.a, openShift().vans.a); // earlier history kept
  assert.deepStrictEqual(next.vans.b, { at: 500, vehicleId: null, vehicleName: null, how: 'taken', by: 'Justin', takenId: 'g7', takenName: '7' });
  assert.strictEqual(next.in, 100);
});

test('a closed shift, or a driver already in another van, is left alone', () => {
  assert.strictEqual(S.unassign(Object.assign(openShift(), { out: 200 }), bump, 500, 'b'), undefined);
  assert.strictEqual(S.unassign(Object.assign(openShift(), { vehicleId: 'g4' }), bump, 500, 'b'), undefined);
  assert.strictEqual(S.unassign(null, bump, 500, 'b'), undefined);
});

test('reminders continue only while the driver has no van since that van was taken', () => {
  const bumped = S.unassign(openShift(), bump, 500, 'b');
  assert.strictEqual(S.stillNeedsSwap(bumped, 500), true);
  assert.strictEqual(S.stillNeedsSwap(Object.assign({}, bumped, { vehicleId: 'g3' }), 500), false); // picked a van
  assert.strictEqual(S.stillNeedsSwap(Object.assign({}, bumped, { out: 900 }), 500), false);        // punched out
  assert.strictEqual(S.stillNeedsSwap(bumped, 499), false);                                         // a newer swap has its own reminders
  assert.strictEqual(S.stillNeedsSwap(null, 500), false);
});

test('reminder timers: every 10 minutes, stable IDs Cloud Tasks accepts', () => {
  const t1 = S.swapTimerFor('matt@ec,com', 's1', 500, 1);
  const t3 = S.swapTimerFor('matt@ec,com', 's1', 500, 3);
  assert.strictEqual(t1.fireAt, 500 + 10 * 60000);
  assert.strictEqual(t3.fireAt, 500 + 30 * 60000);
  assert.strictEqual(t1.id, S.swapTimerFor('matt@ec,com', 's1', 500, 1).id);
  assert.notStrictEqual(t1.id, t3.id);
  assert.match(t1.id, /^vs-[0-9a-f]{40}$/);
  assert.strictEqual(S.SWAP_REMINDERS, 3);
});

test('notification text', () => {
  const hint = S.unassign(openShift(), bump, 500, 'b').swapHint;
  assert.deepStrictEqual(S.swapMessage(hint, 0), {
    title: 'Van swap needed',
    body: 'Justin took van 7. Are you in van 3 now? Open the time clock and tap Van swap to confirm the van you\'re in.'
  });
  assert.strictEqual(S.swapMessage(Object.assign({}, hint, { suggestName: null }), 0).body,
    'Justin took van 7. Open the time clock, tap Van swap and pick the van you\'re in.');
  assert.deepStrictEqual(S.swapMessage(hint, 2), {
    title: 'Reminder: van swap',
    body: 'You\'re on the clock without a van since Justin took van 7. Open the time clock, tap Van swap and pick the van you\'re in.'
  });
  assert.strictEqual(S.swapMessage({ vehicleName: '7' }, 0).body.startsWith('Van 7 was given to another driver.'), true);
  assert.strictEqual(S.SWAP_URL, 'https://app.eandccourier.ca/timeclock/?swap=1');
});

test('punch-in reminder is skipped only when the driver turned it off', () => {
  assert.strictEqual(S.wantsPunchReminder(null), true);            // never chose: as before
  assert.strictEqual(S.wantsPunchReminder({}), true);
  assert.strictEqual(S.wantsPunchReminder({ punchReminder: true }), true);
  assert.strictEqual(S.wantsPunchReminder({ punchReminder: false }), false);
});

test('address lookups: punch in, punch out and van swaps that have a location but no address yet', () => {
  const shift = {
    inLoc: { lat: 49.84, lng: -99.95, acc: 8 }, inAddr: '123 Main St',
    outLoc: { lat: 49.85, lng: -99.96, acc: 12 },
    vans: {
      a: { at: 1, vehicleId: 'g7', loc: { lat: 49.8, lng: -99.9 } },
      b: { at: 2, vehicleId: 'g3', loc: { err: 'denied' } },
      c: { at: 3, vehicleId: 'g4', loc: { lat: 49.7, lng: -99.8 }, addrErr: 'ZERO_RESULTS' },
      d: { at: 4, how: 'taken' }
    }
  };
  assert.deepStrictEqual(S.addressJobs(shift), [
    { lat: 49.85, lng: -99.96, addrPath: 'outAddr', errPath: 'outAddrErr' },
    { lat: 49.8, lng: -99.9, addrPath: 'vans/a/addr', errPath: 'vans/a/addrErr' }
  ]);
  assert.deepStrictEqual(S.addressJobs({ in: 1, inLoc: { err: 'timeout' } }), []);
  assert.deepStrictEqual(S.addressJobs({ inLoc: { lat: 91, lng: 0 } }), []); // not a real place
  assert.deepStrictEqual(S.addressJobs(null), []);
});

test('reading the Geocoding API reply', () => {
  assert.deepStrictEqual(S.pickAddress({ status: 'OK', results: [{ formatted_address: '1010 Princess Ave, Brandon, MB R7A 0P4, Canada' }, { formatted_address: 'Brandon, MB' }] }),
    { addr: '1010 Princess Ave, Brandon, MB R7A 0P4, Canada' });
  assert.deepStrictEqual(S.pickAddress({ status: 'ZERO_RESULTS', results: [] }), { err: 'ZERO_RESULTS' });
  assert.deepStrictEqual(S.pickAddress({ status: 'REQUEST_DENIED', error_message: 'API key not valid' }), { err: 'REQUEST_DENIED' });
  assert.deepStrictEqual(S.pickAddress({ status: 'OK', results: [] }), { err: 'ZERO_RESULTS' });
  assert.deepStrictEqual(S.pickAddress(null), { err: 'NO_REPLY' });
  assert.strictEqual(S.geocodeUrl(49.84, -99.95, 'k&y'), 'https://maps.googleapis.com/maps/api/geocode/json?latlng=49.84,-99.95&key=k%26y');
});
