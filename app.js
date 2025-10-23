// ========================================
// グローバル変数
// ========================================
let appData = null;
let preprocessedData = null;
let viaStationCount = 0;

(async () => {
    try {
        showLoading();
        appData = await loadData();
        // ブランド名・自社線ID取得
        if (appData && appData.meta) {
            if (appData.meta.appName) {
                brandName = appData.meta.appName.replace(/乗換案内システム$/, '').trim();
            }
            if (appData.meta.ownCompanyId) {
                ownCompanyId = appData.meta.ownCompanyId;
            }
        }
        preprocessData();
        initializeUI();
        hideLoading();
    } catch (error) {
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
function preprocessData() {
    console.log('データ前処理開始...');

    // 駅IDから駅情報へのマップ
    const stationMap = new Map();
    appData.stations.forEach(station => {
        stationMap.set(station.stationId, station);
    });

    // 路線IDから路線情報へのマップ
    const lineMap = new Map();
    appData.lines.forEach(line => {
        lineMap.set(line.lineId, line);
    });

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
    function addEdge(fromStationId, toStationId, lineId, trainType, duration, segmentRef) {
        const fromKey = `${fromStationId}|${lineId}|${trainType}`;
        const toKey = `${toStationId}|${lineId}|${trainType}`;

        if (!adjacencyList.has(fromKey)) adjacencyList.set(fromKey, []);
        adjacencyList.get(fromKey).push({
            type: 'segment',
            toKey: toKey,
            toStationId: toStationId,
            lineId: lineId,
            trainType: trainType,
            duration: duration,
            segment: segmentRef
        });
    }

    appData.segments.forEach(segment => {
        const stops = Array.isArray(segment.stopsAt) && segment.stopsAt.length >= 2
            ? segment.stopsAt
            : [segment.fromStationId, segment.toStationId];

        const hopCount = stops.length - 1;
        if (hopCount <= 0) return;

        const perHopDuration = segment.duration / hopCount;

        for (let i = 0; i < hopCount; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            addEdge(a, b, segment.lineId, segment.trainType, perHopDuration, {
                ...segment,
                hopFrom: a,
                hopTo: b,
                originalStops: segment.stopsAt || [segment.fromStationId, segment.toStationId]
            });

            if (segment.isBidirectional) {
                addEdge(b, a, segment.lineId, segment.trainType, perHopDuration, {
                    ...segment,
                    hopFrom: b,
                    hopTo: a,
                    originalStops: segment.stopsAt || [segment.fromStationId, segment.toStationId]
                });
            }
        }
    });

    // 直通運転設定マップを作成
    const throughServiceMap = new Map();
    if (appData.throughServiceConfigs) {
        appData.throughServiceConfigs.forEach(config => {
            const key = `${config.fromLineId}|${config.fromTrainType}|${config.toLineId}|${config.toTrainType}`;
            throughServiceMap.set(key, config);
        });
    }

    // のりば間乗換時間マップを作成（種別ごと）
    const platformTransferMap = new Map();
    if (appData.platformTransfers) {
        appData.platformTransfers.forEach(transfer => {
            if (transfer.applicableTrainTypes && transfer.applicableTrainTypes.length > 0) {
                // 種別指定がある場合、種別ごとに登録
                transfer.applicableTrainTypes.forEach(trainType => {
                    const key = `${transfer.stationId}|${transfer.fromPlatform}|${transfer.toPlatform}|${trainType}`;
                    platformTransferMap.set(key, transfer);
                });
            } else {
                // 種別指定がない場合、全種別で登録
                const key = `${transfer.stationId}|${transfer.fromPlatform}|${transfer.toPlatform}`;
                platformTransferMap.set(key, transfer);
            }
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

                    if (fromPlatform === toPlatform) {
                        // 同じのりばの場合
                        if (fromSegment.lineId === toSegment.lineId) {
                            // 同一路線・同一のりば → 種別変更で1分
                            transferTime = 1;
                            isDirectThrough = false;
                            isTypeChange = true; // 種別変更フラグ
                        } else {
                            // 異なる路線・同一のりば → 直通運転の可能性をチェック
                            const throughKey = `${fromSegment.lineId}|${fromSegment.trainType}|${toSegment.lineId}|${toSegment.trainType}`;
                            const throughConfig = throughServiceMap.get(throughKey);
                            
                            if (throughConfig) {
                                // 直通運転設定がある場合
                                transferTime = 0;
                                isDirectThrough = true;
                                isTypeChange = false;
                            } else {
                                // 直通運転設定がない場合、platformTransfersをチェック
                                const transferKey = `${stationId}|${fromPlatform}|${toPlatform}|${fromSegment.trainType}`;
                                const transferKeyNoType = `${stationId}|${fromPlatform}|${toPlatform}`;
                                const transfer = platformTransferMap.get(transferKey) || platformTransferMap.get(transferKeyNoType);
                                
                                if (transfer) {
                                    transferTime = transfer.transferTime;
                                    isDirectThrough = transfer.isDirectThrough;
                                    isTypeChange = false;
                                } else {
                                    // 定義がない場合は1分
                                    transferTime = 1;
                                    isDirectThrough = false;
                                    isTypeChange = false;
                                }
                            }
                        }
                    } else {
                        // 異なるのりばの場合
                        const transferKey = `${stationId}|${fromPlatform}|${toPlatform}|${fromSegment.trainType}`;
                        const transferKeyNoType = `${stationId}|${fromPlatform}|${toPlatform}`;
                        const transfer = platformTransferMap.get(transferKey) || platformTransferMap.get(transferKeyNoType);
                        
                        if (transfer) {
                            transferTime = transfer.transferTime;
                            isDirectThrough = transfer.isDirectThrough;
                            isTypeChange = false;
                        } else {
                            // 定義がない場合はデフォルト3分
                            transferTime = 3;
                            isDirectThrough = false;
                            isTypeChange = false;
                        }
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
        
        const linesText = station.lines
            .map(l => preprocessedData.lineMap.get(l.lineId).lineName)
            .join('・');
        
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

    if (document.getElementById('type-express').checked) {
        filters.allowedTrainTypes.add('EXPRESS');
    }
    if (document.getElementById('type-srapid').checked) {
        filters.allowedTrainTypes.add('SRAPID');
    }
    if (document.getElementById('type-rapid').checked) {
        filters.allowedTrainTypes.add('RAPID');
    }
    if (document.getElementById('type-local').checked) {
        filters.allowedTrainTypes.add('LOCAL');
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
    const queue = new MinPriorityQueue();

    distances.set(startKey, 0);
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

        for (let neighbor of neighbors) {
            if (visited.has(neighbor.toKey)) {
                console.log(`    スキップ（訪問済）: ${neighbor.toKey}`);
                continue;
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
                stopsAt: [],
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

            // 番線情報取得
            let platform = null;
            if (edge.segment && edge.segment.platforms && edge.segment.platforms[stationId]) {
                platform = edge.segment.platforms[stationId];
            }

            if (isMergeable) {
                lastRideLeg.duration += edge.duration;
                lastRideLeg.stationId = stationId;
                lastRideLeg.stationName = station?.stationName || stationId;
                // 停車駅に hopTo を追加（重複回避）
                const hopTo = edge.segment?.hopTo;
                if (hopTo && lastRideLeg.stopsAt[lastRideLeg.stopsAt.length - 1] !== hopTo) {
                    lastRideLeg.stopsAt.push(hopTo);
                }
                // 到着駅の番線を更新
                lastRideLeg.platform = platform;
            } else {
                // 新しい乗車レグを追加
                const newRide = {
                    type: 'segment',
                    stationId,
                    stationName: station?.stationName || stationId,
                    lineId,
                    lineName: line?.lineName || lineId,
                    lineColor: line?.lineColor || '#ccc',
                    trainType,
                    trainTypeName: trainTypeInfo?.trainTypeName || trainType,
                    duration: edge.duration,
                    stopsAt: (edge.segment?.hopFrom && edge.segment?.hopTo)
                        ? [edge.segment.hopFrom, edge.segment.hopTo]
                        : [],
                    platform: platform
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
                stopsAt: [],
                platform: edge.fromPlatform
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

    resultsContainer.innerHTML = '';
    resultsCount.textContent = `${routes.length}件の経路が見つかりました`;

    routes.forEach((route, index) => {
        const routeCard = createRouteCard(route, index + 1);
        resultsContainer.appendChild(routeCard);
    });

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
            <span class="summary-time">⏱️ ${route.totalDuration}分</span>
            <span class="summary-transfer">🔄 乗換 ${route.transferCount}回</span>
        </div>
    `;
    card.appendChild(header);

    // タイムラインテーブル
    const table = document.createElement('div');
    table.className = 'route-table';

    // 1. 最初の駅
    const firstLeg = route.legs[0];
    let elapsed = 0;
    table.appendChild(createTableStationRow({
        elapsed,
        stationName: firstLeg.stationName,
        marker: 'start',
        platform: route.legs[1]?.platform || null // 乗車番線（最初のsegmentの出発駅）
    }));

    // 2. 区間・乗換ごとにtable行を出力
    for (let i = 1; i < route.legs.length; i++) {
        const leg = route.legs[i];
        if (leg.type === 'segment') {
            table.appendChild(createTableSegmentRow(leg));
            elapsed += Math.round(leg.duration);
            // 到着駅（この区間の終点駅）
            table.appendChild(createTableStationRow({
                elapsed,
                stationName: leg.stationName,
                marker: (i === route.legs.length - 1) ? 'end' : 'via',
                platform: leg.platform || null // 到着番線
            }));
        } else if (leg.type === 'transfer') {
            table.appendChild(createTableTransferRow(leg));
            elapsed += Math.round(leg.transferTime || leg.duration);
            // 乗換後の駅は次のsegment区間の到着駅で表示される
            // 乗換駅の番線はtransfer legのplatformで表示
            table.appendChild(createTableStationRow({
                elapsed,
                stationName: leg.stationName,
                marker: 'via',
                platform: leg.platform || null
            }));
        }
    }

    card.appendChild(table);
    return card;
}

// 駅行
function createTableStationRow({ elapsed, stationName, marker, platform }) {
    const row = document.createElement('div');
    row.className = 'table-row station-row';

    // マーカー色
    let markerColor = '#1976d2';
    if (marker === 'start') markerColor = '#4CAF50';
    if (marker === 'end') markerColor = '#E60012';

    row.innerHTML = `
        <div class="table-time">${elapsed}分</div>
        <div class="table-marker">
            <span class="station-marker" style="background:${markerColor};"></span>
        </div>
        <div class="table-station">
            <span class="station-name">${stationName}</span>
            ${platform ? `<span class="station-platform">${platform}</span>` : ''}
        </div>
    `;
    return row;
}

// 路線区間行
function createTableSegmentRow(leg) {
    const row = document.createElement('div');
    row.className = 'table-row segment-row';

    // 停車駅数（乗車駅を除き降車駅を含む）
    let stopsCount = 0;
    if (leg.stopsAt && leg.stopsAt.length >= 2) {
        // stopsAtの最初の駅が乗車駅、最後の駅が降車駅
        // 乗車駅を除き降車駅を含むので、length - 1
        stopsCount = leg.stopsAt.length - 1;
    }

    // table-time（空）
    const timeDiv = document.createElement('div');
    timeDiv.className = 'table-time';
    row.appendChild(timeDiv);

    // table-marker（縦線）
    const markerDiv = document.createElement('div');
    markerDiv.className = 'table-marker';
    const segmentLine = document.createElement('span');
    segmentLine.className = 'segment-line';
    segmentLine.style.background = leg.lineColor;
    segmentLine.style.height = '100%';
    segmentLine.style.minHeight = '80px';
    segmentLine.style.display = 'block';
    markerDiv.appendChild(segmentLine);
    row.appendChild(markerDiv);

    // table-content（3行に分割）
    const contentDiv = document.createElement('div');
    contentDiv.className = 'table-content segment-block';

    // 1行目: 路線名・種別
    const lineRow = document.createElement('div');
    lineRow.className = 'segment-line-row';
    lineRow.innerHTML = `
        <span class="line-symbol" style="background:${leg.lineColor};">${leg.lineName.charAt(0)}</span>
        <span class="line-name">${leg.lineName}</span>
        <span class="train-type-badge ${leg.trainType.toLowerCase()}">${leg.trainTypeName}</span>
    `;
    contentDiv.appendChild(lineRow);

    // 2行目: 乗車時間・停車駅数
    const metaRow = document.createElement('div');
    metaRow.className = 'segment-meta-row';
    metaRow.innerHTML = `
        <span class="segment-detail">${Math.round(leg.duration)}分 乗車</span>
        <span class="segment-detail">${stopsCount}駅目で降車</span>
    `;
    contentDiv.appendChild(metaRow);

    // 3行目: 停車駅表示ボタン
    const stopsRow = document.createElement('div');
    stopsRow.className = 'segment-stops-row';
    const stopsButton = createStopsButton(leg, leg.elapsedStart);
    if (stopsButton) {
        stopsRow.appendChild(stopsButton);
    }
    contentDiv.appendChild(stopsRow);

    row.appendChild(contentDiv);
    return row;
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
    } else if (leg.isTypeChange) {
        // 2. 種別変更の場合
        row.innerHTML = `
            <div class="table-time"></div>
            <div class="table-marker">
                <span class="transfer-icon">🔄</span>
            </div>
            <div class="table-content">
                <span class="transfer-label type-change">種別変更（${leg.transferTime}分）</span>
            </div>
        `;
    } else {
        // 3. 通常の乗換
        row.innerHTML = `
            <div class="table-time"></div>
            <div class="table-marker">
                <span class="transfer-icon">🚶</span>
            </div>
            <div class="table-content">
                <span class="transfer-label">乗り換え（${leg.transferTime}分）</span>
            </div>
        `;
    }
    return row;
}

// ========================================
// 停車駅ボタン作成
// ========================================
function createStopsButton(leg, elapsedStart = 0) {
    if (!leg.stopsAt || leg.stopsAt.length <= 2) {
        return null;
    }
    const stops = leg.stopsAt.slice(1, -1); // 中間駅
    if (stops.length === 0) return null;

    const stopsId = `stops-${Math.random().toString(36).substr(2, 9)}`;
    const btnId = `btn-${stopsId}`;

    // コンテナを作成
    const container = document.createElement('div');
    container.style.display = 'block';

    // ボタンを作成
    const button = document.createElement('button');
    button.className = 'toggle-stops-btn';
    button.id = btnId;
    button.textContent = '▼ 停車駅を表示';

    // 停車駅リストを作成
    const stopsList = document.createElement('div');
    stopsList.className = 'stops-list';
    stopsList.id = stopsId;

    let acc = elapsedStart || 0;
    const perHop = leg.duration / (leg.stopsAt.length - 1);

    stops.forEach((stopId) => {
        acc += perHop;
        const station = preprocessedData.stationMap.get(stopId);
        if (station) {
            const stopRow = document.createElement('div');
            stopRow.className = 'stop-row';
            
            const stopName = document.createElement('span');
            stopName.className = 'stop-name';
            stopName.textContent = station.stationName;
            
            const stopElapsed = document.createElement('span');
            stopElapsed.className = 'stop-elapsed';
            stopElapsed.textContent = `${Math.round(acc)}分`;
            
            stopRow.appendChild(stopName);
            stopRow.appendChild(stopElapsed);
            stopsList.appendChild(stopRow);
        }
    });

    // イベントリスナーを追加
    button.addEventListener('click', () => {
        stopsList.classList.toggle('active');
        button.textContent = stopsList.classList.contains('active') 
            ? '▲ 停車駅を非表示' 
            : '▼ 停車駅を表示';
    });

    container.appendChild(button);
    container.appendChild(stopsList);

    return container;
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
