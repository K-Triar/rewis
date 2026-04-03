// ========================================
// グローバル変数
// ========================================
let appData = null;
let preprocessedData = null;
let viaStationCount = 0;
// Unique counter for DOM element ids of via inputs. This is separate from the
// displayed sequential index which is computed from the visible items.
let viaUniqueIdCounter = 0;
let brandName = 'Kトライア交通グループ';
let ownCompanyId = 'KT';
// Handlers used to prevent scrolling on mobile while keeping the scrollbar visible
let _loadingPreventHandlers = null;
// 検索モード: 'time' | 'balance' | 'transfer' (default: balance)
let searchMode = 'balance';

function getPublicWorkerApiBase() {
    const configured = String(window.REWIS_PUBLIC_DATA_SOURCE?.workerApiBase || '').trim();
    const saved = String(localStorage.getItem('rewis_worker_api_base') || '').trim();
    return (configured || saved).replace(/\/$/, '');
}

function extractPublicDataPayload(payload) {
    if (payload && typeof payload === 'object') {
        if (payload.data && typeof payload.data === 'object') {
            return payload.data;
        }
        return payload;
    }
    throw new Error('不正なデータ形式です');
}

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
        appData = await loadData();
        console.log('データ読み込み完了:', appData ? 'OK' : 'NG');
        console.log('駅数:', appData?.stations?.length || 0);
        
        // ブランド名・自社線ID取得
        if (appData && appData.meta) {
            if (appData.meta.appName) {
                brandName = appData.meta.appName.replace(/乗換案内システム$/, '').trim();
            }
            if (appData.meta.ownCompanyId) {
                ownCompanyId = appData.meta.ownCompanyId;
            }
        }
        console.log('データ前処理開始...');
        preprocessData();
        console.log('データ前処理完了');
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
// （async即時実行バージョンのみ残す）

// データ読み込み
// ========================================
async function loadData() {
    try {
        const workerBase = getPublicWorkerApiBase();
        if (workerBase) {
            try {
                const workerResponse = await fetch(workerBase + '/data/latest', { cache: 'no-store' });
                if (workerResponse.ok) {
                    const payload = await workerResponse.json();
                    const data = extractPublicDataPayload(payload);
                    console.log('Workers からデータ読み込み完了:', data);
                    return data;
                }
                console.warn('Workers data fetch failed with status:', workerResponse.status);
            } catch (workerError) {
                console.warn('Workers data fetch failed, fallback to data.json:', workerError);
            }
        }

        const response = await fetch('data.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('データファイルが見つかりません');
        }
        const data = await response.json();
        console.log('データ読み込み完了:', data);
        return data;
    } catch (error) {
        console.error('データ読み込みエラー:', error);
        throw error;
    }
}

