import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_PATTERN, isValidId, newId, sanitizeIdPart } from '../shared/ids.js';

test('newId produces an id matching ID_PATTERN', () => {
  const id = newId('sv');
  assert.match(id, ID_PATTERN);
  assert.match(id, /^sv_[0-9a-z]{10}$/);
});

test('newId does not produce duplicates over 1000 calls', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    seen.add(newId('sv'));
  }
  assert.equal(seen.size, 1000);
});

test('isValidId accepts ids matching the pattern', () => {
  assert.equal(isValidId('KL04'), true);
  assert.equal(isValidId('sv_k3j9x0a2mq'), true);
  assert.equal(isValidId('a'.repeat(64)), true);
});

test('isValidId rejects invalid ids', () => {
  assert.equal(isValidId(''), false);
  assert.equal(isValidId('a'.repeat(65)), false);
  assert.equal(isValidId('KL 04'), false);
  assert.equal(isValidId('KL/04'), false);
  assert.equal(isValidId(null), false);
  assert.equal(isValidId(undefined), false);
  assert.equal(isValidId(123), false);
});

test('sanitizeIdPart replaces disallowed characters with underscore', () => {
  assert.equal(sanitizeIdPart('KL04 / KL05'), 'KL04___KL05');
  assert.equal(sanitizeIdPart('OK-id_1'), 'OK-id_1');
  assert.equal(sanitizeIdPart(123), '123');
});
