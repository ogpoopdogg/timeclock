/* E&C Time Clock – server code.

   Vehicle swaps (see swaps.js):
   - timeclockVanTaken runs when a van changes hands in timeclock/vehicle_claims.
     The driver who had it is unassigned; their clock then shows a "Vehicle swap
     needed" banner until they pick the van they're in.

   New sign-ins (see signups.js):
   - timeclockBeforeUserCreated runs inside Firebase Authentication before any new
     account is saved. It refuses a new @ec.com account unless an admin already put
     that email on the time clock, so nobody can make themselves a staff sign-in
     through Request Pickup or by calling Firebase directly. Needs Firebase
     Authentication with Identity Platform (see README).

   There are no phone notifications: the punch-in reminder and the vehicle swap
   alerts were removed in October 2026.

   This is its own Firebase "codebase" (see ../firebase.json), so deploying it
   never touches the dispatch app's functions in the same project.
   Memory is set explicitly (with the default 1 vCPU) so running costs are
   predictable; see README "Running cost". */
'use strict';

const { onValueWritten } = require('firebase-functions/v2/database');
const { beforeUserCreated, HttpsError } = require('firebase-functions/v2/identity');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const S = require('./swaps');
const G = require('./signups');

admin.initializeApp();

// The default Realtime Database lives in us-central1; database triggers must run in the same region.
const REGION = 'us-central1';
const MEMORY = '256MiB';

// A driver picked a van another driver had (Van swap in the time clock, or the admin moved it):
// unassign the driver who had it, so their clock asks them to pick the van they're in now.
exports.timeclockVanTaken = onValueWritten(
  { ref: '/timeclock/vehicle_claims/{gpsId}', region: REGION, memory: MEMORY },
  async (event) => {
    const bump = S.bumpFrom(event.data.before.val(), event.data.after.val(), event.params.gpsId);
    if (!bump) return;
    // The database the trigger fired on (in the emulator, admin.database() can point at another namespace)
    const shiftRef = event.data.after.ref.root.child(`timeclock/shifts/${bump.ek}/${bump.shiftId}`);
    const takenAt = Date.now();
    const entryId = shiftRef.child('vans').push().key;
    // null in, null out: the first try may run before the shift is loaded, and is then retried with it
    const res = await shiftRef.transaction((cur) => (cur === null ? null : S.unassign(cur, bump, takenAt, entryId)));
    if (!res.committed || !S.stillNeedsSwap(res.snapshot.val(), takenAt)) {
      logger.info('Van changed hands; previous driver already off it', { gpsId: bump.gpsId, ek: bump.ek });
      return;
    }
    logger.info('Van taken; driver unassigned', { gpsId: bump.gpsId, ek: bump.ek, by: bump.byEk });
  }
);

// Must answer within 7 seconds, or Firebase Authentication fails the sign-up
exports.timeclockBeforeUserCreated = beforeUserCreated(
  { region: REGION, memory: MEMORY },
  async (event) => {
    const email = event.data && event.data.email;
    if (!G.isStaffEmail(email)) return;
    const employee = (await admin.database().ref(`timeclock/employees/${G.emailKey(email)}`).once('value')).val();
    if (G.signupAllowed(email, employee)) return;
    logger.warn('Refused a new @ec.com sign-in that is not on the time clock', { email: G.normEmail(email) });
    throw new HttpsError('permission-denied', 'This email can only be added by an E&C admin.');
  }
);
