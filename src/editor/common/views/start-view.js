import { h, clear } from '../dom.js';
import { helpTip } from '../components/help-tip.js';
import { confirmDialog } from '../components/dialog.js';
import * as api from '../api.js';

const API_URL_HELP = 'REWIS のデータを保存しているサーバーの URL です。管理者から教えてもらった値を入れてください。';

export function renderStartView(container, ctx) {
  clear(container);
  const { store } = ctx;

  const wrap = h('div', { class: 'g-view g-view--centered' });
  const card = h('div', { class: 'g-card g-start-card' });
  wrap.appendChild(card);
  container.appendChild(wrap);

  let session = api.getSavedSession();
  const dataLoaded = !!store.state.docs.network;
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

  function renderLoginSection() {
    if (session) {
      return h('div', { class: 'g-field' },
        h('div', { class: 'g-field__label' }, `${session.userId} でログイン中`)
      );
    }

    const apiBaseInput = h('input', {
      type: 'url',
      class: 'g-input',
      placeholder: 'https://your-worker.workers.dev',
      value: api.getSavedApiBase()
    });
    apiBaseInput.addEventListener('change', () => {
      apiBaseInput.value = api.saveApiBase(apiBaseInput.value);
    });

    const userIdInput = h('input', { type: 'text', class: 'g-input', autocomplete: 'username' });
    const passwordInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'current-password' });

    async function doLogin() {
      const base = apiBaseInput.value.trim();
      if (!base) {
        setStatus('Workers API URL を先に設定してください。', 'attention');
        return;
      }
      try {
        session = await api.login(base, userIdInput.value.trim(), passwordInput.value);
        setStatus(null);
        rerender();
        ctx.refreshStatus && ctx.refreshStatus();
      } catch (e) {
        setStatus('ログインに失敗しました: ' + e.message, 'danger');
      }
    }

    return h('div', { class: 'g-field' },
      h('div', { class: 'g-field__label' }, 'Workers API URL', helpTip(API_URL_HELP)),
      apiBaseInput,
      h('div', { class: 'g-field__label' }, 'ユーザーID'),
      userIdInput,
      h('div', { class: 'g-field__label' }, 'パスワード'),
      passwordInput,
      h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: doLogin }, 'ログイン')
    );
  }

  async function doLoadData() {
    const base = api.getSavedApiBase();
    const token = session ? session.token : null;
    if (!base || !token) {
      setStatus('先にログインしてください。', 'attention');
      return;
    }
    if (store.hasAnyUnsavedChanges()) {
      const ok = await confirmDialog('未保存の変更は失われます。', { confirmLabel: '読み込む', danger: true });
      if (!ok) return;
    }
    setStatus(null);
    for (const kind of ['network', 'operations']) {
      const res = await api.getDoc(base, token, kind);
      if (res.status === 404) {
        setStatus('サーバーにまだデータがありません。管理者に移行を依頼してください。', 'attention');
        return;
      }
      if (res.status === 401) {
        api.clearSession();
        session = null;
        setStatus('ログインの有効期限が切れました。もう一度ログインしてください。', 'danger');
        rerender();
        return;
      }
      if (!res.ok) {
        setStatus(`読込に失敗しました: ${res.body.error || res.status}`, 'danger');
        return;
      }
      store.setDoc(kind, res.body.doc, res.body.meta);
    }
    ctx.onLoaded && ctx.onLoaded();
  }

  function rerender() {
    clear(card);
    card.appendChild(h('div', { class: 'g-card__header' }, '路線データ編集を始める'));
    const body = h('div', { class: 'g-card__body' });
    body.appendChild(h('div', { class: 'g-field__label' }, '① ログイン'));
    body.appendChild(renderLoginSection());
    body.appendChild(h('div', { class: 'g-field__label', style: 'margin-top:var(--stack-gap-normal);' }, '② データを読み込む'));
    const loadButton = h('button', {
      class: 'g-btn' + (dataLoaded ? '' : ' g-btn--primary'),
      type: 'button',
      disabled: !session,
      onClick: doLoadData
    }, dataLoaded ? 'サーバーから読み込み直す' : '路線網と運行情報を読み込む');
    if (dataLoaded) {
      // ログアウト前に読み込んでいたデータ（未保存の変更を含む）のまま編集に戻る
      body.appendChild(h('div', { style: 'display:flex; gap:var(--stack-gap-condensed);' },
        h('button', {
          class: 'g-btn g-btn--primary',
          type: 'button',
          disabled: !session,
          onClick: () => ctx.onLoaded && ctx.onLoaded()
        }, '編集を続ける'),
        loadButton
      ));
    } else {
      body.appendChild(loadButton);
    }
    body.appendChild(status);
    card.appendChild(body);
  }

  rerender();

  return { destroy() {} };
}
