import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createTransfer, updateTransfer, swapTransferDirection, transferKind, lookupIntraTransfer, setIntraTransferSeconds, validateTransferDraft
} from '../../../src/editor/core/transfer-ops.js';
import { validateNetwork } from '../../../src/shared/schema-v2.js';

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

const intra = (id, from, to, seconds, bidirectional) => ({
  id, from: { stationId: 'S2', platformId: from }, to: { stationId: 'S2', platformId: to }, seconds, bidirectional, note: ''
});

test('lookupIntraTransfer: 片道の登録は逆向きに一致しない', () => {
  const forward = lookupIntraTransfer(network, 'S2', '1', '2');
  assert.equal(forward.transfer.id, 'tr_s2_1_2');
  assert.equal(forward.reversed, false);

  assert.equal(lookupIntraTransfer(network, 'S2', '2', '1'), null); // tr_s2_1_2 は bidirectional:false
  assert.equal(lookupIntraTransfer(network, 'S3', '1', '1'), null);
});

test('lookupIntraTransfer: 往復の登録は逆向きにreversed:trueで一致し、順向きの登録を優先する', () => {
  const both = { transfers: [intra('a', '1', '2', 120, true)] };
  const reversed = lookupIntraTransfer(both, 'S2', '2', '1');
  assert.equal(reversed.transfer.id, 'a');
  assert.equal(reversed.reversed, true);

  const forwardLater = { transfers: [intra('a', '2', '1', 120, true), intra('b', '1', '2', 90, false)] };
  assert.equal(lookupIntraTransfer(forwardLater, 'S2', '1', '2').transfer.id, 'b'); // 配列の後ろでも順向きが先
});

test('setIntraTransferSeconds: 登録がなければ片道で追加、順向きの登録は更新・削除', () => {
  const added = setIntraTransferSeconds([], 'S2', '1', '2', 60);
  assert.equal(added.length, 1);
  assert.equal(added[0].bidirectional, false);
  assert.deepEqual(added[0].from, { stationId: 'S2', platformId: '1' });

  const transfers = [intra('a', '1', '2', 120, true)];
  assert.equal(setIntraTransferSeconds(transfers, 'S2', '1', '2', 90)[0].seconds, 90);
  assert.equal(setIntraTransferSeconds(transfers, 'S2', '1', '2', 120), transfers); // 変化なしは同じ配列
  assert.deepEqual(setIntraTransferSeconds(transfers, 'S2', '1', '2', null), []);
  assert.equal(setIntraTransferSeconds([], 'S2', '1', '2', null).length, 0);
});

test('setIntraTransferSeconds: 往復の逆向き側のマスは、元を片道にして別の登録に分ける', () => {
  const transfers = [intra('a', '1', '2', 120, true)];
  const split = setIntraTransferSeconds(transfers, 'S2', '2', '1', 90);
  assert.equal(split.length, 2);
  assert.deepEqual([split[0].id, split[0].seconds, split[0].bidirectional], ['a', 120, false]);
  assert.deepEqual(split[1].from, { stationId: 'S2', platformId: '2' });
  assert.deepEqual([split[1].seconds, split[1].bidirectional], [90, false]);
  assert.equal(transfers[0].bidirectional, true); // 入力は変更されない

  assert.equal(setIntraTransferSeconds(transfers, 'S2', '2', '1', 120), transfers);

  const cleared = setIntraTransferSeconds(transfers, 'S2', '2', '1', null);
  assert.deepEqual([cleared.length, cleared[0].id, cleared[0].bidirectional], [1, 'a', false]);

  // 分けた結果がスキーマの重複判定（E_TRANSFER_DUP）に引っかからない
  const bidiNet = { ...network, transfers: network.transfers.map((t) => (t.id === 'tr_s2_1_2' ? { ...t, bidirectional: true } : t)) };
  const splitNet = { ...bidiNet, transfers: setIntraTransferSeconds(bidiNet.transfers, 'S2', '2', '1', 90) };
  assert.deepEqual(validateNetwork(splitNet).errors, []);
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
