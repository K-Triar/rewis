// ========================================
// グローバル変数
// ========================================
import { loadPublicModel } from '../shared/data-source.js';
import { buildSearchGraph, searchRoutes } from '../shared/route-search.js';
import {
    showShareDialog,
    setupBottomSheet,
    setupHelpModal,
    setupNoopLinks,
    showLoading,
    hideLoading,
    showError,
    hideError,
} from '../shared/ui-dom.js';

let model = null;
let groupMatesByStation = new Map();
// 絞り込み条件ごとに検索グラフを使い回すキャッシュ（3-2 仕様）
const graphCache = new Map();
let viaStationCount = 0;
// Unique counter for DOM element ids of via inputs. This is separate from the
// displayed sequential index which is computed from the visible items.
let viaUniqueIdCounter = 0;
let brandName = 'Kトライア交通グループ';
let ownCompanyId = 'KT';
// 検索モード: 'time' | 'balance' | 'transfer' (default: balance)
let searchMode = 'balance';

function getTransferPenalty(mode) {
    switch (mode) {
        case 'time':
            return 0;
        case 'transfer':
            return 30;
        case 'balance':
        default:
            return 10;
    }
}

(async () => {
    try {
        showLoading();
        console.log('データ読み込み開始...');
        const loaded = await loadPublicModel({});
        model = loaded.model;
        console.log('データ読み込み完了:', model ? 'OK' : 'NG');
        console.log('駅数:', model?.network?.stations?.length || 0);

        // ブランド名・自社線ID取得
        const meta = model && model.network ? model.network.meta : null;
        if (meta) {
            if (meta.appName) {
                brandName = meta.appName.replace(/乗換案内システム$/, '').trim();
            }
            if (meta.ownCompanyId) {
                ownCompanyId = meta.ownCompanyId;
            }
        }
        groupMatesByStation = buildGroupMates(model.network);

        console.log('UI初期化開始...');
        initializeUI();
        console.log('UI初期化完了');
        hideLoading();

        // URLパラメータがあれば自動検索を実行
        loadFromUrlParams();
    } catch (error) {
        console.error('初期化エラー:', error);
        showError('データの読み込みに失敗しました: ' + error.message);
    }
})();

// ========================================
// 駅グループ（別々の駅名でも同じ場所として案内する）
// ========================================
function buildGroupMates(network) {
    const map = new Map();
    const stationsById = new Map((network.stations || []).map(s => [s.id, s]));
    (network.stationGroups || []).forEach(group => {
        const ids = group.stationIds || [];
        ids.forEach(id => {
            const others = ids
                .filter(otherId => otherId !== id)
                .map(otherId => stationsById.get(otherId))
                .filter(Boolean)
                .map(s => s.name);
            if (others.length > 0) map.set(id, others);
        });
    });
    return map;
}

// ========================================
// UI初期化
// ========================================
function initializeUI() {
    setupStationInput('departure');
    setupStationInput('arrival');
    setupSearchModeToggle();
    const swapBtnEl = document.getElementById('swap-stations');
    if (swapBtnEl) {
        swapBtnEl.addEventListener('click', swapStations);
        swapBtnEl.addEventListener('click', () => {
            swapBtnEl.classList.remove('is-spinning');
            void swapBtnEl.offsetWidth; // force reflow to restart animation
            swapBtnEl.classList.add('is-spinning');
        });
        swapBtnEl.addEventListener('animationend', () => {
            swapBtnEl.classList.remove('is-spinning');
        });
    }
    document.getElementById('add-via').addEventListener('click', addViaStation);
    document.getElementById('search-button').addEventListener('click', performSearch);

    ['departure', 'arrival'].forEach(id => {
        document.getElementById(id).addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    });

    // Adaptive search-section sizing removed: stable mobile layout only.
    // Formerly `setupSearchSectionSizing()` toggled `body.search-compact` based
    // on the measured `.search-section` height; that height-dependent switching
    // caused instability on some mobile devices and has been removed.
}

// 検索モードUIの初期化
function setupSearchModeToggle() {
    const container = document.getElementById('search-mode-toggle');
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('.segmented-btn'));

    function setMode(mode) {
        searchMode = mode;

        // 選択されたボタンの位置と幅を取得
        let selectedBtn = null;
        buttons.forEach((btn, index) => {
            const m = btn.dataset.mode;
            const selected = m === mode;
            btn.classList.toggle('is-selected', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            if (selected) selectedBtn = btn;
        });

        // 選択されたボタンの実際の幅と位置を取得してCSS変数に設定
        if (selectedBtn) {
            const btnRect = selectedBtn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const leftOffset = btnRect.left - containerRect.left;

            container.style.setProperty('--seg-width', `${btnRect.width}px`);
            container.style.setProperty('--seg-left', `${leftOffset}px`);
        }
    }

    // initialize according to current global
    setMode(searchMode);

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            setMode(mode);
        });
    });
}

// NOTE: Adaptive search-section sizing was removed to avoid unstable
// height-dependent layout switching on mobile devices. The logic that
// measured `.search-section` and toggled `body.search-compact` has been
// deleted. Keep this comment to explain why the previous implementation
// was removed.

// ========================================
// 駅名入力の自動補完
// ========================================
function setupStationInput(inputId) {
    const input = document.getElementById(inputId);
    const suggestionsId = `${inputId}-suggestions`;
    const suggestionsDiv = document.getElementById(suggestionsId);

    if (!input || !suggestionsDiv) {
        console.error(`Element not found: ${inputId}`);
        return;
    }

    input.addEventListener('input', () => {
        const query = input.value.trim();

        if (query.length === 0) {
            suggestionsDiv.classList.remove('is-open');
            return;
        }

        const matchingStations = searchStations(query);
        displaySuggestions(matchingStations, suggestionsDiv, input);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestionsDiv.classList.remove('is-open');
        }, 200);
    });
}

function searchStations(query) {
    if (!model || !model.network || !model.network.stations) {
        console.error('model.network.stations is not available');
        return [];
    }

    const lowerQuery = query.toLowerCase();

    return model.network.stations.filter(station => {
        const name = String(station.name || '');
        const kana = String(station.kana || '').toLowerCase();
        return name.includes(query) ||
               kana.includes(lowerQuery) ||
               convertToHiragana(name).includes(lowerQuery);
    }).slice(0, 10);
}

// ヘルプモーダル・ボトムシート・noopリンクは shared/ui-dom.js に集約済み。
// DOM はモジュールスクリプト実行時点で利用可能なため、ここで直接呼び出す。
setupHelpModal();
setupBottomSheet();
setupNoopLinks();

function normalizeLineDisplayName(name) {
    let display = String(name || '').trim();
    const idx = display.indexOf('線');
    if (idx !== -1) {
        display = display.slice(0, idx + 1).trim();
    }
    return display;
}

