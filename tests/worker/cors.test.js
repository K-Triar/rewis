import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';

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
