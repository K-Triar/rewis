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
        showError('到着駅が正しく入力されていません