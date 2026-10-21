// Database rules (../../database.rules.json) against the Realtime Database emulator.
// Run from this folder: npm install, then npm test (it starts the emulator; needs Java 11+).
import test, { before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const RULES = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'database.rules.json'), 'utf8');
const NOW = { '.sv': 'timestamp' };
const DAY = 86400000;
let env;

const matt = 'matt@ec,com', dave = 'dave@ec,com', gone = 'gone@ec,com';
const as = (email) => env.authenticatedContext(email.replace(/[^a-z]/g, ''), { email: email }).database();
const mattDb = () => as('matt@ec.com');
const daveDb = () => as('dave@ec.com');
const adminDb = () => as('justin@ec.com');
const seed = (data) => env.withSecurityRulesDisabled(ctx => ctx.database().ref().set(data));

// A punch in the way the clock sends it: the shift and timeclock/open together
const punchIn = (db, ek, id, extra) => db.ref().update({
  [`timeclock/shifts/${ek}/${id}`]: Object.assign({ in: NOW, src: 'clock', tap: Date.now() }, extra || {}),
  [`timeclock/open/${ek}`]: id
});

before(async () => {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-timeclock', database: { rules: RULES, host, port: Number(port) } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed({
    timeclock: {
      employees: {
        [matt]: { email: 'matt@ec.com', name: 'Matt', active: true },
        [dave]: { email: 'dave@ec.com', name: 'Dave', active: true },
        [gone]: { email: 'gone@ec.com', name: 'Gone', active: false, removed: true }
      }
    }
  });
});

// ---------- Punches ----------
test('an employee can punch in (shift + open pointer together)', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1'));
});

test('B7: a second punch in while a shift is open is refused', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1'));
  await assertFails(punchIn(mattDb(), matt, 's2'));
});

test('B7: a punch in without the open pointer is refused', async () => {
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/s1`).set({ in: NOW, src: 'clock' }));
});

test('B7: after punching out, the next punch in works', async () => {
  const db = mattDb();
  await assertSucceeds(punchIn(db, matt, 's1'));
  await assertSucceeds(db.ref(`timeclock/shifts/${matt}/s1/out`).set(NOW));
  await assertSucceeds(punchIn(db, matt, 's2'));
});

test('B7: an open pointer to a shift that was deleted does not block punching in', async () => {
  await seed({
    timeclock: {
      employees: { [matt]: { email: 'matt@ec.com', active: true } },
      open: { [matt]: 'deleted' }
    }
  });
  await assertSucceeds(punchIn(mattDb(), matt, 's2'));
});

test('an employee cannot point timeclock/open at a shift of their own choosing', async () => {
  await assertFails(mattDb().ref(`timeclock/open/${matt}`).set('nothing'));
});

test('B10: an employee cannot mark their punch as added by an admin', async () => {
  await assertFails(punchIn(mattDb(), matt, 's1', { src: 'admin' }));
});

test('a punch can\'t be backdated, and a saved time can\'t be changed', async () => {
  const db = mattDb();
  await assertFails(db.ref().update({ [`timeclock/shifts/${matt}/s0`]: { in: Date.now() - 3600000 }, [`timeclock/open/${matt}`]: 's0' }));
  await assertSucceeds(punchIn(db, matt, 's1'));
  await assertFails(db.ref(`timeclock/shifts/${matt}/s1/in`).set(NOW));
});

test('B3: the time pressed on the phone goes with the punch, but not from more than a week ago', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1', { tap: Date.now() - 2 * 3600000 }));
  await env.clearDatabase();
  await seed({ timeclock: { employees: { [matt]: { email: 'matt@ec.com', active: true } } } });
  await assertFails(punchIn(mattDb(), matt, 's1', { tap: Date.now() - 8 * DAY }));
});

test('late punch in: only an admin can keep the server\'s time or move it to the time pressed', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1', { tap: Date.now() - 2 * 3600000 }));
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/s1/lateSeen`).set({ by: 'matt@ec.com', at: NOW }));
  await assertSucceeds(adminDb().ref(`timeclock/shifts/${matt}/s1/lateSeen`).set({ by: 'justin@ec.com', at: NOW }));
  await assertSucceeds(adminDb().ref(`timeclock/shifts/${matt}/s1`).update({ in: Date.now() - 2 * 3600000, edited: { by: 'justin@ec.com', at: NOW, note: 'x' } }));
});

