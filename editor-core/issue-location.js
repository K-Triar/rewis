// エラー・注意のパネルで使う、issue（{ code, path, message }）の場所の説明と飛び先。
// DOM を使わない。02-editor-ui-spec.md 6章。

function parsePath(path) {
  if (!path) return [];
  return path.split('.').map((part) => {
    const m = part.match(/^(\w+)(?:\[(\d+)\])?$/);
    if (!m) return { key: part, idx: null };
    return { key: m[1], idx: m[2] !== undefined ? Number(m[2]) : null };
  });
}

function nameOf(item, idx, key = 'name') {
  if (!item) return String(idx);
  return item[key] || item.id || String(idx);
}

function stationName(network, stationId) {
  const station = (network && network.stations || []).find((s) => s && s.id === stationId);
  return station ? station.name || station.id : stationId;
}

function formatTransferEndpoint(network, endpoint) {
  if (!endpoint) return '';
  const station = (network && network.stations || []).find((s) => s && s.id === endpoint.stationId);
  const name = station ? station.name || station.id : endpoint.stationId;
  if (!endpoint.platformId) return name;
  const platform = station && (station.platforms || []).find((p) => p && p.id === endpoint.platformId);
  const label = platform ? platform.label : endpoint.platformId;
  return `${name} ${label}`;
}

export function serviceTitle(network, service) {
  if (!service) return '';
  if (service.headsign) return service.headsign;
  if (service.circular) {
    const firstSection = (service.sections || [])[0];
    if (firstSection) {
      const line = (network && network.lines || []).find((l) => l && l.id === firstSection.lineId);
      if (line) return `（環状）${line.name || line.id}`;
    }
  }
  return service.id;
}

export function describeIssueLocation(kind, issueObj, docs) {
  const doc = kind === 'operations' ? docs && docs.operations : docs && docs.network;
  const network = docs && docs.network;
  const parts = parsePath(issueObj && issueObj.path);
  if (!doc || parts.length === 0) return '全体';

  const first = parts[0];
  const second = parts[1];

  switch (first.key) {
    case 'stations': {
      if (first.idx === null) return '全体';
      const station = (doc.stations || [])[first.idx];
      const name = nameOf(station, first.idx);
      if (second && second.key === 'platforms' && second.idx !== null) {
        const platform = station && (station.platforms || [])[second.idx];
        const label = nameOf(platform, second.idx, 'label');
        return `駅「${name}」ののりば「${label}」`;
      }
      return `駅「${name}」`;
    }
    case 'lines': {
      if (first.idx === null) return '全体';
      const line = (doc.lines || [])[first.idx];
      const name = nameOf(line, first.idx);
      if (second && second.key === 'categories' && second.idx !== null) {
        const category = line && (line.categories || [])[second.idx];
        const catName = nameOf(category, second.idx);
        return `路線「${name}」の種別「${catName}」`;
      }
      return `路線「${name}」`;
    }
    case 'services': {
      if (first.idx === null) return '全体';
      const service = (doc.services || [])[first.idx];
      const title = serviceTitle(network, service);
      if (second && second.key === 'stops' && second.idx !== null) {
        const stop = service && (service.stops || [])[second.idx];
        const name = stop ? stationName(network, stop.stationId) : String(second.idx);
        return `運行系統「${title}」の ${second.idx + 1} 番目の停車駅（${name}）`;
      }
      if (second && second.key === 'sections' && second.idx !== null) {
        const section = service && (service.sections || [])[second.idx];
        if (section) {
          const nameA = stationName(network, service.stops && service.stops[section.from] && service.stops[section.from].stationId);
          const nameB = stationName(network, service.stops && service.stops[section.to] && service.stops[section.to].stationId);
          return `運行系統「${title}」の ${nameA}〜${nameB} の路線・種別`;
        }
      }
      return `運行系統「${title}」`;
    }
    case 'transfers': {
      if (first.idx === null) return '全体';
      const transfer = (doc.transfers || [])[first.idx];
      if (!transfer) return `乗換「${first.idx}」`;
      const from = formatTransferEndpoint(network, transfer.from);
      const to = formatTransferEndpoint(network, transfer.to);
      return `乗換「${from} → ${to}」`;
    }
    case 'stationGroups': {
      if (first.idx === null) return '全体';
      const group = (doc.stationGroups || [])[first.idx];
      return `駅グループ「${nameOf(group, first.idx)}」`;
    }
    case 'companies': {
      if (first.idx === null) return '全体';
      const company = (doc.companies || [])[first.idx];
      return `鉄道会社「${nameOf(company, first.idx)}」`;
    }
    case 'notices': {
      if (first.idx === null) return '全体';
      return `運行情報 ${first.idx + 1} 件目`;
    }
    default:
      return '全体';
  }
}

const TAB_BY_ARRAY = {
  stations: 'stations',
  lines: 'lines',
  services: 'services',
  transfers: 'transfers',
  stationGroups: 'transfers',
  companies: 'companies',
  notices: 'operations'
};

function mergeLevel(current, next) {
  if (current === 'error' || next === 'error') return 'error';
  return current || next;
}

// 運行系統タブ（12.6）：この運行系統に関わる errors/warnings を、停車駅・駅間ごとの level に振り分ける。
export function issueTargetsForService(validation, serviceIndex, service) {
  const result = { service: null, stops: {}, edges: {} };
  const sections = (service && service.sections) || [];
  const prefix = `services[${serviceIndex}]`;

  function apply(list, level) {
    (list || []).forEach((issueObj) => {
      const path = issueObj && issueObj.path;
      if (!path || (path !== prefix && !path.startsWith(prefix + '.'))) return;
      const parts = parsePath(path);
      const second = parts[1];
      if (!second) {
        result.service = mergeLevel(result.service, level);
        return;
      }
      if (second.key === 'stops') {
        if (second.idx === null) {
          result.service = mergeLevel(result.service, level);
        } else {
          result.stops[second.idx] = mergeLevel(result.stops[second.idx], level);
        }
        return;
      }
      if (second.key === 'sections') {
        if (second.idx === null) {
          result.service = mergeLevel(result.service, level);
          return;
        }
        const section = sections[second.idx];
        if (section) {
          for (let i = section.from; i < section.to; i++) {
            result.edges[i] = mergeLevel(result.edges[i], level);
          }
        }
        return;
      }
      result.service = mergeLevel(result.service, level);
    });
  }

  apply(validation && validation.errors, 'error');
  apply(validation && validation.warnings, 'warning');
  return result;
}

export function resolveIssueTarget(kind, issueObj, docs) {
  const doc = kind === 'operations' ? docs && docs.operations : docs && docs.network;
  const parts = parsePath(issueObj && issueObj.path);
  if (!doc || parts.length === 0) return null;

  const first = parts[0];
  const second = parts[1];
  const tab = TAB_BY_ARRAY[first.key];
  if (!tab || first.idx === null) return null;

  const list = doc[first.key];
  const item = Array.isArray(list) ? list[first.idx] : null;
  if (!item || !item.id) return null;

  if (first.key === 'stationGroups') {
    return { tab, id: item.id, sub: { type: 'group' } };
  }

  if (first.key === 'services') {
    if (second && second.key === 'stops' && second.idx !== null) {
      return { tab, id: item.id, sub: { type: 'stop', index: second.idx } };
    }
    if (second && second.key === 'sections' && second.idx !== null) {
      const section = (item.sections || [])[second.idx];
      if (section) {
        return { tab, id: item.id, sub: { type: 'edge', index: section.from } };
      }
    }
  }

  return { tab, id: item.id, sub: null };
}
