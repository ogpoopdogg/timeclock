// Run with: node --test   (from the functions folder)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('./signups');

const matt = { email: 'matt@ec.com', name: 'Matt Smith', active: true };

test('customer addresses are never blocked', () => {
  assert.strictEqual(G.signupAllowed('someone@gmail.com', null), true);
  assert.strictEqual(G.signupAllowed('a@ec.com.au', null), true);
  assert.strictEqual(G.signupAllowed('a@bec.com', null), true);
  assert.strictEqual(G.signupAllowed(undefined, null), true); // phone-only sign-in has no email
  assert.strictEqual(G.signupAllowed('someone@gmail.com', null, null, NOW), true);
});

const NOW = 1_800_000_000_000;
const fresh = { at: NOW - 60 * 1000, by: 'justin@ec.com' };

test('an @ec.com address nobody added is refused', () => {
  assert.strictEqual(G.signupAllowed('grews@ec.com', null, fresh, NOW), false);
  assert.strictEqual(G.signupAllowed(' GREWS@EC.COM ', null, fresh, NOW), false);
  assert.strictEqual(G.refusalReason(null, fresh), 'Not on the time clock');
});

test('an @ec.com address on the time clock is allowed only with a fresh admin panel go-ahead', () => {
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt, fresh, NOW), true);
  assert.strictEqual(G.signupAllowed('Matt@EC.com', matt, fresh, NOW), true);
  // Turned off is still an employee; removed is not
  assert.strictEqual(G.signupAllowed('matt@ec.com', Object.assign({}, matt, { active: false }), fresh, NOW), true);
  assert.strictEqual(G.signupAllowed('matt@ec.com', Object.assign({}, matt, { removed: true }), fresh, NOW), false);
});

test('an employee with no sign-in yet cannot be claimed by someone else signing up', () => {
  // buddy@ec.com on 2026-11-04: on the time clock, no account, and no go-ahead from the admin panel
  const buddy = { email: 'buddy@ec.com', name: 'Buddy' };
  assert.strictEqual(G.signupAllowed('buddy@ec.com', buddy, null, NOW), false);
  assert.strictEqual(G.refusalReason(buddy, null), 'Not created from the time clock admin panel');
});

test('a go-ahead works once and only for 15 minutes', () => {
  const used = Object.assign({}, fresh, { usedAt: NOW - 1000, uid: 'u9' });
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt, used, NOW), false);
  assert.strictEqual(G.refusalReason(matt, used), 'Admin panel go-ahead already used');
  const old = { at: NOW - G.INVITE_MS - 1, by: 'justin@ec.com' };
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt, old, NOW), false);
  assert.strictEqual(G.refusalReason(matt, old), 'Admin panel go-ahead expired');
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt, { at: NOW - G.INVITE_MS }, NOW), true);
  // Not a number, or far in the future
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt, { at: 'soon' }, NOW), false);
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt, { at: NOW + 10 * 60 * 1000 }, NOW), false);
});

test('an admin email gets no free pass', () => {
  // The database rules make anyone signed in as an admin email an admin
  assert.strictEqual(G.signupAllowed('desirae@ec.com', null, fresh, NOW), false);
  assert.strictEqual(G.signupAllowed('desirae@ec.com', { email: 'desirae@ec.com' }, null, NOW), false);
  assert.strictEqual(G.signupAllowed('desirae@ec.com', { email: 'desirae@ec.com' }, fresh, NOW), true);
});

test('emailKey matches the time clock record key', () => {
  assert.strictEqual(G.emailKey(' Matt.Smith@EC.com '), 'matt,smith@ec,com');
});

test('the security log entry for a refused @ec.com sign-up', () => {
  const event = {
    data: { uid: 'u1', email: ' GREWS@EC.COM ', providerData: [{ providerId: 'password' }] },
    ipAddress: '203.0.113.9',
    userAgent: 'Mozilla/5.0',
    additionalUserInfo: { providerId: 'password', isNewUser: true }
  };
  assert.deepStrictEqual(G.signupLogEntry(event, false, 1000), {
    at: 1000, type: 'signup', ok: false, reason: 'Not on the time clock',
    email: 'grews@ec.com', phone: null, uid: 'u1', provider: 'password',
    ip: '203.0.113.9', ua: 'Mozilla/5.0', staff: true
  });
});

test('the security log entry keeps the refusal reason', () => {
  const e = G.signupLogEntry({ data: { uid: 'u4', email: 'buddy@ec.com' } }, false, 7, 'Not created from the time clock admin panel');
  assert.strictEqual(e.reason, 'Not created from the time clock admin panel');
});

test('the security log entry for an allowed customer sign-up', () => {
  const e = G.signupLogEntry({ data: { uid: 'u2', email: 'a@gmail.com', providerData: [{ providerId: 'google.com' }] } }, true, 5);
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.reason, null);
  assert.strictEqual(e.provider, 'google.com');
  assert.strictEqual(e.staff, false);
  assert.strictEqual(e.ip, null);
});

test('a phone-only sign-up and long text are saved safely', () => {
  const e = G.signupLogEntry({ data: { uid: 'u3', phoneNumber: '+12045550100' }, userAgent: 'x'.repeat(1000) }, true, 5);
  assert.strictEqual(e.email, null);
  assert.strictEqual(e.phone, '+12045550100');
  assert.strictEqual(e.ua.length, 300);
  assert.strictEqual(G.signupLogEntry(undefined, true, 5).email, null);
});
