const REQUIRED_ARRAY_KEYS = [
  'companies',
  'trainTypes',
  'lines',
  'stations',
  'segments',
  'throughServiceConfigs',
  'platformTransfers',
];

const OPTIONAL_ARRAY_KEYS = [
  'serviceStatuses',
  'statusTemplates',
  'serviceStatusCauses',
  'noticeTypes',
];

export const LARGE_DROP_RATIO = 0.3;

function issue(code, path, message) {
  return { code, path, message };
}

function isFiniteNonNegative(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

export function validateV1(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push(issue('V1_TYPE', 'data', 'data がオブジェクトではありません'));
    return { ok: false, errors, warnings };
  }

  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(data[key])) {
      errors.push(issue('V1_TYPE', `data.${key}`, `data.${key} が配列ではありません`));
    }
  }
  for (const key of OPTIONAL_ARRAY_KEYS) {
    if (key in data && data[key] !== undefined && !Array.isArray(data[key])) {
      errors.push(issue('V1_TYPE', `data.${key}`, `data.${key} が配列ではありません`));
    }
  }

  // 以降の検証は、対象の配列が存在する前提で行う。型エラーがある配列は空扱いにする。
  const companies = Array.isArray(data.companies) ? data.companies : [];
  const trainTypes = Array.isArray(data.trainTypes) ? data.trainTypes : [];
  const lines = Array.isArray(data.lines) ? data.lines : [];
  const stations = Array.isArray(data.stations) ? data.stations : [];
  const segments = Array.isArray(data.segments) ? data.segments : [];
  const throughServiceConfigs = Array.isArray(data.throughServiceConfigs) ? data.throughServiceConfigs : [];
  const platformTransfers = Array.isArray(data.platformTransfers) ? data.platformTransfers : [];
  const serviceStatuses = Array.isArray(data.serviceStatuses) ? data.serviceStatuses : [];

  // V1_META
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const companyIds = new Set(companies.map(c => c && c.companyId));
  if (!meta.ownCompanyId || !companyIds.has(meta.ownCompanyId)) {
    errors.push(issue('V1_META', 'data.meta.ownCompanyId', 'meta.ownCompanyId がないか、companies に存在しません'));
  }

  // V1_DUP_ID
  function checkDup(list, getId, pathPrefix, label) {
    const seen = new Map();
    list.forEach((item, idx) => {
      const id = item && item[getId];
      if (id === undefined || id === null || id === '') return;
      if (seen.has(id)) {
        errors.push(issue('V1_DUP_ID', `${pathPrefix}[${idx}].${getId}`, `${label} "${id}" が重複しています`));
      } else {
        seen.set(id, idx);
      }
    });
  }
  checkDup(companies, 'companyId', 'data.companies', 'companyId');
  checkDup(trainTypes, 'trainTypeId', 'data.trainTypes', 'trainTypeId');
  checkDup(lines, 'lineId', 'data.lines', 'lineId');
  checkDup(stations, 'stationId', 'data.stations', 'stationId');
  checkDup(segments, 'segmentId', 'data.segments', 'segmentId');
  checkDup(throughServiceConfigs, 'configId', 'data.throughServiceConfigs', 'configId');
  checkDup(platformTransfers, 'transferId', 'data.platformTransfers', 'transferId');
  checkDup(serviceStatuses, 'id', 'data.serviceStatuses', 'serviceStatuses[].id');

  // V1_REF
  const stationIds = new Set(stations.map(s => s && s.stationId));
  const lineIds = new Set(lines.map(l => l && l.lineId));
  const lineMap = new Map(lines.map(l => [l && l.lineId, l]));

  lines.forEach((line, idx) => {
    if (!line) return;
    const path = `data.lines[${idx}]`;
    if (line.companyId != null && !companyIds.has(line.companyId)) {
      errors.push(issue('V1_REF', `${path}.companyId`, `路線 "${line.lineId}" の companyId "${line.companyId}" が companies にありません`));
    }
    if (line.trainType != null && !trainTypes.some(t => t && t.trainTypeId === line.trainType)) {
      errors.push(issue('V1_REF', `${path}.trainType`, `路線 "${line.lineId}" の trainType "${line.trainType}" が trainTypes にありません`));
    }
    (line.stationOrder || []).forEach((stId, i) => {
      if (!stationIds.has(stId)) {
        errors.push(issue('V1_REF', `${path}.stationOrder[${i}]`, `路線 "${line.lineId}" の駅 "${stId}" が stations にありません`));
      }
    });
  });

  segments.forEach((seg, idx) => {
    if (!seg) return;
    const path = `data.segments[${idx}]`;
    const line = lineMap.get(seg.lineId);
    if (seg.lineId == null || !line) {
      errors.push(issue('V1_REF', `${path}.lineId`, `区間 "${seg.segmentId}" の lineId "${seg.lineId}" が lines にありません`));
    }
    if (seg.fromStationId != null && !stationIds.has(seg.fromStationId)) {
      errors.push(issue('V1_REF', `${path}.fromStationId`, `区間 "${seg.segmentId}" の fromStationId "${seg.fromStationId}" が stations にありません`));
    }
    if (seg.toStationId != null && !stationIds.has(seg.toStationId)) {
      errors.push(issue('V1_REF', `${path}.toStationId`, `区間 "${seg.segmentId}" の toStationId "${seg.toStationId}" が stations にありません`));
    }
    if (line && seg.guidance != null) {
      const labels = (line.serviceCategories || []).map(c => c[1]);
      if (!labels.includes(seg.guidance)) {
        errors.push(issue('V1_REF', `${path}.guidance`, `区間 "${seg.segmentId}" の guidance "${seg.guidance}" が路線 "${seg.lineId}" の serviceCategories にありません`));
      }
    }
  });

  throughServiceConfigs.forEach((cfg, idx) => {
    if (!cfg) return;
    const path = `data.throughServiceConfigs[${idx}]`;
    const fromLine = lineMap.get(cfg.fromLineId);
    const toLine = lineMap.get(cfg.toLineId);
    if (cfg.fromLineId == null || !fromLine) {
      errors.push(issue('V1_REF', `${path}.fromLineId`, `直通設定 "${cfg.configId}" の fromLineId "${cfg.fromLineId}" が lines にありません`));
    }
    if (cfg.toLineId == null || !toLine) {
      errors.push(issue('V1_REF', `${path}.toLineId`, `直通設定 "${cfg.configId}" の toLineId "${cfg.toLineId}" が lines にありません`));
    }
    if (fromLine && cfg.fromGuidance != null) {
      const labels = (fromLine.serviceCategories || []).map(c => c[1]);
      if (!labels.includes(cfg.fromGuidance)) {
        errors.push(issue('V1_REF', `${path}.fromGuidance`, `直通設定 "${cfg.configId}" の fromGuidance "${cfg.fromGuidance}" が路線 "${cfg.fromLineId}" の serviceCategories にありません`));
      }
    }
    if (toLine && cfg.toGuidance != null) {
      const labels = (toLine.serviceCategories || []).map(c => c[1]);
      if (!labels.includes(cfg.toGuidance)) {
        errors.push(issue('V1_REF', `${path}.toGuidance`, `直通設定 "${cfg.configId}" の toGuidance "${cfg.toGuidance}" が路線 "${cfg.toLineId}" の serviceCategories にありません`));
      }
    }
  });

  platformTransfers.forEach((tr, idx) => {
    if (!tr) return;
    const path = `data.platformTransfers[${idx}]`;
    if (tr.stationId != null && !stationIds.has(tr.stationId)) {
      errors.push(issue('V1_REF', `${path}.stationId`, `乗換 "${tr.transferId}" の stationId "${tr.stationId}" が stations にありません`));
    }
  });

  serviceStatuses.forEach((st, idx) => {
    if (!st) return;
    const path = `data.serviceStatuses[${idx}]`;
    if (st.affected_line_id != null && st.affected_line_id !== '' && !lineIds.has(st.affected_line_id)) {
      errors.push(issue('V1_REF', `${path}.affected_line_id`, `運行情報 "${st.id}" の affected_line_id "${st.affected_line_id}" が lines にありません`));
    }
  });

  // V1_DURATION
  segments.forEach((seg, idx) => {
    if (!seg) return;
    if (!isFiniteNonNegative(seg.duration)) {
      errors.push(issue('V1_DURATION', `data.segments[${idx}].duration`, `区間 "${seg.segmentId}" の duration が0以上の有限な数ではありません`));
    }
  });
  platformTransfers.forEach((tr, idx) => {
    if (!tr) return;
    if (!isFiniteNonNegative(tr.transferTime)) {
      errors.push(issue('V1_DURATION', `data.platformTransfers[${idx}].transferTime`, `乗換 "${tr.transferId}" の transferTime が0以上の有限な数ではありません`));
    }
  });

  // warnings: V1_EMPTY_PLATFORM
  segments.forEach((seg, idx) => {
    if (!seg) return;
    const platforms = seg.platforms;
    const empty = !platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0;
    if (empty) {
      warnings.push(issue('V1_EMPTY_PLATFORM', `data.segments[${idx}].platforms`, `区間 "${seg.segmentId}" ののりばが空です`));
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

export function compareCounts(before, after) {
  const keys = ['companies', 'lines', 'stations', 'segments', 'throughServiceConfigs', 'platformTransfers', 'serviceStatuses'];
  return keys.map(key => {
    const beforeCount = Array.isArray(before?.[key]) ? before[key].length : 0;
    const afterCount = Array.isArray(after?.[key]) ? after[key].length : 0;
    const dropRatio = beforeCount === 0 ? 0 : (beforeCount - afterCount) / beforeCount;
    return { key, before: beforeCount, after: afterCount, dropRatio };
  });
}
