import { sanitizeIdPart } from './ids.js';
import { validateNetwork } from './schema-v2.js';

function normalizeOverrides(overrides) {
  return {
    lines: (overrides && overrides.lines) || {},
    categoryMerge: (overrides && overrides.categoryMerge) || {},
    joins: (overrides && overrides.joins) || [],
    forbidJoins: (overrides && overrides.forbidJoins) || [],
    directionMap: (overrides && overrides.directionMap) || {},
  };
}

function platformOrNull(v) {
  return (v === undefined || v === null || v === '') ? null : String(v);
}

function pairKey(a, b) {
  return `${a}||${b}`;
}

function convertMeta(v1data) {
  const meta = (v1data && v1data.meta) || {};
  return { ownCompanyId: meta.ownCompanyId, appName: meta.appName };
}

function convertCompanies(v1data) {
  return (v1data.companies || []).map(c => ({ id: c.companyId, name: c.companyName }));
}

function convertVehicleTypes(v1data) {
  return (v1data.trainTypes || []).map(t => ({
    id: t.trainTypeId,
    name: t.trainTypeName,
    shortName: t.trainTypeNameShort,
    color: t.color,
    order: t.priority,
  }));
}

function collectPlatformsByStation(v1data) {
  const platformsByStation = new Map();
  function add(stationId, platform) {
    const p = platformOrNull(platform);
    if (p === null) return;
    if (!platformsByStation.has(stationId)) platformsByStation.set(stationId, new Set());
    platformsByStation.get(stationId).add(p);
  }
  (v1data.segments || []).forEach(seg => {
    Object.entries(seg.platforms || {}).forEach(([stationId, platform]) => add(stationId, platform));
  });
  (v1data.platformTransfers || []).forEach(tr => {
    add(tr.stationId, tr.fromPlatform);
    add(tr.stationId, tr.toPlatform);
  });
  return platformsByStation;
}

function convertStations(v1data, platformsByStation) {
  return (v1data.stations || []).map(s => {
    const set = platformsByStation.get(s.stationId) || new Set();
    const platforms = Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))
      .map(p => ({ id: p, label: p }));
    return { id: s.stationId, name: s.stationName, kana: s.stationNameKana, platforms, location: null };
  });
}

function convertTransfers(v1data) {
  return (v1data.platformTransfers || []).map(tr => ({
    id: 'tr_' + sanitizeIdPart(`${tr.stationId}_${tr.fromPlatform}_${tr.toPlatform}`),
    from: { stationId: tr.stationId, platformId: platformOrNull(tr.fromPlatform) },
    to: { stationId: tr.stationId, platformId: platformOrNull(tr.toPlatform) },
    seconds: tr.transferTime,
    bidirectional: false,
    note: '',
  }));
}

function buildLineCategoryNameToId(v1data) {
  const map = new Map();
  (v1data.lines || []).forEach(line => {
    const nameToId = new Map();
    (line.serviceCategories || []).forEach(([id, name]) => nameToId.set(name, id));
    map.set(line.lineId, nameToId);
  });
  return map;
}

function convertLines(v1data, overrides) {
  return (v1data.lines || []).map(line => {
    const lineOv = overrides.lines[line.lineId] || {};
    const merge = overrides.categoryMerge[line.lineId] || {};
    const categories = (line.serviceCategories || [])
      .filter(([id]) => !(id in merge))
      .map(([id, name]) => ({ id, name }));
    return {
      id: line.lineId,
      name: line.lineName,
      companyId: line.companyId,
      color: line.lineColor,
      vehicleTypeId: line.trainType,
      stations: line.stationOrder ? [...line.stationOrder] : [],
      loop: lineOv.loop != null ? lineOv.loop : null,
      directions: lineOv.directions || { forward: '下り線', backward: '上り線' },
      categories,
    };
  });
}

