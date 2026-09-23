function getLineById(network, id) {
  return (network.lines || []).find(l => l.id === id) || null;
}

function getLineName(network, id) {
  const line = getLineById(network, id);
  return line ? (line.name || '') : '';
}

function getStationName(network, id) {
  if (!id) return '';
  const s = (network.stations || []).find(x => x.id === id);
  return s ? (s.name || '') : '';
}

function getStatusTemplate(masters, code) {
  return (masters.statusTemplates || []).find(t => t.code === code) || null;
}

function getCauseTemplate(masters, code) {
  return (masters.causes || []).find(c => c.code === code) || null;
}

function getStatusLabel(masters, code) {
  if (!code) return '';
  if (code === 'notice') return 'お知らせ';
  if (code === 'other') return 'その他';
  const tpl = getStatusTemplate(masters, code);
  return tpl ? (tpl.label || tpl.heading || tpl.code || code) : code;
}

function getCategoryLabel(network, lineId, categoryId) {
  const line = getLineById(network, lineId);
  const cat = line && Array.isArray(line.categories) ? line.categories.find(c => c.id === categoryId) : null;
  return cat ? (cat.name || cat.id) : categoryId;
}

function joinWithAnd(items) {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]}および${items[1]}`;
  return `${items.slice(0, -1).join('、')}、および${items[items.length - 1]}`;
}

function buildNoticeTypeList(notice, network) {
  if (!notice || notice.categoryIds == null) return '';
  const labels = (notice.categoryIds || []).map(id => getCategoryLabel(network, notice.lineId, id)).filter(Boolean);
  if (!labels.length) return '';
  return `${joinWithAnd(labels)}列車が`;
}

function buildSegmentText(notice, network, lineName) {
  if (!notice || notice.range == null) return '';
  const startName = getStationName(network, notice.range.fromStationId) || '';
  const endName = getStationName(network, notice.range.toStationId) || '';
  if (startName && endName) return `${startName}駅～${endName}駅間`;
  return `${lineName || ''}内`;
}

function buildDirectionText(notice, network) {
  const directions = notice && notice.directions;
  if (!directions || (!directions.forward && !directions.backward)) return '';
  if (directions.forward && directions.backward) return '';
  const line = getLineById(network, notice.lineId);
  const dirNames = (line && line.directions) || { forward: '下り線', backward: '上り線' };
  if (directions.backward) return `${dirNames.backward}で`;
  if (directions.forward) return `${dirNames.forward}で`;
  return '';
}

function buildTurnbackText(notice, network) {
  if (!notice) return '';
  let startId;
  let endId;
  if (notice.range == null) {
    const line = getLineById(network, notice.lineId);
    const stations = (line && line.stations) || [];
    startId = stations[0];
    endId = stations[stations.length - 1];
  } else {
    startId = notice.range.fromStationId;
    endId = notice.range.toStationId;
  }
  const startName = getStationName(network, startId) || '';
  const endName = getStationName(network, endId) || '';
  const start = notice.turnback && notice.turnback.start;
  const end = notice.turnback && notice.turnback.end;
  if (start && end && startName && endName) {
    return `${startName}駅および${endName}駅で折り返し運転を行っています。`;
  }
  if (start && startName) return `${startName}駅で折り返し運転を行っています。`;
  if (end && endName) return `${endName}駅で折り返し運転を行っています。`;
  return '';
}

function buildOccurrenceText(occ) {
  if (!occ || !occ.month || !occ.day) return '';
  if (occ.hour !== null && occ.hour !== undefined && occ.minute !== null && occ.minute !== undefined) {
    return `${occ.month}月${occ.day}日${occ.hour}時${String(occ.minute).padStart(2, '0')}分ごろ、`;
  }
  return `${occ.month}月${occ.day}日、`;
}

function buildCauseText(notice, network, masters) {
  const cause = notice.cause || {};
  const config = getCauseTemplate(masters, cause.code);
  const body = cause.body || (config && config.body) || '';
  if (!body) return '';
  if (cause.lineOption === 'hidden') {
    return `${body}、`;
  }
  let lineName = '';
  if (cause.lineOption === 'line') {
    lineName = getLineName(network, cause.lineId) || cause.lineId || '';
  } else {
    lineName = getLineName(network, notice.lineId) || notice.lineId || '';
  }
  if (!lineName) lineName = '当該路線';
  const startName = getStationName(network, cause.range && cause.range.fromStationId) || '';
  const endName = getStationName(network, cause.range && cause.range.toStationId) || '';
  if (startName && endName) {
    return `${lineName}：${startName}駅～${endName}駅間で${body}、`;
  }
  if (startName) {
    return `${lineName}：${startName}駅で${body}、`;
  }
  return `${lineName}で${body}、`;
}

function buildThroughFragments(items, network) {
  const order = ['mutual', 'affected_to_through', 'through_to_affected'];
  const grouped = new Map();
  items.forEach(ts => {
    const key = ts.target || 'mutual';
    const label = getLineName(network, ts.lineId) || ts.lineId || '';
    if (!label) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(label);
  });
  const fragments = [];
  const appendFragment = (key, names) => {
    if (!names || !names.length) return;
    const joined = joinWithAnd(names);
    if (!joined) return;
    if (key === 'mutual') {
      fragments.push(`${joined}との直通運転`);
    } else if (key === 'affected_to_through') {
      fragments.push(`${joined}への直通運転`);
    } else if (key === 'through_to_affected') {
      fragments.push(`${joined}からの直通運転`);
    } else {
      fragments.push(`${joined}との直通運転`);
    }
  };
  order.forEach(key => appendFragment(key, grouped.get(key)));
  grouped.forEach((names, key) => {
    if (!order.includes(key)) {
      appendFragment(key, names);
    }
  });
  return fragments;
}

function formatThroughStateSentence(items, network, verb) {
  if (!items || !items.length) return '';
  const fragments = buildThroughFragments(items, network);
  if (!fragments.length) return '';
  return `${fragments.join('、')}を${verb}。`;
}

function buildThroughServicesText(notice, network, isDss) {
  const list = Array.isArray(notice.throughServices) ? notice.throughServices : [];
  const suspended = list.filter(ts => ts.state === 'suspended');
  const resumed = list.filter(ts => ts.state === 'resumed');
  const sentences = [];
  const suspendedSentence = formatThroughStateSentence(suspended, network, '中止しています');
  if (suspendedSentence) {
    sentences.push(suspendedSentence);
  } else if (isDss) {
    sentences.push('直通運転を中止しています。');
  }
  if (!isDss) {
    const resumedSentence = formatThroughStateSentence(resumed, network, '再開しました');
    if (resumedSentence) {
      sentences.push(resumedSentence);
    }
  }
  return sentences.join('');
}

export function generateNoticeText(notice, network, masters) {
  if (notice.text && notice.text.mode === 'custom') {
    const custom = notice.text.custom || '';
    const idx = custom.indexOf('\n');
    if (idx === -1) return { heading: custom, body: '' };
    return { heading: custom.slice(0, idx), body: custom.slice(idx + 1) };
  }

  const lineName = getLineName(network, notice.lineId) || notice.lineId || '';
  const causeHeading = (notice.cause && notice.cause.heading) || (getCauseTemplate(masters, notice.cause && notice.cause.code) || {}).heading || '';
  const statusTemplate = getStatusTemplate(masters, notice.status && notice.status.code);
  const statusHeading = (notice.status && notice.status.heading) || getStatusLabel(masters, notice.status && notice.status.code);
  const heading = `【${lineName}】${causeHeading ? `${causeHeading}　` : ''}${statusHeading}`;

  const occurrence = buildOccurrenceText(notice.occurrence);
  const causeText = buildCauseText(notice, network, masters);
  const isDss = !!(statusTemplate && statusTemplate.statusId === 'DSS');

  let body = '';
  if (isDss) {
    body = buildThroughServicesText(notice, network, true);
  } else {
    const subject = buildNoticeTypeList(notice, network);
    const segment = buildSegmentText(notice, network, lineName);
    const direction = buildDirectionText(notice, network);
    const bothDirectionsSelected = !!(notice.directions && notice.directions.forward && notice.directions.backward);
    const statusBody = (notice.status && notice.status.body) || '';
    const fallbackBody = statusHeading || '影響が発生しています';
    const trimmedBodyRaw = statusBody.endsWith('。') ? statusBody.slice(0, -1) : statusBody;
    const trimmedBody = trimmedBodyRaw || fallbackBody;
    let prefix = '';
    if (subject) prefix += subject;
    if (segment) prefix += bothDirectionsSelected ? `${segment}で` : `${segment}の`;
    if (direction) prefix += direction;
    if (prefix) {
      body = `${prefix}${trimmedBody}。`;
    } else {
      body = `${trimmedBody}。`;
    }
  }

  const turnback = buildTurnbackText(notice, network);
  const through = isDss ? '' : buildThroughServicesText(notice, network, false);
  const composed = `${occurrence}${causeText}${body}${turnback}${through}`.replace(/\s+/g, ' ').trim();

  return { heading: heading.trim(), body: composed };
}
