export const COL = 170;
export const ROW = 150;

function validStationIds(network) {
  return new Set((network.stations || []).map((s) => s.id));
}

export function visibleStationIds(network, savedPositions) {
  const valid = validStationIds(network);
  const visible = new Set();

  (network.lines || []).forEach((line) => {
    (line.stations || []).forEach((id) => { if (valid.has(id)) visible.add(id); });
  });
  (network.services || []).forEach((service) => {
    (service.stops || []).forEach((stop) => { if (valid.has(stop.stationId)) visible.add(stop.stationId); });
  });
  (network.transfers || []).forEach((transfer) => {
    if (transfer.from && valid.has(transfer.from.stationId)) visible.add(transfer.from.stationId);
    if (transfer.to && valid.has(transfer.to.stationId)) visible.add(transfer.to.stationId);
  });
  Object.keys(savedPositions || {}).forEach((id) => { if (valid.has(id)) visible.add(id); });

  return visible;
}

export function resolvePositions(network, savedPositions) {
  const visible = visibleStationIds(network, savedPositions);
  const saved = savedPositions || {};
  const positions = new Map();

  visible.forEach((id) => {
    const pos = saved[id];
    if (pos) positions.set(id, { x: pos.x, y: pos.y });
  });

  let nextRowY = 0;
  if (positions.size > 0) {
    let maxY = -Infinity;
    positions.forEach((pos) => { if (pos.y > maxY) maxY = pos.y; });
    nextRowY = maxY + ROW;
  }

  (network.lines || []).forEach((line) => {
    const stations = line.stations || [];
    if (stations.length === 0) return;

    const unplacedIndexes = [];
    stations.forEach((id, i) => { if (visible.has(id) && !positions.has(id)) unplacedIndexes.push(i); });
    if (unplacedIndexes.length === 0) return;

    let anchor = null;
    stations.forEach((id, i) => {
      if (positions.has(id) && (anchor === null || i < anchor.index)) {
        anchor = { index: i, pos: positions.get(id) };
      }
    });
    const x0 = anchor ? anchor.pos.x - anchor.index * COL : 0;

    unplacedIndexes.forEach((i) => {
      positions.set(stations[i], { x: x0 + i * COL, y: nextRowY });
    });
    nextRowY += ROW;
  });

  const remaining = [...visible].filter((id) => !positions.has(id)).sort();
  remaining.forEach((id, k) => {
    positions.set(id, { x: k * COL, y: nextRowY });
  });
  if (remaining.length > 0) nextRowY += ROW;

  return positions;
}
