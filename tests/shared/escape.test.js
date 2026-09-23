import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../src/shared/escape.js';

test('escapes &<>"\'', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('passes through safe text unchanged', () => {
  assert.equal(escapeHtml('瑠璃駅'), '瑠璃駅');
});

test('treats null and undefined as empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('coerces non-string values to string', () => {
  assert.equal(escapeHtml(123), '123');
});
