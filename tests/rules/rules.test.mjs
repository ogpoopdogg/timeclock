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

test('A3: the admin answers a request; the employee can no longer cancel it', async () => {
  await assertSucceeds(mattDb().ref(`timeclock/requests/${matt}/r1`).set(fix()));
  await assertSucceeds(adminDb().ref(`timeclock/requests/${matt}/r1`).update({ status: 'done', reply: 'Fixed', by: 'justin@ec.com', doneAt: Date.now() }));
  await assertFails(mattDb().ref(`timeclock/requests/${matt}/r1`).remove());
});

// ---------- Time off (E8) ----------
const off = (extra) => Object.assign({ at: NOW, from: '2026-10-20', to: '2026-10-21', note: '', status: 'pending' }, extra || {});

test('E8: an employee can ask for time off; the admin approves it', async () => {
  await assertSucceeds(mattDb().ref(`timeclock/timeoff/${matt}/t1`).set(off()));
  await assertFails(mattDb().ref(`timeclock/timeoff/${matt}/t1/status`).set('approved'));
  await assertSucceeds(adminDb().ref(`timeclock/timeoff/${matt}/t1`).update({ status: 'approved', reply: '', by: 'justin@ec.com', doneAt: Date.now() }));
});

test('E8: the last day can\'t be before the first, and nobody approves their own time off', async () => {
  await assertFails(mattDb().ref(`timeclock/timeoff/${matt}/t1`).set(off({ from: '2026-10-22', to: '2026-10-21' })));
  await assertFails(mattDb().ref(`timeclock/timeoff/${matt}/t1`).set(off({ status: 'approved' })));
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

// ---------- Left as they were ----------
test('B9 (kept on purpose): an employee can still name any GPS in RouteWatcher', async () => {
  await assertSucceeds(mattDb().ref('developer/dispatch_dashboard/driver_nicknames/g7').set('Matt'));
});

test('employees cannot read other employees\' punches or the whole time clock', async () => {
  await assertFails(mattDb().ref(`timeclock/shifts/${dave}`).once('value'));
  await assertFails(mattDb().ref('timeclock').once('value'));
  await assertSucceeds(adminDb().ref('timeclock').once('value'));
});