// ========================================
// データ前処理（高速化のためのインデックス作成）
// ========================================
// 降車専用区間（isAlightOnly: true）について：
// - 降車専用区間は、始点駅からの乗車が禁止される
// - 経路探索時、出発駅からの最初の移動では使用できない
// - 既に列車に乗車している状態（途中駅）からは通過できる
// - これにより、特定の駅からのみ乗車できる列車の設定が可能
function preprocessData() {
    console.log('データ前処理開始...');
    
    if (!appData) {
        throw new Error('appDataが存在しません');
    }
    if (!appData.stations || !Array.isArray(appData.stations)) {
        throw new Error('appData.stationsが無効です');
    }
    if (!appData.lines || !Array.isArray(appData.lines)) {
        throw new Error('appData.linesが無効です');
    }

    // 駅IDから駅情報へのマップ
    const stationMap = new Map();
    appData.stations.forEach(station => {
        stationMap.set(station.stationId, station);
    });
    console.log('駅マップ作成完了:', stationMap.size, '件');

    // 路線IDから路線情報へのマップ
    const lineMap = new Map();
    appData.lines.forEach(line => {
        lineMap.set(line.lineId, line);
    });
    console.log('路線マップ作成完了:', lineMap.size, '件');

    // 各路線のstationOrderから各駅を通る路線を抽出して駅データに追加
    const stationLinesMap = new Map(); // stationId -> Set of {lineId, companyId}
    appData.lines.forEach(line => {
        const lineId = line.lineId;
        const companyId = line.companyId;
        const stationOrder = line.stationOrder || [];
        
        // stationOrderに含まれる各駅に路線情報を追加
        stationOrder.forEach(stationId => {
            if (!stationLinesMap.has(stationId)) {
                stationLinesMap.set(stationId, new Map());
            }
            stationLinesMap.get(stationId).set(lineId, companyId);
        });
    });
    
    // 駅データにlines配列を追加
    stationMap.forEach((station, stationId) => {
        if (stationLinesMap.has(stationId)) {
            const linesMap = stationLinesMap.get(stationId);
            station.lines = Array.from(linesMap.entries()).map(([lineId, companyId]) => ({
                lineId: lineId,
                companyId: companyId
            }));
        } else {
            station.lines = [];
        }
    });
    console.log('駅の路線情報を構築完了');

    // 会社IDから会社情報へのマップ
    const companyMap = new Map();
    appData.companies.forEach(company => {
        companyMap.set(company.companyId, company);
    });

    // 列車種別IDから種別情報へのマップ（UI等で参照するため保持）
    const trainTypeMap = new Map();
    appData.trainTypes.forEach(type => {
        trainTypeMap.set(type.trainTypeId, type);
    });

    // 隣接リスト作成（駅×路線×種別をノードとする）
    // ★ 区切り文字を _ から | に変更
    const adjacencyList = new Map();

    // Helper: add adjacency entry
    // ノードキーは `stationId|lineId|guidance` として案内種別（guidance）を基準にする
    function addEdge(fromStationId, toStationId, lineId, guidance, duration, segmentRef, isAlightOnly = false) {
        const fromKey = `${fromStationId}|${lineId}|${guidance}`;
        const toKey = `${toStationId}|${lineId}|${guidance}`;

        if (!adjacencyList.has(fromKey)) adjacencyList.set(fromKey, []);
        adjacencyList.get(fromKey).push({
            type: 'segment',
            toKey: toKey,
            fromStationId: fromStationId,
            toStationId: toStationId,
            lineId: lineId,
            guidance: guidance,
            duration: duration,
            segment: segmentRef,
            isAlightOnly: isAlightOnly
        });
    }

    appData.segments.forEach(segment => {
        const isAlightOnly = segment.isAlightOnly || false;
        const a = segment.fromStationId;
        const b = segment.toStationId;
        const lineId = segment.lineId;
        const guidance = segment.guidance;
        
        // 直接接続を追加（segmentの所要時間をそのまま使用）
        // ノードは guidance を基準に構築する
        addEdge(a, b, lineId, guidance, segment.duration, {
            ...segment,
            hopFrom: a,
            hopTo: b
        }, isAlightOnly);

        // 双方向の場合は逆方向も追加（降車専用は元の方向のみ）
            if (segment.isBidirectional) {
            addEdge(b, a, lineId, guidance, segment.duration, {
                ...segment,
                hopFrom: b,
                hopTo: a
            }, false);  // 逆方向は降車専用ではない
        }
    });

    // 直通運転設定マップを作成（相互・一方向対応）
    const throughServiceMap = new Map();
    if (appData.throughServiceConfigs) {
        appData.throughServiceConfigs.forEach(config => {
            // 乗入元→乗入先の設定
            const keyForward = `${config.fromLineId}|${config.fromGuidance}|${config.toLineId}|${config.toGuidance}`;
            throughServiceMap.set(keyForward, config);
            
            // 相互直通の場合は逆方向も登録
            if (config.isBidirectional) {
                const keyReverse = `${config.toLineId}|${config.toGuidance}|${config.fromLineId}|${config.fromGuidance}`;
                throughServiceMap.set(keyReverse, {
                    ...config,
                    fromLineId: config.toLineId,
                    toLineId: config.fromLineId,
                    fromGuidance: config.toGuidance,
                    toGuidance: config.fromGuidance
                });
            }
        });
    }

    // のりば間乗換時間マップを作成
    const platformTransferMap = new Map();
    if (appData.platformTransfers) {
        appData.platformTransfers.forEach(transfer => {
            // 基本キー（種別指定なし）
            const key = `${transfer.stationId}|${transfer.fromPlatform}|${transfer.toPlatform}`;
            platformTransferMap.set(key, transfer);
        });
    }

    // 駅・のりばからセグメント情報を引くマップ
    const platformToSegments = new Map();
    appData.segments.forEach(segment => {
        Object.entries(segment.platforms).forEach(([stationId, platform]) => {
            const key = `${stationId}|${platform}`;
            if (!platformToSegments.has(key)) {
                platformToSegments.set(key, []);
            }
            platformToSegments.get(key).push(segment);
        });
    });

    // 乗換情報を隣接リストに追加
    // 異なる路線への乗換と、同一路線・異なる種別への乗換の両方を処理
    appData.segments.forEach(fromSegment => {
        Object.entries(fromSegment.platforms).forEach(([stationId, fromPlatform]) => {
            // ノードキーは案内種別（guidance）を基準にする
            const fromGuidance = fromSegment.guidance;
            const fromKey = `${stationId}|${fromSegment.lineId}|${fromGuidance}`;
            
            if (!adjacencyList.has(fromKey)) {
                adjacencyList.set(fromKey, []);
            }

            // 同じ駅の他のセグメントを探す
            appData.segments.forEach(toSegment => {
                if (toSegment.platforms[stationId]) {
                    const toPlatform = toSegment.platforms[stationId];
                    const toGuidance = toSegment.guidance;
                    const toKey = `${stationId}|${toSegment.lineId}|${toGuidance}`;

                    // 同じノードへの乗換は不要
                    if (fromKey === toKey) return;

                    // のりば間の乗換時間を取得
                    let transferTime = 0;
                    let isDirectThrough = false;
                    let isTypeChange = false;

                    // 直通運転の可能性をチェック（guidanceで判定）
                    const throughKey = `${fromSegment.lineId}|${fromGuidance}|${toSegment.lineId}|${toGuidance}`;
                    const throughConfig = throughServiceMap.get(throughKey);
                    
                    // Treat platform equality only when both platforms are explicitly defined.
                    const fromPlatformDefined = fromPlatform !== undefined && fromPlatform !== null && fromPlatform !== '';
                    const toPlatformDefined = toPlatform !== undefined && toPlatform !== null && toPlatform !== '';
                    const samePlatform = fromPlatformDefined && toPlatformDefined && (fromPlatform === toPlatform);

                    if (throughConfig && samePlatform) {
                        // 直通運転設定がある場合（かつ両方ののりばが定義されていて一致する場合）
                        transferTime = 0;
                        isDirectThrough = true;
                        isTypeChange = false;
                    } else {
                        // 通常の乗換・種別変更（表示上は区別しない）
                        if (fromSegment.lineId === toSegment.lineId && fromGuidance !== toGuidance) {
                            // 同一路線かつ異なる案内種別 → 種別変更フラグを立てる
                            isTypeChange = true;
                        }
                        
                        if (samePlatform) {
                            // 同じのりば（両方定義かつ一致）の場合は5秒
                            transferTime = 5;
                        } else if (fromPlatformDefined && toPlatformDefined) {
                            // 両方ののりばが定義されているが異なる場合はdata.jsonの乗換情報を参照
                            const transferKey = `${stationId}|${fromPlatform}|${toPlatform}`;
                            const transfer = platformTransferMap.get(transferKey);
                            if (transfer) {
                                transferTime = transfer.transferTime;
                            } else {
                                // 定義がない場合はデフォルト10秒
                                transferTime = 10;
                            }
                        } else {
                            // どちらかののりばが未定義の場合は同一のりば扱いにせず、デフォルトの乗換時間を適用
                            transferTime = 10;
                        }
                        isDirectThrough = false;
                    }

                    adjacencyList.get(fromKey).push({
                        type: 'transfer',
                        toKey: toKey,
                        toStationId: stationId,
                        lineId: toSegment.lineId,
                        guidance: toGuidance,
                        duration: transferTime,
                        fromPlatform: fromPlatform,
                        toPlatform: toPlatform,
                        fromLineId: fromSegment.lineId,
                        toLineId: toSegment.lineId,
                        fromGuidance: fromGuidance,
                        toGuidance: toGuidance,
                        isDirectThrough: isDirectThrough,
                        isTypeChange: isTypeChange
                    });
                }
            });
        });
    });

    preprocessedData = {
        stationMap,
        lineMap,
        companyMap,
        trainTypeMap,
        adjacencyList,
        throughServiceMap
    };

    console.log('データ前処理完了');
    console.log('隣接リストサイズ:', adjacencyList.size);
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
            swapBtnEl.classList.remove('spinning');
            void swapBtnEl.offsetWidth; // force reflow to restart animation
            swapBtnEl.classList.add('spinning');
        });
        swapBtnEl.addEventListener('animationend', () => {
            swapBtnEl.classList.remove('spinning');
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

    const mbNav = document.getElementById('mobile-bottom-nav');
    const mbMenuBtn = document.getElementById('mb-menu-btn');
    if (mbNav) {
        // Use event delegation: single handler for all mobile items
        mbNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.mb-item');
            if (!btn) return;
            if (btn.classList.contains('mb-menu')) {
                toggleBottomSheet();
                return;
            }

            // close sheet if open when moving to a linked page
            closeBottomSheet();
        });
    }

    // Adaptive search-section sizing removed: stable mobile layout only.
    // Formerly `setupSearchSectionSizing()` toggled `body.search-compact` based
    // on the measured `.search-section` height; that height-dependent switching
    // caused instability on some mobile devices and has been removed.
}

// 検索モードUIの初期化
function setupSearchModeToggle() {
    const container = document.getElementById('search-mode-toggle');
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('.search-mode-btn'));

    function setMode(mode) {
        searchMode = mode;
        
        // 選択されたボタンの位置と幅を取得
        let selectedBtn = null;
        buttons.forEach((btn, index) => {
            const m = btn.dataset.mode;
            const selected = m === mode;
            btn.classList.toggle('selected', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            if (selected) selectedBtn = btn;
        });
        
        // 選択されたボタンの実際の幅と位置を取得してCSS変数に設定
        if (selectedBtn) {
            const btnRect = selectedBtn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const leftOffset = btnRect.left - containerRect.left;
            
            container.style.setProperty('--bg-width', `${btnRect.width}px`);
            container.style.setProperty('--bg-left', `${leftOffset}px`);
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
            suggestionsDiv.classList.remove('active');
            return;
        }

        const matchingStations = searchStations(query);
        displaySuggestions(matchingStations, suggestionsDiv, input);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestionsDiv.classList.remove('active');
        }, 200);
    });
}

function searchStations(query) {
    if (!appData || !appData.stations) {
        console.error('appData.stations is not available');
        return [];
    }
    
    const lowerQuery = query.toLowerCase();
    
    return appData.stations.filter(station => {
        return station.stationName.includes(query) ||
               station.stationNameKana.includes(lowerQuery) ||
               convertToHiragana(station.stationName).includes(lowerQuery);
    }).slice(0, 10);
}

// ----------------------------------------
// ヘルプモーダルの開閉 (index.html のヘルプボタン)
// ----------------------------------------
// このスクリプトは既存の initializeUI と独立しており、
// DOM が利用可能になったらイベントをバインドします。
document.addEventListener('DOMContentLoaded', () => {
    const helpButton = document.getElementById('help-button');
    const helpModal = document.getElementById('help-modal');
    const closeHelpBtn = document.getElementById('close-help');

    function openHelp() {
        if (!helpModal) return;
        // share-modal styles expect a centered overlay; use flex for centering
        helpModal.style.display = 'flex';
    }

    function closeHelp() {
        if (!helpModal) return;
        helpModal.style.display = 'none';
    }

    if (helpButton) helpButton.addEventListener('click', openHelp);
    if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelp);

    // Click on backdrop (modal container) closes the modal
    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                closeHelp();
            }
        });
    }
});

