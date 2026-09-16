import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGroup, validateGroupDraft } from '../editor-core/group-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('createGroup: idはgrp_で始まる新しいid', () => {
  const g = createGroup('梅田', ['S1', 'S2']);
  assert.match(g.id, /^grp_/);
  assert.deepEqual(g.stationIds, ['S1', 'S2']);
});

test('validateGroupDraft: 表形式と同じ文言', () => {
  assert.equal(validateGroupDraft(network, { name: '', stationIds: ['S1', 'S2'] }), 'グループ名を入力してください。');
  assert.equal(validateGroupDraft(network, { name: '梅田', stationIds: ['S1'] }), '駅を2つ以上選んでください。');
  assert.equal(validateGroupDraft(network, { name: '梅田', stationIds: ['S1', 'S2'] }), null);
});

test('validateGroupDraft: 同じ駅を2つのグループに入れると弾かれる', () => {
  const withGroup = { ...network, stationGroups: [{ id: 'grp_1', name: '大阪', stationIds: ['S1', 'S3'] }] };
  const message = validateGroupDraft(withGroup, { name: '梅田', stationIds: ['S1', 'S2'] });
  assert.equal(message, '駅「S1駅（S1）」は既に別のグループ「大阪」に入っています。');
});

test('validateGroupDraft: excludeIdで自分自身は重複チェックから除外', () => {
  const withGroup = { ...network, stationGroups: [{ id: 'grp_1', name: '大阪', stationIds: ['S1', 'S3'] }] };
  const message = validateGroupDraft(withGroup, { name: '大阪', stationIds: ['S1', 'S3', 'S4'] }, { excludeId: 'grp_1' });
  assert.equal(message, null);
});
