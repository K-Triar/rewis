// 駅間の路線・種別の判定と、区間配列の修復。DOM を使わない。02-editor-ui-spec.md 9.2、9.3。

function categoryNameFor(network, lineId, categoryId) {
  const line = (network.lines || []).find((l) => l.id === lineId);
  const category = line && (line.categories || []).find((c) => c.id === categoryId);
  return category ? category.name : null;
}

export function inferSegment(network, fromStationId, toStationId, prevSegment) {
  const candidates = (network.lines || []).filter((l) =>
    (l.stations || []).includes(fromStationId) && (l.stations || []).includes(toStationId));

  if (prevSegment && prevSegment.lineId && candidates.some((l) => l.id === prevSegment.lineId)) {
    return { lineId: prevSegment.lineId, categoryId: prevSegment.categoryId };
  }

  if (candidates.length === 1) {
    const line = candidates[0];
    const categories = line.categories || [];
    const prevName = prevSegment ? categoryNameFor(network, prevSegment.lineId, prevSegment.categoryId) : null;
    const sameName = prevName ? categories.find((c) => c.name === prevName) : null;
    const category = sameName || categories[0];
    return { lineId: line.id, categoryId: category ? category.id : null };
  }

  return { lineId: null, categoryId: null };
}

function segmentIsValid(network, seg, fromStationId, toStationId) {
  if (!seg || seg.lineId == null) return false;
  const line = (network.lines || []).find((l) => l.id === seg.lineId);
  if (!line) return false;
  const stations = line.stations || [];
  return stations.includes(fromStationId) && stations.includes(toStationId);
}

export function repairSegments(network, stops, segments) {
  const result = segments.slice();
  for (let i = 0; i < result.length; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (!from || !to) continue;
    if (!segmentIsValid(network, result[i], from.stationId, to.stationId)) {
      result[i] = inferSegment(network, from.stationId, to.stationId, result[i - 1]);
    }
  }
  return result;
}
