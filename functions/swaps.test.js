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

test('a swap is still needed only while the driver has no van since that van was taken', () => {
  const bumped = S.unassign(openShift(), bump, 500, 'b');
  assert.strictEqual(S.stillNeedsSwap(bumped, 500), true);
  assert.strictEqual(S.stillNeedsSwap(Object.assign({}, bumped, { vehicleId: 'g3' }), 500), false); // picked a van
  assert.strictEqual(S.stillNeedsSwap(Object.assign({}, bumped, { out: 900 }), 500), false);        // punched out
  assert.strictEqual(S.stillNeedsSwap(bumped, 499), false);                                         // a newer swap replaced it
  assert.strictEqual(S.stillNeedsSwap(null, 500), false);
});
