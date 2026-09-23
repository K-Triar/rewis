import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesServiceFilter } from '../../../src/editor/core/service-filter.js';

const service = { sections: [{ lineId: 'LA', categoryId: 'Lo' }, { lineId: 'LB', categoryId: 'Ex' }] };

test('lineIdなしなら常に一致', () => {
  assert.equal(matchesServiceFilter(service, {}), true);
});

test('lineIdが一致すればtrue', () => {
  assert.equal(matchesServiceFilter(service, { lineId: 'LA' }), true);
});

test('lineIdが一致しなければfalse', () => {
  assert.equal(matchesServiceFilter(service, { lineId: 'LC' }), false);
});

test('lineIdとcategoryIdの両方が一致する区間が必要', () => {
  assert.equal(matchesServiceFilter(service, { lineId: 'LA', categoryId: 'Ex' }), false);
  assert.equal(matchesServiceFilter(service, { lineId: 'LB', categoryId: 'Ex' }), true);
});
