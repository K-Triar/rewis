// ========================================
// グローバル変数
// ========================================
let appData = null;
let preprocessedData = null;
let viaStationCount = 0;

// ========================================
// アプリ初期化
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        showLoading();
        await loadData();
        preprocessData();
        initializeUI();
        hideLoading();
    } catch (error) {
        showError('データの読み込みに失敗しました: ' + error.message);
    }
});

// ========================================
// データ読み込み
// ========================================
async function loadData() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error('データファイルが見つかりません');
        }
        appData = await response.json();
        console.log('データ読み込み完了:', appData);
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
    const adjacencyList = new Map();

    appData.segments.forEach(segment => {
        const fromKey = `${segment.fromStationId}_${segment.lineId}_${segment.trainType}`;
        const toKey = `${segment.toStationId}_${segment.lineId}_${segment.trainType}`;

        if (!adjacencyList.has(fromKey)) {
            adjacencyList.set(fromKey, []);
        }
        adjacencyList.get(fromKey).push({
            type: 'segment',
            toKey: toKey,
            toStationId: segment.toStationId,
            lineId: segment.lineId,
            trainType: segment.trainType,
            duration: segment.duration,
            segment: segment
        });

        // 双方向の場合は逆方向も追加
        if (segment.isBidirectional) {
            if (!adjacencyList.has(toKey)) {
                adjacencyList.set(toKey, []);
            }
            adjacencyList.get(toKey).push({
                type: 'segment',
                toKey: fromKey,
                toStationId: segment.fromStationId,
                lineId: segment.lineId,
                trainType: segment.trainType,
                duration: segment.duration,
                segment: segment
            });
        }
    });

    // 乗換情報を隣接リストに追加
    appData.transfers.forEach(transfer => {
        // fromLineの各種別からtoLineの各種別への乗換を追加
        const fromStationId = transfer.stationId;
        
        appData.trainTypes.forEach(fromTrainType => {
            appData.trainTypes.forEach(toTrainType => {
                const fromKey = `${fromStationId}_${transfer.fromLineId}_${fromTrainType.trainTypeId}`;
                const toKey = `${fromStationId}_${transfer.toLineId}_${toTrainType.trainTypeId}`;

                if (!adjacencyList.has(fromKey)) {
                    adjacencyList.set(fromKey, []);
                }

                adjacencyList.get(fromKey).push({
                    type: 'transfer',
                    toKey: toKey,
                    toStationId: fromStationId,
                    lineId: transfer.toLineId,
                    trainType: toTrainType.trainTypeId,
                    duration: transfer.transferTime,
                    transfer: transfer
                });
            });
        });
    });

    preprocessedData = {
        stationMap,
        lineMap,
        companyMap,
        trainTypeMap,
        adjacencyList
    };

    console.log('データ前処理完了');
    console.log('隣接リスト:', adjacencyList);
}

// ========================================
// UI初期化
// ========================================
function initializeUI() {
    // 駅名入力の自動補完設定
    setupStationInput('departure');
    setupStationInput('arrival');

    // 駅入れ替えボタン
    document.getElementById('swap-stations').addEventListener('click', swapStations);

    // 経由駅追加ボタン
    document.getElementById('add-via').addEventListener('click', addViaStation);

    // 検索ボタン
    document.getElementById('search-button').addEventListener('click', performSearch);

    // Enterキーで検索
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

    // フォーカスが外れたら候補を非表示
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
    }).slice(0, 10); // 最大10件
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