// Mobile bottom-sheet helpers (menu)
function openBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    const btn = document.getElementById('mb-menu-btn');
    const backdrop = document.getElementById('sheet-backdrop');
    if (!sheet) return;
    if (btn) btn.classList.add('active');

    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    if (backdrop) {
        backdrop.classList.add('open');
        backdrop.setAttribute('aria-hidden', 'false');
    }
    if (btn) btn.setAttribute('aria-expanded', 'true');
}

function closeBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    const btn = document.getElementById('mb-menu-btn');
    const backdrop = document.getElementById('sheet-backdrop');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (backdrop) {
        backdrop.classList.remove('open');
        backdrop.setAttribute('aria-hidden', 'true');
    }
    if (btn) btn.classList.remove('active');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return;
    if (sheet.classList.contains('open')) closeBottomSheet(); else openBottomSheet();
}

// Wire bottom-sheet interactions (click outside to close, sheet buttons)
document.addEventListener('DOMContentLoaded', () => {
    const sheet = document.getElementById('bottom-sheet');
    const closeBtn = document.getElementById('sheet-close');
    const backdrop = document.getElementById('sheet-backdrop');
    if (sheet) {
        sheet.addEventListener('click', (e) => {
            if (e.target === sheet) closeBottomSheet();
        });
        const items = sheet.querySelectorAll('.sheet-item');
        items.forEach(it => {
            it.addEventListener('click', () => {
                closeBottomSheet();
            });
        });
    }
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            closeBottomSheet();
        });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeBottomSheet);

    // Placeholder links (#) and current-page links should not navigate.
    document.querySelectorAll('a[data-noop="true"], a.is-current-page').forEach(link => {
        link.addEventListener('click', (e) => e.preventDefault());
    });
});

