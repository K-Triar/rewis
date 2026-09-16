import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestPlatformId, suggestCategoryId } from '../editor-core/id-suggest.js';

test('suggestPlatformId: labelがそのまま使える場合はそれを使う', () => {
  assert.equal(suggestPlatformId('3', ['1', '2']), '3');
});

test('suggestPlatformId: labelがID書式に合わなければP1', () => {
  assert.equal(suggestPlatformId('３番線', []), 'P1');
});

test('suggestPlatformId: labelが重複していればP1、それも重複ならP2', () => {
  assert.equal(suggestPlatformId('1', ['1']), 'P1');
  assert.equal(suggestPlatformId('1', ['1', 'P1']), 'P2');
});

test('suggestCategoryId: 全路線から同じ名前の種別を探し、IDが空いていればそれを使う', () => {
  const network = {
    lines: [
      { id: 'LA', categories: [{ id: 'Lo', name: '普通' }] },
      { id: 'LB', categories: [{ id: 'Ex', name: '急行' }] }
    ]
  };
  assert.equal(suggestCategoryId('急行', network, []), 'Ex');
});

test('suggestCategoryId: 見つかったIDが重複していればcat1、それも重複ならcat2', () => {
  const network = {
    lines: [{ id: 'LA', categories: [{ id: 'Lo', name: '普通' }] }]
  };
  assert.equal(suggestCategoryId('普通', network, ['Lo']), 'cat1');
  assert.equal(suggestCategoryId('普通', network, ['Lo', 'cat1']), 'cat2');
});

test('suggestCategoryId: 同じ名前の種別がなければcat1から', () => {
  const network = { lines: [] };
  assert.equal(suggestCategoryId('新しい種別', network, []), 'cat1');
});
