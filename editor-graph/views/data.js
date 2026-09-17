import { h, clear } from '../dom.js';
import { helpTip } from '../components/help-tip.js';
import { alertDialog, confirmDialog } from '../components/dialog.js';
import * as api from '../../editor2/api.js';
import { validateNetwork, validateOperations } from '../../shared/schema-v2.js';

const API_URL_HELP = 'REWIS のデータを保存しているサーバーの URL です。管理者から教えてもらった値を入れてください。';
const KIND_LABEL = { network: '路線網', operations: '運行情報' };

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

export function renderDataView(container, ctx) {
  clear(container);
  const { store } = ctx;

  const view = h('div', { class: 'g-view' });
  container.appendChild(view);

  view.appendChild(renderLoginCard());
  view.appendChild(renderServerCard('network'));
  view.appendChild(renderServerCard('operations'));
  view.appendChild(renderFileCard('network'));
  view.appendChild(renderFileCard('operations'));
  view.appendChild(h('p', { style: 'color:var(--fgColor-muted);' }, 'v1 からの移行は、表形式のエディタで行います。'));

  function renderLoginCard() {
    const session = api.getSavedSession();
    const status = h('div', { class: 'g-banner', hidden: true });

    function setStatus(text, variant = null) {
      if (!text) {
        status.hidden = true;
        return;
      }
      status.hidden = false;
      status.textContent = text;
      status.className = 'g-banner' + (variant ? ` g-banner--${variant}` : '');
    }

    const body = h('div', { class: 'g-card__body' });
    const card = h('div', { class: 'g-card', style: 'margin-bottom:var(--stack-gap-normal);' },
      h('div', { class: 'g-card__header' }, 'ログイン'),
      body
    );

    function rerenderBody() {
      clear(body);
      const currentSession = api.getSavedSession();
      if (currentSession) {
        body.appendChild(h('div', { class: 'g-field__label' }, `${currentSession.userId} でログイン中`));
        body.appendChild(h('button', {
          class: 'g-btn',
          type: 'button',
          onClick: async () => {
            const base = api.getSavedApiBase();
            await api.logout(base, currentSession.token);
            rerenderBody();
            ctx.refreshStatus && ctx.refreshStatus();
          }
        }, 'ログアウト'));
        return;
      }

      const apiBaseInput = h('input', {
        type: 'url', class: 'g-input', placeholder: 'https://your-worker.workers.dev', value: api.getSavedApiBase()
      });
      apiBaseInput.addEventListener('change', () => { apiBaseInput.value = api.saveApiBase(apiBaseInput.value); });
      const userIdInput = h('input', { type: 'text', class: 'g-input', autocomplete: 'username' });
      const passwordInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'current-password' });

      body.appendChild(h('div', { class: 'g-field' },
        h('div', { class: 'g-field__label' }, 'Workers API URL', helpTip(API_URL_HELP)),
        apiBaseInput,
        h('div', { class: 'g-field__label' }, 'ユーザーID'),
        userIdInput,
        h('div', { class: 'g-field__label' }, 'パスワード'),
        passwordInput,
        h('button', {
          class: 'g-btn g-btn--primary',
          type: 'button',
          onClick: async () => {
            const base = apiBaseInput.value.trim();
            if (!base) { setStatus('Workers API URL を先に設定してください。', 'attention'); return; }
            try {
              await api.login(base, userIdInput.value.trim(), passwordInput.value);
              setStatus(null);
              rerenderBody();
              ctx.refreshStatus && ctx.refreshStatus();
            } catch (e) {
              setStatus('ログインに失敗しました: ' + e.message, 'danger');
            }
          }
        }, 'ログイン'),
        status
      ));
    }

    rerenderBody();
    return card;
  }

  function renderServerCard(kind) {
    const status = h('div', { class: 'g-banner', hidden: true });
    function setStatus(text, variant = null) {
      if (!text) { status.hidden = true; return; }
      status.hidden = false;
      status.textContent = text;
      status.className = 'g-banner' + (variant ? ` g-banner--${variant}` : '');
    }

    async function doLoad() {
      const base = api.getSavedApiBase();
      const session = api.getSavedSession();
      if (!base || !session) {
        setStatus('先にログインしてください。', 'attention');
        return;
      }
      if (store.hasUnsavedChanges(kind)) {
        const ok = await confirmDialog('未保存の変更は失われます。', { confirmLabel: '読み込む', danger: true });
        if (!ok) return;
      }
      const res = await api.getDoc(base, session.token, kind);
      if (res.status === 404) {
        setStatus('サーバーにまだデータがありません。管理者に移行を依頼してください。', 'attention');
        return;
      }
      if (!res.ok) {
        setStatus(`読込に失敗しました: ${res.body.error || res.status}`, 'danger');
        return;
      }
      store.setDoc(kind, res.body.doc, res.body.meta);
      setStatus(`版 ${res.body.meta.revision} を読み込みました`, 'success');
    }

    return h('div', { class: 'g-card', style: 'margin-bottom:var(--stack-gap-normal);' },
      h('div', { class: 'g-card__header' }, `サーバーから読み込む: ${KIND_LABEL[kind]}`),
      h('div', { class: 'g-card__body' },
        h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: doLoad }, '読み込む'),
        status
      )
    );
  }

  function renderFileCard(kind) {
    const status = h('div', { class: 'g-banner', hidden: true });
    function setStatus(text, variant = null) {
      if (!text) { status.hidden = true; return; }
      status.hidden = false;
      status.textContent = text;
      status.className = 'g-banner' + (variant ? ` g-banner--${variant}` : '');
    }

    function doExport() {
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

    const fileInputId = `g-data-file-${kind}`;
    const fileInput = h('input', { type: 'file', id: fileInputId, accept: '.json', hidden: true });
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
      const diffText = Object.keys(after).map((key) => `${key}: ${before[key] ?? 0} → ${after[key]}`).join('\n');
      const ok = await confirmDialog(`このファイルの内容に置き換えます（未保存の状態として扱います）。\n\n${diffText}`, { confirmLabel: '置き換える' });
      if (!ok) return;

      store.replaceDocLocally(kind, parsed);
      setStatus('ファイルから読み込みました（未保存）', 'success');
    });

    return h('div', { class: 'g-card', style: 'margin-bottom:var(--stack-gap-normal);' },
      h('div', { class: 'g-card__header' }, `ファイル: ${KIND_LABEL[kind]}`),
      h('div', { class: 'g-card__body' },
        h('div', { style: 'display:flex; gap:var(--stack-gap-condensed);' },
          h('button', { class: 'g-btn', type: 'button', onClick: doExport }, 'ファイルに書き出す'),
          h('label', { for: fileInputId, class: 'g-btn' }, 'ファイルから読み込む'),
          fileInput
        ),
        status
      )
    );
  }

  return { destroy() {} };
}
