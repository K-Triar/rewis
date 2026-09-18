// 経路探索：運行系統を単位としたグラフを作り、二分ヒープを使ったダイクストラ法で検索する。
// 仕様は docs/rewis-v2/phase-3-route-search.md の 3-2・3-3 を参照。

// ========================================
// 二分ヒープ（優先度キュー）
// ========================================
class MinHeap {
  constructor() {
    this.items = [];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  push(state, priority) {
    const items = this.items;
    items.push({ state, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && items[l].priority < items[smallest].priority) smallest = l;
        if (r < n && items[r].priority < items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top.state;
  }
}

// ========================================
// グラフ構築
// ========================================
function platformKey(platformId) {
  return platformId == null ? '*' : platformId;
}

export function buildSearchGraph(model, { vehicleTypeIds = null, ownCompanyOnly = false } = {}) {
  const network = model.network;
  const ownCompanyId = network.meta ? network.meta.ownCompanyId : null;
  const lineById = model.lineById;

  function lineAllowed(line) {
    if (!line) return false;
    if (vehicleTypeIds && !vehicleTypeIds.has(line.vehicleTypeId)) return false;
    if (ownCompanyOnly && line.companyId !== ownCompanyId) return false;
    return true;
  }

  const nodes = [];
  const rNodeId = new Map();
  const adNodeId = new Map();
  // 駅ごとに、実際に作った A/D ノードののりばを覚えておく（出発・到着・乗換の展開に使う）
  const stationPlatforms = new Map();

  function stationEntry(stationId) {
    let e = stationPlatforms.get(stationId);
    if (!e) {
      e = { A: new Map(), D: new Map() };
      stationPlatforms.set(stationId, e);
    }
    return e;
  }

  function getRNode(serviceId, stopIndex, stationId, platformId) {
    const key = `${serviceId}#${stopIndex}`;
    let id = rNodeId.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ kind: 'R', serviceId, stopIndex, stationId, platformId });
      rNodeId.set(key, id);
    }
    return id;
  }

