import { ID_PATTERN } from './ids.js';

function issue(code, path, message) {
  return { code, path, message };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonNegInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function isIdString(v) {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

function checkIdFormat(id, path, errors, message) {
  if (typeof id === 'string' && !ID_PATTERN.test(id)) {
    errors.push(issue('E_ID_FORMAT', path, message));
    return false;
  }
  return true;
}

function checkDup(list, getId, pathPrefix, label, errors) {
  const seen = new Map();
  list.forEach((item, idx) => {
    const id = item && item[getId];
    if (id === undefined || id === null || id === '') return;
    if (seen.has(id)) {
      errors.push(issue('E_DUP_ID', `${pathPrefix}[${idx}].${getId}`, `${label} "${id}" が重複しています`));
    } else {
      seen.set(id, idx);
    }
  });
}

export function validateNetwork(doc) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(doc)) {
    errors.push(issue('E_TYPE', '', 'network ドキュメントがオブジェクトではありません'));
    return { ok: false, errors, warnings };
  }

  if (typeof doc.schemaVersion !== 'string' || !doc.schemaVersion.startsWith('2.')) {
    errors.push(issue('E_SCHEMA_VERSION', 'schemaVersion', 'schemaVersion が "2." で始まっていません'));
  }
  if (doc.kind !== 'network') {
    errors.push(issue('E_KIND', 'kind', 'kind が "network" ではありません'));
  }

  const arrayKeys = ['companies', 'vehicleTypes', 'stations', 'lines', 'services'];
  for (const key of arrayKeys) {
    if (!Array.isArray(doc[key])) {
      errors.push(issue('E_TYPE', key, `${key} が配列ではありません`));
    }
  }
  const optionalArrayKeys = ['stationGroups', 'transfers'];
  for (const key of optionalArrayKeys) {
    if (key in doc && doc[key] !== undefined && !Array.isArray(doc[key])) {
      errors.push(issue('E_TYPE', key, `${key} が配列ではありません`));
    }
  }
  if (doc.transferDefaults !== undefined && !isPlainObject(doc.transferDefaults)) {
    errors.push(issue('E_TYPE', 'transferDefaults', 'transferDefaults がオブジェクトではありません'));
  }
  if (!isPlainObject(doc.meta)) {
    errors.push(issue('E_TYPE', 'meta', 'meta がオブジェクトではありません'));
  }

  const companies = Array.isArray(doc.companies) ? doc.companies : [];
  const vehicleTypes = Array.isArray(doc.vehicleTypes) ? doc.vehicleTypes : [];
  const stations = Array.isArray(doc.stations) ? doc.stations : [];
  const stationGroups = Array.isArray(doc.stationGroups) ? doc.stationGroups : [];
  const transfers = Array.isArray(doc.transfers) ? doc.transfers : [];
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  const services = Array.isArray(doc.services) ? doc.services : [];
  const meta = isPlainObject(doc.meta) ? doc.meta : {};

  // ID 書式・重複
  companies.forEach((c, idx) => c && checkIdFormat(c.id, `companies[${idx}].id`, errors, `会社 ID "${c.id}" の書式が不正です`));
  checkDup(companies, 'id', 'companies', '会社 ID', errors);

  vehicleTypes.forEach((v, idx) => v && checkIdFormat(v.id, `vehicleTypes[${idx}].id`, errors, `車両種別 ID "${v.id}" の書式が不正です`));
  checkDup(vehicleTypes, 'id', 'vehicleTypes', '車両種別 ID', errors);

  stations.forEach((s, idx) => s && checkIdFormat(s.id, `stations[${idx}].id`, errors, `駅 ID "${s.id}" の書式が不正です`));
  checkDup(stations, 'id', 'stations', '駅 ID', errors);

  stationGroups.forEach((g, idx) => g && checkIdFormat(g.id, `stationGroups[${idx}].id`, errors, `駅グループ ID "${g.id}" の書式が不正です`));
  checkDup(stationGroups, 'id', 'stationGroups', '駅グループ ID', errors);

  transfers.forEach((t, idx) => t && checkIdFormat(t.id, `transfers[${idx}].id`, errors, `乗換 ID "${t.id}" の書式が不正です`));
  checkDup(transfers, 'id', 'transfers', '乗換 ID', errors);

  lines.forEach((l, idx) => l && checkIdFormat(l.id, `lines[${idx}].id`, errors, `路線 ID "${l.id}" の書式が不正です`));
  checkDup(lines, 'id', 'lines', '路線 ID', errors);

  services.forEach((sv, idx) => sv && checkIdFormat(sv.id, `services[${idx}].id`, errors, `運行系統 ID "${sv.id}" の書式が不正です`));
  checkDup(services, 'id', 'services', '運行系統 ID', errors);

  // 駅ごとの platforms: 書式・重複
  const stationIds = new Set(stations.map(s => s && s.id));
  const stationById = new Map(stations.map(s => [s && s.id, s]));

  stations.forEach((s, sIdx) => {
    if (!s) return;
    const platforms = Array.isArray(s.platforms) ? s.platforms : [];
    if (!Array.isArray(s.platforms)) {
      errors.push(issue('E_TYPE', `stations[${sIdx}].platforms`, `駅 "${s.id}" の platforms が配列ではありません`));
    }
    platforms.forEach((p, pIdx) => {
      if (!p) return;
      checkIdFormat(p.id, `stations[${sIdx}].platforms[${pIdx}].id`, errors, `駅 "${s.id}" ののりば ID "${p.id}" の書式が不正です`);
    });
    checkDup(platforms, 'id', `stations[${sIdx}].platforms`, `駅 "${s.id}" ののりば ID`, errors);
    // layout は図形式エディタの座標。省略可（undefined / null）
    if (s.layout != null && !(Number.isFinite(s.layout.x) && Number.isFinite(s.layout.y))) {
      errors.push(issue('E_TYPE', `stations[${sIdx}].layout`, `駅 "${s.id}" の layout が { x, y }（数値）の形ではありません`));
    }
  });

  function platformExists(stationId, platformId) {
    const st = stationById.get(stationId);
    if (!st) return false;
    const platforms = Array.isArray(st.platforms) ? st.platforms : [];
    return platforms.some(p => p && p.id === platformId);
  }

  // meta.ownCompanyId
  const companyIds = new Set(companies.map(c => c && c.id));
  if (!meta.ownCompanyId || !companyIds.has(meta.ownCompanyId)) {
    errors.push(issue('E_OWN_COMPANY', 'meta.ownCompanyId', 'meta.ownCompanyId が companies にありません'));
  }

  // stationGroups
  const groupStationSeen = new Map();
  stationGroups.forEach((g, idx) => {
    if (!g) return;
    const path = `stationGroups[${idx}]`;
    const ids = Array.isArray(g.stationIds) ? g.stationIds : [];
    if (ids.length < 2) {
      errors.push(issue('E_GROUP', `${path}.stationIds`, `駅グループ "${g.id}" の駅が2つ未満です`));
    }
    ids.forEach((stId, i) => {
      if (!stationIds.has(stId)) {
        errors.push(issue('E_REF', `${path}.stationIds[${i}]`, `駅グループ "${g.id}" の駅 "${stId}" が stations にありません`));
        return;
      }
      if (groupStationSeen.has(stId)) {
        errors.push(issue('E_GROUP', `${path}.stationIds[${i}]`, `駅 "${stId}" が複数の駅グループに入っています`));
      } else {
        groupStationSeen.set(stId, idx);
      }
    });
  });

  // transfers
  function sameEndpoint(a, b) {
    return a.stationId === b.stationId && a.platformId === b.platformId;
  }
  const seenTransferPairs = [];
  transfers.forEach((t, idx) => {
    if (!t) return;
    const path = `transfers[${idx}]`;
    const from = isPlainObject(t.from) ? t.from : {};
    const to = isPlainObject(t.to) ? t.to : {};
    if (!isPlainObject(t.from) || !isPlainObject(t.to)) {
      errors.push(issue('E_TYPE', path, `乗換 "${t.id}" の from/to がオブジェクトではありません`));
    }
    if (from.stationId != null && !stationIds.has(from.stationId)) {
      errors.push(issue('E_REF', `${path}.from.stationId`, `乗換 "${t.id}" の from.stationId "${from.stationId}" が stations にありません`));
    }
    if (to.stationId != null && !stationIds.has(to.stationId)) {
      errors.push(issue('E_REF', `${path}.to.stationId`, `乗換 "${t.id}" の to.stationId "${to.stationId}" が stations にありません`));
    }
    if (from.platformId != null && stationIds.has(from.stationId) && !platformExists(from.stationId, from.platformId)) {
      errors.push(issue('E_REF', `${path}.from.platformId`, `乗換 "${t.id}" の from.platformId "${from.platformId}" が駅 "${from.stationId}" にありません`));
    }
    if (to.platformId != null && stationIds.has(to.stationId) && !platformExists(to.stationId, to.platformId)) {
      errors.push(issue('E_REF', `${path}.to.platformId`, `乗換 "${t.id}" の to.platformId "${to.platformId}" が駅 "${to.stationId}" にありません`));
    }
    if (sameEndpoint(from, to)) {
      errors.push(issue('E_TRANSFER_SELF', path, `乗換 "${t.id}" の from と to が完全に同じです`));
    }
    if (from.stationId === to.stationId && (from.platformId == null || to.platformId == null) && !sameEndpoint(from, to)) {
      errors.push(issue('E_TRANSFER_INTRA_PLATFORM', path, `乗換 "${t.id}" は同じ駅の中の乗換なのに、のりばが指定されていません`));
    }
    const bidirectional = !!t.bidirectional;
    const dupHit = seenTransferPairs.some(prev => {
      const exactMatch = sameEndpoint(prev.from, from) && sameEndpoint(prev.to, to);
      const reverseMatch = (prev.bidirectional || bidirectional) && sameEndpoint(prev.from, to) && sameEndpoint(prev.to, from);
      return exactMatch || reverseMatch;
    });
    if (dupHit) {
      errors.push(issue('E_TRANSFER_DUP', path, `乗換 "${t.id}" の組み合わせが重複しています`));
    }
    seenTransferPairs.push({ from, to, bidirectional });
  });

  // lines
  const lineById = new Map(lines.map(l => [l && l.id, l]));
  const vehicleTypeIds = new Set(vehicleTypes.map(v => v && v.id));
  lines.forEach((line, idx) => {
    if (!line) return;
    const path = `lines[${idx}]`;
    if (line.companyId != null && !companyIds.has(line.companyId)) {
      errors.push(issue('E_REF', `${path}.companyId`, `路線 "${line.id}" の companyId "${line.companyId}" が companies にありません`));
    }
    if (line.vehicleTypeId != null && !vehicleTypeIds.has(line.vehicleTypeId)) {
      errors.push(issue('E_REF', `${path}.vehicleTypeId`, `路線 "${line.id}" の vehicleTypeId "${line.vehicleTypeId}" が vehicleTypes にありません`));
    }
    const lineStations = Array.isArray(line.stations) ? line.stations : [];
    if (!Array.isArray(line.stations)) {
      errors.push(issue('E_TYPE', `${path}.stations`, `路線 "${line.id}" の stations が配列ではありません`));
    }
    lineStations.forEach((stId, i) => {
      if (!stationIds.has(stId)) {
        errors.push(issue('E_REF', `${path}.stations[${i}]`, `路線 "${line.id}" の駅 "${stId}" が stations にありません`));
      }
    });
    const dupStations = new Set();
    let hasDupStation = false;
    lineStations.forEach(stId => {
      if (dupStations.has(stId)) hasDupStation = true;
      dupStations.add(stId);
    });
    if (hasDupStation) {
      errors.push(issue('E_LINE_STATION_DUP', `${path}.stations`, `路線 "${line.id}" の stations に同じ駅が2回あります`));
    }
    if (lineStations.length < 2) {
      warnings.push(issue('W_LINE_SHORT', `${path}.stations`, `路線 "${line.id}" の駅が2つ未満です`));
    }
    if (line.loop != null) {
      const startIndex = line.loop && line.loop.startIndex;
      if (!isNonNegInt(startIndex) || startIndex > lineStations.length - 1) {
        errors.push(issue('E_LOOP_INDEX', `${path}.loop.startIndex`, `路線 "${line.id}" の loop.startIndex が不正です`));
      }
    }
    const categories = Array.isArray(line.categories) ? line.categories : [];
    if (!Array.isArray(line.categories)) {
      errors.push(issue('E_TYPE', `${path}.categories`, `路線 "${line.id}" の categories が配列ではありません`));
    }
    if (categories.length === 0) {
      errors.push(issue('E_LINE_NO_CATEGORY', `${path}.categories`, `路線 "${line.id}" の categories が空です`));
    }
    categories.forEach((cat, i) => cat && checkIdFormat(cat.id, `${path}.categories[${i}].id`, errors, `路線 "${line.id}" の種別 ID "${cat.id}" の書式が不正です`));
    checkDup(categories, 'id', `${path}.categories`, `路線 "${line.id}" の種別 ID`, errors);
  });

  // services
  const servedLineStations = new Set(); // `${lineId}|${stationId}`
  let inactiveCount = 0;
  services.forEach((sv, idx) => {
    if (!sv) return;
    const path = `services[${idx}]`;
    if (sv.active === false) inactiveCount++;
    const stops = Array.isArray(sv.stops) ? sv.stops : [];
    if (!Array.isArray(sv.stops)) {
      errors.push(issue('E_TYPE', `${path}.stops`, `運行系統 "${sv.id}" の stops が配列ではありません`));
    }
    if (stops.length < 2) {
      errors.push(issue('E_SERVICE_STOPS', `${path}.stops`, `運行系統 "${sv.id}" の stops が2件未満です`));
    }
    stops.forEach((stop, i) => {
      if (!stop) return;
      const stopPath = `${path}.stops[${i}]`;
      if (stop.stationId != null && !stationIds.has(stop.stationId)) {
        errors.push(issue('E_REF', `${stopPath}.stationId`, `運行系統 "${sv.id}" の ${i} 番目の停車駅 "${stop.stationId}" が stations にありません`));
      } else if (stop.platformId != null) {
        if (!platformExists(stop.stationId, stop.platformId)) {
          errors.push(issue('E_STOP_PLATFORM', `${stopPath}.platformId`, `運行系統 "${sv.id}" の ${i} 番目の停車駅ののりば "${stop.platformId}" は駅 "${stop.stationId}" にありません`));
        }
      } else {
        warnings.push(issue('W_STOP_NO_PLATFORM', `${stopPath}.platformId`, `運行系統 "${sv.id}" の ${i} 番目の停車駅ののりばが指定されていません`));
      }
      const isLast = i === stops.length - 1;
      const needsRun = !isLast || sv.circular === true;
      if (needsRun) {
        if (!isNonNegInt(stop.run)) {
          errors.push(issue('E_RUN', `${stopPath}.run`, `運行系統 "${sv.id}" の ${i} 番目の停車駅の run が0以上の整数ではありません`));
        }
      }
    });

    const sections = Array.isArray(sv.sections) ? sv.sections : [];
    if (!Array.isArray(sv.sections)) {
      errors.push(issue('E_TYPE', `${path}.sections`, `運行系統 "${sv.id}" の sections が配列ではありません`));
    }
    let sectionsValid = sections.length > 0;
    if (sectionsValid) {
      if (sections[0] && sections[0].from !== 0) sectionsValid = false;
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (!s || typeof s.from !== 'number' || typeof s.to !== 'number' || s.from >= s.to) {
          sectionsValid = false;
          break;
        }
        if (i < sections.length - 1) {
          const next = sections[i + 1];
          if (!next || s.to !== next.from) {
            sectionsValid = false;
            break;
          }
        } else if (s.to !== stops.length - 1) {
          sectionsValid = false;
        }
      }
    }
    if (!sectionsValid) {
      errors.push(issue('E_SECTIONS', `${path}.sections`, `運行系統 "${sv.id}" の sections が不正です`));
    }
    if (sv.circular === true && sections.length !== 1) {
      errors.push(issue('E_CIRCULAR_SECTIONS', `${path}.sections`, `運行系統 "${sv.id}" は circular なのに sections が1つではありません`));
    }
    sections.forEach((s, i) => {
      if (!s) return;
      const sPath = `${path}.sections[${i}]`;
      const line = lineById.get(s.lineId);
      if (s.lineId == null || !line) {
        errors.push(issue('E_REF', `${sPath}.lineId`, `運行系統 "${sv.id}" の区間 ${i} の lineId "${s.lineId}" が lines にありません`));
        return;
      }
      const categories = Array.isArray(line.categories) ? line.categories : [];
      if (!categories.some(c => c && c.id === s.categoryId)) {
        errors.push(issue('E_SECTION_CATEGORY', `${sPath}.categoryId`, `運行系統 "${sv.id}" の区間 ${i} の categoryId "${s.categoryId}" が路線 "${line.id}" の categories にありません`));
      }
      const lineStations = Array.isArray(line.stations) ? line.stations : [];
      const from = typeof s.from === 'number' ? s.from : -1;
      const to = typeof s.to === 'number' ? s.to : -1;
      let stationsOk = true;
      for (let k = from; k <= to; k++) {
        const stop = stops[k];
        if (!stop || !lineStations.includes(stop.stationId)) {
          stationsOk = false;
        } else {
          servedLineStations.add(`${line.id}|${stop.stationId}`);
        }
      }
      if (!stationsOk) {
        errors.push(issue('E_SECTION_STATION', sPath, `運行系統 "${sv.id}" の区間 ${i} の停車駅が路線 "${line.id}" の stations にありません`));
      }
    });
  });

  if (inactiveCount > 0) {
    warnings.push(issue('W_SERVICE_INACTIVE', 'services', `active:false の運行系統が ${inactiveCount} 件あります`));
  }

  lines.forEach((line, idx) => {
    if (!line) return;
    const lineStations = Array.isArray(line.stations) ? line.stations : [];
    lineStations.forEach(stId => {
      if (!servedLineStations.has(`${line.id}|${stId}`)) {
        warnings.push(issue('W_LINE_STATION_UNSERVED', `lines[${idx}].stations`, `路線 "${line.id}" の駅 "${stId}" に停車する有効な運行系統がありません`));
      }
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function validateOperations(doc, network) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(doc)) {
    errors.push(issue('E_TYPE', '', 'operations ドキュメントがオブジェクトではありません'));
    return { ok: false, errors, warnings };
  }

  if (typeof doc.schemaVersion !== 'string' || !doc.schemaVersion.startsWith('2.')) {
    errors.push(issue('E_SCHEMA_VERSION', 'schemaVersion', 'schemaVersion が "2." で始まっていません'));
  }
  if (doc.kind !== 'operations') {
    errors.push(issue('E_KIND', 'kind', 'kind が "operations" ではありません'));
  }
  if (!Array.isArray(doc.notices)) {
    errors.push(issue('E_TYPE', 'notices', 'notices が配列ではありません'));
  }
  if (!isPlainObject(doc.masters)) {
    errors.push(issue('E_TYPE', 'masters', 'masters がオブジェクトではありません'));
  }

  const notices = Array.isArray(doc.notices) ? doc.notices : [];
  const masters = isPlainObject(doc.masters) ? doc.masters : {};
  const statusTemplates = Array.isArray(masters.statusTemplates) ? masters.statusTemplates : [];
  const causes = Array.isArray(masters.causes) ? masters.causes : [];

  const net = isPlainObject(network) ? network : {};
  const lines = Array.isArray(net.lines) ? net.lines : [];
  const lineById = new Map(lines.map(l => [l && l.id, l]));
  const statusCodes = new Set(statusTemplates.map(t => t && t.code));
  const causeCodes = new Set(causes.map(c => c && c.code));

  notices.forEach((n, idx) => n && checkIdFormat(n.id, `notices[${idx}].id`, errors, `運行情報 ID "${n.id}" の書式が不正です`));
  checkDup(notices, 'id', 'notices', '運行情報 ID', errors);

  function checkRange(range, path, line, noticeId) {
    if (range == null) return; // 全線（環状線・ラケット型でも可）
    if (!isPlainObject(range)) {
      errors.push(issue('E_TYPE', path, `運行情報 "${noticeId}" の range がオブジェクトではありません`));
      return;
    }
    const lineStations = line && Array.isArray(line.stations) ? line.stations : [];
    if (range.fromStationId != null && !lineStations.includes(range.fromStationId)) {
      errors.push(issue('E_NOTICE_RANGE', `${path}.fromStationId`, `運行情報 "${noticeId}" の fromStationId "${range.fromStationId}" が路線の stations にありません`));
    }
    if (range.toStationId != null && !lineStations.includes(range.toStationId)) {
      errors.push(issue('E_NOTICE_RANGE', `${path}.toStationId`, `運行情報 "${noticeId}" の toStationId "${range.toStationId}" が路線の stations にありません`));
    }
  }

  notices.forEach((n, idx) => {
    if (!n) return;
    const path = `notices[${idx}]`;
    if (!['draft', 'published', 'closed'].includes(n.state)) {
      errors.push(issue('E_NOTICE_STATE', `${path}.state`, `運行情報 "${n.id}" の state が draft/published/closed のどれでもありません`));
    }
    const line = lineById.get(n.lineId);
    if (n.lineId == null || !line) {
      errors.push(issue('E_REF', `${path}.lineId`, `運行情報 "${n.id}" の lineId "${n.lineId}" が lines にありません`));
    }
    checkRange(n.range, `${path}.range`, line, n.id);

    if (n.categoryIds != null) {
      if (!Array.isArray(n.categoryIds)) {
        errors.push(issue('E_TYPE', `${path}.categoryIds`, `運行情報 "${n.id}" の categoryIds が配列ではありません`));
      } else {
        const categories = line && Array.isArray(line.categories) ? line.categories : [];
        n.categoryIds.forEach((catId, i) => {
          if (!categories.some(c => c && c.id === catId)) {
            errors.push(issue('E_NOTICE_CATEGORY', `${path}.categoryIds[${i}]`, `運行情報 "${n.id}" の categoryIds "${catId}" が路線の categories にありません`));
          }
        });
      }
    }

    const status = isPlainObject(n.status) ? n.status : {};
    if (!statusCodes.has(status.code) && status.code !== 'notice' && status.code !== 'other') {
      errors.push(issue('E_STATUS_CODE', `${path}.status.code`, `運行情報 "${n.id}" の status.code "${status.code}" が masters にも notice/other にもありません`));
    }

    const cause = isPlainObject(n.cause) ? n.cause : {};
    if (!causeCodes.has(cause.code)) {
      errors.push(issue('E_CAUSE_CODE', `${path}.cause.code`, `運行情報 "${n.id}" の cause.code "${cause.code}" が masters にありません`));
    }
    if (cause.lineId != null && !lineById.has(cause.lineId)) {
      errors.push(issue('E_REF', `${path}.cause.lineId`, `運行情報 "${n.id}" の cause.lineId "${cause.lineId}" が lines にありません`));
    }
    if (cause.range != null) {
      checkRange(cause.range, `${path}.cause.range`, lineById.get(cause.lineId) || line, n.id);
    }

    const occurrence = isPlainObject(n.occurrence) ? n.occurrence : {};
    if (n.state !== 'draft' && (occurrence.month == null || occurrence.day == null)) {
      errors.push(issue('E_OCCURRENCE', `${path}.occurrence`, `運行情報 "${n.id}" は draft 以外なのに occurrence の月か日がありません`));
    }

    const throughServices = Array.isArray(n.throughServices) ? n.throughServices : [];
    throughServices.forEach((ts, i) => {
      if (!ts) return;
      if (ts.lineId == null || ts.lineId === n.lineId) {
        errors.push(issue('E_THROUGH_LINE', `${path}.throughServices[${i}].lineId`, `運行情報 "${n.id}" の throughServices[${i}].lineId が不正です（影響路線と同じか、指定がありません）`));
      } else if (!lineById.has(ts.lineId)) {
        errors.push(issue('E_REF', `${path}.throughServices[${i}].lineId`, `運行情報 "${n.id}" の throughServices[${i}].lineId "${ts.lineId}" が lines にありません`));
      }
    });

    const directions = isPlainObject(n.directions) ? n.directions : {};
    if (!directions.forward && !directions.backward) {
      warnings.push(issue('W_NOTICE_DIRECTIONS', `${path}.directions`, `運行情報 "${n.id}" の directions がどちら向きも false です`));
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}
