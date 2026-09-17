import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compilePublic } from '../shared/compile-public.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  const text = readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
  return JSON.parse(text);
}

test('公開用データに下書きが含まれず、published のものだけが入る', () => {
  const network = loadFixture('v2-minimal-network.json');
  const operations = loadFixture('v2-minimal-operations.json');
  operations.notices.push({
    ...operations.notices[0],
    id: 'nt_draft',
    state: 'draft'
  });
  operations.notices.push({
    ...operations.notices[0],
    id: 'nt_closed',
    state: 'closed'
  });

  const pub = compilePublic(
    { doc: network, meta: { revision: 3 } },
    { doc: operations, meta: { revision: 7 } }
  );

  assert.equal(pub.kind, 'public');
  assert.equal(pub.notices.length, 1);
  assert.equal(pub.notices[0].id, 'nt_x1');
});

test('rendered が付き、network・operations の revision が入る', () => {
  const network = loadFixture('v2-minimal-network.json');
  const operations = loadFixture('v2-minimal-operations.json');

  const pub = compilePublic(
    { doc: network, meta: { revision: 3 } },
    { doc: operations, meta: { revision: 7 } }
  );

  assert.equal(pub.networkRevision, 3);
  assert.equal(pub.operationsRevision, 7);
  assert.ok(pub.notices[0].rendered);
  assert.ok(pub.notices[0].rendered.heading);
  assert.ok(pub.notices[0].rendered.body);
  assert.deepEqual(pub.masters, operations.masters);
  assert.deepEqual(pub.network, network);
});

test('直通先に表示する notice を末尾に加える', () => {
  const network = loadFixture('v2-minimal-network.json');
  const operations = loadFixture('v2-minimal-operations.json');
  operations.notices[0].throughServices = [
    { lineId: 'LB', state: 'suspended', target: 'affected_to_through', showOnThroughLine: true },
  ];

  const pub = compilePublic(
    { doc: network, meta: { revision: 3 } },
    { doc: operations, meta: { revision: 7 } }
  );

  assert.equal(pub.notices.length, 2);
  assert.equal(pub.notices[1].id, 'nt_x1__through__LB');
  assert.equal(pub.notices[1].lineId, 'LB');
  assert.deepEqual(pub.notices[1].derived, { sourceId: 'nt_x1' });
  assert.ok(pub.notices[1].rendered.heading);
});
