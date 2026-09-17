// issues-panel のクリックや findReferences の結果から、エディタ内のどのタブ・どの行へ
// 飛べばよいかを求める。DOM に依存しないため node --test でも読み込める。

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

const TAB_BY_ARRAY_NAME = {
  companies: 'companies',
  stations: 'stations',
  lines: 'lines',
  services: 'services',
  transfers: 'transfers',
  stationGroups: 'transfers',
  notices: 'operations'
};

const TYPE_BY_ARRAY_NAME = {
  companies: 'company',
  stations: 'station',
  lines: 'line',
  services: 'service',
  transfers: 'transfer',
  stationGroups: 'stationGroup',
  notices: 'notice'
};

// issues-panel の issue（{ code, path, message }）から、飛び先を求める。
// path の先頭が「配列名[番号]」の形（例: "stations[3].platforms"）のときだけ求められる。
// docs は { network, operations }。kind は issue が network / operations のどちらのものか。
export function resolveIssueFocus(kind, issue, docs) {
  if (!issue || !issue.path) return null;
  const match = issue.path.match(/^(\w+)\[(\d+)\]/);
  if (!match) return null;
  const [, arrayName, idxText] = match;
  const tab = TAB_BY_ARRAY_NAME[arrayName];
  const type = TYPE_BY_ARRAY_NAME[arrayName];
  if (!tab || !type) return null;

  const doc = kind === 'operations' ? docs && docs.operations : docs && docs.network;
  if (!doc) return null;
  const list = doc[arrayName];
  if (!Array.isArray(list)) return null;
  const item = list[Number(idxText)];
  if (!item || !item.id) return null;

  return { tab, type, id: item.id };
}
