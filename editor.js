// グローバル変数
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

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    tryLoadExistingData();
});

function initializeNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            switchSection(btn.dataset.section);
        });
    });
}

    // Enable clickable sort controls in table headers
    const _tableSortState = {};
    const _tableConfigs = {
        'companies-table': {
            getData: () => appData.companies,
            render: () => renderCompanies(),
            accessors: {
                1: (it) => it.companyId || '',
                2: (it) => it.companyName || '',
                3: (it) => it.isOwnCompany ? 1 : 0
            }
        },
        'train-types-table': {
            getData: () => appData.trainTypes,
            render: () => renderTrainTypes(),
            accessors: {
                1: (it) => it.trainTypeId || '',
                2: (it) => it.trainTypeName || '',
                3: (it) => it.trainTypeNameShort || '',
                4: (it) => Number(it.priority) || 0,
                5: (it) => it.color || ''
            }
        },
        'lines-table': {
            getData: () => appData.lines,
            render: () => renderLines(),
            accessors: {
                1: (it) => it.lineId || '',
                2: (it) => it.lineName || '',
                3: (it) => it.companyId || '',
                4: (it) => it.lineColor || ''
            }
        },
        'stations-table': {
            getData: () => appData.stations,
            render: () => renderStations(),
            accessors: {
                1: (it) => it.stationId || '',
                2: (it) => it.stationName || '',
                3: (it) => it.stationNameKana || '',
                4: (it) => Number(it.latitude) || 0,
                5: (it) => Number(it.longitude) || 0
            }
        },
        'segments-table': {
            getData: () => appData.segments,
            render: () => renderSegments(),
            accessors: {
                1: (it) => it.segmentId || '',
                2: (it) => it.lineId || '',
                3: (it) => it.companyId || '',
                4: (it) => it.fromStationId || '',
                5: (it) => (it.platforms && it.platforms[it.fromStationId]) ? it.platforms[it.fromStationId] : '',
                6: (it) => it.toStationId || '',
                7: (it) => (it.platforms && it.platforms[it.toStationId]) ? it.platforms[it.toStationId] : '',
                8: (it) => it.trainType || '',
                9: (it) => Number(it.duration) || 0,
                10: (it) => Number(it.distance) || 0,
                11: (it) => it.isBidirectional ? 1 : 0,
                12: (it) => it.isAlightOnly ? 1 : 0
            }
        },
        'through-services-table': {
            getData: () => appData.throughServiceConfigs,
            render: () => renderThroughServices(),
            accessors: {
                1: (it) => it.configId || '',
                2: (it) => it.fromLineId || '',
                3: (it) => it.toLineId || '',
                4: (it) => it.fromTrainType || '',
                5: (it) => it.toTrainType || '',
                6: (it) => it.isBidirectional ? 1 : 0,
                7: (it) => it.description || ''
            }
        },
        'platform-transfers-table': {
            getData: () => appData.platformTransfers,
            render: () => renderPlatformTransfers(),
            accessors: {
                1: (it) => it.transferId || it.id || '',
                2: (it) => it.stationId || '',
                3: (it) => it.fromPlatform || '',
                4: (it) => it.toPlatform || '',
                5: (it) => Number(it.transferTime) || 0
            }
        }
    };

    function enableTableSorting() {
        Object.keys(_tableConfigs).forEach(tableId => {
            const table = document.getElementById(tableId);
            if (!table) return;
            const thead = table.querySelector('thead');
            if (!thead) return;
            const ths = thead.querySelectorAll('th');
            ths.forEach((th, idx) => {
                // avoid adding duplicate buttons
                if (th.querySelector('.sort-btn')) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'sort-btn';
                btn.title = '昇順/降順';
                btn.style.cssText = 'float: right; font-size:11px; padding:0 4px; margin-left:6px;';
                btn.textContent = '▲▼';
                btn.dataset.table = tableId;
                btn.dataset.col = idx;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tId = e.currentTarget.dataset.table;
                    const col = Number(e.currentTarget.dataset.col);
                    const stateKey = `${tId}|${col}`;
                    const prev = _tableSortState[stateKey] || {asc: true};
                    const asc = !prev.asc; // toggle
                    _tableSortState[stateKey] = {asc};
                    performSort(tId, col, asc);
                });
                th.appendChild(btn);
            });
        });
    }

    function performSort(tableId, colIndex, asc) {
        const cfg = _tableConfigs[tableId];
        if (!cfg) return;
        const data = cfg.getData();
        const accessor = cfg.accessors[colIndex];
        if (!accessor) {
            // fallback: no accessor for this column
            return;
        }
        data.sort((a, b) => {
            const va = accessor(a);
            const vb = accessor(b);
            // numeric compare if both numbers
            if (typeof va === 'number' && typeof vb === 'number') {
                return asc ? va - vb : vb - va;
            }
            const sa = String(va || '').toLowerCase();
            const sb = String(vb || '').toLowerCase();
            if (sa < sb) return asc ? -1 : 1;
            if (sa > sb) return asc ? 1 : -1;
            return 0;
        });
        cfg.render();
    }

