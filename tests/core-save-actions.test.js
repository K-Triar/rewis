import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../editor-core/store.js';
import { saveChangedDocs } from '../editor-core/save-actions.js';

function minimalNetwork() {
  return {
    schemaVersion: '2.0.0',
    kind: 'network',
    meta: { ownCompanyId: 'C1', appName: 'テスト' },
    companies: [{ id: 'C1', name: 'C鉄道' }],
    vehicleTypes: [],
    stations: [{ id: 'S1', name: 'S1駅', kana: 'えすいち', platforms: [], location: null }],
    stationGroups: [],
    transfers: [],
    transferDefaults: { samePlatform: 5, unknown: 10 },
    lines: [],
    services: []
  };
}

function minimalOperations() {
  return { schemaVersion: '2.0.0', kind: 'operations', masters: { statusTemplates: [], causes: [] }, notices: [] };
}

function storeWithUnsavedChange() {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  store.setDoc('operations', minimalOperations(), { revision: 1 });
  store.mutateDoc('network', (doc) => { doc.stations[0].name = '変更後'; });
  return store;
}

test('base が空なら {kind:null, status:failed}', async () => {
  const store = storeWithUnsavedChange();
  const { results } = await saveChangedDocs(store, { base: '', token: 't', saveDoc: async () => { throw new Error('呼ばれないはず'); } });
  assert.deepEqual(results, [{ kind: null, status: 'failed', message: 'ログインが必要です。' }]);
});

test('token がなければ {kind:null, status:failed}', async () => {
  const store = storeWithUnsavedChange();
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: null, saveDoc: async () => { throw new Error('呼ばれないはず'); } });
  assert.deepEqual(results, [{ kind: null, status: 'failed', message: 'ログインが必要です。' }]);
});

test('未保存がないときは results が空', async () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  store.setDoc('operations', minimalOperations(), { revision: 1 });
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc: async () => { throw new Error('呼ばれないはず'); } });
  assert.deepEqual(results, []);
});

test('errors があるときは status:invalid で止まる', async () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  store.setDoc('operations', minimalOperations(), { revision: 1 });
  store.mutateDoc('network', (doc) => { doc.stations.push({ id: '不正なID！', name: 'X', kana: '', platforms: [], location: null }); });

  let called = false;
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'network');
  assert.equal(results[0].status, 'invalid');
  assert.match(results[0].message, /路線網.*エラーが 1 件/);
});

test('200: markSaved され status:saved、client が rewis-editor-graph であること', async () => {
  const store = storeWithUnsavedChange();
  const calls = [];
  const saveDoc = async (base, token, kind, doc, baseRevision, client) => {
    calls.push({ base, token, kind, baseRevision, client });
    return { ok: true, status: 200, body: { revision: 2, updatedAt: '2026-04-06T15:00:00.000Z' } };
  };
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc });

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'saved');
  assert.equal(results[0].revision, 2);
  assert.equal(results[0].message, '「路線網」を版 2 として保存しました。');
  assert.equal(store.hasUnsavedChanges('network'), false);
  assert.equal(store.state.baseRevision.network, 2);
  assert.equal(calls[0].client, 'rewis-editor-graph');
  assert.equal(calls[0].kind, 'network');
});

test('409: status:conflict で止まる', async () => {
  const store = storeWithUnsavedChange();
  const saveDoc = async () => ({ ok: false, status: 409, body: { latestRevision: 5 } });
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'conflict');
  assert.match(results[0].message, /最新は版 5/);
});

test('422: status:invalid で errors[].message をつなげる', async () => {
  const store = storeWithUnsavedChange();
  const saveDoc = async () => ({ ok: false, status: 422, body: { errors: [{ message: 'エラーA' }, { message: 'エラーB' }] } });
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'invalid');
  assert.match(results[0].message, /エラーA \/ エラーB/);
});

test('401: status:failed でログイン失効のメッセージ', async () => {
  const store = storeWithUnsavedChange();
  const saveDoc = async () => ({ ok: false, status: 401, body: {} });
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].message, /ログインの有効期限/);
});

test('その他: status:failed', async () => {
  const store = storeWithUnsavedChange();
  const saveDoc = async () => ({ ok: false, status: 500, body: { error: 'boom' } });
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].message, /boom/);
});

test('network で失敗したら operations を送らないこと', async () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  store.setDoc('operations', minimalOperations(), { revision: 1 });
  store.mutateDoc('network', (doc) => { doc.stations[0].name = '変更後'; });
  store.mutateDoc('operations', (doc) => { doc.notices.push({}); });

  const calledKinds = [];
  const saveDoc = async (base, token, kind) => {
    calledKinds.push(kind);
    return { ok: false, status: 409, body: { latestRevision: 2 } };
  };
  const { results } = await saveChangedDocs(store, { base: 'http://x', token: 't', saveDoc });
  assert.deepEqual(calledKinds, ['network']);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'network');
});
