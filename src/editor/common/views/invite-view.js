// 招待リンク・パスワード再設定リンク（<エディタのURL>#invite=<トークン>）を開いたときの画面。
// 本人がここで自分のパスワードを決める。設定するとそのままログインした状態になる。
import { h, clear } from '../dom.js';
import * as api from '../api.js';
import { formatDateTime } from '../format.js';

const MIN_PASSWORD_LENGTH = 12;

// URL の #invite=... を読み、アドレスバーと履歴からすぐ消す（画面共有や履歴からトークンが漏れないように）
export function takeInviteTokenFromUrl() {
  const m = /^#invite=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!m) return null;
  const url = new URL(window.location.href);
  url.hash = '';
  history.replaceState(history.state, '', url);
  return m[1];
}

export function renderInviteView(container, { inviteToken, onDone }) {
  clear(container);

  const wrap = h('div', { class: 'g-view g-view--centered' });
  const card = h('div', { class: 'g-card g-start-card' });
  wrap.appendChild(card);
  container.appendChild(wrap);

  const base = api.getSavedApiBase();

  function renderCard(title, ...children) {
    clear(card);
    card.appendChild(h('div', { class: 'g-card__header' }, title));
    card.appendChild(h('div', { class: 'g-card__body' }, ...children));
  }

  function backButton(label) {
    return h('button', { class: 'g-btn', type: 'button', onClick: onDone }, label);
  }

  function renderInvalid(message) {
    renderCard('パスワードの設定',
      h('div', { class: 'g-banner g-banner--danger' }, message),
      backButton('ログイン画面へ')
    );
  }

  function renderForm(invite) {
    const status = h('div', { class: 'g-banner g-banner--danger', hidden: true });
    function setError(text) {
      status.hidden = !text;
      status.textContent = text || '';
    }

    // パスワード管理ツールがユーザーIDと一緒に保存できるように、読み取り専用で置いておく
    const userIdInput = h('input', { type: 'text', class: 'g-input', autocomplete: 'username', readonly: true, value: invite.userId });
    const passwordInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'new-password', 'data-autofocus': true });
    const confirmInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'new-password' });
    const submitBtn = h('button', { class: 'g-btn g-btn--primary', type: 'submit' }, 'パスワードを設定してログイン');

    async function submit(event) {
      event.preventDefault();
      const password = passwordInput.value;
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(api.errorMessage('password_too_short'));
        return;
      }
      if (password !== confirmInput.value) {
        setError('確認用のパスワードが一致しません。');
        return;
      }
      submitBtn.disabled = true;
      let res;
      try {
        res = await api.acceptInvite(base, inviteToken, password);
      } catch {
        res = { ok: false, body: {} };
      }
      submitBtn.disabled = false;
      if (!res.ok) {
        if (res.body.error === 'invalid_invite') {
          renderInvalid(api.errorMessage('invalid_invite'));
          return;
        }
        setError(api.errorMessage(res.body.error, 'パスワードを設定できませんでした'));
        return;
      }
      renderCard('パスワードを設定しました',
        h('p', {}, `${res.body.userId} でログインしました。次回からは、このユーザーIDと設定したパスワードでログインします。`),
        h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: onDone }, '編集を始める')
      );
    }

    const lead = invite.purpose === 'reset'
      ? '新しいパスワードを設定してください。設定すると、ほかの端末のログインはすべて切れます。'
      : 'REWIS 路線データ編集システムへようこそ。ログインに使うパスワードを設定してください。';

    renderCard(invite.purpose === 'reset' ? 'パスワードの再設定' : 'アカウントの登録',
      h('p', {}, lead),
      h('form', { class: 'g-field', onSubmit: submit },
        h('div', { class: 'g-field__label' }, 'ユーザーID'),
        userIdInput,
        h('div', { class: 'g-field__label' }, '新しいパスワード'),
        passwordInput,
        h('div', { class: 'g-field__hint' }, `${MIN_PASSWORD_LENGTH}文字以上。文字の種類の決まりはありません。ほかのサービスと同じパスワードは使わないでください。`),
        h('div', { class: 'g-field__label' }, '新しいパスワード（確認）'),
        confirmInput,
        status,
        submitBtn
      ),
      h('p', { class: 'g-field__hint' }, 'このリンクは一度だけ使えます。期限: ' + formatDateTime(invite.expiresAt))
    );
    passwordInput.focus();
  }

  renderCard('パスワードの設定', h('p', {}, '確認中…'));

  if (!base) {
    renderInvalid('接続先の Workers API URL が設定されていません。');
  } else {
    api.checkInvite(base, inviteToken)
      .catch(() => ({ ok: false, body: {} }))
      .then((res) => {
        if (res.ok) {
          renderForm(res.body);
        } else {
          renderInvalid(api.errorMessage(res.body.error, 'リンクを確認できませんでした'));
        }
      });
  }

  return { destroy() {} };
}
