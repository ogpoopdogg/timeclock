/* Who may create a new @ec.com sign-in (see timeclockBeforeUserCreated in index.js).

   @ec.com is the E&C staff sign-in domain. Its addresses aren't real inboxes, so
   nobody can prove they own one by email. A new @ec.com account is allowed only when
   an admin has already put that exact email on the time clock (admin panel →
   Employees saves timeclock/employees/<ek> before it creates the sign-in), AND the
   admin panel said in the last 15 minutes that it is about to make that sign-in
   (timeclock/signup_ok/<ek>, which only admins can write; it works once). Without the
   second check, anyone who knew an employee email with no sign-in yet (buddy@ec.com
   on 2026-11-04) could sign up as them first, through Request Pickup or by calling
   Firebase directly. That holds for the admin emails too: the database rules make
   anyone signed in as one an admin, so a new one must never be created by itself.
   Every other address (customers on Request Pickup) is left alone.

   Every new account, allowed or refused, is also written to the E&C security log
   (security_log/events, shown in the Security section of the usage page). Only server
   code can write there; the database rules let nobody else. */
'use strict';

const STAFF_DOMAIN = '@ec.com';

function normEmail(email) { return String(email || '').trim().toLowerCase(); }
// Same key as emailKey in ../tc-core.js: Matt@ec.com -> matt@ec,com
function emailKey(email) { return normEmail(email).replace(/\./g, ','); }
function isStaffEmail(email) { return normEmail(email).endsWith(STAFF_DOMAIN); }

const INVITE_MS = 15 * 60 * 1000; // how long the admin panel's go-ahead lasts

/** Whether a new account with this email may be created, given its time clock record (or null)
 * and the admin panel's go-ahead (timeclock/signup_ok/<ek>: { at, by, usedAt? }, or null). */
function signupAllowed(email, employee, invite, now) {
  if (!isStaffEmail(email)) return true;
  if (!employee || employee.removed === true) return false;
  return !!invite && !invite.usedAt && Number.isFinite(invite.at) && invite.at <= now + 60000 && now - invite.at <= INVITE_MS;
}

/** Why a new @ec.com account was refused, for the security log. */
function refusalReason(employee, invite) {
  if (!employee || employee.removed === true) return 'Not on the time clock';
  if (!invite) return 'Not created from the time clock admin panel';
  if (invite.usedAt) return 'Admin panel go-ahead already used';
  return 'Admin panel go-ahead expired';
}

// Where server code records sign-in activity; the usage page's Security section reads it
const SECURITY_EVENTS = 'security_log/events';
const TEXT_MAX = 300; // longest text saved from a sign-up (a browser's description can be long)

function clip(v) { return v == null ? null : String(v).slice(0, TEXT_MAX); }

/** The security log entry for a new account (event: the beforeUserCreated event). */
function signupLogEntry(event, allowed, at, reason) {
  const u = (event && event.data) || {};
  const info = (event && event.additionalUserInfo) || {};
  const providers = (u.providerData || []).map((p) => p && p.providerId).filter(Boolean);
  return {
    at,
    type: 'signup',
    ok: !!allowed,
    reason: allowed ? null : clip(reason || 'Not on the time clock'),
    email: clip(normEmail(u.email) || null),
    phone: clip(u.phoneNumber || null),
    uid: clip(u.uid || null),
    provider: clip(info.providerId || providers[0] || null),
    ip: clip(event && event.ipAddress),
    ua: clip(event && event.userAgent),
    staff: isStaffEmail(u.email)
  };
}

module.exports = { STAFF_DOMAIN, SECURITY_EVENTS, INVITE_MS, normEmail, emailKey, isStaffEmail, signupAllowed, refusalReason, signupLogEntry };