function displaySuggestions(stations, suggestionsDiv, input) {
    if (stations.length === 0) {
        suggestionsDiv.classList.remove('is-open');
        return;
    }

    suggestionsDiv.innerHTML = '';

    stations.forEach(station => {
        const item = document.createElement('div');
        item.className = 'field-suggestion';

        // 路線名を取得して表示用に整形
        // 1) 元の路線名を取得
        // 2) 名前に「線」が含まれる場合は「線」までを表示（それ以降は省略）
        // 3) 表示名が重複する場合は一つだけ表示
        const lineIds = (model && model.linesByStation.get(station.id)) || [];
        const displayNames = lineIds.map(lineId => normalizeLineDisplayName(model.lineName(lineId)));
        const seen = new Set();
        const unique = [];
        for (const n of displayNames) {
            if (!seen.has(n)) {
                seen.add(n);
                unique.push(n);
            }
        }
        let linesText = unique.join('・');

        // 駅グループ（要望5：別の駅への徒歩連絡）に入っている駅には注記を添える
        const mates = groupMatesByStation.get(station.id);
        if (mates && mates.length > 0) {
            const note = `（${mates.join('・')}と徒歩連絡）`;
            linesText = linesText ? `${linesText} ${note}` : note;
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'field-suggestion__name';
        nameSpan.textContent = station.name;

        const linesSpan = document.createElement('span');
        linesSpan.className = 'field-suggestion__lines';
        linesSpan.textContent = linesText;

        item.appendChild(nameSpan);
        item.appendChild(linesSpan);

        item.addEventListener('click', () => {
            input.value = station.name;
            suggestionsDiv.classList.remove('is-open');
        });

        suggestionsDiv.appendChild(item);
    });

    suggestionsDiv.classList.add('is-open');
}

function convertToHiragana(text) {
    return text.toLowerCase();
}

// ========================================
// 駅入れ替え
// ========================================
// When swapping origin/destination, also reverse the order of any
// 経由駅 (via-station) DOM items so the route direction is preserved.
// This only takes effect when there are 2 or more via stations.
function _reverseViaStationsIfNeeded() {
    const viaStationsDiv = document.getElementById('via-stations');
    if (!viaStationsDiv) return;
    const viaItems = Array.from(viaStationsDiv.querySelectorAll('.via-station-item'));
    if (viaItems.length <= 1) return;
    // Reverse DOM order by appending items in reversed sequence
    viaItems.reverse().forEach(item => viaStationsDiv.appendChild(item));
    // Update visible badges (経1, 経2...)
    reindexViaStations();
}

// Updated swap handler that also reverses via stations when appropriate
function swapStations() {
    const departure = document.getElementById('departure');
    const arrival = document.getElementById('arrival');

    const temp = departure.value;
    departure.value = arrival.value;
    arrival.value = temp;

    // Reverse via stations order if there are multiple
    _reverseViaStationsIfNeeded();
}

// ========================================
// 経由駅追加
// ========================================
function addViaStation() {
    // Use a separate unique counter for the DOM id to avoid reuse when
    // users add/remove multiple times. The displayed "経由駅 N" is computed
    // from the number of visible items so numbers stay sequential.
    viaUniqueIdCounter++;
    const uniqueId = viaUniqueIdCounter;

    const viaStationsDiv = document.getElementById('via-stations');

    const viaItem = document.createElement('div');
    viaItem.className = 'via-station-item';
    viaItem.dataset.viaUid = uniqueId;

    // The displayed index is the current count + 1
    const displayIndex = viaStationsDiv.querySelectorAll('.via-station-item').length + 1;

    const viaId = `via-${uniqueId}`;
    const suggestionsId = `${viaId}-suggestions`;

    viaItem.innerHTML = `
        <div class="badge badge-square badge-square--compact">経${displayIndex}</div>
        <div class="field input-wrapper">
            <input
                type="text"
                id="${viaId}"
                class="field-input"
                placeholder="経由駅"
                autocomplete="off"
            >
            <div class="field-suggestions" id="${suggestionsId}"></div>
        </div>
        <button type="button" class="btn btn-icon-circle btn-icon-circle--ghost">
            ✕
        </button>
    `;

    viaStationsDiv.appendChild(viaItem);

    // Attach remove listener using the stable unique id
    const removeBtn = viaItem.querySelector('.btn-icon-circle--ghost');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => removeViaStation(uniqueId));
    }

    setupStationInput(viaId);

    // Ensure labels are correctly numbered (defensive)
    reindexViaStations();
}

function removeViaStation(viaId) {
    // viaId here is the unique id assigned to the DOM element (viaUid)
    const viaItem = document.querySelector(`[data-via-uid="${viaId}"]`);
    if (viaItem) {
        viaItem.remove();
        // After removal, reindex remaining visible via items so labels are sequential
        reindexViaStations();
    }
}

// Recompute and update the visible "経由駅 N" labels based on current order
function reindexViaStations() {
    const viaStationsDiv = document.getElementById('via-stations');
    if (!viaStationsDiv) return;
    const items = viaStationsDiv.querySelectorAll('.via-station-item');
    items.forEach((item, idx) => {
        const badge = item.querySelector('.badge');
        if (badge) badge.textContent = `経${idx + 1}`;
    });
}

// ========================================
// 検索グラフのキャッシュ（絞り込み条件ごと）
// ========================================
function getSearchGraph(filters) {
    const vehicleKey = Array.from(filters.allowedTrainTypes).sort().join(',');
    const key = `${filters.onlyOwnCompany ? '1' : '0'}|${vehicleKey}`;
    let graph = graphCache.get(key);
    if (!graph) {
        graph = buildSearchGraph(model, {
            vehicleTypeIds: filters.allowedTrainTypes,
            ownCompanyOnly: filters.onlyOwnCompany
        });
        graphCache.set(key, graph);
    }
    return graph;
}

