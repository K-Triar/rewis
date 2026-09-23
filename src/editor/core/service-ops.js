// 運行系統タブの編集ロジック。DOM を使わない。02-editor-ui-spec.md 12章、17章。

import { newId } from '../../shared/ids.js';
import { expandSectionsToSegments, buildSectionsFromSegments, stationName } from './service-sections.js';
import { suggestRun } from './run-suggest.js';
import { repairSegments } from './segment-infer.js';

function denseSegments(sections, stopsLength) {
  const raw = expandSectionsToSegments(sections || [], stopsLength);
  const result = new Array(Math.max(stopsLength - 1, 0));
  for (let i = 0; i < result.length; i++) result[i] = raw[i] || null;
  return result;
}

function defaultLineCategory(network) {
  const line = (network.lines || [])[0];
  const category = line && line.categories[0];
  return { lineId: line ? line.id : null, categoryId: category ? category.id : null };
}

// src/editor/table/views/services.js の非公開関数 rebuildSegmentsAfterRemoval を書き写したもの。
function rebuildSegmentsAfterRemoval(network, oldSegments, removedIndex) {
  const newLength = Math.max(oldSegments.length - 1, 0);
  const rebuilt = [];
  for (let j = 0; j < newLength; j++) {
    if (j < removedIndex - 1) {
      rebuilt.push(oldSegments[j]);
    } else if (j === removedIndex - 1) {
      rebuilt.push(oldSegments[removedIndex - 1] || oldSegments[removedIndex] || defaultLineCategory(network));
    } else {
      rebuilt.push(oldSegments[j + 1]);
    }
  }
  return rebuilt;
}

function terminusStationName(network, stops) {
  if (!stops.length) return null;
  return stationName(network, stops[stops.length - 1].stationId);
}

// 9.4 行先の自動更新
function applyHeadsignAutoUpdate(network, draft, beforeStops) {
  if (draft.circular) return;
  const before = terminusStationName(network, beforeStops);
  const after = terminusStationName(network, draft.stops);
  if (before === null || after === null || before === after) return;
  if (draft.headsign === '' || draft.headsign === before) {
    draft.headsign = after;
  }
}

function uniformIfCircular(draft, segments) {
  if (!draft.circular || segments.length === 0) return segments;
  const uniform = segments[0];
  return segments.map(() => uniform);
}

function finishSections(draft, segments) {
  draft.sections = draft.stops.length < 2 ? [] : buildSectionsFromSegments(uniformIfCircular(draft, segments));
}

export function createEmptyService() {
  return { id: newId('sv'), name: '', headsign: '', active: true, circular: false, stops: [], sections: [] };
}

export function segmentsOf(service) {
  const stops = service.stops || [];
  const raw = expandSectionsToSegments(service.sections || [], stops.length);
  const result = new Array(Math.max(stops.length - 1, 0));
  for (let i = 0; i < result.length; i++) result[i] = raw[i] || { lineId: null, categoryId: null };
  return result;
}

export function withSegments(service, segments) {
  const draft = structuredClone(service);
  draft.sections = draft.stops.length < 2 ? [] : buildSectionsFromSegments(segments);
  return draft;
}

export function appendStop(network, service, { stationId, platformId }) {
  const draft = structuredClone(service);
  const beforeStops = structuredClone(draft.stops);
  const stops = draft.stops;
  const segments = denseSegments(draft.sections, stops.length);

  const newStop = { stationId, platformId: platformId ?? null, board: true, alight: true };

  if (stops.length > 0) {
    const prevLast = stops[stops.length - 1];
    prevLast.run = suggestRun(network, prevLast, newStop) ?? 60;
    segments.push(null);
  }

  stops.push(newStop);

  if (draft.circular && stops.length > 1) {
    const firstStop = stops[0];
    newStop.run = suggestRun(network, newStop, firstStop) ?? 60;
  }

  const repaired = repairSegments(network, stops, segments);
  finishSections(draft, repaired);
  applyHeadsignAutoUpdate(network, draft, beforeStops);
  return draft;
}

export function insertStop(network, service, index, stop) {
  const draft = structuredClone(service);
  const beforeStops = structuredClone(draft.stops);
  const stops = draft.stops;
  const segments = denseSegments(draft.sections, stops.length);

  const newStop = {
    stationId: stop.stationId,
    platformId: stop.platformId ?? null,
    board: stop.board !== false,
    alight: stop.alight !== false
  };

  const prevStop = stops[index - 1];
  const nextStop = stops[index];
  prevStop.run = suggestRun(network, prevStop, newStop) ?? 60;
  newStop.run = suggestRun(network, newStop, nextStop) ?? 60;

  stops.splice(index, 0, newStop);

  const dup = segments[index - 1] || null;
  segments.splice(index - 1, 1, dup, dup ? { ...dup } : null);

  const repaired = repairSegments(network, stops, segments);
  finishSections(draft, repaired);
  applyHeadsignAutoUpdate(network, draft, beforeStops);
  return draft;
}

export function removeStop(network, service, index) {
  const draft = structuredClone(service);
  const beforeStops = structuredClone(draft.stops);
  const stops = draft.stops;
  const segments = denseSegments(draft.sections, stops.length);

  const isTerminus = index === stops.length - 1;
  const removedStop = stops[index];
  const prevStop = index > 0 ? stops[index - 1] : null;

  const rebuiltSegments = rebuildSegmentsAfterRemoval(network, segments, index);
  stops.splice(index, 1);

  if (prevStop) {
    if (isTerminus) {
      if (!draft.circular) delete prevStop.run;
    } else {
      const nextStop = stops[index];
      const removedRun = Number.isFinite(removedStop.run) ? removedStop.run : 0;
      const prevRun = Number.isFinite(prevStop.run) ? prevStop.run : 0;
      prevStop.run = suggestRun(network, prevStop, nextStop) ?? (removedRun + prevRun);
    }
  }

  const repaired = repairSegments(network, stops, rebuiltSegments);
  finishSections(draft, repaired);
  applyHeadsignAutoUpdate(network, draft, beforeStops);
  return draft;
}

