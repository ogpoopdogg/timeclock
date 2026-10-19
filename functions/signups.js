/* Who may create a new @ec.com sign-in (see timeclockBeforeUserCreated in index.js).

   @ec.com is the E&C staff sign-in domain. Its addresses aren't real inboxes, so
   nobody can prove they own one by email. A new @ec.com account is allowed only when
   an admin has already put that exact email on the time clock (admin panel →
   Employees saves timeclock/employees/<ek> before it creates the sign-in). That holds
   for the admin emails too: they already have sign-ins, and the database rules make
   anyone signed in as one an admin, so a new one must never be created by itself.
   Every other address (customers on Request Pickup) is left alone. */
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

module.exports = { STAFF_DOMAIN, normEmail, emailKey, isStaffEmail, signupAllowed };
