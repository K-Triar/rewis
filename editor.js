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
    platformTransfers: [],
    statusTemplates: [],
    noticeTypes: [],
    serviceStatusCauses: [],
    serviceStatusMeta: {
        schema_version: "1.0.0",
        generated_at: new Date().toISOString()
    },
    serviceStatuses: []
};
// Keep a snapshot of the last-saved JSON (cleaned for export) for change detection
let _lastSavedJson = null;
let _currentServiceStatusIndex = null;
const WORKER_AUTH_TOKEN_KEY = 'rewis_worker_token';
const WORKER_AUTH_EXPIRES_KEY = 'rewis_worker_token_expires_at';
const WORKER_AUTH_USER_KEY = 'rewis_worker_user_id';
let _workerAuthToken = null;
let _workerAuthExpiresAt = 0;
let _workerHistoryItems = [];
let _workerHistoryLoaded = false;
// beforeunload handler (use provided code behavior)
function _beforeUnloadHandler(event) {
    event.preventDefault();
    event.returnValue = '';
}

function computeCurrentExportJson() {
    try {
        const exportData = cleanDataForExport(appData);
        return JSON.stringify(exportData);
    } catch (e) { return null; }
}

function checkUnsavedChanges() {
    try {
        const cur = computeCurrentExportJson();
        const dirty = (cur !== _lastSavedJson);
        if (dirty) {
            // add listener if not already added
            window.addEventListener('beforeunload', _beforeUnloadHandler);
        } else {
            window.removeEventListener('beforeunload', _beforeUnloadHandler);
        }
        return dirty;
    } catch (e) { return false; }
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    initializeWorkerControls();
    tryLoadExistingData();
});
// Setup auto-preview after DOM ready
document.addEventListener('DOMContentLoaded', () => {
    setupServiceStatusAutoPreview();
});

function initializeNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const section = btn.dataset.section;
            // update URL query to be like `?companies` without reloading
            try {
                history.replaceState(null, '', '?' + section);
            } catch (err) {
                // fallback: manual assign (will reload)
                try { location.search = section; } catch (e) {}
            }
            switchSection(section);
        });
    });

    // On load: if URL has a simple query like `?companies`, switch to that section
    try {
        const q = (location.search || '').replace(/^\?/,'');
        if (q) {
            const btn = Array.from(navButtons).find(b => b.dataset.section === q);
            if (btn) {
                // mark active and display
                navButtons.forEach(b => b.classList.toggle('active', b === btn));
                switchSection(q);
            }
        }
    } catch (err) {}
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
                3: (it) => (typeof getCompanyNameById === 'function') ? (getCompanyNameById(it.companyId) || it.companyId || '') : (it.companyId || ''),
                4: (it) => it.lineColor || '',
                5: (it) => it.trainType || '',
                6: (it) => (it.serviceCategories && it.serviceCategories.length) ? it.serviceCategories.map(c => {
                    const id = Array.isArray(c) ? (c[0] || (c[1] || '')) : (c || '');
                    const label = Array.isArray(c) ? (c[1] || c[0]) : c;
                    return `${id},${label}`;
                }).join(',') : '',
                7: (it) => (it.stationOrder && Array.isArray(it.stationOrder)) ? it.stationOrder.map(s => (typeof s === 'string' ? s : (s.stationId || ''))).join(',') : ''
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
                8: (it) => it.trainType || it.guidance || '',
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
                4: (it) => it.fromTrainType || it.fromGuidance || '',
                5: (it) => it.toTrainType || it.toGuidance || '',
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
        },
        'service-statuses-table': {
            getData: () => appData.serviceStatuses,
            render: () => renderServiceStatuses(),
            accessors: {
                1: (it) => it.id || '',
                2: (it) => (it.generated_text && it.generated_text.heading) || '',
                3: (it) => (typeof getLineNameById === 'function') ? (getLineNameById(it.affected_line_id) || it.affected_line_id || '') : (it.affected_line_id || ''),
                4: (it) => getStatusLabel(it.status ? it.status.code : ''),
                5: (it) => it.published ? 1 : 0,
                6: (it) => it.updated_at || it.created_at || ''
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
        let loadedMode = 'local-server';
        if (!response.ok) {
            response = await fetch('data.json');
            loadedMode = 'static-file';
        }
        if (response.ok) {
                appData = await response.json();
                ensureServiceStatusConfig(appData);
            // データは既に秒単位で保存されているため、変換は不要
                try {
                    _lastSavedJson = JSON.stringify(cleanDataForExport(appData));
                } catch (e) { _lastSavedJson = JSON.stringify(appData); }
                checkUnsavedChanges();
            // Render the section indicated by the URL (e.g. ?companies) or the currently active nav button.
            const urlSection = (location.search || '').replace(/^\?/,'');
            const activeNav = document.querySelector('.nav-btn.active')?.dataset.section;
            const sectionToShow = urlSection || activeNav || 'companies';
            switchSection(sectionToShow);
            if (loadedMode === 'local-server') {
                updateServerStatus(true, 'local-server');
            } else {
                updateServerStatus(false, 'static-file');
            }
        }
    } catch (error) {
        console.log('data.jsonが見つかりません');
        updateServerStatus(false, 'offline');
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

function updateServerStatus(isOnline, mode = 'local-server') {
    const statusEl = document.getElementById('server-status');
    if (statusEl) {
        if (isOnline) {
            if (mode === 'worker') {
                statusEl.textContent = '保存先: Cloudflare Workers (オンライン)';
            } else {
                statusEl.textContent = 'サーバー接続: オンライン';
            }
            statusEl.style.color = '#080';
        } else {
            if (mode === 'static-file') {
                statusEl.textContent = '接続状態: 静的ファイル読込モード';
            } else {
                statusEl.textContent = 'サーバー接続: オフライン（ローカルモード）';
            }
            statusEl.style.color = '#c00';
        }
    }
}

function initializeWorkerControls() {
    const apiInput = document.getElementById('worker-api-base');
    if (!apiInput) return;

    const savedBase = localStorage.getItem('rewis_worker_api_base') || '';
    if (savedBase) apiInput.value = savedBase;

    const savedUser = sessionStorage.getItem(WORKER_AUTH_USER_KEY) || '';
    const userEl = document.getElementById('worker-user-id');
    if (userEl && savedUser) userEl.value = savedUser;

    const savedToken = sessionStorage.getItem(WORKER_AUTH_TOKEN_KEY) || null;
    const savedExpires = Number(sessionStorage.getItem(WORKER_AUTH_EXPIRES_KEY) || 0);
    if (savedToken && savedExpires > Date.now()) {
        _workerAuthToken = savedToken;
        _workerAuthExpiresAt = savedExpires;
        setWorkerAuthStatus('認証済み（保存可能）', true);
    } else {
        clearWorkerAuthSession(false);
    }

    apiInput.addEventListener('change', () => {
        const normalized = normalizeWorkerBaseUrl(apiInput.value);
        apiInput.value = normalized;
        if (normalized) {
            localStorage.setItem('rewis_worker_api_base', normalized);
        } else {
            localStorage.removeItem('rewis_worker_api_base');
        }
    });
}

function normalizeWorkerBaseUrl(value) {
    return String(value || '').trim().replace(/\/$/, '');
}

function getWorkerBaseUrl() {
    const el = document.getElementById('worker-api-base');
    const base = normalizeWorkerBaseUrl(el ? el.value : '');
    return base;
}

function setWorkerAuthStatus(message, success) {
    const el = document.getElementById('worker-auth-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = success ? '#080' : '#444';
}

function clearWorkerAuthSession(showMessage = true) {
    _workerAuthToken = null;
    _workerAuthExpiresAt = 0;
    sessionStorage.removeItem(WORKER_AUTH_TOKEN_KEY);
    sessionStorage.removeItem(WORKER_AUTH_EXPIRES_KEY);
    sessionStorage.removeItem(WORKER_AUTH_USER_KEY);
    if (showMessage) setWorkerAuthStatus('未認証', false);
}

function isWorkerAuthValid() {
    return !!_workerAuthToken && _workerAuthExpiresAt > Date.now();
}

async function authenticateWorkerUser(forceStatusAlert = false) {
    const base = getWorkerBaseUrl();
    if (!base) {
        const msg = 'Workers API URL を先に設定してください。';
        setWorkerAuthStatus(msg, false);
        if (forceStatusAlert) alert(msg);
        return false;
    }

    const userEl = document.getElementById('worker-user-id');
    const passEl = document.getElementById('worker-password');
    const userId = (userEl ? userEl.value : '').trim();
    const password = passEl ? passEl.value : '';

    if (!userId || !password) {
        const msg = 'ユーザーIDとパスワードを入力してください。';
        setWorkerAuthStatus(msg, false);
        if (forceStatusAlert) alert(msg);
        return false;
    }

    try {
        const response = await fetch(base + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, password })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.token) {
            throw new Error(result.error || '認証に失敗しました');
        }

        const expiresAt = Number(result.expiresAt || (Date.now() + 15 * 60 * 1000));
        _workerAuthToken = result.token;
        _workerAuthExpiresAt = expiresAt;
        sessionStorage.setItem(WORKER_AUTH_TOKEN_KEY, _workerAuthToken);
        sessionStorage.setItem(WORKER_AUTH_EXPIRES_KEY, String(_workerAuthExpiresAt));
        sessionStorage.setItem(WORKER_AUTH_USER_KEY, userId);
        if (passEl) passEl.value = '';
        setWorkerAuthStatus('認証済み（保存可能）', true);
        if (forceStatusAlert) alert('認証に成功しました。');
        return true;
    } catch (error) {
        clearWorkerAuthSession(false);
        setWorkerAuthStatus('認証失敗: ' + error.message, false);
        if (forceStatusAlert) alert('認証に失敗しました: ' + error.message);
        return false;
    }
}

async function saveToWorkerSource(exportData) {
    const base = getWorkerBaseUrl();
    if (!base) {
        return { attempted: false, saved: false };
    }

    if (!isWorkerAuthValid()) {
        const ok = await authenticateWorkerUser(false);
        if (!ok) {
            return { attempted: true, saved: false, blockedByAuth: true };
        }
    }

    const doSave = async () => {
        return fetch(base + '/data/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + _workerAuthToken
            },
            body: JSON.stringify({
                data: exportData,
                client: 'rewis-editor',
                savedAt: new Date().toISOString()
            })
        });
    };

    try {
        let response = await doSave();
        if (response.status === 401) {
            clearWorkerAuthSession(false);
            const relogin = await authenticateWorkerUser(false);
            if (!relogin) {
                return { attempted: true, saved: false, blockedByAuth: true };
            }
            response = await doSave();
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || '保存に失敗しました');
        }

        return { attempted: true, saved: true };
    } catch (error) {
        return { attempted: true, saved: false, error: error.message };
    }
}

async function loadFromWorkerSource() {
    const base = getWorkerBaseUrl();
    if (!base) {
        alert('Workers API URL を設定してください。');
        return;
    }

    try {
        const response = await fetch(base + '/data/latest');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        if (!payload || !payload.data) {
            throw new Error('データ形式が不正です');
        }

        appData = payload.data;
        ensureServiceStatusConfig(appData);
        try {
            _lastSavedJson = JSON.stringify(cleanDataForExport(appData));
        } catch (e) { _lastSavedJson = JSON.stringify(appData); }
        checkUnsavedChanges();

        renderSection('companies');
        switchSection('companies');
        updateServerStatus(true, 'worker');
        alert('外部正本から読み込みました。');
    } catch (error) {
        alert('外部正本からの読込に失敗しました: ' + error.message);
    }
}

function setWorkerHistoryStatus(message, success) {
    const el = document.getElementById('worker-history-status');
    if (!el) return;
    el.textContent = message;
    el.style.color = success ? '#080' : '#444';
}

function formatHistoryDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function renderWorkerHistorySection() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!_workerHistoryItems || _workerHistoryItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#666;">履歴はありません</td></tr>';
        return;
    }

    _workerHistoryItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="row-number">${index + 1}</td>
            <td>${esc(formatHistoryDateTime(item.savedAt || item.updatedAt || ''))}</td>
            <td>${esc(item.updatedBy || '')}</td>
            <td>${esc(item.client || '')}</td>
            <td>${esc(item.key || '')}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadWorkerHistory(showAlertOnError = false) {
    const base = getWorkerBaseUrl();
    if (!base) {
        _workerHistoryItems = [];
        _workerHistoryLoaded = false;
        renderWorkerHistorySection();
        setWorkerHistoryStatus('Workers API URL を設定してください。', false);
        if (showAlertOnError) alert('Workers API URL を設定してください。');
        return;
    }

    setWorkerHistoryStatus('履歴を取得中...', false);

    const doFetch = async () => {
        const headers = {};
        if (isWorkerAuthValid()) {
            headers.Authorization = 'Bearer ' + _workerAuthToken;
        }
        return fetch(base + '/data/history?limit=50', {
            method: 'GET',
            headers
        });
    };

    try {
        let response = await doFetch();

        if (response.status === 401) {
            clearWorkerAuthSession(false);
            const authOk = await authenticateWorkerUser(false);
            if (!authOk) {
                _workerHistoryItems = [];
                _workerHistoryLoaded = false;
                renderWorkerHistorySection();
                setWorkerHistoryStatus('認証が必要です。認証テストを実行してください。', false);
                if (showAlertOnError) alert('履歴取得には認証が必要です。');
                return;
            }
            response = await doFetch();
        }

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        const payload = await response.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        _workerHistoryItems = items;
        _workerHistoryLoaded = true;
        renderWorkerHistorySection();
        setWorkerHistoryStatus(`履歴 ${items.length} 件を表示中`, true);
    } catch (error) {
        _workerHistoryItems = [];
        _workerHistoryLoaded = false;
        renderWorkerHistorySection();
        setWorkerHistoryStatus('履歴取得に失敗: ' + error.message, false);
        if (showAlertOnError) alert('履歴取得に失敗しました: ' + error.message);
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
        case 'service-statuses': renderServiceStatuses(); break;
        case 'history':
            renderWorkerHistorySection();
            if (!_workerHistoryLoaded) {
                loadWorkerHistory(false);
            }
            break;
        case 'help': break; // 使い方セクションは静的HTMLなので処理不要
    }
    // 各テーブルのヘッダにソートボタンを有効化（表示のみのクライアントソート）
    enableTableSorting();
    // required 属性を持つ列のハイライトを実行
    applyRequiredHighlightsToAllTables();
}

