import { generateNoticeText } from './notice-text.js';

function getStatusTemplateByCode(masters, code) {
  return (masters.statusTemplates || []).find(t => t.code === code) || null;
}

function invertTarget(target) {
  if (target === 'affected_to_through') return 'through_to_affected';
  if (target === 'through_to_affected') return 'affected_to_through';
  return target || 'mutual';
}

export function deriveThroughNotices(publishedNotices, network, masters) {
  const derived = [];
  (publishedNotices || []).forEach(notice => {
    if (!notice || notice.state !== 'published') return;
    const throughs = Array.isArray(notice.throughServices) ? notice.throughServices : [];
    throughs.forEach(ts => {
      if (!ts || !ts.showOnThroughLine || !ts.lineId) return;

      const tpl = getStatusTemplateByCode(masters, 'DSS_STOP')
        || { statusId: 'DSS', heading: '直通運転中止', body: '直通運転を中止しています' };

      const genNotice = {
        id: `${notice.id}__through__${ts.lineId}`,
        state: 'published',
        createdAt: notice.createdAt,
        updatedAt: notice.updatedAt,
        updatedBy: notice.updatedBy,
        occurrence: notice.occurrence,
        lineId: ts.lineId,
        range: null,
        directions: { forward: true, backward: true },
        categoryIds: null,
        status: { code: 'DSS_STOP', heading: tpl.heading, body: tpl.body },
        cause: {
          ...(notice.cause || {}),
          lineOption: 'line',
          lineId: notice.lineId,
        },
        turnback: { start: false, end: false },
        throughServices: [
          { lineId: notice.lineId, state: ts.state, target: invertTarget(ts.target), showOnThroughLine: false },
        ],
        text: { mode: 'auto', custom: null },
        derived: { sourceId: notice.id },
      };
      genNotice.rendered = generateNoticeText(genNotice, network, masters);
      derived.push(genNotice);
    });
  });
  return derived;
}
