// ========================================
// 路線・運行情報ページ用スクリプト
// ========================================
let opData = null;
let opCompanyMap = null;
let opLineMap = null;
let opStationMap = null;
let opStationLinesMap = null; // stationId -> Set<lineId>
let opStatusByLine = null;    // lineId -> latest serviceStatus
let _prevMobileActiveTarget = null;

// データ読み込み
async function loadOperationData() {
    try {
        hideError();
        showLoading();

        const res = await fetch('data.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('運行情報データの取得に失敗しました');
        opData = await res.json();
        buildOperationIndexes();
        renderLineListView();
    } catch (err) {
        console.error(err);
        showError('運行情報の取得に失敗しました。時間をおいて再度お試しください。');
    } finally {
        hideLoading();
    }
}

function buildOperationIndexes() {
    opCompanyMap = new Map();
    opData.companies.forEach(c => opCompanyMap.set(c.companyId, c));

    opLineMap = new Map();
    opData.lines.forEach(l => opLineMap.set(l.lineId, l));

    opStationMap = new Map();
    opData.stations.forEach(s => opStationMap.set(s.stationId, s));

    // stationId -> set of lineIds
    opStationLinesMap = new Map();
    opData.lines.forEach(line => {
        (line.stationOrder || []).forEach(stId => {
            if (!opStationLinesMap.has(stId)) opStationLinesMap.set(stId, new Set());
            opStationLinesMap.get(stId).add(line.lineId);
        });
    });

    // lineId -> 最新の serviceStatus（updated_at の降順）
    opStatusByLine = new Map();
    if (Array.isArray(opData.serviceStatuses)) {
        opData.serviceStatuses.forEach(st => {
            const key = st.affected_line_id;
            if (!key) return;
            const existing = opStatusByLine.get(key);
            if (!existing) {
                opStatusByLine.set(key, st);
            } else {
                if (new Date(st.updated_at) > new Date(existing.updated_at)) {
                    opStatusByLine.set(key, st);
                }
            }
        });
    }
}

// ステータス判定
function getLineStatusSummary(lineId) {
    const st = opStatusByLine.get(lineId);
    if (!st) {
        return {
            level: 'normal',
            icon: 'circle',
            heading: '平常運転',
            subLines: []
        };
    }

    const heading = st.status?.heading || 'お知らせあり';
    const code = st.status?.code || '';
    const statusId = st.status?.status_id || '';

    const isSuspend =
        statusId === 'OfS' ||
        /SUSPEND/i.test(code) ||
        (heading && heading.includes('運転見合わせ'));

    const level = isSuspend ? 'suspend' : 'warning';
    const icon = isSuspend ? 'cross' : 'warning';

    const subLines = [];
    if (st.affected_segment && !st.affected_segment.is_full_line) {
        const sId = st.affected_segment.start_station_id;
        const eId = st.affected_segment.end_station_id;
        const sName = sId && opStationMap.get(sId) ? opStationMap.get(sId).stationName : '一部区間';
        const eName = eId && opStationMap.get(eId) ? opStationMap.get(eId).stationName : '';
        if (sName && eName) {
            subLines.push(`区間：${sName} から ${eName} まで`);
        }
    }
    if (st.cause) {
        const causeHeading = st.cause.heading || st.cause.label;
        if (causeHeading) {
            subLines.push(`事由：${causeHeading}`);
        }
    }

    return {
        level,
        icon,
        heading,
        subLines
    };
}

// 路線一覧ビュー描画（会社から探す）
function renderLineListView() {
    const container = document.getElementById('line-list-view');
    if (!container || !opData) return;
    container.innerHTML = '';

    const ownCompanyId = opData.meta?.ownCompanyId || 'KT';
    const mainCompanies = [ownCompanyId, 'HRA'];

    mainCompanies.forEach(companyId => {
        const company = opCompanyMap.get(companyId);
        if (!company) return;

        const lines = opData.lines.filter(l => l.companyId === companyId && (l.stationOrder || []).length > 0);
        if (lines.length === 0) return;

        const section = document.createElement('section');
        section.className = 'line-section';

        const title = document.createElement('h2');
        title.className = 'line-section-title';
        title.textContent = company.companyName;
        section.appendChild(title);

        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'line-cards';

        lines.forEach(line => {
            const status = getLineStatusSummary(line.lineId);
            const card = document.createElement('article');
            card.className = 'line-card';
            card.dataset.lineId = line.lineId;

            if (status.level === 'suspend') card.classList.add('line-card--suspend');
            if (status.level === 'warning') card.classList.add('line-card--warning');

            // アイコン：路線色＋略称（1〜2文字）
            const iconContent = document.createElement('div');
            iconContent.className = 'line-icon';
            iconContent.style.backgroundColor = line.lineColor || 'var(--primary-color)';
            iconContent.textContent = line.lineName.replace(/線.*/, '線').slice(0, 2);

            const textWrap = document.createElement('div');
            textWrap.className = 'line-text';

            const nameEl = document.createElement('div');
            nameEl.className = 'line-name';
            nameEl.textContent = line.lineName;

            const statusRow = document.createElement('div');
            statusRow.className = 'line-status-row';

            let iconEl;
            if (status.icon === 'circle') {
                iconEl = document.createElement('span');
                iconEl.className = 'status-icon-circle';
            } else if (status.icon === 'cross') {
                iconEl = document.createElement('span');
                iconEl.className = 'status-icon-cross';
                iconEl.textContent = '×';
            } else {
                iconEl = document.createElement('span');
                iconEl.className = 'status-icon-warning';
            }

            const statusText = document.createElement('span');
            statusText.className = 'line-status-text';
            statusText.textContent = status.heading;

            statusRow.appendChild(iconEl);
            statusRow.appendChild(statusText);

            textWrap.appendChild(nameEl);
            textWrap.appendChild(statusRow);

            if (status.subLines && status.subLines.length > 0) {
                const sub = document.createElement('div');
                sub.className = 'line-status-sub';
                sub.innerHTML = status.subLines.map(s => `<div>${s}</div>`).join('');
                textWrap.appendChild(sub);
            }

            const main = document.createElement('div');
            main.className = 'line-card-main';
            main.appendChild(iconContent);
            main.appendChild(textWrap);

            const chevron = document.createElement('div');
            chevron.className = 'line-card-chevron';
            chevron.textContent = '＞';

            card.appendChild(main);
            card.appendChild(chevron);

            card.addEventListener('click', () => {
                showLineDetail(line.lineId);
            });

            cardsWrap.appendChild(card);
        });

        section.appendChild(cardsWrap);
        container.appendChild(section);
    });
}

// 詳細ビュー表示
function showLineDetail(lineId) {
    const line = opLineMap.get(lineId);
    if (!line) return;

    const listView = document.getElementById('operation-section');
    const detailView = document.getElementById('line-detail-view');

    listView.style.display = 'none';
    detailView.style.display = 'block';
    detailView.setAttribute('aria-hidden', 'false');

    const icon = document.getElementById('line-detail-icon');
    const nameEl = document.getElementById('line-detail-name');

    icon.style.backgroundColor = line.lineColor || 'var(--primary-color)';
    icon.textContent = line.lineName.replace(/線.*/, '線').slice(0, 2);
    nameEl.textContent = line.lineName;

    renderLineAlertBox(lineId);
    renderLineDiagram(lineId);
}

function hideLineDetail() {
    const listView = document.getElementById('operation-section');
    const detailView = document.getElementById('line-detail-view');
    detailView.style.display = 'none';
    detailView.setAttribute('aria-hidden', 'true');
    listView.style.display = 'block';
}

// アラート枠
function renderLineAlertBox(lineId) {
    const box = document.getElementById('line-alert-box');
    box.innerHTML = '';

    const st = opStatusByLine.get(lineId);
    if (!st) {
        box.classList.add('alert-normal');
        const inner = document.createElement('div');
        inner.className = 'alert-body';
        const metaTime = opData.serviceStatusMeta?.generated_at;
        const timeText = metaTime ? formatJaDateTime(metaTime) : null;
        inner.textContent = timeText
            ? `現在、この路線に掲載中の運行情報はありません。平常運転です。（${timeText} 時点）`
            : '現在、この路線に掲載中の運行情報はありません。平常運転です。';
        box.appendChild(inner);
        return;
    }

    box.classList.remove('alert-normal');

    const header = document.createElement('div');
    header.className = 'alert-header';

    const main = document.createElement('div');
    main.className = 'alert-main';

    const icon = document.createElement('span');
    icon.className = 'alert-icon-cross';
    icon.textContent = '×';

    const title = document.createElement('span');
    title.className = 'alert-title';
    title.textContent = st.status?.heading || '運行情報';

    main.appendChild(icon);
    main.appendChild(title);

    const updated = document.createElement('span');
    updated.className = 'alert-updated';
    updated.textContent = st.updated_at ? `${formatJaDateTime(st.updated_at)} 更新` : '';

    header.appendChild(main);
    header.appendChild(updated);

    const body = document.createElement('div');
    body.className = 'alert-body';
    body.textContent = st.generated_text?.body || st.published_text || st.status?.body || '';

    box.appendChild(header);
    box.appendChild(body);
}

// 路線図＋駅リスト
function renderLineDiagram(lineId) {
    const line = opLineMap.get(lineId);
    if (!line) return;

    const labelsEl = document.getElementById('service-labels');
    const diagramEl = document.getElementById('line-diagram');
    const stationListEl = document.getElementById('station-list');

    labelsEl.innerHTML = '';
    diagramEl.innerHTML = '';
    stationListEl.innerHTML = '';

    // 種別ラベル
    if (Array.isArray(line.serviceCategories)) {
        const names = Array.from(new Set(line.serviceCategories.map(sc => sc[1])));
        names.forEach(name => {
            const span = document.createElement('span');
            span.textContent = name;
            labelsEl.appendChild(span);
        });
    }

    // この路線の区間で影響を受けている範囲
    const st = opStatusByLine.get(lineId);
    let affectedStart = null;
    let affectedEnd = null;
    if (st && st.affected_segment && !st.affected_segment.is_full_line) {
        affectedStart = st.affected_segment.start_station_id;
        affectedEnd = st.affected_segment.end_station_id;
    }

    const order = line.stationOrder || [];
    const affectedIndices = new Set();
    if (affectedStart && affectedEnd) {
        const sIdx = order.indexOf(affectedStart);
        const eIdx = order.indexOf(affectedEnd);
        if (sIdx !== -1 && eIdx !== -1) {
            const [from, to] = sIdx <= eIdx ? [sIdx, eIdx] : [eIdx, sIdx];
            for (let i = from; i <= to; i++) affectedIndices.add(i);
        }
    }

    order.forEach((stId, idx) => {
        const station = opStationMap.get(stId);
        const isAffected = affectedIndices.has(idx);

        // 左：路線図
        const row = document.createElement('div');
        row.className = 'diagram-row';

        const lineBar = document.createElement('div');
        lineBar.className = 'diagram-line';
        if (isAffected) lineBar.classList.add('affected');

        const node = document.createElement('div');
        node.className = 'diagram-node';
        if (isAffected) node.classList.add('affected');

        row.appendChild(lineBar);
        row.appendChild(node);
        diagramEl.appendChild(row);

        // 右：駅名
        const sRow = document.createElement('div');
        sRow.className = 'station-row';

        const nameMain = document.createElement('div');
        nameMain.className = 'station-name-main';
        nameMain.textContent = station ? station.stationName : stId;

        sRow.appendChild(nameMain);

        // 乗換情報
        const set = opStationLinesMap.get(stId);
        if (set && set.size > 1) {
            const others = Array.from(set)
                .filter(lid => lid !== lineId)
                .map(lid => opLineMap.get(lid)?.lineName)
                .filter(Boolean);
            if (others.length > 0) {
                const transfer = document.createElement('div');
                transfer.className = 'station-transfer';
                transfer.textContent = `乗換：${others.join('・')}`;
                sRow.appendChild(transfer);
            }
        }

        stationListEl.appendChild(sRow);
    });
}

// 日時フォーマット（2025年12月6日 20時00分）
function formatJaDateTime(isoString) {
    try {
        const d = new Date(isoString);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        const h = d.getHours();
        const mi = d.getMinutes();
        const pad = n => n.toString().padStart(2, '0');
        return `${y}年${m}月${day}日 ${pad(h)}時${pad(mi)}分`;
    } catch (e) {
        return '';
    }
}

// 検索モード（会社 / 方面）トグル
function setupOperationModeToggle() {
    const container = document.getElementById('operation-mode-toggle');
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('.mode-toggle-btn'));

    function setMode(mode) {
        buttons.forEach(btn => {
            const m = btn.dataset.mode;
            const selected = m === mode;
            btn.classList.toggle('selected', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });

        const listView = document.getElementById('line-list-view');
        const areaView = document.getElementById('area-view');
        if (mode === 'company') {
            listView.style.display = '';
            areaView.style.display = 'none';
        } else {
            listView.style.display = 'none';
            areaView.style.display = '';
        }
    }

    setMode('company');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            setMode(mode);
        });
    });
}

