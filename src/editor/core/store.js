// 両エディタの共通ストア。DOM を使わない。
// createStore({ undo: false }) では元に戻す・やり直すを持たない（表形式エディタ）。
// その場合 canUndo などのメソッド自体を持たないので、ステータス行にボタンが出ない。
// 02-editor-ui-spec.md 7章。

import { validateNetwork, validateOperations } from '../../shared/schema-v2.js';

const KINDS = ['network', 'operations'];
const EMPTY_VALIDATION = { ok: true, errors: [], warnings: [] };
const MAX_HISTORY = 100;

function restoreInPlace(target, json) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, JSON.parse(json));
}

export function createStore({ undo = true } = {}) {
  const state = {
    docs: { network: null, operations: null },
    meta: { network: null, operations: null },
    baseRevision: { network: 0, operations: 0 },
    savedJson: { network: null, operations: null },
    validation: { network: EMPTY_VALIDATION, operations: EMPTY_VALIDATION }
  };

  let undoStack = [];
  let redoStack = [];

  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn(state));
  }

  function revalidate() {
    state.validation.network = state.docs.network
      ? validateNetwork(state.docs.network)
      : EMPTY_VALIDATION;
    state.validation.operations = state.docs.operations
      ? validateOperations(state.docs.operations, state.docs.network)
      : EMPTY_VALIDATION;
  }

  function pushUndo(kind) {
    if (!undo) return;
    undoStack.push({ kind, json: JSON.stringify(state.docs[kind]) });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
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
      state.savedJson[kind] = JSON.stringify(doc);
      undoStack = [];
      redoStack = [];
      revalidate();
      notify();
    },

    // ファイルや履歴から読み込んだときなど、baseRevision は変えずに未保存の状態として扱う
    replaceDocLocally(kind, doc) {
      if (state.docs[kind]) pushUndo(kind);
      state.docs[kind] = doc;
      revalidate();
      notify();
    },

    // 編集タブから、読み込み済みの doc を直接書き換える。baseRevision は変えないので未保存の状態になる
    mutateDoc(kind, mutator) {
      if (!state.docs[kind]) return;
      pushUndo(kind);
      mutator(state.docs[kind]);
      revalidate();
      notify();
    },

    markSaved(kind, revision, updatedAt, updatedBy) {
      state.baseRevision[kind] = revision;
      state.meta[kind] = { ...(state.meta[kind] || {}), revision, updatedAt, updatedBy };
      state.savedJson[kind] = JSON.stringify(state.docs[kind]);
      notify();
    },

    hasUnsavedChanges(kind) {
      if (!state.docs[kind]) return false;
      return JSON.stringify(state.docs[kind]) !== state.savedJson[kind];
    },

    hasAnyUnsavedChanges() {
      return KINDS.some((kind) => store.hasUnsavedChanges(kind));
    },

    revalidate() {
      revalidate();
      notify();
    }
  };

  if (!undo) return store;

  Object.assign(store, {
    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },

    undo() {
      if (undoStack.length === 0) return;
      const entry = undoStack.pop();
      redoStack.push({ kind: entry.kind, json: JSON.stringify(state.docs[entry.kind]) });
      restoreInPlace(state.docs[entry.kind], entry.json);
      revalidate();
      notify();
    },

    redo() {
      if (redoStack.length === 0) return;
      const entry = redoStack.pop();
      undoStack.push({ kind: entry.kind, json: JSON.stringify(state.docs[entry.kind]) });
      restoreInPlace(state.docs[entry.kind], entry.json);
      revalidate();
      notify();
    }
  });

  return store;
}

export { KINDS };
