// v1 の経路探索処理を、比較用にそのまま切り出したもの。
// transfer_app.js の preprocessData/findRoutes/dijkstraSearch/MinPriorityQueue/
// passesFilter/reconstructRoute/buildRouteInfo/deduplicateRoutes/getTransferPenalty
// を、グローバル変数を関数の引数・戻り値に置き換えただけで、アルゴリズムには手を入れていない。

function getTransferPenalty(mode) {
  switch (mode) {
    case 'time':
      return 0;
    case 'transfer':
      return 30;
    case 'balance':
    default:
      return 10;
  }
}

function preprocessData(appData) {
  if (!appData) {
    throw new Error('appDataが存在しません');
  }
  if (!appData.stations || !Array.isArray(appData.stations)) {
    throw new Error('appData.stationsが無効です');
  }
  if (!appData.lines || !Array.isArray(appData.lines)) {
    throw new Error('appData.linesが無効です');
  }

  // 駅IDから駅情報へのマップ
  const stationMap = new Map();
  appData.stations.forEach(station => {
    stationMap.set(station.stationId, station);
  });

  // 路線IDから路線情報へのマップ
  const lineMap = new Map();
  appData.lines.forEach(line => {
    lineMap.set(line.lineId, line);
  });

  // 各路線のstationOrderから各駅を通る路線を抽出して駅データに追加
  const stationLinesMap = new Map(); // stationId -> Set of {lineId, companyId}
  appData.lines.forEach(line => {
    const lineId = line.lineId;
    const companyId = line.companyId;
    const stationOrder = line.stationOrder || [];

    stationOrder.forEach(stationId => {
      if (!stationLinesMap.has(stationId)) {
        stationLinesMap.set(stationId, new Map());
      }
      stationLinesMap.get(stationId).set(lineId, companyId);
    });
  });

  // 駅データにlines配列を追加
  stationMap.forEach((station, stationId) => {
    if (stationLinesMap.has(stationId)) {
      const linesMap = stationLinesMap.get(stationId);
      station.lines = Array.from(linesMap.entries()).map(([lineId, companyId]) => ({
        lineId: lineId,
        companyId: companyId
      }));
    } else {
      station.lines = [];
    }
  });

  // 会社IDから会社情報へのマップ
  const companyMap = new Map();
  appData.companies.forEach(company => {
    companyMap.set(company.companyId, company);
  });

  // 列車種別IDから種別情報へのマップ（UI等で参照するため保持）
  const trainTypeMap = new Map();
  appData.trainTypes.forEach(type => {
    trainTypeMap.set(type.trainTypeId, type);
  });

  // 隣接リスト作成（駅×路線×種別をノードとする）
  const adjacencyList = new Map();

  function addEdge(fromStationId, toStationId, lineId, guidance, duration, segmentRef, isAlightOnly = false) {
    const fromKey = `${fromStationId}|${lineId}|${guidance}`;
    const toKey = `${toStationId}|${lineId}|${guidance}`;

    if (!adjacencyList.has(fromKey)) adjacencyList.set(fromKey, []);
    adjacencyList.get(fromKey).push({
      type: 'segment',
      toKey: toKey,
      fromStationId: fromStationId,
      toStationId: toStationId,
      lineId: lineId,
      guidance: guidance,
      duration: duration,
      segment: segmentRef,
      isAlightOnly: isAlightOnly
    });
  }

  appData.segments.forEach(segment => {
    const isAlightOnly = segment.isAlightOnly || false;
    const a = segment.fromStationId;
    const b = segment.toStationId;
    const lineId = segment.lineId;
    const guidance = segment.guidance;

    addEdge(a, b, lineId, guidance, segment.duration, {
      ...segment,
      hopFrom: a,
      hopTo: b
    }, isAlightOnly);

    if (segment.isBidirectional) {
      addEdge(b, a, lineId, guidance, segment.duration, {
        ...segment,
        hopFrom: b,
        hopTo: a
      }, false);
    }
  });

  // 直通運転設定マップを作成（相互・一方向対応）
  const throughServiceMap = new Map();
  if (appData.throughServiceConfigs) {
    appData.throughServiceConfigs.forEach(config => {
      const keyForward = `${config.fromLineId}|${config.fromGuidance}|${config.toLineId}|${config.toGuidance}`;
      throughServiceMap.set(keyForward, config);

      if (config.isBidirectional) {
        const keyReverse = `${config.toLineId}|${config.toGuidance}|${config.fromLineId}|${config.fromGuidance}`;
        throughServiceMap.set(keyReverse, {
          ...config,
          fromLineId: config.toLineId,
          toLineId: config.fromLineId,
          fromGuidance: config.toGuidance,
          toGuidance: config.fromGuidance
        });
      }
    });
  }

  // のりば間乗換時間マップを作成
  const platformTransferMap = new Map();
  if (appData.platformTransfers) {
    appData.platformTransfers.forEach(transfer => {
      const key = `${transfer.stationId}|${transfer.fromPlatform}|${transfer.toPlatform}`;
      platformTransferMap.set(key, transfer);
    });
  }

  // 乗換情報を隣接リストに追加
  appData.segments.forEach(fromSegment => {
    Object.entries(fromSegment.platforms).forEach(([stationId, fromPlatform]) => {
      const fromGuidance = fromSegment.guidance;
      const fromKey = `${stationId}|${fromSegment.lineId}|${fromGuidance}`;

      if (!adjacencyList.has(fromKey)) {
        adjacencyList.set(fromKey, []);
      }

      appData.segments.forEach(toSegment => {
        if (toSegment.platforms[stationId]) {
          const toPlatform = toSegment.platforms[stationId];
          const toGuidance = toSegment.guidance;
          const toKey = `${stationId}|${toSegment.lineId}|${toGuidance}`;

          if (fromKey === toKey) return;

          let transferTime = 0;
          let isDirectThrough = false;
          let isTypeChange = false;

          const throughKey = `${fromSegment.lineId}|${fromGuidance}|${toSegment.lineId}|${toGuidance}`;
          const throughConfig = throughServiceMap.get(throughKey);

          const fromPlatformDefined = fromPlatform !== undefined && fromPlatform !== null && fromPlatform !== '';
          const toPlatformDefined = toPlatform !== undefined && toPlatform !== null && toPlatform !== '';
          const samePlatform = fromPlatformDefined && toPlatformDefined && (fromPlatform === toPlatform);

          if (throughConfig && samePlatform) {
            transferTime = 0;
            isDirectThrough = true;
            isTypeChange = false;
          } else {
            if (fromSegment.lineId === toSegment.lineId && fromGuidance !== toGuidance) {
              isTypeChange = true;
            }

            if (samePlatform) {
              transferTime = 5;
            } else if (fromPlatformDefined && toPlatformDefined) {
              const transferKey = `${stationId}|${fromPlatform}|${toPlatform}`;
              const transfer = platformTransferMap.get(transferKey);
              if (transfer) {
                transferTime = transfer.transferTime;
              } else {
                transferTime = 10;
              }
            } else {
              transferTime = 10;
            }
            isDirectThrough = false;
          }

          adjacencyList.get(fromKey).push({
            type: 'transfer',
            toKey: toKey,
            toStationId: stationId,
            lineId: toSegment.lineId,
            guidance: toGuidance,
            duration: transferTime,
            fromPlatform: fromPlatform,
            toPlatform: toPlatform,
            fromLineId: fromSegment.lineId,
            toLineId: toSegment.lineId,
            fromGuidance: fromGuidance,
            toGuidance: toGuidance,
            isDirectThrough: isDirectThrough,
            isTypeChange: isTypeChange
          });
        }
      });
    });
  });

  return {
    stationMap,
    lineMap,
    companyMap,
    trainTypeMap,
    adjacencyList,
    throughServiceMap
  };
}

