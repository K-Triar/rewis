import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../editor-core/store.js';

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

test('mutateDoc → undo → redo', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });

  store.mutateDoc('network', (doc) => { doc.stations[0].name = '変更後'; });
  assert.equal(store.state.docs.network.stations[0].name, '変更後');

  store.undo();
  assert.equal(store.state.docs.network.stations[0].name, 'S1駅');

  store.redo();
  assert.equal(store.state.docs.network.stations[0].name, '変更後');
});

test('undo の後の mutateDoc で redo が空になること', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });

  store.mutateDoc('network', (doc) => { doc.stations[0].name = 'A'; });
  store.undo();
  assert.equal(store.canRedo(), true);

  store.mutateDoc('network', (doc) => { doc.stations[0].name = 'B'; });
  assert.equal(store.canRedo(), false);
});

test('setDoc で両方が空になること', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  store.mutateDoc('network', (doc) => { doc.stations[0].name = 'A'; });
  assert.equal(store.canUndo(), true);

  store.setDoc('network', minimalNetwork(), { revision: 2 });
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);
});

test('101件目で、いちばん古いものが捨てられること', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });

  for (let i = 0; i < 101; i++) {
    store.mutateDoc('network', (doc) => { doc.stations[0].name = `n${i}`; });
  }
  for (let i = 0; i < 101; i++) store.undo();
  // 100件しか積まれていないはずなので、最初の変更（n0）より前には戻れない
  assert.equal(store.state.docs.network.stations[0].name, 'n0');
});

test('undo の後も state.docs.network が同じオブジェクト（===）であること', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  const before = store.state.docs.network;

  store.mutateDoc('network', (doc) => { doc.stations[0].name = 'A'; });
  store.undo();

  assert.equal(store.state.docs.network, before);
});

test('replaceDocLocally を戻せること', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });

  const replacement = minimalNetwork();
  replacement.stations[0].name = '置き換え後';
  store.replaceDocLocally('network', replacement);
  const afterReplace = store.state.docs.network;
  assert.equal(afterReplace.stations[0].name, '置き換え後');

  store.undo();
  // undo はオブジェクトを入れ替えず、置き換え後のオブジェクトに内容だけ書き戻す
  assert.equal(store.state.docs.network, afterReplace);
  assert.equal(store.state.docs.network.stations[0].name, 'S1駅');

  store.redo();
  assert.equal(store.state.docs.network, afterReplace);
  assert.equal(store.state.docs.network.stations[0].name, '置き換え後');
});

test('hasUnsavedChanges と markSaved', () => {
  const store = createStore();
  store.setDoc('network', minimalNetwork(), { revision: 1 });
  assert.equal(store.hasUnsavedChanges('network'), false);
  assert.equal(store.hasAnyUnsavedChanges(), false);

  store.mutateDoc('network', (doc) => { doc.stations[0].name = 'A'; });
  assert.equal(store.hasUnsavedChanges('network'), true);
  assert.equal(store.hasAnyUnsavedChanges(), true);

  store.markSaved('network', 2, '2026-04-06T15:00:00.000Z');
  assert.equal(store.hasUnsavedChanges('network'), false);
  assert.equal(store.hasAnyUnsavedChanges(), false);
  assert.equal(store.state.baseRevision.network, 2);
});

test('canUndo/canRedo は未読込のときも安全', () => {
  const store = createStore();
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);
  store.undo();
  store.redo();
});