// 簡易的なひらがな変換（実際の実装ではより高度な変換が必要）
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
    
    // 自動補完設定
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

    // 入力値取得
    const departureStation = findStationByName(document.getElementById('departure').value.trim());
    const arrivalStation = findStationByName(document.getElementById('arrival').value.trim());

    // バリデーション
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

    // 経由駅取得
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

    // フィルター取得
    const filters = {
        onlyOwnCompany: document.getElementById('own-company-only').checked,
        allowedTrainTypes: new Set()
    };

    if (document.getElementById('type-express').checked) {
        filters.allowedTrainTypes.add('EXPRESS');
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

    // 検索実行
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

// ========================================
// 駅名から駅情報を検索
// ========================================
function findStationByName(name) {
    if (!name) return null;
    return appData.stations.find(s => s.stationName === name);
}

// ========================================
// 経路探索アルゴリズム（修正Dijkstra法）
// ========================================
function findRoutes(startStation, endStation, viaStations, filters) {
    console.log('経路探索開始:', startStation.stationName, '→', endStation.stationName);
    
    // 経由駅がある場合は区間ごとに検索
    if (viaStations.length > 0) {
        return findRoutesWithVia(startStation, endStation, viaStations, filters);
    }

    const routes = [];
    const maxRoutes = 5; // 最大5経路

    // 開始駅の全路線×全種別からスタート
    const startKeys = [];
    startStation.lines.forEach(line => {
        filters.allowedTrainTypes.forEach(trainType => {
            startKeys.push(`${startStation.stationId}_${line.lineId}_${trainType}`);
        });
    });

    // 各開始点から探索
    startKeys.forEach(startKey => {
        const route = dijkstraSearch(startKey, endStation.stationId, filters);
        if (route) {
            routes.push(route);
        }
    });

    // 重複除去とソート
    const uniqueRoutes = deduplicateRoutes(routes);
    uniqueRoutes.sort((a, b) => {
        // 所要時間優先、次に乗換回数
        if (a.totalDuration !== b.totalDuration) {
            return a.totalDuration - b.totalDuration;
        }
        return a.transferCount - b.transferCount;
    });

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

    while (!queue.isEmpty()) {
        const currentKey = queue.dequeue();
        
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);

        const currentDistance = distances.get(currentKey);
        const [currentStationId, currentLineId, currentTrainType] = currentKey.split('_');

        // 目的地に到達
        if (currentStationId === endStationId) {
            return reconstructRoute(startKey, currentKey, previous);
        }

        // 隣接ノードを探索
        const neighbors = preprocessedData.adjacencyList.get(currentKey) || [];
        
        for (let neighbor of neighbors) {
            if (visited.has(neighbor.toKey)) continue;

            // フィルター適用
            if (!passesFilter(neighbor, filters)) continue;

            const newDistance = currentDistance + neighbor.duration;
            const oldDistance = distances.get(neighbor.toKey);

            if (oldDistance === undefined || newDistance < oldDistance) {
                distances.set(neighbor.toKey, newDistance);
                previous.set(neighbor.toKey, { key: currentKey, edge: neighbor });
                queue.enqueue(neighbor.toKey, newDistance);
            }
        }
    }

    return null; // 経路が見つからない
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
    // 列車種別フィルター
    if (!filters.allowedTrainTypes.has(neighbor.trainType)) {
        return false;
    }

    // 自社線フィルター
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

    // 開始点を追加
    path.unshift({ key: startKey, edge: null });

    // 経路情報を構築
    return buildRouteInfo(path);
}

// ========================================
// 経路情報構築
// ========================================
function buildRouteInfo(path) {
    const legs = [];
    let totalDuration = 0;
    let transferCount = 0;
    let currentLine = null;

    for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const [stationId, lineId, trainType] = node.key.split('_');
        const station = preprocessedData.stationMap.get(stationId);
        const line = preprocessedData.lineMap.get(lineId);
        const trainTypeInfo = preprocessedData.trainTypeMap.get(trainType);

        if (i === 0) {
            // 開始駅
            currentLine = lineId;
            legs.push({
                type: 'start',
                stationId: stationId,
                stationName: station.stationName,
                lineId: lineId,
                lineName: line.lineName,
                lineColor: line.lineColor,
                trainType: trainType,
                trainTypeName: trainTypeInfo.trainTypeName,
                duration: 0,
                stopsAt: []
            });
        } else {
            const edge = node.edge;
            
            if (edge.type === 'segment') {
                // 路線移動
                if (currentLine !== lineId) {
                    transferCount++;
                }
                
                const prevLeg = legs[legs.length - 1];
                
                if (prevLeg.lineId === lineId && prevLeg.trainType === trainType) {
                    // 同じ路線・種別なら継続
                    prevLeg.duration += edge.duration;
                    if (edge.segment && edge.segment.stopsAt) {
                        prevLeg.stopsAt = prevLeg.stopsAt.concat(
                            edge.segment.stopsAt.slice(1)
                        );
                    }
                } else {
                    // 新しい区間
                    legs.push({
                        type: 'segment',
                        stationId: stationId,
                        stationName: station.stationName,
                        lineId: lineId,
                        lineName: line.lineName,
                        lineColor: line.lineColor,
                        trainType: trainType,
                        trainTypeName: trainTypeInfo.trainTypeName,
                        duration: edge.duration,
                        stopsAt: edge.segment?.stopsAt || []
                    });
                }
                
                totalDuration += edge.duration;
                currentLine = lineId;
                
            } else if (edge.type === 'transfer') {
                // 乗換
                totalDuration += edge.duration;
                
                legs.push({
                    type: 'transfer',
                    stationId: stationId,
                    stationName: station.stationName,
                    lineId: lineId,
                    lineName: line.lineName,
                    lineColor: line.lineColor,
                    trainType: trainType,
                    trainTypeName: trainTypeInfo.trainTypeName,
                    duration: edge.duration,
                    transferTime: edge.duration,
                    isDirectThrough: edge.transfer?.isDirectThrough || false,
                    stopsAt: []
                });
                
                currentLine = lineId;
            }
        }
    }

    return {
        legs: legs,
        totalDuration: totalDuration,
        transferCount: transferCount
    };
}