export function moveStop(network, service, from, to) {
  const draft = structuredClone(service);
  const original = service;
  const beforeStops = structuredClone(draft.stops);
  const stops = draft.stops;
  const segments = denseSegments(draft.sections, stops.length);

  const [movedStop] = stops.splice(from, 1);
  stops.splice(to, 0, movedStop);

  if (segments.length > 0) {
    const [movedSeg] = segments.splice(from, 1);
    segments.splice(to, 0, movedSeg);
  }

  function pairChanged(i, j) {
    const a = stops[i];
    const b = stops[j];
    const beforeA = beforeStops[i];
    const beforeB = beforeStops[j];
    return !beforeA || !beforeB || beforeA.stationId !== a.stationId || beforeB.stationId !== b.stationId;
  }

  for (let i = 0; i < stops.length - 1; i++) {
    if (pairChanged(i, i + 1)) {
      stops[i].run = suggestRun(network, stops[i], stops[i + 1], { extraServices: [original] }) ?? 60;
    }
  }
  if (draft.circular && stops.length > 1 && pairChanged(stops.length - 1, 0)) {
    stops[stops.length - 1].run = suggestRun(network, stops[stops.length - 1], stops[0], { extraServices: [original] }) ?? 60;
  }

  const repaired = repairSegments(network, stops, segments);
  finishSections(draft, repaired);
  applyHeadsignAutoUpdate(network, draft, beforeStops);
  return draft;
}

export function setStopPlatform(service, index, platformId) {
  const draft = structuredClone(service);
  if (draft.stops[index]) draft.stops[index].platformId = platformId ?? null;
  return draft;
}

export function setStopFlags(service, index, { board, alight } = {}) {
  const draft = structuredClone(service);
  const stop = draft.stops[index];
  if (stop) {
    if (board !== undefined) stop.board = board;
    if (alight !== undefined) stop.alight = alight;
  }
  return draft;
}

export function setRun(service, index, run) {
  const draft = structuredClone(service);
  if (draft.stops[index]) draft.stops[index].run = run;
  return draft;
}

export function setSegmentRange(network, service, fromEdge, toEdge, { lineId, categoryId }) {
  const draft = structuredClone(service);
  const stops = draft.stops;
  let segments = denseSegments(draft.sections, stops.length);

  if (draft.circular) {
    segments = segments.map(() => ({ lineId, categoryId }));
  } else {
    for (let i = fromEdge; i <= toEdge; i++) {
      if (i >= 0 && i < segments.length) segments[i] = { lineId, categoryId };
    }
  }

  finishSections(draft, segments);
  return draft;
}

export function setCircular(network, service, value) {
  const draft = structuredClone(service);
  draft.circular = value;
  const stops = draft.stops;
  let segments = denseSegments(service.sections, stops.length);

  if (value) {
    draft.headsign = null;
    if (stops.length > 1) {
      const last = stops[stops.length - 1];
      const first = stops[0];
      last.run = suggestRun(network, last, first) ?? 60;
    }
    if (segments.length > 0) {
      const uniform = segments[0] || defaultLineCategory(network);
      segments = segments.map(() => uniform);
    }
  } else if (stops.length > 0) {
    draft.headsign = stationName(network, stops[stops.length - 1].stationId);
    delete stops[stops.length - 1].run;
  }

  draft.sections = stops.length < 2 ? [] : buildSectionsFromSegments(segments);
  return draft;
}

export function updateServiceFields(service, patch) {
  const draft = structuredClone(service);
  if ('name' in patch) draft.name = patch.name;
  if ('headsign' in patch) draft.headsign = patch.headsign;
  if ('active' in patch) draft.active = patch.active;
  return draft;
}

// 表形式の save() の finalStops と同じ規則で保存形にそろえる。
export function normalizeService(service) {
  const draft = structuredClone(service);
  const stops = draft.stops || [];
  draft.stops = stops.map((s, i) => {
    const clean = { stationId: s.stationId, platformId: s.platformId ?? null };
    const isLast = i === stops.length - 1;
    if (!isLast || draft.circular) clean.run = Number.isFinite(s.run) ? s.run : 0;
    clean.board = s.board !== false;
    clean.alight = s.alight !== false;
    return clean;
  });
  return draft;
}

export function duplicateService(service) {
  const clone = structuredClone(service);
  clone.id = newId('sv');
  clone.name = (clone.name || '') + '（複製）';
  return clone;
}

export function lineChoicesForEdges(network, service, fromEdge, toEdge) {
  const stops = service.stops || [];
  const lines = network.lines || [];

  const candidates = lines.filter((line) => {
    const stations = line.stations || [];
    for (let i = fromEdge; i <= toEdge; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (!a || !b || !stations.includes(a.stationId) || !stations.includes(b.stationId)) return false;
    }
    return true;
  });
  if (candidates.length > 0) return candidates;

  const firstStop = stops[fromEdge];
  const byFirstStation = firstStop ? lines.filter((line) => (line.stations || []).includes(firstStop.stationId)) : [];
  if (byFirstStation.length > 0) return byFirstStation;

  return lines;
}