// ========================================
// 経路検索実行
// ========================================
function performSearch() {
    hideError();
    hideResults();

    const departureStation = findStationByName(document.getElementById('departure').value.trim());
    const arrivalStation = findStationByName(document.getElementById('arrival').value.trim());

    if (!departureStation) {
        showError('出発駅が正しく入力されていません');
        return;
    }
    if (!arrivalStation) {
        showError('到着駅が正しく入力されていません');
        return;
    }
    if (departureStation.id === arrivalStation.id) {
        showError('出発駅と到着駅が同じです');
        return;
    }

    const viaStations = [];
    const viaItems = document.querySelectorAll('.via-station-item');
    for (let item of viaItems) {
        const viaId = item.querySelector('.field-input').id;
        const viaValue = document.getElementById(viaId).value.trim();
        if (viaValue) {
            const viaStation = findStationByName(viaValue);
            if (!viaStation) {
                showError(`経由駅「${viaValue}」が見つかりません`);
                return;
            }
            viaStations.push(viaStation);
        }
    }

    const filters = {
        onlyOwnCompany: document.getElementById('own-company-only').checked,
        allowedTrainTypes: new Set()
    };

    if (document.getElementById('type-tc').checked) {
        filters.allowedTrainTypes.add('TC');
    }
    if (document.getElementById('type-sx').checked) {
        filters.allowedTrainTypes.add('SX');
    }
    if (document.getElementById('type-mc').checked) {
        filters.allowedTrainTypes.add('MC');
    }

    if (filters.allowedTrainTypes.size === 0) {
        showError('少なくとも1つの列車種別を選択してください');
        return;
    }

    // URLパラメータを更新
    updateUrlParams(departureStation, arrivalStation, viaStations, filters);

    showLoading();

    setTimeout(() => {
        try {
            const graph = getSearchGraph(filters);
            const routes = searchRoutes(model, graph, {
                fromStationId: departureStation.id,
                toStationId: arrivalStation.id,
                viaStationIds: viaStations.map(s => s.id),
                transferPenalty: getTransferPenalty(searchMode),
                maxRoutes: 5
            });
            hideLoading();

            if (routes.length === 0) {
                showError('指定された条件では経路が見つかりませんでした');
            } else {
                displayResults(routes);
            }
        } catch (error) {
            hideLoading();
            showError('経路検索中にエラーが発生しました: ' + error.message);
            console.error(error);
        }
    }, 100);
}

function findStationByName(name) {
    if (!name || !model) return null;
    return model.network.stations.find(s => s.name === name) || null;
}

function findStationById(id) {
    if (!id || !model) return null;
    return model.network.stations.find(s => s.id === id) || null;
}

// ========================================
// URLパラメータ処理
// ========================================
function updateUrlParams(departureStation, arrivalStation, viaStations, filters) {
    const params = new URLSearchParams();

    // search-mode: only include when not default 'balance'. Insert first so it appears at the
    // start of the query string when present.
    if (searchMode === 'time') {
        params.append('search-mode', 'time');
    } else if (searchMode === 'transfer') {
        params.append('search-mode', 'transfer');
    }

    // Preserve existing `route` parameter value (but do NOT insert it yet).
    // We'll append it after adding other params so `route` stays at the end
    // of the query string and the original parameter ordering isn't changed.
    let preservedRoute = null;
    try {
        const currentParams = new URLSearchParams(window.location.search);
        if (currentParams.has('route')) {
            preservedRoute = currentParams.get('route');
        }
    } catch (e) {
        // Defensive: if URL parsing fails for some reason, continue without route.
        console.warn('Failed to read existing route param:', e);
    }

    // 出発駅・到着駅
    if (departureStation) {
        params.set('from', departureStation.id);
    }
    if (arrivalStation) {
        params.set('to', arrivalStation.id);
    }

    // 経由駅（via1, via2, ...）
    viaStations.forEach((station, index) => {
        params.set(`via${index + 1}`, station.id);
    });

    // フィルター設定
    // KTonlyはデフォルトでdisabledなので、enabledの場合のみ付与
    if (filters.onlyOwnCompany) {
        params.set('KTonly', 'enabled');
    }

    // 列車種別はデフォルトでenabledなので、disabledの場合のみ付与
    if (!filters.allowedTrainTypes.has('TC')) {
        params.set('TC', 'disabled');
    }
    if (!filters.allowedTrainTypes.has('SX')) {
        params.set('SX', 'disabled');
    }
    if (!filters.allowedTrainTypes.has('MC')) {
        params.set('MC', 'disabled');
    }

    // If there was a preserved route from the current URL, append it now so
    // it appears at the end of the query string (preserves order expectations).
    if (preservedRoute) {
        params.set('route', preservedRoute);
    }

    // URLを更新（履歴に追加）
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, '', newUrl);
    console.log('URLパラメータを更新:', newUrl);
}

function clearUrlParams() {
    // パラメータを削除してベースURLに戻す
    const newUrl = window.location.pathname;
    window.history.pushState({}, '', newUrl);
    console.log('URLパラメータを削除:', newUrl);
}

function loadFromUrlParams() {
    const params = new URLSearchParams(window.location.search);
    // search-mode が指定されている場合は内部状態と UI を更新
    try {
        const sm = params.get('search-mode');
        if (sm === 'time' || sm === 'transfer') {
            searchMode = sm;
        } else {
            searchMode = 'balance';
        }
        const container = document.getElementById('search-mode-toggle');
        if (container) {
            const btn = container.querySelector(`.segmented-btn[data-mode="${searchMode}"]`);
            if (btn) btn.click();
        }
    } catch (e) {
        // ignore
    }

    // パラメータがない場合は何もしない
    if (!params.has('from') && !params.has('to')) {
        return;
    }

    console.log('URLパラメータから検索条件を読み込み中...');

    // 出発駅を設定
    const fromId = params.get('from');
    if (fromId) {
        const fromStation = findStationById(fromId);
        if (fromStation) {
            document.getElementById('departure').value = fromStation.name;
            console.log('出発駅設定:', fromStation.name);
        } else {
            console.warn('出発駅が見つかりません:', fromId);
        }
    }

    // 到着駅を設定
    const toId = params.get('to');
    if (toId) {
        const toStation = findStationById(toId);
        if (toStation) {
            document.getElementById('arrival').value = toStation.name;
            console.log('到着駅設定:', toStation.name);
        } else {
            console.warn('到着駅が見つかりません:', toId);
        }
    }

    // 経由駅を設定（via1, via2, via3...）
    let viaIndex = 1;
    while (params.has(`via${viaIndex}`)) {
        const viaId = params.get(`via${viaIndex}`);
        const viaStation = findStationById(viaId);
        if (viaStation) {
            addViaStation();
            // 最後に追加された経由駅の入力欄を取得
            const viaItems = document.querySelectorAll('.via-station-item');
            const lastViaItem = viaItems[viaItems.length - 1];
            const viaInput = lastViaItem.querySelector('.field-input');
            if (viaInput) {
                viaInput.value = viaStation.name;
                console.log(`経由駅${viaIndex}設定:`, viaStation.name);
            }
        } else {
            console.warn(`経由駅${viaIndex}が見つかりません:`, viaId);
        }
        viaIndex++;
    }

    // フィルター設定（デフォルト: KTonly=disabled, TC/SX/MC=enabled）
    const ktOnly = params.get('KTonly');
    if (ktOnly === 'enabled') {
        document.getElementById('own-company-only').checked = true;
        console.log('KT線のみ: 有効');
    } else {
        document.getElementById('own-company-only').checked = false;
    }

    const tc = params.get('TC');
    if (tc === 'disabled') {
        document.getElementById('type-tc').checked = false;
        console.log('TrainCarts: 無効');
    } else {
        document.getElementById('type-tc').checked = true;
    }

    const sx = params.get('SX');
    if (sx === 'disabled') {
        document.getElementById('type-sx').checked = false;
        console.log('新幹線: 無効');
    } else {
        document.getElementById('type-sx').checked = true;
    }

    const mc = params.get('MC');
    if (mc === 'disabled') {
        document.getElementById('type-mc').checked = false;
        console.log('トロッコ: 無効');
    } else {
        document.getElementById('type-mc').checked = true;
    }

    // すべての条件が設定されたら自動的に検索を実行
    if (fromId && toId) {
        console.log('URLパラメータに基づいて自動検索を実行します');
        setTimeout(() => {
            performSearch();
        }, 500); // UIの更新を待つため少し遅延
    }
}

