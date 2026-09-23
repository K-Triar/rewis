import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPublicModel } from '../../src/shared/data-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadV1LatestPayload() {
  const text = readFileSync(join(__dirname, '..', 'fixtures', 'v1-latest.json'), 'utf-8');
  return JSON.parse(text);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('v1 のフィクスチャからモデルができ、下書きが含まれない', async () => {
  const payload = loadV1LatestPayload();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/data/public')) return jsonResponse(200, payload);
    throw new Error('unexpected fetch: ' + url);
  };

  const { model, source, v1Raw } = await loadPublicModel({ workerBase: 'https://example.test', fetchImpl });

  assert.equal(source, 'v1');
  assert.ok(v1Raw);
  assert.equal(calls.length, 1);
  assert.equal(model.network.stations.length > 0, true);
  model.noticesByLine.forEach(list => {
    list.forEach(n => assert.equal(n.state, 'published'));
  });
  const totalNotices = Array.from(model.noticesByLine.values()).reduce((sum, list) => sum + list.length, 0);
  assert.equal(totalNotices, 0);
});

test('/data/public が404のとき、/data/latest に切り替わる', async () => {
  const payload = loadV1LatestPayload();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/data/public')) return jsonResponse(404, {});
    if (url.endsWith('/data/latest')) return jsonResponse(200, payload);
    throw new Error('unexpected fetch: ' + url);
  };

  const { model, source } = await loadPublicModel({ workerBase: 'https://example.test', fetchImpl });

  assert.equal(source, 'v1');
  assert.deepEqual(calls, ['https://example.test/data/public', 'https://example.test/data/latest']);
  assert.equal(model.network.stations.length > 0, true);
});

test('workerBase が未設定なら例外', async () => {
  const originalSource = globalThis.REWIS_PUBLIC_DATA_SOURCE;
  delete globalThis.REWIS_PUBLIC_DATA_SOURCE;
  try {
    await assert.rejects(() => loadPublicModel({ fetchImpl: async () => jsonResponse(200, {}) }));
  } finally {
    if (originalSource !== undefined) globalThis.REWIS_PUBLIC_DATA_SOURCE = originalSource;
  }
});