test('B3: the punch-out phone time can be added once, just after the punch out', async () => {
  const db = mattDb();
  await assertSucceeds(punchIn(db, matt, 's1'));
  await assertFails(db.ref(`timeclock/shifts/${matt}/s1/outTap`).set(Date.now())); // not punched out yet
  await assertSucceeds(db.ref(`timeclock/shifts/${matt}/s1/out`).set(NOW));
  await assertSucceeds(db.ref(`timeclock/shifts/${matt}/s1/outTap`).set(Date.now() - 60000));
  await assertFails(db.ref(`timeclock/shifts/${matt}/s1/outTap`).set(Date.now()));
});

test('B2: a removed employee cannot punch in', async () => {
  await assertFails(punchIn(as('gone@ec.com'), gone, 's1'));
});

test('an employee cannot write another employee\'s punches', async () => {
  await assertFails(punchIn(daveDb(), matt, 's1'));
});

test('B6: an admin can add an "admin" van change; employees can\'t', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1'));
  const entry = { at: Date.now(), how: 'admin', vehicleId: 'g7', vehicleName: '7', by: 'justin@ec.com' };
  await assertSucceeds(adminDb().ref(`timeclock/shifts/${matt}/s1/vans/v1`).set(entry));
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/s1/vans/v2`).set(entry));
});

test('B2: an admin can move an old shift (with its phone time) to a new sign-in', async () => {
  const old = { in: Date.now() - 30 * DAY, out: Date.now() - 30 * DAY + 3600000, tap: Date.now() - 30 * DAY, outTap: Date.now() - 30 * DAY + 3600000 };
  await assertSucceeds(adminDb().ref().update({ [`timeclock/shifts/${dave}/old1`]: old, [`timeclock/shifts/${gone}/old1`]: null }));
});

// ---------- Fix a punch (E3) and the inbox (A3) ----------
const fix = (extra) => Object.assign({ at: NOW, kind: 'in', day: '2026-10-15', inTime: '07:30', note: 'Phone died', status: 'open' }, extra || {});

test('E3: an employee can ask for a punch fix, read it, and cancel it while it\'s open', async () => {
  const db = mattDb();
  await assertSucceeds(db.ref(`timeclock/requests/${matt}/r1`).set(fix()));
  await assertSucceeds(db.ref(`timeclock/requests/${matt}`).once('value'));
  await assertSucceeds(db.ref(`timeclock/requests/${matt}/r1`).remove());
});

test('E3: an employee cannot mark their own request done, or answer it', async () => {
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix({ status: 'done' })));
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix({ reply: 'ok' })));
});

test('E3: requests are private and checked', async () => {
  await assertFails(daveDb().ref(`timeclock/requests/${matt}/r1`).set(fix()));
  await assertFails(daveDb().ref(`timeclock/requests/${matt}`).once('value'));
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix({ day: 'yesterday' })));
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix({ extra: 1 })));
});

test('E3: an employee can say they punched in by accident', async () => {
  await assertSucceeds(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix({ kind: 'accident', inTime: null, shiftId: 's1', note: '' })));
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r2`).set(fix({ kind: 'oops' })));
});

test('A3: the admin answers a request; the employee can no longer cancel it', async () => {
  await assertSucceeds(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix()));
  await assertSucceeds(adminDb().ref(`timeclock/requests/${matt}/r1`).update({ status: 'done', reply: 'Fixed', by: 'justin@ec.com', doneAt: Date.now() }));
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r1`).remove());
});

// ---------- Oil check ----------
const oil = (extra) => Object.assign({ done: true, at: Date.now(), how: 'box' }, extra || {});

test('oil check: a driver saves it on their own shift; "checked" can\'t be taken back', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1', {}));
  await assertFails(daveDb().ref(`timeclock/shifts/${matt}/s1/oil`).set(oil()));
  await assertSucceeds(mattDb().ref(`timeclock/shifts/${matt}/s1/oil`).set(oil({ done: false, how: 'out' })));
  await assertSucceeds(mattDb().ref(`timeclock/shifts/${matt}/s1/oil`).set(oil()));                    // no -> yes is fine
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/s1/oil`).set(oil({ done: false, how: 'out' }))); // yes -> no isn't
});