// ========================================
// タイムライン縦線（.timeline-line）の端を隣接する駅マーカーの中心にぴったり合わせる
// ========================================
// .timeline-line は固定ピクセルのtop/bottomで前後の駅マーカーに接続しているが、
// 直通（乗換不要）で時刻表示が1行になる等、行の高さは内容によって変動するため、
// 固定値では接続点がわずかにずれる（線がマーカーからはみ出す）ことがある。
// 実際に描画されたマーカーの中心座標を測って線のtop/heightを直接指定することで、
// 行の高さがどう変わっても接続点を厳密に一致させる。
function findNearestMarkerDot(row, direction) {
    let sib = row[direction];
    while (sib) {
        const dot = sib.querySelector(':scope > .timeline-marker-col > .timeline-dot, :scope > .timeline-marker-col > .badge-square');
        if (dot) return dot;
        sib = sib[direction];
    }
    return null;
}

function alignRouteCardTimelineLines(card) {
    if (!card) return;
    const lines = card.querySelectorAll('.timeline-line');
    lines.forEach(line => {
        const segMarkerCol = line.parentElement;
        const segRow = segMarkerCol && segMarkerCol.closest('.timeline-row');
        if (!segRow) return;

        const prevDot = findNearestMarkerDot(segRow, 'previousElementSibling');
        const nextDot = findNearestMarkerDot(segRow, 'nextElementSibling');
        if (!prevDot || !nextDot) return;

        const colRect = segMarkerCol.getBoundingClientRect();
        const prevRect = prevDot.getBoundingClientRect();
        const nextRect = nextDot.getBoundingClientRect();
        const prevCenter = prevRect.top + prevRect.height / 2;
        const nextCenter = nextRect.top + nextRect.height / 2;

        line.style.top = `${prevCenter - colRect.top}px`;
        line.style.height = `${nextCenter - prevCenter}px`;
        line.style.bottom = 'auto';
    });
}

// 結果セクション内で現在表示中のルートカードのタイムライン線を再調整する
// （タブ切替やウィンドウリサイズなどレイアウトが変わり得るタイミングで呼ぶ）
function alignVisibleRouteCardTimelineLines() {
    const resultsSection = document.getElementById('results-section');
    if (!resultsSection || resultsSection.style.display === 'none') return;
    const visibleCard = Array.from(resultsSection.querySelectorAll('.route-card'))
        .find(c => c.style.display !== 'none');
    if (visibleCard) alignRouteCardTimelineLines(visibleCard);
}

let _timelineResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_timelineResizeTimer);
    _timelineResizeTimer = setTimeout(alignVisibleRouteCardTimelineLines, 150);
});

