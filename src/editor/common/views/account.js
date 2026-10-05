// 「アカウント」タブ。自分のパスワード変更と、管理者（Worker の ADMIN_USERS）だけが使うユーザー管理。
// ユーザー管理では招待リンク・再設定リンクを発行し、管理者がそれを本人に送る。
// パスワードは本人がリンク先で設定するので、管理者が知ることはない。
import { h, clear } from '../dom.js';
import * as api from '../api.js';
import { alertDialog, confirmDialog, openDialog } from '../components/dialog.js';
import { formatDateTime } from '../format.js';

const MIN_PASSWORD_LENGTH = 12;

export function renderAccountView(container, ctx) {
  const view = h('div', { class: 'g-view' });
  container.appendChild(view);
  const column = h('div', { class: 'g-single-col' });
  view.appendChild(column);

  function base() { return api.getSavedApiBase(); }

  const session = api.getSavedSession();
  if (!session) {
    column.appendChild(h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, 'アカウント'),
      h('div', { class: 'g-card__body' },
        h('p', {}, 'ログインしていません。［データの読込と書出］タブか、最初の画面からログインしてください。'),
        h('p', { class: 'g-field__hint' }, 'パスワードを忘れた場合は、管理者に再設定リンクの発行を依頼してください。')
      )
    ));
    return { destroy() {} };
  }

  column.appendChild(renderPasswordCard());
  // 管理者かどうかはサーバーに聞く（ADMIN_USERS を変えたときや、この版より前のログインでも正しく出す）
  api.getMe(base(), session.token)
    .then((res) => {
      if (res.ok && res.body.isAdmin) column.appendChild(renderUsersCard());
    })
    .catch(() => {});

  function renderPasswordCard() {
    const status = h('div', { class: 'g-banner', hidden: true });
    function setStatus(text, variant) {
      status.hidden = !text;
      status.textContent = text || '';
      status.className = 'g-banner' + (variant ? ` g-banner--${variant}` : '');
    }

    const userIdInput = h('input', { type: 'text', class: 'g-input', autocomplete: 'username', readonly: true, value: session.userId });
    const currentInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'current-password' });
    const newInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'new-password' });
    const confirmInput = h('input', { type: 'password', class: 'g-input', autocomplete: 'new-password' });
    const submitBtn = h('button', { class: 'g-btn g-btn--primary', type: 'submit' }, 'パスワードを変更');

    async function submit(event) {
      event.preventDefault();
      if (newInput.value.length < MIN_PASSWORD_LENGTH) {
        setStatus(api.errorMessage('password_too_short'), 'danger');
        return;
      }
      if (newInput.value !== confirmInput.value) {
        setStatus('確認用のパスワードが一致しません。', 'danger');
        return;
      }
      submitBtn.disabled = true;
      const current = api.getSavedSession();
      const res = await api.changePassword(base(), current && current.token, currentInput.value, newInput.value)
        .catch(() => ({ ok: false, status: 0, body: {} }));
      submitBtn.disabled = false;
      if (res.status === 401 && res.body.error === 'unauthorized') { ctx.onUnauthorized(); return; }
      if (!res.ok) {
        setStatus(api.errorMessage(res.body.error, 'パスワードを変更できませんでした'), 'danger');
        return;
      }
      currentInput.value = '';
      newInput.value = '';
      confirmInput.value = '';
      setStatus('パスワードを変更しました。ほかの端末のログインは切れました。', 'success');
    }

    return h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, 'パスワードの変更'),
      h('div', { class: 'g-card__body' },
        h('form', { class: 'g-field', onSubmit: submit },
          h('div', { class: 'g-field__label' }, 'ユーザーID'),
          userIdInput,
          h('div', { class: 'g-field__label' }, '今のパスワード'),
          currentInput,
          h('div', { class: 'g-field__label' }, '新しいパスワード'),
          newInput,
          h('div', { class: 'g-field__hint' }, `${MIN_PASSWORD_LENGTH}文字以上。文字の種類の決まりはありません。`),
          h('div', { class: 'g-field__label' }, '新しいパスワード（確認）'),
          confirmInput,
          status,
          submitBtn
        )
      )
    );
  }

  function renderUsersCard() {
    const body = h('div', { class: 'g-card__body' });
    const card = h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, 'ユーザー管理（管理者のみ）'),
      body
    );

    let users = [];
    let loadError = '';

    function token() {
      const current = api.getSavedSession();
      return current ? current.token : null;
    }

    // 401 なら再ログインへ。そのほかのエラーはダイアログで知らせる。成功したら true
    async function handleResult(res, fallback) {
      if (res.status === 401) { ctx.onUnauthorized(); return false; }
      if (!res.ok) {
        await alertDialog(api.errorMessage(res.body.error, fallback));
        return false;
      }
      return true;
    }

    async function load() {
      const res = await api.adminListUsers(base(), token()).catch(() => ({ ok: false, status: 0, body: {} }));
      if (res.status === 401) { ctx.onUnauthorized(); return; }
      if (res.ok) {
        users = res.body.users || [];
        loadError = '';
      } else {
        loadError = api.errorMessage(res.body.error, 'ユーザー一覧を読み込めませんでした');
      }
      render();
    }

    // 操作の応答に入っている更新後のユーザーで一覧を差し替える（null なら一覧から消す）。
    // KV の一覧は反映が遅れることがあるので、操作のたびに読み直さない
    function applyUser(userId, user) {
      const rest = users.filter((u) => u.userId !== userId);
      users = user ? [...rest, user].sort((a, b) => a.userId.localeCompare(b.userId)) : rest;
      render();
    }

    async function issueInvite(userId, purpose) {
      const res = await api.adminCreateInvite(base(), token(), userId, purpose).catch(() => ({ ok: false, status: 0, body: {} }));
      if (!(await handleResult(res, 'リンクを発行できませんでした'))) return false;
      applyUser(userId, res.body.user);
      await showLinkDialog(res.body);
      return true;
    }

    async function revokeInvite(user) {
      const message = user.status === 'invited'
        ? `${user.userId} の招待を取り消します。リンクは使えなくなり、ユーザーも一覧から消えます。`
        : `${user.userId} の再設定リンクを取り消します。今のパスワードはそのまま使えます。`;
      if (!(await confirmDialog(message, { confirmLabel: '取り消す', danger: true }))) return;
      const res = await api.adminRevokeInvite(base(), token(), user.userId).catch(() => ({ ok: false, status: 0, body: {} }));
      if (await handleResult(res, '取り消せませんでした')) applyUser(user.userId, res.body.user);
    }

    async function setDisabled(user, disabled) {
      if (disabled) {
        const ok = await confirmDialog(
          `${user.userId} を無効にします。ログインできなくなり、ログイン中の画面からも保存できなくなります（反映まで最大1分ほどかかります）。発行中のリンクも取り消されます。`,
          { confirmLabel: '無効にする', danger: true }
        );
        if (!ok) return;
      }
      const res = await api.adminSetDisabled(base(), token(), user.userId, disabled).catch(() => ({ ok: false, status: 0, body: {} }));
      if (await handleResult(res, '変更できませんでした')) applyUser(user.userId, res.body.user);
    }

    function statusLabels(user) {
      const labels = [];
      if (user.isAdmin) labels.push(h('span', { class: 'g-label g-label--accent' }, '管理者'));
      if (user.disabled) labels.push(h('span', { class: 'g-label g-label--danger' }, '無効'));
      if (user.status === 'invited') {
        labels.push(h('span', { class: 'g-label g-label--attention' }, user.invite ? '招待中' : '招待の期限切れ'));
      } else if (user.invite) {
        labels.push(h('span', { class: 'g-label g-label--attention' }, '再設定リンク発行中'));
      }
      if (user.legacy) labels.push(h('span', { class: 'g-label' }, '旧方式'));
      if (labels.length === 0) labels.push(h('span', { class: 'g-label g-label--success' }, '有効'));
      labels.forEach((label) => { label.style.whiteSpace = 'nowrap'; });
      return h('div', { style: 'display:flex; flex-wrap:wrap; gap:var(--space-xxs);' }, labels);
    }

    function actionButtons(user) {
      const btn = (label, onClick, extra = '') => h('button', { class: `g-btn g-btn--small ${extra}`, type: 'button', onClick }, label);
      const buttons = [];
      if (user.status === 'invited') {
        if (!user.disabled) buttons.push(btn('招待リンクを再発行', () => issueInvite(user.userId, 'new')));
        if (user.invite) buttons.push(btn('招待を取り消す', () => revokeInvite(user)));
      } else if (!user.disabled) {
        buttons.push(btn(user.invite ? '再設定リンクを再発行' : '再設定リンクを発行', () => issueInvite(user.userId, 'reset')));
        if (user.invite) buttons.push(btn('リンクを取り消す', () => revokeInvite(user)));
      }
      const self = api.getSavedSession();
      if (!user.isAdmin && !(self && self.userId === user.userId)) {
        buttons.push(user.disabled
          ? btn('有効にする', () => setDisabled(user, false))
          : btn('無効にする', () => setDisabled(user, true), 'g-btn--danger'));
      }
      return h('div', { style: 'display:flex; flex-wrap:wrap; gap:var(--space-xxs);' }, buttons);
    }

    function renderInviteForm() {
      const input = h('input', { type: 'text', class: 'g-input', autocomplete: 'off', placeholder: '例: tanaka', spellcheck: 'false' });
      async function submit(event) {
        event.preventDefault();
        const userId = input.value.trim();
        if (!userId) return;
        if (await issueInvite(userId, 'new')) input.value = '';
      }
      return h('form', { class: 'g-field', onSubmit: submit },
        h('div', { class: 'g-field__label' }, '新しいユーザーを招待'),
        h('div', { style: 'display:flex; gap:var(--stack-gap-condensed);' },
          input,
          h('button', { class: 'g-btn g-btn--primary', type: 'submit', style: 'flex:none;' }, '招待リンクを発行')
        ),
        h('div', { class: 'g-field__hint' }, 'ユーザーIDは半角英数字で始め、半角英数字と _ . - の32文字以内。メールアドレスは使いません。')
      );
    }

    function render() {
      clear(body);
      body.appendChild(renderInviteForm());
      if (loadError) {
        body.appendChild(h('div', { class: 'g-banner g-banner--danger' }, loadError));
        return;
      }
      const rows = users.map((user) => h('tr', {},
        h('td', {}, user.userId),
        h('td', {}, statusLabels(user),
          user.invite ? h('div', { class: 'g-field__hint' }, 'リンクの期限: ' + formatDateTime(user.invite.expiresAt)) : null),
        h('td', {}, actionButtons(user))
      ));
      body.appendChild(h('div', { class: 'g-table-wrap' },
        h('table', { class: 'g-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'ユーザーID'), h('th', {}, '状態'), h('th', {}, '操作'))),
          h('tbody', {}, rows)
        )
      ));
      body.appendChild(h('p', { class: 'g-field__hint' },
        '「旧方式」のユーザーは、次にログインした時点で自動的に新しい方式に切り替わります。管理者の指定は Cloudflare の ADMIN_USERS で行います。'));
    }

    body.appendChild(h('p', {}, '読込中…'));
    load();
    return card;
  }

  return { destroy() {} };
}

