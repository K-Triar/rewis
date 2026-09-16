import { h, clear } from '../dom.js';
import * as api from '../api.js';
import { alertDialog, confirmDialog } from '../components/dialog.js';
import { validateNetwork, validateOperations } from '../../shared/schema-v2.js';
import { convertV1ToV2 } from '../../shared/convert-v1-to-v2.js';
import v1Overrides from '../../shared/v1-overrides.js';

const KIND_LABEL = { network: '路線網 (network)', operations: '運行情報 (operations)' };

function currentToken() {
  const session = api.getSavedSession();
  return session ? session.token : null;
}

function summarizeCounts(kind, doc) {
  if (!doc) return {};
  if (kind === 'network') {
    return {
      companies: (doc.companies || []).length,
      stations: (doc.stations || []).length,
      lines: (doc.lines || []).length,
      services: (doc.services || []).length,
      transfers: (doc.transfers || []).length
    };
  }
  return { notices: (doc.notices || []).length };
}

export function renderIoView(container, ctx) {
  clear(container);
  const { store, refreshAll } = ctx;

  const apiBaseInput = h('input', {
    type: 'url',
    id: 'ed2-api-base',
    placeholder: 'https://your-worker.workers.dev',
    value: api.getSavedApiBase()
  });
  apiBaseInput.addEventListener('change', () => {
    apiBaseInput.value = api.saveApiBase(apiBaseInput.value);
  });

  const session = api.getSavedSession();
  const userIdInput = h('input', { type: 'text', autocomplete: 'username', value: session ? session.userId : '' });
  const passwordInput = h('input', { type: 'password', autocomplete: 'current-password' });
  const authStatus = h('div', { class: 'worker-auth-status' }, session ? `認証済み（${session.userId}）` : '未認証');

  async function doLogin() {
    const base = apiBaseInput.value.trim();
    if (!base) {
      authStatus.textContent = 'Workers API URL を先に設定してください。';
      return;
    }
    try {
      const s = await api.login(base, userIdInput.value.trim(), passwordInput.value);
      passwordInput.value = '';
      authStatus.textContent = `認証済み（${s.userId}）`;
      authStatus.style.color = '#080';
    } catch (e) {
      authStatus.textContent = '認証失敗: ' + e.message;
      authStatus.style.color = '#c00';
    }
  }

  async function doLogout() {
    const base = apiBaseInput.value.trim();
    const s = api.getSavedSession();
    await api.logout(base, s ? s.token : null);
    authStatus.textContent = '未認証';
    authStatus.style.color = '#444';
  }

  const authCard = h('div', { class: 'export-card' },
    h('h3', {}, '外部正本 (Cloudflare Workers v2・試験用)'),
    h('p', {}, 'ここでの保存は段階4のステージング用です。本番の切り替えは段階5でまとめて行います。'),
    h('div', { class: 'worker-config-grid' },
      h('label', {}, 'Workers API URL'), apiBaseInput,
      h('label', {}, 'ユーザーID'), userIdInput,
      h('label', {}, 'パスワード'), passwordInput
    ),
    h('div', { class: 'worker-config-actions' },
      h('button', { class: 'export-btn', type: 'button', onClick: doLogin }, 'ログイン'),
      h('button', { class: 'preview-btn', type: 'button', onClick: doLogout }, 'ログアウト')
    ),
    authStatus
  );

  container.appendChild(authCard);
  container.appendChild(renderMigrationCard(ctx, apiBaseInput));
  container.appendChild(renderKindCard('network', ctx, apiBaseInput));
  container.appendChild(renderKindCard('operations', ctx, apiBaseInput));
  container.appendChild(renderPreviewCard(store));

  refreshAll();
}