function ensureServiceStatusConfig(data) {
    if (!data) return;
    if (!Array.isArray(data.statusTemplates) || data.statusTemplates.length === 0) {
        data.statusTemplates = getDefaultStatusTemplates();
    }
    data.statusTemplates.forEach(tpl => {
        if (tpl && !tpl.status_id) {
            tpl.status_id = tpl.code;
        }
    });
    if (!Array.isArray(data.noticeTypes) || data.noticeTypes.length === 0) {
        data.noticeTypes = getDefaultNoticeTypes();
    }
    if (!Array.isArray(data.serviceStatusCauses) || data.serviceStatusCauses.length === 0) {
        data.serviceStatusCauses = getDefaultServiceStatusCauses();
    }
    if (!data.serviceStatusMeta) {
        data.serviceStatusMeta = { schema_version: '1.0.0', generated_at: new Date().toISOString() };
    }
    if (!Array.isArray(data.serviceStatuses)) {
        data.serviceStatuses = [];
    }
    data.serviceStatuses.forEach((status) => {
        if (!status) return;
        status.notice_types = Array.isArray(status.notice_types) ? status.notice_types : [];
        status.notice_types_all = !!status.notice_types_all;
        status.status = status.status || { code: '', status_id: '', heading: '', body: '' };
        if (!status.status.status_id) {
            status.status.status_id = status.status.code || '';
        }
        status.occurrence = status.occurrence || { year: null, month: null, day: null, hour: null, minute: null, timezone: 'Asia/Tokyo' };
        if (!status.occurrence.timezone) status.occurrence.timezone = 'Asia/Tokyo';
        status.affected_line_id = status.affected_line_id || '';
        status.affected_segment = status.affected_segment || { is_full_line: true, start_station_id: null, end_station_id: null };
        status.direction = status.direction || { up: true, down: true };
        status.cause = status.cause || { code: '', heading: null, body: null, cause_line_option: 'affected', cause_line_id: null, cause_segment: { start_station_id: null, end_station_id: null } };
        if (!status.cause.cause_segment) status.cause.cause_segment = { start_station_id: null, end_station_id: null };
        status.turnback = status.turnback || { start: false, end: false };
        status.through_services = Array.isArray(status.through_services) ? status.through_services : [];
        status.preview = status.preview || { editable: false, custom_text: null };
        status.generated_text = status.generated_text || { heading: '', body: '' };
        status.published_text = status.published_text || '';
        status.history = Array.isArray(status.history) ? status.history : [];
        if (!status.id) status.id = generateUuid();
        if (!status.version) status.version = 1;
        status.created_at = status.created_at || new Date().toISOString();
        status.updated_at = status.updated_at || status.created_at;
    });
}

function getDefaultStatusTemplates() {
    return [
        { code: 'OfS_SUSPEND', status_id: 'OfS', label: '運転見合わせ', heading: '運転見合わせ', body: '運転を見合わせています', description: '運転見合わせ：{影響駅間}で運転を見合わせています' },
        { code: 'OfS_CANCEL', status_id: 'OfS', label: '運休', heading: '運休', body: '運休となっています', description: '運休：{影響駅間}で運休となっています' },
        { code: 'Aff_UNLISTED', status_id: 'Aff', label: '乗換案内非対応', heading: '乗換案内非対応', body: '通常通り運転を行っていますが、本システムの乗換案内に表示されません', description: '乗換案内非対応：{影響駅間}で通常通り運転を行っていますが、本システムの乗換案内に表示されません' },
        { code: 'Aff_SKIP', status_id: 'Aff', label: '一部駅通過', heading: '一部駅通過', body: '各駅を通過します', description: '一部駅通過：{影響駅間}の各駅を通過します' },
        { code: 'DSS_STOP', status_id: 'DSS', label: '直通運転中止', heading: '直通運転中止', body: '直通運転を中止しています', description: '直通運転中止：{直通先路線}{対象}の直通運転を中止しています' }
    ];
}

function getDefaultNoticeTypes() {
    return [
        { code: 'Lo', label: '普通' },
        { code: 'Lo-KB', label: '普通(直通)' },
        { code: 'Lo-KL', label: '各駅停車(直通)' },
        { code: 'Ra', label: '快速' },
        { code: 'Ra-HA', label: '直通快速' },
        { code: 'SR-LSR', label: '新快速' },
        { code: 'EX-AML', label: '特急アクアマリンライナー' },
        { code: 'EX-MKR', label: '特急みかり' }
    ];
}

function getDefaultServiceStatusCauses() {
    return [
        { code: 'signal_check', label: '信号の確認', heading: '信号の確認', body: '信号の確認をしているため', default_line_option: 'affected' },
        { code: 'vehicle_check', label: '車両の確認', heading: '車両の確認', body: '車両を確認したため', default_line_option: 'affected' },
        { code: 'track_check', label: '線路の確認', heading: '線路の確認', body: '線路を確認しているため', default_line_option: 'affected' },
        { code: 'vehicle_track_check', label: '車両・線路確認', heading: '車両・線路確認', body: '車両と線路を確認しているため', default_line_option: 'affected' },
        { code: 'station_facility_check', label: '駅設備の確認', heading: '駅設備の確認', body: '駅の設備を確認しているため', default_line_option: 'affected' },
        { code: 'station_facility_track_check', label: '駅設備・線路確認', heading: '駅設備・線路確認', body: '駅の設備と線路を確認しているため', default_line_option: 'affected' },
        { code: 'person_intrusion', label: '線路内人立入', heading: '線路内人立入', body: '線路内に人が立ち入ったため', default_line_option: 'affected' },
        { code: 'animal_intrusion', label: '線路内動物等立入', heading: '線路内動物等立入', body: '線路内に動物等が立ち入ったため', default_line_option: 'affected' },
        { code: 'animal_contact', label: '動物等と接触', heading: '動物等と接触', body: '列車が動物等と接触し、車両と線路を確認しているため', default_line_option: 'affected' },
        { code: 'track_intensive_work', label: '線路の集中工事', heading: '線路の集中工事', body: '線路の集中工事を実施しているため', default_line_option: 'line' },
        { code: 'maintenance_work', label: '保守工事', heading: '保守工事', body: '保守工事を実施しているため', default_line_option: 'line' },
        { code: 'station_facility_work', label: '駅設備の工事', heading: '駅設備の工事', body: '駅設備の工事を実施しているため', default_line_option: 'line' },
        { code: 'track_switch_work', label: '線路切替工事', heading: '線路切替工事', body: '線路切替工事を実施しているため', default_line_option: 'line' },
        { code: 'other', label: 'その他', heading: null, body: null, default_line_option: 'hidden' }
    ];
}

function getStatusTemplateByCode(code) {
    if (!code) return null;
    return (appData.statusTemplates || []).find(t => t.code === code) || null;
}

function getNoticeTypeOptionsForLine(lineId) {
    if (!lineId) return [];
    const line = (appData.lines || []).find(l => l.lineId === lineId);
    if (line && Array.isArray(line.serviceCategories) && line.serviceCategories.length) {
        return line.serviceCategories.map(cat => {
            if (Array.isArray(cat)) {
                return { code: cat[0], label: cat[1] };
            }
            if (cat && typeof cat === 'object') {
                return { code: cat.id || cat.code, label: cat.label || cat.name || cat.code };
            }
            return null;
        }).filter(Boolean);
    }
    return (appData.noticeTypes || []);
}

function getNoticeLabelByCode(code, lineId) {
    if (!code) return '';
    const inlineOptions = getNoticeTypeOptionsForLine(lineId);
    const hit = inlineOptions.find(opt => opt.code === code);
    if (hit) return hit.label || hit.code;
    const fallback = (appData.noticeTypes || []).find(opt => opt.code === code);
    return fallback ? (fallback.label || fallback.code) : code;
}

// --- Required highlighting / validation ---
// Validate a single table row: mark required-but-empty cells red (#ff0000).
// Centralized per-table required column map. Keys are table element IDs.
// Each array's boolean values correspond to column indices (0-based) in the rendered table row.
// True = required, False = optional. Fill unspecified tables conservatively (true where appropriate).
const REQUIRED_COLUMNS_BY_TABLE = {
    'companies-table': [ false, true, true, false, false ],
    'train-types-table': [ false, true, true, true, true, true, false ],
    'lines-table': [ false, true, true, true, true, false, false, false, false ],
    'stations-table': [ false, true, true, true, true, true, false ],
    'segments-table': [ false, true, true, true, true, true, true, true, true, true, true, false, false, false ],
    'through-services-table': [ false, true, true, true, true, true, false, false, false ],
    'platform-transfers-table': [ false, true, true, true, true, true, false ],
    'service-statuses-table': [ false, false, false, false, false, false, false, false ]
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
    const requiredNow = (mapped === undefined ? el.required : mapped);
    if (requiredNow && val === '') {
        // For the segments editor, platform (始点/終点のりば) empty should be orange instead of red.
        // Platform columns in the segments table are at column indices 5 and 7.
        if (tableId === 'segments-table' && (colIndex === 5 || colIndex === 7)) {
            td.style.backgroundColor = '#ff8c00';
        } else {
            td.style.backgroundColor = '#ff0000';
        }
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
            if (requiredNow && val === '') {
                // segments table: platform columns (indices 5 and 7) use orange for empty
                if (tableId === 'segments-table' && (i === 5 || i === 7)) {
                    td.style.backgroundColor = '#ff8c00';
                } else {
                    td.style.backgroundColor = '#ff0000';
                }
            } else {
                td.style.backgroundColor = '';
            }
        } else {
            // display mode cell: inspect text content only if mapped as required
            const txt = (td.textContent || '').toString().trim();
            if (mappedRequired === true && txt === '') {
                if (tableId === 'segments-table' && (i === 5 || i === 7)) td.style.backgroundColor = '#ff8c00'; else td.style.backgroundColor = '#ff0000';
            } else td.style.backgroundColor = '';
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

// Check for any invalid (red) highlights across the editor tables.
function hasInvalidHighlights() {
    const tds = document.querySelectorAll('td');
    const re = /^rgba?\(\s*255\s*,\s*0\s*,\s*0/; // matches rgb(255, 0, 0) and rgba(255, 0, 0, 1)
    for (const td of tds) {
        try {
            const bg = window.getComputedStyle(td).backgroundColor || '';
            if (re.test(bg)) return true;
        } catch (e) { /* ignore */ }
    }
    return false;
}

function updateSaveWarningVisibility() {
    const warnEl = document.getElementById('save-warning');
    if (!warnEl) return;
    try {
        const invalid = hasInvalidHighlights();
        warnEl.style.display = invalid ? 'inline' : 'none';
    } catch (e) { warnEl.style.display = 'none'; }
}

// Keep the save warning state in sync when inputs change
document.addEventListener('input', (e) => {
    try { updateSaveWarningVisibility(); checkUnsavedChanges(); } catch (err) {}
});
document.addEventListener('change', (e) => {
    try { updateSaveWarningVisibility(); checkUnsavedChanges(); } catch (err) {}
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
function getLineTrainTypeOptions() {
    const fixedDefaults = ['TC', 'SX', 'MC'];
    const fromMaster = (appData.trainTypes || []).map(t => String(t.trainTypeId || '').trim()).filter(Boolean);
    const uniq = [];
    [...fixedDefaults, ...fromMaster].forEach(id => {
        if (!uniq.includes(id)) uniq.push(id);
    });
    return uniq;
}

function getTrainTypeLabel(trainTypeId) {
    const id = String(trainTypeId || '').trim();
    if (!id) return '';
    const t = (appData.trainTypes || []).find(x => String(x.trainTypeId || '').trim() === id);
    if (!t) return id;
    return t.trainTypeNameShort || t.trainTypeName || t.trainTypeId || id;
}

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
            <td>${esc(getCompanyNameById(line.companyId) || line.companyId)}</td>
            <td><input type="color" value="${line.lineColor}" disabled style="width: 100%;"></td>
            <td>${esc(getTrainTypeLabel(line.trainType || ''))}</td>
            <td>${(line.serviceCategories && line.serviceCategories.length) ? line.serviceCategories.map(c => {
                const id = Array.isArray(c) ? (c[0] || (c[1] || '')) : (c || '');
                const label = Array.isArray(c) ? (c[1] || c[0]) : c;
                const text = `${id} ${label}`;
                return `<span style="display:inline-block; padding:2px 2px; margin:2px; background:#f5f5f5; border:1px solid #ddd; border-radius:0px; font-size:11px;">${esc(text)}</span>`;
            }).join('') : ''}</td>
            <td>${(line.stationOrder && Array.isArray(line.stationOrder)) ? (line.stationOrder.length + '駅' + (line.stationOrder.length>0 ? ' (' + line.stationOrder.slice(0,6).map(s => (typeof s === 'string' ? esc(s) : esc(s.stationId || ''))).join(', ') + (line.stationOrder.length>6? ', ...' : '') + ')' : '')) : ''}</td>
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
    appData.lines.push({lineId: '', lineName: '', companyId: '', lineColor: color, trainType: 'TC', throughServices: []});
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
    const trainTypeOptions = getLineTrainTypeOptions();
    const selectedTrainType = (l.trainType || '').trim() || 'TC';
    if (selectedTrainType && !trainTypeOptions.includes(selectedTrainType)) {
        trainTypeOptions.push(selectedTrainType);
    }
    const trainTypeOpts = trainTypeOptions.map(id => {
        const label = getTrainTypeLabel(id);
        return `<option value="${esc(id)}" ${id === selectedTrainType ? 'selected' : ''}>${esc(id)}${label && label !== id ? ' (' + esc(label) + ')' : ''}</option>`;
    }).join('');
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(l.lineId)}" id="eli-${index}" required></td>
        <td><input type="text" value="${esc(l.lineName)}" id="eln-${index}" required></td>
        <td><select id="elc-${index}" required>${opts}</select></td>
        <td><input type="color" value="${l.lineColor}" id="elco-${index}" required></td>
        <td><select id="elt-${index}" required>${trainTypeOpts}</select></td>
            <td>
            <div id="el-sc-${index}" style="min-height:28px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:4px; border:1px solid #ddd; background:#fafafa;">
            </div>
            <div style="display:flex; gap:6px; margin-top:6px;">
                <input type="text" id="el-sc-id-${index}" placeholder="ID" style="min-width:30px;max-width:60px;" />
                <input type="text" id="el-sc-name-${index}" placeholder="種別名" style="flex:1;min-width:50px;" />
                <button class="add-btn" type="button" id="el-sc-add-${index}">追加</button>
            </div>
        </td>
        <td>
            <div id="el-so-${index}" style="padding:4px;">
                <button class="add-btn" type="button" onclick="addStationOrderRow(${index})">+ 行追加</button>
                <div style="max-height:220px; overflow:auto; margin-top:6px;">
                    <table class="data-table" id="el-so-table-${index}" style="width:100%;">
                        <thead>
                            <tr><th style="width:24px;"></th><th style="width:36px;">#</th><th>駅ID</th><th>駅名</th><th style="width:120px;">操作</th></tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        </td>
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
    // Initialize serviceCategories editor and stationOrder editor
    if (!appData.lines[index].serviceCategories) appData.lines[index].serviceCategories = [];
    renderServiceCategoriesEditor(index);
    renderStationOrderEditor(index);
    // attach handler: Add button for ID + 種別名
    const addBtn = document.getElementById(`el-sc-add-${index}`);
    const idInput = document.getElementById(`el-sc-id-${index}`);
    const nameInput = document.getElementById(`el-sc-name-${index}`);
    if (addBtn && idInput && nameInput) {
        addBtn.addEventListener('click', () => {
            const idv = idInput.value && idInput.value.trim();
            const namev = nameInput.value && nameInput.value.trim();
            if (!idv || !namev) return;
            addServiceCategoryToLine(index, idv, namev);
            idInput.value = '';
            nameInput.value = '';
            idInput.focus();
        });
        // Enter on name input triggers add
        nameInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                addBtn.click();
            }
        });
    }
}

