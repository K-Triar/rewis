import { validateNetwork, validateOperations } from '../shared/schema-v2.js';

const KINDS = ['network', 'operations'];
const EMPTY_VALIDATION = { ok: true, errors: [], warnings: [] };

export function createStore() {
  const state = {
    docs: { network: null, operations: null },
    meta: { network: null, operations: null },
    baseRevision: { network: 0, operations: 0 },
    savedJson: { network: null, operations: null },
    validation: { network: EMPTY_VALIDATION, operations: EMPTY_VALIDATION }
  };

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

  const store = {
    state,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    setDoc(kind, doc, meta) {
      state.docs[kind] = doc;
      state.meta[kind] = meta || null;
      state.baseRevision[kind] = meta ? meta.revision : 0;
      state.savedJson[kind] = JSON.stringify(doc);
      revalidate();
      notify();
    },

    // ファイルや履歴から読み込んだときなど、baseRevisionは変えずに未保存の状態として扱う
    replaceDocLocally(kind, doc) {
      state.docs[kind] = doc;
      revalidate();
      notify();
    },

    // 編集タブから、読み込み済みのdocを直接書き換える。baseRevisionは変えないので未保存の状態になる
    mutateDoc(kind, mutator) {
      if (!state.docs[kind]) return;
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

  return store;
}
