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
        // テンプレートとなる雛形を読み込む（サーバーへの保存は行わない想定）
        // ここではサーバーが提供する雛形ファイル `new_data.json` を読み込み、
        // ローカル編集モードで開始します。
        const response = await fetch('new_data.json');
        if (response && response.ok) {
            appData = await response.json();
            // 雛形読み込みなのでオフライン／ローカルモードとして扱う
            renderSection('companies');
            updateServerStatus(false);
        }
    } catch (error) {
        console.log('new_data.json が見つかりません');
        // new_data.json がなければ空の状態で編集スタート（ローカルモード）
        updateServerStatus(false);
    }
}

// --- 時間ユーティリティ ---
function formatSeconds(sec) {
    sec = parseInt(sec) || 0;
    return `${sec}秒`;
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
    // required 属性を持つ列のハイライトを実行
    applyRequiredHighlightsToAllTables();
}

// --- Required highlighting / validation ---
// Validate a single table row: mark required-but-empty cells red (#ff0000).
// Centralized per-table required column map. Keys are table element IDs.
// Each array's boolean values correspond to column indices (0-based) in the rendered table row.
// True = required, False = optional. Fill unspecified tables conservatively (true where appropriate).
const REQUIRED_COLUMNS_BY_TABLE = {
    'companies-table': [ false, true, true, false, false ],
    'train-types-table': [ false, true, true, true, true, true, false ],
    'lines-table': [ false, true, true, true, true, false ],
    'stations-table': [ false, true, true, true, true, true, false ],
    'segments-table': [ false, true, true, true, true, true, true, true, true, true, true, false, false, false ],
    'through-services-table': [ false, true, true, true, true, true, false, false, false ],
    'platform-transfers-table': [ false, true, true, true, true, true, false ]
};

function updateTdHighlightForInput(el) {
    if (!el) return;
    // find parent td
    let td = el.closest('td');
    if (!td) return;
    // do not mark if input is disabled or readonly
    if (el.disabled || el.readOnly) {
        td.style.backgroundColor = '';
        return;
    }
    // check type: treat checkboxes/radios as always 'filled' (they have boolean state)
    if (el.type === 'checkbox' || el.type === 'radio') {
        td.style.backgroundColor = '';
        return;
    }
    // Prefer table-level required mapping when available
    const tr = td.closest('tr');
    let tableId = '';
    try { tableId = tr ? (tr.closest('table') ? tr.closest('table').id : '') : ''; } catch (e) { tableId = ''; }
    const cells = tr ? Array.from(tr.children) : [];
    const colIndex = cells.indexOf(td);
    const mapped = (tableId && REQUIRED_COLUMNS_BY_TABLE[tableId] && typeof colIndex === 'number') ? REQUIRED_COLUMNS_BY_TABLE[tableId][colIndex] : undefined;
    const val = (el.value || '').toString().trim();
    if ((mapped === undefined ? el.required : mapped) && val === '') {
        td.style.backgroundColor = '#ff0000';
    } else {
        td.style.backgroundColor = '';
    }
}

function applyRequiredHighlightsToRow(tr) {
    if (!tr) return;
    const cells = Array.from(tr.children);
    if (cells.length <= 2) return; // nothing to validate
    // iterate columns from one right of '#' (index 1) to one left of 操作 (last-1)
    // Determine table id for row-based required mapping
    let tableId = '';
    try { tableId = tr.closest('table') ? tr.closest('table').id : ''; } catch (e) { tableId = ''; }
    for (let i = 1; i < cells.length - 1; i++) {
        const td = cells[i];
        // prefer inputs/selects inside the cell
        const input = td.querySelector('input, select, textarea');
        const mappedRequired = tableId && REQUIRED_COLUMNS_BY_TABLE[tableId] ? REQUIRED_COLUMNS_BY_TABLE[tableId][i] : undefined;
        if (input) {
            // skip marking if disabled or readonly
            if (input.disabled || input.readOnly) {
                td.style.backgroundColor = '';
                continue;
            }
            if (input.type === 'checkbox' || input.type === 'radio') {
                // checkbox/radio are treated as non-empty for now
                td.style.backgroundColor = '';
                continue;
            }
            const val = (input.value || '').toString().trim();
            const requiredNow = (mappedRequired === undefined) ? input.required : mappedRequired;
            td.style.backgroundColor = (requiredNow && val === '') ? '#ff0000' : '';
        } else {
            // display mode cell: inspect text content only if mapped as required
            const txt = (td.textContent || '').toString().trim();
            if (mappedRequired === true && txt === '') td.style.backgroundColor = '#ff0000'; else td.style.backgroundColor = '';
        }
    }
}

function applyRequiredHighlightsToTbody(tbody) {
    if (!tbody) return;
    Array.from(tbody.children).forEach(tr => applyRequiredHighlightsToRow(tr));
}

function applyRequiredHighlightsToAllTables() {
    // find all table tbodies that are part of the editor (convention: have -tbody ids)
    const tbodies = document.querySelectorAll('tbody');
    tbodies.forEach(tb => applyRequiredHighlightsToTbody(tb));
}

// Global listeners: update highlight on user input/change for required inputs
document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el) return;
    if (el.matches('input[required], select[required], textarea[required]')) {
        try { updateTdHighlightForInput(el); } catch (err) {}
    }
});
document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el) return;
    if (el.matches('input[required], select[required], textarea[required]')) {
        try { updateTdHighlightForInput(el); } catch (err) {}
    }
});

