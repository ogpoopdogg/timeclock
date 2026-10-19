/* Who may create a new @ec.com sign-in (see timeclockBeforeUserCreated in index.js).

   @ec.com is the E&C staff sign-in domain. Its addresses aren't real inboxes, so
   nobody can prove they own one by email. A new @ec.com account is allowed only when
   an admin has already put that exact email on the time clock (admin panel →
   Employees saves timeclock/employees/<ek> before it creates the sign-in), or when it
   is one of the admin emails. Every other address (customers on Request Pickup) is
   left alone. */
'use strict';

const STAFF_DOMAIN = '@ec.com';
// Must match ADMIN_EMAILS in ../tc-core.js (and the admin emails in ../database.rules.json)
const ADMIN_EMAILS = ['justin@ec.com', 'desirae@ec.com', 'celeste@ec.com'];

function normEmail(email) { return String(email || '').trim().toLowerCase(); }
// Same key as emailKey in ../tc-core.js: Matt@ec.com -> matt@ec,com
function emailKey(email) { return normEmail(email).replace(/\./g, ','); }
function isStaffEmail(email) { return normEmail(email).endsWith(STAFF_DOMAIN); }

/** Whether a new account with this email may be created, given its time clock record (or null). */
function signupAllowed(email, employee) {
  if (!isStaffEmail(email)) return true;
  if (ADMIN_EMAILS.includes(normEmail(email))) return true;
  return !!employee && employee.removed !== true;
}

module.exports = { STAFF_DOMAIN, ADMIN_EMAILS, normEmail, emailKey, isStaffEmail, signupAllowed };
