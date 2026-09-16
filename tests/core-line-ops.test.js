import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createLine, updateLineFields, addStationToLine, insertStationToLine, removeStationFromLine,
  moveStationInLine, setLineShape, addCategory, renameCategory, moveCategory, removeCategory,
  validateLineDraft, servicesAffectedByLineStationRemoval
} from '../editor-core/line-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('createLine: 既定値', () => {
  const line = createLine('LX', 'X線', { companyId: 'C1', vehicleTypeId: 'V1' });
  assert.equal(line.id, 'LX');
  assert.deepEqual(line.stations, []);
  assert.equal(line.loop, null);
  assert.deepEqual(line.categories, []);
});

test('addStationToLine: すでにある駅の追加は何もしない', () => {
  const line = createLine('LX', 'X線', {});
  const once = addStationToLine(line, 'S1');
  const twice = addStationToLine(once, 'S1');
  assert.deepEqual(twice.stations, ['S1']);
});

test('insertStationToLine / removeStationFromLine / moveStationInLine', () => {
  let line = createLine('LX', 'X線', {});
  line = addStationToLine(line, 'S1');
  line = addStationToLine(line, 'S3');
  line = insertStationToLine(line, 1, 'S2');
  assert.deepEqual(line.stations, ['S1', 'S2', 'S3']);

  line = moveStationInLine(line, 0, 2);
  assert.deepEqual(line.stations, ['S2', 'S3', 'S1']);

  line = removeStationFromLine(line, 0);
  assert.deepEqual(line.stations, ['S3', 'S1']);
});

test('removeStationFromLine / moveStationInLine: loop.startIndexの丸め', () => {
  let line = createLine('LX', 'X線', {});
  ['S1', 'S2', 'S3'].forEach((id) => { line = addStationToLine(line, id); });
  line = setLineShape(line, 'racket', 2); // 最後の駅で戻る

  const afterRemove = removeStationFromLine(line, 2); // 最後の駅を削除 → startIndexは1つに丸め
  assert.equal(afterRemove.loop.startIndex, 1);

  const emptied = removeStationFromLine(removeStationFromLine(afterRemove, 0), 0);
  assert.equal(emptied.stations.length, 0);
  assert.equal(emptied.loop, null);
});

test('setLineShape: normal/circular/racket', () => {
  let line = createLine('LX', 'X線', {});
  ['S1', 'S2', 'S3'].forEach((id) => { line = addStationToLine(line, id); });

  assert.equal(setLineShape(line, 'normal').loop, null);
  assert.deepEqual(setLineShape(line, 'circular').loop, { startIndex: 0 });
  assert.deepEqual(setLineShape(line, 'racket').loop, { startIndex: 1 }); // 省略時は1
  assert.deepEqual(setLineShape(line, 'racket', 2).loop, { startIndex: 2 });

  const oneStation = createLine('LY', 'Y線', {});
  const withOne = addStationToLine(oneStation, 'S1');
  assert.deepEqual(setLineShape(withOne, 'racket').loop, { startIndex: 0 }); // 駅が1つ以下なら0
});

test('addCategory / renameCategory / moveCategory / removeCategory', () => {
  let line = createLine('LX', 'X線', {});
  line = addCategory(line, { id: 'Lo', name: '普通' });
  line = addCategory(line, { id: 'Ex', name: '急行' });
  assert.equal(line.categories.length, 2);

  line = renameCategory(line, 'Lo', '各駅停車');
  assert.equal(line.categories[0].name, '各駅停車');

  line = moveCategory(line, 0, 1);
  assert.deepEqual(line.categories.map((c) => c.id), ['Ex', 'Lo']);

  line = removeCategory(line, 'Ex');
  assert.deepEqual(line.categories.map((c) => c.id), ['Lo']);
});

test('validateLineDraft: 表形式と同じ文言', () => {
  assert.equal(validateLineDraft(network, { id: '不正 ID', name: 'x', categories: [{ id: 'a', name: 'a' }] }, true), '路線IDの書式が不正です。');
  assert.equal(validateLineDraft(network, { id: 'LA', name: 'x', categories: [{ id: 'a', name: 'a' }] }, true), '同じIDの路線が既にあります。');
  assert.equal(validateLineDraft(network, { id: 'LX', name: '', categories: [{ id: 'a', name: 'a' }] }, true), '路線名を入力してください。');
  assert.equal(validateLineDraft(network, { id: 'LX', name: 'x', categories: [] }, true), '種別を1つ以上追加してください。');
  assert.equal(
    validateLineDraft(network, { id: 'LX', name: 'x', categories: [{ id: '不正', name: 'a' }] }, true),
    '種別ID「不正」の書式が不正です。'
  );
  assert.equal(
    validateLineDraft(network, { id: 'LX', name: 'x', categories: [{ id: 'a', name: 'a' }, { id: 'a', name: 'b' }] }, true),
    '種別ID「a」が重複しています。'
  );
  assert.equal(validateLineDraft(network, { id: 'LA', name: 'A線改', categories: [{ id: 'Lo', name: '普通' }] }, false), null);
});

test('servicesAffectedByLineStationRemoval', () => {
  const affected = servicesAffectedByLineStationRemoval(network, 'LB', 'S3');
  assert.deepEqual(affected.map((s) => s.id).sort(), ['sv_circular', 'sv_through'].sort());

  const affectedByLA = servicesAffectedByLineStationRemoval(network, 'LA', 'S1');
  // sv_through（S1→S2がLA）とsv_back（S3→S2→S1がLA）の両方がS1を含む
  assert.deepEqual(affectedByLA.map((s) => s.id).sort(), ['sv_back', 'sv_through'].sort());
});
