// ========================================
// グローバル変数
// ========================================
let appData = {
    meta: {
        version: "1.0.0",
        ownCompanyId: "KT",
        lastUpdated: new Date().toISOString().split('T')[0],
        appName: "Kトライア瑠璃 乗換案内システム"
    },
    companies: [],
    trainTypes: [],
    lines: [],
    stations: [],
    segments: [],
    throughServiceConfigs: [],
    platformTransfers: []
};

// ========================================
// 初期化
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    tryLoadExistingData();
});

// ナビゲーション初期化
function initializeNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetSection = btn.dataset.section;
            switchSection(targetSection);
        });
    });
}

// セクション切り替え
function switchSection(sectionId) {
    // ナビゲーションボタンの状態更新
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.section === sectionId) {
            btn.classList.add('active');
        }
    });

    // セクションの表示切り替え
    document.querySelectorAll('.edit-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');

    // セクションごとのデータを表示
    renderSection(sectionId);
}

// 既存データの読み込み試行
async function tryLoadExistingData() {
    try {
        const response = await fetch('data.json');
        if (response.ok) {
            appData = await response.json();
            console.log('data.jsonを読み込みました');
            renderSection('companies');
        } else {
            console.log('data.jsonが見つかりません。新規作成モードで起動します。');
            renderSection('companies');
        }
    } catch (error) {
        console.log('data.jsonの読み込みに失敗しました。新規作成モードで起動します。');
        renderSection('companies');
    }
}

// ========================================
// セクションレンダリング
// ========================================
function renderSection(sectionId) {
    switch (sectionId) {
        case 'companies':
            renderCompanies();
            break;
        case 'train-types':
            renderTrainTypes();
            break;
        case 'lines':
            renderLines();
            break;
        case 'stations':
            renderStations();
            break;
        case 'segments':
            renderSegments();
            break;
        case 'through-services':
            renderThroughServices();
            break;
        case 'platform-transfers':
            renderPlatformTransfers();
            break;
        case 'export':
            // エクスポートセクションは静的なので何もしない
            break;
    }
}

// ========================================
// 鉄道会社
// ========================================
function renderCompanies() {
    const container = document.getElementById('companies-list');
    container.innerHTML = '';

    if (appData.companies.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだ会社が登録されていません。「新しい会社を追加」ボタンから追加してください。</p>';
        return;
    }

    appData.companies.forEach((company, index) => {
        const card = createCompanyCard(company, index);
        container.appendChild(card);
    });
}

