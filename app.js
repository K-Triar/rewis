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

    // 乗換情報を隣接リストに追加
    appData.transfers.forEach(transfer => {
        const fromStationId = transfer.stationId;

        appData.trainTypes.forEach(fromTrainType => {
            appData.trainTypes.forEach(toTrainType => {
                const fromKey = `${fromStationId}|${transfer.fromLineId}|${fromTrainType.trainTypeId}`;
                const toKey = `${fromStationId}|${transfer.toLineId}|${toTrainType.trainTypeId}`;

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

        if (i === 0) {
            // 開始点は必ず start レグとして独立させる（ここに乗車時間を入れない）
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
                stopsAt: []
            });
            lastRideLeg = null; // 乗車レグはまだ始まっていない
            continue;
        }

        if (!edge) continue; // 念のため

        if (edge.type === 'segment') {
            // 乗車レグを新規開始or直前の乗車とマージするか判定
            const isMergeable =
                lastRideLeg &&
                lastRideLeg.lineId === lineId &&
                lastRideLeg.trainType === trainType;

            if (isMergeable) {
                // 直前の同一路線・同種別の乗車レグにマージ
                lastRideLeg.duration += edge.duration;
                // 最終到着駅を更新
                lastRideLeg.stationId = stationId;
                lastRideLeg.stationName = station?.stationName || stationId;
                // 停車駅に hopTo を追加（重複回避）
                const hopTo = edge.segment?.hopTo;
                if (hopTo && lastRideLeg.stopsAt[lastRideLeg.stopsAt.length - 1] !== hopTo) {
                    lastRideLeg.stopsAt.push(hopTo);
                }
            } else {
                // 新しい乗車レグを追加
                const newRide = {
                    type: 'segment',
                    stationId, // 現在ノード＝この乗車レグの「現時点での到着駅」
                    stationName: station?.stationName || stationId,
                    lineId,
                    lineName: line?.lineName || lineId,
                    lineColor: line?.lineColor || '#ccc',
                    trainType,
                    trainTypeName: trainTypeInfo?.trainTypeName || trainType,
                    duration: edge.duration,
                    // 停車駅は hopFrom -> hopTo からスタート。以後マージ時に hopTo を追加
                    stopsAt: (edge.segment?.hopFrom && edge.segment?.hopTo)
                        ? [edge.segment.hopFrom, edge.segment.hopTo]
                        : []
                };

                // 直前の乗車レグが存在していて路線が変わるなら「乗換回数+1」
                // （transferエッジ自体では+1せず、実際に別路線に乗車を開始したタイミングで+1）
                const lastSegmentLeg = legs.slice().reverse().find(l => l.type === 'segment');
                if (lastSegmentLeg && lastSegmentLeg.lineId !== lineId) {
                    // 新しいプロパティ transferCount がまだなければ route 組み立て完了後に集計する方式でもよいが
                    // ここでは legs 配列とは別にカウントしないため、後で集計する
                }

                legs.push(newRide);
                lastRideLeg = newRide;
            }

            totalDuration += edge.duration;

        } else if (edge.type === 'transfer') {
            // 乗換レグはそのまま追加
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
                isDirectThrough: edge.transfer?.isDirectThrough || false,
                stopsAt: []
            });
            totalDuration += edge.duration;

            // 乗換の後は、新しい乗車レグが始まるまで lastRideLeg は据え置きでOK
            // （次の乗車レグ作成時に路線が変われば実質的な「乗換」とみなす）
        }
    }

    // 乗換回数を legs から後集計（連続する segment 間で路線が変わった回数）
    let transferCount = 0;
    let prevSegLine = null;
    for (const leg of legs) {
        if (leg.type !== 'segment') continue;
        if (prevSegLine !== null && prevSegLine !== leg.lineId) {
            transferCount++;
        }
        prevSegLine = leg.lineId;
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

    let elapsed = 0;

    // 駅→路線→駅→…→到着駅 の順で組み立て
    for (let i = 0; i < route.legs.length; i++) {
        const leg = route.legs[i];
        const prevLeg = route.legs[i - 1];
        const isFirst = (i === 0);
        const isLast = (i === route.legs.length - 1);

        // ------ 駅行 ------
        if (leg.type === 'start' || leg.type === 'segment' || leg.type === 'transfer') {
            // 駅行
            table.appendChild(createTableStationRow({
                elapsed,
                stationName: leg.stationName,
                marker: isFirst ? 'start' : isLast ? 'end' : 'via'
            }));
        }

        // ------ 区間 or 乗換（路線行） ------
        if (leg.type === 'segment' && !isLast) {
            // 路線区間行
            table.appendChild(createTableSegmentRow(leg));
            elapsed += Math.round(leg.duration);
        }
        if (leg.type === 'transfer' && !isLast) {
            // 乗換行
            table.appendChild(createTableTransferRow(leg));
            elapsed += Math.round(leg.duration);
        }
    }

    card.appendChild(table);
    return card;
}

// 駅行
function createTableStationRow({ elapsed, stationName, marker }) {
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
        </div>
    `;
    return row;
}

// 路線区間行
function createTableSegmentRow(leg) {
    const row = document.createElement('div');
    row.className = 'table-row segment-row';

    const stopsCount = leg.stopsAt ? Math.max(leg.stopsAt.length - 1, 0) : 0;

    row.innerHTML = `
        <div class="table-time"></div>
        <div class="table-marker">
            <span class="segment-line" style="background:${leg.lineColor};"></span>
        </div>
        <div class="table-content">
            <span class="line-symbol" style="background:${leg.lineColor};">${leg.lineName.charAt(0)}</span>
            <span class="line-name">${leg.lineName}</span>
            <span class="train-type-badge ${leg.trainType.toLowerCase()}">${leg.trainTypeName}</span>
            <span class="segment-detail">🕐${Math.round(leg.duration)}分・🏢${stopsCount}駅</span>
            ${createStopsButton(leg, 0)}
        </div>
    `;
    return row;
}

// 乗換行
function createTableTransferRow(leg) {
    const row = document.createElement('div');
    row.className = 'table-row transfer-row';

    row.innerHTML = `
        <div class="table-time"></div>
        <div class="table-marker">
            <span class="transfer-icon">🚶</span>
        </div>
        <div class="table-content">
            <span class="transfer-label">乗り換え（徒歩${leg.transferTime}分）</span>
        </div>
    `;
    return row;
}

// ========================================
// 停車駅ボタン作成
// ========================================
function createStopsButton(leg, elapsedStart) {
    if (!leg.stopsAt || leg.stopsAt.length <= 2) {
        return '';
    }
    const stops = leg.stopsAt.slice(1, -1);
    if (stops.length === 0) return '';
    
    const stopsId = `stops-${Math.random().toString(36).substr(2, 9)}`;
    
    setTimeout(() => {
        const button = document.getElementById(`btn-${stopsId}`);
        const detail = document.getElementById(stopsId);
        if (button && detail) {
            button.addEventListener('click', () => {
                detail.classList.toggle('active');
                button.textContent = detail.classList.contains('active') 
                    ? '▲ 停車駅を非表示' 
                    : '▼ 停車駅を表示';
            });
        }
    }, 0);
    
    let stopsHTML = '';
    let acc = elapsedStart;
    const perHop = leg.duration / (leg.stopsAt.length - 1);
    
    stops.forEach((stopId) => {
        acc += perHop;
        const station = preprocessedData.stationMap.get(stopId);
        if (station) {
            stopsHTML += `<div class="stop-item">${station.stationName}</div>`;
        }
    });
    
    return `
        <button class="toggle-stops-btn" id="btn-${stopsId}">
            ▼ 停車駅を表示
        </button>
        <div class="stops-list" id="${stopsId}">
            ${stopsHTML}
        </div>
    `;
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