// ========================================
// 経由駅対応の経路探索
// ========================================
function findRoutesWithVia(startStation, endStation, viaStations, filters) {
    // 出発→経由1→経由2→...→到着 の順で検索
    const allStations = [startStation, ...viaStations, endStation];
    let combinedRoute = null;

    for (let i = 0; i < allStations.length - 1; i++) {
        const from = allStations[i];
        const to = allStations[i + 1];

        const segmentRoutes = findRoutes(from, to, [], filters);
        
        if (segmentRoutes.length === 0) {
            return []; // 一部でも経路が見つからなければ全体も失敗
        }

        const bestSegment = segmentRoutes[0]; // 最短経路を使用

        if (!combinedRoute) {
            combinedRoute = bestSegment;
        } else {
            // 経路を結合
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
            .map(leg => `${leg.stationId}_${leg.lineId}_${leg.trainType}`)
            .join('|');
        
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
// 経路カード作成
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
            <div class="summary-item">
                ⏱️ <strong>${route.totalDuration}分</strong>
            </div>
            <div class="summary-item">
                🔄 乗換 <strong>${route.transferCount}回</strong>
            </div>
        </div>
    `;
    card.appendChild(header);

    // 経路詳細
    const path = document.createElement('div');
    path.className = 'route-path';

    route.legs.forEach((leg, index) => {
        const isLast = index === route.legs.length - 1;
        const legElement = createLegElement(leg, isLast);
        path.appendChild(legElement);
    });

    card.appendChild(path);

    return card;
}

// ========================================
// 区間要素作成
// ========================================
function createLegElement(leg, isLast) {
    const legDiv = document.createElement('div');
    legDiv.className = 'route-leg';

    // 駅マーカー
    const marker = document.createElement('div');
    marker.className = 'station-marker';
    
    if (leg.type === 'start') {
        marker.textContent = '🚩';
    } else if (isLast) {
        marker.className += ' arrival';
        marker.textContent = '🏁';
    } else if (leg.type === 'transfer') {
        marker.className += ' transfer';
        marker.textContent = '🔄';
    } else {
        marker.textContent = '●';
    }

    legDiv.appendChild(marker);

    // 駅情報
    const info = document.createElement('div');
    info.className = 'leg-info';

    const stationNameDiv = document.createElement('div');
    stationNameDiv.className = 'station-name-display';
    stationNameDiv.textContent = leg.stationName;
    info.appendChild(stationNameDiv);

    if (leg.type !== 'start' && !isLast) {
        const lineInfo = document.createElement('div');
        lineInfo.className = 'line-info';
        
        const colorBox = document.createElement('span');
        colorBox.className = 'line-color-box';
        colorBox.style.backgroundColor = leg.lineColor;
        lineInfo.appendChild(colorBox);

        const lineText = document.createElement('span');
        lineText.textContent = `${leg.lineName} (${leg.trainTypeName})`;
        lineInfo.appendChild(lineText);

        const duration = document.createElement('span');
        duration.className = 'duration-display';
        duration.textContent = `${leg.duration}分`;
        lineInfo.appendChild(duration);

        info.appendChild(lineInfo);

        // 乗換情報
        if (leg.type === 'transfer' && leg.transferTime > 0) {
            const transferInfo = document.createElement('div');
            transferInfo.className = 'transfer-info';
            transferInfo.textContent = `乗換時間: ${leg.transferTime}分`;
            info.appendChild(transferInfo);
        }

        // 停車駅表示ボタン
        if (leg.stopsAt && leg.stopsAt.length > 2) {
            const toggleButton = document.createElement('button');
            toggleButton.className = 'toggle-stops-button';
            toggleButton.textContent = '停車駅を表示';
            
            const stopsDetail = document.createElement('div');
            stopsDetail.className = 'stops-detail';
            
            leg.stopsAt.forEach(stopId => {
                const station = preprocessedData.stationMap.get(stopId);
                if (station) {
                    const stopItem = document.createElement('div');
                    stopItem.className = 'stop-item';
                    stopItem.innerHTML = `
                        <span class="stop-marker"></span>
                        <span>${station.stationName}</span>
                    `;
                    stopsDetail.appendChild(stopItem);
                }
            });

            toggleButton.addEventListener('click', () => {
                stopsDetail.classList.toggle('active');
                toggleButton.textContent = stopsDetail.classList.contains('active') 
                    ? '停車駅を非表示' 
                    : '停車駅を表示';
            });

            info.appendChild(toggleButton);
            info.appendChild(stopsDetail);
        }
    }

    legDiv.appendChild(info);

    return legDiv;
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
