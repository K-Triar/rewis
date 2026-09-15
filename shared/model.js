function buildStationById(network) {
  return new Map((network.stations || []).map(s => [s.id, s]));
}

function buildLineById(network) {
  return new Map((network.lines || []).map(l => [l.id, l]));
}

function buildCompanyById(network) {
  return new Map((network.companies || []).map(c => [c.id, c]));
}

function buildServiceById(network) {
  return new Map((network.services || []).map(s => [s.id, s]));
}

function buildLinesByStation(network) {
  const map = new Map();
  (network.lines || []).forEach(line => {
    (line.stations || []).forEach(stationId => {
      if (!map.has(stationId)) map.set(stationId, []);
      map.get(stationId).push(line.id);
    });
  });
  return map;
}

function buildActiveServices(network) {
  return (network.services || []).filter(s => s.active !== false);
}

function buildStopsByLineCategory(activeServices) {
  const map = new Map();
  activeServices.forEach(service => {
    (service.sections || []).forEach(section => {
      if (!map.has(section.lineId)) map.set(section.lineId, new Map());
      const byCategory = map.get(section.lineId);
      if (!byCategory.has(section.categoryId)) byCategory.set(section.categoryId, new Set());
      const stations = byCategory.get(section.categoryId);
      for (let i = section.from; i <= section.to; i++) {
        const stop = service.stops[i];
        if (stop) stations.add(stop.stationId);
      }
    });
  });
  return map;
}

function throughEntry(map, lineId, categoryId) {
  if (!map.has(lineId)) map.set(lineId, new Map());
  const byCategory = map.get(lineId);
  if (!byCategory.has(categoryId)) byCategory.set(categoryId, { to: [], from: [] });
  return byCategory.get(categoryId);
}

function buildThroughLinks(activeServices) {
  const map = new Map();
  activeServices.forEach(service => {
    const sections = service.sections || [];
    for (let i = 0; i < sections.length - 1; i++) {
      const cur = sections[i];
      const next = sections[i + 1];
      const curEntry = throughEntry(map, cur.lineId, cur.categoryId);
      if (!curEntry.to.includes(next.lineId)) curEntry.to.push(next.lineId);
      const nextEntry = throughEntry(map, next.lineId, next.categoryId);
      if (!nextEntry.from.includes(cur.lineId)) nextEntry.from.push(cur.lineId);
    }
  });
  return map;
}

function buildWalkTransfersByStation(network) {
  const map = new Map();
  function add(fromStationId, toStationId, seconds) {
    if (!map.has(fromStationId)) map.set(fromStationId, []);
    map.get(fromStationId).push({ toStationId, seconds });
  }
  (network.transfers || []).forEach(tr => {
    const fromStationId = tr.from && tr.from.stationId;
    const toStationId = tr.to && tr.to.stationId;
    if (!fromStationId || !toStationId || fromStationId === toStationId) return;
    add(fromStationId, toStationId, tr.seconds);
    if (tr.bidirectional) add(toStationId, fromStationId, tr.seconds);
  });
  return map;
}

function buildNoticesByLine(publicNotices) {
  const map = new Map();
  (publicNotices || []).forEach(notice => {
    if (!map.has(notice.lineId)) map.set(notice.lineId, []);
    map.get(notice.lineId).push(notice);
  });
  map.forEach(list => list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)));
  return map;
}

export function computeAffectedIndices(line, range) {
  const stations = (line && line.stations) || [];
  if (range == null) {
    return stations.map((_, i) => i);
  }

  const fromIdx = stations.indexOf(range.fromStationId);
  const toIdx = stations.indexOf(range.toStationId);
  if (fromIdx === -1 || toIdx === -1) return [];

  if (line && line.loop && range.direction) {
    const indices = [];
    let i = fromIdx;
    for (let guard = 0; guard <= stations.length; guard++) {
      indices.push(i);
      if (i === toIdx) break;
      i = range.direction === 'forward'
        ? (i + 1) % stations.length
        : (i - 1 + stations.length) % stations.length;
    }
    return indices;
  }

  const from = Math.min(fromIdx, toIdx);
  const to = Math.max(fromIdx, toIdx);
  const indices = [];
  for (let i = from; i <= to; i++) indices.push(i);
  return indices;
}

export function buildModel(network, publicNotices = [], masters) {
  const stationById = buildStationById(network);
  const lineById = buildLineById(network);
  const companyById = buildCompanyById(network);
  const serviceById = buildServiceById(network);
  const activeServices = buildActiveServices(network);

  const model = {
    network,
    masters,
    stationById,
    lineById,
    companyById,
    serviceById,
    linesByStation: buildLinesByStation(network),
    activeServices,
    stopsByLineCategory: buildStopsByLineCategory(activeServices),
    throughLinks: buildThroughLinks(activeServices),
    walkTransfersByStation: buildWalkTransfersByStation(network),
    noticesByLine: buildNoticesByLine(publicNotices),
  };

  model.stationName = id => {
    const s = stationById.get(id);
    return s ? (s.name || '') : '';
  };
  model.lineName = id => {
    const l = lineById.get(id);
    return l ? (l.name || '') : '';
  };
  model.categoryName = (lineId, categoryId) => {
    const l = lineById.get(lineId);
    const cat = l && Array.isArray(l.categories) ? l.categories.find(c => c.id === categoryId) : null;
    return cat ? (cat.name || cat.id) : categoryId;
  };

  return model;
}
