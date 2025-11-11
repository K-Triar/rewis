// ========================================
// グローバル変数
// ========================================
let appData = null;
let preprocessedData = null;
let viaStationCount = 0;
let brandName = 'Kトライア交通グループ';
let ownCompanyId = 'KT';

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
        const response = await fetch('data.json');
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

    // segmentsから各駅を通る路線を抽出して駅データに追加
    const stationLinesMap = new Map(); // stationId -> Set of {lineId, companyId}
    appData.segments.forEach(segment => {
        const fromStationId = segment.fromStationId;
        const toStationId = segment.toStationId;
        const lineId = segment.lineId;
        
        // 路線情報から会社IDを取得
        const line = lineMap.get(lineId);
        const companyId = line ? line.companyId : null;
        
        // fromStationに路線を追加
        if (!stationLinesMap.has(fromStationId)) {
            stationLinesMap.set(fromStationId, new Map());
        }
        if (companyId) {
            stationLinesMap.get(fromStationId).set(lineId, companyId);
        }
        
        // toStationに路線を追加
        if (!stationLinesMap.has(toStationId)) {
            stationLinesMap.set(toStationId, new Map());
        }
        if (companyId) {
            stationLinesMap.get(toStationId).set(lineId, companyId);
        }
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

    // 列車種別IDから種別情報へのマップ
    const trainTypeMap = new Map();
    appData.trainTypes.forEach(type => {
        trainTypeMap.set(type.trainTypeId, type);
    });

    // 隣接リスト作成（駅×路線×種別をノードとする）
    // ★ 区切り文字を _ から | に変更
    const adjacencyList = new Map();

    // Helper: add adjacency entry
    function addEdge(fromStationId, toStationId, lineId, trainType, duration, segmentRef, isAlightOnly = false) {
        const fromKey = `${fromStationId}|${lineId}|${trainType}`;
        const toKey = `${toStationId}|${lineId}|${trainType}`;

        if (!adjacencyList.has(fromKey)) adjacencyList.set(fromKey, []);
        adjacencyList.get(fromKey).push({
            type: 'segment',
            toKey: toKey,
            fromStationId: fromStationId,  // 出発駅IDを追加
            toStationId: toStationId,
            lineId: lineId,
            trainType: trainType,
            duration: duration,
            segment: segmentRef,
            isAlightOnly: isAlightOnly  // 降車専用フラグを保持
        });
    }

    appData.segments.forEach(segment => {
        const isAlightOnly = segment.isAlightOnly || false;
        const a = segment.fromStationId;
        const b = segment.toStationId;

        // 直接接続を追加（segmentの所要時間をそのまま使用）
        addEdge(a, b, segment.lineId, segment.trainType, segment.duration, {
            ...segment,
            hopFrom: a,
            hopTo: b
        }, isAlightOnly);

        // 双方向の場合は逆方向も追加（降車専用は元の方向のみ）
        if (segment.isBidirectional) {
            addEdge(b, a, segment.lineId, segment.trainType, segment.duration, {
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
            const keyForward = `${config.fromLineId}|${config.fromTrainType}|${config.toLineId}|${config.toTrainType}`;
            throughServiceMap.set(keyForward, config);
            
            // 相互直通の場合は逆方向も登録
            if (config.isBidirectional) {
                const keyReverse = `${config.toLineId}|${config.toTrainType}|${config.fromLineId}|${config.fromTrainType}`;
                throughServiceMap.set(keyReverse, {
                    ...config,
                    fromLineId: config.toLineId,
                    toLineId: config.fromLineId,
                    fromTrainType: config.toTrainType,
                    toTrainType: config.fromTrainType
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
            const fromKey = `${stationId}|${fromSegment.lineId}|${fromSegment.trainType}`;
            
            if (!adjacencyList.has(fromKey)) {
                adjacencyList.set(fromKey, []);
            }

            // 同じ駅の他のセグメントを探す
            appData.segments.forEach(toSegment => {
                if (toSegment.platforms[stationId]) {
                    const toPlatform = toSegment.platforms[stationId];
                    const toKey = `${stationId}|${toSegment.lineId}|${toSegment.trainType}`;

                    // 同じノードへの乗換は不要
                    if (fromKey === toKey) return;

                    // のりば間の乗換時間を取得
                    let transferTime = 0;
                    let isDirectThrough = false;
                    let isTypeChange = false;

                    // 直通運転の可能性をチェック
                    const throughKey = `${fromSegment.lineId}|${fromSegment.trainType}|${toSegment.lineId}|${toSegment.trainType}`;
                    const throughConfig = throughServiceMap.get(throughKey);
                    
                    if (throughConfig && fromPlatform === toPlatform) {
                        // 直通運転設定がある場合
                        transferTime = 0;
                        isDirectThrough = true;
                        isTypeChange = false;
                    } else {
                        // 通常の乗換・種別変更（表示上は区別しない）
                        if (fromSegment.lineId === toSegment.lineId) {
                            // 同一路線 → 種別変更フラグを立てる
                            isTypeChange = true;
                        }
                        
                        if (fromPlatform === toPlatform) {
                            // 同じのりばの場合は5秒
                            transferTime = 5;
                        } else {
                            // 異なるのりばの場合はdata.jsonの乗換情報を参照
                            const transferKey = `${stationId}|${fromPlatform}|${toPlatform}`;
                            const transfer = platformTransferMap.get(transferKey);
                            
                            if (transfer) {
                                transferTime = transfer.transferTime;
                            } else {
                                // 定義がない場合はデフォルト3分 -> 180秒
                                transferTime = 180;
                            }
                        }
                        isDirectThrough = false;
                    }

                    adjacencyList.get(fromKey).push({
                        type: 'transfer',
                        toKey: toKey,
                        toStationId: stationId,
                        lineId: toSegment.lineId,
                        trainType: toSegment.trainType,
                        duration: transferTime,
                        fromPlatform: fromPlatform,
                        toPlatform: toPlatform,
                        fromLineId: fromSegment.lineId,
                        toLineId: toSegment.lineId,
                        fromTrainType: fromSegment.trainType,
                        toTrainType: toSegment.trainType,
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
    document.getElementById('swap-stations').addEventListener('click', swapStations);
    document.getElementById('add-via').addEventListener('click', addViaStation);
    document.getElementById('search-button').addEventListener('click', performSearch);

    ['departure', 'arrival'].forEach(id => {
        document.getElementById(id).addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    });
}

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
function swapStations() {
    const departure = document.getElementById('departure');
    const arrival = document.getElementById('arrival');
    
    const temp = departure.value;
    departure.value = arrival.value;
    arrival.value = temp;
}

// ========================================
// 経由駅追加
// ========================================
function addViaStation() {
    viaStationCount++;
    const viaStationsDiv = document.getElementById('via-stations');
    
    const viaItem = document.createElement('div');
    viaItem.className = 'via-station-item';
    viaItem.dataset.viaId = viaStationCount;
    
    const viaId = `via-${viaStationCount}`;
    const suggestionsId = `${viaId}-suggestions`;
    
    viaItem.innerHTML = `
        <div class="input-wrapper">
            <label for="${viaId}">経由駅 ${viaStationCount}</label>
            <input 
                type="text" 
                id="${viaId}" 
                class="station-input" 
                placeholder="駅名を入力"
                autocomplete="off"
            >
            <div class="suggestions" id="${suggestionsId}"></div>
        </div>
        <button type="button" class="remove-via-button" onclick="removeViaStation(${viaStationCount})">
            削除
        </button>
    `;
    
    viaStationsDiv.appendChild(viaItem);
    setupStationInput(viaId);
}

function removeViaStation(viaId) {
    const viaItem = document.querySelector(`[data-via-id="${viaId}"]`);
    if (viaItem) {
        viaItem.remove();
    }
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

// ========================================
// 経路探索アルゴリズム（修正Dijkstra法）
// ========================================
function findRoutes(startStation, endStation, viaStations, filters) {
    console.log('\n--- 経路探索開始 ---');
    console.log('出発駅:', startStation.stationName, startStation.stationId);
    console.log('到着駅:', endStation.stationName, endStation.stationId);
    console.log('経由駅:', viaStations.map(s => s.stationName));
    console.log('フィルタ:', filters);

    // 経由駅指定時はfindRoutesWithViaを使う
    if (viaStations.length > 0) {
        console.log('経由駅指定あり: 区間分割検索');
        return findRoutesWithVia(startStation, endStation, viaStations, filters);
    }

    const routes = [];
    const maxRoutes = 5;

    const startKeys = [];
    startStation.lines.forEach(line => {
        filters.allowedTrainTypes.forEach(trainType => {
            const key = `${startStation.stationId}|${line.lineId}|${trainType}`;
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
        console.log(`Dijkstra探索開始: ${startKey}`);
        const route = dijkstraSearch(startKey, endStation.stationId, filters);
        if (route) {
            console.log('探索成功: 経路情報', route);
            routes.push(route);
        } else {
            console.warn(`経路が見つかりませんでした: ${startKey}`);
        }
    });

    const uniqueRoutes = deduplicateRoutes(routes);
    uniqueRoutes.sort((a, b) => {
        if (a.totalDuration !== b.totalDuration) {
            return a.totalDuration - b.totalDuration;
        }
        return a.transferCount - b.transferCount;
    });

    console.log('--- 探索結果 ---');
    console.log(`${uniqueRoutes.length}件の経路が見つかりました`);
    return uniqueRoutes.slice(0, maxRoutes);
}

// ========================================
// Dijkstra法による経路探索
// ========================================
function dijkstraSearch(startKey, endStationId, filters) {
    const distances = new Map();
    const previous = new Map();
    const visited = new Set();
    const visitedStations = new Map(); // キーごとに訪問済み駅を記録
    const queue = new MinPriorityQueue();

    const [startStationId] = startKey.split('|');
    distances.set(startKey, 0);
    visitedStations.set(startKey, new Set([startStationId]));
    queue.enqueue(startKey, 0);

    let step = 0;

    while (!queue.isEmpty()) {
        step++;
        const currentKey = queue.dequeue();
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);

        const currentDistance = distances.get(currentKey);
        // ★ split('|') に変更
        const [currentStationId, currentLineId, currentTrainType] = currentKey.split('|');
        console.log(`[Step ${step}] 現在ノード: ${currentKey} (駅ID: ${currentStationId}) 距離: ${currentDistance}`);

        // 到着判定
        if (currentStationId === endStationId) {
            console.log(`✅ 到達駅に到達: ${currentKey}`);
            return reconstructRoute(startKey, currentKey, previous);
        }

        const neighbors = preprocessedData.adjacencyList.get(currentKey) || [];
        console.log(`  隣接ノード数: ${neighbors.length}`);

        // 現在のパスで訪問済みの駅リストを取得
        const currentVisitedStations = visitedStations.get(currentKey) || new Set();

        for (let neighbor of neighbors) {
            if (visited.has(neighbor.toKey)) {
                console.log(`    スキップ（訪問済）: ${neighbor.toKey}`);
                continue;
            }

            // 降車専用区間のチェック：始点駅からは乗車できない
            if (neighbor.isAlightOnly && currentKey === startKey) {
                console.log(`    スキップ（降車専用区間・始点駅からの乗車不可）: ${neighbor.toKey}`);
                continue;
            }

            // 出発駅からの乗換・種別変更を禁止
            if (currentKey === startKey && neighbor.type === 'transfer') {
                console.log(`    スキップ（出発駅からの乗換禁止）: ${neighbor.toKey}`);
                continue;
            }

            // 駅の重複チェック：segment（移動）の場合のみチェック
            // transfer（乗換）は同じ駅内での移動なので重複チェック対象外
            if (neighbor.type === 'segment') {
                const [nextStationId] = neighbor.toKey.split('|');
                if (currentVisitedStations.has(nextStationId)) {
                    console.log(`    スキップ（駅重複）: ${neighbor.toKey} (駅ID: ${nextStationId})`);
                    continue;
                }
            }

            if (!passesFilter(neighbor, filters)) {
                console.log(`    フィルタ除外: ${neighbor.toKey}`);
                continue;
            }

            const newDistance = currentDistance + neighbor.duration;
            const oldDistance = distances.get(neighbor.toKey);

            if (oldDistance === undefined || newDistance < oldDistance) {
                distances.set(neighbor.toKey, newDistance);
                previous.set(neighbor.toKey, { key: currentKey, edge: neighbor });
                
                // 訪問済み駅リストを更新
                // segment（移動）の場合のみ訪問駅を追加
                const newVisitedStations = new Set(currentVisitedStations);
                if (neighbor.type === 'segment') {
                    const [nextStationId] = neighbor.toKey.split('|');
                    newVisitedStations.add(nextStationId);
                }
                visitedStations.set(neighbor.toKey, newVisitedStations);
                
                queue.enqueue(neighbor.toKey, newDistance);
                console.log(`    キュー追加: ${neighbor.toKey} 距離: ${newDistance}`);
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
    if (!filters.allowedTrainTypes.has(neighbor.trainType)) {
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
function reconstructRoute(startKey, endKey, previous) {
    const path = [];
    let currentKey = endKey;

    while (currentKey !== startKey) {
        const prev = previous.get(currentKey);
        if (!prev) break;
        path.unshift({ key: currentKey, edge: prev.edge });
        currentKey = prev.key;
    }

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
        const [stationId, lineId, trainType] = node.key.split('|');
        const station = preprocessedData.stationMap.get(stationId);
        const line = preprocessedData.lineMap.get(lineId);
        const trainTypeInfo = preprocessedData.trainTypeMap.get(trainType);
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
                trainType,
                trainTypeName: trainTypeInfo?.trainTypeName || trainType,
                duration: 0,
                platform: null // 出発駅は乗車番線を次のsegmentで参照
            });
            lastRideLeg = null;
            continue;
        }

        if (!edge) continue;

        if (edge.type === 'segment') {
            // 乗車レグを新規開始or直前の乗車とマージするか判定
            const isMergeable =
                lastRideLeg &&
                lastRideLeg.lineId === lineId &&
                lastRideLeg.trainType === trainType;

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
                // 新しい乗車レグを追加
                const newRide = {
                    type: 'segment',
                    segments: [edge.segment],  // マージされたsegmentを配列で保持
                    stationId,
                    stationName: station?.stationName || stationId,
                    lineId,
                    lineName: line?.lineName || lineId,
                    lineColor: line?.lineColor || '#ccc',
                    trainType,
                    trainTypeName: trainTypeInfo?.trainTypeName || trainType,
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
            // 直前のsegmentから情報を取得
            let prevLineId = null;
            let prevTrainType = null;
            if (i > 0 && path[i-1].edge && path[i-1].edge.type === 'segment') {
                const [prevStationId, prevLine, prevType] = path[i-1].key.split('|');
                prevLineId = prevLine;
                prevTrainType = prevType;
            }
            
            legs.push({
                type: 'transfer',
                stationId,
                stationName: station?.stationName || stationId,
                lineId,
                lineName: line?.lineName || lineId,
                lineColor: line?.lineColor || '#ccc',
                trainType,
                trainTypeName: trainTypeInfo?.trainTypeName || trainType,
                duration: edge.duration,
                transferTime: edge.duration,
                isDirectThrough: edge.isDirectThrough || false,
                isTypeChange: edge.isTypeChange || false,
                fromPlatform: edge.fromPlatform,
                toPlatform: edge.toPlatform,
                fromLineId: prevLineId || edge.fromLineId,
                toLineId: edge.toLineId || lineId,
                fromTrainType: prevTrainType || edge.fromTrainType,
                toTrainType: edge.toTrainType || trainType,
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
// 経路探索（経由駅あり）
// ========================================
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

// ========================================
// 重複経路の除去
// ========================================
function deduplicateRoutes(routes) {
    const seen = new Set();
    const unique = [];

    for (let route of routes) {
        const signature = route.legs
            .map(leg => `${leg.stationId}|${leg.lineId}|${leg.trainType}`)
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

    // 「検索画面に戻る」ボタンを作成
    const backButton = document.createElement('button');
    backButton.className = 'back-to-search-btn';
    backButton.textContent = '検索画面に戻る';
    backButton.addEventListener('click', () => {
        hideResults();
        showSearchSection();
        // ページトップにスクロール
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // 「検索結果」見出しの右側に戻るボタンを配置
    const resultsInfo = resultsSection.querySelector('.results-info');
    resultsInfo.innerHTML = ''; // 既存の内容をクリア

    // move the existing <h2> (検索結果) into a flex wrapper and append the back button to the right
    const heading = resultsSection.querySelector('h2');
    if (heading && heading.parentNode) {
        const headerWrapper = document.createElement('div');
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

            // show/hide cards
            const cards = resultsContainer.querySelectorAll('.route-card');
            cards.forEach((c, i) => {
                c.style.display = (i === idx) ? 'block' : 'none';
            });

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
    });

    // デフォルトで最初のタブをアクティブ化
    const firstTab = tabs.querySelector('.route-tab');
    if (firstTab) firstTab.classList.add('active');

    resultsSection.style.display = 'block';
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
    header.innerHTML = `
        <div class="route-number">${routeNumber}</div>
        <div class="route-summary">
            <span class="summary-time">${formatSeconds(route.totalDuration)}</span>
            <span class="summary-transfer">乗換 ${route.transferCount}回</span>
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
        // 直通: arrival は非表示、departure のみ表示
        if (departureElapsed != null) {
            timeHtmlBottom = `<div class="time-departure">${formatSeconds(departureElapsed)} 発</div>`;
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
        depPlatform.textContent = leg.departurePlatform;
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
        arrPlatform.textContent = leg.arrivalPlatform;
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
    iconSpan.style.webkitMaskImage = `url(src/${leg.trainType}.svg)`;
    iconSpan.style.maskImage = `url(src/${leg.trainType}.svg)`;
    
    const lineName = document.createElement('span');
    lineName.className = 'line-name';
    lineName.textContent = leg.lineName;
    
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
    document.getElementById('loading-section').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loading-section').style.display = 'none';
}

function showError(message) {
    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
}

function hideError() {
    document.getElementById('error-section').style.display = 'none';
}

function hideResults() {
    document.getElementById('results-section').style.display = 'none';
}

function hideSearchSection() {
    document.getElementById('search-section').style.display = 'none';
}

function showSearchSection() {
    document.getElementById('search-section').style.display = 'block';
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