  function getADNode(kind, stationId, platformId) {
    const pk = platformKey(platformId);
    const key = `${kind}|${stationId}|${pk}`;
    let id = adNodeId.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ kind, stationId, platformId });
      adNodeId.set(key, id);
      stationEntry(stationId)[kind].set(pk, id);
    }
    return id;
  }

  const edges = [];
  function addEdge(from, to, dur, kind) {
    if (!edges[from]) edges[from] = [];
    edges[from].push({ to, dur, kind });
  }

  // 運行系統ごとに、停車駅間（i→i+1）がどの区間（路線・種別）に属するかを覚えておく。
  // circular の運行系統は最後の停車駅→先頭への辺も最後の区間に属する。
  const sectionForServiceEdge = new Map();

  model.activeServices.forEach(service => {
    const stops = service.stops;
    const n = stops.length;
    const edgeSection = new Array(n);
    (service.sections || []).forEach(section => {
      for (let i = section.from; i < section.to; i++) edgeSection[i] = section;
    });
    if (service.circular && service.sections && service.sections.length > 0) {
      edgeSection[n - 1] = service.sections[service.sections.length - 1];
    }
    sectionForServiceEdge.set(service.id, edgeSection);

    for (let i = 0; i < n; i++) {
      const stop = stops[i];
      const isLast = i === n - 1;
      const hasNext = service.circular ? true : !isLast;
      const rNode = getRNode(service.id, i, stop.stationId, stop.platformId);

      let rideAllowed = false;
      if (hasNext) {
        const section = edgeSection[i];
        const line = section && lineById.get(section.lineId);
        if (lineAllowed(line)) {
          rideAllowed = true;
          const nextIndex = service.circular && isLast ? 0 : i + 1;
          const nextStop = stops[nextIndex];
          const rNext = getRNode(service.id, nextIndex, nextStop.stationId, nextStop.platformId);
          addEdge(rNode, rNext, stop.run, 'ride');
        }
      }

      if (stop.alight !== false) {
        const aNode = getADNode('A', stop.stationId, stop.platformId);
        addEdge(rNode, aNode, 0, 'alight');
      }

      if (stop.board !== false && rideAllowed) {
        const dNode = getADNode('D', stop.stationId, stop.platformId);
        addEdge(dNode, rNode, 0, 'board');
      }
    }
  });

  // 乗換時間の決め方は 01-schema-v2.md 2.4 を参照
  const transferDefaults = network.transferDefaults || { samePlatform: 5, unknown: 10 };
  const sameStationTransfers = [];
  const crossStationTransfers = [];
  (network.transfers || []).forEach(tr => {
    const entries = [{ from: tr.from, to: tr.to, seconds: tr.seconds }];
    if (tr.bidirectional) entries.push({ from: tr.to, to: tr.from, seconds: tr.seconds });
    entries.forEach(e => {
      if (e.from.stationId === e.to.stationId) {
        sameStationTransfers.push({
          stationId: e.from.stationId,
          fromPlatformId: e.from.platformId,
          toPlatformId: e.to.platformId,
          seconds: e.seconds
        });
      } else {
        crossStationTransfers.push({
          fromStationId: e.from.stationId,
          fromPlatformId: e.from.platformId,
          toStationId: e.to.stationId,
          toPlatformId: e.to.platformId,
          seconds: e.seconds
        });
      }
    });
  });

  function registeredSameStationSeconds(stationId, fromPlatformId, toPlatformId) {
    const found = sameStationTransfers.find(t =>
      t.stationId === stationId && t.fromPlatformId === fromPlatformId && t.toPlatformId === toPlatformId);
    return found ? found.seconds : null;
  }

  // 同じ駅の中の乗換（A→D）をすべての組み合わせで作る
  stationPlatforms.forEach((entry, stationId) => {
    const aPlatforms = Array.from(entry.A.entries());
    const dPlatforms = Array.from(entry.D.entries());
    aPlatforms.forEach(([apk, aId]) => {
      const aPlatformId = apk === '*' ? null : apk;
      dPlatforms.forEach(([dpk, dId]) => {
        const dPlatformId = dpk === '*' ? null : dpk;
        let seconds;
        if (aPlatformId != null && dPlatformId != null && aPlatformId === dPlatformId) {
          seconds = transferDefaults.samePlatform;
        } else {
          const registered = registeredSameStationSeconds(stationId, aPlatformId, dPlatformId);
          seconds = registered != null ? registered : transferDefaults.unknown;
        }
        addEdge(aId, dId, seconds, 'transfer');
      });
    });
  });

  // 別の駅への徒歩連絡（A→D）。のりばが null の側は、実際に存在するのりばへ展開する
  crossStationTransfers.forEach(tr => {
    const fromEntry = stationPlatforms.get(tr.fromStationId);
    const toEntry = stationPlatforms.get(tr.toStationId);
    if (!fromEntry || !toEntry) return;
    const fromNodes = tr.fromPlatformId == null
      ? Array.from(fromEntry.A.values())
      : (fromEntry.A.has(tr.fromPlatformId) ? [fromEntry.A.get(tr.fromPlatformId)] : []);
    const toNodes = tr.toPlatformId == null
      ? Array.from(toEntry.D.values())
      : (toEntry.D.has(tr.toPlatformId) ? [toEntry.D.get(tr.toPlatformId)] : []);
    fromNodes.forEach(aId => {
      toNodes.forEach(dId => {
        addEdge(aId, dId, tr.seconds, 'walk');
      });
    });
  });

  return { nodes, edges, stationPlatforms, crossStationTransfers, sectionForServiceEdge };
}

