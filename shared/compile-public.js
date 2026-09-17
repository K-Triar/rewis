import { generateNoticeText } from './notice-text.js';
import { deriveThroughNotices } from './derive-through-notices.js';

export function compilePublic(networkRecord, operationsRecord) {
  const network = networkRecord.doc;
  const operations = operationsRecord.doc;
  const masters = operations.masters;

  const publishedNotices = (operations.notices || [])
    .filter((n) => n.state === 'published')
    .map((n) => ({ ...n, rendered: generateNoticeText(n, network, masters) }));

  const derivedNotices = deriveThroughNotices(publishedNotices, network, masters);
  const notices = [...publishedNotices, ...derivedNotices];

  return {
    schemaVersion: '2.0.0',
    kind: 'public',
    generatedAt: new Date().toISOString(),
    networkRevision: networkRecord.meta?.revision ?? 0,
    operationsRevision: operationsRecord.meta?.revision ?? 0,
    network,
    masters,
    notices,
  };
}