// ========================================
// 優先度キュー（簡易実装）
// ========================================
class MinPriorityQueue {
  constructor() {
    this.items = [];
  }

  enqueue(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    return this.items.shift()?.item;
  }

  isEmpty() {
    return this.items.length === 0;
  }
}

// ========================================
// フィルター判定
// ========================================
function passesFilter(preprocessedData, neighbor, filters) {
  const lineInfoForFilter = preprocessedData.lineMap.get(neighbor.lineId);
  const neighborLineTrainType = lineInfoForFilter ? lineInfoForFilter.trainType : null;
  if (!filters.allowedTrainTypes.has(neighborLineTrainType)) {
    return false;
  }

  if (filters.onlyOwnCompany) {
    const lineInfo = preprocessedData.lineMap.get(neighbor.lineId);
    if (lineInfo && lineInfo.companyId !== filters.ownCompanyId) {
      return false;
    }
  }

  return true;
}

// ========================================
// 経路復元
// ========================================
function reconstructRoute(preprocessedData, startState, endState, previous) {
  const path = [];
  let currentState = endState;

  while (currentState !== startState) {
    const prev = previous.get(currentState);
    if (!prev) break;
    const [nodeKey] = currentState.split('@@');
    path.unshift({ key: nodeKey, edge: prev.edge });
    currentState = prev.state;
  }

  const [startKey] = startState.split('@@');
  path.unshift({ key: startKey, edge: null });
  return buildRouteInfo(preprocessedData, path);
}

