import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createTransfer, updateTransfer, swapTransferDirection, transferKind, lookupIntraTransfer, validateTransferDraft
} from '../../../src/editor/core/transfer-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('createTransfer: idはtr_で始まる新しいid', () => {
  const t = createTransfer({ from: { stationId: 'S1', platformId: '1' }, to: { stationId: 'S1', platformId: null }, seconds: 60, bidirectional: false });
  assert.match(t.id, /^tr_/);
  assert.equal(t.to.platformId, null);
});

test('swapTransferDirection: from/toを入れ替える', () => {
  const t = network.transfers[0];
  const swapped = swapTransferDirection(t);
  assert.deepEqual(swapped.from, t.to);
  assert.deepEqual(swapped.to, t.from);
  assert.deepEqual(t.from, { stationId: 'S2', platformId: '1' }); // 入力は変更されない
});

test('transferKind: 同じ駅ならintra、違う駅ならwalk', () => {
  assert.equal(transferKind(network.transfers[0]), 'intra'); // tr_s2_1_2
  assert.equal(transferKind(network.transfers[1]), 'walk'); // tr_s1_s4_walk
});

test('lookupIntraTransfer: 一致すればreversed:false、逆向きならreversed:true', () => {
  const forward = lookupIntraTransfer(network, 'S2', '1', '2');
  assert.equal(forward.transfer.id, 'tr_s2_1_2');
  assert.equal(forward.reversed, false);

  const reversed = lookupIntraTransfer(network, 'S2', '2', '1');
  assert.equal(reversed.transfer.id, 'tr_s2_1_2');
  assert.equal(reversed.reversed, true);

  assert.equal(lookupIntraTransfer(network, 'S3', '1', '1'), null);
});

test('validateTransferDraft: 表形式と同じ文言', () => {
  const base = { from: { stationId: 'S1', platformId: '1' }, to: { stationId: 'S1', platformId: '2' }, seconds: 60, bidirectional: false };
  assert.equal(validateTransferDraft(network, { ...base, seconds: -1 }), '秒数は0以上の整数で入力してください。');
  assert.equal(
    validateTransferDraft(network, { ...base, to: { stationId: 'S1', platformId: null } }),
    '同じ駅の中の乗換では、両方ののりばを指定してください。'
  );
  assert.equal(
    validateTransferDraft(network, { ...base, to: { stationId: 'S1', platformId: '1' } }),
    '同じのりば同士の乗換は登録できません。'
  );
  assert.equal(validateTransferDraft(network, { from: { stationId: 'S2', platformId: '1' }, to: { stationId: 'S2', platformId: '2' }, seconds: 60, bidirectional: false }), '同じ組み合わせの乗換がすでに登録されています。');
});

test('validateTransferDraft: 重複は逆向きも検出し、excludeIdで自分自身を除外できる', () => {
  const reversedDup = { from: { stationId: 'S2', platformId: '2' }, to: { stationId: 'S2', platformId: '1' }, seconds: 60, bidirectional: true };
  assert.equal(validateTransferDraft(network, reversedDup), '同じ組み合わせの乗換がすでに登録されています。');

  const editingSelf = { from: { stationId: 'S2', platformId: '1' }, to: { stationId: 'S2', platformId: '2' }, seconds: 90, bidirectional: false };
  assert.equal(validateTransferDraft(network, editingSelf, { excludeId: 'tr_s2_1_2' }), null);
});
