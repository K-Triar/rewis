import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { convertV1ToV2 } from '../../src/shared/convert-v1-to-v2.js';
import { validateOperations } from '../../src/shared/schema-v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadV1Latest() {
  const text = readFileSync(join(__dirname, '..', 'fixtures', 'v1-latest.json'), 'utf-8');
  return JSON.parse(text).data;
}

test('本番フィクスチャの変換：validateOperations の errors が0件になる', () => {
  const v1data = loadV1Latest();
  const { network, operations } = convertV1ToV2(v1data);
  const check = validateOperations(operations, network);
  assert.deepEqual(check.errors, []);
});

test('本番フィクスチャの変換：notice の件数が8になる', () => {
  const v1data = loadV1Latest();
  const { operations } = convertV1ToV2(v1data);
  assert.equal(operations.notices.length, 8);
});

test('published:false は state:draft になる', () => {
  const v1data = loadV1Latest();
  const { operations } = convertV1ToV2(v1data);
  const raw = v1data.serviceStatuses.filter(st => !st.generated_from);
  raw.forEach(st => {
    const converted = operations.notices.find(n => n.id === st.id);
    assert.equal(converted.state, st.published ? 'published' : 'draft');
  });
});

test('generated_from があるものは捨てられる', () => {
  const v1data = loadV1Latest();
  const generatedIds = v1data.serviceStatuses.filter(st => st.generated_from).map(st => st.id);
  const { operations } = convertV1ToV2(v1data);
  generatedIds.forEach(id => {
    assert.equal(operations.notices.some(n => n.id === id), false);
  });
});

test('masters.statusTemplates / causes が変換される', () => {
  const v1data = loadV1Latest();
  const { operations } = convertV1ToV2(v1data);
  assert.equal(operations.masters.statusTemplates.length, v1data.statusTemplates.length);
  assert.equal(operations.masters.causes.length, v1data.serviceStatusCauses.length);
  const information_update = operations.masters.causes.find(c => c.code === 'information_update');
  assert.ok(information_update);
});
