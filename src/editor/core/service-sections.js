// 運行系統の停車駅・区間（sections）まわりの補助関数。DOM を使わない。
// 表形式・図形式の両エディタと service-ops.js から使う。

import { newId } from '../../shared/ids.js';
import { lineOf, stationName, lineName } from './lookup.js';

export { stationName };

export function categoryName(network, lineId, categoryId) {
  const line = lineOf(network, lineId);
  const category = line && (line.categories || []).find((c) => c.id === categoryId);
  return category ? category.name : categoryId;
}

// sections（保存済みの形）を、停車駅の間ごとの「路線・種別」の配列に展開する
export function expandSectionsToSegments(sections, stopsLength) {
  const segments = new Array(Math.max(stopsLength - 1, 0));
  (sections || []).forEach((sec) => {
    for (let i = sec.from; i < sec.to; i++) {
      segments[i] = { lineId: sec.lineId, categoryId: sec.categoryId };
    }
  });
  return segments;
}

// 停車駅の間ごとの「路線・種別」の配列から、連続する組み合わせをまとめてsectionsを作る
export function buildSectionsFromSegments(segments) {
  if (segments.length === 0) return [];
  const sections = [];
  let start = 0;
  for (let i = 1; i <= segments.length; i++) {
    const cur = segments[start];
    const next = i < segments.length ? segments[i] : null;
    if (!next || !cur || next.lineId !== cur.lineId || next.categoryId !== cur.categoryId) {
      sections.push({ lineId: cur.lineId, categoryId: cur.categoryId, from: start, to: i });
      start = i;
    }
  }
  return sections;
}

export function summarizeSections(network, sections) {
  return sections.map((s) => `${lineName(network, s.lineId)} ${categoryName(network, s.lineId, s.categoryId)}`).join(' → ');
}

export function totalRun(service) {
  return (service.stops || []).reduce((sum, stop) => sum + (Number.isFinite(stop.run) ? stop.run : 0), 0);
}

export function reverseService(network, service) {
  const stops = service.stops;
  const n = stops.length;
  const newStops = stops.slice().reverse().map((s) => ({ ...s }));

  if (service.circular) {
    // runは折り返しを含めた全区間（stops[i]→stops[(i+1)%n]）で、wrap分（最後→最初）は向きを変えても同じ
    const runs = stops.map((s) => s.run);
    const newRuns = new Array(n);
    for (let j = 0; j <= n - 2; j++) newRuns[j] = runs[n - 2 - j];
    newRuns[n - 1] = runs[n - 1];
    newStops.forEach((s, j) => { s.run = newRuns[j]; });
  } else {
    const runs = stops.slice(0, n - 1).map((s) => s.run);
    const newRuns = runs.slice().reverse();
    newStops.forEach((s, j) => {
      if (j < n - 1) s.run = newRuns[j];
      else delete s.run;
    });
  }

  let sections;
  if (service.circular) {
    // circularはsectionが1つだけなので、路線・種別はそのまま
    sections = [{ ...service.sections[0], from: 0, to: n - 1 }];
  } else {
    const segments = expandSectionsToSegments(service.sections, n);
    const newSegments = segments.slice().reverse();
    sections = buildSectionsFromSegments(newSegments);
  }

  return {
    id: newId('sv'),
    name: service.name || '',
    headsign: service.circular ? null : stationName(network, stops[0].stationId),
    active: service.active,
    circular: service.circular,
    stops: newStops,
    sections
  };
}