function saveLine(index) {
    // preserve serviceCategories and stationOrder edited via the inline editors
    const prev = appData.lines[index] || {};
    appData.lines[index] = {
        lineId: document.getElementById('eli-' + index).value,
        lineName: document.getElementById('eln-' + index).value,
        companyId: document.getElementById('elc-' + index).value,
        lineColor: document.getElementById('elco-' + index).value,
        trainType: document.getElementById('elt-' + index).value,
        throughServices: prev.throughServices || [],
        serviceCategories: prev.serviceCategories || [],
        stationOrder: prev.stationOrder || []
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
            const guidancePart = s.guidanceId || s.trainType || s.guidance || '';
            s.segmentId = generateSegmentId(s.lineId, guidancePart, s.fromStationId, s.toStationId);
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
            <td>${esc(getLineNameById(seg.lineId) || seg.lineId)}</td>
            <td>${esc(getCompanyNameById(seg.companyId) || seg.companyId)}</td>
            <td>${esc(getStationNameById(seg.fromStationId) || seg.fromStationId)}</td>
            <td>${esc(seg.platforms && seg.platforms[seg.fromStationId] ? esc(seg.platforms[seg.fromStationId]) : '')}</td>
            <td>${esc(getStationNameById(seg.toStationId) || seg.toStationId)}</td>
            <td>${esc(seg.platforms && seg.platforms[seg.toStationId] ? esc(seg.platforms[seg.toStationId]) : '')}</td>
            <td>${esc(seg.trainType || seg.guidance || '')}</td>
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
    seg.segmentId = generateSegmentId(seg.lineId, '', seg.fromStationId, seg.toStationId);
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
    // route select: include a default empty option meaning `--`
    const lineOpts = ['<option value="">--</option>'].concat(appData.lines.map(l => `<option value="${esc(l.lineId)}" ${l.lineId === seg.lineId ? 'selected' : ''}>${esc(l.lineName)}</option>`)).join('');
    const typeOpts = appData.trainTypes.map(t => `<option value="${esc(t.trainTypeId)}" ${t.trainTypeId === seg.trainType ? 'selected' : ''}>${esc(t.trainTypeName)}</option>`).join('');
    // build station options for the selected line (use stationOrder if present, otherwise fall back to all stations sorted by name)
    const selectedLineForOpts = appData.lines.find(l => l.lineId === seg.lineId) || null;
    let stationListForLine = [];
    if (selectedLineForOpts && Array.isArray(selectedLineForOpts.stationOrder) && selectedLineForOpts.stationOrder.length) {
        stationListForLine = selectedLineForOpts.stationOrder.map(id => ({stationId: id, stationName: getStationNameById(id)}));
    } else {
        // fallback: include all stations sorted by stationName
        stationListForLine = appData.stations.map(s => ({stationId: s.stationId, stationName: s.stationName || ''})).sort((a,b)=> (a.stationName||'').localeCompare(b.stationName||''));
    }
    const stationOptsFrom = ['<option value="">--</option>'].concat(stationListForLine.map(s => `<option value="${esc(s.stationId)}" ${s.stationId === seg.fromStationId ? 'selected' : ''}>${esc(s.stationId)} ${esc(s.stationName||'')}</option>`)).join('');
    const stationOptsTo = ['<option value="">--</option>'].concat(stationListForLine.map(s => `<option value="${esc(s.stationId)}" ${s.stationId === seg.toStationId ? 'selected' : ''}>${esc(s.stationId)} ${esc(s.stationName||'')}</option>`)).join('');
    // build guidance options from the selected line's serviceCategories (show id・label in option text)
    // Include guidance ID in `data-gid` for option entries when available so we can use the ID for generated segment IDs
    let guidanceOpts = '<option value="">--</option>';
    if (selectedLineForOpts && Array.isArray(selectedLineForOpts.serviceCategories)) {
        guidanceOpts += selectedLineForOpts.serviceCategories.map(c => {
            if (Array.isArray(c)) {
                const id = c[0] || '';
                const label = c[1] || c[0] || '';
                return `<option value="${esc(label)}" data-gid="${esc(id)}" ${label === (seg.guidance||'') ? 'selected' : ''}>${esc(id)}・${esc(label)}</option>`;
            } else {
                const label = c || '';
                return `<option value="${esc(label)}">${esc(label)}</option>`;
            }
        }).join('');
    }
    // 駅候補リストはブラウザの datalist を使わずカスタム候補UIを使用するため削除
    
    const tr = document.getElementById('segments-tbody').children[rowIdx];
    // 秒単位の入力
    const dur = parseInt(seg.duration) || 0;
    tr.innerHTML = `
        <td class="row-number">${rowIdx + 1}</td>
        <td><input type="text" value="${esc(seg.segmentId)}" id="esegi-${index}" style="width: 100%; background:#e9e9e9;" readonly title="区間IDは自動生成されます" required></td>
        <td><select id="esegl-${index}" onchange="updateSegmentCompany(${index}); updateSegmentDependentFields(${index}); updateSegmentIdPreview(${index})" required>${lineOpts}</select></td>
        <td>
            <input type="hidden" value="${esc(seg.companyId)}" id="esegc-${index}">
            <div id="esegc-name-${index}" style="background: #e0e0e0; padding:4px;">${esc(getCompanyNameById(seg.companyId) || seg.companyId)}</div>
        </td>
        <td>
            <select id="esegfsel-${index}" onchange="onSegmentStationChange(${index}, 'from'); updateSegmentIdPreview(${index})" ${!seg.lineId ? 'disabled' : ''} required>
                ${stationOptsFrom}
            </select>
        </td>
        <td>
            <input type="text" value="${esc(seg.platforms && seg.platforms[seg.fromStationId] ? esc(seg.platforms[seg.fromStationId]) : '')}" id="esegfplat-${index}" placeholder="番線ID" required>
        </td>
        <td>
            <select id="esegtsel-${index}" onchange="onSegmentStationChange(${index}, 'to'); updateSegmentIdPreview(${index})" ${!seg.lineId ? 'disabled' : ''} required>
                ${stationOptsTo}
            </select>
        </td>
        <td>
            <input type="text" value="${esc(seg.platforms && seg.platforms[seg.toStationId] ? esc(seg.platforms[seg.toStationId]) : '')}" id="esegtplat-${index}" placeholder="番線ID" required>
        </td>
        <td>
            <select id="eseg_guidance-${index}" onchange="updateSegmentIdPreview(${index})" ${!seg.lineId ? 'disabled' : ''}>
                ${guidanceOpts}
            </select>
        </td>
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
    // ensure guidance/selects reflect current line selection when route changes
    // (listeners for select onchange already call updateSegmentCompany/updateSegmentIdPreview)
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
        const cEl = document.getElementById('esegc-' + index);
        if (cEl) cEl.value = line.companyId;
        const nameEl = document.getElementById('esegc-name-' + index);
        if (nameEl) nameEl.textContent = getCompanyNameById(line.companyId) || line.companyId;
    } else {
        // clear company if no line selected
        const cEl = document.getElementById('esegc-' + index);
        if (cEl) cEl.value = '';
        const nameEl = document.getElementById('esegc-name-' + index);
        if (nameEl) nameEl.textContent = '';
    }
}


// Update station selects and guidance select when the selected line changes
function updateSegmentDependentFields(index) {
    const lineSel = document.getElementById('esegl-' + index);
    if (!lineSel) return;
    const lineId = lineSel.value;
    const line = appData.lines.find(l => l.lineId === lineId) || null;
    // build station options (use stationOrder if present)
    let stationList = [];
    if (line && Array.isArray(line.stationOrder) && line.stationOrder.length) {
        stationList = line.stationOrder.map(id => ({stationId: id, stationName: getStationNameById(id)}));
    } else {
        stationList = appData.stations.map(s => ({stationId: s.stationId, stationName: s.stationName || ''})).sort((a,b)=> (a.stationName||'').localeCompare(b.stationName||''));
    }
    const fromSel = document.getElementById('esegfsel-' + index);
    const toSel = document.getElementById('esegtsel-' + index);
    const prevFrom = fromSel ? fromSel.value : '';
    const prevTo = toSel ? toSel.value : '';
    const opts = ['<option value="">--</option>'].concat(stationList.map(s => `<option value="${esc(s.stationId)}">${esc(s.stationId)} ${esc(s.stationName||'')}</option>`)).join('');
    if (fromSel) {
        fromSel.innerHTML = opts;
        if (prevFrom && stationList.some(s=>s.stationId===prevFrom)) fromSel.value = prevFrom; else fromSel.value = '';
        fromSel.disabled = !line;
    }
    if (toSel) {
        toSel.innerHTML = opts;
        if (prevTo && stationList.some(s=>s.stationId===prevTo)) toSel.value = prevTo; else toSel.value = '';
        toSel.disabled = !line;
    }

    // build guidance options from selected line
    const guidanceSel = document.getElementById('eseg_guidance-' + index);
    const prevGuid = guidanceSel ? guidanceSel.value : '';
    let guidanceHtml = '<option value="">--</option>';
    if (line && Array.isArray(line.serviceCategories)) {
        guidanceHtml += line.serviceCategories.map(c => {
            if (Array.isArray(c)) {
                const id = c[0] || '';
                const label = c[1] || c[0] || '';
                return `<option value="${esc(label)}" data-gid="${esc(id)}">${esc(id)}・${esc(label)}</option>`;
            } else {
                const label = c || '';
                return `<option value="${esc(label)}">${esc(label)}</option>`;
            }
        }).join('');
    }
    if (guidanceSel) {
        guidanceSel.innerHTML = guidanceHtml;
        if (prevGuid && Array.isArray(line && line.serviceCategories ? line.serviceCategories : []) && (line.serviceCategories||[]).some(c=> (Array.isArray(c)? (c[1]||c[0]) : c) === prevGuid)) {
            guidanceSel.value = prevGuid;
        } else {
            guidanceSel.value = '';
        }
        guidanceSel.disabled = !line;
    }
}

// Called when user changes the from/to station while editing a segment
function onSegmentStationChange(index, which) {
    // which = 'from' or 'to'
    // prefer the new select-based IDs; fall back to old input IDs if present
    const stationInput = document.getElementById(which === 'from' ? ('esegfsel-' + index) : ('esegtsel-' + index)) || document.getElementById(which === 'from' ? ('esegf-' + index) : ('esegt-' + index));
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

// Generate segment ID in the format: SGM-{路線ID}-{案内種別ID}-{始点駅ID}-{終点駅ID}
function generateSegmentId(lineId, guidanceId, fromStationId, toStationId) {
    const safe = (s) => (s || '').toString().trim();
    // remove spaces inside ids to keep IDs compact
    const clean = (s) => safe(s).replace(/\s+/g, '');
    return `SGM-${clean(lineId)}-${clean(guidanceId)}-${clean(fromStationId)}-${clean(toStationId)}`;
}

// Update the readonly segment-id preview while editing
function updateSegmentIdPreview(index) {
    const idEl = document.getElementById('esegi-' + index);
    const lineEl = document.getElementById('esegl-' + index);
    const fromEl = document.getElementById('esegfsel-' + index) || document.getElementById('esegf-' + index);
    const toEl = document.getElementById('esegtsel-' + index) || document.getElementById('esegt-' + index);
    const guidanceEl = document.getElementById('eseg_guidance-' + index) || document.getElementById('esegg-' + index);
    if (!idEl) return;
    // prefer existing saved guidanceId when available; otherwise use existing trainType or the selected guidance option's data-gid/value
    const existingSeg = appData.segments[index] || {};
    let guidancePart = existingSeg.guidanceId || existingSeg.trainType || '';
    if (!guidancePart && guidanceEl) {
        const opt = guidanceEl.options[guidanceEl.selectedIndex];
        guidancePart = opt && opt.dataset && opt.dataset.gid ? opt.dataset.gid : (guidanceEl.value || '');
    }
    const newId = generateSegmentId(
        lineEl ? lineEl.value : '',
        guidancePart,
        fromEl ? fromEl.value : '',
        toEl ? toEl.value : ''
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
            // For platform-transfer inputs we show station name to the user,
            // but retain the stationId in a hidden field for saving.
            inputEl.value = st.stationName || '';
            // store resolved stationId on a hidden field so save can use it
            try {
                const hid = document.getElementById(`epts-id-${index}`);
                if (hid) hid.value = st.stationId || '';
            } catch (e) {}
            _hidePlatformStationSuggestionsFor(index);
            inputEl.focus();
            // update transfer-id preview when selection made
            try { updatePlatformTransferIdPreview(index); } catch (e) {}
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

// --- serviceCategories (タグ) editor ---
function renderServiceCategoriesEditor(lineIndex) {
    const container = document.getElementById(`el-sc-${lineIndex}`);
    if (!container) return;
    const arr = appData.lines[lineIndex].serviceCategories || [];
    container.innerHTML = '';
    arr.forEach((c, i) => {
        const span = document.createElement('span');
        span.style.display = 'inline-block';
        span.style.padding = '2px 2px';
        span.style.margin = '2px';
        span.style.background = '#f5f5f5';
        span.style.border = '1px solid #ddd';
        span.style.borderRadius = '0px';
        span.style.fontSize = '11px';
        const id = Array.isArray(c) ? (c[0] || (c[1] || '')) : (c || '');
        const label = Array.isArray(c) ? (c[1] || c[0]) : c;
        span.textContent = `${id} ${label}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '×';
        btn.style.marginLeft = '6px';
        btn.style.border = 'none';
        btn.style.background = 'transparent';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => { removeServiceCategoryFromLine(lineIndex, i); });
        span.appendChild(btn);
        container.appendChild(span);
    });
}

function addServiceCategoryToLine(lineIndex, id, label) {
    if (!label) return;
    if (!appData.lines[lineIndex].serviceCategories) appData.lines[lineIndex].serviceCategories = [];
    const arr = appData.lines[lineIndex].serviceCategories;
    // check duplicate: prefer matching by id when provided, otherwise by label
    const exists = arr.some(c => {
        if (Array.isArray(c)) {
            if (id) return c[0] === id;
            return (c[1] || c[0]) === label;
        } else {
            return !id && c === label;
        }
    });
    if (!exists) {
        arr.push([id, label]);
        renderServiceCategoriesEditor(lineIndex);
    }
}

function removeServiceCategoryFromLine(lineIndex, pos) {
    if (!appData.lines[lineIndex].serviceCategories) return;
    appData.lines[lineIndex].serviceCategories.splice(pos, 1);
    renderServiceCategoriesEditor(lineIndex);
}