function renderKindCard(kind, ctx, apiBaseInput) {
  const { store, refreshAll } = ctx;
  const status = h('div', { class: 'worker-auth-status' }, 'まだ読み込んでいません');

  async function doLoad() {
    const base = apiBaseInput.value.trim();
    if (!base) {
      await alertDialog('Workers API URL を設定してください。');
      return;
    }
    const token = currentToken();
    if (!token) {
      await alertDialog('先にログインしてください。');
      return;
    }
    const res = await api.getDoc(base, token, kind);
    if (res.status === 404) {
      status.textContent = '外部正本が未初期化です（管理者による移行が必要です）。';
      return;
    }
    if (!res.ok) {
      status.textContent = `読込に失敗しました: ${res.body.error || res.status}`;
      return;
    }
    store.setDoc(kind, res.body.doc, res.body.meta);
    status.textContent = `版 ${res.body.meta.revision} を読み込みました`;
    refreshAll();
  }

  async function doSave() {
    const base = apiBaseInput.value.trim();
    if (!base) {
      await alertDialog('Workers API URL を設定してください。');
      return;
    }
    const token = currentToken();
    if (!token) {
      await alertDialog('先にログインしてください。');
      return;
    }
    const doc = store.state.docs[kind];
    if (!doc) {
      await alertDialog('保存するデータがありません。先に読み込んでください。');
      return;
    }
    if (!store.state.validation[kind].ok) {
      await alertDialog('errors がある間は保存できません。上の issues 一覧を確認してください。');
      return;
    }

    const res = await api.saveDoc(base, token, kind, doc, store.state.baseRevision[kind]);
    if (res.status === 409) {
      status.textContent = `競合が発生しました（最新版 ${res.body.latestRevision}）。読み込み直してから編集し直してください。`;
      return;
    }
    if (res.status === 422) {
      const messages = (res.body.errors || []).map((e) => e.message).join(' / ');
      status.textContent = `検証エラーがあり保存できませんでした: ${messages}`;
      return;
    }
    if (!res.ok) {
      status.textContent = `保存に失敗しました: ${res.body.error || res.status}`;
      return;
    }
    store.markSaved(kind, res.body.revision, res.body.updatedAt);
    status.textContent = `版 ${res.body.revision} として保存しました`;
    refreshAll();
  }

  const fileInputId = `ed2-file-${kind}`;
  const fileInput = h('input', { type: 'file', id: fileInputId, accept: '.json', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      await alertDialog('JSON として読み込めませんでした: ' + e.message);
      return;
    }
    if (parsed.kind !== kind) {
      await alertDialog(`kind が一致しません（期待: ${kind}、実際: ${parsed.kind}）。`);
      return;
    }
    const check = kind === 'network'
      ? validateNetwork(parsed)
      : validateOperations(parsed, store.state.docs.network);
    if (!check.ok) {
      await alertDialog(`検証エラーがあり読み込めませんでした（${check.errors.length}件）。先頭: ${check.errors[0].message}`);
      return;
    }

    const before = summarizeCounts(kind, store.state.docs[kind]);
    const after = summarizeCounts(kind, parsed);
    const diffText = Object.keys(after)
      .map((key) => `${key}: ${before[key] ?? 0} → ${after[key]}`)
      .join('\n');
    const ok = await confirmDialog(`このファイルの内容に置き換えます（未保存の状態として扱います）。\n\n${diffText}\n\nよろしいですか？`);
    if (!ok) return;

    store.replaceDocLocally(kind, parsed);
    status.textContent = 'ファイルから読み込みました（未保存）';
    refreshAll();
  });
  const fileLabel = h('label', { for: fileInputId, class: 'file-label' }, 'ファイルから読み込む');

  const saveBtn = h('button', { class: 'export-btn', type: 'button', onClick: doSave }, '保存');
  store.subscribe((state) => {
    saveBtn.disabled = !state.validation[kind].ok;
  });
  saveBtn.disabled = !store.state.validation[kind].ok;

  function doExportFile() {
    const doc = store.state.docs[kind];
    if (!doc) {
      alertDialog('書き出すデータがありません。');
      return;
    }
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `${kind}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return h('div', { class: 'export-card' },
    h('h3', {}, KIND_LABEL[kind]),
    h('div', { class: 'worker-config-actions' },
      h('button', { class: 'preview-btn', type: 'button', onClick: doLoad }, '読込'),
      saveBtn,
      fileInput,
      fileLabel,
      h('button', { class: 'preview-btn', type: 'button', onClick: doExportFile }, 'ファイルに書き出す')
    ),
    status
  );
}

function buildReportSummary(report) {
  const lines = [];
  Object.entries(report.stats || {}).forEach(([key, value]) => {
    lines.push(`${key}: ${value}`);
  });
  if ((report.issues || []).length > 0) {
    lines.push('');
    lines.push(`issues ${report.issues.length}件:`);
    report.issues.forEach((i) => lines.push(`- [${i.code}] ${i.message}`));
  } else {
    lines.push('');
    lines.push('issues: なし');
  }
  return lines.join('\n');
}

function renderMigrationCard(ctx, apiBaseInput) {
  const { store, refreshAll } = ctx;
  const status = h('div', { class: 'worker-auth-status' }, '');
  const reportPre = h('pre', { class: 'ed2-json-preview', hidden: true });

  async function doMigrate() {
    const base = apiBaseInput.value.trim();
    if (!base) {
      await alertDialog('Workers API URL を設定してください。');
      return;
    }
    const token = currentToken();
    if (!token) {
      await alertDialog('先にログインしてください。');
      return;
    }

    status.textContent = 'v1データを読み込んでいます…';
    reportPre.hidden = true;
    const v1Res = await api.getV1Latest(base, token);
    if (v1Res.status === 404) {
      status.textContent = 'v1データが未初期化です。';
      return;
    }
    if (!v1Res.ok) {
      status.textContent = `v1データの読込に失敗しました: ${v1Res.body.error || v1Res.status}`;
      return;
    }

    const { network, operations, report } = convertV1ToV2(v1Res.body.data, v1Overrides);
    reportPre.textContent = buildReportSummary(report);
    reportPre.hidden = false;

    const networkCheck = validateNetwork(network);
    const operationsCheck = validateOperations(operations, network);
    if (!networkCheck.ok || !operationsCheck.ok) {
      status.textContent = `変換したデータに errors があります（network: ${networkCheck.errors.length}件 / operations: ${operationsCheck.errors.length}件）。移行できません。`;
      return;
    }

    const ok = await confirmDialog(
      `v1データを変換してステージング（v2）に取り込みます。\n\n${buildReportSummary(report)}\n\nよろしいですか？`
    );
    if (!ok) {
      status.textContent = 'キャンセルしました。';
      return;
    }

    let res = await api.adminImport(base, token, { network, operations, force: false });
    if (res.status === 409) {
      const forceOk = await confirmDialog(
        '既に v2 のステージングデータがあります。上書きすると、ステージングで編集した内容は失われます。上書きしますか？'
      );
      if (!forceOk) {
        status.textContent = 'キャンセルしました（既存のステージングデータはそのままです）。';
        return;
      }
      res = await api.adminImport(base, token, { network, operations, force: true });
    }
    if (res.status === 403) {
      status.textContent = '管理者ではないため実行できません。';
      return;
    }
    if (!res.ok) {
      status.textContent = `移行に失敗しました: ${res.body.error || res.status}`;
      return;
    }

    status.textContent = `移行しました（network 版 ${res.body.network.revision} / operations 版 ${res.body.operations.revision}）。「読込」ボタンで読み込み直してください。`;
    refreshAll();
  }

  return h('div', { class: 'export-card' },
    h('h3', {}, 'v1 から移行（管理者）'),
    h('p', {}, 'v1 の /data/latest を読み込み、v2 形式に変換してステージングに取り込みます（管理者のみ）。'),
    h('div', { class: 'worker-config-actions' },
      h('button', { class: 'preview-btn', type: 'button', onClick: doMigrate }, 'v1 から移行')
    ),
    status,
    reportPre
  );
}

function renderPreviewCard(store) {
  const pre = h('pre', { class: 'ed2-json-preview', hidden: true });

  function refresh() {
    pre.textContent = JSON.stringify(store.state.docs, null, 2);
  }
  refresh();

  const toggleBtn = h('button', {
    class: 'preview-btn',
    type: 'button',
    onClick: () => {
      pre.hidden = !pre.hidden;
      if (!pre.hidden) refresh();
    }
  }, '表示/非表示');

  return h('div', { class: 'export-card' },
    h('h3', {}, 'JSON プレビュー'),
    toggleBtn,
    pre
  );
}