// Mobile nav helper
function setMobileActive(target) {
    const mbNavEl = document.getElementById('mobile-bottom-nav');
    if (!mbNavEl) return;
    const items = mbNavEl.querySelectorAll('.mb-item');
    items.forEach(it => it.classList.remove('active'));
    if (!target) return;
    const btn = mbNavEl.querySelector(`.mb-item[data-target="${target}"]`);
    if (btn) btn.classList.add('active');
}

// Bottom sheet
function openBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    const btn = document.getElementById('mb-menu-btn');
    const backdrop = document.getElementById('sheet-backdrop');
    if (!sheet) return;
    const mbNavEl = document.getElementById('mobile-bottom-nav');
    if (mbNavEl) {
        const current = mbNavEl.querySelector('.mb-item.active:not(.mb-menu)');
        if (current) {
            _prevMobileActiveTarget = current.dataset.target || null;
            current.classList.remove('active');
        }
        if (btn) btn.classList.add('active');
    }
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
    const mbNavEl = document.getElementById('mobile-bottom-nav');
    if (mbNavEl) {
        if (btn) btn.classList.remove('active');
        let toActivate = _prevMobileActiveTarget;
        if (!toActivate) {
            const activeSidebarBtn = document.querySelector('.sidebar .nav-item.active .nav-btn');
            if (activeSidebarBtn) toActivate = activeSidebarBtn.dataset.target;
        }
        if (toActivate) setMobileActive(toActivate);
        _prevMobileActiveTarget = null;
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return;
    if (sheet.classList.contains('open')) closeBottomSheet(); else openBottomSheet();
}

