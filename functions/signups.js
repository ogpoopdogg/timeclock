/* Who may create a new @ec.com sign-in (see timeclockBeforeUserCreated in index.js).

   @ec.com is the E&C staff sign-in domain. Its addresses aren't real inboxes, so
   nobody can prove they own one by email. A new @ec.com account is allowed only when
   an admin has already put that exact email on the time clock (admin panel →
   Employees saves timeclock/employees/<ek> before it creates the sign-in). That holds
   for the admin emails too: they already have sign-ins, and the database rules make
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

/** Whether a new account with this email may be created, given its time clock record (or null). */
function signupAllowed(email, employee) {
  if (!isStaffEmail(email)) return true;
  return !!employee && employee.removed !== true;
}

// Where server code records sign-in activity; the usage page's Security section reads it
const SECURITY_EVENTS = 'security_log/events';
const TEXT_MAX = 300; // longest text saved from a sign-up (a browser's description can be long)

function clip(v) { return v == null ? null : String(v).slice(0, TEXT_MAX); }

/** The security log entry for a new account (event: the beforeUserCreated event). */
function signupLogEntry(event, allowed, at) {
  const u = (event && event.data) || {};
  const info = (event && event.additionalUserInfo) || {};
  const providers = (u.providerData || []).map((p) => p && p.providerId).filter(Boolean);
  return {
    at,
    type: 'signup',
    ok: !!allowed,
    reason: allowed ? null : 'Not on the time clock',
    email: clip(normEmail(u.email) || null),
    phone: clip(u.phoneNumber || null),
    uid: clip(u.uid || null),
    provider: clip(info.providerId || providers[0] || null),
    ip: clip(event && event.ipAddress),
    ua: clip(event && event.userAgent),
    staff: isStaffEmail(u.email)
  };
}

module.exports = { STAFF_DOMAIN, SECURITY_EVENTS, normEmail, emailKey, isStaffEmail, signupAllowed, signupLogEntry };
