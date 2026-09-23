import { h, clear } from '../../common/dom.js';

// stations: [{id, name, kana}] を検索候補として、選ぶと onSelect(stationId) を呼ぶ入力欄を作る
export function createStationPicker(stations, onSelect, { placeholder = '駅名・かなで検索' } = {}) {
  const input = h('input', { type: 'text', class: 'g-input', placeholder });
  const list = h('div', { class: 'g-overlay', hidden: true, style: 'position:absolute; z-index:900; max-height:280px; overflow:auto; width:100%;' });
  const wrapper = h('div', { style: 'position:relative;' }, input, list);

  function renderSuggestions() {
    const needle = input.value.trim();
    clear(list);
    if (!needle) {
      list.hidden = true;
      return;
    }
    const matches = stations
      .filter((s) => s.name.includes(needle) || (s.kana || '').includes(needle))
      .slice(0, 20);
    if (matches.length === 0) {
      list.hidden = true;
      return;
    }
    matches.forEach((s) => {
      list.appendChild(h('button', {
        type: 'button',
        class: 'g-list__item',
        onMousedown: (e) => e.preventDefault(),
        onClick: () => {
          input.value = '';
          list.hidden = true;
          onSelect(s.id);
        }
      }, `${s.name}（${s.id}）`));
    });
    list.hidden = false;
  }

  input.addEventListener('input', renderSuggestions);
  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('blur', () => {
    setTimeout(() => { list.hidden = true; }, 150);
  });

  return wrapper;
}