// ========================================
// 結果表示
// ========================================
function displayResults(routes) {
    const resultsSection = document.getElementById('results-section');
    const resultsContainer = document.getElementById('results-container');
    const resultsCount = document.getElementById('results-count');

    // clear previous content
    resultsContainer.innerHTML = '';
    resultsCount.textContent = '';

    if (!routes || routes.length === 0) {
        resultsSection.style.display = 'none';
        resultsCount.textContent = '0件';
        return;
    }

    // 検索画面を隠す
    hideSearchSection();

    resultsCount.textContent = `${routes.length} 件の経路が見つかりました`;

    // 「検索画面に戻る」ボタンを作成（既存のボタン・ラッパーを再利用または削除して重複を防止）
    const backButton = document.createElement('button');
    backButton.className = 'btn btn-outline-pill';
    backButton.textContent = '検索画面に戻る';
    backButton.addEventListener('click', () => {
        // URLパラメータをクリア
        clearUrlParams();
        hideResults();
        showSearchSection();
        // ページトップにスクロール
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 「検索結果」見出しの右側に戻るボタンを配置
    const resultsInfo = resultsSection.querySelector('.results-info');
    resultsInfo.innerHTML = ''; // 既存の内容をクリア

    // Try to reuse an existing header wrapper if present to avoid creating duplicates
    const existingHeaderWrapper = resultsSection.querySelector('.route-results-header');
    const heading = resultsSection.querySelector('h2');

    if (existingHeaderWrapper) {
        // Remove any previous back button inside the existing wrapper
        const prevBtn = existingHeaderWrapper.querySelector('.btn-outline-pill');
        if (prevBtn) prevBtn.remove();

        // Ensure the heading is inside the wrapper
        if (heading && heading.parentNode !== existingHeaderWrapper) {
            existingHeaderWrapper.insertBefore(heading, existingHeaderWrapper.firstChild || null);
        }

        // Append the fresh back button
        existingHeaderWrapper.appendChild(backButton);
    } else if (heading && heading.parentNode) {
        // Create a new wrapper and insert the heading and back button
        const headerWrapper = document.createElement('div');
        headerWrapper.className = 'route-results-header';

        // Insert wrapper before the heading, then move heading into it
        heading.parentNode.insertBefore(headerWrapper, heading);
        headerWrapper.appendChild(heading);
        headerWrapper.appendChild(backButton);
    } else {
        // Fallback: append back button to resultsInfo if heading not found
        // Also ensure no duplicate button exists there
        const prevBtn = resultsInfo.querySelector('.btn-outline-pill');
        if (prevBtn) prevBtn.remove();
        resultsInfo.appendChild(backButton);
    }

    // 件数表示は results-info の中に配置（見出しの下）
    const countSpan = document.createElement('span');
    countSpan.id = 'results-count';
    countSpan.textContent = `${routes.length} 件の経路が見つかりました`;
    resultsInfo.appendChild(countSpan);

    // タブ（ルート切替）メニューを作成
    const tabs = document.createElement('div');
    tabs.className = 'route-tabs';

    routes.forEach((route, idx) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'route-tab';
        tab.textContent = `ルート${idx + 1}`;
        tab.dataset.index = idx;

        tab.addEventListener('click', () => {
            // activate tab
            const allTabs = tabs.querySelectorAll('.route-tab');
            allTabs.forEach(t => t.classList.toggle('is-active', t === tab));

            // show/hide cards and their share buttons
            const cards = resultsContainer.querySelectorAll('.route-card');
            cards.forEach((c, i) => {
                const showing = (i === idx);
                c.style.display = showing ? 'block' : 'none';
                const shareWrapper = c.querySelector('.share-result-wrapper');
                if (shareWrapper) shareWrapper.style.display = showing ? '' : 'none';
            });

            // update URL to include route param because user explicitly selected a route
            try {
                const urlObj = new URL(window.location.href);
                const params = new URLSearchParams(urlObj.search);
                params.set('route', String(idx + 1));
                const newUrl = `${urlObj.pathname}?${params.toString()}`;
                window.history.pushState({}, '', newUrl);
            } catch (e) {
                // ignore URL update failures
            }

            // bring results into view
            resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // タブ切替で表示されたカードのタイムライン線を再調整する
            requestAnimationFrame(() => {
                const shownCard = resultsContainer.querySelector(`.route-card[data-index="${idx}"]`);
                alignRouteCardTimelineLines(shownCard);
            });
        });

        tabs.appendChild(tab);
    });

    // タブを結果コンテナに追加
    resultsContainer.appendChild(tabs);
    // Enhance tabs: add chevrons and hide native scrollbar visually
    try { setupScrollableTabs(tabs); } catch (e) { console.warn('setupScrollableTabs failed', e); }

    // ルートカードを作成して追加（最初のルートのみ表示）
    routes.forEach((route, idx) => {
        let card;
        try {
            card = createRouteCard(model, route, idx + 1);
        } catch (e) {
            console.error('createRouteCard error', e);
            card = document.createElement('div');
            card.className = 'card route-card';
            card.textContent = `ルート ${idx + 1}`;
        }

        card.classList.add('card', 'route-card');
        card.dataset.index = idx;
        card.style.display = (idx === 0) ? 'block' : 'none';

        resultsContainer.appendChild(card);

        // 共有ボタン（戻るボタンと同様のデザイン）
        try {
            const shareBtn = document.createElement('button');
            shareBtn.type = 'button';
            shareBtn.className = 'btn btn-outline-pill';
            shareBtn.textContent = '検索結果を共有する';

            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Build a shareable URL based on current params and include route index
                try {
                    const urlObj = new URL(window.location.href);
                    const params = new URLSearchParams(urlObj.search);
                    // include route index so receivers can highlight the same route if desired
                    params.set('route', String(idx + 1));
                    const shareUrl = `${urlObj.origin}${urlObj.pathname}?${params.toString()}`;
                    showShareDialog(shareUrl);
                } catch (err) {
                    // fallback to whole href
                    showShareDialog(window.location.href);
                }
            });

            // append share button inside the card so it follows card visibility
            const wrapper = document.createElement('div');
            wrapper.className = 'share-result-wrapper';
            wrapper.appendChild(shareBtn);
            // only show for the initially active card (route 1)
            wrapper.style.display = (idx === 0) ? '' : 'none';
            card.appendChild(wrapper);
        } catch (e) { console.warn('could not create share button', e); }
    });

    // Determine initial active route: prefer ?route=N if present, otherwise default to 1
    // If an explicit route param exists but is out of range (e.g. route=4 but only 3 routes),
    // remove the `route` parameter from the URL and fall back to the default (route 1).
    const params = new URLSearchParams(window.location.search);
    let initialIndex = 0;
    const routeParamRaw = params.get('route');
    const routeParam = parseInt(routeParamRaw);

    if (!isNaN(routeParam) && routeParam >= 1 && routeParam <= routes.length) {
        initialIndex = routeParam - 1;
    } else if (routeParamRaw !== null) {
        // route param was present but invalid -> remove it from URL so default (route 1) is shown
        try {
            const urlObj = new URL(window.location.href);
            const newParams = new URLSearchParams(urlObj.search);
            newParams.delete('route');
            const newUrl = `${urlObj.pathname}${newParams.toString() ? '?' + newParams.toString() : ''}`;
            // replace history entry (do not create a new one) to avoid polluting back stack
            window.history.replaceState({}, '', newUrl);
            console.log('無効なrouteパラメータを削除しました:', routeParamRaw);
        } catch (e) {
            // ignore URL update failures
            console.warn('routeパラメータの削除に失敗しました:', e);
        }
        initialIndex = 0;
    }

    // Activate the initial tab
    const allTabs = tabs.querySelectorAll('.route-tab');
    allTabs.forEach((t, i) => t.classList.toggle('is-active', i === initialIndex));

    // show/hide cards according to initialIndex and ensure share button visibility
    const cards = resultsContainer.querySelectorAll('.route-card');
    cards.forEach((c, i) => {
        c.style.display = (i === initialIndex) ? 'block' : 'none';
        const shareWrapper = c.querySelector('.share-result-wrapper');
        if (shareWrapper) shareWrapper.style.display = (i === initialIndex) ? '' : 'none';
    });

    resultsSection.style.display = 'block';
    // mark body so CSS can adjust layout for results view on small screens
    try {
        document.body.classList.add('results-open');
    } catch (e) { /* noop for older environments */ }

    // 初期表示カードのタイムライン線を、実際のレイアウト確定後に調整する
    requestAnimationFrame(() => {
        alignRouteCardTimelineLines(cards[initialIndex]);
    });
}