function buildHops(v1data, lineCategoryNameToId) {
  const hops = [];
  (v1data.segments || []).forEach(seg => {
    const nameToId = lineCategoryNameToId.get(seg.lineId) || new Map();
    const categoryId = nameToId.has(seg.guidance) ? nameToId.get(seg.guidance) : seg.guidance;
    const fromPlatform = platformOrNull(seg.platforms && seg.platforms[seg.fromStationId]);
    const toPlatform = platformOrNull(seg.platforms && seg.platforms[seg.toStationId]);
    hops.push({
      idx: hops.length,
      lineId: seg.lineId,
      categoryId,
      from: seg.fromStationId,
      to: seg.toStationId,
      fromPlatform,
      toPlatform,
      run: seg.duration,
      board: !seg.isAlightOnly,
      segmentId: seg.segmentId,
    });
    if (seg.isBidirectional) {
      hops.push({
        idx: hops.length,
        lineId: seg.lineId,
        categoryId,
        from: seg.toStationId,
        to: seg.fromStationId,
        fromPlatform: toPlatform,
        toPlatform: fromPlatform,
        run: seg.duration,
        board: true,
        segmentId: seg.segmentId,
      });
    }
  });
  return hops;
}

function groupHops(hops) {
  const groups = new Map();
  hops.forEach(h => {
    const key = `${h.lineId}|${h.categoryId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  });
  return groups;
}

function canSucceed(h1, h2) {
  if (h1.idx === h2.idx) return false;
  if (h1.to !== h2.from) return false;
  if (h2.to === h1.from) return false;
  if (h1.toPlatform !== null && h2.fromPlatform !== null && h1.toPlatform !== h2.fromPlatform) return false;
  return true;
}

function buildChainsForGroup(groupHopsList, line, report) {
  const successors = new Map(); // idx -> [idx]
  const predecessors = new Map(); // idx -> [idx]
  groupHopsList.forEach(h1 => {
    groupHopsList.forEach(h2 => {
      if (canSucceed(h1, h2)) {
        if (!successors.has(h1.idx)) successors.set(h1.idx, []);
        successors.get(h1.idx).push(h2.idx);
        if (!predecessors.has(h2.idx)) predecessors.set(h2.idx, []);
        predecessors.get(h2.idx).push(h1.idx);
      }
    });
  });

  const hopByIdx = new Map(groupHopsList.map(h => [h.idx, h]));
  const nextOf = new Map();
  const prevOf = new Map();
  groupHopsList.forEach(h1 => {
    const succ = successors.get(h1.idx) || [];
    if (succ.length === 1) {
      const h2 = hopByIdx.get(succ[0]);
      const pred = predecessors.get(h2.idx) || [];
      if (pred.length === 1) {
        nextOf.set(h1.idx, h2.idx);
        prevOf.set(h2.idx, h1.idx);
      }
    }
  });

  groupHopsList.forEach(h1 => {
    const succ = successors.get(h1.idx) || [];
    if (succ.length > 1) {
      report.issues.push({
        level: 'warning',
        code: 'BRANCH_SPLIT',
        message: `路線 "${h1.lineId}" 種別 "${h1.categoryId}" の駅 "${h1.to}" で流れが分岐しています`,
        refs: [h1.lineId, h1.categoryId, h1.to],
      });
    }
  });

  const visited = new Set();
  const chains = [];

  groupHopsList.forEach(h => {
    if (prevOf.has(h.idx) || visited.has(h.idx)) return;
    const seq = [h];
    visited.add(h.idx);
    let cur = h;
    while (nextOf.has(cur.idx)) {
      const nxt = hopByIdx.get(nextOf.get(cur.idx));
      if (visited.has(nxt.idx)) break;
      seq.push(nxt);
      visited.add(nxt.idx);
      cur = nxt;
    }
    chains.push({ hops: seq, circular: false });
  });

  let remaining = groupHopsList.filter(h => !visited.has(h.idx));
  while (remaining.length > 0) {
    const preferredStart = line && Array.isArray(line.stationOrder)
      ? remaining.find(h => h.from === line.stationOrder[0])
      : undefined;
    const startHop = preferredStart || remaining[0];
    const seq = [startHop];
    visited.add(startHop.idx);
    let cur = startHop;
    while (nextOf.has(cur.idx) && nextOf.get(cur.idx) !== startHop.idx) {
      const nxt = hopByIdx.get(nextOf.get(cur.idx));
      seq.push(nxt);
      visited.add(nxt.idx);
      cur = nxt;
    }
    chains.push({ hops: seq, circular: true });
    report.issues.push({
      level: 'info',
      code: 'CIRCULAR_CHAIN',
      message: `路線 "${startHop.lineId}" 種別 "${startHop.categoryId}" は環状の流れです（起点: "${startHop.from}"）`,
      refs: [startHop.lineId, startHop.categoryId, startHop.from],
    });
    remaining = groupHopsList.filter(h => !visited.has(h.idx));
  }

  return chains;
}

function chainKeyOf(chain) {
  const first = chain.hops[0];
  const last = chain.hops[chain.hops.length - 1];
  return `${first.lineId}|${first.categoryId}|${first.from}|${last.to}`;
}

function buildAllChains(hops, lineById, report) {
  const groups = groupHops(hops);
  const chains = [];
  for (const [, groupHopsList] of groups) {
    const line = lineById.get(groupHopsList[0].lineId);
    const groupChains = buildChainsForGroup(groupHopsList, line, report);
    groupChains.forEach(c => chains.push(c));
  }
  return chains;
}

function buildThroughCandidates(v1data, lineCategoryNameToId) {
  const configs = [];
  (v1data.throughServiceConfigs || []).forEach(cfg => {
    const fromMap = lineCategoryNameToId.get(cfg.fromLineId) || new Map();
    const toMap = lineCategoryNameToId.get(cfg.toLineId) || new Map();
    const fromCategoryId = fromMap.has(cfg.fromGuidance) ? fromMap.get(cfg.fromGuidance) : cfg.fromGuidance;
    const toCategoryId = toMap.has(cfg.toGuidance) ? toMap.get(cfg.toGuidance) : cfg.toGuidance;
    configs.push({ fromLineId: cfg.fromLineId, fromCategoryId, toLineId: cfg.toLineId, toCategoryId, configId: cfg.configId });
    if (cfg.isBidirectional) {
      configs.push({ fromLineId: cfg.toLineId, fromCategoryId: toCategoryId, toLineId: cfg.fromLineId, toCategoryId: fromCategoryId, configId: cfg.configId });
    }
  });
  return configs;
}

function joinChains(chains, v1data, lineCategoryNameToId, overrides, report) {
  const chainByKey = new Map(chains.map(c => [chainKeyOf(c), c]));
  const chainNextOf = new Map(); // fromKey -> toKey（1つの流れは1方向にしか続かない）
  // toKey -> fromKey[]（複数の路線・種別が同じ続き駅に直通することがあるため、1対多を許す）
  const chainPrevOf = new Map();
  const usedAsFrom = new Set();

  function wouldCycle(fromKey, toKey) {
    let cur = toKey;
    const seen = new Set();
    while (chainNextOf.has(cur)) {
      cur = chainNextOf.get(cur);
      if (cur === fromKey) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
    }
    return false;
  }

  function tryLink(fromKey, toKey) {
    if (!chainByKey.has(fromKey) || !chainByKey.has(toKey)) return false;
    if (usedAsFrom.has(fromKey)) return false;
    if (fromKey === toKey) return false;
    if (wouldCycle(fromKey, toKey)) return false;
    chainNextOf.set(fromKey, toKey);
    if (!chainPrevOf.has(toKey)) chainPrevOf.set(toKey, []);
    chainPrevOf.get(toKey).push(fromKey);
    usedAsFrom.add(fromKey);
    return true;
  }

  const configs = buildThroughCandidates(v1data, lineCategoryNameToId);
  let throughJoined = 0;

  configs.forEach(cfg => {
    const candidatesA = chains.filter(c => {
      const last = c.hops[c.hops.length - 1];
      return last.lineId === cfg.fromLineId && last.categoryId === cfg.fromCategoryId;
    });
    const candidatesB = chains.filter(c => {
      const first = c.hops[0];
      return first.lineId === cfg.toLineId && first.categoryId === cfg.toCategoryId;
    });

    const validPairs = [];
    candidatesA.forEach(a => {
      const last = a.hops[a.hops.length - 1];
      candidatesB.forEach(b => {
        const first = b.hops[0];
        if (last.to === first.from && last.toPlatform !== null && first.fromPlatform !== null && last.toPlatform === first.fromPlatform) {
          validPairs.push({ a, b });
        } else if (last.to === first.from) {
          // 途中駅を含めて同じのりばを使っている可能性を調べる
        }
      });
      // THROUGH_MIDCHAIN: 最後尾以外の hop で B の始点駅・のりばに一致するもの
      candidatesB.forEach(b => {
        const first = b.hops[0];
        a.hops.slice(0, -1).forEach(h => {
          if (h.to === first.from && h.toPlatform !== null && first.fromPlatform !== null && h.toPlatform === first.fromPlatform) {
            report.issues.push({
              level: 'warning',
              code: 'THROUGH_MIDCHAIN',
              message: `直通設定 "${cfg.configId}" の候補で、流れ "${chainKeyOf(a)}" の途中駅 "${h.to}" が流れ "${chainKeyOf(b)}" の始点と同じのりばを使っています`,
              refs: [cfg.configId, chainKeyOf(a), chainKeyOf(b)],
            });
          }
        });
      });
    });

    if (validPairs.length === 1) {
      const { a, b } = validPairs[0];
      if (tryLink(chainKeyOf(a), chainKeyOf(b))) {
        throughJoined++;
      }
    } else if (validPairs.length === 0) {
      report.issues.push({
        level: 'warning',
        code: 'THROUGH_UNUSED',
        message: `直通設定 "${cfg.configId}"（${cfg.fromLineId}/${cfg.fromCategoryId} → ${cfg.toLineId}/${cfg.toCategoryId}）に一致する流れの組み合わせがありません`,
        refs: [cfg.configId],
      });
    } else {
      const keys = Array.from(new Set(validPairs.flatMap(p => [chainKeyOf(p.a), chainKeyOf(p.b)])));
      report.issues.push({
        level: 'warning',
        code: 'THROUGH_AMBIGUOUS',
        message: `直通設定 "${cfg.configId}" に一致する流れの組み合わせが複数あります`,
        refs: keys,
      });
    }
  });

  (overrides.forbidJoins || []).forEach(pair => {
    const [a, b] = pair;
    if (chainNextOf.get(a) === b) {
      chainNextOf.delete(a);
      const prevs = chainPrevOf.get(b) || [];
      const idx = prevs.indexOf(a);
      if (idx !== -1) prevs.splice(idx, 1);
      if (prevs.length === 0) chainPrevOf.delete(b);
      usedAsFrom.delete(a);
      throughJoined--;
    }
  });

  (overrides.joins || []).forEach(pair => {
    const [a, b] = pair;
    if (tryLink(a, b)) throughJoined++;
  });

  return { chainNextOf, chainPrevOf, throughJoined };
}

function assembleServices(chains, chainNextOf, chainPrevOf, overrides, report, stationNameById) {
  const chainByKey = new Map(chains.map(c => [chainKeyOf(c), c]));
  const services = [];
  const usedServiceIds = new Set();

  function nextServiceId(baseKey) {
    let id = 'sv_' + sanitizeIdPart(baseKey);
    let n = 2;
    while (usedServiceIds.has(id)) {
      id = 'sv_' + sanitizeIdPart(baseKey) + '_' + n;
      n++;
    }
    usedServiceIds.add(id);
    return id;
  }

  // 複数の路線・種別が同じ続き駅に直通することがあるため（例：普通・快速の両方が
  // 同じ路線に直通する）、続き駅の流れ（chain）は複数の運行系統から共有されうる。
  // そのため「訪問済み」はこの1本の運行系統をたどる間だけ有効な、たどりごとのガード
  // （wouldCycle で構造的な循環は作られない前提の保険）にする。
  chains.forEach(c => {
    const key = chainKeyOf(c);
    if (chainPrevOf.has(key)) return;
    const seqKeys = [key];
    const pathVisited = new Set([key]);
    let cur = key;
    while (chainNextOf.has(cur)) {
      const nextKey = chainNextOf.get(cur);
      if (pathVisited.has(nextKey)) break;
      seqKeys.push(nextKey);
      pathVisited.add(nextKey);
      cur = nextKey;
    }
    const chainSeq = seqKeys.map(k => chainByKey.get(k));
    services.push(buildServiceFromChainSeq(chainSeq, overrides, nextServiceId, stationNameById));
  });

  return services;
}

function buildServiceFromChainSeq(chainSeq, overrides, nextServiceId, stationNameById) {
  const merge = overrides.categoryMerge || {};
  const isCircular = chainSeq.length === 1 && chainSeq[0].circular;
  const allHops = chainSeq.flatMap(c => c.hops);

  const stops = allHops.map(h => {
    const stop = { stationId: h.from, platformId: h.fromPlatform, run: h.run };
    if (h.board === false) stop.board = false;
    return stop;
  });
  if (!isCircular) {
    const lastHop = allHops[allHops.length - 1];
    stops.push({ stationId: lastHop.to, platformId: lastHop.toPlatform });
  }

  const sections = [];
  if (isCircular) {
    const hops = chainSeq[0].hops;
    const lineMerge = merge[hops[0].lineId] || {};
    const categoryId = lineMerge[hops[0].categoryId] || hops[0].categoryId;
    sections.push({ lineId: hops[0].lineId, categoryId, from: 0, to: hops.length - 1 });
  } else {
    let cursor = 0;
    chainSeq.forEach(chain => {
      const hops = chain.hops;
      const lineMerge = merge[hops[0].lineId] || {};
      const categoryId = lineMerge[hops[0].categoryId] || hops[0].categoryId;
      sections.push({ lineId: hops[0].lineId, categoryId, from: cursor, to: cursor + hops.length });
      cursor += hops.length;
    });
  }

  const firstKey = chainKeyOf(chainSeq[0]);
  const id = nextServiceId(firstKey);
  const lastStop = stops[stops.length - 1];

  return {
    id,
    name: '',
    headsign: isCircular ? null : (stationNameById.get(lastStop.stationId) || lastStop.stationId),
    active: true,
    circular: isCircular,
    stops,
    sections,
  };
}

export function convertV1ToV2(v1data, overrides = {}) {
  const ov = normalizeOverrides(overrides);
  const report = { stats: {}, issues: [] };

  const network = {
    schemaVersion: '2.0.0',
    kind: 'network',
    meta: convertMeta(v1data),
    companies: convertCompanies(v1data),
    vehicleTypes: convertVehicleTypes(v1data),
    stations: [],
    stationGroups: [],
    transfers: convertTransfers(v1data),
    transferDefaults: { samePlatform: 5, unknown: 10 },
    lines: convertLines(v1data, ov),
    services: [],
  };

  const platformsByStation = collectPlatformsByStation(v1data);
  network.stations = convertStations(v1data, platformsByStation);

  const lineCategoryNameToId = buildLineCategoryNameToId(v1data);
  const lineById = new Map((v1data.lines || []).map(l => [l.lineId, l]));

  const hops = buildHops(v1data, lineCategoryNameToId);
  const chains = buildAllChains(hops, lineById, report);
  const circularChains = chains.filter(c => c.circular).length;

  const { chainNextOf, chainPrevOf, throughJoined } = joinChains(chains, v1data, lineCategoryNameToId, ov, report);
  const stationNameById = new Map((v1data.stations || []).map(s => [s.stationId, s.stationName]));
  network.services = assembleServices(chains, chainNextOf, chainPrevOf, ov, report, stationNameById);

  let categoryMergedCount = 0;
  Object.values(ov.categoryMerge).forEach(m => { categoryMergedCount += Object.keys(m).length; });

  report.stats = {
    segments: (v1data.segments || []).length,
    hops: hops.length,
    chains: chains.length,
    circularChains,
    services: network.services.length,
    throughJoined,
    categoryMerged: categoryMergedCount,
  };

  const operations = convertOperations(v1data, ov);

  const netCheck = validateNetwork(network);
  if (!netCheck.ok) {
    report.issues.push({
      level: 'warning',
      code: 'CONVERT_INVALID',
      message: `変換した network に ${netCheck.errors.length} 件の errors があります`,
      refs: netCheck.errors.map(e => e.code),
    });
  }

  return { network, operations, report };
}

const DIRECTION_KEY_DEFAULT = { up: 'backward', down: 'forward' };

function convertRangeV1(segment) {
  if (!segment || segment.is_full_line) return null;
  return {
    fromStationId: segment.start_station_id,
    toStationId: segment.end_station_id,
    direction: null,
  };
}

function convertNoticeV1(st, ov) {
  const directionMap = ov.directionMap[st.affected_line_id] || {};
  const upTarget = directionMap.up || DIRECTION_KEY_DEFAULT.up;
  const downTarget = directionMap.down || DIRECTION_KEY_DEFAULT.down;
  const directions = { forward: false, backward: false };
  if (st.direction) {
    if (st.direction.up) directions[upTarget] = true;
    if (st.direction.down) directions[downTarget] = true;
  }

  const merge = ov.categoryMerge[st.affected_line_id] || {};
  let categoryIds = null;
  if (!st.notice_types_all && Array.isArray(st.notice_types)) {
    const mapped = st.notice_types.map(id => merge[id] || id);
    categoryIds = Array.from(new Set(mapped));
  }

  const cause = st.cause || {};
  const causeSegment = cause.cause_segment;
  const causeRange = causeSegment && causeSegment.start_station_id
    ? { fromStationId: causeSegment.start_station_id, toStationId: causeSegment.end_station_id, direction: null }
    : null;

  return {
    id: st.id,
    state: st.published ? 'published' : 'draft',
    createdAt: st.created_at,
    updatedAt: st.updated_at,
    updatedBy: null,
    occurrence: st.occurrence,
    lineId: st.affected_line_id,
    range: convertRangeV1(st.affected_segment),
    directions,
    categoryIds,
    status: { code: st.status && st.status.code, heading: st.status && st.status.heading, body: st.status && st.status.body },
    cause: {
      code: cause.code,
      heading: cause.heading != null ? cause.heading : null,
      body: cause.body != null ? cause.body : null,
      lineOption: cause.cause_line_option,
      lineId: cause.cause_line_id != null ? cause.cause_line_id : null,
      range: causeRange,
    },
    turnback: st.turnback || { start: false, end: false },
    throughServices: (st.through_services || []).map(t => ({
      lineId: t.line_id,
      state: t.state,
      target: t.target,
      showOnThroughLine: !!t.show_on_through_line,
    })),
    text: st.preview && st.preview.editable
      ? { mode: 'custom', custom: st.preview.custom_text != null ? st.preview.custom_text : null }
      : { mode: 'auto', custom: null },
  };
}

function convertOperations(v1data, ov) {
  const serviceStatuses = v1data.serviceStatuses || [];
  const notices = serviceStatuses
    .filter(st => !st.generated_from)
    .map(st => convertNoticeV1(st, ov));

  const statusTemplates = (v1data.statusTemplates || []).map(t => ({
    code: t.code,
    statusId: t.status_id != null ? t.status_id : t.code,
    label: t.label,
    heading: t.heading,
    body: t.body,
    description: t.description,
  }));

  const causes = (v1data.serviceStatusCauses || []).map(c => ({
    code: c.code,
    label: c.label,
    heading: c.heading,
    body: c.body,
    defaultLineOption: c.default_line_option,
  }));

  return {
    schemaVersion: '2.0.0',
    kind: 'operations',
    masters: { statusTemplates, causes },
    notices,
  };
}
