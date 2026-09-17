import { h, clear, icon } from '../dom.js';

function isItemSelected(selected, index) {
  if (!selected || selected.type !== 'item') return false;
  const end = selected.rangeEnd ?? selected.index;
  const lo = Math.min(selected.index, end);
  const hi = Math.max(selected.index, end);
  return index >= lo && index <= hi;
}

function isConnSelected(selected, index) {
  return !!selected && selected.type === 'connector' && selected.index === index;
}

function levelBorderStyle(level) {
  if (level === 'error') return 'border-color: var(--borderColor-danger-emphasis);';
  if (level === 'warning') return 'border-color: var(--borderColor-attention-emphasis);';
  return null;
}

function renderItem(item, index, { selected, onSelect, onMove, itemsLength }) {
  const badgeRow = h('div', { class: 'g-rb-item__badges' },
    (item.badges || []).map((b) => h('span', { class: `g-label${b.variant ? ` g-label--${b.variant}` : ''}` }, b.text))
  );

  const grabber = h('span', { class: 'g-rb-item__grabber', 'aria-hidden': 'true' }, icon('grabber', { size: 12 }));

  const btn = h('button', {
    type: 'button',
    class: 'g-rb-item' + (isItemSelected(selected, index) ? ' is-selected' : ''),
    style: [item.color ? `--rb-color: ${item.color};` : null, levelBorderStyle(item.level)].filter(Boolean).join(' ') || null,
    draggable: !!onMove,
    tabIndex: 0,
    onClick: (event) => onSelect && onSelect('item', index, { shiftKey: event.shiftKey }),
    onKeydown: (event) => {
      if (!onMove || !event.altKey) return;
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        onMove(index, index - 1);
      } else if (event.key === 'ArrowRight' && index < itemsLength - 1) {
        event.preventDefault();
        onMove(index, index + 1);
      }
    },
    ondragstart: onMove ? (event) => { event.dataTransfer.setData('text/plain', String(index)); } : null,
    ondragover: onMove ? (event) => event.preventDefault() : null,
    ondrop: onMove ? (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(from) && from !== index) onMove(from, index);
    } : null
  },
    grabber,
    h('div', { class: 'g-rb-item__row1' }, h('span', { class: 'g-counter' }, String(index + 1)), h('span', { class: 'g-rb-item__label' }, item.label)),
    item.sublabel ? h('div', { class: 'g-rb-item__row2' }, item.sublabel) : null,
    badgeRow
  );

  if (isItemSelected(selected, index)) {
    queueMicrotask(() => btn.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  }

  return btn;
}

function renderConnector(conn, index, { selected, onSelect }) {
  const parts = [];
  const line = h('span', {
    class: 'g-rb-conn__line' + (conn.dashed ? ' is-dashed' : ''),
    style: conn.color ? `border-color: ${conn.color};` : null
  });
  parts.push(line);
  parts.push(h('span', { class: 'g-rb-conn__label' }, conn.label || ''));
  if (conn.through) {
    parts.push(icon('link', { size: 12 }));
    parts.push(h('span', { class: 'g-label g-label--accent' }, '直通'));
  }

  const btn = h('button', {
    type: 'button',
    class: 'g-rb-conn' + (isConnSelected(selected, index) ? ' is-selected' : ''),
    style: levelBorderStyle(conn.level),
    onClick: (event) => onSelect && onSelect('connector', index, { shiftKey: event.shiftKey })
  }, parts);

  if (isConnSelected(selected, index)) {
    queueMicrotask(() => btn.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  }

  return btn;
}

export function renderRibbon(host, { items = [], connectors = [], closed = false, selected = null, onSelect = null, onMove = null } = {}) {
  clear(host);
  const row = h('div', { class: 'g-rb-row' });

  items.forEach((item, index) => {
    row.appendChild(renderItem(item, index, { selected, onSelect, onMove, itemsLength: items.length }));
    if (index < connectors.length) {
      row.appendChild(renderConnector(connectors[index], index, { selected, onSelect }));
    }
  });

  if (closed && items.length > 0) {
    row.appendChild(h('span', { class: 'g-rb-closed' }, icon('arrow-left', { size: 14 }), '始発駅へ戻る'));
  }

  host.appendChild(row);
}