// --- stationOrder editor (table + drag/drop + suggestions) ---
function renderStationOrderEditor(lineIndex) {
    const tbl = document.getElementById(`el-so-table-${lineIndex}`);
    if (!tbl) return;
    const tbody = tbl.querySelector('tbody');
    tbody.innerHTML = '';
    const arr = appData.lines[lineIndex].stationOrder || [];
    arr.forEach((entry, rowIdx) => {
        const stationId = (typeof entry === 'string') ? entry : (entry.stationId || '');
        const tr = document.createElement('tr');
        tr.draggable = true;
        tr.dataset.row = rowIdx;
        tr.style.cursor = 'grab';
        tr.innerHTML = `
            <td style="text-align:center;">≡</td>
            <td style="text-align:center;">${rowIdx + 1}</td>
            <td><input type="text" id="el-so-st-${lineIndex}-${rowIdx}" value="${esc(stationId)}" placeholder="駅ID" style="width:100%; min-width:60px;"></td>
            <td><span id="el-so-name-${lineIndex}-${rowIdx}" style="font-weight:700; display:inline-block; min-width:60px;">${getStationNameById(stationId)|| ''}</span></td>
            <td style="white-space:nowrap; text-align:center;"><button class="edit-btn" type="button" onclick="moveStationOrderRow(${lineIndex}, ${rowIdx}, ${rowIdx-1})">↑</button><button class="edit-btn" type="button" onclick="moveStationOrderRow(${lineIndex}, ${rowIdx}, ${rowIdx+1})">↓</button><button class="delete-btn" type="button" onclick="removeStationOrderRow(${lineIndex}, ${rowIdx})">削除</button></td>
        `;
        // events: input suggestion and change
        tbody.appendChild(tr);
        const inputId = document.getElementById(`el-so-st-${lineIndex}-${rowIdx}`);
        if (inputId) {
            inputId.addEventListener('input', () => _renderStationOrderSuggestionsFor(lineIndex, rowIdx));
            inputId.addEventListener('focus', () => _renderStationOrderSuggestionsFor(lineIndex, rowIdx));
            inputId.addEventListener('blur', () => setTimeout(() => _hideStationOrderSuggestionsFor(lineIndex, rowIdx), 180));
            inputId.addEventListener('change', () => {
                const v = inputId.value && inputId.value.trim();
                // store as simple stationId string
                appData.lines[lineIndex].stationOrder[rowIdx] = v || '';
                const nameSpan = document.getElementById(`el-so-name-${lineIndex}-${rowIdx}`);
                if (nameSpan) nameSpan.textContent = getStationNameById(v) || '';
            });
        }
        // drag event handlers
        tr.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', rowIdx); });
        tr.addEventListener('dragover', (ev) => { ev.preventDefault(); });
        tr.addEventListener('drop', (ev) => {
            ev.preventDefault();
            const from = Number(ev.dataTransfer.getData('text/plain'));
            const to = Number(tr.dataset.row);
            moveStationOrderRow(lineIndex, from, to);
        });
    });
}

function addStationOrderRow(lineIndex, data) {
    if (!appData.lines[lineIndex].stationOrder) appData.lines[lineIndex].stationOrder = [];
    const entry = data || '';
    appData.lines[lineIndex].stationOrder.push(entry);
    renderStationOrderEditor(lineIndex);
}

function removeStationOrderRow(lineIndex, rowIdx) {
    if (!appData.lines[lineIndex].stationOrder) return;
    appData.lines[lineIndex].stationOrder.splice(rowIdx, 1);
    renderStationOrderEditor(lineIndex);
}

function moveStationOrderRow(lineIndex, fromIdx, toIdx) {
    if (!appData.lines[lineIndex].stationOrder) return;
    const arr = appData.lines[lineIndex].stationOrder;
    if (fromIdx < 0 || fromIdx >= arr.length) return;
    if (toIdx < 0) toIdx = 0;
    if (toIdx >= arr.length) toIdx = arr.length - 1;
    const item = arr.splice(fromIdx, 1)[0];
    arr.splice(toIdx, 0, item);
    renderStationOrderEditor(lineIndex);
}

function _hideStationOrderSuggestionsFor(lineIndex, rowIdx) {
    const id = `station-suggest-so-${lineIndex}-${rowIdx}`;
    const existing = document.getElementById(id);
    if (existing) existing.remove();
}

function _renderStationOrderSuggestionsFor(lineIndex, rowIdx, filterText) {
    _hideStationOrderSuggestionsFor(lineIndex, rowIdx);
    const inputId = `el-so-st-${lineIndex}-${rowIdx}`;
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const q = (filterText || inputEl.value || '').toString().trim().toLowerCase();
    if (!q) return;
    const matches = appData.stations.filter(s => {
        if (!s) return false;
        const id = (s.stationId || '').toString().toLowerCase();
        const name = (s.stationName || '').toString().toLowerCase();
        const kana = (s.stationNameKana || '').toString().toLowerCase();
        return id.includes(q) || name.includes(q) || kana.includes(q);
    }).slice(0,30);
    if (!matches.length) return;
    const rect = inputEl.getBoundingClientRect();
    const container = document.createElement('div');
    container.id = `station-suggest-so-${lineIndex}-${rowIdx}`;
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
        const idLine = document.createElement('div'); idLine.textContent = st.stationId || ''; idLine.style.fontSize='12px'; idLine.style.color='#222';
        const nameLine = document.createElement('div'); nameLine.textContent = st.stationName || ''; nameLine.style.fontWeight='700'; nameLine.style.fontSize='14px'; nameLine.style.lineHeight='1.1';
        item.appendChild(idLine); item.appendChild(nameLine);
        item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            inputEl.value = st.stationId || '';
            _hideStationOrderSuggestionsFor(lineIndex, rowIdx);
            // update model (store stationId string)
            if (!appData.lines[lineIndex].stationOrder) appData.lines[lineIndex].stationOrder = [];
            appData.lines[lineIndex].stationOrder[rowIdx] = st.stationId || '';
            const nameSpan = document.getElementById(`el-so-name-${lineIndex}-${rowIdx}`);
            if (nameSpan) nameSpan.textContent = st.stationName || '';
            inputEl.focus();
        });
        container.appendChild(item);
    });
    document.body.appendChild(container);
    // Click outside to hide
    const onDocClick = (ev) => {
        if (!container.contains(ev.target) && ev.target !== inputEl) {
            _hideStationOrderSuggestionsFor(lineIndex, rowIdx);
            document.removeEventListener('click', onDocClick);
        }
    };
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
}

function getStationNameById(id) {
    if (!id) return '';
    const s = appData.stations.find(x => (x.stationId || '') === id);
    return s ? (s.stationName || '') : '';
}

function getLineNameById(id) {
    if (!id) return '';
    const l = appData.lines.find(x => (x.lineId || '') === id);
    return l ? (l.lineName || '') : '';
}

function getCompanyNameById(id) {
    if (!id) return '';
    const c = appData.companies.find(x => (x.companyId || '') === id);
    return c ? (c.companyName || '') : '';
}

// Generate platform-transfer ID in the format: TSF-[駅ID]-{乗換元のりば}-{乗換先のりば}
function generatePlatformTransferId(stationId, fromPlatform, toPlatform) {
    const safe = (s) => (s || '').toString().trim();
    // Use stationId as the key component (normalized, spaces collapsed)
    const sid = safe(stationId).replace(/\s+/g, '');
    const from = safe(fromPlatform).replace(/\s+/g, '_');
    const to = safe(toPlatform).replace(/\s+/g, '_');
    return `TSF-${sid}-${from}-${to}`;
}

// find stationId by station name (first match)
function getStationIdByName(name) {
    if (!name) return '';
    const n = name.toString().trim();
    const s = appData.stations.find(x => (x.stationName || '') === n || (x.stationId || '') === n);
    return s ? (s.stationId || '') : '';
}

function updatePlatformTransferIdPreview(index) {
    try {
        const stationNameInput = document.getElementById('epts-' + index);
        const stationHiddenId = document.getElementById('epts-id-' + index);
        const fromInput = document.getElementById('eptf-' + index);
        const toInput = document.getElementById('eptt-' + index);
        const idInput = document.getElementById('epti-' + index);
        if (!idInput) return;
        const sname = stationNameInput ? stationNameInput.value : '';
        // Prefer resolved stationId from hidden field; fallback by resolving from name; last resort: raw input
        let sid = stationHiddenId && stationHiddenId.value ? stationHiddenId.value : (getStationIdByName(sname) || sname);
        const from = fromInput ? fromInput.value : '';
        const to = toInput ? toInput.value : '';
        idInput.value = generatePlatformTransferId(sid, from, to);
    } catch (e) {}
}

// Generate through-service ID in the format: TSV-{乗入元路線ID}-{乗入先路線ID}
// Generate through-service ID in the format:
// TSV-{乗入元路線ID}-{元案内種別ID}-{乗入先路線ID}-{先案内種別ID}
// Guidance IDs may be empty. Values are cleaned of whitespace.
function generateThroughServiceId(fromLineId, toLineId, fromGuidanceId, toGuidanceId) {
    const safe = (s) => (s || '').toString().trim();
    const clean = (s) => safe(s).replace(/\s+/g, '');
    return `TSV-${clean(fromLineId)}-${clean(fromGuidanceId)}-${clean(toLineId)}-${clean(toGuidanceId)}`;
}

