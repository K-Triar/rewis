// 乗換の編集ロジック。DOM を使わない。02-editor-ui-spec.md 14章、17章。

import { newId } from '../../shared/ids.js';

export function createTransfer({ from, to, seconds, bidirectional, note }) {
  return {
    id: newId('tr'),
    from: { stationId: from.stationId, platformId: from.platformId ?? null },
    to: { stationId: to.stationId, platformId: to.platformId ?? null },
    seconds,
    bidirectional: !!bidirectional,
    note: note || ''
  };
}

export function updateTransfer(transfer, patch) {
  const draft = structuredClone(transfer);
  if ('from' in patch) draft.from = { ...draft.from, ...patch.from };
  if ('to' in patch) draft.to = { ...draft.to, ...patch.to };
  if ('seconds' in patch) draft.seconds = patch.seconds;
  if ('bidirectional' in patch) draft.bidirectional = patch.bidirectional;
  if ('note' in patch) draft.note = patch.note;
  return draft;
}

export function swapTransferDirection(transfer) {
  const draft = structuredClone(transfer);
  const from = draft.from;
  draft.from = draft.to;
  draft.to = from;
  return draft;
}

export function transferKind(transfer) {
  return transfer.from.stationId === transfer.to.stationId ? 'intra' : 'walk';
}

function sameEndpoint(a, b) {
  return a.stationId === b.stationId && (a.platformId ?? null) === (b.platformId ?? null);
}

export function lookupIntraTransfer(network, stationId, fromPlatformId, toPlatformId) {
  const from = { stationId, platformId: fromPlatformId ?? null };
  const to = { stationId, platformId: toPlatformId ?? null };
  for (const transfer of network.transfers || []) {
    if (sameEndpoint(transfer.from, from) && sameEndpoint(transfer.to, to)) {
      return { transfer, reversed: false };
    }
    if (sameEndpoint(transfer.from, to) && sameEndpoint(transfer.to, from)) {
      return { transfer, reversed: true };
    }
  }
  return null;
}

export function validateTransferDraft(network, transfer, { excludeId } = {}) {
  const seconds = transfer.seconds;
  if (!Number.isInteger(seconds) || seconds < 0) {
    return '秒数は0以上の整数で入力してください。';
  }
  const sameStation = transfer.from.stationId === transfer.to.stationId;
  if (sameStation && (transfer.from.platformId == null || transfer.to.platformId == null)) {
    return '同じ駅の中の乗換では、両方ののりばを指定してください。';
  }
  if (sameStation && transfer.from.platformId === transfer.to.platformId) {
    return '同じのりば同士の乗換は登録できません。';
  }

  const bidirectional = !!transfer.bidirectional;
  const dup = (network.transfers || []).some((other) => {
    if (excludeId && other.id === excludeId) return false;
    const exactMatch = sameEndpoint(other.from, transfer.from) && sameEndpoint(other.to, transfer.to);
    const reverseMatch = (!!other.bidirectional || bidirectional) &&
      sameEndpoint(other.from, transfer.to) && sameEndpoint(other.to, transfer.from);
    return exactMatch || reverseMatch;
  });
  if (dup) {
    return '同じ組み合わせの乗換がすでに登録されています。';
  }

  return null;
}
