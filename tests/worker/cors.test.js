import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { MemoryKV } from '../helpers/memory-kv.js';

const PROD = 'https://k-triar.github.io';

async function allowOriginFor(origin, allowed = PROD) {
  const headers = origin ? { Origin: origin } : {};
  const res = await worker.fetch(new Request('https://api.example/health', { method: 'OPTIONS', headers }), {
    ALLOWED_ORIGIN: allowed
  });
  return res.headers.get('Access-Control-Allow-Origin');
}

test('ALLOWED_ORIGIN に書かれたオリジンは許可される', async () => {
  assert.equal(await allowOriginFor(PROD), PROD);
});

test('ALLOWED_ORIGIN はカンマ区切りで複数指定できる', async () => {
  const allowed = `${PROD}, https://example.org`;
  assert.equal(await allowOriginFor('https://example.org', allowed), 'https://example.org');
  assert.equal(await allowOriginFor(PROD, allowed), PROD);
});

test('ローカル開発用オリジンは任意のポートで許可される', async () => {
  for (const origin of [
    'http://localhost:5500',
    'http://127.0.0.1:5502',
    'http://127.0.0.1',
    'http://10.0.1.0:5500',
    'http://10.0.1.23:5500',
    'http://10.0.1.255:8080',
    'http://100.64.0.1:5500',
    'http://100.101.102.103:5500',
    'http://100.127.255.255:5500'
  ]) {
    assert.equal(await allowOriginFor(origin), origin, origin);
  }
});

test('許可されていないオリジンには既定のオリジンを返す', async () => {
  for (const origin of [
    'https://evil.example',
    'https://localhost:5500',
    'http://localhost.evil.example',
    'http://10.0.2.5:5500',
    'http://10.1.1.5:5500',
    'http://192.168.1.10:5500',
    'http://172.16.0.5:5500',
    'http://100.63.0.1:5500',
    'http://100.128.0.1:5500',
    'http://10.0.1.256:5500',
    'http://mypc.tail1234.ts.net:5500',
    'http://10.0.1.5:5500/path',
    'null'
  ]) {
    assert.equal(await allowOriginFor(origin), PROD, origin);
  }
});

test('ALLOWED_ORIGIN 未設定なら従来どおりリクエストの Origin を返す', async () => {
  assert.equal(await allowOriginFor('https://any.example', ''), 'https://any.example');
  assert.equal(await allowOriginFor('', ''), '*');
});

// ---- 公開エンドポイント（他サイトのブラウザから読める） ----

const OTHER = 'https://example.com';

function publicEnv() {
  const DATA_KV = new MemoryKV();
  DATA_KV.store.set('v2:public:latest', { value: JSON.stringify({ network: { stations: [] }, notices: [] }) });
  DATA_KV.store.set('data:latest', { value: JSON.stringify({ data: { lines: [] }, meta: { revision: 3 } }) });
  return { ALLOWED_ORIGIN: PROD, DATA_KV, TOKEN_KV: new MemoryKV(), LATEST_REQUIRES_AUTH: 'true' };
}

function call(path, init = {}, env = publicEnv()) {
  return worker.fetch(new Request('https://api.example' + path, init), env);
}

test('公開 GET は任意の Origin に * を返し、短いキャッシュと内容ハッシュの ETag を付ける', async () => {
  for (const path of ['/v2/public', '/data/public']) {
    const res = await call(path, { headers: { Origin: OTHER } });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', path);
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null, path);
    assert.equal(res.headers.get('Vary'), null, path);
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=30, s-maxage=30', path);
    const etag = res.headers.get('ETag');
    assert.match(etag, /^"[0-9a-f]{32}"$/, path);
    // 同じ内容なら同じ ETag
    const again = await call(path, { headers: { Origin: OTHER } });
    assert.equal(again.headers.get('ETag'), etag, path);
  }
});

test('公開 GET は Origin なしでも * を返す', async () => {
  const res = await call('/v2/public');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('公開 GET は If-None-Match が一致すれば 304 を返す', async () => {
  const env = publicEnv();
  const first = await call('/v2/public', {}, env);
  const etag = first.headers.get('ETag');
  const res = await call('/v2/public', { headers: { 'If-None-Match': `W/${etag}` } }, env);
  assert.equal(res.status, 304);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const miss = await call('/v2/public', { headers: { 'If-None-Match': '"other"' } }, env);
  assert.equal(miss.status, 200);
});

test('公開 GET が未初期化のときも * を返し、キャッシュさせない', async () => {
  const env = { ALLOWED_ORIGIN: PROD, DATA_KV: new MemoryKV(), TOKEN_KV: new MemoryKV() };
  for (const path of ['/v2/public', '/data/public']) {
    const res = await call(path, { headers: { Origin: OTHER } }, env);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', path);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', path);
  }
});

test('公開 GET への OPTIONS プリフライトは * で成功する', async () => {
  for (const path of ['/v2/public', '/data/public']) {
    const res = await call(path, {
      method: 'OPTIONS',
      headers: { Origin: OTHER, 'Access-Control-Request-Method': 'GET' }
    });
    assert.ok(res.ok, path);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', path);
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /GET/, path);
    assert.doesNotMatch(res.headers.get('Access-Control-Allow-Methods'), /POST/, path);
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null, path);
  }
});

test('保護系のエンドポイントは任意の Origin に * を返さず、許可リスト先頭を返す', async () => {
  const cases = [
    ['POST', '/auth/login'],
    ['POST', '/auth/logout'],
    ['POST', '/data/save'],
    ['GET', '/data/latest'],
    ['GET', '/data/history'],
    ['GET', '/data/history/item'],
    ['POST', '/data/rollback'],
    ['GET', '/v2/doc/network'],
    ['POST', '/v2/doc/network/save'],
    ['GET', '/v2/history/network'],
    ['GET', '/v2/history/network/item'],
    ['POST', '/v2/rollback/network'],
    ['POST', '/v2/admin/import'],
    ['GET', '/health'],
    ['GET', '/no-such-path']
  ];
  for (const [method, path] of cases) {
    const init = { method, headers: { Origin: OTHER, 'Content-Type': 'application/json' } };
    if (method === 'POST') init.body = '{}';
    const res = await call(path, init);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), PROD, `${method} ${path}`);

    const pre = await call(path, { method: 'OPTIONS', headers: { Origin: OTHER } });
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), PROD, `OPTIONS ${path}`);
  }
});

test('許可リストのオリジンからの公開 GET も * を返す（自サイトの読み込みに影響しない）', async () => {
  const res = await call('/v2/public', { headers: { Origin: PROD } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});
