// 駅グループの編集ロジック。DOM を使わない。02-editor-ui-spec.md 14章、17章。

import { newId } from '../../shared/ids.js';

function stationLabel(network, stationId) {
  const station = (network.stations || []).find((s) => s.id === stationId);
  return station ? `${station.name}（${stationId}）` : stationId;
}

export function createGroup(name, stationIds) {
  return { id: newId('grp'), name, stationIds: stationIds.slice() };
}

export function validateGroupDraft(network, group, { excludeId } = {}) {
  if (!group.name || !group.name.trim()) {
    return 'グループ名を入力してください。';
  }
  if ((group.stationIds || []).length < 2) {
    return '駅を2つ以上選んでください。';
  }
  for (const other of network.stationGroups || []) {
    if (excludeId && other.id === excludeId) continue;
    const hit = other.stationIds.find((id) => group.stationIds.includes(id));
    if (hit) {
      return `駅「${stationLabel(network, hit)}」は既に別のグループ「${other.name}」に入っています。`;
    }
  }
  return null;
}