function switchSection(sectionId) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
    });
    document.querySelectorAll('.edit-section').forEach(section => {
        section.classList.toggle('active', section.id === sectionId);
    });
    renderSection(sectionId);
}

async function tryLoadExistingData() {
    try {
        // サーバーAPIから読込（サーバーが起動していない場合はローカルファイルにフォールバック）
        let response = await fetch('/api/data');
        if (!response.ok) {
            response = await fetch('data.json');
        }
        if (response.ok) {
            appData = await response.json();
            // 旧データが分単位で保存されている可能性があるため、秒単位へ変換
            convertTimesToSecondsIfNeeded(appData);
            renderSection('companies');
            updateServerStatus(true);
        }
    } catch (error) {
        console.log('data.jsonが見つかりません');
        updateServerStatus(false);
    }
}

// --- 時間ユーティリティ ---
function formatSeconds(sec) {
    sec = parseInt(sec) || 0;
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (s === 0) return `${m}分`;
    return `${m}分 ${s}秒`;
}

function convertTimesToSecondsIfNeeded(data) {
    if (!data) return;
    const segs = data.segments || [];
    const transfers = data.platformTransfers || [];
    const maxSeg = segs.reduce((max, s) => Math.max(max, Math.abs(Number(s.duration) || 0)), 0);
    const maxTrans = transfers.reduce((max, t) => Math.max(max, Math.abs(Number(t.transferTime) || 0)), 0);
    // どちらも小さめ（<=120）なら分単位で保存されていると推定して秒へ変換
    const likelyMinutes = maxSeg > 0 && maxSeg <= 120 && maxTrans <= 120;
    if (likelyMinutes) {
        segs.forEach(s => {
            if (s.duration !== undefined && s.duration !== null) s.duration = Number(s.duration) * 60;
        });
        transfers.forEach(t => {
            if (t.transferTime !== undefined && t.transferTime !== null) t.transferTime = Number(t.transferTime) * 60;
        });
    }
}

function updateServerStatus(isOnline) {
    const statusEl = document.getElementById('server-status');
    if (statusEl) {
        if (isOnline) {
            statusEl.textContent = 'サーバー接続: オンライン';
            statusEl.style.color = '#080';
        } else {
            statusEl.textContent = 'サーバー接続: オフライン（ローカルモード）';
            statusEl.style.color = '#c00';
        }
    }
}

function renderSection(sectionId) {
    switch (sectionId) {
        case 'companies': renderCompanies(); break;
        case 'train-types': renderTrainTypes(); break;
        case 'lines': renderLines(); break;
        case 'stations': renderStations(); break;
        case 'segments': renderSegments(); break;
        case 'through-services': renderThroughServices(); break;
        case 'platform-transfers': renderPlatformTransfers(); break;
        case 'help': break; // 使い方セクションは静的HTMLなので処理不要
    }
    // 各テーブルのヘッダにソートボタンを有効化（表示のみのクライアントソート）
    enableTableSorting();
}

