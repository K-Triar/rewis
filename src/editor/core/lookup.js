// network から ID で駅・路線を引く小さな補助関数。DOM を使わない。

export function stationOf(network, stationId) {
  return (network.stations || []).find((st) => st.id === stationId) || null;
}

export function lineOf(network, lineId) {
  return (network.lines || []).find((l) => l.id === lineId) || null;
}

// 駅名。見つからないときは ID をそのまま返す
export function stationName(network, stationId) {
  const station = stationOf(network, stationId);
  return station ? station.name : stationId;
}

// 路線名。見つからないときは ID をそのまま返す
export function lineName(network, lineId) {
  const line = lineOf(network, lineId);
  return line ? line.name : lineId;
}