function displaySuggestions(stations, suggestionsDiv, input) {
    if (stations.length === 0) {
        suggestionsDiv.classList.remove('active');
        return;
    }

    suggestionsDiv.innerHTML = '';
    
    stations.forEach(station => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        
        // 路線名を取得して表示用に整形（preprocessedDataが存在しない場合はlineIdを使用）
        // 仕様:
        // 1) 元の路線名を取得
        // 2) 名前に「線」が含まれる場合は「線」までを表示（それ以降は省略）
        // 3) 表示名が重複する場合は一つだけ表示
        let linesText = '';
        if (preprocessedData && preprocessedData.lineMap) {
            const displayNames = station.lines.map(l => {
                const line = preprocessedData.lineMap.get(l.lineId);
                let name = line ? line.lineName : l.lineId;
                if (typeof name !== 'string') name = String(name || '');
                // if contains '線', truncate to that character (inclusive)
                const idx = name.indexOf('線');
                if (idx !== -1) {
                    name = name.slice(0, idx + 1).trim();
                }
                return name;
            });

            // Deduplicate while preserving order
            const seen = new Set();
            const unique = [];
            for (const n of displayNames) {
                if (!seen.has(n)) {
                    seen.add(n);
                    unique.push(n);
                }
            }
            linesText = unique.join('・');
        } else {
            linesText = station.lines.map(l => l.lineId).join('・');
        }
        
        item.innerHTML = `
            <span class="station-name">${station.stationName}</span>
            <span class="station-lines">${linesText}</span>
        `;
        
        item.addEventListener('click', () => {
            input.value = station.stationName;
            suggestionsDiv.classList.remove('active');
        });
        
        suggestionsDiv.appendChild(item);
    });

    suggestionsDiv.classList.add('active');
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
        <div class="station-badge">経${displayIndex}</div>
        <div class="input-wrapper">
            <input 
                type="text" 
                id="${viaId}" 
                class="station-input" 
                placeholder="経由駅"
                autocomplete="off"
            >
            <div class="suggestions" id="${suggestionsId}"></div>
        </div>
        <button type="button" class="remove-via-button">
            ✕
        </button>
    `;

    viaStationsDiv.appendChild(viaItem);

    // Attach remove listener using the stable unique id
    const removeBtn = viaItem.querySelector('.remove-via-button');
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
        const badge = item.querySelector('.station-badge');
        if (badge) badge.textContent = `経${idx + 1}`;
    });
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
    if (departureStation.stationId === arrivalStation.stationId) {
        showError('出発駅と到着駅が同じです');
        return;
    }

    const viaStations = [];
    const viaItems = document.querySelectorAll('.via-station-item');
    for (let item of viaItems) {
        const viaId = item.querySelector('.station-input').id;
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
            const routes = findRoutes(departureStation, arrivalStation, viaStations, filters);
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
    if (!name) return null;
    return appData.stations.find(s => s.stationName === name);
}

function findStationById(id) {
    if (!id) return null;
    return appData.stations.find(s => s.stationId === id);
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
        params.set('from', departureStation.stationId);
    }
    if (arrivalStation) {
        params.set('to', arrivalStation.stationId);
    }
    
    // 経由駅（via1, via2, ...）
    viaStations.forEach((station, index) => {
        params.set(`via${index + 1}`, station.stationId);
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
            const btn = container.querySelector(`.search-mode-btn[data-mode="${searchMode}"]`);
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
            document.getElementById('departure').value = fromStation.stationName;
            console.log('出発駅設定:', fromStation.stationName);
        } else {
            console.warn('出発駅が見つかりません:', fromId);
        }
    }
    
    // 到着駅を設定
    const toId = params.get('to');
    if (toId) {
        const toStation = findStationById(toId);
        if (toStation) {
            document.getElementById('arrival').value = toStation.stationName;
            console.log('到着駅設定:', toStation.stationName);
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
            const viaInput = lastViaItem.querySelector('.station-input');
            if (viaInput) {
                viaInput.value = viaStation.stationName;
                console.log(`経由駅${viaIndex}設定:`, viaStation.stationName);
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
// 経路探索アルゴリズム（修正Dijkstra法）
// ========================================
function findRoutes(startStation, endStation, viaStations, filters) {
    console.log('\n--- 経路探索開始 ---');
    console.log('出発駅:', startStation.stationName, startStation.stationId);
    console.log('到着駅:', endStation.stationName, endStation.stationId);
    console.log('経由駅:', viaStations.map(s => s.stationName));
    console.log('フィルタ:', filters);

    // 経由駅指定時も単一探索を使用（制約付きDijkstra）
    const routes = [];
    const maxRoutes = 5;

    const startKeys = [];
    // 開始ノードは station|line|guidance の組合せで作成する
    startStation.lines.forEach(line => {
        // UI で選択された列車種別（trainType）で当該路線が許可されているかを確認
        const lineInfo = preprocessedData.lineMap.get(line.lineId);
        const lineTrainType = lineInfo ? lineInfo.trainType : null;
        if (!filters.allowedTrainTypes.has(lineTrainType)) {
            // この路線の車両種別がフィルタで除外されている場合は開始ノードを作らない
            return;
        }

        // 駅に接続するセグメントから案内種別(guidance)の一覧を収集してノードを作成
        const guidanceSet = new Set();
        appData.segments.forEach(seg => {
            if (seg.lineId === line.lineId && (seg.fromStationId === startStation.stationId || seg.toStationId === startStation.stationId)) {
                if (seg.guidance) guidanceSet.add(seg.guidance);
            }
        });

        guidanceSet.forEach(guidance => {
            const key = `${startStation.stationId}|${line.lineId}|${guidance}`;
            if (preprocessedData.adjacencyList.has(key)) {
                startKeys.push(key);
            } else {
                console.warn(`開始ノードが隣接リストに存在しません: ${key}`);
            }
        });
    });

    console.log('探索開始ノード（startKeys）:', startKeys);

    if (startKeys.length === 0) {
        console.error('探索開始点がありません');
        return [];
    }

    startKeys.forEach(startKey => {
        console.log(`Dijkstra探索開始: ${startKey} (経由駅: ${viaStations.length}駅)`);
        const route = dijkstraSearch(startKey, endStation.stationId, viaStations, filters);
        if (route) {
            console.log('探索成功: 経路情報', route);
            routes.push(route);
        } else {
            console.warn(`経路が見つかりませんでした: ${startKey}`);
        }
    });

    const uniqueRoutes = deduplicateRoutes(routes);
    
    // 乗換ペナルティを考慮したソート用スコアを計算（表示用のtotalDurationは変更しない）
    // searchMode に応じたペナルティを使用
    const TRANSFER_PENALTY = getTransferPenalty(searchMode); // 秒
    uniqueRoutes.sort((a, b) => {
        const scoreA = a.totalDuration + (a.transferCount * TRANSFER_PENALTY);
        const scoreB = b.totalDuration + (b.transferCount * TRANSFER_PENALTY);
        
        if (scoreA !== scoreB) {
            return scoreA - scoreB;
        }
        // スコアが同じ場合は実際の所要時間で比較
        if (a.totalDuration !== b.totalDuration) {
            return a.totalDuration - b.totalDuration;
        }
        // 所要時間も同じ場合は乗換回数で比較
        return a.transferCount - b.transferCount;
    });

    console.log('--- 探索結果 ---');
    console.log(`${uniqueRoutes.length}件の経路が見つかりました`);
    return uniqueRoutes.slice(0, maxRoutes);
}

// ========================================
// Dijkstra法による経路探索
// ========================================
function dijkstraSearch(startKey, endStationId, requiredViaStations, filters) {
    const distances = new Map();
    const previous = new Map();
    const visited = new Set();
    const visitedStations = new Map(); // 状態ごとに訪問済み駅を記録
    const queue = new MinPriorityQueue();

    const [startStationId] = startKey.split('|');
    // 状態を "nodeKey@@viaIndex" の形式で管理（@@は区切り文字、|と混同しないため）
    const initialState = `${startKey}@@0`;
    distances.set(initialState, 0);
    visitedStations.set(initialState, new Set([startStationId]));
    queue.enqueue(initialState, 0);

    let step = 0;

    while (!queue.isEmpty()) {
        step++;
        const currentState = queue.dequeue();
        if (visited.has(currentState)) continue;
        visited.add(currentState);

        // 状態を分解: "stationId|lineId|guidance@@viaIndex"
        const [currentKey, viaIndexStr] = currentState.split('@@');
        const viaIndex = parseInt(viaIndexStr);
        const currentDistance = distances.get(currentState);
        const [currentStationId, currentLineId, currentGuidance] = currentKey.split('|');
        console.log(`[Step ${step}] 現在状態: ${currentState} (駅ID: ${currentStationId}, 経由済み: ${viaIndex}/${requiredViaStations.length}) 距離: ${currentDistance}`);

        // 到着判定：endStationId に到達 AND すべての経由駅を通過済み
        if (currentStationId === endStationId && viaIndex === requiredViaStations.length) {
            console.log(`✅ 到達駅に到達（全経由駅通過済み）: ${currentState}`);
            return reconstructRoute(initialState, currentState, previous);
        }

        const neighbors = preprocessedData.adjacencyList.get(currentKey) || [];
        console.log(`  隣接ノード数: ${neighbors.length}`);

        // 現在の状態での訪問済み駅リストを取得
        const currentVisitedStations = visitedStations.get(currentState) || new Set();

        for (let neighbor of neighbors) {
            const nextKey = neighbor.toKey;
            const [nextStationId] = nextKey.split('|');

            // 降車専用区間のチェック：始点駅からは乗車できない
            if (neighbor.isAlightOnly && currentState === initialState) {
                console.log(`    スキップ（降車専用区間・始点駅からの乗車不可）: ${nextKey}`);
                continue;
            }

            // 出発駅からの乗換・種別変更を禁止
            if (currentState === initialState && neighbor.type === 'transfer') {
                console.log(`    スキップ（出発駅からの乗換禁止）: ${nextKey}`);
                continue;
            }

            // 経由駅通過チェック
            let newViaIndex = viaIndex;
            let newVisitedStations = new Set(currentVisitedStations);

            // 現在の駅が次に通過すべき経由駅かチェック
            if (viaIndex < requiredViaStations.length &&
                currentStationId === requiredViaStations[viaIndex].stationId) {
                // 経由駅を通過！→ viaIndex を +1 して訪問リストをリセット
                newViaIndex = viaIndex + 1;
                newVisitedStations = new Set([currentStationId]);
                console.log(`  ✓ 経由駅 ${viaIndex + 1} を通過: ${currentStationId} → viaIndex=${newViaIndex}`);
            }

            // 駅の重複チェック：segment（移動）の場合のみチェック
            // transfer（乗換）は同じ駅内での移動なので重複チェック対象外
            if (neighbor.type === 'segment') {
                if (newVisitedStations.has(nextStationId)) {
                    console.log(`    スキップ（駅重複）: ${nextKey} (駅ID: ${nextStationId})`);
                    continue;
                }
            }

            if (!passesFilter(neighbor, filters)) {
                console.log(`    フィルタ除外: ${nextKey}`);
                continue;
            }

            const nextState = `${nextKey}@@${newViaIndex}`;
            
            if (visited.has(nextState)) {
                console.log(`    スキップ（訪問済状態）: ${nextState}`);
                continue;
            }

            const newDistance = currentDistance + neighbor.duration;
            const oldDistance = distances.get(nextState);

            if (oldDistance === undefined || newDistance < oldDistance) {
                distances.set(nextState, newDistance);
                previous.set(nextState, { state: currentState, edge: neighbor });
                
                // 訪問済み駅リストを更新
                // segment（移動）の場合のみ訪問駅を追加
                if (neighbor.type === 'segment') {
                    newVisitedStations.add(nextStationId);
                }
                visitedStations.set(nextState, newVisitedStations);
                
                queue.enqueue(nextState, newDistance);
                console.log(`    キュー追加: ${nextState} 距離: ${newDistance}`);
            }
        }
    }

    console.warn('Dijkstra探索終了：到着駅に到達できませんでした');
    return null;
}

// ========================================
// 優先度キュー（簡易実装）
// ========================================
class MinPriorityQueue {
    constructor() {
        this.items = [];
    }

    enqueue(item, priority) {
        this.items.push({ item, priority });
        this.items.sort((a, b) => a.priority - b.priority);
    }

    dequeue() {
        return this.items.shift()?.item;
    }

    isEmpty() {
        return this.items.length === 0;
    }
}

// ========================================
// フィルター判定
// ========================================
function passesFilter(neighbor, filters) {
    // フィルタは路線の trainType（車両種別）で判定する
    const lineInfoForFilter = preprocessedData.lineMap.get(neighbor.lineId);
    const neighborLineTrainType = lineInfoForFilter ? lineInfoForFilter.trainType : null;
    if (!filters.allowedTrainTypes.has(neighborLineTrainType)) {
        return false;
    }

    if (filters.onlyOwnCompany) {
        const lineInfo = preprocessedData.lineMap.get(neighbor.lineId);
        if (lineInfo && lineInfo.companyId !== appData.meta.ownCompanyId) {
            return false;
        }
    }

    return true;
}

// ========================================
// 経路復元
// ========================================
function reconstructRoute(startState, endState, previous) {
    const path = [];
    let currentState = endState;

    while (currentState !== startState) {
        const prev = previous.get(currentState);
        if (!prev) break;
        // 状態から nodeKey を抽出（"nodeKey@@viaIndex" → "nodeKey"）
        const [nodeKey] = currentState.split('@@');
        path.unshift({ key: nodeKey, edge: prev.edge });
        currentState = prev.state;
    }

    // 開始状態を追加
    const [startKey] = startState.split('@@');
    path.unshift({ key: startKey, edge: null });
    return buildRouteInfo(path);
}

// ========================================
// 経路情報構築
// ========================================
// 既存の buildRouteInfo をこの実装に置き換えてください
function buildRouteInfo(path) {
    const legs = [];
    let totalDuration = 0;

    // 「直前の乗車（segment）レグ」を追跡してマージ判定に使う
    let lastRideLeg = null;

    for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const [stationId, lineId, guidance] = node.key.split('|');
        const station = preprocessedData.stationMap.get(stationId);
        const line = preprocessedData.lineMap.get(lineId);
        const edge = node.edge;

        // 直前のsegmentのplatforms情報を参照するためにsegment参照を保持
        let prevSegment = null;
        if (i > 0 && path[i-1].edge && path[i-1].edge.type === 'segment') {
            prevSegment = path[i-1].edge.segment;
        }

        if (i === 0) {
            // 開始点は必ず start レグとして独立させる
            legs.push({
                type: 'start',
                stationId,
                stationName: station?.stationName || stationId,
                lineId,
                lineName: line?.lineName || lineId,
                lineColor: line?.lineColor || '#ccc',
                guidance: null, // 開始点は案内種別なし
                duration: 0,
                platform: null // 出発駅は乗車番線を次のsegmentで参照
            });
            lastRideLeg = null;
            continue;
        }

        if (!edge) continue;

        if (edge.type === 'segment') {
            // 乗車レグを新規開始or直前の乗車とマージするか判定
            // 折り返し（同一路線・同種別だが進行方向が逆）の場合は
            // 実際には乗換が発生しているのでマージしない
            const isSameLineAndType = lastRideLeg && lastRideLeg.lineId === lineId && lastRideLeg.guidance === edge.guidance;

            // 直前のsegmentの参照（存在すれば方向判定に使う）
            let isReversal = false;
            if (lastRideLeg && lastRideLeg.segments && lastRideLeg.segments.length > 0 && edge.segment) {
                const prevSeg = lastRideLeg.segments[lastRideLeg.segments.length - 1];
                const currSeg = edge.segment;
                // prevSeg と currSeg が互いに逆向きの hop を持つ場合は折り返し
                if (prevSeg.hopFrom && prevSeg.hopTo && currSeg.hopFrom && currSeg.hopTo) {
                    if (prevSeg.hopFrom === currSeg.hopTo && prevSeg.hopTo === currSeg.hopFrom) {
                        isReversal = true;
                    }
                }
            }

            const isMergeable = isSameLineAndType && !isReversal;

            // 到着駅の番線情報取得
            let arrivalPlatform = null;
            if (edge.segment && edge.segment.platforms && edge.segment.platforms[stationId]) {
                arrivalPlatform = edge.segment.platforms[stationId];
            }

            // 出発駅の番線情報取得（edge.fromStationIdから）
            let departurePlatform = null;
            if (edge.segment && edge.segment.platforms && edge.fromStationId) {
                departurePlatform = edge.segment.platforms[edge.fromStationId];
            }

            if (isMergeable) {
                // 同じ路線・種別を継続する場合は、segmentを追加してマージ
                lastRideLeg.segments.push(edge.segment);
                lastRideLeg.duration += edge.duration;
                lastRideLeg.stationId = stationId;
                lastRideLeg.stationName = station?.stationName || stationId;
                // 到着駅の番線を更新
                lastRideLeg.arrivalPlatform = arrivalPlatform;
            } else {
                // 折り返し（isReversal）の場合は、実際には乗換が発生しているとみなす。
                // ここで簡易的な乗換レグを挿入して表示に反映する。
                if (isReversal && lastRideLeg) {
                    // 直前の到着番線
                    const prevArrivalPlatform = lastRideLeg.arrivalPlatform || null;
                    // 次の出発番線（edge の fromStationId を使って取得）
                    const nextDeparturePlatform = departurePlatform || null;

                    // 乗換時間の概算: 同じのりばなら5秒、そうでなければデフォルト10秒
                    const transferTime = (prevArrivalPlatform && nextDeparturePlatform && prevArrivalPlatform === nextDeparturePlatform) ? 5 : 10;

                    legs.push({
                        type: 'transfer',
                        stationId: lastRideLeg.stationId,
                        stationName: lastRideLeg.stationName,
                        lineId: lastRideLeg.lineId,
                        lineName: lastRideLeg.lineName,
                        lineColor: lastRideLeg.lineColor,
                        guidance: edge.guidance || null,
                        duration: transferTime,
                        transferTime: transferTime,
                        isDirectThrough: false,
                        isTypeChange: (lastRideLeg.guidance !== edge.guidance), // 案内種別が変わる場合は種別変更
                        fromPlatform: prevArrivalPlatform,
                        toPlatform: nextDeparturePlatform,
                        fromLineId: lastRideLeg.lineId,
                        toLineId: lineId,
                        fromGuidance: lastRideLeg.guidance,
                        toGuidance: edge.guidance,
                        departurePlatform: nextDeparturePlatform
                    });

                    totalDuration += transferTime;
                    // reset lastRideLeg so that following newRide is created normally
                    lastRideLeg = null;
                }
                // 新しい乗車レグを追加
                const newRide = {
                    type: 'segment',
                    segments: [edge.segment],  // マージされたsegmentを配列で保持
                    stationId,
                    stationName: station?.stationName || stationId,
                    lineId,
                    lineName: line?.lineName || lineId,
                    lineColor: line?.lineColor || '#ccc',
                    guidance: edge.guidance || null,
                    duration: edge.duration,
                    departurePlatform: departurePlatform,  // 乗車番線
                    arrivalPlatform: arrivalPlatform       // 到着番線
                };
                legs.push(newRide);
                lastRideLeg = newRide;
            }
            totalDuration += edge.duration;
        } else if (edge.type === 'transfer') {
            // 乗換レグ
            // 直前のsegmentから情報を取得（案内種別を prevGuidance として取得）
            let prevLineId = null;
            let prevGuidance = null;
            if (i > 0 && path[i-1].edge && path[i-1].edge.type === 'segment') {
                const [prevStationId, prevLine, prevG] = path[i-1].key.split('|');
                prevLineId = prevLine;
                prevGuidance = prevG;
            }
            
            legs.push({
                type: 'transfer',
                stationId,
                stationName: station?.stationName || stationId,
                lineId,
                lineName: line?.lineName || lineId,
                lineColor: line?.lineColor || '#ccc',
                guidance: edge.guidance || null,
                duration: edge.duration,
                transferTime: edge.duration,
                isDirectThrough: edge.isDirectThrough || false,
                isTypeChange: edge.isTypeChange || false,
                fromPlatform: edge.fromPlatform,
                toPlatform: edge.toPlatform,
                fromLineId: prevLineId || edge.fromLineId,
                toLineId: edge.toLineId || lineId,
                fromGuidance: prevGuidance || edge.fromGuidance || null,
                toGuidance: edge.toGuidance || edge.guidance,
                departurePlatform: edge.toPlatform  // 乗換先の番線（次に乗る列車の番線）
            });
            totalDuration += edge.duration;
        }
    }

    // 乗換回数を legs から後集計
    // 実際の乗換（transfer type='transfer'）のみをカウント
    // 直通運転（through-service）は乗換としてカウントしない
    // 種別変更（type-change）は乗換としてカウントする
    let transferCount = 0;
    for (const leg of legs) {
        if (leg.type === 'transfer' && !leg.isDirectThrough) {
            transferCount++;
        }
    }

    return {
        legs,
        totalDuration: Math.round(totalDuration),
        transferCount
    };
}

// ========================================
// 経路探索（経由駅あり）- 旧実装（現在は未使用）
// ========================================
// 注: 候補Aの実装により、経由駅は単一探索内で制約として処理されるため、
// この関数は使用されなくなりました。参考のため残しています。
/*
function findRoutesWithVia(startStation, endStation, viaStations, filters) {
    const allStations = [startStation, ...viaStations, endStation];
    let combinedRoute = null;

    for (let i = 0; i < allStations.length - 1; i++) {
        const from = allStations[i];
        const to = allStations[i + 1];

        const segmentRoutes = findRoutes(from, to, [], filters);
        
        if (segmentRoutes.length === 0) {
            return [];
        }

        const bestSegment = segmentRoutes[0];

        if (!combinedRoute) {
            combinedRoute = bestSegment;
        } else {
            combinedRoute.legs = combinedRoute.legs.concat(bestSegment.legs.slice(1));
            combinedRoute.totalDuration += bestSegment.totalDuration;
            combinedRoute.transferCount += bestSegment.transferCount;
        }
    }

    return combinedRoute ? [combinedRoute] : [];
}
*/

// ========================================
// 重複経路の除去
// ========================================
function deduplicateRoutes(routes) {
    const seen = new Set();
    const unique = [];

    for (let route of routes) {
        const signature = route.legs
            .map(leg => `${leg.stationId}|${leg.lineId}|${leg.guidance || ''}`)
            .join('||');
        
        if (!seen.has(signature)) {
            seen.add(signature);
            unique.push(route);
        }
    }

    return unique;
}

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
    backButton.className = 'back-to-search-btn';
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
    const existingHeaderWrapper = resultsSection.querySelector('.route-header-wrapper');
    const heading = resultsSection.querySelector('h2');

    if (existingHeaderWrapper) {
        // Remove any previous back button inside the existing wrapper
        const prevBtn = existingHeaderWrapper.querySelector('.back-to-search-btn');
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
        headerWrapper.className = 'route-header-wrapper';
        headerWrapper.style.display = 'flex';
        headerWrapper.style.justifyContent = 'space-between';
        headerWrapper.style.alignItems = 'center';
        headerWrapper.style.gap = '16px';
        headerWrapper.style.marginBottom = '12px';

        // Insert wrapper before the heading, then move heading into it
        heading.parentNode.insertBefore(headerWrapper, heading);
        headerWrapper.appendChild(heading);
        headerWrapper.appendChild(backButton);
    } else {
        // Fallback: append back button to resultsInfo if heading not found
        // Also ensure no duplicate button exists there
        const prevBtn = resultsInfo.querySelector('.back-to-search-btn');
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
            allTabs.forEach(t => t.classList.toggle('active', t === tab));

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
            card = createRouteCard(route, idx + 1);
        } catch (e) {
            console.error('createRouteCard error', e);
            card = document.createElement('div');
            card.className = 'route-card';
            card.textContent = `ルート ${idx + 1}`;
        }

        card.classList.add('route-card');
        card.dataset.index = idx;
        card.style.display = (idx === 0) ? 'block' : 'none';

        resultsContainer.appendChild(card);

        // 共有ボタン（back-to-search-btn と同様のデザイン）
        try {
            const shareBtn = document.createElement('button');
            shareBtn.type = 'button';
            shareBtn.className = 'back-to-search-btn share-result-btn';
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
    allTabs.forEach((t, i) => t.classList.toggle('active', i === initialIndex));

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
}

// ========================================
// 経路カード作成（画像参考の洗練版）
// ========================================
// ========================================
// 駅・路線が交互に並ぶ表形式タイムライン
// ========================================
function createRouteCard(route, routeNumber) {
    const card = document.createElement('div');
    card.className = 'route-card';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'route-header';
    // Route number badge removed per request. Render only route summary
    // with numeric parts wrapped so CSS can style digits and units separately.
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

    // 1. 最初の駅
    const firstLeg = route.legs[0];
    let elapsed = 0;
    // 最初の駅の乗車番線は、次のsegment（legs[1]）の出発駅番線
    const firstPlatform = route.legs[1]?.departurePlatform || null;
    table.appendChild(createTableStationRow({
        arrivalElapsed: null,
        departureElapsed: elapsed,
        stationName: firstLeg.stationName,
        marker: 'start',
        platform: firstPlatform
    }));

    // 2. 区間・乗換ごとにtable行を出力
    // Arrival time and departure time for transfers will be rendered in a single station row:
    // |到着時間|marker|駅名  乗換時間|
    // |乗車時間|  ^  |  ^      |
    let i = 1;
    while (i < route.legs.length) {
        const leg = route.legs[i];

        if (leg.type === 'segment') {
            // 路線区間行
            table.appendChild(createTableSegmentRow(leg));
            // 到着時刻（この区間の終点）
            elapsed += Math.round(leg.duration);

            // 次が乗換（transfer）かをチェック
            const nextLeg = route.legs[i + 1];
            if (nextLeg && nextLeg.type === 'transfer') {
                const transfer = nextLeg;
                const arrivalElapsed = elapsed;
                const departureElapsed = arrivalElapsed + Math.round(transfer.transferTime || transfer.duration || 0);

                table.appendChild(createTableStationRow({
                    arrivalElapsed,
                    departureElapsed,
                    stationName: leg.stationName,
                    marker: (i + 1 === route.legs.length - 1) ? 'end' : 'via',
                    platform: leg.arrivalPlatform || null,
                    transferTime: transfer.transferTime || transfer.duration || 0,
                    transferLabel: transfer.isDirectThrough ? '直通' : (transfer.isTypeChange ? '種別変更' : '乗換')
                }));

                // 経過時間に乗換時間を加算して次の基準にする
                elapsed = departureElapsed;
                // スキップ：次の transfer レグは既に処理済み
                i += 2;
                continue;
            } else {
                // 通常の到着のみ表示（出発時間は存在しない）
                table.appendChild(createTableStationRow({
                    arrivalElapsed: elapsed,
                    departureElapsed: null,
                    stationName: leg.stationName,
                    marker: (i === route.legs.length - 1) ? 'end' : 'via',
                    platform: leg.arrivalPlatform || null
                }));
                i += 1;
                continue;
            }
        } else if (leg.type === 'transfer') {
            // 予期しない単独のtransfer（前のsegmentがないケース）
            const departureElapsed = elapsed + Math.round(leg.transferTime || leg.duration || 0);
            table.appendChild(createTableStationRow({
                arrivalElapsed: null,
                departureElapsed,
                stationName: leg.stationName,
                marker: 'via',
                platform: leg.departurePlatform || null,
                transferTime: leg.transferTime || leg.duration || 0,
                transferLabel: leg.isDirectThrough ? '直通' : (leg.isTypeChange ? '種別変更' : '乗換')
            }));
            elapsed = departureElapsed;
            i += 1;
            continue;
        } else {
            i += 1;
        }
    }

    card.appendChild(table);
    return card;
}

// 駅行
function createTableStationRow({ arrivalElapsed = null, departureElapsed = null, stationName, marker, platform = null, transferTime = null, transferLabel = '' }) {
    const row = document.createElement('div');
    row.className = 'table-row station-row';

    // マーカー色
    let markerColor = '#1976d2';
    if (marker === 'start') markerColor = '#4CAF50';
    if (marker === 'end') markerColor = '#E60012';

    // 時刻表示: 縦に並べる（上: 到着 着, 下: 出発 発）
    // 直通(乗換不要)の場合は arrival を表示せず、transfer 表示を「乗換不要(直通)」にする
    // NOTE: create the time elements only when there is actual data to avoid empty elements
    let timeHtmlTop = '';
    let timeHtmlBottom = '';
    if (transferLabel === '直通') {
        // 直通: departure は非表示、arrival のみ表示（到着時間のみを表示）
        if (arrivalElapsed != null) {
            timeHtmlTop = `<div class="time-arrival">${formatSeconds(arrivalElapsed)} 着</div>`;
        }
    } else {
        if (arrivalElapsed != null) {
            timeHtmlTop = `<div class="time-arrival">${formatSeconds(arrivalElapsed)} 着</div>`;
        }
        if (departureElapsed != null) {
            timeHtmlBottom = `<div class="time-departure">${formatSeconds(departureElapsed)} 発</div>`;
        }
    }

    // 乗換情報（駅名の右側に表示）
    let transferHtml = '';
    if (transferLabel === '直通') {
        transferHtml = `<span class="transfer-time">乗換不要(直通)</span>`;
    } else if (transferTime != null) {
        // 通常の乗換: 歩行アイコン + 時間（例: 3分）を表示
        transferHtml = `<span class="transfer-wrapper"><img src="src/walking.svg" class="walking-icon" alt="walk">${formatSeconds(transferTime)}</span>`;
    }

    // Build marker HTML. For transfer rows we add a special class so CSS can style the outline/fill.
    let markerHtml = '';
    if (marker === 'start') {
        markerHtml = `<span class="station-marker-badge station-marker-start">発</span>`;
    } else if (marker === 'end') {
        markerHtml = `<span class="station-marker-badge station-marker-end">着</span>`;
    } else {
        // If this row represents a transfer (transferTime provided), add the `transfer` class
        // and avoid inline background so the CSS stroke/fill is applied consistently.
        if (transferTime != null) {
            markerHtml = `<span class="station-marker transfer"></span>`;
        } else {
            markerHtml = `<span class="station-marker" style="background:${markerColor};"></span>`;
        }
    }

    row.innerHTML = `
        <div class="table-time">
            ${timeHtmlTop}
            ${timeHtmlBottom}
        </div>
        <div class="table-marker">
            ${markerHtml}
        </div>
        <div class="table-station">
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="station-name">${stationName}</span>
                ${transferHtml}
            </div>
        </div>
    `;
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

// 路線区間行
function createTableSegmentRow(leg) {
    // 途中駅の数を計算（segments配列の長さ - 1）
    const stopsCount = leg.segments ? leg.segments.length : 1;

    // 1つの行として作成
    const segmentRow = document.createElement('div');
    segmentRow.className = 'table-row segment-row';
    
    // table-time（空）
    const segTimeDiv = document.createElement('div');
    segTimeDiv.className = 'table-time';
    segmentRow.appendChild(segTimeDiv);

    // table-marker（のりば・乗車時間 + 縦線）
    const segMarkerDiv = document.createElement('div');
    segMarkerDiv.className = 'table-marker segment-marker-container';
    
    // 左側：のりば・乗車時間のコンテナ
    const markerInner = document.createElement('div');
    markerInner.className = 'marker-inner-wrapper';
    
    // 乗車駅のりば（上部）
    if (leg.departurePlatform) {
        const depPlatform = document.createElement('div');
        depPlatform.className = 'station-platform-inline platform-top';
        depPlatform.textContent = `${leg.departurePlatform}番のりば`;
        markerInner.appendChild(depPlatform);
    } else {
        // 空のスペーサー
        const spacer = document.createElement('div');
        spacer.className = 'platform-spacer';
        markerInner.appendChild(spacer);
    }
    
    // 乗車時間（中央）
    const durationSpan = document.createElement('div');
    durationSpan.className = 'boarding-duration';
    durationSpan.textContent = `${formatSeconds(leg.duration)} 乗車`;
    markerInner.appendChild(durationSpan);
    
    // 降車駅のりば（下部）
    if (leg.arrivalPlatform) {
        const arrPlatform = document.createElement('div');
        arrPlatform.className = 'station-platform-inline platform-bottom';
        arrPlatform.textContent = `${leg.arrivalPlatform}番のりば`;
        markerInner.appendChild(arrPlatform);
    } else {
        // 空のスペーサー
        const spacer = document.createElement('div');
        spacer.className = 'platform-spacer';
        markerInner.appendChild(spacer);
    }
    
    segMarkerDiv.appendChild(markerInner);
    
    // 右側：縦線（セグメントライン）
    const segmentLine = document.createElement('div');
    segmentLine.className = 'segment-line';
    segmentLine.style.background = leg.lineColor;
    segMarkerDiv.appendChild(segmentLine);
    
    segmentRow.appendChild(segMarkerDiv);

    // table-content（路線情報）
    const segContentDiv = document.createElement('div');
    segContentDiv.className = 'table-content segment-block';

    // 路線名・種別
    const lineRow = document.createElement('div');
    lineRow.className = 'segment-line-row';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'line-symbol';
    iconSpan.style.setProperty('--icon-color', leg.lineColor);
    // アイコンは可能なら leg に紐づく trainType を使い、なければ segment/line 情報からフォールバックする
    const lineInfoForIcon = preprocessedData.lineMap.get(leg.lineId);
    const iconType = (leg.trainType) || (leg.segments && leg.segments[0] && leg.segments[0].trainType) || (lineInfoForIcon && lineInfoForIcon.trainType) || 'TC';
    iconSpan.style.webkitMaskImage = `url(src/${iconType}.svg)`;
    iconSpan.style.maskImage = `url(src/${iconType}.svg)`;
    
    const lineName = document.createElement('span');
    lineName.className = 'line-name';
    // 路線名 + 案内種別を表示（例: 「港急線 快速」）
    const guidanceText = leg.guidance ? ` ${leg.guidance}` : '';
    lineName.textContent = `${leg.lineName}${guidanceText}`;
    
    lineRow.appendChild(iconSpan);
    lineRow.appendChild(lineName);
    segContentDiv.appendChild(lineRow);

    // 停車駅数
    const metaRow = document.createElement('div');
    metaRow.className = 'segment-meta-row';
    metaRow.innerHTML = `
        <span class="segment-detail">${stopsCount}駅目で降車</span>
    `;
    segContentDiv.appendChild(metaRow);

    // 途中駅表示ボタン（途中駅がある場合のみ）
    if (stopsCount > 1) {
        const stopsRow = document.createElement('div');
        stopsRow.className = 'segment-stops-row';
        const stopsObj = createStopsButton(leg);
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

// 乗換行
function createTableTransferRow(leg) {
    const row = document.createElement('div');
    row.className = 'table-row transfer-row';

    if (leg.isDirectThrough) {
        // 1. 直通運転の場合
        row.innerHTML = `
            <div class="table-time"></div>
            <div class="table-marker">
                <span class="transfer-icon">⇄</span>
            </div>
            <div class="table-content">
                <span class="transfer-label through-service">乗換不要（直通）</span>
            </div>
        `;
    } else {
        // 2. 通常の乗換（種別変更も同じ表示）
        row.innerHTML = `
            <div class="table-time"></div>
            <div class="table-marker">
                <span class="transfer-icon">🚶</span>
            </div>
            <div class="table-content">
                <span class="transfer-label">乗り換え（${formatSeconds(leg.transferTime)}）</span>
            </div>
        `;
    }
    return row;
}

// ========================================
// 途中駅表示ボタン作成
// ========================================
function createStopsButton(leg) {
    // segments配列から途中駅を構築
    if (!leg.segments || leg.segments.length <= 1) {
        return null;
    }

    const stopsId = `stops-${Math.random().toString(36).substr(2, 9)}`;
    const btnId = `btn-${stopsId}`;

    // ボタン（内容側に表示）
    const button = document.createElement('button');
    button.className = 'toggle-stops-btn';
    button.id = btnId;
    button.textContent = '▼ 途中駅を表示';

    // 情報側の停車駅リスト（駅名＋時間）
    const infoList = document.createElement('div');
    infoList.className = 'stops-list';
    infoList.id = stopsId;

    // マーカー側のリスト（マーカーのみ、縦に並べる）
    const markerList = document.createElement('div');
    markerList.className = 'stops-marker-list';
    markerList.id = `${stopsId}-markers`;

    // 各segmentのtoStationIdを順に表示（最後を除く = 途中駅のみ）
    let accumulatedTime = 0;
    for (let i = 0; i < leg.segments.length - 1; i++) {
        const segment = leg.segments[i];
        accumulatedTime += segment.duration;
        
        const toStationId = segment.hopTo || segment.toStationId;
        const station = preprocessedData.stationMap.get(toStationId);
        
        if (station) {
            // 情報側の行
            const infoRow = document.createElement('div');
            infoRow.className = 'stop-row';
            
            const stopName = document.createElement('div');
            stopName.className = 'stop-name';
            stopName.textContent = station.stationName;
            
            const stopElapsed = document.createElement('div');
            stopElapsed.className = 'stop-elapsed';
            stopElapsed.textContent = formatSeconds(accumulatedTime);
            
            infoRow.appendChild(stopName);
            infoRow.appendChild(stopElapsed);
            infoList.appendChild(infoRow);

            // マーカー側の行（高さをinfoRowに合わせるスタイルで揃える）
            const markerRow = document.createElement('div');
            markerRow.className = 'stop-marker-row';
            const marker = document.createElement('div');
            marker.className = 'stop-marker';
            // 色を路線に合わせる（線色を境界線に反映）
            try {
                if (leg.lineColor) {
                    marker.style.borderColor = leg.lineColor;
                }
            } catch (e) {
                // ignore style errors in older browsers
            }
            markerRow.appendChild(marker);
            markerList.appendChild(markerRow);
        }
    }

    // ボタン動作：情報側とマーカー側の両方をトグル
    button.addEventListener('click', () => {
        const active = !infoList.classList.contains('active');
        infoList.classList.toggle('active', active);
        markerList.classList.toggle('active', active);
        button.textContent = active ? '▲ 途中駅を非表示' : '▼ 途中駅を表示';
    });

    return { button, infoList, markerList };
}

// ========================================
// UI制御関数
// ========================================
function showLoading() {
    const el = document.getElementById('loading-section');
    if (!el) return;
    // Use flex so the overlay centers spinner + text even when JS sets inline style
    el.style.display = 'flex';

    // Mobile: keep scrollbar visible but effectively prevent scrolling by
    // intercepting touch/wheel/keyboard events on the document. On desktop
    // we keep the old behavior (hide scrollbar) for a consistent UX.
    try {
        const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            // Install passive:false listeners to be able to preventDefault on touchmove
            const onTouchMove = function(e) { e.preventDefault(); };
            const onWheel = function(e) { e.preventDefault(); };
            const onKeyDown = function(e) {
                // prevent common keys that cause scrolling
                const keys = ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '];
                if (keys.includes(e.key)) {
                    e.preventDefault();
                }
            };

            // Store handlers so we can remove them later
            _loadingPreventHandlers = { onTouchMove, onWheel, onKeyDown };

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('wheel', onWheel, { passive: false });
            document.addEventListener('keydown', onKeyDown, { passive: false });
            // Ensure the overlay captures pointer events so background doesn't receive them
            el.style.pointerEvents = 'auto';
        } else {
            // Desktop: hide page scrollbar to prevent scroll while loading
            document.body.classList.add('no-scroll');
            document.documentElement.classList.add('no-scroll');
        }
    } catch (e) {
        /* ignore */
    }

    // Improve accessibility: hide main content from assistive tech while loading
    const main = document.querySelector('main');
    if (main) main.setAttribute('aria-hidden', 'true');
}

function hideLoading() {
    const el = document.getElementById('loading-section');
    if (el) el.style.display = 'none';

    // Re-enable scrolling: remove any installed mobile handlers or the no-scroll class
    try {
        if (_loadingPreventHandlers) {
            document.removeEventListener('touchmove', _loadingPreventHandlers.onTouchMove, { passive: false });
            document.removeEventListener('wheel', _loadingPreventHandlers.onWheel, { passive: false });
            document.removeEventListener('keydown', _loadingPreventHandlers.onKeyDown, { passive: false });
            _loadingPreventHandlers = null;
            if (el) el.style.pointerEvents = '';
        }
        document.body.classList.remove('no-scroll');
        document.documentElement.classList.remove('no-scroll');
    } catch (e) {
        /* ignore */
    }

    // Restore accessibility state
    const main = document.querySelector('main');
    if (main) main.removeAttribute('aria-hidden');
}

function showError(message) {
    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');

    // Clear existing content
    errorMessage.innerHTML = '';

    // Message content (text-only to avoid XSS)
    const msgSpan = document.createElement('span');
    msgSpan.className = 'error-text';
    msgSpan.textContent = message;
    msgSpan.setAttribute('role', 'status');
    msgSpan.setAttribute('aria-live', 'assertive');
    errorMessage.appendChild(msgSpan);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'error-close';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', hideError);
    errorMessage.appendChild(closeBtn);

    // Show popup
    errorSection.style.display = 'block';
}

function hideError() {
    const errorSection = document.getElementById('error-section');
    if (!errorSection) return;
    errorSection.style.display = 'none';
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) errorMessage.innerHTML = '';
    if (errorSection._hideTimeout) {
        clearTimeout(errorSection._hideTimeout);
        errorSection._hideTimeout = null;
    }
}

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

// ========================================
// 共有ダイアログ表示
// ========================================
function showShareDialog(url) {
    // If a modal already exists, update the URL and focus
    let existing = document.getElementById('share-modal');
    if (existing) {
        const input = existing.querySelector('.share-url-input');
        if (input) input.value = url;
        existing.style.display = 'flex';
        try { existing.querySelector('.share-url-input').select(); } catch (e) {}
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.className = 'share-modal';

    modal.innerHTML = `
        <div class="share-modal-content" role="dialog" aria-modal="true" aria-label="検索結果を共有">
            <h3>検索結果を共有する</h3>
            <p>以下のURLを共有してください。</p>
            <input class="share-url-input" type="text" readonly aria-label="共有URL">
            <div class="share-modal-actions">
                <button type="button" class="back-to-search-btn share-copy-btn">コピー</button>
                <button type="button" class="back-to-search-btn share-native-btn">共有</button>
                <button type="button" class="back-to-search-btn share-close-btn">閉じる</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const input = modal.querySelector('.share-url-input');
    const copyBtn = modal.querySelector('.share-copy-btn');
    const nativeBtn = modal.querySelector('.share-native-btn');
    const closeBtn = modal.querySelector('.share-close-btn');

    input.value = url;
    try { input.select(); } catch (e) {}

    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(input.value);
            copyBtn.textContent = 'コピーしました';
            setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
        } catch (err) {
            // fallback: select so user can copy manually
            try { input.select(); } catch (e) {}
            copyBtn.textContent = 'クリップボード失敗';
            setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
        }
    });

    nativeBtn.addEventListener('click', async () => {
        if (navigator.share) {
            try {
                await navigator.share({ title: document.title, url: input.value });
            } catch (e) { /* user cancelled or failed */ }
        } else {
            // If native share not available, copy as fallback
            try {
                await navigator.clipboard.writeText(input.value);
                nativeBtn.textContent = 'コピーしました';
                setTimeout(() => { nativeBtn.textContent = '共有'; }, 1500);
            } catch (err) {
                try { input.select(); } catch (e) {}
            }
        }
    });

    function closeModal() {
        modal.style.display = 'none';
    }

    closeBtn.addEventListener('click', closeModal);

    // clicking outside content closes
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
    });
}

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

    // Create chevron indicators (display-only, not clickable)
    const left = document.createElement('span');
    left.className = 'route-tabs-chevron left';
    left.innerText = '＜';

    const right = document.createElement('span');
    right.className = 'route-tabs-chevron right';
    right.innerText = '＞';

    wrapper.appendChild(left);
    wrapper.appendChild(right);

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