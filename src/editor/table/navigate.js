// issues-panel のクリックや findReferences の結果から、エディタ内のどのタブ・どの行へ
// 飛べばよいかを求める。DOM に依存しないため node --test でも読み込める。

import { resolveIssueTarget } from '../core/issue-location.js';

const TAB_BY_REF_KIND = {
  line: 'lines',
  service: 'services',
  transfer: 'transfers',
  stationGroup: 'transfers',
  notice: 'operations'
};

// findReferences() が返す { kind, id, label } から、飛び先を求める。
// 飛び先がない（notice など）場合は null を返す。
export function refToFocus(ref) {
  if (!ref) return null;
  const tab = TAB_BY_REF_KIND[ref.kind];
  if (!tab) return null;
  return { tab, type: ref.kind, id: ref.id };
}

const TYPE_BY_TAB = {
  companies: 'company',
  stations: 'station',
  lines: 'line',
  services: 'service',
  transfers: 'transfer',
  operations: 'notice'
};

// issues-panel の issue（{ code, path, message }）から、飛び先を求める。
// 飛び先の判定は図形式と共通の resolveIssueTarget（{ tab, id, sub }）に任せ、
// 表形式のビューが使う { tab, type, id } の形に直す。
// docs は { network, operations }。kind は issue が network / operations のどちらのものか。
export function resolveIssueFocus(kind, issue, docs) {
  const target = resolveIssueTarget(kind, issue, docs);
  if (!target) return null;
  const type = target.sub && target.sub.type === 'group' ? 'stationGroup' : TYPE_BY_TAB[target.tab];
  if (!type) return null;
  return { tab: target.tab, type, id: target.id };
}
