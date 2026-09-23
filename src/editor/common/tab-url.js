// タブの状態をURLのクエリパラメータ（?tab=...）に反映する。
// これにより、ブラウザの戻る/進むでタブが切り替わったり、URLを共有・再読み込みしても
// 同じタブが開いた状態になる。

const PARAM = 'tab';

// URLの ?tab=... を読む。validIdsに含まれない・指定がない場合はfallbackを返す
export function getTabFromUrl(validIds, fallback) {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get(PARAM);
  return validIds.includes(tab) ? tab : fallback;
}

// URLの ?tab=... を書き換える。pushによって履歴に1件積むかどうかを選べる
// （タブクリック時はpush、初回読み込み時の補完はreplaceで履歴を汚さない）
export function setTabInUrl(tabId, { push = true } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, tabId);
  if (push) {
    history.pushState({ tab: tabId }, '', url);
  } else {
    history.replaceState({ tab: tabId }, '', url);
  }
}

// ブラウザの戻る/進むでURLの ?tab=... が変わったときに呼ばれる。
// 有効なタブIDのときだけ handler(tabId) を呼ぶ
export function onTabPopState(validIds, handler) {
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get(PARAM);
    if (validIds.includes(tab)) handler(tab);
  });
}
