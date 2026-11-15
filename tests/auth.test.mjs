// Unit tests for passcode/PIN handling and the login lockout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, checkSecret, randomToken, isLocked, recordFailure, clearFailures, canManage, canSuggest, publicMember } from '../server/auth.js';

test('PINs are stored hashed and salted, and verified correctly', () => {
  const stored = hashSecret('1234');
  assert.ok(!stored.includes('1234'));
  assert.notEqual(hashSecret('1234'), stored, 'each hash has its own salt');
  assert.equal(checkSecret('1234', stored), true);
  assert.equal(checkSecret('4321', stored), false);
  assert.equal(checkSecret(undefined, stored), false);
  assert.equal(checkSecret('1234', null), false);
});

test('random tokens are long and unique', () => {
  const a = randomToken();
  assert.equal(a.length, 48);
  assert.notEqual(a, randomToken());
});

test('five wrong tries lock a login, and success clears it', () => {
  const key = `test:${Date.now()}`;
  for (let i = 0; i < 4; i++) recordFailure(key);
  assert.equal(isLocked(key), false);
  recordFailure(key);
  assert.equal(isLocked(key), true);
  clearFailures(key);
  assert.equal(isLocked(key), false);
});

test('permission levels: only owner/manage edit, suggest can propose, view can do neither', () => {
  assert.equal(canManage({ permission: 'owner' }), true);
  assert.equal(canManage({ permission: 'manage' }), true);
  assert.equal(canManage({ permission: 'suggest' }), false);
  assert.equal(canSuggest({ permission: 'suggest' }), true);
  assert.equal(canSuggest({ permission: 'view' }), false);
});

test('public member data never includes the PIN hash', () => {
  const m = publicMember({ id: 1, name: 'Ravi', email: 'r@example.com', pin_hash: 'secret', role: 'family', permission: 'manage', status: 'active', notify: 1 });
  assert.equal('pin_hash' in m, false);
  assert.equal(m.notify, true);
});
