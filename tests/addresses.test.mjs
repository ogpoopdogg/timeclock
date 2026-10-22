import test from 'node:test';
import assert from 'node:assert';
// Which punch locations still need a street address (tc-core.js addressJobs). Run with: node --test tests/addresses.test.mjs
// tc-core.js loads Firebase from the web, so this test copies it with those imports stubbed out (as overtime.test.mjs does).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tc-core.js'), 'utf8')
  .replace(/^import .*?;\n/gm, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), 'core.mjs');
fs.writeFileSync(tmp, 'const initializeApp=()=>({}),getAuth=()=>({}),initializeAuth=()=>({}),indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},getDatabase=()=>({});const firebaseConfig={},ALLOWED_EMAIL="justin@ec.com";\n' + src);
const { addressJobs, vanHistory, mapsLink } = await import(pathToFileURL(tmp).href);

test('punch in, punch out and van swaps that have a location but no address yet', () => {
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
  assert.deepStrictEqual(addressJobs(shift), [
    { lat: 49.85, lng: -99.96, addrPath: 'outAddr', errPath: 'outAddrErr' },
    { lat: 49.8, lng: -99.9, addrPath: 'vans/a/addr', errPath: 'vans/a/addrErr' }
  ]);
});

test('nothing to look up: no location, a blocked location, or not a real place', () => {
  assert.deepStrictEqual(addressJobs({ in: 1 }), []);
  assert.deepStrictEqual(addressJobs({ in: 1, inLoc: { err: 'timeout' } }), []);
  assert.deepStrictEqual(addressJobs({ inLoc: { lat: 91, lng: 0 } }), []);
  assert.deepStrictEqual(addressJobs(null), []);
});

test('van history is in time order; Google Maps link', () => {
  assert.deepStrictEqual(vanHistory({ vans: { x: { at: 5, vehicleName: '3' }, y: { at: 2, vehicleName: '7' }, z: null } }).map(v => v.id), ['y', 'x']);
  assert.strictEqual(mapsLink({ lat: 49.8485, lng: -99.9501 }), 'https://www.google.com/maps/search/?api=1&query=49.8485%2C-99.9501');
});
