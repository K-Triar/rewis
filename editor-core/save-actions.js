// サーバーへの保存。DOM を使わない。02-editor-ui-spec.md 5章。

const KIND_LABEL = { network: '路線網', operations: '運行情報' };

export async function saveChangedDocs(store, { base, token, saveDoc }) {
  if (!base || !token) {
    return { results: [{ kind: null, status: 'failed', message: 'ログインが必要です。' }] };
  }

  const results = [];

  for (const kind of ['network', 'operations']) {
    if (!store.hasUnsavedChanges(kind)) continue;

    if (!store.state.validation[kind].ok) {
      const count = store.state.validation[kind].errors.length;
      results.push({
        kind,
        status: 'invalid',
        message: `「${KIND_LABEL[kind]}」にエラーが ${count} 件あるため保存できません。`
      });
      break;
    }

    const res = await saveDoc(base, token, kind, store.state.docs[kind], store.state.baseRevision[kind], 'rewis-editor-graph');

    if (res.ok) {
      store.markSaved(kind, res.body.revision, res.body.updatedAt);
      results.push({ kind, status: 'saved', message: `「${KIND_LABEL[kind]}」を版 ${res.body.revision} として保存しました。`, revision: res.body.revision });
      continue;
    }
    if (res.status === 409) {
      results.push({
        kind,
        status: 'conflict',
        message: `ほかの人が先に保存しました（最新は版 ${res.body.latestRevision}）。今の変更をファイルに書き出してから、読み込み直してください。`
      });
      break;
    }
    if (res.status === 422) {
      const messages = (res.body.errors || []).map((e) => e.message).join(' / ');
      results.push({ kind, status: 'invalid', message: `サーバーの検証で保存できませんでした: ${messages}` });
      break;
    }
    if (res.status === 401) {
      results.push({ kind, status: 'failed', message: 'ログインの有効期限が切れました。もう一度ログインしてください。' });
      break;
    }
    results.push({ kind, status: 'failed', message: `保存に失敗しました: ${res.body.error || res.status}` });
    break;
  }

  return { results };
}
