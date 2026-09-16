// editor2 のタブから、network/operations の中身を削除する前に参照箇所を探す。
// DOM に依存しないため node --test でも読み込める。

export function findReferences(network, operations, target) {
  switch (target.type) {
    case 'company':
      return findCompanyReferences(network, target.id);
    case 'station':
      return findStationReferences(network, operations, target.id);
    case 'platform':
      return findPlatformReferences(network, target.stationId, target.id);
    case 'line':
      return findLineReferences(network, operations, target.id);
    case 'category':
      return findCategoryReferences(network, operations, target.lineId, target.id);
    default:
      return [];
  }
}

function findCompanyReferences(network, companyId) {
  const refs = [];
  (network.lines || []).forEach((line) => {
    if (line.companyId === companyId) {
      refs.push({ kind: 'line', id: line.id, label: `路線「${line.name}」` });
    }
  });
  return refs;
}

function findStationReferences(network, operations, stationId) {
  const refs = [];

  (network.lines || []).forEach((line) => {
    if ((line.stations || []).includes(stationId)) {
      refs.push({ kind: 'line', id: line.id, label: `路線「${line.name}」の駅順` });
    }
  });

  (network.services || []).forEach((service) => {
    if ((service.stops || []).some((s) => s.stationId === stationId)) {
      refs.push({ kind: 'service', id: service.id, label: `運行系統「${service.headsign || service.id}」の停車駅` });
    }
  });

  (network.transfers || []).forEach((transfer) => {
    if (transfer.from.stationId === stationId || transfer.to.stationId === stationId) {
      refs.push({ kind: 'transfer', id: transfer.id, label: '乗換設定' });
    }
  });

  (network.stationGroups || []).forEach((group) => {
    if ((group.stationIds || []).includes(stationId)) {
      refs.push({ kind: 'stationGroup', id: group.id, label: `駅グループ「${group.name}」` });
    }
  });

  if (operations) {
    (operations.notices || []).forEach((notice) => {
      const range = notice.range;
      if (range && (range.fromStationId === stationId || range.toStationId === stationId)) {
        refs.push({ kind: 'notice', id: notice.id, label: '運行情報の範囲' });
      }
    });
  }

  return refs;
}

function findPlatformReferences(network, stationId, platformId) {
  const refs = [];

  (network.services || []).forEach((service) => {
    if ((service.stops || []).some((s) => s.stationId === stationId && s.platformId === platformId)) {
      refs.push({ kind: 'service', id: service.id, label: `運行系統「${service.headsign || service.id}」の停車駅` });
    }
  });

  (network.transfers || []).forEach((transfer) => {
    const fromMatch = transfer.from.stationId === stationId && transfer.from.platformId === platformId;
    const toMatch = transfer.to.stationId === stationId && transfer.to.platformId === platformId;
    if (fromMatch || toMatch) {
      refs.push({ kind: 'transfer', id: transfer.id, label: '乗換設定' });
    }
  });

  return refs;
}

function findLineReferences(network, operations, lineId) {
  const refs = [];

  (network.services || []).forEach((service) => {
    if ((service.sections || []).some((sec) => sec.lineId === lineId)) {
      refs.push({ kind: 'service', id: service.id, label: `運行系統「${service.headsign || service.id}」の区間` });
    }
  });

  if (operations) {
    (operations.notices || []).forEach((notice) => {
      if (notice.lineId === lineId) {
        refs.push({ kind: 'notice', id: notice.id, label: '運行情報の対象路線' });
      }
      if ((notice.throughServices || []).some((ts) => ts.lineId === lineId)) {
        refs.push({ kind: 'notice', id: notice.id, label: '運行情報の直通表示先' });
      }
    });
  }

  return refs;
}

function findCategoryReferences(network, operations, lineId, categoryId) {
  const refs = [];

  (network.services || []).forEach((service) => {
    if ((service.sections || []).some((sec) => sec.lineId === lineId && sec.categoryId === categoryId)) {
      refs.push({ kind: 'service', id: service.id, label: `運行系統「${service.headsign || service.id}」の区間` });
    }
  });

  if (operations) {
    (operations.notices || []).forEach((notice) => {
      if (notice.lineId === lineId && Array.isArray(notice.categoryIds) && notice.categoryIds.includes(categoryId)) {
        refs.push({ kind: 'notice', id: notice.id, label: '運行情報の対象種別' });
      }
    });
  }

  return refs;
}
