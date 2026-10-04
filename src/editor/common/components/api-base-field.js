import { h } from '../dom.js';
import { helpTip } from './help-tip.js';
import * as api from '../api.js';

const API_URL_HELP = 'REWIS のデータを保存しているサーバーの URL です。通常は変更する必要はありません。';

// ログイン欄の「詳細設定」。本番 URL が最初から入っており、ローカル Worker で試すときだけ書き換える
export function apiBaseField() {
  const input = h('input', {
    type: 'url',
    class: 'g-input',
    placeholder: api.getDefaultApiBase() || 'https://your-worker.workers.dev',
    value: api.getSavedApiBase()
  });
  input.addEventListener('change', () => {
    input.value = api.saveApiBase(input.value);
  });
  const element = h('details', { class: 'g-disclosure', open: api.getSavedApiBase() !== api.getDefaultApiBase() },
    h('summary', {}, '詳細設定'),
    h('div', { class: 'g-field' },
      h('div', { class: 'g-field__label' }, 'Workers API URL', helpTip(API_URL_HELP)),
      input
    )
  );
  return { element, input };
}