test('oil check: only for a real shift, with a sensible time, and never "seen" by the driver', async () => {
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/nope/oil`).set(oil()));
  await assertSucceeds(punchIn(mattDb(), matt, 's1', {}));
  const p = `timeclock/shifts/${matt}/s1/oil`;
  await assertFails(mattDb().ref(p).set(oil({ at: Date.now() + DAY })));
  await assertFails(mattDb().ref(p).set(oil({ at: Date.now() - 8 * DAY })));
  await assertFails(mattDb().ref(p).set(oil({ how: 'later' })));
  await assertFails(mattDb().ref(p).set(oil({ extra: 1 })));
  await assertFails(mattDb().ref(p).set(oil({ seenBy: 'matt@ec.com' })));
});

test('oil check: can be answered just after punching out, not days later', async () => {
  await seed({ timeclock: {
    employees: { [matt]: { email: 'matt@ec.com', active: true } },
    shifts: { [matt]: { s1: { in: Date.now() - 9 * 3600000, out: Date.now() - 60000 }, s0: { in: Date.now() - 3 * DAY, out: Date.now() - 2 * DAY } } }
  } });
  await assertSucceeds(mattDb().ref(`timeclock/shifts/${matt}/s1/oil`).set(oil({ done: false, how: 'out' })));
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/s0/oil`).set(oil({ how: 'out' })));
});

test('oil check: an admin marks a missed one as seen, even when the driver never answered', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1', {}));
  await assertSucceeds(adminDb().ref(`timeclock/shifts/${matt}/s1/oil`).update({ seenBy: 'justin@ec.com', seenAt: Date.now() }));
  await assertFails(mattDb().ref(`timeclock/shifts/${matt}/s1/oil/seenBy`).set('matt@ec.com'));
});

// ---------- Oil check schedule ----------
test('oil schedule: a vehicle\'s check not due is saved on the shift, but never over an answer', async () => {
  await assertSucceeds(punchIn(mattDb(), matt, 's1', {}));
  const p = `timeclock/shifts/${matt}/s1/oil`;
  await assertSucceeds(mattDb().ref(p).set({ due: false, at: Date.now() }));
  await assertSucceeds(mattDb().ref(p).set({ due: true, at: Date.now() }));     // swapped to a vehicle that's due
  await assertFails(mattDb().ref(p).set({ due: 'no', at: Date.now() }));
  await assertFails(mattDb().ref(p).set({ due: false, done: true, at: Date.now(), how: 'box' }));
  await assertSucceeds(mattDb().ref(p).set(oil({ done: false, how: 'out' })));
  await assertFails(mattDb().ref(p).set({ due: false, at: Date.now() }));        // answered "no": stays
});

const plan = (extra) => Object.assign({ mode: 'every', every: 3 }, extra || {});
test('oil schedule: only admins set it; drivers can read it', async () => {
  await assertSucceeds(adminDb().ref('timeclock/oil_plan/def').set({ mode: 'days', days: { mon: true, thu: true } }));
  await assertSucceeds(adminDb().ref('timeclock/oil_plan/vehicles/12').set(plan()));
  await assertSucceeds(adminDb().ref('timeclock/oil_plan/ask/12').set(NOW));
  await assertFails(mattDb().ref('timeclock/oil_plan/vehicles/12').set({ mode: 'never' }));
  await assertFails(mattDb().ref('timeclock/oil_plan/ask/12').set(NOW));
  await assertSucceeds(mattDb().ref('timeclock/oil_plan').once('value'));
  await assertFails(as('stranger@ec.com').ref('timeclock/oil_plan').once('value'));
});

test('oil schedule: a plan must make sense', async () => {
  await assertFails(adminDb().ref('timeclock/oil_plan/vehicles/12').set({ mode: 'sometimes' }));
  await assertFails(adminDb().ref('timeclock/oil_plan/vehicles/12').set(plan({ every: 0 })));
  await assertFails(adminDb().ref('timeclock/oil_plan/vehicles/12').set(plan({ every: 61 })));
  await assertFails(adminDb().ref('timeclock/oil_plan/vehicles/12').set({ mode: 'days', days: { funday: true } }));
  await assertFails(adminDb().ref('timeclock/oil_plan/vehicles/12').set({ mode: 'shift', every: 3 }));
  await assertFails(adminDb().ref('timeclock/oil_plan/vehicles/Van 12').set(plan()));
  await assertFails(adminDb().ref('timeclock/oil_plan/other').set(1));
});

