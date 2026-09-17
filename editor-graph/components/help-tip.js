import { h, icon } from '../dom.js';
import { openPopover } from './overlay.js';

export function helpTip(text) {
  const btn = h('button', {
    type: 'button',
    class: 'g-icon-btn g-btn--invisible g-btn--small',
    'aria-label': '説明',
    title: text,
    onClick: (event) => {
      event.stopPropagation();
      const rect = btn.getBoundingClientRect();
      const content = h('div', { style: 'max-width:260px;' }, text);
      openPopover(rect.left, rect.bottom + 4, content);
    }
  }, icon('question'));
  return btn;
}