// ========================================
// 同じ停車パターンで行先が違う運行系統を探す（3-3 alternativeHeadsigns）
// ========================================
function computeAlternativeHeadsigns(model, graph, service, stopIndices, perEdgeSection) {
  const windowLen = stopIndices.length;
  if (windowLen < 2) return [];
  const ownStops = stopIndices.map(idx => service.stops[idx]);
  const results = new Set();

  model.activeServices.forEach(other => {
    if (other.id === service.id) return;
    const otherEdgeSection = graph.sectionForServiceEdge.get(other.id);
    const n = other.stops.length;
    const maxStart = other.circular ? n : n - windowLen + 1;

    for (let start = 0; start < maxStart; start++) {
      let ok = true;
      for (let k = 0; k < windowLen; k++) {
        const idx = other.circular ? (start + k) % n : start + k;
        const stop = other.stops[idx];
        if (!stop || stop.stationId !== ownStops[k].stationId || stop.platformId !== ownStops[k].platformId) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      for (let k = 0; k < windowLen - 1; k++) {
        const idx = other.circular ? (start + k) % n : start + k;
        const sec = otherEdgeSection[idx];
        const ownSec = perEdgeSection[k];
        if (!sec || !ownSec || sec.lineId !== ownSec.lineId || sec.categoryId !== ownSec.categoryId) {
          ok = false;
          break;
        }
      }
      if (ok) {
        if (other.headsign && other.headsign !== service.headsign) results.add(other.headsign);
        break;
      }
    }
  });

  return Array.from(results);
}

// ========================================
// 経路の組み立て（辺の列 → Route）
// ========================================
function buildRoute(model, graph, path, score, fromStationId, toStationId) {
  const legs = [];
  let totalDuration = 0;
  let ride = null;

  function stationPlatformOf(nodeId) {
    if (nodeId >= graph.nodes.length) {
      // START または END（仮想頂点）
      return { stationId: null, platformId: null };
    }
    const node = graph.nodes[nodeId];
    return { stationId: node.stationId, platformId: node.platformId };
  }

  function closeRide() {
    if (!ride) return;
    const service = model.serviceById.get(ride.serviceId);
    const edgeSection = graph.sectionForServiceEdge.get(ride.serviceId);
    const stopIndices = ride.stopIndices;

    const stops = stopIndices.map((idx, pos) => {
      const raw = service.stops[idx];
      return { stationId: raw.stationId, platformId: raw.platformId, elapsed: ride.elapsed[pos] };
    });

    const perEdgeSection = [];
    for (let k = 0; k < stopIndices.length - 1; k++) {
      perEdgeSection.push(edgeSection[stopIndices[k]]);
    }

    const sections = [];
    for (let k = 0; k < perEdgeSection.length; k++) {
      const sec = perEdgeSection[k];
      const last = sections[sections.length - 1];
      if (last && last.lineId === sec.lineId && last.categoryId === sec.categoryId && last.endStop === k) {
        last.endStop = k + 1;
      } else {
        sections.push({ lineId: sec.lineId, categoryId: sec.categoryId, startStop: k, endStop: k + 1 });
      }
    }

    legs.push({
      type: 'ride',
      serviceId: ride.serviceId,
      headsign: service.headsign,
      alternativeHeadsigns: computeAlternativeHeadsigns(model, graph, service, stopIndices, perEdgeSection),
      stops,
      sections,
      duration: ride.elapsed[ride.elapsed.length - 1]
    });
    ride = null;
  }

  for (let i = 1; i < path.length; i++) {
    const { nodeId, edge } = path[i];
    if (!edge) continue;

    if (edge.kind === 'board') {
      const rNode = graph.nodes[nodeId];
      ride = { serviceId: rNode.serviceId, stopIndices: [rNode.stopIndex], elapsed: [0] };
      continue;
    }

    if (edge.kind === 'ride') {
      const rNode = graph.nodes[nodeId];
      ride.stopIndices.push(rNode.stopIndex);
      ride.elapsed.push(ride.elapsed[ride.elapsed.length - 1] + edge.dur);
      totalDuration += edge.dur;
      continue;
    }

    if (edge.kind === 'alight') {
      closeRide();
      continue;
    }

    if (edge.kind === 'start') {
      continue;
    }

    if (edge.kind === 'arrive') {
      continue;
    }

    // transfer / walk / startWalk / arriveWalk
    const from = stationPlatformOf(path[i - 1].nodeId);
    const to = stationPlatformOf(nodeId);
    legs.push({
      type: 'transfer',
      kind: edge.kind === 'transfer' ? 'platform' : 'walk',
      fromStationId: from.stationId != null ? from.stationId : fromStationId,
      fromPlatformId: from.platformId,
      toStationId: to.stationId != null ? to.stationId : toStationId,
      toPlatformId: to.platformId,
      duration: edge.dur
    });
    totalDuration += edge.dur;
  }

  const transferCount = legs.filter(l => l.type === 'ride').length - 1;

  return { totalDuration: Math.round(totalDuration), transferCount, score, legs };
}

// ========================================
// 重複経路の除去
// ========================================
function routeSignature(route) {
  return route.legs.map(leg => {
    if (leg.type === 'ride') {
      const first = leg.stops[0];
      const last = leg.stops[leg.stops.length - 1];
      return `R:${leg.serviceId}:${first.stationId}:${first.platformId ?? ''}:${last.stationId}:${last.platformId ?? ''}`;
    }
    return `T:${leg.kind}:${leg.fromStationId}:${leg.fromPlatformId ?? ''}:${leg.toStationId}:${leg.toPlatformId ?? ''}`;
  }).join('|');
}

function dedupeRoutes(routes) {
  const seen = new Set();
  const unique = [];
  routes.forEach(route => {
    const sig = routeSignature(route);
    if (seen.has(sig)) return;
    seen.add(sig);
    unique.push(route);
  });
  return unique;
}

// ========================================
// 探索本体
// ========================================
export function searchRoutes(model, graph, {
  fromStationId,
  toStationId,
  viaStationIds = [],
  transferPenalty = 10,
  maxRoutes = 5
} = {}) {
  if (!fromStationId || !toStationId || fromStationId === toStationId) return [];

  // 出発駅そのものに運行系統が発着しない（徒歩連絡でしか出られない駅の）場合もあるので、
  // stationPlatforms にエントリが無くても、徒歩連絡（startWalk）だけで探索を続行する。
  const fromEntry = graph.stationPlatforms.get(fromStationId);

  const startEdges = [];
  if (fromEntry) {
    fromEntry.D.forEach(dId => {
      startEdges.push({ to: dId, dur: 0, kind: 'start' });
    });
  }
  graph.crossStationTransfers.forEach(tr => {
    if (tr.fromStationId !== fromStationId) return;
    const toEntry = graph.stationPlatforms.get(tr.toStationId);
    if (!toEntry) return;
    const toNodes = tr.toPlatformId == null
      ? Array.from(toEntry.D.values())
      : (toEntry.D.has(tr.toPlatformId) ? [toEntry.D.get(tr.toPlatformId)] : []);
    toNodes.forEach(dId => {
      startEdges.push({ to: dId, dur: tr.seconds, kind: 'startWalk' });
    });
  });
  if (startEdges.length === 0) return [];

  const arriveWalkSources = graph.crossStationTransfers.filter(tr => tr.toStationId === toStationId);

  const N = graph.nodes.length;
  const START = N;
  const END = N + 1;

  function stationIdOf(nodeId) {
    if (nodeId === START) return fromStationId;
    if (nodeId === END) return toStationId;
    return graph.nodes[nodeId].stationId;
  }

  function outgoingEdges(nodeId, restriction) {
    if (nodeId === START) {
      if (!restriction) return startEdges;
      return startEdges.filter(e => e.to === restriction.dNodeId);
    }
    if (nodeId === END) {
      // END は終端。経由駅が残っていて到達条件を満たさない場合はここで行き止まりになる
      return [];
    }
    const node = graph.nodes[nodeId];
    let base = graph.edges[nodeId] || [];
    if (restriction && restriction.rNodeId != null && nodeId === restriction.dNodeId) {
      base = base.filter(e => e.to === restriction.rNodeId);
    }
    if (node.kind !== 'A') return base;

    const extra = [];
    if (node.stationId === toStationId) {
      extra.push({ to: END, dur: 0, kind: 'arrive' });
    }
    arriveWalkSources.forEach(tr => {
      if (tr.fromStationId !== node.stationId) return;
      if (tr.fromPlatformId != null && tr.fromPlatformId !== node.platformId) return;
      extra.push({ to: END, dur: tr.seconds, kind: 'arriveWalk' });
    });
    return extra.length ? base.concat(extra) : base;
  }

  function runDijkstra(restriction) {
    const viaCount = viaStationIds.length;
    const width = viaCount + 1;
    const totalStates = (N + 2) * width;
    const dist = new Float64Array(totalStates).fill(Infinity);
    const visited = new Uint8Array(totalStates);
    const prevState = new Int32Array(totalStates).fill(-1);
    const prevEdge = new Array(totalStates);

    const heap = new MinHeap();
    const startState = START * width;
    dist[startState] = 0;
    heap.push(startState, 0);

    while (!heap.isEmpty()) {
      const state = heap.pop();
      if (visited[state]) continue;
      visited[state] = 1;

      const nodeId = Math.floor(state / width);
      const viaIndex = state % width;
      const d = dist[state];

      let newViaIndex = viaIndex;
      if (viaIndex < viaCount && stationIdOf(nodeId) === viaStationIds[viaIndex]) {
        newViaIndex = viaIndex + 1;
      }

      if (nodeId === END && newViaIndex === viaCount) {
        const path = [];
        let s = state;
        while (s !== -1) {
          const nId = Math.floor(s / width);
          path.unshift({ nodeId: nId, edge: prevEdge[s] || null });
          s = prevState[s];
        }
        return { path, score: d };
      }

      const edges = outgoingEdges(nodeId, restriction);
      for (const edge of edges) {
        const cost = edge.dur + ((edge.kind === 'transfer' || edge.kind === 'walk') ? transferPenalty : 0);
        const nextState = edge.to * width + newViaIndex;
        if (visited[nextState]) continue;
        const nd = d + cost;
        if (nd < dist[nextState]) {
          dist[nextState] = nd;
          prevState[nextState] = state;
          prevEdge[nextState] = edge;
          heap.push(nextState, nd);
        }
      }
    }
    return null;
  }

  const results = [];
  const base = runDijkstra(null);
  if (base) results.push(base);
  // 出発時に乗れる運行系統・徒歩連絡の行き先ごとに、その選択だけを許した探索を追加で行う
  startEdges.forEach(e => {
    const boardEdges = (graph.edges[e.to] || []).filter(ed => ed.kind === 'board');
    if (boardEdges.length === 0) {
      const r = runDijkstra({ dNodeId: e.to, rNodeId: null });
      if (r) results.push(r);
      return;
    }
    boardEdges.forEach(b => {
      const r = runDijkstra({ dNodeId: e.to, rNodeId: b.to });
      if (r) results.push(r);
    });
  });

  // 「特定の列車に乗ることを強制する」候補探索では、その列車に乗ってもすぐ降りて
  // 別ののりばへ乗り換えるだけ（1駅も進まない）の経路が最短になることがある。
  // これは実質「その列車には乗らない」のと同じで、案内としては無意味なので除外する。
  // （出発駅で徒歩連絡してから乗る場合など、先頭以外の leg でも起こり得るのですべて見る）
  const routes = results
    .map(r => buildRoute(model, graph, r.path, r.score, fromStationId, toStationId))
    .filter(route => !route.legs.some(leg => leg.type === 'ride' && leg.stops.length < 2));
  const unique = dedupeRoutes(routes);

  unique.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.totalDuration !== b.totalDuration) return a.totalDuration - b.totalDuration;
    return a.transferCount - b.transferCount;
  });

  return unique.slice(0, maxRoutes);
}
