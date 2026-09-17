const STORAGE_KEY = 'rewis_editor_graph_layout';

function readRaw() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.stations !== 'object' || parsed.stations === null) return {};
    return parsed.stations;
  } catch {
    return {};
  }
}

function writeRaw(stations) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, stations }));
  } catch {
    // ストレージが使えない環境では、保存をあきらめる
  }
}

export function loadSaved() {
  return readRaw();
}

export function savePosition(id, pos) {
  const stations = readRaw();
  stations[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  writeRaw(stations);
}

export function removePosition(id) {
  const stations = readRaw();
  delete stations[id];
  writeRaw(stations);
}

export function clearAll() {
  writeRaw({});
}

export function exportJson() {
  return JSON.stringify({ version: 1, stations: readRaw() }, null, 2);
}

export function importJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'ファイルの形式が正しくありません（JSON として読み込めません）。' };
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.stations !== 'object' || parsed.stations === null) {
    return { ok: false, message: 'ファイルの形式が正しくありません（stations がありません）。' };
  }

  const current = readRaw();
  let count = 0;
  Object.entries(parsed.stations).forEach(([id, pos]) => {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
    current[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    count += 1;
  });
  writeRaw(current);
  return { ok: true, message: `${count} 件の駅の配置を読み込みました。` };
}
