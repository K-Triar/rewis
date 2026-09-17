import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createStation, updateStation, addPlatform, renamePlatform, movePlatform, removePlatform,
  validateStationDraft, validatePlatformDraft
} from '../editor-core/station-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('createStation: 既定値', () => {
  const station = createStation('S9', 'S9駅', 'えすきゅう');
  assert.deepEqual(station, { id: 'S9', name: 'S9駅', kana: 'えすきゅう', platforms: [], location: null });
});

test('updateStation: 入力を変更せず新しいオブジェクトを返す', () => {
  const station = createStation('S9', 'S9駅', '');
  const updated = updateStation(station, { name: '新S9駅', kana: 'しんえすきゅう' });
  assert.equal(updated.name, '新S9駅');
  assert.equal(station.name, 'S9駅');
});

test('addPlatform / renamePlatform / movePlatform / removePlatform', () => {
  let station = createStation('S9', 'S9駅', '');
  station = addPlatform(station, { id: '1', label: '1番線' });
  station = addPlatform(station, { id: '2', label: '2番線' });
  assert.equal(station.platforms.length, 2);

  station = renamePlatform(station, '1', '1番のりば');
  assert.equal(station.platforms[0].label, '1番のりば');

  station = movePlatform(station, 0, 1);
  assert.deepEqual(station.platforms.map((p) => p.id), ['2', '1']);

  station = removePlatform(station, '2');
  assert.deepEqual(station.platforms.map((p) => p.id), ['1']);
});

test('validateStationDraft: 表形式と同じ文言', () => {
  assert.equal(
    validateStationDraft(network, { id: '不正 ID', name: 'x', platforms: [] }, true),
    '駅IDの書式が不正です（英数字・_・- のみ、1〜64文字）。'
  );
  assert.equal(validateStationDraft(network, { id: 'S1', name: 'x', platforms: [] }, true), '同じIDの駅が既にあります。');
  assert.equal(validateStationDraft(network, { id: 'S9', name: '', platforms: [] }, true), '駅名を入力してください。');
  assert.equal(
    validateStationDraft(network, { id: 'S9', name: 'x', platforms: [{ id: 'a', label: 'a' }, { id: 'a', label: 'b' }] }, true),
    'のりばID「a」が重複しています。'
  );
  assert.equal(validateStationDraft(network, { id: 'S1', name: 'S1駅改', platforms: [] }, false), null);
});

test('validatePlatformDraft: 表形式と同じ文言', () => {
  assert.equal(
    validatePlatformDraft([], { id: '不正 ID', label: 'x' }),
    'のりばIDの書式が不正です（英数字・_・- のみ、1〜64文字）。'
  );
  assert.equal(validatePlatformDraft([{ id: '1' }], { id: '1', label: 'x' }), '同じIDののりばが既にあります。');
  assert.equal(validatePlatformDraft([], { id: '1', label: '' }), '表示名を入力してください。');
  assert.equal(validatePlatformDraft([], { id: '1', label: '1番' }), null);
});
