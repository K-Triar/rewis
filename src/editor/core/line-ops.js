// 路線タブの編集ロジック。DOM を使わない。02-editor-ui-spec.md 13章、17章。

import { isValidId } from '../../shared/ids.js';

export function createLine(id, name, { companyId = '', vehicleTypeId = '' } = {}) {
  return {
    id,
    name,
    companyId,
    color: '#3498db',
    vehicleTypeId,
    stations: [],
    loop: null,
    directions: { forward: '下り線', backward: '上り線' },
    categories: []
  };
}

export function updateLineFields(line, patch) {
  const draft = structuredClone(line);
  Object.keys(patch).forEach((key) => {
    if (key === 'directions') {
      draft.directions = { ...draft.directions, ...patch.directions };
    } else {
      draft[key] = patch[key];
    }
  });
  return draft;
}

function clampLoop(draft) {
  if (!draft.loop) return;
  if (draft.stations.length === 0) {
    draft.loop = null;
    return;
  }
  draft.loop = { startIndex: Math.min(draft.loop.startIndex, draft.stations.length - 1) };
}

export function addStationToLine(line, stationId) {
  const draft = structuredClone(line);
  if (draft.stations.includes(stationId)) return draft;
  draft.stations.push(stationId);
  return draft;
}

export function insertStationToLine(line, index, stationId) {
  const draft = structuredClone(line);
  draft.stations.splice(index, 0, stationId);
  return draft;
}

export function removeStationFromLine(line, index) {
  const draft = structuredClone(line);
  draft.stations.splice(index, 1);
  clampLoop(draft);
  return draft;
}

export function moveStationInLine(line, from, to) {
  const draft = structuredClone(line);
  const [moved] = draft.stations.splice(from, 1);
  draft.stations.splice(to, 0, moved);
  clampLoop(draft);
  return draft;
}

export function setLineShape(line, shape, startIndex) {
  const draft = structuredClone(line);
  const stationCount = draft.stations.length;
  if (shape === 'normal') {
    draft.loop = null;
  } else if (shape === 'circular') {
    draft.loop = { startIndex: 0 };
  } else if (shape === 'racket') {
    const fallback = stationCount > 1 ? 1 : 0;
    const index = startIndex === undefined ? fallback : startIndex;
    draft.loop = { startIndex: stationCount > 0 ? Math.min(index, stationCount - 1) : 0 };
  }
  return draft;
}

export function addCategory(line, category) {
  const draft = structuredClone(line);
  draft.categories.push({ id: category.id, name: category.name });
  return draft;
}

export function renameCategory(line, categoryId, name) {
  const draft = structuredClone(line);
  const category = draft.categories.find((c) => c.id === categoryId);
  if (category) category.name = name;
  return draft;
}

export function moveCategory(line, from, to) {
  const draft = structuredClone(line);
  const [moved] = draft.categories.splice(from, 1);
  draft.categories.splice(to, 0, moved);
  return draft;
}

export function removeCategory(line, categoryId) {
  const draft = structuredClone(line);
  draft.categories = draft.categories.filter((c) => c.id !== categoryId);
  return draft;
}

export function validateLineDraft(network, line, isNew) {
  if (isNew) {
    if (!isValidId(line.id)) return '路線IDの書式が不正です。';
    if ((network.lines || []).some((l) => l.id === line.id)) return '同じIDの路線が既にあります。';
  }
  if (!line.name || !line.name.trim()) return '路線名を入力してください。';
  const categories = line.categories || [];
  if (categories.length === 0) return '種別を1つ以上追加してください。';

  const seen = new Set();
  for (const category of categories) {
    if (!isValidId(category.id)) return `種別ID「${category.id}」の書式が不正です。`;
    if (seen.has(category.id)) return `種別ID「${category.id}」が重複しています。`;
    seen.add(category.id);
  }
  return null;
}

export function servicesAffectedByLineStationRemoval(network, lineId, stationId) {
  return (network.services || []).filter((service) => {
    const stops = service.stops || [];
    return (service.sections || []).some((section) => {
      if (section.lineId !== lineId) return false;
      for (let i = section.from; i <= section.to; i++) {
        if (stops[i] && stops[i].stationId === stationId) return true;
      }
      return false;
    });
  });
}