// ========================================
// ルートのタイムライン組み立て（route.legs → 描画用の行データ）
// 3-6 の対応表（RideLeg/区間境界(直通)/TransferLeg(platform/walk)）を参照
// ========================================
function buildTimelineItems(model, route) {
    const items = [];
    let elapsed = 0;
    let started = false;

    function pushStationRow(stationId, marker) {
        const row = { type: 'station', stationId, marker, arrivalElapsed: null, departureElapsed: null, transferSeconds: null, transferLabel: '' };
        items.push(row);
        return row;
    }

    route.legs.forEach(leg => {
        if (leg.type === 'transfer') {
            if (leg.kind === 'walk') {
                if (!started) {
                    pushStationRow(leg.fromStationId, 'start');
                    started = true;
                }
                elapsed += leg.duration;
                items.push({ type: 'walk', fromStationId: leg.fromStationId, toStationId: leg.toStationId, seconds: leg.duration });
                pushStationRow(leg.toStationId, 'via');
            } else {
                // 同じのりば・のりば間の乗換：直前に出した駅の行に発時刻・乗換時間を合成する
                const last = items[items.length - 1];
                elapsed += leg.duration;
                if (last && last.type === 'station') {
                    last.departureElapsed = elapsed;
                    last.transferSeconds = leg.duration;
                    last.transferLabel = '乗換';
                }
            }
            return;
        }

        // RideLeg
        if (!started) {
            pushStationRow(leg.stops[0].stationId, 'start');
            started = true;
        }
        const legBase = elapsed;
        leg.sections.forEach((section, si) => {
            const line = model.lineById.get(section.lineId);
            const fromStop = leg.stops[section.startStop];
            const toStop = leg.stops[section.endStop];
            const midStops = leg.stops.slice(section.startStop + 1, section.endStop).map(s => ({
                stationId: s.stationId,
                elapsedFromSectionStart: s.elapsed - fromStop.elapsed
            }));

            items.push({
                type: 'segment',
                lineId: section.lineId,
                categoryId: section.categoryId,
                lineName: model.lineName(section.lineId),
                categoryName: model.categoryName(section.lineId, section.categoryId),
                lineColor: line ? line.color : '#ccc',
                vehicleTypeId: line ? line.vehicleTypeId : null,
                headsign: si === 0 ? leg.headsign : null,
                alternativeHeadsigns: si === 0 ? (leg.alternativeHeadsigns || []) : [],
                throughFromLineName: si > 0 ? model.lineName(leg.sections[si - 1].lineId) : null,
                stopsCount: section.endStop - section.startStop,
                departurePlatform: fromStop.platformId,
                arrivalPlatform: toStop.platformId,
                duration: toStop.elapsed - fromStop.elapsed,
                midStops
            });

            elapsed = legBase + toStop.elapsed;

            const isLastSection = si === leg.sections.length - 1;
            const row = pushStationRow(toStop.stationId, 'via');
            row.arrivalElapsed = elapsed;
            if (!isLastSection) {
                row.departureElapsed = elapsed;
                row.transferLabel = '直通';
            }
        });
    });

    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].type === 'station') {
            items[i].marker = 'end';
            break;
        }
    }

    return items;
}

// ========================================
// 経路カード作成
// ========================================
function createRouteCard(model, route, routeNumber) {
    const card = document.createElement('div');
    card.className = 'card route-card';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'route-header';
    header.innerHTML = `
        <div class="route-summary">
            <span class="summary-time">${formatDurationHtml(route.totalDuration)}</span>
            <span class="summary-transfer"><span class="summary-unit">乗換&nbsp;</span><span class="summary-number">${route.transferCount}</span><span class="summary-unit">回</span></span>
        </div>
    `;
    card.appendChild(header);

    // タイムラインテーブル
    const table = document.createElement('div');
    table.className = 'route-table';

    const items = buildTimelineItems(model, route);
    items.forEach(item => {
        if (item.type === 'station') {
            table.appendChild(createTableStationRow(item, model));
        } else if (item.type === 'segment') {
            table.appendChild(createTableSegmentRow(item, model));
        } else if (item.type === 'walk') {
            table.appendChild(createWalkInfoRow(item, model));
        }
    });

    card.appendChild(table);
    return card;
}

// 駅行
function createTableStationRow({ stationId, marker, arrivalElapsed = null, departureElapsed = null, transferSeconds = null, transferLabel = '' }, model) {
    const row = document.createElement('div');
    row.className = 'timeline-row timeline-row--station';

    // マーカー色
    let markerColor = 'var(--color-primary)';

    // 時刻表示: 縦に並べる（上: 到着 着, 下: 出発 発）
    // 直通(乗換不要)の場合は departure を表示せず、arrival のみ表示する
    let timeHtmlTop = '';
    let timeHtmlBottom = '';
    if (transferLabel === '直通') {
        if (arrivalElapsed != null) {
            timeHtmlTop = `<div class="timeline-time-arrival">${formatSeconds(arrivalElapsed)} 着</div>`;
        }
    } else {
        if (arrivalElapsed != null) {
            timeHtmlTop = `<div class="timeline-time-arrival">${formatSeconds(arrivalElapsed)} 着</div>`;
        }
        if (departureElapsed != null) {
            timeHtmlBottom = `<div class="timeline-time-departure">${formatSeconds(departureElapsed)} 発</div>`;
        }
    }

    // 乗換情報（駅名の右側に表示）
    let transferHtml = '';
    if (transferLabel === '直通') {
        transferHtml = `<span class="timeline-transfer-time">乗換不要(直通)</span>`;
    } else if (transferSeconds != null) {
        transferHtml = `<span class="timeline-walk"><img src="../assets/icons/walking.svg" class="timeline-walk-icon" alt="walk">${formatSeconds(transferSeconds)}</span>`;
    }

    // マーカー本体
    let markerHtml = '';
    if (marker === 'start' || marker === 'end') {
        markerHtml = `<span class="badge badge-square badge-square--sm">${marker === 'start' ? '発' : '着'}</span>`;
    } else if (transferSeconds != null) {
        markerHtml = `<span class="timeline-dot timeline-dot--transfer"></span>`;
    } else {
        markerHtml = `<span class="timeline-dot" style="background:${markerColor};"></span>`;
    }

    row.innerHTML = `
        <div class="timeline-time">
            ${timeHtmlTop}
            ${timeHtmlBottom}
        </div>
        <div class="timeline-marker-col">
            ${markerHtml}
        </div>
        <div class="timeline-station-row">
            <span class="timeline-station-name"></span>
            ${transferHtml}
        </div>
    `;
    row.querySelector('.timeline-station-name').textContent = model.stationName(stationId) || stationId;
    return row;
}

// 徒歩連絡行（別の駅への乗換）
function createWalkInfoRow(item, model) {
    const row = document.createElement('div');
    row.className = 'timeline-row';

    const timeDiv = document.createElement('div');
    timeDiv.className = 'timeline-time';
    row.appendChild(timeDiv);

    const markerDiv = document.createElement('div');
    markerDiv.className = 'timeline-marker-col';
    markerDiv.innerHTML = `<span class="timeline-dot timeline-dot--transfer"></span>`;
    row.appendChild(markerDiv);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'timeline-content';
    const wrapper = document.createElement('span');
    wrapper.className = 'timeline-walk';
    const icon = document.createElement('img');
    icon.src = '../assets/icons/walking.svg';
    icon.className = 'timeline-walk-icon';
    icon.alt = 'walk';
    wrapper.appendChild(icon);
    const label = document.createElement('span');
    const fromName = model.stationName(item.fromStationId) || item.fromStationId;
    const toName = model.stationName(item.toStationId) || item.toStationId;
    label.textContent = `徒歩連絡 ${formatSeconds(item.seconds)}（${fromName}→${toName}）`;
    wrapper.appendChild(label);
    contentDiv.appendChild(wrapper);
    row.appendChild(contentDiv);

    return row;
}

// 秒を "X分 Y秒" または "Z秒" の形式でフォーマット
function formatSeconds(sec) {
    if (sec === null || sec === undefined || sec === '') return '';
    const n = Math.round(Number(sec) || 0);
    if (isNaN(n)) return '';
    if (n < 60) return `${n}秒`;
    const m = Math.floor(n / 60);
    const s = n % 60;
    if (s === 0) return `${m}分`;
    return `${m}分 ${s}秒`;
}