// 発行したリンクを表示する。リンクはこの画面を閉じると二度と表示できない（サーバーにはハッシュしか残らない）
function showLinkDialog({ userId, purpose, token, expiresAt }) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `invite=${token}`;
  const link = url.toString();

  return openDialog((close) => {
    const input = h('input', { type: 'text', class: 'g-input', readonly: true, value: link, onFocus: (e) => e.target.select() });
    const copied = h('span', { class: 'g-text-muted', hidden: true }, 'コピーしました');
    const copyBtn = h('button', {
      class: 'g-btn g-btn--primary',
      type: 'button',
      'data-autofocus': true,
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          input.select();
          document.execCommand('copy');
        }
        copied.hidden = false;
      }
    }, 'リンクをコピー');
    const what = purpose === 'reset' ? 'パスワード再設定リンク' : '招待リンク';
    return h('div', { class: 'g-dialog', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'g-dialog__title' }, `${userId} の${what}`),
      h('div', { class: 'g-dialog__message' },
        h('p', {}, `このリンクを ${userId} さん本人だけに送ってください。リンクを開いた人がパスワードを設定できます。`),
        h('p', {}, `一度だけ使えます。期限: ${formatDateTime(expiresAt)}。この画面を閉じるとリンクはもう表示できないので、必要なら再発行してください（古いリンクは使えなくなります）。`),
        input
      ),
      h('div', { class: 'g-dialog__actions' },
        copied,
        copyBtn,
        h('button', { class: 'g-btn', type: 'button', onClick: () => close(true) }, '閉じる')
      )
    );
  });
}
