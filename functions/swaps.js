/* E&C Time Clock – van swaps and punch addresses.
   Pure functions only (no Firebase), so they can be tested with `node --test`.

   Van swaps: when a driver picks a van another driver has (Van swap in the time
   clock), timeclock/vehicle_claims/<gpsId> changes hands. The driver who had it
   is unassigned and gets a notification right away, then reminders every
   SWAP_REMINDER_EVERY_MS until they pick the van they're in (at most
   SWAP_REMINDERS of them), or punch out.

   Addresses: each punch (inLoc / outLoc) and van change (vans/<id>/loc) saves
   where the phone was; the server looks up the street address for it. */
'use strict';

const crypto = require('crypto');

const SWAP_REMINDER_EVERY_MS = 10 * 60 * 1000;
const SWAP_REMINDERS = 3; // after the first notification
const CLOCK_URL = 'https://app.eandccourier.ca/timeclock/';
const SWAP_URL = CLOCK_URL + '?swap=1'; // opens the van picker (see sw.js and index.html)

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * A claim that changed hands: who lost the van, and which van the new driver left behind
 * (most likely the one the bumped driver is in now). Null for anything else: a new claim,
 * a release, or the same driver re-picking.
 */
function bumpFrom(before, after, gpsId) {
  if (!before || !after || typeof before.ek !== 'string' || typeof after.ek !== 'string') return null;
  if (before.ek === after.ek || !str(before.shiftId)) return null;
  return {
    ek: before.ek,
    shiftId: before.shiftId,
    gpsId: gpsId,
    vehicleName: str(after.vehicleName) || str(before.vehicleName) || gpsId,
    by: str(after.nickname) || str(after.name),
    byEk: after.ek,
    suggestId: str(after.fromId) || null,
    suggestName: str(after.fromName) || null
  };
}

/**
 * The bumped driver's shift after losing the van, or undefined to leave it alone
 * (shift closed, or the driver had already moved to another van).
 * `at` is the time of the change and `entryId` a new key for the van history.
 */
function unassign(shift, bump, at, entryId) {
  if (!shift || typeof shift.out === 'number' || shift.vehicleId !== bump.gpsId) return undefined;
  const next = Object.assign({}, shift, { vehicleId: null, vehicleName: null, nickname: null });
  next.swapHint = {
    at: at, by: bump.by, byEk: bump.byEk, vehicleId: bump.gpsId, vehicleName: bump.vehicleName,
    suggestId: bump.suggestId, suggestName: bump.suggestName
  };
  next.vans = Object.assign({}, shift.vans, {
    [entryId]: { at: at, vehicleId: null, vehicleName: null, how: 'taken', by: bump.by, takenId: bump.gpsId, takenName: bump.vehicleName }
  });
  return next;
}

/** True while the driver is still on the clock with no van since this particular van was taken. */
function stillNeedsSwap(shift, takenAt) {
  return !!(shift && typeof shift.out !== 'number' && !shift.vehicleId &&
    shift.swapHint && shift.swapHint.at === takenAt);
}

/** One-shot timer for reminder n (1..SWAP_REMINDERS) after the van was taken. Same inputs -> same ID. */
function swapTimerFor(ek, shiftId, takenAt, n) {
  const fireAt = takenAt + n * SWAP_REMINDER_EVERY_MS;
  const id = 'vs-' + crypto.createHash('sha256').update(ek + '|' + shiftId + '|' + takenAt + '|' + n).digest('hex').slice(0, 40);
  return { id: id, fireAt: fireAt };
}

function swapMessage(hint, n) {
  const van = hint.vehicleName ? 'van ' + hint.vehicleName : 'your van';
  const took = (hint.by ? hint.by + ' took ' + van : capital(van) + ' was given to another driver') + '. ';
  if (!n) {
    return {
      title: 'Van swap needed',
      body: took + (hint.suggestName
        ? 'Are you in van ' + hint.suggestName + ' now? Open the time clock and tap Van swap to confirm the van you\'re in.'
        : 'Open the time clock, tap Van swap and pick the van you\'re in.')
    };
  }
  return {
    title: 'Reminder: van swap',
    body: 'You\'re on the clock without a van' + (hint.by ? ' since ' + hint.by + ' took ' + van : '') +
      '. Open the time clock, tap Van swap and pick the van you\'re in.'
  };
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** False only when the driver turned their punch-in reminder off (timeclock/prefs/<ek>). */
function wantsPunchReminder(prefs) {
  return !(prefs && prefs.punchReminder === false);
}

// ---------- Addresses ----------
const hasCoords = (loc) => !!(loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' &&
  Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180);

/** Locations in a shift that still need an address: [{ lat, lng, addrPath, errPath }] (paths relative to the shift). */
function addressJobs(shift) {
  if (!shift) return [];
  const jobs = [];
  const want = (loc, addrPath, errPath, done) => {
    if (hasCoords(loc) && !done) jobs.push({ lat: loc.lat, lng: loc.lng, addrPath: addrPath, errPath: errPath });
  };
  want(shift.inLoc, 'inAddr', 'inAddrErr', shift.inAddr || shift.inAddrErr);
  want(shift.outLoc, 'outAddr', 'outAddrErr', shift.outAddr || shift.outAddrErr);
  for (const [id, v] of Object.entries(shift.vans || {})) {
    if (v) want(v.loc, 'vans/' + id + '/addr', 'vans/' + id + '/addrErr', v.addr || v.addrErr);
  }
  return jobs;
}

/** Google Geocoding API reverse-lookup URL. */
function geocodeUrl(lat, lng, key) {
  return 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lng + '&key=' + encodeURIComponent(key);
}

/** { addr } from a Geocoding API reply (the first result is Google's best match), or { err: <status> }. */
function pickAddress(reply) {
  const status = reply && typeof reply.status === 'string' ? reply.status : 'NO_REPLY';
  const first = reply && Array.isArray(reply.results) ? reply.results[0] : null;
  if (status === 'OK' && first && typeof first.formatted_address === 'string' && first.formatted_address) {
    return { addr: first.formatted_address.slice(0, 300) };
  }
  return { err: status === 'OK' ? 'ZERO_RESULTS' : status.slice(0, 40) };
}

module.exports = {
  SWAP_REMINDER_EVERY_MS, SWAP_REMINDERS, CLOCK_URL, SWAP_URL,
  bumpFrom, unassign, stillNeedsSwap, swapTimerFor, swapMessage, wantsPunchReminder,
  addressJobs, geocodeUrl, pickAddress
};
