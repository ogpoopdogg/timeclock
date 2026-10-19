/* E&C Time Clock – van swaps.
   Pure functions only (no Firebase), so they can be tested with `node --test`.

   Van swaps: when a driver picks a van another driver has (Van swap in the time
   clock), timeclock/vehicle_claims/<gpsId> changes hands. The driver who had it
   is unassigned, and their clock shows a "Vehicle swap needed" banner until they
   pick the van they're in, or punch out. */
'use strict';

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

module.exports = { bumpFrom, unassign, stillNeedsSwap };