// HTML formatter for duration that separates numeric digits and unit text.
// Numeric parts are wrapped in .summary-number and unit text in .summary-unit
// so CSS can render digits large & blue while keeping units small & black.
function formatDurationHtml(totalSeconds) {
    const n = Math.round(Number(totalSeconds) || 0);
    if (isNaN(n)) return `<span class="summary-number">0</span><span class="summary-unit">秒</span>`;

    if (n < 60) {
        return `<span class="summary-number">${n}</span><span class="summary-unit">秒</span>`;
    }

    const m = Math.floor(n / 60);
    const s = n % 60;
    let html = `<span class="summary-number">${m}</span><span class="summary-unit">分</span>`;
    if (s > 0) html += `<span class="summary-number">${s}</span><span class="summary-unit">秒</span>`;
    return html;
}

// 路線区間行（RideLeg の1区間＝直通の場合は複数行に分かれて続く）
function createTableSegmentRow(item, model) {
    const stopsCount = item.stopsCount;

    // 1つの行として作成
    const segmentRow = document.createElement('div');
    segmentRow.className = 'timeline-row timeline-row--segment';

    // timeline-time（空）
    const segTimeDiv = document.createElement('div');
    segTimeDiv.className = 'timeline-time';
    segmentRow.appendChild(segTimeDiv);

    // timeline-marker-col（のりば・乗車時間 + 縦線）
    const segMarkerDiv = document.createElement('div');
    segMarkerDiv.className = 'timeline-marker-col timeline-segment';

    // 左側：のりば・乗車時間のコンテナ
    const markerInner = document.createElement('div');
    markerInner.className = 'timeline-segment-inner';

    // 乗車駅のりば（上部）
    if (item.departurePlatform) {
        const depPlatform = document.createElement('div');
        depPlatform.className = 'badge badge-platform--solid';
        depPlatform.textContent = `${item.departurePlatform}番のりば`;
        markerInner.appendChild(depPlatform);
    } else {
        // 空のスペーサー
        const spacer = document.createElement('div');
        spacer.className = 'timeline-platform-spacer';
        markerInner.appendChild(spacer);
    }

    // 乗車時間（中央）
    const durationSpan = document.createElement('div');
    durationSpan.className = 'timeline-boarding-duration';
    durationSpan.textContent = `${formatSeconds(item.duration)} 乗車`;
    markerInner.appendChild(durationSpan);

    // 降車駅のりば（下部）
    if (item.arrivalPlatform) {
        const arrPlatform = document.createElement('div');
        arrPlatform.className = 'badge badge-platform--solid';
        arrPlatform.textContent = `${item.arrivalPlatform}番のりば`;
        markerInner.appendChild(arrPlatform);
    } else {
        // 空のスペーサー
        const spacer = document.createElement('div');
        spacer.className = 'timeline-platform-spacer';
        markerInner.appendChild(spacer);
    }

    segMarkerDiv.appendChild(markerInner);

    // 右側：縦線（セグメントライン）
    const segmentLine = document.createElement('div');
    segmentLine.className = 'timeline-line';
    segmentLine.style.background = item.lineColor;
    segMarkerDiv.appendChild(segmentLine);

    segmentRow.appendChild(segMarkerDiv);

    // timeline-content（路線情報）
    const segContentDiv = document.createElement('div');
    segContentDiv.className = 'timeline-content';

    // 路線名・種別（直通で続く区間には「（□□線直通）」を付ける）
    const lineRow = document.createElement('div');
    lineRow.className = 'timeline-line-row';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'timeline-line-symbol';
    iconSpan.style.setProperty('--icon-color', item.lineColor);
    const iconType = item.vehicleTypeId || 'TC';
    iconSpan.style.webkitMaskImage = `url(../assets/icons/${iconType}.svg)`;
    iconSpan.style.maskImage = `url(../assets/icons/${iconType}.svg)`;

    const lineName = document.createElement('span');
    lineName.className = 'timeline-line-name';
    const categoryText = item.categoryName ? ` ${item.categoryName}` : '';
    const throughText = item.throughFromLineName ? `（${item.throughFromLineName}直通）` : '';
    lineName.textContent = `${item.lineName}${categoryText}${throughText}`;

    lineRow.appendChild(iconSpan);
    lineRow.appendChild(lineName);
    segContentDiv.appendChild(lineRow);

    // 行先（区間の1つ目にのみ表示）
    if (item.headsign) {
        const headsignRow = document.createElement('div');
        headsignRow.className = 'timeline-meta-row';
        const headsignSpan = document.createElement('span');
        headsignSpan.className = 'timeline-detail';
        const headsignText = [item.headsign, ...item.alternativeHeadsigns].map(h => `${h}行`).join('・');
        headsignSpan.textContent = headsignText;
        headsignRow.appendChild(headsignSpan);
        segContentDiv.appendChild(headsignRow);
    }

    // 停車駅数
    const metaRow = document.createElement('div');
    metaRow.className = 'timeline-meta-row';
    const stopsDetail = document.createElement('span');
    stopsDetail.className = 'timeline-detail';
    stopsDetail.textContent = `${stopsCount}駅目で降車`;
    metaRow.appendChild(stopsDetail);
    segContentDiv.appendChild(metaRow);

    // 途中駅表示ボタン（途中駅がある場合のみ）
    if (item.midStops.length > 0) {
        const stopsRow = document.createElement('div');
        stopsRow.className = 'timeline-meta-row';
        const stopsObj = createStopsButton(item, model);
        if (stopsObj) {
            // ボタンは内容側に表示
            if (stopsObj.button) stopsRow.appendChild(stopsObj.button);
            // マーカー列はマーカー側コンテナに追加して縦線と揃える
            if (stopsObj.markerList) segMarkerDiv.appendChild(stopsObj.markerList);
        }
        segContentDiv.appendChild(stopsRow);
        // 情報側の停車駅リストを内容側に追加
        if (stopsObj && stopsObj.infoList) {
            segContentDiv.appendChild(stopsObj.infoList);
        }
    }

    segmentRow.appendChild(segContentDiv);
    return segmentRow;
}

