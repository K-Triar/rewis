import { h, clear } from '../../common/dom.js';

const MAX_RESULTS = 20;

function matches(station, query) {
  if (!query) return true;
  const name = station.name || '';
  const kana = station.kana || '';
  return name.includes(query) || kana.includes(query);
}

// createStationSearch(stations, onSelect, {placeholder}) → 駅名・かなで候補を出す入力欄の要素
export function createStationSearch(stations, onSelect, { placeholder = '駅名・かなで検索' } = {}) {
  const input = h('input', { type: 'text', class: 'g-input', placeholder });
  const list = h('div', { class: 'g-overlay', hidden: true, style: 'position:absolute; z-index:900; max-height:280px; overflow:auto; width:100%;' });
  const wrap = h('div', { style: 'position:relative;' }, input, list);

  let results = [];
  let activeIndex = -1;

  let items = [];

  function renderResults() {
    clear(list);
    items = results.map((station, index) => {
      const item = h('button', {
        type: 'button',
        class: 'g-list__item' + (index === activeIndex ? ' is-selected' : ''),
        onMouseEnter: () => setActive(index),
        // input の blur より先に発火させ、blur による close() が click を潰さないようにする
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => select(station)
      }, station.name, h('span', { style: 'color:var(--fgColor-muted); margin-left:8px;' }, station.kana || ''));
      list.appendChild(item);
      return item;
    });
    list.hidden = results.length === 0;
  }

  // ホバーのたびに要素を作り直すと、マウス直下の要素が入れ替わり続けて
  // mousedown がボタンではなく親要素に当たってしまう（クリックが効かなくなる）ため、
  // 既存のボタン要素はそのままに is-selected クラスだけ付け替える。
  function setActive(index) {
    activeIndex = index;
    items.forEach((item, i) => item.classList.toggle('is-selected', i === index));
  }

  function select(station) {
    close();
    input.value = '';
    onSelect(station);
  }

  function search(query) {
    results = stations.filter((st) => matches(st, query)).slice(0, MAX_RESULTS);
    activeIndex = results.length > 0 ? 0 : -1;
    renderResults();
  }

  function close() {
    results = [];
    activeIndex = -1;
    list.hidden = true;
    clear(list);
  }

  input.addEventListener('input', () => search(input.value.trim()));
  input.addEventListener('focus', () => search(input.value.trim()));
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (event) => {
    if (list.hidden || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((activeIndex + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((activeIndex - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0) select(results[activeIndex]);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  return wrap;
}