// ========================================
// 経路情報構築
// ========================================
function buildRouteInfo(preprocessedData, path) {
  const legs = [];
  let totalDuration = 0;

  let lastRideLeg = null;

  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    const [stationId, lineId, guidance] = node.key.split('|');
    const station = preprocessedData.stationMap.get(stationId);
    const line = preprocessedData.lineMap.get(lineId);
    const edge = node.edge;

    if (i === 0) {
      legs.push({
        type: 'start',
        stationId,
        stationName: station?.stationName || stationId,
        lineId,
        lineName: line?.lineName || lineId,
        lineColor: line?.lineColor || '#ccc',
        guidance: null,
        duration: 0,
        platform: null
      });
      lastRideLeg = null;
      continue;
    }

    if (!edge) continue;

    if (edge.type === 'segment') {
      const isSameLineAndType = lastRideLeg && lastRideLeg.lineId === lineId && lastRideLeg.guidance === edge.guidance;

      let isReversal = false;
      if (lastRideLeg && lastRideLeg.segments && lastRideLeg.segments.length > 0 && edge.segment) {
        const prevSeg = lastRideLeg.segments[lastRideLeg.segments.length - 1];
        const currSeg = edge.segment;
        if (prevSeg.hopFrom && prevSeg.hopTo && currSeg.hopFrom && currSeg.hopTo) {
          if (prevSeg.hopFrom === currSeg.hopTo && prevSeg.hopTo === currSeg.hopFrom) {
            isReversal = true;
          }
        }
      }

      const isMergeable = isSameLineAndType && !isReversal;

      let arrivalPlatform = null;
      if (edge.segment && edge.segment.platforms && edge.segment.platforms[stationId]) {
        arrivalPlatform = edge.segment.platforms[stationId];
      }

      let departurePlatform = null;
      if (edge.segment && edge.segment.platforms && edge.fromStationId) {
        departurePlatform = edge.segment.platforms[edge.fromStationId];
      }

      if (isMergeable) {
        lastRideLeg.segments.push(edge.segment);
        lastRideLeg.duration += edge.duration;
        lastRideLeg.stationId = stationId;
        lastRideLeg.stationName = station?.stationName || stationId;
        lastRideLeg.arrivalPlatform = arrivalPlatform;
      } else {
        if (isReversal && lastRideLeg) {
          const prevArrivalPlatform = lastRideLeg.arrivalPlatform || null;
          const nextDeparturePlatform = departurePlatform || null;

          const transferTime = (prevArrivalPlatform && nextDeparturePlatform && prevArrivalPlatform === nextDeparturePlatform) ? 5 : 10;

          legs.push({
            type: 'transfer',
            stationId: lastRideLeg.stationId,
            stationName: lastRideLeg.stationName,
            lineId: lastRideLeg.lineId,
            lineName: lastRideLeg.lineName,
            lineColor: lastRideLeg.lineColor,
            guidance: edge.guidance || null,
            duration: transferTime,
            transferTime: transferTime,
            isDirectThrough: false,
            isTypeChange: (lastRideLeg.guidance !== edge.guidance),
            fromPlatform: prevArrivalPlatform,
            toPlatform: nextDeparturePlatform,
            fromLineId: lastRideLeg.lineId,
            toLineId: lineId,
            fromGuidance: lastRideLeg.guidance,
            toGuidance: edge.guidance,
            departurePlatform: nextDeparturePlatform
          });

          totalDuration += transferTime;
          lastRideLeg = null;
        }
        const newRide = {
          type: 'segment',
          segments: [edge.segment],
          stationId,
          stationName: station?.stationName || stationId,
          lineId,
          lineName: line?.lineName || lineId,
          lineColor: line?.lineColor || '#ccc',
          guidance: edge.guidance || null,
          duration: edge.duration,
          departurePlatform: departurePlatform,
          arrivalPlatform: arrivalPlatform
        };
        legs.push(newRide);
        lastRideLeg = newRide;
      }
      totalDuration += edge.duration;
    } else if (edge.type === 'transfer') {
      let prevLineId = null;
      let prevGuidance = null;
      if (i > 0 && path[i - 1].edge && path[i - 1].edge.type === 'segment') {
        const [, prevLine, prevG] = path[i - 1].key.split('|');
        prevLineId = prevLine;
        prevGuidance = prevG;
      }

      legs.push({
        type: 'transfer',
        stationId,
        stationName: station?.stationName || stationId,
        lineId,
        lineName: line?.lineName || lineId,
        lineColor: line?.lineColor || '#ccc',
        guidance: edge.guidance || null,
        duration: edge.duration,
        transferTime: edge.duration,
        isDirectThrough: edge.isDirectThrough || false,
        isTypeChange: edge.isTypeChange || false,
        fromPlatform: edge.fromPlatform,
        toPlatform: edge.toPlatform,
        fromLineId: prevLineId || edge.fromLineId,
        toLineId: edge.toLineId || lineId,
        fromGuidance: prevGuidance || edge.fromGuidance || null,
        toGuidance: edge.toGuidance || edge.guidance,
        departurePlatform: edge.toPlatform
      });
      totalDuration += edge.duration;
    }
  }

  let transferCount = 0;
  for (const leg of legs) {
    if (leg.type === 'transfer' && !leg.isDirectThrough) {
      transferCount++;
    }
  }

  return {
    legs,
    totalDuration: Math.round(totalDuration),
    transferCount
  };
}

