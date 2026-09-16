// 図形式エディタの共通ストア（最小版。4.5-2 で undo・redo・mutateDoc・markSaved などを足して完成させる）。
// DOM を使わない。02-editor-ui-spec.md 7章。

const KINDS = ['network', 'operations'];

export function createStore() {
  const state = {
    docs: { network: null, operations: null },
    meta: { network: null, operations: null },
    baseRevision: { network: 0, operations: 0 }
  };

  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn(state));
  }

  const store = {
    state,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // サーバーからの読込
    setDoc(kind, doc, meta) {
      state.docs[kind] = doc;
      state.meta[kind] = meta || null;
      state.baseRevision[kind] = meta ? meta.revision : 0;
      notify();
    },

    // ファイルや履歴から読み込んだときなど、baseRevision は変えずに未保存の状態として扱う
    replaceDocLocally(kind, doc) {
      state.docs[kind] = doc;
      notify();
    }
  };

  return store;
}

export { KINDS };