function generateUuid() {
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return template.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Resolve a guidance label to its ID for a given line's serviceCategories.
function getGuidanceIdFor(lineId, guidanceLabel) {
    if (!lineId) return '';
    const line = appData.lines.find(l => l.lineId === lineId);
    if (!line || !Array.isArray(line.serviceCategories)) return guidanceLabel || '';
    const g = (line.serviceCategories || []).find(c => {
        if (Array.isArray(c)) {
            const id = (c[0] || '').toString();
            const label = (c[1] || c[0] || '').toString();
            return (label === guidanceLabel) || (id === guidanceLabel);
        } else {
            return (c === guidanceLabel);
        }
    });
    if (!g) return guidanceLabel || '';
    if (Array.isArray(g)) return (g[0] || g[1] || '').toString();
    return g.toString();
}

// Update the readonly through-service configId preview while editing
function updateThroughServiceIdPreview(index) {
    const idEl = document.getElementById('etsi-' + index);
    const fromEl = document.getElementById('etsf-' + index);
    const toEl = document.getElementById('etst-' + index);
    if (!idEl) return;
    // determine selected guidance option data-gid if present, otherwise fallback to value
    const fromGuidSel = document.getElementById('etsfg-' + index);
    const toGuidSel = document.getElementById('etstg-' + index);
    const getSelectedGuidanceId = (sel) => {
        if (!sel) return '';
        const opt = sel.options[sel.selectedIndex];
        if (!opt) return '';
        return opt.dataset && opt.dataset.gid ? opt.dataset.gid : (opt.value || '');
    };
    const newId = generateThroughServiceId(
        fromEl ? fromEl.value : '',
        toEl ? toEl.value : '',
        getSelectedGuidanceId(fromGuidSel),
        getSelectedGuidanceId(toGuidSel)
    );
    idEl.value = newId;
}

function saveSegment(index) {
    // preserve existing platforms mapping, but update keys for from/to stations
    const prevPlatforms = appData.segments[index] && appData.segments[index].platforms ? {...appData.segments[index].platforms} : {};
    const newFromStation = (document.getElementById('esegfsel-' + index) || document.getElementById('esegf-' + index)).value;
    const newToStation = (document.getElementById('esegtsel-' + index) || document.getElementById('esegt-' + index)).value;
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

    // preserve existing trainType if present (do not provide an editable trainType field anymore)
    const existingTT = appData.segments[index] && appData.segments[index].trainType ? appData.segments[index].trainType : '';
    const guidanceSel = document.getElementById('eseg_guidance-' + index);
    const guidanceVal = guidanceSel ? guidanceSel.value : (document.getElementById('esegg-' + index) ? document.getElementById('esegg-' + index).value : '');
    // guidanceId: prefer option dataset.gid when available, otherwise fallback to the guidanceSel.value (legacy)
    let guidanceIdVal = '';
    if (guidanceSel) {
        const opt = guidanceSel.options[guidanceSel.selectedIndex];
        guidanceIdVal = opt && opt.dataset && opt.dataset.gid ? opt.dataset.gid : guidanceSel.value;
    }
    const computedId = generateSegmentId(
        document.getElementById('esegl-' + index).value,
        guidanceIdVal || existingTT || guidanceVal || '',
        newFromStation,
        newToStation
    );
    appData.segments[index] = {
        segmentId: computedId,
        platforms: newPlatforms,
        lineId: document.getElementById('esegl-' + index).value,
        companyId: document.getElementById('esegc-' + index).value,
        fromStationId: newFromStation,
        toStationId: newToStation,
        // keep previous trainType id if present; otherwise leave undefined
        trainType: existingTT || undefined,
        // store guidance as the display name only (compatibility: guidance field contains name)
        guidance: guidanceVal || undefined,
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
            const fromGuidId = getGuidanceIdFor(c.fromLineId, c.fromGuidance || c.fromTrainType || '');
            const toGuidId = getGuidanceIdFor(c.toLineId, c.toGuidance || c.toTrainType || '');
            c.configId = generateThroughServiceId(c.fromLineId, c.toLineId, fromGuidId, toGuidId);
        }
    });
    // duplicate detection for configId
    const idCounts = {};
    appData.throughServiceConfigs.forEach(c => {
        const id = (c.configId || '').toString();
        if (!id) return;
        idCounts[id] = (idCounts[id] || 0) + 1;
    });
    // detect mirrored duplicates: entries where from/to lines are swapped and guidance pairs match in reverse
    // Use normalized guidance IDs (via getGuidanceIdFor) for robust comparison instead of legacy trainType labels.
    const mirrored = new Set();
    for (let i = 0; i < appData.throughServiceConfigs.length; i++) {
        for (let j = i + 1; j < appData.throughServiceConfigs.length; j++) {
            const a = appData.throughServiceConfigs[i];
            const b = appData.throughServiceConfigs[j];
            if (!a || !b) continue;
            if (!a.fromLineId || !a.toLineId || !b.fromLineId || !b.toLineId) continue;
            // mirror condition: a.from === b.to && a.to === b.from
            // compare by resolved guidance IDs for each side (fallbacks handled inside getGuidanceIdFor)
            const aFromGuidId = getGuidanceIdFor(a.fromLineId, (a.fromGuidance || a.fromTrainType || '')) || '';
            const aToGuidId = getGuidanceIdFor(a.toLineId, (a.toGuidance || a.toTrainType || '')) || '';
            const bFromGuidId = getGuidanceIdFor(b.fromLineId, (b.fromGuidance || b.fromTrainType || '')) || '';
            const bToGuidId = getGuidanceIdFor(b.toLineId, (b.toGuidance || b.toTrainType || '')) || '';
            if (a.fromLineId === b.toLineId && a.toLineId === b.fromLineId &&
                aFromGuidId === bToGuidId && aToGuidId === bFromGuidId) {
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
                <td>${esc(getLineNameById(cfg.fromLineId) || cfg.fromLineId || '')}</td>
                <td>${esc(cfg.fromGuidance || cfg.fromTrainType || '')}</td>
                <td>${esc(getLineNameById(cfg.toLineId) || cfg.toLineId || '')}</td>
                <td>${esc(cfg.toGuidance || cfg.toTrainType || '')}</td>
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
    const newCfg = {fromLineId: '', toLineId: '', fromGuidance: '', toGuidance: '', isBidirectional: true, description: ''};
    // initial empty guidance ids
    newCfg.configId = generateThroughServiceId(newCfg.fromLineId, newCfg.toLineId, '', '');
    appData.throughServiceConfigs.push(newCfg);
    renderThroughServices();
    editThroughServiceRow(appData.throughServiceConfigs.length - 1);
    scrollToSectionBottom('through-services');}

function editThroughServiceRow(index) {
    const cfg = appData.throughServiceConfigs[index];
    // build line option lists (include -- option)
    const fromLineOpts = ['<option value="">--</option>'].concat(appData.lines.map(l => `<option value="${esc(l.lineId)}" ${l.lineId === cfg.fromLineId ? 'selected' : ''}>${esc(l.lineName)}</option>`)).join('');
    const toLineOpts = ['<option value="">--</option>'].concat(appData.lines.map(l => `<option value="${esc(l.lineId)}" ${l.lineId === cfg.toLineId ? 'selected' : ''}>${esc(l.lineName)}</option>`)).join('');
    
    const tr = document.getElementById('through-services-tbody').children[index];
    tr.innerHTML = `
        <td class="row-number">${index + 1}</td>
        <td><input type="text" value="${esc(cfg.configId)}" id="etsi-${index}" style="width:100%; background:#e9e9e9;" readonly title="設定IDは自動生成されます"></td>
        <td><select id="etsf-${index}" onchange="updateThroughServiceIdPreview(${index}); updateThroughServiceDependentFields(${index});" required>${fromLineOpts}</select></td>
        <td>
            <select id="etsfg-${index}" style="width:100%;">
                <option value="">--</option>
            </select>
        </td>
        <td><select id="etst-${index}" onchange="updateThroughServiceIdPreview(${index}); updateThroughServiceDependentFields(${index});" required>${toLineOpts}</select></td>
        <td>
            <select id="etstg-${index}" style="width:100%;">
                <option value="">--</option>
            </select>
        </td>
        <td style="text-align: center;">
            <select id="etsb-${index}" required>
                <option value="true" ${cfg.isBidirectional ? 'selected' : ''}>相互直通</option>
                <option value="false" ${!cfg.isBidirectional ? 'selected' : ''}>一方向</option>
            </select>
        </td>
    <td>
        <div style="display:flex; gap:6px; align-items:center;">
            <input type="text" value="${esc(cfg.description)}" id="etsd-${index}" placeholder="説明" style="flex:1;">
        </div>
    </td>
        <td>
            <button class="save-btn" onclick="saveThroughService(${index})">保存</button>
            <button class="cancel-btn" onclick="renderThroughServices()">取消</button>
        </td>
    `;
    // initialize dependent selects (guidance) based on selected lines
    updateThroughServiceDependentFields(index);

    // highlight if duplicate configId
    const id = (cfg.configId || '').toString();
    if (id) {
        const counts = {};
        appData.throughServiceConfigs.forEach(x => { const k = (x.configId||'').toString(); if (!k) return; counts[k] = (counts[k]||0)+1; });
        // compute mirrored duplicates using normalized guidance IDs for the edit row
        let isMirrored = false;
        for (let i = 0; i < appData.throughServiceConfigs.length; i++) {
            if (i === index) continue;
            const a = appData.throughServiceConfigs[index];
            const b = appData.throughServiceConfigs[i];
            if (!a || !b) continue;
            if (!a.fromLineId || !a.toLineId || !b.fromLineId || !b.toLineId) continue;
            if (a.fromLineId === b.toLineId && a.toLineId === b.fromLineId) {
                const aFromGuidId = getGuidanceIdFor(a.fromLineId, (a.fromGuidance || a.fromTrainType || '')) || '';
                const aToGuidId = getGuidanceIdFor(a.toLineId, (a.toGuidance || a.toTrainType || '')) || '';
                const bFromGuidId = getGuidanceIdFor(b.fromLineId, (b.fromGuidance || b.fromTrainType || '')) || '';
                const bToGuidId = getGuidanceIdFor(b.toLineId, (b.toGuidance || b.toTrainType || '')) || '';
                if (aFromGuidId === bToGuidId && aToGuidId === bFromGuidId) {
                    isMirrored = true;
                    break;
                }
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
    // compute guidance IDs from selected options (use data-gid when present)
    const fromGuidSel = document.getElementById('etsfg-' + index);
    const toGuidSel = document.getElementById('etstg-' + index);
    const getSelectedGuidId = (sel, lineId) => {
        if (!sel) return '';
        const opt = sel.options[sel.selectedIndex];
        if (!opt) return '';
        return opt.dataset && opt.dataset.gid ? opt.dataset.gid : (opt.value || getGuidanceIdFor(lineId, opt.value || ''));
    };
    const fromGuidId = getSelectedGuidId(fromGuidSel, fromLine);
    const toGuidId = getSelectedGuidId(toGuidSel, toLine);
    const computedId = generateThroughServiceId(fromLine, toLine, fromGuidId, toGuidId);
    const fromGuid = (document.getElementById('etsfg-' + index) ? document.getElementById('etsfg-' + index).value : '') || '';
    const toGuid = (document.getElementById('etstg-' + index) ? document.getElementById('etstg-' + index).value : '') || '';
    appData.throughServiceConfigs[index] = {
        configId: computedId,
        fromLineId: fromLine,
        toLineId: toLine,
        // store guidance label (for display) and keep id encoded in configId
        fromGuidance: fromGuid || undefined,
        toGuidance: toGuid || undefined,
        isBidirectional: document.getElementById('etsb-' + index).value === 'true',
        description: document.getElementById('etsd-' + index).value
    };
    renderThroughServices();
}

function deleteThroughService(index) {
    showInlineDeleteConfirm('through-services-tbody', index, `performDeleteThroughService(${index})`);
}

// Update guidance selects for a through-service edit row based on selected line
function updateThroughServiceDependentFields(index) {
    const fromLineSel = document.getElementById('etsf-' + index);
    const toLineSel = document.getElementById('etst-' + index);
    const fromGuidSel = document.getElementById('etsfg-' + index);
    const toGuidSel = document.getElementById('etstg-' + index);
    const fromLineId = fromLineSel ? fromLineSel.value : '';
    const toLineId = toLineSel ? toLineSel.value : '';
    const fromLine = appData.lines.find(l => l.lineId === fromLineId) || null;
    const toLine = appData.lines.find(l => l.lineId === toLineId) || null;

    const buildGuidanceHtml = (line) => {
        let html = '<option value="">--</option>';
        if (line && Array.isArray(line.serviceCategories)) {
            html += line.serviceCategories.map(c => {
                if (Array.isArray(c)) {
                    const id = c[0] || '';
                    const label = c[1] || c[0] || '';
                    return `<option value="${esc(label)}" data-gid="${esc(id)}">${esc(id)}・${esc(label)}</option>`;
                } else {
                    const label = c || '';
                    return `<option value="${esc(label)}">${esc(label)}</option>`;
                }
            }).join('');
        }
        return html;
    };

    if (fromGuidSel) {
        const prev = fromGuidSel.value || '';
        fromGuidSel.innerHTML = buildGuidanceHtml(fromLine);
        if (prev && fromLine && Array.isArray(fromLine.serviceCategories) && (fromLine.serviceCategories||[]).some(c => ((Array.isArray(c) ? (c[1] || c[0]) : c) === prev))) {
            fromGuidSel.value = prev;
        } else {
            fromGuidSel.value = '';
        }
        fromGuidSel.disabled = !fromLine;
    }

    if (toGuidSel) {
        const prev = toGuidSel.value || '';
        toGuidSel.innerHTML = buildGuidanceHtml(toLine);
        if (prev && toLine && Array.isArray(toLine.serviceCategories) && (toLine.serviceCategories||[]).some(c => ((Array.isArray(c) ? (c[1] || c[0]) : c) === prev))) {
            toGuidSel.value = prev;
        } else {
            toGuidSel.value = '';
        }
        toGuidSel.disabled = !toLine;
    }
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
            <td>${esc(getStationNameById(pt.stationId) || pt.stationName || pt.stationId || '')}</td>
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
        <td><input type="text" value="${esc(pt.transferId)}" id="epti-${index}" style="width: 100%; background:#e9e9e9;" readonly title="乗換IDは自動生成されます" required></td>
        <td>
            <input type="text" value="${esc(getStationNameById(pt.stationId) || pt.stationName || pt.stationId || '')}" id="epts-${index}" oninput="(function(i){ _hidePlatformStationSuggestionsFor(i); _renderPlatformStationSuggestionsFor(i); updatePlatformTransferIdPreview(i); })(${index})" onfocus="_renderPlatformStationSuggestionsFor(${index})" autocomplete="off" required>
            <input type="hidden" id="epts-id-${index}" value="${esc(pt.stationId || '')}">
        </td>
        <td><input type="text" value="${esc(pt.fromPlatform)}" id="eptf-${index}" oninput="updatePlatformTransferIdPreview(${index})" required></td>
        <td><input type="text" value="${esc(pt.toPlatform)}" id="eptt-${index}" oninput="updatePlatformTransferIdPreview(${index})" required></td>
        <td>
            <input type="number" value="${t}" id="epttime-${index}" min="0" required> 秒
        </td>
        <td>
            <button class="save-btn" onclick="savePlatformTransfer(${index})">保存</button>
            <button class="cancel-btn" onclick="renderPlatformTransfers()">取消</button>
        </td>
    `;
    // initialize previewed transfer id based on current values
    try { updatePlatformTransferIdPreview(index); } catch (e) {}
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
    // resolve stationId: prefer hidden resolved id, else try by name, else keep raw
    const stationNameEl = document.getElementById('epts-' + index);
    const stationHiddenEl = document.getElementById('epts-id-' + index);
    const fromEl = document.getElementById('eptf-' + index);
    const toEl = document.getElementById('eptt-' + index);
    const timeEl = document.getElementById('epttime-' + index);
    const stationName = stationNameEl ? stationNameEl.value : '';
    let stationId = '';
    if (stationHiddenEl && stationHiddenEl.value) stationId = stationHiddenEl.value;
    if (!stationId) stationId = getStationIdByName(stationName) || stationName;
    const fromPlatform = fromEl ? fromEl.value : '';
    const toPlatform = toEl ? toEl.value : '';
    const transferTime = parseInt(timeEl ? timeEl.value || 0 : 0);
    const transferId = generatePlatformTransferId(stationId, fromPlatform, toPlatform);

    appData.platformTransfers[index] = {
        transferId: transferId,
        stationId: stationId,
        stationName: stationName,
        fromPlatform: fromPlatform,
        toPlatform: toPlatform,
        transferTime: transferTime
    };
    renderPlatformTransfers();
}

function deletePlatformTransfer(index) {
    showInlineDeleteConfirm('platform-transfers-tbody', index, `performDeletePlatformTransfer(${index})`);
}

// 運行状況
function renderServiceStatuses() {
    ensureServiceStatusConfig(appData);
    const tbody = document.getElementById('service-statuses-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    appData.serviceStatuses.forEach((status, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        const isGenerated = status.generated_from && status.generated_from.source_id;
        tr.innerHTML = `
            <td class="row-number">${index + 1}</td>
            <td>${esc(status.id || '')}</td>
            <td>${esc((status.generated_text && status.generated_text.heading) || status.status?.heading || '')}</td>
            <td>${esc(getLineNameById(status.affected_line_id) || status.affected_line_id || '')}</td>
            <td>${esc(getStatusLabel(status.status ? status.status.code : ''))}</td>
            <td>${status.published ? 'ON' : ''}</td>
            <td>${esc(formatDateTimeSummary(status.updated_at || status.created_at || ''))}</td>
            <td>
                ${isGenerated ? `<button class="view-btn" onclick="openServiceStatusEditor(${index})">参照</button>` : `<button class="edit-btn" onclick="openServiceStatusEditor(${index})">編集</button><button class="delete-btn" onclick="deleteServiceStatus(${index})">削除</button>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
    applyRequiredHighlightsToTbody(tbody);
}

function getStatusLabel(code) {
    if (!code) return '';
    if (code === 'notice') return 'お知らせ';
    if (code === 'other') return 'その他';
    const tpl = (appData.statusTemplates || []).find(t => t.code === code);
    return tpl ? (tpl.label || tpl.heading || tpl.code || code) : code;
}

function formatDateTimeSummary(value) {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}`;
}

function addServiceStatus() {
    ensureServiceStatusConfig(appData);
    const entry = createEmptyServiceStatus();
    appData.serviceStatuses.push(entry);
    renderServiceStatuses();
    openServiceStatusEditor(appData.serviceStatuses.length - 1);
    scrollToSectionBottom('service-statuses');
}

function createEmptyServiceStatus() {
    const now = new Date().toISOString();
    return {
        id: generateUuid(),
        version: 1,
        created_at: now,
        updated_at: now,
        occurrence: { year: null, month: null, day: null, hour: null, minute: null, timezone: 'Asia/Tokyo' },
        affected_line_id: '',
        notice_types_all: true,
        notice_types: [],
        status: { code: '', status_id: '', heading: '', body: '' },
        affected_segment: { is_full_line: true, start_station_id: null, end_station_id: null },
        direction: { up: true, down: true },
        cause: { code: '', heading: null, body: null, cause_line_option: 'affected', cause_line_id: null, cause_segment: { start_station_id: null, end_station_id: null } },
        turnback: { start: false, end: false },
        through_services: [],
        preview: { editable: false, custom_text: null },
        generated_text: { heading: '', body: '' },
        published_text: '',
        published: false,
        history: []
    };
}

function getCurrentServiceStatus() {
    if (_currentServiceStatusIndex === null) return null;
    return appData.serviceStatuses[_currentServiceStatusIndex] || null;
}

function openServiceStatusEditor(index) {
    ensureServiceStatusConfig(appData);
    const entry = appData.serviceStatuses[index];
    if (!entry) return;
    _currentServiceStatusIndex = index;
    const editor = document.getElementById('service-status-editor');
    if (editor) editor.classList.remove('hidden');
    const title = document.getElementById('service-status-editor-title');
    if (title) title.textContent = `運行状況詳細 (#${index + 1})`;
    document.getElementById('ss-id').value = entry.id || '';

    const occ = entry.occurrence || {};
    document.getElementById('ss-occ-year').value = occ.year != null ? occ.year : '';
    document.getElementById('ss-occ-month').value = occ.month != null ? occ.month : '';
    document.getElementById('ss-occ-day').value = occ.day != null ? occ.day : '';
    document.getElementById('ss-occ-hour').value = occ.hour != null ? occ.hour : '';
    document.getElementById('ss-occ-minute').value = occ.minute != null ? occ.minute : '';

    populateServiceStatusLineOptions(entry.affected_line_id || '');
    populateAffectedSegmentOptions(entry);
    const currentLineId = document.getElementById('ss-line').value || entry.affected_line_id || '';

    const dir = entry.direction || { up: true, down: true };
    document.getElementById('ss-dir-up').checked = !!dir.up;
    document.getElementById('ss-dir-down').checked = !!dir.down;

    const noticeAll = document.getElementById('ss-notice-all');
    if (noticeAll) noticeAll.checked = !!entry.notice_types_all;
    renderNoticeTypeCheckboxes(entry.notice_types || [], currentLineId);

    populateStatusTemplateSelect(entry.status ? entry.status.code : '');
    document.getElementById('ss-status-heading').value = entry.status?.heading || '';
    document.getElementById('ss-status-body').value = entry.status?.body || '';
    onServiceStatusTemplateChange();

    populateCauseSelect(entry.cause?.code || '');
    document.getElementById('ss-cause-heading').value = entry.cause?.heading || '';
    document.getElementById('ss-cause-body').value = entry.cause?.body || '';
    const causeLineValue = getCauseLineSelectValue(entry);
    renderCauseLineOptions(causeLineValue);
    updateCauseSegmentOptions(entry.cause?.cause_segment?.start_station_id || '', entry.cause?.cause_segment?.end_station_id || '');

    document.getElementById('ss-turnback-start').checked = !!entry.turnback?.start;
    document.getElementById('ss-turnback-end').checked = !!entry.turnback?.end;

    const previewEditable = document.getElementById('ss-preview-editable');
    previewEditable.checked = !!entry.preview?.editable;
    document.getElementById('ss-preview-heading').value = entry.generated_text?.heading || '';
    document.getElementById('ss-preview-body').value = entry.generated_text?.body || '';
    document.getElementById('ss-preview-custom').value = entry.preview?.custom_text || '';
    document.getElementById('ss-published').checked = !!entry.published;
    onServiceStatusPreviewEditableToggle(true);

    // If this entry was generated from another via ss-through-show, make editor mostly read-only
    const isGenerated = !!(entry.generated_from && entry.generated_from.source_id);
    const editorEl = document.getElementById('service-status-editor');
    if (editorEl) {
        // Disable form controls when generated, but keep close button enabled
        const controls = editorEl.querySelectorAll('input, select, textarea, button');
        controls.forEach(ctrl => {
            if (ctrl.classList && ctrl.classList.contains('cancel-btn')) return; // keep close usable
            // Don't disable the view button in listing
            if (ctrl.classList && ctrl.classList.contains('view-btn')) return;
            ctrl.disabled = isGenerated;
        });
        // Ensure ID is visible and readonly
        const idField = document.getElementById('ss-id');
        if (idField) { idField.disabled = false; idField.readOnly = true; }
    }

    renderThroughServiceControls(entry);
}

function closeServiceStatusEditor() {
    _currentServiceStatusIndex = null;
    const editor = document.getElementById('service-status-editor');
    if (editor) editor.classList.add('hidden');
    // Re-enable any disabled controls when closing editor
    if (editor) {
        const controls = editor.querySelectorAll('input, select, textarea, button');
        controls.forEach(ctrl => { ctrl.disabled = false; });
        const idField = document.getElementById('ss-id');
        if (idField) idField.readOnly = true;
    }
}

function populateServiceStatusLineOptions(selectedValue) {
    const select = document.getElementById('ss-line');
    if (!select) return;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '--';
    select.appendChild(placeholder);
    (appData.lines || []).forEach(line => {
        const opt = document.createElement('option');
        opt.value = line.lineId || '';
        opt.textContent = line.lineName || line.lineId || '';
        select.appendChild(opt);
    });
    select.value = selectedValue || '';
}

function renderCauseLineOptions(selectedValue) {
    const select = document.getElementById('ss-cause-line');
    if (!select) return;
    const previousValue = selectedValue || select.value || 'affected';
    select.innerHTML = '';
    const affectedOpt = document.createElement('option');
    affectedOpt.value = 'affected';
    affectedOpt.textContent = '影響路線';
    select.appendChild(affectedOpt);
    (appData.lines || []).forEach(line => {
        const opt = document.createElement('option');
        opt.value = line.lineId || '';
        opt.textContent = line.lineName || line.lineId || '';
        select.appendChild(opt);
    });
    const hiddenOpt = document.createElement('option');
    hiddenOpt.value = 'hidden';
    hiddenOpt.textContent = '非表示';
    select.appendChild(hiddenOpt);
    if (Array.from(select.options).some(opt => opt.value === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = 'affected';
    }
}

function getCauseLineSelectValue(entry) {
    if (!entry || !entry.cause) return 'affected';
    if (entry.cause.cause_line_option === 'hidden') return 'hidden';
    if (entry.cause.cause_line_option === 'line' && entry.cause.cause_line_id) {
        return entry.cause.cause_line_id;
    }
    return 'affected';
}

function getSelectedCauseLineInfo() {
    const select = document.getElementById('ss-cause-line');
    const value = select ? select.value : 'affected';
    if (value === 'hidden') {
        return { option: 'hidden', lineId: null };
    }
    if (value === 'affected' || !value) {
        return { option: 'affected', lineId: document.getElementById('ss-line')?.value || null };
    }
    return { option: 'line', lineId: value };
}

function populateAffectedSegmentOptions(entry) {
    const lineId = document.getElementById('ss-line').value || entry.affected_line_id || '';
    const startSelect = document.getElementById('ss-segment-start');
    const endSelect = document.getElementById('ss-segment-end');
    const stations = getStationsForLine(lineId);
    let startId = entry.affected_segment?.start_station_id || '';
    let endId = entry.affected_segment?.end_station_id || '';
    if (entry.affected_segment?.is_full_line) {
        startId = stations[0]?.id || '';
        endId = stations[stations.length - 1]?.id || '';
    }
    setStationOptions(startSelect, stations, startId, true, 0);
    const startIndex = stations.findIndex(s => s.id === (startId || ''));
    setStationOptions(endSelect, stations, endId, true, startIndex >= 0 ? startIndex : 0);
}

function getStationsForLine(lineId) {
    if (!lineId) return [];
    const line = (appData.lines || []).find(l => l.lineId === lineId);
    if (!line || !Array.isArray(line.stationOrder)) return [];
    return line.stationOrder.map(stationId => ({ id: stationId, name: getStationNameById(stationId) || stationId }));
}

function setStationOptions(selectEl, stations, selectedValue, allowBlank, minIndex) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    if (allowBlank) {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '--';
        selectEl.appendChild(blank);
    }
    stations.forEach((station, idx) => {
        if (typeof minIndex === 'number' && idx < minIndex) return;
        const opt = document.createElement('option');
        opt.value = station.id || '';
        opt.textContent = station.name || station.id || '';
        selectEl.appendChild(opt);
    });
    if (selectedValue && Array.from(selectEl.options).some(opt => opt.value === selectedValue)) {
        selectEl.value = selectedValue;
    } else if (allowBlank) {
        selectEl.value = '';
    }
    selectEl.disabled = selectEl.options.length <= (allowBlank ? 1 : 0);
}

function isCurrentStatusDss() {
    const select = document.getElementById('ss-status-code');
    const code = select ? select.value : '';
    if (!code) return false;
    if (code === 'notice' || code === 'other') return false;
    const template = getStatusTemplateByCode(code);
    return template ? template.status_id === 'DSS' : false;
}

function onServiceStatusLineChange() {
    const entry = getCurrentServiceStatus() || createEmptyServiceStatus();
    entry.affected_line_id = document.getElementById('ss-line').value;
    populateAffectedSegmentOptions(entry);
    const noticeSelections = document.getElementById('ss-notice-all').checked ? (entry.notice_types || []) : getNoticeTypeSelectionsFromForm();
    renderNoticeTypeCheckboxes(noticeSelections, entry.affected_line_id);
    if (getSelectedCauseLineInfo().option === 'affected') {
        updateCauseSegmentOptions();
    }
    renderThroughServiceControls(entry);
}

function onServiceStatusSegmentChange() {
    const lineId = document.getElementById('ss-line').value;
    const stations = getStationsForLine(lineId);
    const startSelect = document.getElementById('ss-segment-start');
    const endSelect = document.getElementById('ss-segment-end');
    const startValue = startSelect ? startSelect.value : '';
    const startIndex = stations.findIndex(s => s.id === startValue);
    const endValue = endSelect ? endSelect.value : '';
    setStationOptions(endSelect, stations, endValue, true, startIndex >= 0 ? startIndex : 0);
}

function onServiceStatusNoticeAllToggle() {
    const allChecked = document.getElementById('ss-notice-all').checked;
    const lineId = document.getElementById('ss-line')?.value || '';
    const selections = allChecked ? [] : getNoticeTypeSelectionsFromForm();
    renderNoticeTypeCheckboxes(selections, lineId);
}

function onServiceStatusNoticeTypeChange() {
    const container = document.getElementById('ss-notice-types');
    if (!container) return;
    const anyChecked = Array.from(container.querySelectorAll('input[type="checkbox"]')).some(cb => cb.checked);
    if (anyChecked) {
        document.getElementById('ss-notice-all').checked = false;
    }
}

function renderNoticeTypeCheckboxes(selectedCodes, lineId) {
    const container = document.getElementById('ss-notice-types');
    if (!container) return;
    const noticeAll = document.getElementById('ss-notice-all');
    const allChecked = noticeAll ? noticeAll.checked : false;
    const selected = Array.isArray(selectedCodes) ? selectedCodes : [];
    container.innerHTML = '';
    const options = Array.isArray(getNoticeTypeOptionsForLine(lineId)) ? [...getNoticeTypeOptionsForLine(lineId)] : [];
    const knownCodes = new Set(options.map(opt => opt.code));
    selected.forEach(code => {
        if (!knownCodes.has(code)) {
            options.push({ code, label: `${code} (未定義)` });
            knownCodes.add(code);
        }
    });
    if (!options.length) {
        container.innerHTML = '<span class="ss-helper">影響路線を選択してください。</span>';
        return;
    }
    options.forEach((type, idx) => {
        const id = `ss-notice-${idx}`;
        const label = document.createElement('label');
        label.setAttribute('for', id);
        label.innerHTML = `<input type="checkbox" id="${id}" value="${esc(type.code)}" onchange="onServiceStatusNoticeTypeChange()"> ${esc(type.label || type.code)}`;
        container.appendChild(label);
        const input = label.querySelector('input');
        input.checked = selected.includes(type.code);
        if (allChecked) input.disabled = true;
    });
}

function getNoticeTypeSelectionsFromForm() {
    const container = document.getElementById('ss-notice-types');
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => cb.value);
}

function populateStatusTemplateSelect(selectedCode) {
    const select = document.getElementById('ss-status-code');
    if (!select) return;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '--';
    select.appendChild(placeholder);
    (appData.statusTemplates || []).forEach(tpl => {
        const opt = document.createElement('option');
        opt.value = tpl.code;
        opt.textContent = tpl.label || tpl.heading || tpl.code;
        select.appendChild(opt);
    });
    const noticeOpt = document.createElement('option');
    noticeOpt.value = 'notice';
    noticeOpt.textContent = 'お知らせ';
    select.appendChild(noticeOpt);
    const otherOpt = document.createElement('option');
    otherOpt.value = 'other';
    otherOpt.textContent = 'その他';
    select.appendChild(otherOpt);
    select.value = selectedCode || '';
}

function onServiceStatusTemplateChange() {
    const code = document.getElementById('ss-status-code').value;
    const headingInput = document.getElementById('ss-status-heading');
    const bodyInput = document.getElementById('ss-status-body');
    const template = (appData.statusTemplates || []).find(t => t.code === code);
    if (template && code !== 'other' && code !== 'notice') {
        if (!headingInput.value) headingInput.value = template.heading || template.label || '';
        if (!bodyInput.value) bodyInput.value = template.body || '';
    }
    if (code === 'notice') {
        headingInput.value = 'お知らせ';
        headingInput.readOnly = true;
        headingInput.required = false;
        bodyInput.readOnly = false;
        bodyInput.required = true;
    } else if (code === 'other') {
        headingInput.readOnly = false;
        headingInput.required = true;
        bodyInput.readOnly = false;
        bodyInput.required = true;
    } else {
        headingInput.readOnly = false;
        headingInput.required = false;
        bodyInput.readOnly = false;
        bodyInput.required = true;
    }
    renderThroughServiceControls(getCurrentServiceStatus() || createEmptyServiceStatus());
}

function populateCauseSelect(selectedCode) {
    const select = document.getElementById('ss-cause-code');
    if (!select) return;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '--';
    select.appendChild(placeholder);
    (appData.serviceStatusCauses || []).forEach(cause => {
        const opt = document.createElement('option');
        opt.value = cause.code || '';
        opt.textContent = cause.label || cause.heading || cause.code;
        select.appendChild(opt);
    });
    select.value = selectedCode || '';
}

function onServiceStatusCauseChange() {
    const code = document.getElementById('ss-cause-code').value;
    const headingInput = document.getElementById('ss-cause-heading');
    const bodyInput = document.getElementById('ss-cause-body');
    const cause = (appData.serviceStatusCauses || []).find(c => c.code === code);
    if (!cause) {
        headingInput.value = '';
        bodyInput.value = '';
        headingInput.readOnly = true;
        headingInput.required = false;
        bodyInput.readOnly = true;
        bodyInput.required = false;
        return;
    }
    if (code !== 'other') {
        headingInput.value = cause.heading || cause.label || '';
        bodyInput.value = cause.body || '';
        headingInput.readOnly = true;
        headingInput.required = false;
        bodyInput.readOnly = true;
        bodyInput.required = false;
        if (cause.default_line_option) {
            document.getElementById('ss-cause-line-option').value = cause.default_line_option;
        }
    } else {
        headingInput.readOnly = false;
        bodyInput.readOnly = false;
        headingInput.required = true;
        bodyInput.required = true;
    }
    updateCauseSegmentOptions();
}

function onServiceStatusCauseLineChange() {
    const startValue = document.getElementById('ss-cause-segment-start')?.value || '';
    const endValue = document.getElementById('ss-cause-segment-end')?.value || '';
    updateCauseSegmentOptions(startValue, endValue);
}

function updateCauseSegmentOptions(selectedStart, selectedEnd) {
    const startSelect = document.getElementById('ss-cause-segment-start');
    const endSelect = document.getElementById('ss-cause-segment-end');
    if (!startSelect || !endSelect) return;
    const info = getSelectedCauseLineInfo();
    if (info.option === 'hidden' || !info.lineId) {
        setStationOptions(startSelect, [], '', true, 0);
        setStationOptions(endSelect, [], '', true, 0);
        startSelect.disabled = true;
        endSelect.disabled = true;
        return;
    }
    const stations = getStationsForLine(info.lineId);
    startSelect.disabled = false;
    endSelect.disabled = false;
    const currentStart = (selectedStart !== undefined ? selectedStart : startSelect.value);
    setStationOptions(startSelect, stations, currentStart, true, 0);
    const startIndex = stations.findIndex(s => s.id === (currentStart || startSelect.value));
    const currentEnd = (selectedEnd !== undefined ? selectedEnd : endSelect.value);
    setStationOptions(endSelect, stations, currentEnd, true, startIndex >= 0 ? startIndex : 0);
}

function onServiceStatusCauseSegmentChange() {
    const startSelect = document.getElementById('ss-cause-segment-start');
    const info = getSelectedCauseLineInfo();
    const stations = getStationsForLine(info.lineId);
    const startIndex = stations.findIndex(s => s.id === (startSelect ? startSelect.value : ''));
    const endSelect = document.getElementById('ss-cause-segment-end');
    if (endSelect) {
        setStationOptions(endSelect, stations, endSelect.value, true, startIndex >= 0 ? startIndex : 0);
    }
}

function renderThroughServiceControls(entry) {
    const container = document.getElementById('ss-through-services');
    if (!container) return;
    entry = entry || getCurrentServiceStatus() || createEmptyServiceStatus();
    container.innerHTML = '';
    const lineId = document.getElementById('ss-line').value || entry.affected_line_id || '';
    if (!lineId) {
        container.innerHTML = '<p class="ss-empty">影響路線を選択すると直通設定を編集できます。</p>';
        return;
    }
    const links = getThroughLinesForLine(lineId);
    if (links.length === 0) {
        container.innerHTML = '<p class="ss-empty">直通設定はありません。</p>';
        return;
    }
    const isDss = isCurrentStatusDss();
    links.forEach((link, idx) => {
        const existing = (entry.through_services || []).find(ts => ts.line_id === link.lineId) || { line_id: link.lineId, state: 'none', target: link.allowedTargets[0] || 'mutual', show_on_through_line: false };
        const currentState = isDss ? 'suspended' : (existing.state || 'none');
        const detailEnabled = currentState === 'suspended';
        const stateId = `ss-through-state-${idx}`;
        const targetId = `ss-through-target-${idx}`;
        const checkboxId = `ss-through-show-${idx}`;
        const html = `
            <div class="ss-through-item" data-line-id="${esc(link.lineId)}" data-targets="${esc(link.allowedTargets.join(','))}">
                <h4>${esc(getLineNameById(link.lineId) || link.lineId)}</h4>
                <label>直通状態
                    <select id="${stateId}" class="ss-through-state" onchange="onThroughServiceStateChange(this)">
                        <option value="none" ${currentState === 'none' ? 'selected' : ''}>影響なし</option>
                        <option value="suspended" ${currentState === 'suspended' ? 'selected' : ''}>直通中止</option>
                        <option value="resumed" ${currentState === 'resumed' ? 'selected' : ''}>直通再開</option>
                    </select>
                </label>
                <label>対象
                    <select id="${targetId}" class="ss-through-target" ${detailEnabled ? '' : 'disabled'}>
                        ${(() => {
                            // If this link supports mutual straight-through, enable all direction choices
                            const opts = (link.allowedTargets && link.allowedTargets.indexOf('mutual') !== -1)
                                ? ['mutual','affected_to_through','through_to_affected']
                                : link.allowedTargets;
                            return opts.map(target => `<option value="${esc(target)}" ${existing.target === target ? 'selected' : ''}>${esc(getThroughTargetLabel(target))}</option>`).join('');
                        })()}
                    </select>
                </label>
                <label><input type="checkbox" id="${checkboxId}" class="ss-through-show" ${existing.show_on_through_line && detailEnabled ? 'checked' : ''} ${detailEnabled ? '' : 'disabled'}> 直通先路線に表示</label>
            </div>`;
        container.insertAdjacentHTML('beforeend', html);
        const stateSelect = document.getElementById(stateId);
        const wrapper = stateSelect ? stateSelect.closest('.ss-through-item') : null;
        if (stateSelect && isDss) {
            stateSelect.value = 'suspended';
            stateSelect.disabled = true;
        }
        toggleThroughDetailControls(wrapper, stateSelect ? stateSelect.value === 'suspended' : false);
    });
}

function getThroughLinesForLine(lineId) {
    const map = new Map();
    if (!lineId) return [];
    (appData.throughServiceConfigs || []).forEach(cfg => {
        if (cfg.fromLineId !== lineId && cfg.toLineId !== lineId) return;
        const throughLineId = cfg.fromLineId === lineId ? cfg.toLineId : cfg.fromLineId;
        if (!throughLineId) return;
        if (!map.has(throughLineId)) {
            map.set(throughLineId, { lineId: throughLineId, allowedTargets: new Set() });
        }
        const info = map.get(throughLineId);
        if (cfg.fromLineId === lineId) info.allowedTargets.add('affected_to_through');
        if (cfg.toLineId === lineId) info.allowedTargets.add('through_to_affected');
        if (cfg.isBidirectional) info.allowedTargets.add('mutual');
    });
    return Array.from(map.values()).map(item => {
        if (item.allowedTargets.size === 0) item.allowedTargets.add('mutual');
        return { lineId: item.lineId, allowedTargets: Array.from(item.allowedTargets) };
    });
}

function getThroughTargetLabel(target) {
    switch (target) {
        case 'affected_to_through': return '影響路線→直通先';
        case 'through_to_affected': return '直通先→影響路線';
        default: return '相互';
    }
}

function toggleThroughDetailControls(wrapper, enable) {
    if (!wrapper) return;
    const targetSelect = wrapper.querySelector('.ss-through-target');
    const showCheckbox = wrapper.querySelector('.ss-through-show');
    if (targetSelect) {
        targetSelect.disabled = !enable;
    }
    if (showCheckbox) {
        showCheckbox.disabled = !enable;
        if (!enable) {
            showCheckbox.checked = false;
        }
    }
}

function onThroughServiceStateChange(selectEl) {
    if (!selectEl) return;
    const wrapper = selectEl.closest('.ss-through-item');
    if (!wrapper) return;
    if (isCurrentStatusDss()) {
        selectEl.value = 'suspended';
        toggleThroughDetailControls(wrapper, true);
        return;
    }
    toggleThroughDetailControls(wrapper, selectEl.value === 'suspended');
}

function buildServiceStatusFromForm(baseEntry) {
    const entry = JSON.parse(JSON.stringify(baseEntry || createEmptyServiceStatus()));
    entry.affected_line_id = document.getElementById('ss-line').value;
    entry.occurrence = {
        year: toOptionalInt(document.getElementById('ss-occ-year').value),
        month: toOptionalInt(document.getElementById('ss-occ-month').value),
        day: toOptionalInt(document.getElementById('ss-occ-day').value),
        hour: toOptionalInt(document.getElementById('ss-occ-hour').value),
        minute: toOptionalInt(document.getElementById('ss-occ-minute').value),
        timezone: 'Asia/Tokyo'
    };
    entry.affected_segment = {
        is_full_line: false,
        start_station_id: document.getElementById('ss-segment-start').value || null,
        end_station_id: document.getElementById('ss-segment-end').value || null
    };
    const lineStations = getStationsForLine(entry.affected_line_id);
    const firstId = lineStations[0]?.id || null;
    const lastId = lineStations[lineStations.length - 1]?.id || null;
    if (entry.affected_segment.start_station_id === firstId && entry.affected_segment.end_station_id === lastId) {
        entry.affected_segment.is_full_line = true;
        entry.affected_segment.start_station_id = null;
        entry.affected_segment.end_station_id = null;
    }
    entry.direction = {
        up: document.getElementById('ss-dir-up').checked,
        down: document.getElementById('ss-dir-down').checked
    };
    entry.notice_types_all = document.getElementById('ss-notice-all').checked;
    if (entry.notice_types_all) {
        entry.notice_types = [];
    } else {
        entry.notice_types = getNoticeTypeSelectionsFromForm();
    }
    const statusCode = document.getElementById('ss-status-code').value;
    const template = getStatusTemplateByCode(statusCode);
    const statusId = (statusCode === 'notice' || statusCode === 'other') ? statusCode : (template?.status_id || statusCode);
    entry.status = {
        code: statusCode,
        status_id: statusId,
        heading: document.getElementById('ss-status-heading').value.trim(),
        body: document.getElementById('ss-status-body').value.trim()
    };
    const causeLineInfo = getSelectedCauseLineInfo();
    entry.cause = {
        code: document.getElementById('ss-cause-code').value,
        heading: document.getElementById('ss-cause-heading').value.trim() || null,
        body: document.getElementById('ss-cause-body').value.trim() || null,
        cause_line_option: causeLineInfo.option,
        cause_line_id: causeLineInfo.option === 'line' ? (causeLineInfo.lineId || null) : (causeLineInfo.option === 'affected' ? (entry.affected_line_id || null) : null),
        cause_segment: {
            start_station_id: document.getElementById('ss-cause-segment-start').value || null,
            end_station_id: document.getElementById('ss-cause-segment-end').value || null
        }
    };
    entry.turnback = {
        start: document.getElementById('ss-turnback-start').checked,
        end: document.getElementById('ss-turnback-end').checked
    };
    entry.through_services = collectThroughServicesFromForm(isCurrentStatusDss());
    entry.preview = entry.preview || { editable: false, custom_text: null };
    entry.preview.editable = document.getElementById('ss-preview-editable').checked;
    entry.published = document.getElementById('ss-published').checked;
    if (entry.preview.editable) {
        entry.preview.custom_text = document.getElementById('ss-preview-custom').value || '';
        entry.published_text = entry.preview.custom_text || '';
    } else {
        entry.preview.custom_text = null;
    }
    return entry;
}

function toOptionalInt(value) {
    if (value === '' || value === null || value === undefined) return null;
    const num = parseInt(value, 10);
    return isNaN(num) ? null : num;
}

function collectThroughServicesFromForm(forceSuspended) {
    const container = document.getElementById('ss-through-services');
    if (!container) return [];
    const items = container.querySelectorAll('.ss-through-item');
    const results = [];
    items.forEach(item => {
        const lineId = item.dataset.lineId;
        if (!lineId) return;
        const stateSelect = item.querySelector('select[id^="ss-through-state-"]');
        const targetSelect = item.querySelector('select[id^="ss-through-target-"]');
        const showCheckbox = item.querySelector('input[type="checkbox"]');
        const state = forceSuspended ? 'suspended' : (stateSelect ? stateSelect.value : 'none');
        const target = targetSelect ? targetSelect.value : 'mutual';
        results.push({
            line_id: lineId,
            state,
            target,
            show_on_through_line: (showCheckbox && !showCheckbox.disabled) ? showCheckbox.checked : false
        });
    });
    return results;
}

function getCauseByCode(code) {
    if (!code) return null;
    return (appData.serviceStatusCauses || []).find(c => c.code === code) || null;
}

function buildNoticeTypeList(entry) {
    if (!entry || entry.notice_types_all) return '';
    const labels = (entry.notice_types || []).map(code => getNoticeLabelByCode(code, entry.affected_line_id)).filter(Boolean);
    if (!labels.length) return '';
    return `${joinWithAnd(labels)}列車が`;
}

function buildSegmentText(entry, lineName) {
    // If full line is selected, return empty string (do not display "全線の")
    if (!entry || entry.affected_segment?.is_full_line) return '';
    const startName = getStationNameById(entry.affected_segment?.start_station_id) || '';
    const endName = getStationNameById(entry.affected_segment?.end_station_id) || '';
    if (startName && endName) return `${startName}駅～${endName}駅間`;
    return `${lineName || ''}内`; 
}

function buildDirectionText(entry) {
    if (!entry || (!entry.direction?.up && !entry.direction?.down)) return '';
    // If both directions are selected, do not display direction text
    if (entry.direction.up && entry.direction.down) return '';
    if (entry.direction.up) return '上り線で';
    if (entry.direction.down) return '下り線で';
    return '';
}

function buildTurnbackText(entry) {
    if (!entry) return '';
    let startId = entry.affected_segment?.start_station_id;
    let endId = entry.affected_segment?.end_station_id;
    if (entry.affected_segment?.is_full_line) {
        const stations = getStationsForLine(entry.affected_line_id);
        startId = stations[0]?.id;
        endId = stations[stations.length - 1]?.id;
    }
    const startName = getStationNameById(startId) || '';
    const endName = getStationNameById(endId) || '';
    const start = entry.turnback?.start;
    const end = entry.turnback?.end;
    if (start && end && startName && endName) {
        return `${startName}駅および${endName}駅で折り返し運転を行っています。`;
    }
    if (start && startName) return `${startName}駅で折り返し運転を行っています。`;
    if (end && endName) return `${endName}駅で折り返し運転を行っています。`;
    return '';
}

function buildOccurrenceText(occ) {
    if (!occ || !occ.month || !occ.day) return '';
    if (occ.hour !== null && occ.hour !== undefined && occ.minute !== null && occ.minute !== undefined) {
        return `${occ.month}月${occ.day}日${occ.hour}時${String(occ.minute).padStart(2, '0')}分ごろ、`;
    }
    return `${occ.month}月${occ.day}日、`;
}

function buildCauseText(entry) {
    const cause = entry.cause || {};
    const config = getCauseByCode(cause.code);
    const body = cause.body || config?.body || '';
    if (!body) return '';
    if (cause.cause_line_option === 'hidden') {
        return `${body}、`;
    }
    let lineName = '';
    if (cause.cause_line_option === 'line') {
        lineName = getLineNameById(cause.cause_line_id) || cause.cause_line_id || '';
    } else {
        lineName = getLineNameById(entry.affected_line_id) || entry.affected_line_id || '';
    }
    if (!lineName) lineName = '当該路線';
    const startName = getStationNameById(cause.cause_segment?.start_station_id) || '';
    const endName = getStationNameById(cause.cause_segment?.end_station_id) || '';
    if (startName && endName) {
        return `${lineName}：${startName}駅～${endName}駅間で${body}、`;
    }
    if (startName) {
        return `${lineName}：${startName}駅で${body}、`;
    }
    return `${lineName}で${body}、`;
}

function buildThroughServicesText(entry, isDss) {
    const list = Array.isArray(entry.through_services) ? entry.through_services : [];
    const suspended = list.filter(ts => ts.state === 'suspended');
    const resumed = list.filter(ts => ts.state === 'resumed');
    const sentences = [];
    const suspendedSentence = formatThroughStateSentence(suspended, '中止しています');
    if (suspendedSentence) {
        sentences.push(suspendedSentence);
    } else if (isDss) {
        sentences.push('直通運転を中止しています。');
    }
    if (!isDss) {
        const resumedSentence = formatThroughStateSentence(resumed, '再開しました');
        if (resumedSentence) {
            sentences.push(resumedSentence);
        }
    }
    return sentences.join('');
}

function formatThroughStateSentence(items, verb) {
    if (!items || !items.length) return '';
    const fragments = buildThroughFragments(items);
    if (!fragments.length) return '';
    return `${fragments.join('、')}を${verb}。`;
}

function buildThroughFragments(items) {
    const order = ['mutual', 'affected_to_through', 'through_to_affected'];
    const grouped = new Map();
    items.forEach(ts => {
        const key = ts.target || 'mutual';
        const label = getLineNameById(ts.line_id) || ts.line_id || '';
        if (!label) return;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(label);
    });
    const fragments = [];
    const appendFragment = (key, names) => {
        if (!names || !names.length) return;
        const joined = joinWithAnd(names);
        if (!joined) return;
        if (key === 'mutual') {
            fragments.push(`${joined}との直通運転`);
        } else if (key === 'affected_to_through') {
            fragments.push(`${joined}への直通運転`);
        } else if (key === 'through_to_affected') {
            fragments.push(`${joined}からの直通運転`);
        } else {
            fragments.push(`${joined}との直通運転`);
        }
    };
    order.forEach(key => appendFragment(key, grouped.get(key)));
    grouped.forEach((names, key) => {
        if (!order.includes(key)) {
            appendFragment(key, names);
        }
    });
    return fragments;
}

function joinWithAnd(items) {
    if (!items || items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]}および${items[1]}`;
    return `${items.slice(0, -1).join('、')}、および${items[items.length - 1]}`;
}

function generateServiceStatusText(entry) {
    const lineName = getLineNameById(entry.affected_line_id) || entry.affected_line_id || '';
    const causeHeading = entry.cause?.heading || getCauseByCode(entry.cause?.code)?.heading || '';
    const statusHeading = entry.status.heading || getStatusLabel(entry.status.code);
    const heading = `【${lineName}】${causeHeading ? `${causeHeading}　` : ''}${statusHeading}`;
    const occurrence = buildOccurrenceText(entry.occurrence);
    const causeText = buildCauseText(entry);
    let body = '';
    if (entry.status.status_id === 'DSS') {
        body = buildThroughServicesText(entry, true);
    } else {
        const subject = buildNoticeTypeList(entry); // empty when "全て" is selected
        const segment = buildSegmentText(entry, lineName); // empty when full line
        const direction = buildDirectionText(entry); // empty when both directions
        const bothDirectionsSelected = !!(entry.direction && entry.direction.up && entry.direction.down);
        const statusBody = entry.status.body || '';
        const fallbackBody = statusHeading || '影響が発生しています';
        const trimmedBodyRaw = statusBody.endsWith('。') ? statusBody.slice(0, -1) : statusBody;
        const trimmedBody = trimmedBodyRaw || fallbackBody;
        // Build prefix only from non-empty parts. Use appropriate particles.
        let prefix = '';
        if (subject) prefix += subject;
        if (segment) prefix += bothDirectionsSelected ? `${segment}で` : `${segment}の`;
        if (direction) prefix += direction;
        if (prefix) {
            body = `${prefix}${trimmedBody}。`;
        } else {
            // If nothing to prefix (all-general case), output only the main sentence
            body = `${trimmedBody}。`;
        }
    }
    const turnback = buildTurnbackText(entry);
    const through = entry.status.status_id === 'DSS' ? '' : buildThroughServicesText(entry, false);
    const composed = `${occurrence}${causeText}${body}${turnback}${through}`.replace(/\s+/g, ' ').trim();
    return {
        heading: heading.trim(),
        body: composed
    };
}

function regenerateCurrentServiceStatusPreview() {
    const base = getCurrentServiceStatus();
    if (!base) return;
    const entry = buildServiceStatusFromForm(base);
    if (!entry.occurrence.year) {
        entry.occurrence.year = new Date().getFullYear();
    }
    const generated = generateServiceStatusText(entry);
    entry.generated_text = generated;
    if (!entry.preview.editable) {
        entry.published_text = `${generated.heading}\n${generated.body}`;
    }
    document.getElementById('ss-preview-heading').value = generated.heading;
    document.getElementById('ss-preview-body').value = generated.body;
}

function onServiceStatusPreviewEditableToggle(skipValueReset) {
    const editable = document.getElementById('ss-preview-editable').checked;
    const autoBody = document.getElementById('ss-preview-body');
    const customBody = document.getElementById('ss-preview-custom');
    const heading = document.getElementById('ss-preview-heading');
    if (editable) {
        autoBody.setAttribute('readonly', 'readonly');
        autoBody.classList.add('hidden');
        customBody.classList.remove('hidden');
        customBody.removeAttribute('readonly');
        // when editing is enabled, ensure heading remains read-only (heading is derived)
        if (heading) heading.removeAttribute('readonly');
        if (!skipValueReset && !customBody.value) {
            customBody.value = autoBody.value;
        }
    } else {
        // when editing is disabled, keep preview fields read-only and hide custom editor
        autoBody.setAttribute('readonly', 'readonly');
        autoBody.classList.remove('hidden');
        customBody.classList.add('hidden');
        customBody.value = skipValueReset ? customBody.value : '';
        if (heading) heading.setAttribute('readonly', 'readonly');
    }
}

// Check whether all required service-status inputs are filled
function areRequiredServiceStatusFieldsFilled(entry) {
    if (!entry) return false;
    // Mirror the same basic validation as `saveServiceStatus` but return boolean
    if (!entry.affected_line_id) return false;
    if (!entry.occurrence.month || !entry.occurrence.day) return false;
    if (!entry.affected_segment.is_full_line && (!entry.affected_segment.start_station_id || !entry.affected_segment.end_station_id)) return false;
    if (!entry.direction.up && !entry.direction.down) return false;
    if (!entry.status.code) return false;
    if (!entry.notice_types_all && (!entry.notice_types || entry.notice_types.length === 0)) return false;
    if (!entry.cause.code) return false;
    if (entry.cause.code === 'other' && (!entry.cause.heading || !entry.cause.body)) return false;
    if (entry.cause.cause_line_option === 'line' && !entry.cause.cause_line_id) return false;
    return true;
}

// Debounce helper
function debounce(fn, wait) {
    let t = null;
    return function () {
        const args = arguments;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
    };
}

// Attach event listeners to service-status editor to auto-generate preview
function setupServiceStatusAutoPreview() {
    const editor = document.getElementById('service-status-editor');
    if (!editor) return;
    const handler = debounce(() => {
        const base = getCurrentServiceStatus();
        if (!base) return;
        const entry = buildServiceStatusFromForm(base);
        if (areRequiredServiceStatusFieldsFilled(entry)) {
            regenerateCurrentServiceStatusPreview();
        } else {
            // clear preview fields when incomplete
            const h = document.getElementById('ss-preview-heading');
            const b = document.getElementById('ss-preview-body');
            if (h) h.value = '';
            if (b) b.value = '';
        }
    }, 250);

    // Listen for input/change inside the editor
    editor.addEventListener('input', handler);
    editor.addEventListener('change', handler);

    // Also ensure toggle changes update UI correctly
    const editableCheckbox = document.getElementById('ss-preview-editable');
    if (editableCheckbox) editableCheckbox.addEventListener('change', () => onServiceStatusPreviewEditableToggle(false));
}

function saveServiceStatus() {
    if (_currentServiceStatusIndex === null) return;
    const base = appData.serviceStatuses[_currentServiceStatusIndex];
    const entry = buildServiceStatusFromForm(base);
    // Basic validation
    if (!entry.affected_line_id) {
        alert('影響路線を選択してください');
        return;
    }
    if (!entry.occurrence.month || !entry.occurrence.day) {
        alert('発生日時の月・日を入力してください');
        return;
    }
    if (!entry.affected_segment.is_full_line && (!entry.affected_segment.start_station_id || !entry.affected_segment.end_station_id)) {
        alert('影響区間の始点・終点を選択してください');
        return;
    }
    if (!entry.direction.up && !entry.direction.down) {
        alert('方向（上り・下り）のいずれかを選択してください');
        return;
    }
    if (!entry.status.code) {
        alert('状態を選択してください');
        return;
    }
    if (!entry.notice_types_all && entry.notice_types.length === 0) {
        alert('影響案内種別を少なくとも1つ選択するか「全て」を選択してください');
        return;
    }
    if (!entry.cause.code) {
        alert('原因を選択してください');
        return;
    }
    if (entry.cause.code === 'other' && (!entry.cause.heading || !entry.cause.body)) {
        alert('原因見出しと原因本文を入力してください');
        return;
    }
    if (entry.cause.cause_line_option === 'line' && !entry.cause.cause_line_id) {
        alert('原因路線を選択してください');
        return;
    }
    if (!entry.occurrence.year) {
        entry.occurrence.year = new Date().getFullYear();
        document.getElementById('ss-occ-year').value = entry.occurrence.year;
    }
    const generated = generateServiceStatusText(entry);
    entry.generated_text = generated;
    if (!entry.preview.editable) {
        document.getElementById('ss-preview-heading').value = generated.heading;
        document.getElementById('ss-preview-body').value = generated.body;
        entry.published_text = `${generated.heading}\n${generated.body}`;
    } else {
        entry.published_text = document.getElementById('ss-preview-custom').value || '';
    }
    const now = new Date().toISOString();
    entry.updated_at = now;
    if (!base.id) {
        entry.id = generateUuid();
        entry.created_at = now;
        entry.version = 1;
        entry.history = [];
    } else {
        const snapshot = JSON.parse(JSON.stringify(base));
        entry.id = base.id;
        entry.created_at = base.created_at || now;
        entry.version = (base.version || 1) + 1;
        entry.history = Array.isArray(base.history) ? [...base.history] : [];
        entry.history.push({ version: base.version || 1, changed_at: now, changed_by: null, snapshot });
    }
    appData.serviceStatuses[_currentServiceStatusIndex] = entry;
    if (appData.serviceStatusMeta) {
        appData.serviceStatusMeta.generated_at = now;
    }
    // Synchronize generated "show on through line" statuses linked to this source
    try {
        syncGeneratedThroughStatusesForSource(entry);
    } catch (e) { console.error('syncGeneratedThroughStatusesForSource failed', e); }
    renderServiceStatuses();
    openServiceStatusEditor(_currentServiceStatusIndex);
}

// Synchronize generated service-status entries created by "直通先路線に表示" (ss-through-show)
function syncGeneratedThroughStatusesForSource(sourceEntry) {
    if (!sourceEntry || !sourceEntry.id) return;
    const now = new Date().toISOString();
    const desiredLines = new Set((sourceEntry.through_services || []).filter(ts => ts.show_on_through_line).map(ts => ts.line_id).filter(Boolean));

    // Map existing generated entries from this source by affected_line_id
    const existingMap = new Map();
    appData.serviceStatuses.forEach((s, idx) => {
        if (s && s.generated_from && s.generated_from.source_id === sourceEntry.id) {
            existingMap.set(s.affected_line_id, {entry: s, index: idx});
        }
    });

    // Remove generated entries that are no longer desired
    const toRemoveIndices = [];
    existingMap.forEach((val, lineId) => {
        if (!desiredLines.has(lineId)) {
            toRemoveIndices.push(val.index);
        }
    });
    // Remove in descending order to keep indices valid
    toRemoveIndices.sort((a,b) => b - a).forEach(i => {
        appData.serviceStatuses.splice(i, 1);
    });

    // Rebuild existingMap after removals
    const updatedExisting = new Map();
    appData.serviceStatuses.forEach((s, idx) => {
        if (s && s.generated_from && s.generated_from.source_id === sourceEntry.id) {
            updatedExisting.set(s.affected_line_id, {entry: s, index: idx});
        }
    });

    // For each desired line, update existing generated entry or create new one
    desiredLines.forEach(lineId => {
        const existing = updatedExisting.get(lineId);
        const clone = JSON.parse(JSON.stringify(sourceEntry));
        // Ensure generated entry targets the through line
        clone.affected_line_id = lineId;
        // Set affected segment to full line
        clone.affected_segment = { is_full_line: true, start_station_id: null, end_station_id: null };
        // Set direction to both
        clone.direction = { up: true, down: true };
        // Set notice types to all
        clone.notice_types_all = true;
        clone.notice_types = [];
        // Set status to直通運転中止 (use template if available)
        const tpl = getStatusTemplateByCode('DSS_STOP') || { status_id: 'DSS', heading: '直通運転中止', body: '直通運転を中止しています' };
        clone.status = { code: 'DSS_STOP', status_id: tpl.status_id || 'DSS', heading: tpl.heading || '直通運転中止', body: tpl.body || '直通運転を中止しています' };
        // Use original cause but mark cause_line as the source line
        const srcCause = sourceEntry.cause || {};
        clone.cause = JSON.parse(JSON.stringify(srcCause));
        clone.cause.cause_line_option = 'line';
        clone.cause.cause_line_id = sourceEntry.affected_line_id || null;
        clone.cause.cause_segment = (sourceEntry.cause && sourceEntry.cause.cause_segment) ? JSON.parse(JSON.stringify(sourceEntry.cause.cause_segment)) : { start_station_id: null, end_station_id: null };
        // Build through_services for generated entry: inverse the direction relative to source
        const srcTs = (sourceEntry.through_services || []).find(t => t.line_id === lineId) || null;
        const invertTarget = (t) => {
            if (t === 'affected_to_through') return 'through_to_affected';
            if (t === 'through_to_affected') return 'affected_to_through';
            return t || 'mutual';
        };
        const genTarget = invertTarget(srcTs ? srcTs.target : 'mutual');
        const genState = srcTs ? srcTs.state : 'suspended';
        clone.through_services = [{ line_id: sourceEntry.affected_line_id || '', state: genState, target: genTarget, show_on_through_line: false }];
        // Generated entries must be non-editable
        clone.preview = clone.preview || { editable: false, custom_text: null };
        clone.preview.editable = false;
        // Ensure turnback flags are unset for generated entries
        clone.turnback = { start: false, end: false };
        // Mark metadata linking back to source
        clone.generated_from = { source_id: sourceEntry.id, source_line_id: sourceEntry.affected_line_id, type: 'through-show', source_version: sourceEntry.version || 1 };
        // Clean history for generated copy
        clone.history = clone.history || [];
        // Update timestamps and id/version if creating
        if (existing) {
            // Preserve created_at and id; increment version
            clone.id = existing.entry.id;
            clone.created_at = existing.entry.created_at || now;
            clone.version = (existing.entry.version || 1) + 1;
            clone.updated_at = now;
            // Regenerate generated_text/published_text
            const gen = generateServiceStatusText(clone);
            clone.generated_text = gen;
            if (!clone.preview.editable) clone.published_text = `${gen.heading}\n${gen.body}`;
            appData.serviceStatuses[existing.index] = clone;
        } else {
            // New generated entry
            clone.id = generateUuid();
            clone.created_at = now;
            clone.updated_at = now;
            clone.version = 1;
            const gen = generateServiceStatusText(clone);
            clone.generated_text = gen;
            if (!clone.preview.editable) clone.published_text = `${gen.heading}\n${gen.body}`;
            appData.serviceStatuses.push(clone);
        }
    });
}

function deleteServiceStatus(index) {
    showInlineDeleteConfirm('service-statuses-tbody', index, `performDeleteServiceStatus(${index})`);
}

function deleteCurrentServiceStatus() {
    if (_currentServiceStatusIndex === null) return;
    deleteServiceStatus(_currentServiceStatusIndex);
}

function performDeleteServiceStatus(index) {
    appData.serviceStatuses.splice(index, 1);
    closeServiceStatusEditor();
    renderServiceStatuses();
}

// エクスポート/インポート
async function exportData() {
    // Before saving, ensure there are no red-highlighted invalid cells.
    try {
        updateSaveWarningVisibility();
        if (hasInvalidHighlights()) {
            // Do not proceed with save when invalid parts exist.
            return;
        }
    } catch (e) { /* continue anyway */ }

    appData.meta.lastUpdated = new Date().toISOString().split('T')[0];
    
    // エクスポート用にデータをクリーンアップ
    const exportData = cleanDataForExport(appData);

    const workerSaveResult = await saveToWorkerSource(exportData);
    if (workerSaveResult.attempted) {
        if (workerSaveResult.saved) {
            alert('外部正本（Cloudflare Workers）に保存しました。');
            updateServerStatus(true, 'worker');
            try {
                _lastSavedJson = JSON.stringify(exportData);
            } catch (e) { _lastSavedJson = null; }
            checkUnsavedChanges();
            return;
        }

        if (workerSaveResult.blockedByAuth) {
            updateServerStatus(false, 'worker');
            alert('保存には認証が必要です。ユーザーIDとパスワードを入力して再実行してください。');
            return;
        }

        if (workerSaveResult.error) {
            console.log('Workers保存失敗、従来保存へフォールバック: ' + workerSaveResult.error);
        }
    }
    
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
            updateServerStatus(true, 'local-server');
            try {
                _lastSavedJson = JSON.stringify(exportData);
            } catch (e) { _lastSavedJson = null; }
            checkUnsavedChanges();
            return;
        }
    } catch (error) {
        console.log('サーバー保存失敗、ダウンロードします');
        updateServerStatus(false, 'offline');
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
    try { _lastSavedJson = JSON.stringify(exportData); } catch (e) { _lastSavedJson = null; }
    checkUnsavedChanges();
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
            ensureServiceStatusConfig(appData);
                try {
                    _lastSavedJson = JSON.stringify(cleanDataForExport(appData));
                } catch (e) { _lastSavedJson = JSON.stringify(appData); }
                checkUnsavedChanges();
            
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
                    updateServerStatus(true, 'local-server');
                } else {
                    alert('データを読み込みました（サーバー保存失敗）');
                    updateServerStatus(false, 'offline');
                }
            } catch (err) {
                alert('データを読み込みました（ローカルモード）');
                updateServerStatus(false, 'offline');
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