const last = (extra) => Object.assign({ ek: matt, shiftId: 's1', by: 'Matt', vehicleName: 'Van 12' }, extra || {});
test('oil schedule: a driver saves a vehicle\'s last check only from their own checked shift', async () => {
  const at = Date.now() - 60000;
  await seed({ timeclock: {
    employees: { [matt]: { email: 'matt@ec.com', active: true }, [dave]: { email: 'dave@ec.com', active: true } },
    shifts: { [matt]: { s1: { in: at - 3600000, oil: { done: true, at: at, how: 'box' } }, s2: { in: at - 3600000, oil: { done: false, at: at, how: 'out' } } } }
  } });
  await assertFails(mattDb().ref('timeclock/oil_last/12').set(last({ at: at + 1 })));          // not the shift's check time
  await assertFails(mattDb().ref('timeclock/oil_last/12').set(last({ at: at, shiftId: 's2' })));  // said "not checked"
  await assertFails(daveDb().ref('timeclock/oil_last/12').set(last({ at: at })));               // someone else's shift
  await assertFails(mattDb().ref('timeclock/oil_last/12').set(last({ at: at, extra: 1 })));
  await assertSucceeds(mattDb().ref('timeclock/oil_last/12').set(last({ at: at })));
  await assertSucceeds(daveDb().ref('timeclock/oil_last/12').once('value'));
});

test('oil schedule: an older check never replaces a newer one', async () => {
  const at = Date.now() - 60000;
  await seed({ timeclock: {
    employees: { [matt]: { email: 'matt@ec.com', active: true } },
    shifts: { [matt]: { s1: { in: at - 3600000, oil: { done: true, at: at, how: 'box' } } } },
    oil_last: { '12': { at: at + 1000, ek: 'dave@ec,com', shiftId: 'x' } }
  } });
  await assertFails(mattDb().ref('timeclock/oil_last/12').set(last({ at: at })));
});

test('time off is gone: employees can\'t write it any more', async () => {
  await assertFails(mattDb().ref(`timeclock/timeoff/${matt}/t1`).set({ at: NOW, from: '2026-10-20', to: '2026-10-21', note: '', status: 'pending' }));
});

// ---------- Van problems (E7) ----------
const report = (ek, extra) => Object.assign({ at: NOW, ek: ek, name: 'Matt', vehicleId: 'g7', vehicleName: '7', text: 'Check engine light', status: 'open' }, extra || {});

test('E7: an employee can report a van problem, but not read the reports or close one', async () => {
  await assertSucceeds(mattDb().ref('timeclock/van_reports/v1').set(report(matt)));
  await assertFails(mattDb().ref('timeclock/van_reports').once('value'));
  await assertFails(mattDb().ref('timeclock/van_reports/v1/status').set('fixed'));
  await assertSucceeds(adminDb().ref('timeclock/van_reports/v1').update({ status: 'fixed', fixNote: 'New sensor', by: 'justin@ec.com', doneAt: Date.now() }));
});

test('E7: a report can\'t be made in someone else\'s name, empty, or by a removed employee', async () => {
  await assertFails(mattDb().ref('timeclock/van_reports/v1').set(report(dave)));
  await assertFails(mattDb().ref('timeclock/van_reports/v1').set(report(matt, { text: '' })));
  await assertFails(as('gone@ec.com').ref('timeclock/van_reports/v1').set(report(gone)));
});

// ---------- Vans without GPS ----------
test('vans without GPS: admins add them, employees can read the list but not change it', async () => {
  await assertSucceeds(adminDb().ref('timeclock/vans/van_a').set({ name: 'Van 12', at: Date.now(), by: 'justin@ec.com' }));
  await assertSucceeds(mattDb().ref('timeclock/vans').once('value'));
  await assertFails(mattDb().ref('timeclock/vans/van_b').set({ name: 'Van 13' }));
  await assertFails(adminDb().ref('timeclock/vans/van_c').set({ name: '' }));
  await assertFails(adminDb().ref('timeclock/vans/g7').set({ name: 'Van 7' })); // ids start with van_
});

test('a driver on the clock can take a van without GPS', async () => {
  const db = mattDb();
  await assertSucceeds(punchIn(db, matt, 's1'));
  await assertSucceeds(db.ref('timeclock/vehicle_claims/van_a').set({ ek: matt, shiftId: 's1', name: 'Matt', vehicleName: 'Van 12', at: Date.now() }));
  await assertSucceeds(db.ref(`timeclock/shifts/${matt}/s1`).update({ vehicleId: 'van_a', vehicleName: 'Van 12' }));
});

// ---------- Left as they were ----------
test('B9 (kept on purpose): an employee can still name any GPS in RouteWatcher', async () => {
  await assertSucceeds(mattDb().ref('developer/dispatch_dashboard/driver_nicknames/g7').set('Matt'));
});

test('employees cannot read other employees\' punches or the whole time clock', async () => {
  await assertFails(mattDb().ref(`timeclock/shifts/${dave}`).once('value'));
  await assertFails(mattDb().ref('timeclock').once('value'));
  await assertSucceeds(adminDb().ref('timeclock').once('value'));
});
