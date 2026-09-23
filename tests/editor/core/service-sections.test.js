import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateNetwork } from '../../../src/shared/schema-v2.js';
import {
  expandSectionsToSegments,
  buildSectionsFromSegments,
  summarizeSections,
  totalRun,
  reverseService,
  stationName
} from '../../../src/editor/core/service-sections.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadNetwork() {
  const text = readFileSync(join(__dirname, '..', '..', 'fixtures', 'v2-minimal-network.json'), 'utf-8');
  return JSON.parse(text);
}

test('expandSectionsToSegments/buildSectionsFromSegments は往復で元に戻る', () => {
  const network = loadNetwork();
  const service = network.services.find((s) => s.id === 'sv_through');
  const segments = expandSectionsToSegments(service.sections, service.stops.length);
  assert.equal(segments.length, service.stops.length - 1);
  const rebuilt = buildSectionsFromSegments(segments);
  assert.deepEqual(rebuilt, service.sections);
});

test('summarizeSections: 路線名・種別名を→でつなぐ', () => {
  const network = loadNetwork();
  const service = network.services.find((s) => s.id === 'sv_through');
  assert.equal(summarizeSections(network, service.sections), 'A線 普通 → B線 普通');
});

test('totalRun: 各停車駅のrunを合計する（最後の停車駅はrunなし）', () => {
  const network = loadNetwork();
  const service = network.services.find((s) => s.id === 'sv_through');
  assert.equal(totalRun(service), 60 + 90 + 70);
});

test('reverseService: 非circularは停車駅・runが逆順になり、行先が元の始発駅名になる', () => {
  const network = loadNetwork();
  const service = network.services.find((s) => s.id === 'sv_through');
  const reversed = reverseService(network, service);

  assert.notEqual(reversed.id, service.id);
  assert.equal(reversed.headsign, stationName(network, service.stops[0].stationId));
  assert.deepEqual(reversed.stops.map((s) => s.stationId), service.stops.map((s) => s.stationId).slice().reverse());
  // run: 元は [60, 90, 70, undefined]。逆順は先頭からのrunが [70, 90, 60] になり最後はrunなし
  assert.deepEqual(reversed.stops.map((s) => s.run), [70, 90, 60, undefined]);
  assert.equal(reversed.circular, false);

  const network2 = JSON.parse(JSON.stringify(network));
  network2.services.push(reversed);
  const check = validateNetwork(network2);
  assert.deepEqual(check.errors, []);
});

test('reverseService: circularはsectionが1つのまま、runは折返し分を保ったまま逆順になる', () => {
  const network = loadNetwork();
  const service = network.services.find((s) => s.id === 'sv_circular');
  const reversed = reverseService(network, service);

  assert.equal(reversed.circular, true);
  assert.equal(reversed.headsign, null);
  assert.equal(reversed.sections.length, 1);
  assert.equal(reversed.sections[0].lineId, service.sections[0].lineId);
  assert.equal(reversed.sections[0].categoryId, service.sections[0].categoryId);
  assert.deepEqual(reversed.stops.map((s) => s.stationId), service.stops.map((s) => s.stationId).slice().reverse());
  // 元のrun: S2->S3=50, S3->S4=40, S4->S2(wrap)=70
  // 逆順: S4->S3=40, S3->S2=50, S2->S4(wrap)=70（wrapは向きを変えても同じ長さ）
  assert.deepEqual(reversed.stops.map((s) => s.run), [40, 50, 70]);

  const network2 = JSON.parse(JSON.stringify(network));
  network2.services.push(reversed);
  const check = validateNetwork(network2);
  assert.deepEqual(check.errors, []);
});