// 初期化
function initializeOperationUI() {
    setupOperationModeToggle();

    // Sidebar nav
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.target;
                sidebar.querySelectorAll('.nav-item').forEach(li => li.classList.remove('active'));
                const parentLi = btn.closest('.nav-item');
                if (parentLi) parentLi.classList.add('active');

                document.querySelectorAll('.mobile-bottom-nav .mb-item').forEach(b => {
                    b.classList.toggle('active', b.dataset.target === target);
                });

                closeBottomSheet();
            });
        });
    }

    const mbNav = document.getElementById('mobile-bottom-nav');
    if (mbNav) {
        mbNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.mb-item');
            if (!btn) return;
            const target = btn.dataset.target;
            if (btn.classList.contains('mb-menu')) {
                toggleBottomSheet();
                return;
            }
            setMobileActive(target);
            _prevMobileActiveTarget = target;
            document.querySelectorAll('.sidebar .nav-item').forEach(li => {
                const nb = li.querySelector('.nav-btn');
                if (nb) li.classList.toggle('active', nb.dataset.target === target);
            });
            closeBottomSheet();
        });
    }

    const activeSidebarBtn = document.querySelector('.sidebar .nav-item.active .nav-btn');
    if (activeSidebarBtn) {
        const target = activeSidebarBtn.dataset.target;
        document.querySelectorAll('.mobile-bottom-nav .mb-item').forEach(b => {
            b.classList.toggle('active', b.dataset.target === target);
        });
    }

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
                const target = it.dataset.target;
                setMobileActive(target);
                _prevMobileActiveTarget = target;
                document.querySelectorAll('.sidebar .nav-item').forEach(li => {
                    const nb = li.querySelector('.nav-btn');
                    if (nb) li.classList.toggle('active', nb.dataset.target === target);
                });
                closeBottomSheet();
            });
        });
    }
    if (backdrop) {
        backdrop.addEventListener('click', () => closeBottomSheet());
    }
    if (closeBtn) closeBtn.addEventListener('click', closeBottomSheet);

    const backBtn = document.getElementById('back-to-list-btn');
    if (backBtn) backBtn.addEventListener('click', hideLineDetail);

    // Error popup close button
    const errorCloseBtn = document.getElementById('error-close');
    if (errorCloseBtn) errorCloseBtn.addEventListener('click', hideError);

    // Help modal (transfer ページと同様の挙動)
    const helpButton = document.getElementById('help-button');
    const helpModal = document.getElementById('help-modal');
    const closeHelpBtn = document.getElementById('close-help');

    function openHelp() {
        if (!helpModal) return;
        helpModal.style.display = 'flex';
    }

    function closeHelp() {
        if (!helpModal) return;
        helpModal.style.display = 'none';
    }

    if (helpButton) helpButton.addEventListener('click', openHelp);
    if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelp);

    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                closeHelp();
            }
        });
    }
}

// ローディング表示
function showLoading() {
    const el = document.getElementById('loading-section');
    if (!el) return;
    el.style.display = 'flex';
}

function hideLoading() {
    const el = document.getElementById('loading-section');
    if (!el) return;
    el.style.display = 'none';
}

// エラー表示
function showError(message) {
    const container = document.getElementById('error-section');
    const msgEl = document.getElementById('error-message');
    if (!container || !msgEl) return;
    msgEl.textContent = message || '';
    container.style.display = 'block';
}

function hideError() {
    const container = document.getElementById('error-section');
    if (!container) return;
    container.style.display = 'none';
}

// DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
    initializeOperationUI();
    loadOperationData();
});
