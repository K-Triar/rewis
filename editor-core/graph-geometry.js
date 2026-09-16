export const NODE = { minWidth: 120, portGap: 36, padX: 24, height: 60, nameY: 20, portY: 42, portR: 9, hitR: 13 };

export function nodeSize(station) {
  const count = Math.max((station.platforms || []).length, 1);
  const w = Math.max(NODE.minWidth, NODE.padX * 2 + NODE.portGap * (count - 1));
  return { w, h: NODE.height };
}

export function nodeRect(station, pos) {
  const { w, h } = nodeSize(station);
  return { x: pos.x - w / 2, y: pos.y - h / 2, w, h };
}

export function portPoint(station, pos, platformId) {
  const platforms = station.platforms || [];
  const index = platformId == null ? -1 : platforms.findIndex((p) => p.id === platformId);
  if (index === -1) return { x: pos.x, y: pos.y };

  const rect = nodeRect(station, pos);
  const x = platforms.length === 1 ? pos.x : rect.x + NODE.padX + NODE.portGap * index;
  return { x, y: rect.y + NODE.portY };
}

export function edgeMidpoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

export function boundsOf(points) {
  if (!points || points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  return { minX, minY, maxX, maxY };
}