// 鉄道会社
function renderCompanies() {
    const tbody = document.getElementById('companies-tbody');
    tbody.innerHTML = '';
    appData.companies.forEach((company, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${index + 1}</td>
            <td>${esc(company.companyId)}</td>
            <td>${esc(company.companyName)}</td>
            <td style="text-align: center;">${company.isOwnCompany ? '○' : ''}</td>
            <td>
                <button class="edit-btn" onclick="editCompanyRow(${index})">編集</button>
                <button class="delete-btn" onclick="deleteCompany(${index})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addCompany() {
    appData.companies.push({companyId: '', companyName: '', isOwnCompany: false});
    renderCompanies();
    editCompanyRow(appData.companies.length - 1);
}

function editCompanyRow(index) {
    const c = appData.companies[index];
    const tr = document.getElementById('companies-tbody').children[index];
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(c.companyId)}" id="eci-${index}"></td>
        <td><input type="text" value="${esc(c.companyName)}" id="ecn-${index}"></td>
        <td style="text-align: center;"><input type="checkbox" ${c.isOwnCompany ? 'checked' : ''} id="eco-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveCompany(${index})">保存</button>
            <button class="cancel-btn" onclick="renderCompanies()">取消</button>
        </td>
    `;
}

function saveCompany(index) {
    appData.companies[index] = {
        companyId: document.getElementById('eci-' + index).value,
        companyName: document.getElementById('ecn-' + index).value,
        isOwnCompany: document.getElementById('eco-' + index).checked
    };
    const own = appData.companies.find(c => c.isOwnCompany);
    if (own) appData.meta.ownCompanyId = own.companyId;
    renderCompanies();
}

function deleteCompany(index) {
    if (confirm('削除しますか？')) {
        appData.companies.splice(index, 1);
        renderCompanies();
    }
}

// 列車種別
function renderTrainTypes() {
    const tbody = document.getElementById('train-types-tbody');
    tbody.innerHTML = '';
    const sorted = [...appData.trainTypes].sort((a, b) => a.priority - b.priority);
    sorted.forEach((type, i) => {
        const idx = appData.trainTypes.indexOf(type);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${i + 1}</td>
            <td>${esc(type.trainTypeId)}</td>
            <td>${esc(type.trainTypeName)}</td>
            <td>${esc(type.trainTypeNameShort)}</td>
            <td>${type.priority}</td>
            <td><input type="color" value="${type.color}" disabled style="width: 100%;"></td>
            <td>
                <button class="edit-btn" onclick="editTrainTypeRow(${idx})">編集</button>
                <button class="delete-btn" onclick="deleteTrainType(${idx})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addTrainType() {
    appData.trainTypes.push({trainTypeId: '', trainTypeName: '', trainTypeNameShort: '', priority: 1, color: '#0078D7'});
    renderTrainTypes();
    editTrainTypeRow(appData.trainTypes.length - 1);
}

function editTrainTypeRow(index) {
    const t = appData.trainTypes[index];
    const sorted = [...appData.trainTypes].sort((a, b) => a.priority - b.priority);
    let rowIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
        if (appData.trainTypes.indexOf(sorted[i]) === index) {
            rowIdx = i;
            break;
        }
    }
    const tr = document.getElementById('train-types-tbody').children[rowIdx];
    tr.innerHTML = `
        <td class="row-number">${rowIdx + 1}</td>
        <td><input type="text" value="${esc(t.trainTypeId)}" id="eti-${index}"></td>
        <td><input type="text" value="${esc(t.trainTypeName)}" id="etn-${index}"></td>
        <td><input type="text" value="${esc(t.trainTypeNameShort)}" id="ets-${index}"></td>
        <td><input type="number" value="${t.priority}" id="etp-${index}" min="1"></td>
        <td><input type="color" value="${t.color}" id="etc-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveTrainType(${index})">保存</button>
            <button class="cancel-btn" onclick="renderTrainTypes()">取消</button>
        </td>
    `;
}

function saveTrainType(index) {
    appData.trainTypes[index] = {
        trainTypeId: document.getElementById('eti-' + index).value,
        trainTypeName: document.getElementById('etn-' + index).value,
        trainTypeNameShort: document.getElementById('ets-' + index).value,
        priority: parseInt(document.getElementById('etp-' + index).value),
        color: document.getElementById('etc-' + index).value
    };
    renderTrainTypes();
}

function deleteTrainType(index) {
    if (confirm('削除しますか？')) {
        appData.trainTypes.splice(index, 1);
        renderTrainTypes();
    }
}

// 路線
function renderLines() {
    const tbody = document.getElementById('lines-tbody');
    tbody.innerHTML = '';
    appData.lines.forEach((line, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${index + 1}</td>
            <td>${esc(line.lineId)}</td>
            <td>${esc(line.lineName)}</td>
            <td>${esc(line.companyId)}</td>
            <td><input type="color" value="${line.lineColor}" disabled style="width: 100%;"></td>
            <td>
                <button class="edit-btn" onclick="editLineRow(${index})">編集</button>
                <button class="delete-btn" onclick="deleteLine(${index})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addLine() {
    appData.lines.push({lineId: '', lineName: '', companyId: '', lineColor: '#0078D7', throughServices: []});
    renderLines();
    editLineRow(appData.lines.length - 1);
}

function editLineRow(index) {
    const l = appData.lines[index];
    const tr = document.getElementById('lines-tbody').children[index];
    const opts = appData.companies.map(c => 
        `<option value="${esc(c.companyId)}" ${c.companyId === l.companyId ? 'selected' : ''}>${esc(c.companyName)}</option>`
    ).join('');
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(l.lineId)}" id="eli-${index}"></td>
        <td><input type="text" value="${esc(l.lineName)}" id="eln-${index}"></td>
        <td><select id="elc-${index}">${opts}</select></td>
        <td><input type="color" value="${l.lineColor}" id="elco-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveLine(${index})">保存</button>
            <button class="cancel-btn" onclick="renderLines()">取消</button>
        </td>
    `;
}

function saveLine(index) {
    appData.lines[index] = {
        lineId: document.getElementById('eli-' + index).value,
        lineName: document.getElementById('eln-' + index).value,
        companyId: document.getElementById('elc-' + index).value,
        lineColor: document.getElementById('elco-' + index).value,
        throughServices: appData.lines[index].throughServices || []
    };
    renderLines();
}

function deleteLine(index) {
    if (confirm('削除しますか？')) {
        appData.lines.splice(index, 1);
        renderLines();
    }
}

// 駅
function renderStations() {
    const tbody = document.getElementById('stations-tbody');
    tbody.innerHTML = '';
    const search = (document.getElementById('station-search')?.value || '').toLowerCase();
    const filtered = appData.stations.filter(s => 
        s.stationName.toLowerCase().includes(search) || 
        s.stationNameKana.toLowerCase().includes(search) ||
        s.stationId.toLowerCase().includes(search)
    );
    filtered.forEach((station, i) => {
        const idx = appData.stations.indexOf(station);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${i + 1}</td>
            <td>${esc(station.stationId)}</td>
            <td>${esc(station.stationName)}</td>
            <td>${esc(station.stationNameKana)}</td>
            <td>${station.latitude}</td>
            <td>${station.longitude}</td>
            <td>
                <button class="edit-btn" onclick="editStationRow(${idx})">編集</button>
                <button class="delete-btn" onclick="deleteStation(${idx})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addStation() {
    appData.stations.push({stationId: '', stationName: '', stationNameKana: '', latitude: 35.0, longitude: 139.0});
    renderStations();
    editStationRow(appData.stations.length - 1);
}

function editStationRow(index) {
    const s = appData.stations[index];
    const search = (document.getElementById('station-search')?.value || '').toLowerCase();
    const filtered = appData.stations.filter(st => 
        st.stationName.toLowerCase().includes(search) || 
        st.stationNameKana.toLowerCase().includes(search) ||
        st.stationId.toLowerCase().includes(search)
    );
    let rowIdx = 0;
    for (let i = 0; i < filtered.length; i++) {
        if (appData.stations.indexOf(filtered[i]) === index) {
            rowIdx = i;
            break;
        }
    }
    const tr = document.getElementById('stations-tbody').children[rowIdx];
    tr.innerHTML = `
        <td class="row-number">${rowIdx + 1}</td>
        <td><input type="text" value="${esc(s.stationId)}" id="esi-${index}"></td>
        <td><input type="text" value="${esc(s.stationName)}" id="esn-${index}"></td>
        <td><input type="text" value="${esc(s.stationNameKana)}" id="esk-${index}"></td>
        <td><input type="number" step="0.000001" value="${s.latitude}" id="eslat-${index}"></td>
        <td><input type="number" step="0.000001" value="${s.longitude}" id="eslon-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveStation(${index})">保存</button>
            <button class="cancel-btn" onclick="renderStations()">取消</button>
        </td>
    `;
}

function saveStation(index) {
    appData.stations[index] = {
        stationId: document.getElementById('esi-' + index).value,
        stationName: document.getElementById('esn-' + index).value,
        stationNameKana: document.getElementById('esk-' + index).value,
        latitude: parseFloat(document.getElementById('eslat-' + index).value),
        longitude: parseFloat(document.getElementById('eslon-' + index).value)
    };
    renderStations();
}

function deleteStation(index) {
    if (confirm('削除しますか？')) {
        appData.stations.splice(index, 1);
        renderStations();
    }
}

function filterStations() {
    renderStations();
}

// 区間 - 簡略版（platforms, stopsAtは保持）
function renderSegments() {
    const tbody = document.getElementById('segments-tbody');
    tbody.innerHTML = '';
    const filter = document.getElementById('segment-line-filter');
    if (filter.options.length === 1) {
        appData.lines.forEach(line => {
            const opt = document.createElement('option');
            opt.value = line.lineId;
            opt.textContent = line.lineName;
            filter.appendChild(opt);
        });
    }
    const filterVal = filter.value;
    const filtered = filterVal ? appData.segments.filter(s => s.lineId === filterVal) : appData.segments;
    filtered.forEach((seg, i) => {
        const idx = appData.segments.indexOf(seg);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${i + 1}</td>
            <td>${esc(seg.segmentId)}</td>
            <td>${esc(seg.lineId)}</td>
            <td>${esc(seg.companyId)}</td>
            <td>${esc(seg.fromStationId)}</td>
            <td>${esc(seg.platforms && seg.platforms[seg.fromStationId] ? esc(seg.platforms[seg.fromStationId]) : '')}</td>
            <td>${esc(seg.toStationId)}</td>
            <td>${esc(seg.platforms && seg.platforms[seg.toStationId] ? esc(seg.platforms[seg.toStationId]) : '')}</td>
            <td>${esc(seg.trainType)}</td>
            <td>${formatSeconds(seg.duration)}</td>
            <td>${seg.distance}</td>
            <td style="text-align: center;">${seg.isBidirectional ? '○' : ''}</td>
            <td style="text-align: center;">${seg.isAlightOnly ? '○' : ''}</td>
            <td>
                <button class="edit-btn" onclick="editSegmentRow(${idx})">編集</button>
                <button class="delete-btn" onclick="deleteSegment(${idx})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addSegment() {
    appData.segments.push({segmentId: '', platforms: {}, lineId: '', companyId: '', fromStationId: '', toStationId: '', trainType: '', duration: 0, distance: 0, stopsAt: [], isBidirectional: true, isAlightOnly: false});
    renderSegments();
    editSegmentRow(appData.segments.length - 1);
}

function editSegmentRow(index) {
    const seg = appData.segments[index];
    const filterVal = document.getElementById('segment-line-filter').value;
    const filtered = filterVal ? appData.segments.filter(s => s.lineId === filterVal) : appData.segments;
    let rowIdx = 0;
    for (let i = 0; i < filtered.length; i++) {
        if (appData.segments.indexOf(filtered[i]) === index) {
            rowIdx = i;
            break;
        }
    }
    const lineOpts = appData.lines.map(l => `<option value="${esc(l.lineId)}" ${l.lineId === seg.lineId ? 'selected' : ''}>${esc(l.lineName)}</option>`).join('');
    const typeOpts = appData.trainTypes.map(t => `<option value="${esc(t.trainTypeId)}" ${t.trainTypeId === seg.trainType ? 'selected' : ''}>${esc(t.trainTypeName)}</option>`).join('');
    
    // 駅候補リストを生成
    const stationOpts = appData.stations.map(s => `<option value="${esc(s.stationId)}">${esc(s.stationName)}</option>`).join('');
    
    const tr = document.getElementById('segments-tbody').children[rowIdx];
    // 分/秒入力を追加
    const dur = parseInt(seg.duration) || 0;
    const durMin = Math.floor(dur / 60);
    const durSec = dur % 60;
    tr.innerHTML = `
        <td class="row-number">${rowIdx + 1}</td>
        <td><input type="text" value="${esc(seg.segmentId)}" id="esegi-${index}" style="width: 100%;"></td>
        <td><select id="esegl-${index}" onchange="updateSegmentCompany(${index})">${lineOpts}</select></td>
        <td><input type="text" value="${esc(seg.companyId)}" id="esegc-${index}" readonly style="background: #e0e0e0; cursor: not-allowed;"></td>
        <td>
            <input type="text" value="${esc(seg.fromStationId)}" id="esegf-${index}" list="station-list-from-${index}" autocomplete="off" placeholder="駅ID入力" onchange="onSegmentStationChange(${index}, 'from')">
            <datalist id="station-list-from-${index}">${stationOpts}</datalist>
        </td>
        <td>
            <input type="text" value="${esc(seg.platforms && seg.platforms[seg.fromStationId] ? esc(seg.platforms[seg.fromStationId]) : '')}" id="esegfplat-${index}" placeholder="番線ID">
        </td>
        <td>
            <input type="text" value="${esc(seg.toStationId)}" id="esegt-${index}" list="station-list-to-${index}" autocomplete="off" placeholder="駅ID入力" onchange="onSegmentStationChange(${index}, 'to')">
            <datalist id="station-list-to-${index}">${stationOpts}</datalist>
        </td>
        <td>
            <input type="text" value="${esc(seg.platforms && seg.platforms[seg.toStationId] ? esc(seg.platforms[seg.toStationId]) : '')}" id="esegtplat-${index}" placeholder="番線ID">
        </td>
        <td><select id="esegtt-${index}">${typeOpts}</select></td>
        <td>
            <input type="number" value="${durMin}" id="esegd-min-${index}" min="0" style="width:45%; display:inline-block;"> 分
            <input type="number" value="${durSec}" id="esegd-sec-${index}" min="0" max="59" style="width:45%; display:inline-block; margin-left:4px;"> 秒
        </td>
        <td><input type="number" step="0.01" value="${seg.distance}" id="esegdist-${index}" min="0"></td>
        <td style="text-align: center;"><input type="checkbox" ${seg.isBidirectional ? 'checked' : ''} id="esegb-${index}"></td>
        <td style="text-align: center;"><input type="checkbox" ${seg.isAlightOnly ? 'checked' : ''} id="esega-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveSegment(${index})">保存</button>
            <button class="cancel-btn" onclick="renderSegments()">取消</button>
        </td>
    `;
    
    // 路線選択時に会社IDを自動設定
    updateSegmentCompany(index);
}

// 路線IDに基づいて会社IDを自動設定
function updateSegmentCompany(index) {
    const lineId = document.getElementById('esegl-' + index).value;
    const line = appData.lines.find(l => l.lineId === lineId);
    if (line) {
        document.getElementById('esegc-' + index).value = line.companyId;
    }
}

// Called when user changes the from/to station while editing a segment
function onSegmentStationChange(index, which) {
    // which = 'from' or 'to'
    const stationInput = document.getElementById(which === 'from' ? ('esegf-' + index) : ('esegt-' + index));
    const platInput = document.getElementById(which === 'from' ? ('esegfplat-' + index) : ('esegtplat-' + index));
    const stationId = stationInput.value;
    // Try to auto-fill platform if existing mapping has an entry for this station
    const existingPlatforms = appData.segments[index] && appData.segments[index].platforms ? appData.segments[index].platforms : {};
    if (existingPlatforms[stationId]) {
        platInput.value = existingPlatforms[stationId];
    } else {
        // clear platform input to force user to set if needed
        platInput.value = '';
    }
}

function saveSegment(index) {
    // preserve existing platforms mapping, but update keys for from/to stations
    const prevPlatforms = appData.segments[index] && appData.segments[index].platforms ? {...appData.segments[index].platforms} : {};
    const newFromStation = document.getElementById('esegf-' + index).value;
    const newToStation = document.getElementById('esegt-' + index).value;
    const newFromPlat = document.getElementById('esegfplat-' + index).value;
    const newToPlat = document.getElementById('esegtplat-' + index).value;

    const newPlatforms = {...prevPlatforms};
    // Remove any previous entries that belonged to old from/to station IDs if they changed
    if (appData.segments[index] && appData.segments[index].fromStationId && appData.segments[index].fromStationId !== newFromStation) {
        delete newPlatforms[appData.segments[index].fromStationId];
    }
    if (appData.segments[index] && appData.segments[index].toStationId && appData.segments[index].toStationId !== newToStation) {
        delete newPlatforms[appData.segments[index].toStationId];
    }
    // Set new platform values if provided (empty string means no entry)
    if (newFromPlat && newFromPlat.trim() !== '') newPlatforms[newFromStation] = newFromPlat.trim();
    if (newToPlat && newToPlat.trim() !== '') newPlatforms[newToStation] = newToPlat.trim();

    appData.segments[index] = {
        segmentId: document.getElementById('esegi-' + index).value,
        platforms: newPlatforms,
        lineId: document.getElementById('esegl-' + index).value,
        companyId: document.getElementById('esegc-' + index).value,
        fromStationId: newFromStation,
        toStationId: newToStation,
        trainType: document.getElementById('esegtt-' + index).value,
        duration: (parseInt(document.getElementById('esegd-min-' + index).value || 0) * 60) + (parseInt(document.getElementById('esegd-sec-' + index).value || 0)),
        distance: parseFloat(document.getElementById('esegdist-' + index).value),
        stopsAt: appData.segments[index].stopsAt || [],
        isBidirectional: document.getElementById('esegb-' + index).checked,
        isAlightOnly: document.getElementById('esega-' + index).checked
    };
    renderSegments();
}

function deleteSegment(index) {
    if (confirm('削除しますか？')) {
        appData.segments.splice(index, 1);
        renderSegments();
    }
}

function filterSegments() {
    renderSegments();
}

// 直通運転
function renderThroughServices() {
    const tbody = document.getElementById('through-services-tbody');
    tbody.innerHTML = '';
    appData.throughServiceConfigs.forEach((cfg, index) => {
        const directionText = cfg.isBidirectional ? '相互直通' : '一方向';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${index + 1}</td>
            <td>${esc(cfg.configId)}</td>
            <td>${esc(cfg.fromLineId)}</td>
            <td>${esc(cfg.toLineId)}</td>
            <td>${esc(cfg.fromTrainType)}</td>
            <td>${esc(cfg.toTrainType)}</td>
            <td>${directionText}</td>
            <td>${esc(cfg.description)}</td>
            <td>
                <button class="edit-btn" onclick="editThroughServiceRow(${index})">編集</button>
                <button class="delete-btn" onclick="deleteThroughService(${index})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addThroughService() {
    appData.throughServiceConfigs.push({configId: '', fromLineId: '', toLineId: '', fromTrainType: '', toTrainType: '', isBidirectional: true, description: ''});
    renderThroughServices();
    editThroughServiceRow(appData.throughServiceConfigs.length - 1);
}

function editThroughServiceRow(index) {
    const cfg = appData.throughServiceConfigs[index];
    const lineOpts = appData.lines.map(l => `<option value="${esc(l.lineId)}">${esc(l.lineName)}</option>`).join('');
    const typeOpts = appData.trainTypes.map(t => `<option value="${esc(t.trainTypeId)}">${esc(t.trainTypeName)}</option>`).join('');
    
    const fromLineOpts = appData.lines.map(l => `<option value="${esc(l.lineId)}" ${l.lineId === cfg.fromLineId ? 'selected' : ''}>${esc(l.lineName)}</option>`).join('');
    const toLineOpts = appData.lines.map(l => `<option value="${esc(l.lineId)}" ${l.lineId === cfg.toLineId ? 'selected' : ''}>${esc(l.lineName)}</option>`).join('');
    const fromTypeOpts = appData.trainTypes.map(t => `<option value="${esc(t.trainTypeId)}" ${t.trainTypeId === cfg.fromTrainType ? 'selected' : ''}>${esc(t.trainTypeName)}</option>`).join('');
    const toTypeOpts = appData.trainTypes.map(t => `<option value="${esc(t.trainTypeId)}" ${t.trainTypeId === cfg.toTrainType ? 'selected' : ''}>${esc(t.trainTypeName)}</option>`).join('');
    
    const tr = document.getElementById('through-services-tbody').children[index];
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(cfg.configId)}" id="etsi-${index}"></td>
        <td><select id="etsf-${index}">${fromLineOpts}</select></td>
        <td><select id="etst-${index}">${toLineOpts}</select></td>
        <td><select id="etsft-${index}">${fromTypeOpts}</select></td>
        <td><select id="etstt-${index}">${toTypeOpts}</select></td>
        <td style="text-align: center;">
            <select id="etsb-${index}">
                <option value="true" ${cfg.isBidirectional ? 'selected' : ''}>相互直通</option>
                <option value="false" ${!cfg.isBidirectional ? 'selected' : ''}>一方向</option>
            </select>
        </td>
        <td><input type="text" value="${esc(cfg.description)}" id="etsd-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveThroughService(${index})">保存</button>
            <button class="cancel-btn" onclick="renderThroughServices()">取消</button>
        </td>
    `;
}

function saveThroughService(index) {
    appData.throughServiceConfigs[index] = {
        configId: document.getElementById('etsi-' + index).value,
        fromLineId: document.getElementById('etsf-' + index).value,
        toLineId: document.getElementById('etst-' + index).value,
        fromTrainType: document.getElementById('etsft-' + index).value,
        toTrainType: document.getElementById('etstt-' + index).value,
        isBidirectional: document.getElementById('etsb-' + index).value === 'true',
        description: document.getElementById('etsd-' + index).value
    };
    renderThroughServices();
}

function deleteThroughService(index) {
    if (confirm('削除しますか？')) {
        appData.throughServiceConfigs.splice(index, 1);
        renderThroughServices();
    }
}

// のりば乗換
function renderPlatformTransfers() {
    const tbody = document.getElementById('platform-transfers-tbody');
    tbody.innerHTML = '';
    appData.platformTransfers.forEach((pt, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${index + 1}</td>
            <td>${esc(pt.transferId)}</td>
            <td>${esc(pt.stationId)}</td>
            <td>${esc(pt.fromPlatform)}</td>
            <td>${esc(pt.toPlatform)}</td>
            <td>${formatSeconds(pt.transferTime)}</td>
            <td>
                <button class="edit-btn" onclick="editPlatformTransferRow(${index})">編集</button>
                <button class="delete-btn" onclick="deletePlatformTransfer(${index})">削除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function addPlatformTransfer() {
    appData.platformTransfers.push({transferId: '', stationId: '', fromPlatform: '', toPlatform: '', transferTime: 180});
    renderPlatformTransfers();
    editPlatformTransferRow(appData.platformTransfers.length - 1);
}

function editPlatformTransferRow(index) {
    const pt = appData.platformTransfers[index];
    const tr = document.getElementById('platform-transfers-tbody').children[index];
    const t = parseInt(pt.transferTime) || 0;
    const tmin = Math.floor(t / 60);
    const tsec = t % 60;
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(pt.transferId)}" id="epti-${index}"></td>
        <td><input type="text" value="${esc(pt.stationId)}" id="epts-${index}"></td>
        <td><input type="text" value="${esc(pt.fromPlatform)}" id="eptf-${index}"></td>
        <td><input type="text" value="${esc(pt.toPlatform)}" id="eptt-${index}"></td>
        <td>
            <input type="number" value="${tmin}" id="epttime-min-${index}" min="0" style="width:45%; display:inline-block;"> 分
            <input type="number" value="${tsec}" id="epttime-sec-${index}" min="0" max="59" style="width:45%; display:inline-block; margin-left:4px;"> 秒
        </td>
        <td>
            <button class="save-btn" onclick="savePlatformTransfer(${index})">保存</button>
            <button class="cancel-btn" onclick="renderPlatformTransfers()">取消</button>
        </td>
    `;
}

function savePlatformTransfer(index) {
    appData.platformTransfers[index] = {
        transferId: document.getElementById('epti-' + index).value,
        stationId: document.getElementById('epts-' + index).value,
        fromPlatform: document.getElementById('eptf-' + index).value,
        toPlatform: document.getElementById('eptt-' + index).value,
        transferTime: (parseInt(document.getElementById('epttime-min-' + index).value || 0) * 60) + (parseInt(document.getElementById('epttime-sec-' + index).value || 0))
    };
    renderPlatformTransfers();
}

function deletePlatformTransfer(index) {
    if (confirm('削除しますか？')) {
        appData.platformTransfers.splice(index, 1);
        renderPlatformTransfers();
    }
}

// エクスポート/インポート
async function exportData() {
    appData.meta.lastUpdated = new Date().toISOString().split('T')[0];
    
    // エクスポート用にデータをクリーンアップ
    const exportData = cleanDataForExport(appData);
    
    // サーバーAPIで保存を試行
    try {
        const response = await fetch('/api/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(exportData)
        });
        
        if (response.ok) {
            const result = await response.json();
            alert('サーバーに保存しました！\nバックアップも作成されました。');
            updateServerStatus(true);
            return;
        }
    } catch (error) {
        console.log('サーバー保存失敗、ダウンロードします');
        updateServerStatus(false);
    }
    
    // サーバーが使えない場合はダウンロード
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    a.click();
    URL.revokeObjectURL(url);
    alert('ファイルをダウンロードしました。\n手動でサーバーにアップロードしてください。');
}

// エクスポート用にデータをクリーンアップ
function cleanDataForExport(data) {
    const cleaned = JSON.parse(JSON.stringify(data)); // Deep clone
    
    // 駅データから lines 配列を削除（app.js で動的生成されるため）
    if (cleaned.stations) {
        cleaned.stations = cleaned.stations.map(station => {
            const {lines, ...rest} = station;
            return rest;
        });
    }
    
    // 路線データから throughServices 配列を削除または空配列に
    if (cleaned.lines) {
        cleaned.lines = cleaned.lines.map(line => {
            const result = {...line};
            if (result.throughServices && result.throughServices.length === 0) {
                result.throughServices = [];
            }
            return result;
        });
    }
    
    return cleaned;
}

function togglePreview() {
    const preview = document.getElementById('json-preview');
    if (preview.style.display === 'none') {
        appData.meta.lastUpdated = new Date().toISOString().split('T')[0];
        const exportData = cleanDataForExport(appData);
        preview.textContent = JSON.stringify(exportData, null, 2);
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
}

function loadDataFile() {
    const file = document.getElementById('file-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            appData = JSON.parse(e.target.result);
            
            // サーバーに自動保存を試行
            try {
                const response = await fetch('/api/data', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(appData)
                });
                
                if (response.ok) {
                    alert('データを読み込み、サーバーに保存しました');
                    updateServerStatus(true);
                } else {
                    alert('データを読み込みました（サーバー保存失敗）');
                    updateServerStatus(false);
                }
            } catch (err) {
                alert('データを読み込みました（ローカルモード）');
                updateServerStatus(false);
            }
            
            renderSection('companies');
            switchSection('companies');
        } catch (error) {
            alert('JSONの読み込みに失敗: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// ユーティリティ
function esc(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