// ========================================
// Dijkstra法による経路探索
// ========================================
function dijkstraSearch(preprocessedData, startKey, endStationId, requiredViaStations, filters) {
  const distances = new Map();
  const previous = new Map();
  const visited = new Set();
  const visitedStations = new Map();
  const queue = new MinPriorityQueue();

  const [startStationId] = startKey.split('|');
  const initialState = `${startKey}@@0`;
  distances.set(initialState, 0);
  visitedStations.set(initialState, new Set([startStationId]));
  queue.enqueue(initialState, 0);

  while (!queue.isEmpty()) {
    const currentState = queue.dequeue();
    if (visited.has(currentState)) continue;
    visited.add(currentState);

    const [currentKey, viaIndexStr] = currentState.split('@@');
    const viaIndex = parseInt(viaIndexStr);
    const currentDistance = distances.get(currentState);
    const [currentStationId] = currentKey.split('|');

    if (currentStationId === endStationId && viaIndex === requiredViaStations.length) {
      return reconstructRoute(preprocessedData, initialState, currentState, previous);
    }

    const neighbors = preprocessedData.adjacencyList.get(currentKey) || [];

    const currentVisitedStations = visitedStations.get(currentState) || new Set();

    for (let neighbor of neighbors) {
      const nextKey = neighbor.toKey;
      const [nextStationId] = nextKey.split('|');

      if (neighbor.isAlightOnly && currentState === initialState) {
        continue;
      }

      if (currentState === initialState && neighbor.type === 'transfer') {
        continue;
      }

      let newViaIndex = viaIndex;
      let newVisitedStations = new Set(currentVisitedStations);

      if (viaIndex < requiredViaStations.length &&
        currentStationId === requiredViaStations[viaIndex].stationId) {
        newViaIndex = viaIndex + 1;
        newVisitedStations = new Set([currentStationId]);
      }

      if (neighbor.type === 'segment') {
        if (newVisitedStations.has(nextStationId)) {
          continue;
        }
      }

      if (!passesFilter(preprocessedData, neighbor, filters)) {
        continue;
      }

      const nextState = `${nextKey}@@${newViaIndex}`;

      if (visited.has(nextState)) {
        continue;
      }

      const newDistance = currentDistance + neighbor.duration;
      const oldDistance = distances.get(nextState);

      if (oldDistance === undefined || newDistance < oldDistance) {
        distances.set(nextState, newDistance);
        previous.set(nextState, { state: currentState, edge: neighbor });

        if (neighbor.type === 'segment') {
          newVisitedStations.add(nextStationId);
        }
        visitedStations.set(nextState, newVisitedStations);

        queue.enqueue(nextState, newDistance);
      }
    }
  }

  return null;
}

