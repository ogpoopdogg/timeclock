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
});

test('an @ec.com address nobody added is refused', () => {
  assert.strictEqual(G.signupAllowed('grews@ec.com', null), false);
  assert.strictEqual(G.signupAllowed(' GREWS@EC.COM ', null), false);
});

test('an @ec.com address an admin put on the time clock is allowed', () => {
  assert.strictEqual(G.signupAllowed('matt@ec.com', matt), true);
  assert.strictEqual(G.signupAllowed('Matt@EC.com', matt), true);
  // Turned off is still an employee; removed is not
  assert.strictEqual(G.signupAllowed('matt@ec.com', Object.assign({}, matt, { active: false })), true);
  assert.strictEqual(G.signupAllowed('matt@ec.com', Object.assign({}, matt, { removed: true })), false);
});

test('an admin email is refused unless it is on the time clock', () => {
  // The database rules make anyone signed in as an admin email an admin, so it gets no free pass
  assert.strictEqual(G.signupAllowed('desirae@ec.com', null), false);
  assert.strictEqual(G.signupAllowed('desirae@ec.com', { email: 'desirae@ec.com' }), true);
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
