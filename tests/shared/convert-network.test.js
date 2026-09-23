import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { convertV1ToV2 } from '../../src/shared/convert-v1-to-v2.js';
import { validateNetwork } from '../../src/shared/schema-v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSynthetic(name) {
  const text = readFileSync(join(__dirname, '..', 'fixtures', 'v1-synthetic', name), 'utf-8');
  return JSON.parse(text);
}

function loadV1Latest() {
  const text = readFileSync(join(__dirname, '..', 'fixtures', 'v1-latest.json'), 'utf-8');
  return JSON.parse(text).data;
}

test('a: 直線の路線、上り・下りの2つの流れ → 運行系統が2つ', () => {
  const { network } = convertV1ToV2(loadSynthetic('a-two-directions.json'));
  assert.equal(network.services.length, 2);
  const check = validateNetwork(network);
  assert.deepEqual(check.errors, []);
});

test('b: 境界駅で同じのりばを使う直通 → 2区間を持つ運行系統が1つ', () => {
  const { network, report } = convertV1ToV2(loadSynthetic('b-through-boundary.json'));
  assert.equal(network.services.length, 1);
  assert.equal(network.services[0].sections.length, 2);
  assert.equal(report.stats.throughJoined, 1);
  const check = validateNetwork(network);
  assert.deepEqual(check.errors, []);
});

test('c: 並走する2路線が同じのりばを使う → THROUGH_AMBIGUOUS または THROUGH_MIDCHAIN が出る', () => {
  const { report } = convertV1ToV2(loadSynthetic('c-parallel-ambiguous.json'));
  const hasExpectedIssue = report.issues.some(i => i.code === 'THROUGH_AMBIGUOUS' || i.code === 'THROUGH_MIDCHAIN');
  assert.equal(hasExpectedIssue, true);
});

test('d: 分岐 → BRANCH_SPLIT が出る', () => {
  const { report } = convertV1ToV2(loadSynthetic('d-branch.json'));
  assert.equal(report.issues.some(i => i.code === 'BRANCH_SPLIT'), true);
});

test('e: 環状の流れ → circular:true になる', () => {
  const { network, report } = convertV1ToV2(loadSynthetic('e-circular.json'));
  assert.equal(network.services.length, 1);
  assert.equal(network.services[0].circular, true);
  assert.equal(report.issues.some(i => i.code === 'CIRCULAR_CHAIN'), true);
  const check = validateNetwork(network);
  assert.deepEqual(check.errors, []);
});

test('f: isBidirectional の区間 → 逆向きの運行系統ができる', () => {
  const { network } = convertV1ToV2(loadSynthetic('f-bidirectional.json'));
  assert.equal(network.services.length, 2);
  const headsigns = network.services.map(s => s.headsign).sort();
  assert.deepEqual(headsigns, ['A駅', 'B駅']);
});

test('g: isAlightOnly の区間 → board:false になる', () => {
  const { network } = convertV1ToV2(loadSynthetic('g-alight-only.json'));
  const service = network.services[0];
  const stopB = service.stops.find(s => s.stationId === 'B');
  assert.equal(stopB.board, false);
});

test('h: のりばが空 → platformId:null と warning', () => {
  const { network } = convertV1ToV2(loadSynthetic('h-empty-platform.json'));
  const service = network.services[0];
  assert.equal(service.stops[0].platformId, null);
  const check = validateNetwork(network);
  assert.equal(check.warnings.some(w => w.code === 'W_STOP_NO_PLATFORM'), true);
});

test('i: categoryMerge の指定 → 区間の categoryId が統合先になる', () => {
  const overrides = { categoryMerge: { L1: { 'Lo-KB': 'Lo' } } };
  const { network } = convertV1ToV2(loadSynthetic('i-category-merge.json'), overrides);
  const line = network.lines.find(l => l.id === 'L1');
  assert.deepEqual(line.categories.map(c => c.id), ['Lo']);
  assert.equal(network.services[0].sections[0].categoryId, 'Lo');
  const check = validateNetwork(network);
  assert.deepEqual(check.errors, []);
});

test('本番のフィクスチャ：変換すると validateNetwork の errors が0件になる', () => {
  const v1data = loadV1Latest();
  const { network } = convertV1ToV2(v1data);
  const check = validateNetwork(network);
  assert.deepEqual(check.errors, []);
});

test('本番のフィクスチャ：すべての hop がどこかの運行系統に少なくとも1回現れる（重複は直通の分岐先が共有される場合のみ許す）', () => {
  const v1data = loadV1Latest();
  const { network } = convertV1ToV2(v1data);

  const expectedHopCount = v1data.segments.reduce((sum, seg) => sum + (seg.isBidirectional ? 2 : 1), 0);

  const seenHopKeys = [];
  network.services.forEach(sv => {
    sv.sections.forEach(section => {
      for (let i = section.from; i < section.to; i++) {
        const from = sv.stops[i];
        const to = sv.stops[i + 1];
        seenHopKeys.push(`${section.lineId}|${section.categoryId}|${from.stationId}|${to.stationId}|${from.platformId}|${to.platformId}|${from.run}`);
      }
    });
    if (sv.circular) {
      const section = sv.sections[0];
      const from = sv.stops[section.to];
      const to = sv.stops[section.from];
      seenHopKeys.push(`${section.lineId}|${section.categoryId}|${from.stationId}|${to.stationId}|${from.platformId}|${to.platformId}|${from.run}`);
    }
  });

  // すべての hop は少なくとも1回現れる（変換で取りこぼされていない）
  assert.equal(new Set(seenHopKeys).size, expectedHopCount);
  // 2回以上現れるのは、複数の路線・種別が同じ続き駅に直通する場合だけ許す
  const counts = new Map();
  seenHopKeys.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
  const duplicated = Array.from(counts.entries()).filter(([, c]) => c > 1);
  assert.ok(duplicated.every(([, c]) => c === 2), `重複は2回までのはず: ${JSON.stringify(duplicated)}`);
});