// ========================================
// 重複経路の除去
// ========================================
function deduplicateRoutes(routes) {
  const seen = new Set();
  const unique = [];

  for (let route of routes) {
    const signature = route.legs
      .map(leg => `${leg.stationId}|${leg.lineId}|${leg.guidance || ''}`)
      .join('||');

    if (!seen.has(signature)) {
      seen.add(signature);
      unique.push(route);
    }
  }

  return unique;
}

// ========================================
// 経路探索アルゴリズム（修正Dijkstra法）
// ========================================
function findRoutes(appData, preprocessedData, startStation, endStation, viaStations, filters, searchMode) {
  const routes = [];
  const maxRoutes = 5;

  const startKeys = [];
  startStation.lines.forEach(line => {
    const lineInfo = preprocessedData.lineMap.get(line.lineId);
    const lineTrainType = lineInfo ? lineInfo.trainType : null;
    if (!filters.allowedTrainTypes.has(lineTrainType)) {
      return;
    }

    const guidanceSet = new Set();
    appData.segments.forEach(seg => {
      if (seg.lineId === line.lineId && (seg.fromStationId === startStation.stationId || seg.toStationId === startStation.stationId)) {
        if (seg.guidance) guidanceSet.add(seg.guidance);
      }
    });

    guidanceSet.forEach(guidance => {
      const key = `${startStation.stationId}|${line.lineId}|${guidance}`;
      if (preprocessedData.adjacencyList.has(key)) {
        startKeys.push(key);
      }
    });
  });

  if (startKeys.length === 0) {
    return [];
  }

  startKeys.forEach(startKey => {
    const route = dijkstraSearch(preprocessedData, startKey, endStation.stationId, viaStations, filters);
    if (route) {
      routes.push(route);
    }
  });

  const uniqueRoutes = deduplicateRoutes(routes);

  const TRANSFER_PENALTY = getTransferPenalty(searchMode);
  uniqueRoutes.sort((a, b) => {
    const scoreA = a.totalDuration + (a.transferCount * TRANSFER_PENALTY);
    const scoreB = b.totalDuration + (b.transferCount * TRANSFER_PENALTY);

    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    if (a.totalDuration !== b.totalDuration) {
      return a.totalDuration - b.totalDuration;
    }
    return a.transferCount - b.transferCount;
  });

  return uniqueRoutes.slice(0, maxRoutes);
}

function findStationById(appData, id) {
  if (!id) return null;
  return appData.stations.find(s => s.stationId === id);
}

/**
 * v1 データに対する経路探索（transfer_app.js から切り出したロジックそのまま）。
 * @param {object} v1data v1 形式のデータ（`data.data` 相当。segments/lines/stations などを含む）
 * @param {object} options
 * @param {string} options.fromId 出発駅の stationId
 * @param {string} options.toId 到着駅の stationId
 * @param {string[]} [options.viaIds] 経由駅の stationId（順序どおり）
 * @param {{ onlyOwnCompany?: boolean, allowedTrainTypes?: string[] }} [options.filters]
 * @param {'time'|'balance'|'transfer'} [options.mode]
 * @returns {Array<{ legs: any[], totalDuration: number, transferCount: number }>}
 */
export function legacySearch(v1data, { fromId, toId, viaIds = [], filters = {}, mode = 'balance' } = {}) {
  const appData = v1data;
  const preprocessedData = preprocessData(appData);

  const startStation = findStationById(appData, fromId);
  const endStation = findStationById(appData, toId);
  if (!startStation || !endStation) return [];

  const viaStations = viaIds.map(id => findStationById(appData, id)).filter(Boolean);

  const allowedTrainTypes = filters.allowedTrainTypes
    ? new Set(filters.allowedTrainTypes)
    : new Set(appData.trainTypes.map(t => t.trainTypeId));

  const normalizedFilters = {
    onlyOwnCompany: !!filters.onlyOwnCompany,
    ownCompanyId: appData.meta ? appData.meta.ownCompanyId : null,
    allowedTrainTypes
  };

  return findRoutes(appData, preprocessedData, startStation, endStation, viaStations, normalizedFilters, mode);
}
