import { h } from '../dom.js';
import { refToFocus } from '../navigate.js';

// findReferences() の結果 [{ kind, id, label }] を、クリックで該当箇所へ移動できる一覧にする。
// requestNavigate が無い、または飛び先がない参照（notice など）は文字列のまま表示する。
export function renderRefList(refs, requestNavigate) {
  const span = h('span', { class: 'ed2-ref-list' });
  refs.forEach((ref, index) => {
    if (index > 0) span.appendChild(document.createTextNode(' / '));
    const focus = requestNavigate ? refToFocus(ref) : null;
    if (focus) {
      span.appendChild(h('button', {
        class: 'ed2-ref-link',
        type: 'button',
        onClick: () => requestNavigate(focus)
      }, ref.label));
    } else {
      span.appendChild(document.createTextNode(ref.label));
    }
  });
  return span;
}