// ========================================
// 途中駅表示ボタン作成
// ========================================
function createStopsButton(item, model) {
    if (!item.midStops || item.midStops.length === 0) {
        return null;
    }

    const stopsId = `stops-${Math.random().toString(36).substr(2, 9)}`;
    const btnId = `btn-${stopsId}`;

    // ボタン（内容側に表示）
    const button = document.createElement('button');
    button.className = 'btn btn-outline-pill';
    button.id = btnId;
    button.textContent = '▼ 途中駅を表示';

    // 情報側の停車駅リスト（駅名＋時間）
    const infoList = document.createElement('div');
    infoList.className = 'timeline-stops';
    infoList.id = stopsId;

    // マーカー側のリスト（マーカーのみ、縦に並べる）
    const markerList = document.createElement('div');
    markerList.className = 'timeline-stop-markers';
    markerList.id = `${stopsId}-markers`;

    item.midStops.forEach(stop => {
        const infoRow = document.createElement('div');
        infoRow.className = 'timeline-stop';

        const stopName = document.createElement('div');
        stopName.className = 'timeline-stop-name';
        stopName.textContent = model.stationName(stop.stationId) || stop.stationId;

        const stopElapsed = document.createElement('div');
        stopElapsed.className = 'timeline-stop-elapsed';
        stopElapsed.textContent = formatSeconds(stop.elapsedFromSectionStart);

        infoRow.appendChild(stopName);
        infoRow.appendChild(stopElapsed);
        infoList.appendChild(infoRow);

        // マーカー側の行（高さをinfoRowに合わせるスタイルで揃える）
        const markerRow = document.createElement('div');
        markerRow.className = 'timeline-stop-marker-row';
        const marker = document.createElement('div');
        marker.className = 'timeline-stop-marker';
        // 色を路線に合わせる（線色を境界線に反映）
        try {
            if (item.lineColor) {
                marker.style.borderColor = item.lineColor;
            }
        } catch (e) {
            // ignore style errors in older browsers
        }
        markerRow.appendChild(marker);
        markerList.appendChild(markerRow);
    });

    // ボタン動作：情報側とマーカー側の両方をトグル
    button.addEventListener('click', () => {
        const active = !infoList.classList.contains('is-expanded');
        infoList.classList.toggle('is-expanded', active);
        markerList.classList.toggle('is-expanded', active);
        button.textContent = active ? '▲ 途中駅を非表示' : '▼ 途中駅を表示';

        if (active) {
            // マーカー列（timeline-marker-col側）と情報列（timeline-content側）は別カラムのため、
            // 情報側の1行目の実際の描画位置を測ってマーカー列の開始位置を合わせる
            const firstInfoRow = infoList.querySelector('.timeline-stop');
            const markerContainer = markerList.parentElement;
            if (firstInfoRow && markerContainer) {
                const offset = firstInfoRow.getBoundingClientRect().top - markerContainer.getBoundingClientRect().top;
                markerList.style.marginTop = `${offset}px`;
            }
        } else {
            markerList.style.marginTop = '';
        }

        // 途中駅の展開/折り畳みで行の高さが変わるため、タイムライン線も再調整する
        requestAnimationFrame(() => {
            alignRouteCardTimelineLines(button.closest('.route-card'));
        });
    });

    return { button, infoList, markerList };
}

// ========================================
// UI制御関数（showLoading/hideLoading/showError/hideError は shared/ui-dom.js を使用）
// ========================================
function hideResults() {
    document.getElementById('results-section').style.display = 'none';
    try {
        document.body.classList.remove('results-open');
    } catch (e) { /* noop */ }
}

function hideSearchSection() {
    document.getElementById('search-section').style.display = 'none';
}

function showSearchSection() {
    document.getElementById('search-section').style.display = 'block';
}

// 共有ダイアログ表示は shared/ui-dom.js の showShareDialog を使用（インポート済み）

// ========================================
// タブスクロール用の補助（スクロールバー非表示 + 両端に矢印）
// - .route-tabs を .route-tabs-wrapper でラップし、左右に chevron を表示
// - タブに overflow があるときのみ chevrons を表示
// - ユーザーがスクロールしたら chevrons をフェードアウトする
// ========================================
function setupScrollableTabs(tabs) {
    if (!tabs || !tabs.parentNode) return;

    // If already wrapped, don't wrap again
    if (tabs.parentNode.classList && tabs.parentNode.classList.contains('route-tabs-wrapper')) {
        // ensure overflow state
        updateOverflowState(tabs);
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'route-tabs-wrapper';

    // Replace tabs node with wrapper and append tabs inside
    const parent = tabs.parentNode;
    parent.replaceChild(wrapper, tabs);
    wrapper.appendChild(tabs);

    // scroll/resize/mutation handling
    // Use a small delay initially to allow the layout to settle before measurement.
    function updateOverflowState(el) {
        // More robust overflow detection: prefer measuring scrollWidth vs clientWidth
        // but also tolerate sub-pixel/rounding differences. Consider last child's right edge
        // if needed.
        const scrollW = el.scrollWidth || 0;
        const clientW = el.clientWidth || 0;
        const buffer = 2; // tolerance to avoid false negatives due to rounding
        const hasOverflow = (scrollW - clientW) > buffer;

        wrapper.classList.toggle('has-overflow', hasOverflow);

        // Check if at initial position (scrollLeft is 0 or very close to 0)
        const isAtStart = (el.scrollLeft || 0) < 1;

        // Show chevrons only when: overflow exists AND at initial position
        if (hasOverflow && isAtStart) {
            wrapper.classList.remove('chevrons-hidden');
        } else {
            wrapper.classList.add('chevrons-hidden');
        }
    }

    // Initial delayed measurement so that DOM/CSS layout finishes
    setTimeout(() => updateOverflowState(tabs), 50);

    // Watch for container resizes
    window.addEventListener('resize', () => updateOverflowState(tabs));

    // Use ResizeObserver to detect content/size changes of the tabs element
    let ro = null;
    if (window.ResizeObserver) {
        ro = new ResizeObserver(() => updateOverflowState(tabs));
        try { ro.observe(tabs); } catch (e) { /* ignore */ }
    }

    // MutationObserver to detect tab additions/removals/label changes
    let mo = null;
    if (window.MutationObserver) {
        mo = new MutationObserver(() => {
            // schedule measurement on next frame to let DOM settle
            requestAnimationFrame(() => updateOverflowState(tabs));
        });
        try { mo.observe(tabs, { childList: true, subtree: true, characterData: true }); } catch (e) { /* ignore */ }
    }

    // When user scrolls or interacts, update chevron visibility
    tabs.addEventListener('scroll', () => updateOverflowState(tabs), { passive: true });
    tabs.addEventListener('pointerdown', () => updateOverflowState(tabs), { passive: true });
    tabs.addEventListener('touchstart', () => updateOverflowState(tabs), { passive: true });

    // expose update function for possible external calls
    tabs.__updateOverflowState = () => updateOverflowState(tabs);

    // cleanup hook in case tabs are removed later
    tabs.__cleanupScrollableTabs = () => {
        window.removeEventListener('resize', () => updateOverflowState(tabs));
        try { if (ro) ro.disconnect(); } catch (e) {}
        try { if (mo) mo.disconnect(); } catch (e) {}
    };
}
