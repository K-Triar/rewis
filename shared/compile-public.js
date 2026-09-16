import { generateNoticeText } from './notice-text.js';

export function compilePublic(networkRecord, operationsRecord) {
  const network = networkRecord.doc;
  const operations = operationsRecord.doc;
  const masters = operations.masters;

  const notices = (operations.notices || [])
    .filter((n) => n.state === 'published')
    .map((n) => ({ ...n, rendered: generateNoticeText(n, network, masters) }));

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
