// 駅タブの編集ロジック。DOM を使わない。02-editor-ui-spec.md 11章、17章。

import { isValidId } from '../shared/ids.js';

export function createStation(id, name, kana) {
  return { id, name, kana: kana || '', platforms: [], location: null };
}

export function updateStation(station, patch) {
  const draft = structuredClone(station);
  if ('name' in patch) draft.name = patch.name;
  if ('kana' in patch) draft.kana = patch.kana;
  return draft;
}

export function addPlatform(station, platform) {
  const draft = structuredClone(station);
  draft.platforms.push({ id: platform.id, label: platform.label });
  return draft;
}

export function renamePlatform(station, platformId, label) {
  const draft = structuredClone(station);
  const platform = draft.platforms.find((p) => p.id === platformId);
  if (platform) platform.label = label;
  return draft;
}

export function movePlatform(station, from, to) {
  const draft = structuredClone(station);
  const [moved] = draft.platforms.splice(from, 1);
  draft.platforms.splice(to, 0, moved);
  return draft;
}

export function removePlatform(station, platformId) {
  const draft = structuredClone(station);
  draft.platforms = draft.platforms.filter((p) => p.id !== platformId);
  return draft;
}

export function validateStationDraft(network, station, isNew) {
  if (isNew) {
    if (!isValidId(station.id)) return '駅IDの書式が不正です（英数字・_・- のみ、1〜64文字）。';
    if ((network.stations || []).some((s) => s.id === station.id)) return '同じIDの駅が既にあります。';
  }
  if (!station.name || !station.name.trim()) return '駅名を入力してください。';

  const seen = new Set();
  for (const platform of station.platforms || []) {
    if (!isValidId(platform.id)) return `のりばID「${platform.id}」の書式が不正です。`;
    if (seen.has(platform.id)) return `のりばID「${platform.id}」が重複しています。`;
    seen.add(platform.id);
  }
  return null;
}

export function validatePlatformDraft(existingPlatforms, platform) {
  if (!isValidId(platform.id)) return 'のりばIDの書式が不正です（英数字・_・- のみ、1〜64文字）。';
  if ((existingPlatforms || []).some((p) => p.id === platform.id)) return '同じIDののりばが既にあります。';
  if (!platform.label || !platform.label.trim()) return '表示名を入力してください。';
  return null;
}
