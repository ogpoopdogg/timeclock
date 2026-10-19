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
