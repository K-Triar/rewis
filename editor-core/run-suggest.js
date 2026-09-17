// 駅間の秒数の候補。DOM を使わない。02-editor-ui-spec.md 9.1。

function sameId(a, b) {
  return (a ?? null) === (b ?? null);
}

function serviceEdges(service) {
  const stops = service.stops || [];
  const n = stops.length;
  const edges = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  if (service.circular && n > 1) edges.push([n - 1, 0]);
  return edges;
}

export function suggestRun(network, fromStop, toStop, { excludeServiceId, extraServices } = {}) {
  const candidates = [...(extraServices || []), ...((network && network.services) || [])]
    .filter((sv) => sv && sv.id !== excludeServiceId);

  let stationOnlyMatch = null;
  let reversedMatch = null;

  for (const service of candidates) {
    const stops = service.stops || [];
    for (const [i, j] of serviceEdges(service)) {
      const a = stops[i];
      const b = stops[j];
      if (!a || !b || !Number.isFinite(a.run)) continue;
      if (a.stationId === fromStop.stationId && b.stationId === toStop.stationId) {
        if (sameId(a.platformId, fromStop.platformId) && sameId(b.platformId, toStop.platformId)) {
          return a.run;
        }
        if (stationOnlyMatch === null) stationOnlyMatch = a.run;
      } else if (a.stationId === toStop.stationId && b.stationId === fromStop.stationId) {
        if (reversedMatch === null) reversedMatch = a.run;
      }
    }
  }

  if (stationOnlyMatch !== null) return stationOnlyMatch;
  if (reversedMatch !== null) return reversedMatch;
  return null;
}