function createCompanyCard(company, index) {
    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${company.companyName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editCompany(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deleteCompany(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">会社ID:</div>
                <div class="view-value">${company.companyId}</div>
            </div>
            <div class="view-field">
                <div class="view-label">会社名:</div>
                <div class="view-value">${company.companyName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">自社:</div>
                <div class="view-value">
                    ${company.isOwnCompany ? '<span class="badge badge-success">はい</span>' : '<span class="badge badge-secondary">いいえ</span>'}
                </div>
            </div>
        </div>
    `;
    return card;
}

function addCompany() {
    const newCompany = {
        companyId: '',
        companyName: '',
        isOwnCompany: false
    };
    appData.companies.push(newCompany);
    const index = appData.companies.length - 1;
    editCompany(index);
}

function editCompany(index) {
    const company = appData.companies[index];
    const container = document.getElementById('companies-list');
    const cards = container.children;
    
    cards[index].innerHTML = `
        <div class="card-header">
            <div class="card-title">会社情報を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="saveCompany(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('companies')">❌ キャンセル</button>
            </div>
        </div>
        <form id="company-form-${index}">
            <div class="form-group">
                <label>会社ID *</label>
                <input type="text" name="companyId" value="${company.companyId}" required placeholder="例: KT">
                <small style="color: #6c757d;">英数字で入力（例: KT, JR, CR）</small>
            </div>
            <div class="form-group">
                <label>会社名 *</label>
                <input type="text" name="companyName" value="${company.companyName}" required placeholder="例: Kトライア瑠璃">
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="isOwnCompany" ${company.isOwnCompany ? 'checked' : ''}>
                    <span>この会社は自社（運営会社）です</span>
                </label>
            </div>
        </form>
    `;
}

function saveCompany(index) {
    const form = document.getElementById(`company-form-${index}`);
    const formData = new FormData(form);
    
    appData.companies[index] = {
        companyId: formData.get('companyId'),
        companyName: formData.get('companyName'),
        isOwnCompany: formData.get('isOwnCompany') === 'on'
    };
    
    // 自社フラグが変更された場合、metaも更新
    const ownCompany = appData.companies.find(c => c.isOwnCompany);
    if (ownCompany) {
        appData.meta.ownCompanyId = ownCompany.companyId;
    }
    
    renderCompanies();
}

function deleteCompany(index) {
    if (confirm('この会社を削除してもよろしいですか？')) {
        appData.companies.splice(index, 1);
        renderCompanies();
    }
}

// ========================================
// 列車種別
// ========================================
function renderTrainTypes() {
    const container = document.getElementById('train-types-list');
    container.innerHTML = '';

    if (appData.trainTypes.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだ列車種別が登録されていません。</p>';
        return;
    }

    // 優先度順にソート
    const sorted = [...appData.trainTypes].sort((a, b) => a.priority - b.priority);

    sorted.forEach((type) => {
        const index = appData.trainTypes.findIndex(t => t.trainTypeId === type.trainTypeId);
        const card = createTrainTypeCard(type, index);
        container.appendChild(card);
    });
}

function createTrainTypeCard(type, index) {
    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${type.trainTypeName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editTrainType(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deleteTrainType(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">種別ID:</div>
                <div class="view-value">${type.trainTypeId}</div>
            </div>
            <div class="view-field">
                <div class="view-label">種別名:</div>
                <div class="view-value">${type.trainTypeName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">略称:</div>
                <div class="view-value">${type.trainTypeNameShort}</div>
            </div>
            <div class="view-field">
                <div class="view-label">優先度:</div>
                <div class="view-value">${type.priority}</div>
            </div>
            <div class="view-field">
                <div class="view-label">色:</div>
                <div class="view-value">
                    ${type.color}
                    <span class="color-preview" style="background: ${type.color};"></span>
                </div>
            </div>
        </div>
    `;
    return card;
}

function addTrainType() {
    const newType = {
        trainTypeId: '',
        trainTypeName: '',
        trainTypeNameShort: '',
        priority: 1,
        color: '#0078D7'
    };
    appData.trainTypes.push(newType);
    const index = appData.trainTypes.length - 1;
    editTrainType(index);
}

function editTrainType(index) {
    const type = appData.trainTypes[index];
    const container = document.getElementById('train-types-list');
    const cards = Array.from(container.children);
    
    // 現在のカードを見つける（優先度ソート後のため）
    let cardIndex = 0;
    for (let i = 0; i < cards.length; i++) {
        const editBtn = cards[i].querySelector('.edit-btn');
        if (editBtn && editBtn.getAttribute('onclick').includes(`editTrainType(${index})`)) {
            cardIndex = i;
            break;
        }
    }
    
    cards[cardIndex].innerHTML = `
        <div class="card-header">
            <div class="card-title">列車種別を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="saveTrainType(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('train-types')">❌ キャンセル</button>
            </div>
        </div>
        <form id="traintype-form-${index}">
            <div class="form-row">
                <div class="form-group">
                    <label>種別ID *</label>
                    <input type="text" name="trainTypeId" value="${type.trainTypeId}" required placeholder="例: EXPRESS">
                </div>
                <div class="form-group">
                    <label>種別名 *</label>
                    <input type="text" name="trainTypeName" value="${type.trainTypeName}" required placeholder="例: 特急">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>略称 *</label>
                    <input type="text" name="trainTypeNameShort" value="${type.trainTypeNameShort}" required placeholder="例: 特">
                </div>
                <div class="form-group">
                    <label>優先度 *</label>
                    <input type="number" name="priority" value="${type.priority}" required min="1" placeholder="1">
                    <small style="color: #6c757d;">小さいほど優先（1=最速）</small>
                </div>
            </div>
            <div class="form-group">
                <label>色 *</label>
                <input type="color" name="color" value="${type.color}" required>
                <small style="color: #6c757d;">カラーピッカーで選択</small>
            </div>
        </form>
    `;
}

function saveTrainType(index) {
    const form = document.getElementById(`traintype-form-${index}`);
    const formData = new FormData(form);
    
    appData.trainTypes[index] = {
        trainTypeId: formData.get('trainTypeId'),
        trainTypeName: formData.get('trainTypeName'),
        trainTypeNameShort: formData.get('trainTypeNameShort'),
        priority: parseInt(formData.get('priority')),
        color: formData.get('color')
    };
    
    renderTrainTypes();
}

function deleteTrainType(index) {
    if (confirm('この列車種別を削除してもよろしいですか？')) {
        appData.trainTypes.splice(index, 1);
        renderTrainTypes();
    }
}

// ========================================
// 路線
// ========================================
function renderLines() {
    const container = document.getElementById('lines-list');
    container.innerHTML = '';

    if (appData.lines.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだ路線が登録されていません。</p>';
        return;
    }

    appData.lines.forEach((line, index) => {
        const card = createLineCard(line, index);
        container.appendChild(card);
    });
}

function createLineCard(line, index) {
    const company = appData.companies.find(c => c.companyId === line.companyId);
    const companyName = company ? company.companyName : line.companyId;
    
    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${line.lineName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editLine(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deleteLine(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">路線ID:</div>
                <div class="view-value">${line.lineId}</div>
            </div>
            <div class="view-field">
                <div class="view-label">路線名:</div>
                <div class="view-value">${line.lineName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">運営会社:</div>
                <div class="view-value">${companyName} (${line.companyId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">路線カラー:</div>
                <div class="view-value">
                    ${line.lineColor}
                    <span class="color-preview" style="background: ${line.lineColor};"></span>
                </div>
            </div>
        </div>
    `;
    return card;
}

function addLine() {
    const newLine = {
        lineId: '',
        lineName: '',
        companyId: '',
        lineColor: '#0078D7',
        throughServices: []
    };
    appData.lines.push(newLine);
    const index = appData.lines.length - 1;
    editLine(index);
}

function editLine(index) {
    const line = appData.lines[index];
    const container = document.getElementById('lines-list');
    const cards = container.children;
    
    // 会社セレクトボックス作成
    const companyOptions = appData.companies.map(c => 
        `<option value="${c.companyId}" ${c.companyId === line.companyId ? 'selected' : ''}>${c.companyName} (${c.companyId})</option>`
    ).join('');
    
    cards[index].innerHTML = `
        <div class="card-header">
            <div class="card-title">路線を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="saveLine(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('lines')">❌ キャンセル</button>
            </div>
        </div>
        <form id="line-form-${index}">
            <div class="form-row">
                <div class="form-group">
                    <label>路線ID *</label>
                    <input type="text" name="lineId" value="${line.lineId}" required placeholder="例: KT-L">
                    <small style="color: #6c757d;">会社ID-路線記号（例: KT-L）</small>
                </div>
                <div class="form-group">
                    <label>路線名 *</label>
                    <input type="text" name="lineName" value="${line.lineName}" required placeholder="例: 瑠璃線">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>運営会社 *</label>
                    <select name="companyId" required>
                        <option value="">選択してください</option>
                        ${companyOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>路線カラー *</label>
                    <input type="color" name="lineColor" value="${line.lineColor}" required>
                </div>
            </div>
        </form>
    `;
}

function saveLine(index) {
    const form = document.getElementById(`line-form-${index}`);
    const formData = new FormData(form);
    
    appData.lines[index] = {
        lineId: formData.get('lineId'),
        lineName: formData.get('lineName'),
        companyId: formData.get('companyId'),
        lineColor: formData.get('lineColor'),
        throughServices: appData.lines[index].throughServices || []
    };
    
    renderLines();
}

function deleteLine(index) {
    if (confirm('この路線を削除してもよろしいですか？')) {
        appData.lines.splice(index, 1);
        renderLines();
    }
}

// ========================================
// 駅
// ========================================
function renderStations() {
    const container = document.getElementById('stations-list');
    container.innerHTML = '';

    if (appData.stations.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだ駅が登録されていません。</p>';
        return;
    }

    appData.stations.forEach((station, index) => {
        const card = createStationCard(station, index);
        container.appendChild(card);
    });
}

function createStationCard(station, index) {
    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${station.stationName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editStation(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deleteStation(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">駅ID:</div>
                <div class="view-value">${station.stationId}</div>
            </div>
            <div class="view-field">
                <div class="view-label">駅名:</div>
                <div class="view-value">${station.stationName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">読み仮名:</div>
                <div class="view-value">${station.stationNameKana}</div>
            </div>
            <div class="view-field">
                <div class="view-label">緯度:</div>
                <div class="view-value">${station.latitude}</div>
            </div>
            <div class="view-field">
                <div class="view-label">経度:</div>
                <div class="view-value">${station.longitude}</div>
            </div>
        </div>
    `;
    return card;
}

function addStation() {
    const newStation = {
        stationId: '',
        stationName: '',
        stationNameKana: '',
        lines: [],
        latitude: 35.0,
        longitude: 139.0
    };
    appData.stations.push(newStation);
    const index = appData.stations.length - 1;
    editStation(index);
}

function editStation(index) {
    const station = appData.stations[index];
    const container = document.getElementById('stations-list');
    const cards = container.children;
    
    cards[index].innerHTML = `
        <div class="card-header">
            <div class="card-title">駅を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="saveStation(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('stations')">❌ キャンセル</button>
            </div>
        </div>
        <form id="station-form-${index}">
            <div class="form-row">
                <div class="form-group">
                    <label>駅ID *</label>
                    <input type="text" name="stationId" value="${station.stationId}" required placeholder="例: KL01">
                </div>
                <div class="form-group">
                    <label>駅名 *</label>
                    <input type="text" name="stationName" value="${station.stationName}" required placeholder="例: アカシア島">
                </div>
            </div>
            <div class="form-group">
                <label>読み仮名（ひらがな） *</label>
                <input type="text" name="stationNameKana" value="${station.stationNameKana}" required placeholder="例: あかしあとう">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>緯度 *</label>
                    <input type="number" step="0.000001" name="latitude" value="${station.latitude}" required placeholder="35.0">
                </div>
                <div class="form-group">
                    <label>経度 *</label>
                    <input type="number" step="0.000001" name="longitude" value="${station.longitude}" required placeholder="139.0">
                </div>
            </div>
        </form>
    `;
}

function saveStation(index) {
    const form = document.getElementById(`station-form-${index}`);
    const formData = new FormData(form);
    
    appData.stations[index] = {
        stationId: formData.get('stationId'),
        stationName: formData.get('stationName'),
        stationNameKana: formData.get('stationNameKana'),
        lines: appData.stations[index].lines || [],
        latitude: parseFloat(formData.get('latitude')),
        longitude: parseFloat(formData.get('longitude'))
    };
    
    renderStations();
}

function deleteStation(index) {
    if (confirm('この駅を削除してもよろしいですか？')) {
        appData.stations.splice(index, 1);
        renderStations();
    }
}

function filterStations() {
    const query = document.getElementById('station-search').value.toLowerCase();
    const cards = document.querySelectorAll('#stations-list .data-card');
    
    cards.forEach(card => {
        const title = card.querySelector('.card-title').textContent.toLowerCase();
        if (title.includes(query)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// ========================================
// 区間
// ========================================
function renderSegments() {
    const container = document.getElementById('segments-list');
    const filterSelect = document.getElementById('segment-line-filter');
    
    // フィルターのオプションを更新
    filterSelect.innerHTML = '<option value="">すべて表示</option>';
    appData.lines.forEach(line => {
        const option = document.createElement('option');
        option.value = line.lineId;
        option.textContent = `${line.lineName} (${line.lineId})`;
        filterSelect.appendChild(option);
    });
    
    container.innerHTML = '';

    if (appData.segments.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだ区間が登録されていません。</p>';
        return;
    }

    appData.segments.forEach((segment, index) => {
        const card = createSegmentCard(segment, index);
        container.appendChild(card);
    });
}

function createSegmentCard(segment, index) {
    const line = appData.lines.find(l => l.lineId === segment.lineId);
    const lineName = line ? line.lineName : segment.lineId;
    
    const fromStation = appData.stations.find(s => s.stationId === segment.fromStationId);
    const toStation = appData.stations.find(s => s.stationId === segment.toStationId);
    
    const fromName = fromStation ? fromStation.stationName : segment.fromStationId;
    const toName = toStation ? toStation.stationName : segment.toStationId;
    
    const trainType = appData.trainTypes.find(t => t.trainTypeId === segment.trainType);
    const typeName = trainType ? trainType.trainTypeName : segment.trainType;
    
    const card = document.createElement('div');
    card.className = 'data-card';
    card.dataset.lineId = segment.lineId;
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${fromName} → ${toName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editSegment(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deleteSegment(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">区間ID:</div>
                <div class="view-value">${segment.segmentId}</div>
            </div>
            <div class="view-field">
                <div class="view-label">路線:</div>
                <div class="view-value">${lineName} (${segment.lineId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">列車種別:</div>
                <div class="view-value">${typeName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">出発駅:</div>
                <div class="view-value">${fromName} (${segment.fromStationId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">到着駅:</div>
                <div class="view-value">${toName} (${segment.toStationId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">所要時間:</div>
                <div class="view-value">${segment.duration}分</div>
            </div>
            <div class="view-field">
                <div class="view-label">距離:</div>
                <div class="view-value">${segment.distance} km</div>
            </div>
            <div class="view-field">
                <div class="view-label">双方向:</div>
                <div class="view-value">${segment.isBidirectional ? '<span class="badge badge-success">はい</span>' : '<span class="badge badge-secondary">いいえ</span>'}</div>
            </div>
        </div>
    `;
    return card;
}

function addSegment() {
    const newSegment = {
        segmentId: '',
        platforms: {},
        lineId: '',
        companyId: '',
        fromStationId: '',
        toStationId: '',
        trainType: '',
        duration: 0,
        distance: 0,
        stopsAt: [],
        isBidirectional: true
    };
    appData.segments.push(newSegment);
    const index = appData.segments.length - 1;
    editSegment(index);
}

function editSegment(index) {
    const segment = appData.segments[index];
    const container = document.getElementById('segments-list');
    const cards = container.children;
    
    // 対応するカードを探す
    let cardIndex = -1;
    for (let i = 0; i < cards.length; i++) {
        const editBtn = cards[i].querySelector('.edit-btn');
        if (editBtn && editBtn.getAttribute('onclick').includes(`editSegment(${index})`)) {
            cardIndex = i;
            break;
        }
    }
    
    if (cardIndex === -1) return;
    
    const lineOptions = appData.lines.map(l => 
        `<option value="${l.lineId}" ${l.lineId === segment.lineId ? 'selected' : ''}>${l.lineName} (${l.lineId})</option>`
    ).join('');
    
    const companyOptions = appData.companies.map(c => 
        `<option value="${c.companyId}" ${c.companyId === segment.companyId ? 'selected' : ''}>${c.companyName} (${c.companyId})</option>`
    ).join('');
    
    const stationOptions = appData.stations.map(s => 
        `<option value="${s.stationId}">${s.stationName} (${s.stationId})</option>`
    ).join('');
    
    const trainTypeOptions = appData.trainTypes.map(t => 
        `<option value="${t.trainTypeId}" ${t.trainTypeId === segment.trainType ? 'selected' : ''}>${t.trainTypeName}</option>`
    ).join('');
    
    cards[cardIndex].innerHTML = `
        <div class="card-header">
            <div class="card-title">区間を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="saveSegment(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('segments')">❌ キャンセル</button>
            </div>
        </div>
        <form id="segment-form-${index}">
            <div class="form-group">
                <label>区間ID *</label>
                <input type="text" name="segmentId" value="${segment.segmentId}" required placeholder="例: KL01-KL02-LOCAL">
                <small style="color: #6c757d;">出発駅-到着駅-種別（例: KL01-KL02-LOCAL）</small>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>路線 *</label>
                    <select name="lineId" required>
                        <option value="">選択してください</option>
                        ${lineOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>運営会社 *</label>
                    <select name="companyId" required>
                        <option value="">選択してください</option>
                        ${companyOptions}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>出発駅 *</label>
                    <select name="fromStationId" required>
                        <option value="">選択してください</option>
                        ${stationOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>到着駅 *</label>
                    <select name="toStationId" required>
                        <option value="">選択してください</option>
                        ${stationOptions}
                    </select>
                </div>
            </div>
            <div class="form-row-3">
                <div class="form-group">
                    <label>列車種別 *</label>
                    <select name="trainType" required>
                        <option value="">選択してください</option>
                        ${trainTypeOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>所要時間（分） *</label>
                    <input type="number" name="duration" value="${segment.duration}" required min="0" placeholder="5">
                </div>
                <div class="form-group">
                    <label>距離（km） *</label>
                    <input type="number" step="0.01" name="distance" value="${segment.distance}" required min="0" placeholder="2.5">
                </div>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="isBidirectional" ${segment.isBidirectional ? 'checked' : ''}>
                    <span>双方向運転（往復両方向で運行）</span>
                </label>
            </div>
        </form>
    `;
}

function saveSegment(index) {
    const form = document.getElementById(`segment-form-${index}`);
    const formData = new FormData(form);
    
    const fromStationId = formData.get('fromStationId');
    const toStationId = formData.get('toStationId');
    
    appData.segments[index] = {
        segmentId: formData.get('segmentId'),
        platforms: appData.segments[index].platforms || {},
        lineId: formData.get('lineId'),
        companyId: formData.get('companyId'),
        fromStationId: fromStationId,
        toStationId: toStationId,
        trainType: formData.get('trainType'),
        duration: parseInt(formData.get('duration')),
        distance: parseFloat(formData.get('distance')),
        stopsAt: [fromStationId, toStationId],
        isBidirectional: formData.get('isBidirectional') === 'on'
    };
    
    renderSegments();
}

function deleteSegment(index) {
    if (confirm('この区間を削除してもよろしいですか？')) {
        appData.segments.splice(index, 1);
        renderSegments();
    }
}

function filterSegments() {
    const lineId = document.getElementById('segment-line-filter').value;
    const cards = document.querySelectorAll('#segments-list .data-card');
    
    cards.forEach(card => {
        if (!lineId || card.dataset.lineId === lineId) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// ========================================
// 直通運転
// ========================================
function renderThroughServices() {
    const container = document.getElementById('through-services-list');
    container.innerHTML = '';

    if (appData.throughServiceConfigs.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだ直通運転が登録されていません。</p>';
        return;
    }

    appData.throughServiceConfigs.forEach((config, index) => {
        const card = createThroughServiceCard(config, index);
        container.appendChild(card);
    });
}

function createThroughServiceCard(config, index) {
    const fromLine = appData.lines.find(l => l.lineId === config.fromLineId);
    const toLine = appData.lines.find(l => l.lineId === config.toLineId);
    
    const fromLineName = fromLine ? fromLine.lineName : config.fromLineId;
    const toLineName = toLine ? toLine.lineName : config.toLineId;
    
    const fromType = appData.trainTypes.find(t => t.trainTypeId === config.fromTrainType);
    const toType = appData.trainTypes.find(t => t.trainTypeId === config.toTrainType);
    
    const fromTypeName = fromType ? fromType.trainTypeName : config.fromTrainType;
    const toTypeName = toType ? toType.trainTypeName : config.toTrainType;
    
    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${fromLineName} → ${toLineName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editThroughService(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deleteThroughService(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">設定ID:</div>
                <div class="view-value">${config.configId}</div>
            </div>
            <div class="view-field">
                <div class="view-label">乗入元路線:</div>
                <div class="view-value">${fromLineName} (${config.fromLineId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">乗入先路線:</div>
                <div class="view-value">${toLineName} (${config.toLineId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">元の種別:</div>
                <div class="view-value">${fromTypeName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">変更後の種別:</div>
                <div class="view-value">${toTypeName}</div>
            </div>
            <div class="view-field">
                <div class="view-label">説明:</div>
                <div class="view-value">${config.description || ''}</div>
            </div>
        </div>
    `;
    return card;
}

function addThroughService() {
    const newConfig = {
        configId: '',
        fromLineId: '',
        toLineId: '',
        fromTrainType: '',
        toTrainType: '',
        description: ''
    };
    appData.throughServiceConfigs.push(newConfig);
    const index = appData.throughServiceConfigs.length - 1;
    editThroughService(index);
}

function editThroughService(index) {
    const config = appData.throughServiceConfigs[index];
    const container = document.getElementById('through-services-list');
    const cards = container.children;
    
    const lineOptions = appData.lines.map(l => 
        `<option value="${l.lineId}">${l.lineName} (${l.lineId})</option>`
    ).join('');
    
    const trainTypeOptions = appData.trainTypes.map(t => 
        `<option value="${t.trainTypeId}">${t.trainTypeName}</option>`
    ).join('');
    
    cards[index].innerHTML = `
        <div class="card-header">
            <div class="card-title">直通運転を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="saveThroughService(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('through-services')">❌ キャンセル</button>
            </div>
        </div>
        <form id="through-form-${index}">
            <div class="form-group">
                <label>設定ID *</label>
                <input type="text" name="configId" value="${config.configId}" required placeholder="例: TS-A-LCL">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>乗入元路線 *</label>
                    <select name="fromLineId" required>
                        <option value="">選択してください</option>
                        ${lineOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>乗入先路線 *</label>
                    <select name="toLineId" required>
                        <option value="">選択してください</option>
                        ${lineOptions}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>元の列車種別 *</label>
                    <select name="fromTrainType" required>
                        <option value="">選択してください</option>
                        ${trainTypeOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>変更後の列車種別 *</label>
                    <select name="toTrainType" required>
                        <option value="">選択してください</option>
                        ${trainTypeOptions}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>説明</label>
                <input type="text" name="description" value="${config.description || ''}" placeholder="例: SUI→KT（普通）">
            </div>
        </form>
    `;
    
    // 既存値を選択
    const form = document.getElementById(`through-form-${index}`);
    form.fromLineId.value = config.fromLineId;
    form.toLineId.value = config.toLineId;
    form.fromTrainType.value = config.fromTrainType;
    form.toTrainType.value = config.toTrainType;
}

function saveThroughService(index) {
    const form = document.getElementById(`through-form-${index}`);
    const formData = new FormData(form);
    
    appData.throughServiceConfigs[index] = {
        configId: formData.get('configId'),
        fromLineId: formData.get('fromLineId'),
        toLineId: formData.get('toLineId'),
        fromTrainType: formData.get('fromTrainType'),
        toTrainType: formData.get('toTrainType'),
        description: formData.get('description')
    };
    
    renderThroughServices();
}

function deleteThroughService(index) {
    if (confirm('この直通運転設定を削除してもよろしいですか？')) {
        appData.throughServiceConfigs.splice(index, 1);
        renderThroughServices();
    }
}

// ========================================
// のりば乗換
// ========================================
function renderPlatformTransfers() {
    const container = document.getElementById('platform-transfers-list');
    container.innerHTML = '';

    if (appData.platformTransfers.length === 0) {
        container.innerHTML = '<p style="color: #6c757d; text-align: center; padding: 40px;">まだのりば乗換が登録されていません。</p>';
        return;
    }

    appData.platformTransfers.forEach((transfer, index) => {
        const card = createPlatformTransferCard(transfer, index);
        container.appendChild(card);
    });
}

function createPlatformTransferCard(transfer, index) {
    const station = appData.stations.find(s => s.stationId === transfer.stationId);
    const stationName = station ? station.stationName : transfer.stationId;
    
    const card = document.createElement('div');
    card.className = 'data-card';
    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${stationName}</div>
            <div class="card-actions">
                <button class="edit-btn" onclick="editPlatformTransfer(${index})">✏️ 編集</button>
                <button class="delete-btn" onclick="deletePlatformTransfer(${index})">🗑️ 削除</button>
            </div>
        </div>
        <div class="view-mode">
            <div class="view-field">
                <div class="view-label">駅:</div>
                <div class="view-value">${stationName} (${transfer.stationId})</div>
            </div>
            <div class="view-field">
                <div class="view-label">出発のりば:</div>
                <div class="view-value">${transfer.fromPlatform}</div>
            </div>
            <div class="view-field">
                <div class="view-label">到着のりば:</div>
                <div class="view-value">${transfer.toPlatform}</div>
            </div>
            <div class="view-field">
                <div class="view-label">乗換時間:</div>
                <div class="view-value">${transfer.transferTime}分</div>
            </div>
            <div class="view-field">
                <div class="view-label">直通:</div>
                <div class="view-value">${transfer.isDirectThrough ? '<span class="badge badge-success">はい</span>' : '<span class="badge badge-secondary">いいえ</span>'}</div>
            </div>
        </div>
    `;
    return card;
}

function addPlatformTransfer() {
    const newTransfer = {
        stationId: '',
        fromPlatform: '',
        toPlatform: '',
        transferTime: 0,
        isDirectThrough: false
    };
    appData.platformTransfers.push(newTransfer);
    const index = appData.platformTransfers.length - 1;
    editPlatformTransfer(index);
}

function editPlatformTransfer(index) {
    const transfer = appData.platformTransfers[index];
    const container = document.getElementById('platform-transfers-list');
    const cards = container.children;
    
    const stationOptions = appData.stations.map(s => 
        `<option value="${s.stationId}" ${s.stationId === transfer.stationId ? 'selected' : ''}>${s.stationName} (${s.stationId})</option>`
    ).join('');
    
    cards[index].innerHTML = `
        <div class="card-header">
            <div class="card-title">のりば乗換を編集</div>
            <div class="card-actions">
                <button class="save-btn" onclick="savePlatformTransfer(${index})">💾 保存</button>
                <button class="cancel-btn" onclick="cancelEdit('platform-transfers')">❌ キャンセル</button>
            </div>
        </div>
        <form id="platform-form-${index}">
            <div class="form-group">
                <label>駅 *</label>
                <select name="stationId" required>
                    <option value="">選択してください</option>
                    ${stationOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>出発のりば *</label>
                    <input type="text" name="fromPlatform" value="${transfer.fromPlatform}" required placeholder="例: 1番線">
                </div>
                <div class="form-group">
                    <label>到着のりば *</label>
                    <input type="text" name="toPlatform" value="${transfer.toPlatform}" required placeholder="例: 2番線">
                </div>
            </div>
            <div class="form-group">
                <label>乗換時間（分） *</label>
                <input type="number" name="transferTime" value="${transfer.transferTime}" required min="0" placeholder="2">
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="isDirectThrough" ${transfer.isDirectThrough ? 'checked' : ''}>
                    <span>直通運転（同一ホームで乗換不要）</span>
                </label>
            </div>
        </form>
    `;
}

function savePlatformTransfer(index) {
    const form = document.getElementById(`platform-form-${index}`);
    const formData = new FormData(form);
    
    appData.platformTransfers[index] = {
        stationId: formData.get('stationId'),
        fromPlatform: formData.get('fromPlatform'),
        toPlatform: formData.get('toPlatform'),
        transferTime: parseInt(formData.get('transferTime')),
        isDirectThrough: formData.get('isDirectThrough') === 'on'
    };
    
    renderPlatformTransfers();
}

function deletePlatformTransfer(index) {
    if (confirm('こののりば乗換を削除してもよろしいですか？')) {
        appData.platformTransfers.splice(index, 1);
        renderPlatformTransfers();
    }
}

// ========================================
// 共通: キャンセル
// ========================================
function cancelEdit(section) {
    renderSection(section);
}

// ========================================
// データエクスポート
// ========================================
function exportData() {
    // 最終更新日を更新
    appData.meta.lastUpdated = new Date().toISOString().split('T')[0];
    
    const dataStr = JSON.stringify(appData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    a.click();
    
    URL.revokeObjectURL(url);
    
    alert('✅ data.jsonをダウンロードしました！');
}

function togglePreview() {
    const preview = document.getElementById('json-preview');
    if (preview.style.display === 'none') {
        preview.style.display = 'block';
        preview.textContent = JSON.stringify(appData, null, 2);
    } else {
        preview.style.display = 'none';
    }
}

function loadDataFile() {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            appData = JSON.parse(e.target.result);
            alert('✅ データファイルを読み込みました！');
            renderSection('companies');
        } catch (error) {
            alert('❌ ファイルの読み込みに失敗しました。正しいJSON形式か確認してください。');
            console.error(error);
        }
    };
    reader.readAsText(file);
}