// 鉄道会社
function renderCompanies() {
    const tbody = document.getElementById('companies-tbody');
    tbody.innerHTML = '';
    // detect duplicate company IDs (ignore empty)
    const idCounts = {};
    appData.companies.forEach(c => {
        const id = (c.companyId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    appData.companies.forEach((company, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
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
        const id = (company.companyId || '').toString();
        if (id && idCounts[id] > 1) {
            tr.style.backgroundColor = '#ff0000';
        }
        tbody.appendChild(tr);
    });
    // Apply required highlights for the companies table
    applyRequiredHighlightsToTbody(tbody);
}

function addCompany() {
    appData.companies.push({companyId: '', companyName: '', isOwnCompany: false});
    renderCompanies();
    editCompanyRow(appData.companies.length - 1);
    // Scroll the companies section table container to bottom so the new row is visible
    scrollToSectionBottom('companies');
}

function editCompanyRow(index) {
    const c = appData.companies[index];
    const tr = document.getElementById('companies-tbody').children[index];
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(c.companyId)}" id="eci-${index}" required></td>
        <td><input type="text" value="${esc(c.companyName)}" id="ecn-${index}" required></td>
    <td style="text-align: center;"><input type="checkbox" ${c.isOwnCompany ? 'checked' : ''} id="eco-${index}" disabled title="この項目は固定されています"></td>
        <td>
            <button class="save-btn" onclick="saveCompany(${index})">保存</button>
            <button class="cancel-btn" onclick="renderCompanies()">取消</button>
        </td>
    `;
    // highlight if duplicate companyId
    const id = (c.companyId || '').toString();
    if (id) {
        const counts = {};
        appData.companies.forEach(x => { const k = (x.companyId||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        tr.style.backgroundColor = counts[id] > 1 ? '#ff0000' : '';
    } else {
        tr.style.backgroundColor = '';
    }
}

function saveCompany(index) {
    // Preserve the existing isOwnCompany flag; user cannot change it from the editor
    const prevOwn = (appData.companies[index] && appData.companies[index].isOwnCompany) ? true : false;
    appData.companies[index] = {
        companyId: document.getElementById('eci-' + index).value,
        companyName: document.getElementById('ecn-' + index).value,
        isOwnCompany: prevOwn
    };
    const own = appData.companies.find(c => c.isOwnCompany);
    if (own) appData.meta.ownCompanyId = own.companyId;
    renderCompanies();
}

function deleteCompany(index) {
    showInlineDeleteConfirm('companies-tbody', index, `performDeleteCompany(${index})`);
}

// 列車種別
function renderTrainTypes() {
    const tbody = document.getElementById('train-types-tbody');
    tbody.innerHTML = '';
    const sorted = [...appData.trainTypes].sort((a, b) => a.priority - b.priority);
    // duplicate detection across trainTypeId
    const idCounts = {};
    appData.trainTypes.forEach(t => {
        const id = (t.trainTypeId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    sorted.forEach((type, i) => {
        const idx = appData.trainTypes.indexOf(type);
        const tr = document.createElement('tr');
        tr.dataset.index = idx;
        // Editing is disabled for train-types: no edit/delete buttons are rendered
        tr.innerHTML = `
            <td class="row-number">${i + 1}</td>
            <td>${esc(type.trainTypeId)}</td>
            <td>${esc(type.trainTypeName)}</td>
            <td>${esc(type.trainTypeNameShort)}</td>
            <td>${type.priority}</td>
            <td><input type="color" value="${type.color}" disabled style="width: 100%;"></td>
            <td style="text-align:center; color:#666; font-size:12px;">編集不可</td>
        `;
        const id = (type.trainTypeId || '').toString();
        if (id && idCounts[id] > 1) tr.style.backgroundColor = '#ff0000';
        tbody.appendChild(tr);
    });
    // Apply required highlights for train-types (mostly display-only)
    applyRequiredHighlightsToTbody(tbody);
    // Change the "+ 追加" button in the train-types section to read "編集不可" and disable it
    try {
        const section = document.getElementById('train-types');
        if (section) {
            const buttons = section.querySelectorAll('button');
            buttons.forEach(b => {
                const txt = (b.textContent || '').trim();
                if (txt.includes('追加') || txt.includes('+ 追加') || txt.includes('＋追加')) {
                    b.textContent = '編集不可';
                    b.disabled = true;
                    // remove any click handlers to be safe
                    b.onclick = null;
                }
            });
        }
    } catch (e) {
        // no-op
    }
}

function addTrainType() {
    // Disabled: train-type additions are not allowed via the UI
    // Silent no-op to make the button do nothing when clicked
    return;
}

function editTrainTypeRow(index) {
    // Editing train-types is disabled
    alert('列車種別エディタは編集不可です（編集は無効化されています）。');
    return;
}

function saveTrainType(index) {
    // Saving is disabled for train-types; this function should not be called in normal flow.
    alert('列車種別エディタは編集不可です（保存は無効です）。');
    return;
}

function deleteTrainType(index) {
    // Deletion is disabled for train-types
    alert('列車種別エディタは編集不可です（削除は無効化されています）。');
    return;
}

// 路線
function renderLines() {
    const tbody = document.getElementById('lines-tbody');
    tbody.innerHTML = '';
    // duplicate detection for lineId
    const idCounts = {};
    appData.lines.forEach(l => {
        const id = (l.lineId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    appData.lines.forEach((line, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
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
        const id = (line.lineId || '').toString();
        if (id && idCounts[id] > 1) tr.style.backgroundColor = '#ff0000';
        tbody.appendChild(tr);
    });
    // Apply required highlights for lines table
    applyRequiredHighlightsToTbody(tbody);
}

function addLine() {
    // generate a visually-uniform random color by sampling H (hue) uniformly
    // and choosing reasonable S/L ranges so colors are vivid but not too dark/light.
    const color = randomNiceHexColor();
    appData.lines.push({lineId: '', lineName: '', companyId: '', lineColor: color, throughServices: []});
    renderLines();
    editLineRow(appData.lines.length - 1);
    scrollToSectionBottom('lines');
}

// Convert HSL to hex. h in [0,360), s,l in [0,100]
function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hh = h / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (0 <= hh && hh < 1) { r1 = c; g1 = x; b1 = 0; }
    else if (hh < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (hh < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (hh < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (hh < 5) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    const m = l - c / 2;
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

// Generate a "nice" random color by sampling hue uniformly and restricting
// saturation/lightness to avoid very pale or very dark colors. This yields a
// perceptually more uniform distribution of hues than sampling RGB directly.
function randomNiceHexColor() {
    const h = Math.random() * 360; // uniform hue
    // pick saturation between 55% and 90% for vivid colors
    const s = 55 + Math.random() * 35;
    // pick lightness between 42% and 62% to avoid too dark or too light
    const l = 42 + Math.random() * 20;
    return hslToHex(h, s, l);
}

function editLineRow(index) {
    const l = appData.lines[index];
    const tr = document.getElementById('lines-tbody').children[index];
    const opts = appData.companies.map(c => 
        `<option value="${esc(c.companyId)}" ${c.companyId === l.companyId ? 'selected' : ''}>${esc(c.companyName)}</option>`
    ).join('');
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(l.lineId)}" id="eli-${index}" required></td>
        <td><input type="text" value="${esc(l.lineName)}" id="eln-${index}" required></td>
        <td><select id="elc-${index}" required>${opts}</select></td>
        <td><input type="color" value="${l.lineColor}" id="elco-${index}" required></td>
        <td>
            <button class="save-btn" onclick="saveLine(${index})">保存</button>
            <button class="cancel-btn" onclick="renderLines()">取消</button>
        </td>
    `;
    // highlight if duplicate lineId
    const id = (l.lineId || '').toString();
    if (id) {
        const counts = {};
        appData.lines.forEach(x => { const k = (x.lineId||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        tr.style.backgroundColor = counts[id] > 1 ? '#ff0000' : '';
    } else {
        tr.style.backgroundColor = '';
    }
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
    showInlineDeleteConfirm('lines-tbody', index, `performDeleteLine(${index})`);
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
    // duplicate detection across stationId
    const idCounts = {};
    appData.stations.forEach(s => {
        const id = (s.stationId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    filtered.forEach((station, i) => {
        const idx = appData.stations.indexOf(station);
        const tr = document.createElement('tr');
        tr.dataset.index = idx;
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
        const id = (station.stationId || '').toString();
        if (id && idCounts[id] > 1) tr.style.backgroundColor = '#ff0000';
        tbody.appendChild(tr);
    });
    // Apply required highlights for stations table
    applyRequiredHighlightsToTbody(tbody);
}

function addStation() {
    appData.stations.push({stationId: '', stationName: '', stationNameKana: '', latitude: 35.0, longitude: 139.0});
    renderStations();
    editStationRow(appData.stations.length - 1);
    scrollToSectionBottom('stations');
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
        <td><input type="text" value="${esc(s.stationId)}" id="esi-${index}" required></td>
        <td><input type="text" value="${esc(s.stationName)}" id="esn-${index}" required></td>
        <td><input type="text" value="${esc(s.stationNameKana)}" id="esk-${index}" required></td>
        <td><input type="number" step="0.000001" value="${s.latitude}" id="eslat-${index}" required></td>
        <td><input type="number" step="0.000001" value="${s.longitude}" id="eslon-${index}" required></td>
        <td>
            <button class="save-btn" onclick="saveStation(${index})">保存</button>
            <button class="cancel-btn" onclick="renderStations()">取消</button>
        </td>
    `;
    // highlight if duplicate stationId
    const id = (s.stationId || '').toString();
    if (id) {
        const counts = {};
        appData.stations.forEach(x => { const k = (x.stationId||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        tr.style.backgroundColor = counts[id] > 1 ? '#ff0000' : '';
    } else {
        tr.style.backgroundColor = '';
    }
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
    showInlineDeleteConfirm('stations-tbody', index, `performDeleteStation(${index})`);
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
    // Ensure every segment in the dataset has an ID for consistent duplicate detection
    appData.segments.forEach(s => {
        if (!s.segmentId || s.segmentId.toString().trim() === '') {
            s.segmentId = generateSegmentId(s.lineId, s.fromStationId, s.toStationId, s.trainType);
        }
    });
    // duplicate detection across all segments
    const idCounts = {};
    appData.segments.forEach(s => {
        const id = (s.segmentId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    const filtered = filterVal ? appData.segments.filter(s => s.lineId === filterVal) : appData.segments;
    filtered.forEach((seg, i) => {
        const idx = appData.segments.indexOf(seg);
        const tr = document.createElement('tr');
        tr.dataset.index = idx;
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
        const id = (seg.segmentId || '').toString();
        if (id && idCounts[id] > 1) tr.style.backgroundColor = '#ff0000';
        tbody.appendChild(tr);
    });
    // Apply required highlights for segments table
    applyRequiredHighlightsToTbody(tbody);
}

function addSegment() {
    const seg = {segmentId: '', platforms: {}, lineId: '', companyId: '', fromStationId: '', toStationId: '', trainType: '', duration: 0, distance: 0, stopsAt: [], isBidirectional: false, isAlightOnly: false};
    // set initial autogenerated id
    seg.segmentId = generateSegmentId(seg.lineId, seg.fromStationId, seg.toStationId, seg.trainType);
    appData.segments.push(seg);
    renderSegments();
    editSegmentRow(appData.segments.length - 1);
    scrollToSectionBottom('segments');
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
    
    // 駅候補リストはブラウザの datalist を使わずカスタム候補UIを使用するため削除
    
    const tr = document.getElementById('segments-tbody').children[rowIdx];
    // 秒単位の入力
    const dur = parseInt(seg.duration) || 0;
    tr.innerHTML = `
        <td class="row-number">${rowIdx + 1}</td>
        <td><input type="text" value="${esc(seg.segmentId)}" id="esegi-${index}" style="width: 100%; background:#e9e9e9;" readonly title="区間IDは自動生成されます" required></td>
        <td><select id="esegl-${index}" onchange="updateSegmentCompany(${index}); updateSegmentIdPreview(${index})" required>${lineOpts}</select></td>
        <td><input type="text" value="${esc(seg.companyId)}" id="esegc-${index}" readonly style="background: #e0e0e0; cursor: not-allowed;" required></td>
        <td>
            <input type="text" value="${esc(seg.fromStationId)}" id="esegf-${index}" autocomplete="off" placeholder="駅ID入力" onchange="onSegmentStationChange(${index}, 'from')" required>
        </td>
        <td>
            <input type="text" value="${esc(seg.platforms && seg.platforms[seg.fromStationId] ? esc(seg.platforms[seg.fromStationId]) : '')}" id="esegfplat-${index}" placeholder="番線ID" required>
        </td>
        <td>
            <input type="text" value="${esc(seg.toStationId)}" id="esegt-${index}" autocomplete="off" placeholder="駅ID入力" onchange="onSegmentStationChange(${index}, 'to')" required>
        </td>
        <td>
            <input type="text" value="${esc(seg.platforms && seg.platforms[seg.toStationId] ? esc(seg.platforms[seg.toStationId]) : '')}" id="esegtplat-${index}" placeholder="番線ID" required>
        </td>
        <td><select id="esegtt-${index}" onchange="updateSegmentIdPreview(${index})" required>${typeOpts}</select></td>
        <td>
            <input type="number" value="${dur}" id="esegd-${index}" min="0" required> 秒
        </td>
        <td><input type="number" step="0.01" value="${seg.distance}" id="esegdist-${index}" min="0" required></td>
    <td style="text-align: center;"><input type="checkbox" ${seg.isBidirectional ? 'checked' : ''} id="esegb-${index}"></td>
    <td style="text-align: center;"><input type="checkbox" ${seg.isAlightOnly ? 'checked' : ''} id="esega-${index}"></td>
        <td>
            <button class="save-btn" onclick="saveSegment(${index})">保存</button>
            <button class="cancel-btn" onclick="renderSegments()">取消</button>
        </td>
    `;
    
    // 路線選択時に会社IDを自動設定
    updateSegmentCompany(index);
    // Attach station suggestion handlers for from/to inputs
    try {
        const fromInput = document.getElementById('esegf-' + index);
        const toInput = document.getElementById('esegt-' + index);
        if (fromInput) {
            fromInput.addEventListener('input', () => _renderStationSuggestionsFor(index, 'from'));
            fromInput.addEventListener('focus', () => _renderStationSuggestionsFor(index, 'from'));
            fromInput.addEventListener('blur', () => setTimeout(() => _hideStationSuggestionsFor(index, 'from'), 180));
        }
        if (toInput) {
            toInput.addEventListener('input', () => _renderStationSuggestionsFor(index, 'to'));
            toInput.addEventListener('focus', () => _renderStationSuggestionsFor(index, 'to'));
            toInput.addEventListener('blur', () => setTimeout(() => _hideStationSuggestionsFor(index, 'to'), 180));
        }
    } catch (e) {
        // no-op
    }
    // highlight if duplicate segmentId
    const id = (seg.segmentId || '').toString();
    if (id) {
        const counts = {};
        appData.segments.forEach(x => { const k = (x.segmentId||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        tr.style.backgroundColor = counts[id] > 1 ? '#ff0000' : '';
    } else {
        tr.style.backgroundColor = '';
    }
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
    // update id preview because from/to station changed
    updateSegmentIdPreview(index);
}

// Generate segment ID in the format: SEG-{路線ID}-{始点駅ID}-{終点駅ID}-{列車種別ID}
function generateSegmentId(lineId, fromStationId, toStationId, trainTypeId) {
    const safe = (s) => (s || '').toString().trim();
    // remove spaces inside ids to keep IDs compact
    const clean = (s) => safe(s).replace(/\s+/g, '');
    return `SEG-${clean(lineId)}-${clean(fromStationId)}-${clean(toStationId)}-${clean(trainTypeId)}`;
}

// Update the readonly segment-id preview while editing
function updateSegmentIdPreview(index) {
    const idEl = document.getElementById('esegi-' + index);
    const lineEl = document.getElementById('esegl-' + index);
    const fromEl = document.getElementById('esegf-' + index);
    const toEl = document.getElementById('esegt-' + index);
    const ttEl = document.getElementById('esegtt-' + index);
    if (!idEl) return;
    const newId = generateSegmentId(
        lineEl ? lineEl.value : '',
        fromEl ? fromEl.value : '',
        toEl ? toEl.value : '',
        ttEl ? ttEl.value : ''
    );
    idEl.value = newId;
}

// Station suggestion dropdown for segment from/to inputs
function _hideStationSuggestionsFor(index, which) {
    const id = `station-suggest-${which}-${index}`;
    const existing = document.getElementById(id);
    if (existing) existing.remove();
}

function _renderStationSuggestionsFor(index, which, filterText) {
    _hideStationSuggestionsFor(index, which);
    const inputId = which === 'from' ? `esegf-${index}` : `esegt-${index}`;
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const q = (filterText || inputEl.value || '').toString().trim().toLowerCase();
    if (!q) return; // don't show suggestions on empty

    // find matches where stationId, stationName, or stationNameKana contains the query
    const matches = appData.stations.filter(s => {
        if (!s) return false;
        const id = (s.stationId || '').toString().toLowerCase();
        const name = (s.stationName || '').toString().toLowerCase();
        const kana = (s.stationNameKana || '').toString().toLowerCase();
        return id.includes(q) || name.includes(q) || kana.includes(q);
    }).slice(0, 30); // cap suggestions
    if (!matches.length) return;

    const rect = inputEl.getBoundingClientRect();
    const container = document.createElement('div');
    container.id = `station-suggest-${which}-${index}`;
    container.style.position = 'absolute';
    container.style.left = (rect.left + window.scrollX) + 'px';
    container.style.top = (rect.bottom + window.scrollY) + 'px';
    container.style.width = (rect.width) + 'px';
    container.style.maxHeight = '320px';
    container.style.overflow = 'auto';
    container.style.border = '1px solid #ccc';
    container.style.background = '#fff';
    container.style.zIndex = 2000;
    container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';

    matches.forEach(st => {
        const item = document.createElement('div');
        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';
        item.style.borderBottom = '1px solid #eee';
        item.onmouseenter = () => item.style.background = '#f3f3f3';
        item.onmouseleave = () => item.style.background = '';
    // content: 1) stationId, 2) bold large stationName
    const idLine = document.createElement('div');
    idLine.textContent = st.stationId || '';
    idLine.style.fontSize = '12px';
    idLine.style.color = '#222';
    const nameLine = document.createElement('div');
    nameLine.textContent = st.stationName || '';
    nameLine.style.fontWeight = '700';
    nameLine.style.fontSize = '14px';
    nameLine.style.lineHeight = '1.1';

    item.appendChild(idLine);
    item.appendChild(nameLine);

        item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            inputEl.value = st.stationId || '';
            _hideStationSuggestionsFor(index, which);
            // trigger change handlers to update platform and id preview
            try {
                onSegmentStationChange(index, which);
            } catch (e) {}
            try { updateSegmentIdPreview(index); } catch (e) {}
            inputEl.focus();
        });
        container.appendChild(item);
    });

    document.body.appendChild(container);

    // If the popup would extend below the viewport, flip it above the input
    try {
        const containerRect = container.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (containerRect.bottom > viewportHeight) {
            // place above input; ensure it doesn't go off the top of the page
            const topAbove = rect.top + window.scrollY - containerRect.height;
            container.style.top = Math.max(4, topAbove) + 'px';
            // optionally limit maxHeight so it fits between top and input
            const available = rect.top - 8; // space above input
            if (available > 40) {
                container.style.maxHeight = Math.min(320, available) + 'px';
                container.style.overflow = 'auto';
            }
        }
    } catch (e) {
        // ignore measurement errors
    }

    // Click outside to hide
    const onDocClick = (ev) => {
        if (!container.contains(ev.target) && ev.target !== inputEl) {
            _hideStationSuggestionsFor(index, which);
            document.removeEventListener('click', onDocClick);
        }
    };
    // attach after append so immediate click doesn't hide it
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
}

// Station suggestion dropdown specifically for platform-transfer station inputs
function _hidePlatformStationSuggestionsFor(index) {
    const id = `station-suggest-pt-${index}`;
    const existing = document.getElementById(id);
    if (existing) existing.remove();
}

function _renderPlatformStationSuggestionsFor(index, filterText) {
    _hidePlatformStationSuggestionsFor(index);
    const inputId = `epts-${index}`;
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const q = (filterText || inputEl.value || '').toString().trim().toLowerCase();
    if (!q) return; // don't show suggestions on empty

    const matches = appData.stations.filter(s => {
        if (!s) return false;
        const id = (s.stationId || '').toString().toLowerCase();
        const name = (s.stationName || '').toString().toLowerCase();
        const kana = (s.stationNameKana || '').toString().toLowerCase();
        return id.includes(q) || name.includes(q) || kana.includes(q);
    }).slice(0, 30);
    if (!matches.length) return;

    const rect = inputEl.getBoundingClientRect();
    const container = document.createElement('div');
    container.id = `station-suggest-pt-${index}`;
    container.style.position = 'absolute';
    container.style.left = (rect.left + window.scrollX) + 'px';
    container.style.top = (rect.bottom + window.scrollY) + 'px';
    container.style.width = (rect.width) + 'px';
    container.style.maxHeight = '320px';
    container.style.overflow = 'auto';
    container.style.border = '1px solid #ccc';
    container.style.background = '#fff';
    container.style.zIndex = 2000;
    container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';

    matches.forEach(st => {
        const item = document.createElement('div');
        item.style.padding = '6px 8px';
        item.style.cursor = 'pointer';
        item.style.borderBottom = '1px solid #eee';
        item.onmouseenter = () => item.style.background = '#f3f3f3';
        item.onmouseleave = () => item.style.background = '';
        const idLine = document.createElement('div');
        idLine.textContent = st.stationId || '';
        idLine.style.fontSize = '12px';
        idLine.style.color = '#222';
        const nameLine = document.createElement('div');
        nameLine.textContent = st.stationName || '';
        nameLine.style.fontWeight = '700';
        nameLine.style.fontSize = '14px';
        nameLine.style.lineHeight = '1.1';

        item.appendChild(idLine);
        item.appendChild(nameLine);

        item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            inputEl.value = st.stationId || '';
            _hidePlatformStationSuggestionsFor(index);
            inputEl.focus();
        });
        container.appendChild(item);
    });

    document.body.appendChild(container);

    // Flip above if it would overflow
    try {
        const containerRect = container.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (containerRect.bottom > viewportHeight) {
            const topAbove = rect.top + window.scrollY - containerRect.height;
            container.style.top = Math.max(4, topAbove) + 'px';
            const available = rect.top - 8;
            if (available > 40) {
                container.style.maxHeight = Math.min(320, available) + 'px';
                container.style.overflow = 'auto';
            }
        }
    } catch (e) {}

    const onDocClick = (ev) => {
        if (!container.contains(ev.target) && ev.target !== inputEl) {
            _hidePlatformStationSuggestionsFor(index);
            document.removeEventListener('click', onDocClick);
        }
    };
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
}

// Generate through-service ID in the format: TSV-{乗入元路線ID}-{乗入先路線ID}
function generateThroughServiceId(fromLineId, toLineId) {
    const safe = (s) => (s || '').toString().trim();
    const clean = (s) => safe(s).replace(/\s+/g, '');
    return `TSV-${clean(fromLineId)}-${clean(toLineId)}`;
}

// Update the readonly through-service configId preview while editing
function updateThroughServiceIdPreview(index) {
    const idEl = document.getElementById('etsi-' + index);
    const fromEl = document.getElementById('etsf-' + index);
    const toEl = document.getElementById('etst-' + index);
    if (!idEl) return;
    const newId = generateThroughServiceId(
        fromEl ? fromEl.value : '',
        toEl ? toEl.value : ''
    );
    idEl.value = newId;
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

    const computedId = generateSegmentId(
        document.getElementById('esegl-' + index).value,
        newFromStation,
        newToStation,
        document.getElementById('esegtt-' + index).value
    );
    appData.segments[index] = {
        segmentId: computedId,
        platforms: newPlatforms,
        lineId: document.getElementById('esegl-' + index).value,
        companyId: document.getElementById('esegc-' + index).value,
        fromStationId: newFromStation,
        toStationId: newToStation,
        trainType: document.getElementById('esegtt-' + index).value,
        duration: parseInt(document.getElementById('esegd-' + index).value || 0),
        distance: parseFloat(document.getElementById('esegdist-' + index).value),
        stopsAt: appData.segments[index].stopsAt || [],
        isBidirectional: document.getElementById('esegb-' + index).checked,
        isAlightOnly: document.getElementById('esega-' + index).checked
    };
    renderSegments();
}

function deleteSegment(index) {
    showInlineDeleteConfirm('segments-tbody', index, `performDeleteSegment(${index})`);
}

function filterSegments() {
    renderSegments();
}

// 直通運転
function renderThroughServices() {
    const tbody = document.getElementById('through-services-tbody');
    tbody.innerHTML = '';
    // Ensure every through-service has a configId (populate legacy/empty values)
    appData.throughServiceConfigs.forEach(c => {
        if (!c.configId || c.configId.toString().trim() === '') {
            c.configId = generateThroughServiceId(c.fromLineId, c.toLineId);
        }
    });
    // duplicate detection for configId
    const idCounts = {};
    appData.throughServiceConfigs.forEach(c => {
        const id = (c.configId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    // detect mirrored duplicates: entries where from/to lines are swapped and train-type pairs match in reverse
    const mirrored = new Set();
    for (let i = 0; i < appData.throughServiceConfigs.length; i++) {
        for (let j = i + 1; j < appData.throughServiceConfigs.length; j++) {
            const a = appData.throughServiceConfigs[i];
            const b = appData.throughServiceConfigs[j];
            if (!a || !b) continue;
            if (!a.fromLineId || !a.toLineId || !b.fromLineId || !b.toLineId) continue;
            // mirror condition: a.from === b.to && a.to === b.from
            // and train-type pairing matches in reverse: a.fromTrainType === b.toTrainType && a.toTrainType === b.fromTrainType
            if (a.fromLineId === b.toLineId && a.toLineId === b.fromLineId &&
                (a.fromTrainType || '') === (b.toTrainType || '') &&
                (a.toTrainType || '') === (b.fromTrainType || '')) {
                mirrored.add(i);
                mirrored.add(j);
            }
        }
    }

    appData.throughServiceConfigs.forEach((cfg, index) => {
        const directionText = cfg.isBidirectional ? '相互直通' : '一方向';
        const tr = document.createElement('tr');
        tr.dataset.index = index;
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
        const id = (cfg.configId || '').toString();
        if ((id && idCounts[id] > 1) || mirrored.has(index)) tr.style.backgroundColor = '#ff0000';
        tbody.appendChild(tr);
    });
    // Apply required highlights for through-services
    applyRequiredHighlightsToTbody(tbody);
}

function addThroughService() {
    const newCfg = {fromLineId: '', toLineId: '', fromTrainType: '', toTrainType: '', isBidirectional: true, description: ''};
    newCfg.configId = generateThroughServiceId(newCfg.fromLineId, newCfg.toLineId);
    appData.throughServiceConfigs.push(newCfg);
    renderThroughServices();
    editThroughServiceRow(appData.throughServiceConfigs.length - 1);
    scrollToSectionBottom('through-services');
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
        <td><input type="text" value="${esc(cfg.configId)}" id="etsi-${index}" style="width:100%; background:#e9e9e9;" readonly title="設定IDは自動生成されます"></td>
        <td><select id="etsf-${index}" onchange="updateThroughServiceIdPreview(${index})" required>${fromLineOpts}</select></td>
        <td><select id="etst-${index}" onchange="updateThroughServiceIdPreview(${index})" required>${toLineOpts}</select></td>
        <td><select id="etsft-${index}" required>${fromTypeOpts}</select></td>
        <td><select id="etstt-${index}" required>${toTypeOpts}</select></td>
        <td style="text-align: center;">
            <select id="etsb-${index}" required>
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
    // highlight if duplicate configId
    const id = (cfg.configId || '').toString();
    if (id) {
        const counts = {};
        appData.throughServiceConfigs.forEach(x => { const k = (x.configId||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        // also compute mirrored duplicates for edit-row highlighting
        let isMirrored = false;
        for (let i = 0; i < appData.throughServiceConfigs.length; i++) {
            if (i === index) continue;
            const a = appData.throughServiceConfigs[index];
            const b = appData.throughServiceConfigs[i];
            if (!a || !b) continue;
            if (!a.fromLineId || !a.toLineId || !b.fromLineId || !b.toLineId) continue;
            if (a.fromLineId === b.toLineId && a.toLineId === b.fromLineId &&
                (a.fromTrainType || '') === (b.toTrainType || '') &&
                (a.toTrainType || '') === (b.fromTrainType || '')) {
                isMirrored = true;
                break;
            }
        }
        tr.style.backgroundColor = (counts[id] > 1 || isMirrored) ? '#ff0000' : '';
    } else {
        tr.style.backgroundColor = '';
    }
}

function saveThroughService(index) {
    const fromLine = document.getElementById('etsf-' + index).value;
    const toLine = document.getElementById('etst-' + index).value;
    const computedId = generateThroughServiceId(fromLine, toLine);
    appData.throughServiceConfigs[index] = {
        configId: computedId,
        fromLineId: fromLine,
        toLineId: toLine,
        fromTrainType: document.getElementById('etsft-' + index).value,
        toTrainType: document.getElementById('etstt-' + index).value,
        isBidirectional: document.getElementById('etsb-' + index).value === 'true',
        description: document.getElementById('etsd-' + index).value
    };
    renderThroughServices();
}

function deleteThroughService(index) {
    showInlineDeleteConfirm('through-services-tbody', index, `performDeleteThroughService(${index})`);
}

// のりば乗換
function renderPlatformTransfers() {
    const tbody = document.getElementById('platform-transfers-tbody');
    tbody.innerHTML = '';
    // duplicate detection for transferId (or id)
    const idCounts = {};
    appData.platformTransfers.forEach(p => {
        const id = (p.transferId || p.id || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    appData.platformTransfers.forEach((pt, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
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
        const id = (pt.transferId || pt.id || '').toString();
        if (id && idCounts[id] > 1) tr.style.backgroundColor = '#ff0000';
        tbody.appendChild(tr);
    });
    // Apply required highlights for platform-transfers
    applyRequiredHighlightsToTbody(tbody);
}

function addPlatformTransfer() {
    appData.platformTransfers.push({transferId: '', stationId: '', fromPlatform: '', toPlatform: '', transferTime: 180});
    renderPlatformTransfers();
    editPlatformTransferRow(appData.platformTransfers.length - 1);
    scrollToSectionBottom('platform-transfers');
}

// Scroll the table container inside a section to its bottom so newly added rows are visible
function scrollToSectionBottom(sectionId) {
    try {
        const section = document.getElementById(sectionId);
        if (!section) return;
        const container = section.querySelector('.table-container');
        if (!container) return;
        // Jump to bottom without animation
        container.scrollTop = container.scrollHeight;
    } catch (e) {
        console.error('scrollToSectionBottom failed', e);
    }
}

function editPlatformTransferRow(index) {
    const pt = appData.platformTransfers[index];
    const tr = document.getElementById('platform-transfers-tbody').children[index];
    const t = parseInt(pt.transferTime) || 0;
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(pt.transferId)}" id="epti-${index}" required></td>
        <td><input type="text" value="${esc(pt.stationId)}" id="epts-${index}" oninput="_renderPlatformStationSuggestionsFor(${index})" onfocus="_renderPlatformStationSuggestionsFor(${index})" autocomplete="off" required></td>
        <td><input type="text" value="${esc(pt.fromPlatform)}" id="eptf-${index}" required></td>
        <td><input type="text" value="${esc(pt.toPlatform)}" id="eptt-${index}" required></td>
        <td>
            <input type="number" value="${t}" id="epttime-${index}" min="0" required> 秒
        </td>
        <td>
            <button class="save-btn" onclick="savePlatformTransfer(${index})">保存</button>
            <button class="cancel-btn" onclick="renderPlatformTransfers()">取消</button>
        </td>
    `;
    // highlight if duplicate transferId
    const id = (pt.transferId || pt.id || '').toString();
    if (id) {
        const counts = {};
        appData.platformTransfers.forEach(x => { const k = (x.transferId||x.id||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        tr.style.backgroundColor = counts[id] > 1 ? '#ff0000' : '';
    } else {
        tr.style.backgroundColor = '';
    }
}

function savePlatformTransfer(index) {
    appData.platformTransfers[index] = {
        transferId: document.getElementById('epti-' + index).value,
        stationId: document.getElementById('epts-' + index).value,
        fromPlatform: document.getElementById('eptf-' + index).value,
        toPlatform: document.getElementById('eptt-' + index).value,
        transferTime: parseInt(document.getElementById('epttime-' + index).value || 0)
    };
    renderPlatformTransfers();
}

function deletePlatformTransfer(index) {
    showInlineDeleteConfirm('platform-transfers-tbody', index, `performDeletePlatformTransfer(${index})`);
}

// エクスポート/インポート
async function exportData() {
    appData.meta.lastUpdated = new Date().toISOString().split('T')[0];
    
    // エクスポート用にデータをクリーンアップ
    const exportData = cleanDataForExport(appData);
    // サーバーへのアップロードは行いません。ローカル保存のため
    // ユーザー名を入力してもらうUIを一時表示します。
    const exportSectionBtn = document.querySelector('#export .export-btn');
    if (!exportSectionBtn) {
        // Fallback: immediately download with default name
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `new_data_local_${new Date().toISOString().replace(/[:.TZ-]/g,'')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        updateServerStatus(false);
        return;
    }

    // Hide the original save button and show username input + Complete/Cancel
    exportSectionBtn.style.display = 'none';

    // If UI already exists, don't create again
    if (document.getElementById('save-username-box')) return;

    const box = document.createElement('div');
    box.id = 'save-username-box';
    // reuse editor's input/button styling by placing input inside .search-box
    box.className = 'search-box';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'save-username-input';
    input.placeholder = 'ユーザー名を入力';
    input.style.marginRight = '8px';
    box.appendChild(input);

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = '完了';
    ok.className = 'save-btn';
    ok.style.marginRight = '6px';
    box.appendChild(ok);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'キャンセル';
    cancel.className = 'cancel-btn';
    box.appendChild(cancel);

    exportSectionBtn.parentNode.appendChild(box);

    const cleanup = () => {
        const b = document.getElementById('save-username-box');
        if (b && b.parentNode) b.parentNode.removeChild(b);
        exportSectionBtn.style.display = '';
    };

    cancel.addEventListener('click', () => {
        cleanup();
    });

    ok.addEventListener('click', () => {
        const raw = (document.getElementById('save-username-input')?.value || '').toString().trim();
        if (!raw) {
            alert('ユーザー名を入力してください');
            return;
        }
        // sanitize username: lowercase, keep a-z0-9 and underscore/dash
        const username = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const pad = (n) => n.toString().padStart(2, '0');
        const now = new Date();
        const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `new_data_${username}_${ts}.json`;

        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        alert(`ファイルを保存しました: ${filename}`);
        updateServerStatus(false);
        cleanup();
    });
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
            // オフライン（ローカル）モードで編集を開始します。
            // サーバーへ自動アップロードは行いません。
            alert('データを読み込みました。ローカル編集モードで開始します。');
            updateServerStatus(false);
            
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

// Inline delete confirmation: replaces the action cell with a small confirm UI
function showInlineDeleteConfirm(tbodyId, arrayIndex, confirmFuncName) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    let tr = null;
    for (let i = 0; i < tbody.children.length; i++) {
        const child = tbody.children[i];
        if (child.dataset && child.dataset.index === String(arrayIndex)) {
            tr = child;
            break;
        }
    }
    if (!tr) return;
    // Locate the last cell (action cell)
    const lastTd = tr.querySelector('td:last-child');
    if (!lastTd) return;
    // Save original content so we can restore
    tr.dataset._origAction = lastTd.innerHTML;
    tr.dataset._confirming = '1';
    // Hide any existing edit/delete buttons in the row (but not the ones we'll add)
    tr.querySelectorAll('button.edit-btn, button.delete-btn, button.save-btn, button.cancel-btn').forEach(b => {
        b.style.display = 'none';
    });
    // Insert inline confirmation UI
    lastTd.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#c00; font-weight:bold;">削除しますか？</span>
            <button class="save-btn" onclick="(function(){ try{ ${confirmFuncName}; }catch(e){ console.error(e); } })()">実行</button>
            <button class="cancel-btn" onclick="restoreDeleteCell('${tbodyId}', ${arrayIndex})">キャンセル</button>
        </div>
    `;
}

function restoreDeleteCell(tbodyId, arrayIndex) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    let tr = null;
    for (let i = 0; i < tbody.children.length; i++) {
        const child = tbody.children[i];
        if (child.dataset && child.dataset.index === String(arrayIndex)) {
            tr = child;
            break;
        }
    }
    if (!tr) return;
    const lastTd = tr.querySelector('td:last-child');
    if (!lastTd) return;
    if (tr.dataset._origAction) {
        lastTd.innerHTML = tr.dataset._origAction;
        delete tr.dataset._origAction;
    }
    delete tr.dataset._confirming;
    // restore buttons visibility
    tr.querySelectorAll('button.edit-btn, button.delete-btn, button.save-btn, button.cancel-btn').forEach(b => {
        b.style.display = '';
    });
}

// Concrete delete executors called by the inline confirm UI
function performDeleteCompany(index) { appData.companies.splice(index, 1); renderCompanies(); }
function performDeleteTrainType(index) { appData.trainTypes.splice(index, 1); renderTrainTypes(); }
function performDeleteLine(index) { appData.lines.splice(index, 1); renderLines(); }
function performDeleteStation(index) { appData.stations.splice(index, 1); renderStations(); }
function performDeleteSegment(index) { appData.segments.splice(index, 1); renderSegments(); }
function performDeleteThroughService(index) { appData.throughServiceConfigs.splice(index, 1); renderThroughServices(); }
function performDeletePlatformTransfer(index) { appData.platformTransfers.splice(index, 1); renderPlatformTransfers(); }