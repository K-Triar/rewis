import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveThroughNotices } from '../../src/shared/derive-through-notices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8'));
}

const network = loadFixture('v2-minimal-network.json');
const operations = loadFixture('v2-minimal-operations.json');
const masters = operations.masters;
const baseNotice = operations.notices[0]; // lineId: 'LA', state: 'published'

test('showOnThroughLine が true の throughServices から、対象路線ごとに直通先 notice を1件作る', () => {
  const notice = {
    ...baseNotice,
    throughServices: [
      { lineId: 'LB', state: 'suspended', target: 'affected_to_through', showOnThroughLine: true },
    ],
  };

  const derived = deriveThroughNotices([notice], network, masters);

  assert.equal(derived.length, 1);
  const g = derived[0];
  assert.equal(g.id, 'nt_x1__through__LB');
  assert.equal(g.state, 'published');
  assert.equal(g.lineId, 'LB');
  assert.equal(g.range, null);
  assert.deepEqual(g.directions, { forward: true, backward: true });
  assert.equal(g.categoryIds, null);
  assert.equal(g.status.code, 'DSS_STOP');
  assert.equal(g.status.heading, '直通運転中止');
  assert.equal(g.status.body, '直通運転を中止しています');
  assert.equal(g.cause.lineOption, 'line');
  assert.equal(g.cause.lineId, 'LA');
  assert.equal(g.cause.code, notice.cause.code);
  assert.deepEqual(g.turnback, { start: false, end: false });
  assert.deepEqual(g.throughServices, [
    { lineId: 'LA', state: 'suspended', target: 'through_to_affected', showOnThroughLine: false },
  ]);
  assert.deepEqual(g.text, { mode: 'auto', custom: null });
  assert.deepEqual(g.derived, { sourceId: 'nt_x1' });
  assert.ok(g.rendered.heading);
  assert.ok(g.rendered.body);
});

test('target が mutual のときは向きを変えずに mutual のまま', () => {
  const notice = {
    ...baseNotice,
    throughServices: [
      { lineId: 'LB', state: 'resumed', target: 'mutual', showOnThroughLine: true },
    ],
  };
  const derived = deriveThroughNotices([notice], network, masters);
  assert.equal(derived[0].throughServices[0].target, 'mutual');
  assert.equal(derived[0].throughServices[0].state, 'resumed');
});

test('showOnThroughLine が false なら何も作らない', () => {
  const notice = {
    ...baseNotice,
    throughServices: [
      { lineId: 'LB', state: 'suspended', target: 'affected_to_through', showOnThroughLine: false },
    ],
  };
  assert.deepEqual(deriveThroughNotices([notice], network, masters), []);
});

test('元の notice が下書きなら何も作らない', () => {
  const notice = {
    ...baseNotice,
    state: 'draft',
    throughServices: [
      { lineId: 'LB', state: 'suspended', target: 'affected_to_through', showOnThroughLine: true },
    ],
  };
  assert.deepEqual(deriveThroughNotices([notice], network, masters), []);
});

test('throughServices が複数あれば、それぞれ1件ずつ作る', () => {
  const notice = {
    ...baseNotice,
    throughServices: [
      { lineId: 'LB', state: 'suspended', target: 'affected_to_through', showOnThroughLine: true },
      { lineId: 'LC', state: 'suspended', target: 'affected_to_through', showOnThroughLine: true },
    ],
  };
  const derived = deriveThroughNotices([notice], network, masters);
  assert.deepEqual(derived.map(d => d.id).sort(), ['nt_x1__through__LB', 'nt_x1__through__LC']);
});
