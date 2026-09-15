import { h, clear } from '../dom.js';

const KIND_LABEL = { network: '路線網 (network)', operations: '運行情報 (operations)' };

export function hasErrors(validation) {
  return Object.values(validation || {}).some((v) => v && v.errors && v.errors.length > 0);
}

export function renderIssuesPanel(container, validation, { onNavigate } = {}) {
  clear(container);
  if (!container) return;

  const kinds = ['network', 'operations'];
  let totalErrors = 0;
  let totalWarnings = 0;
  kinds.forEach((kind) => {
    const v = validation[kind];
    if (!v) return;
    totalErrors += v.errors.length;
    totalWarnings += v.warnings.length;
  });

  container.appendChild(h('div', { class: 'ed2-issues-summary' },
    h('span', { class: totalErrors > 0 ? 'ed2-issues-error-count' : 'ed2-issues-ok' }, `errors ${totalErrors}件`),
    h('span', { class: 'ed2-issues-warning-count' }, `warnings ${totalWarnings}件`)
  ));

  kinds.forEach((kind) => {
    const v = validation[kind];
    if (!v || (v.errors.length === 0 && v.warnings.length === 0)) return;

    const list = h('ul', { class: 'ed2-issues-list' });
    v.errors.forEach((issue) => list.appendChild(renderIssueRow(issue, 'error', kind, onNavigate)));
    v.warnings.forEach((issue) => list.appendChild(renderIssueRow(issue, 'warning', kind, onNavigate)));

    container.appendChild(h('div', { class: 'ed2-issues-group' },
      h('h4', {}, KIND_LABEL[kind] || kind),
      list
    ));
  });
}

function renderIssueRow(issue, level, kind, onNavigate) {
  const label = `[${issue.code}] ${issue.path ? issue.path + '：' : ''}${issue.message}`;
  const btn = h('button', {
    class: `ed2-issue-row ed2-issue-${level}`,
    type: 'button',
    onClick: () => {
      if (onNavigate) onNavigate(kind, issue);
    }
  }, label);
  return h('li', {}, btn);
}
