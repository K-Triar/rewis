// ========================================
// 路線・運行情報ページ用スクリプト
// ========================================
let opData = null;
let opCompanyMap = null;
let opLineMap = null;
let opStationMap = null;
let opStationLinesMap = null; // stationId -> Set<lineId>
let opStatusByLine = null;    // lineId -> latest serviceStatus
let _loadingPreventHandlers = null;

function applyLineTypeIcon(el, line) {
    if (!el || !line) return;

    const trainType = (line.trainType || 'TC').toUpperCase();
    const iconPathMap = {
        TC: 'src/TC.svg',
        SX: 'src/SX.svg',
        MC: 'src/mc.svg'
    };
    const iconPath = iconPathMap[trainType] || iconPathMap.TC;

    el.textContent = '';
    el.style.backgroundColor = line.lineColor || 'var(--primary-color)';
    el.style.webkitMaskImage = `url(${iconPath})`;
    el.style.maskImage = `url(${iconPath})`;
}

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
            heading: '遅れの情報はありません',
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

            // アイコン：種別アイコンを路線色で表示
            const iconContent = document.createElement('div');
            iconContent.className = 'line-icon';
            applyLineTypeIcon(iconContent, line);

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

    applyLineTypeIcon(icon, line);
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
            ? `現在、列車の遅れなどの情報はありません。（${timeText} 時点）`
            : '現在、列車の遅れなどの情報はありません。';
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

    const lineLayoutEl = document.getElementById('line-layout');

    // 古い行をクリア
    lineLayoutEl.innerHTML = '';

    const cats = line.serviceCategories || [];

    // 1. 各種別の停車駅IDのSetを作成
    const stopsByCat = {};
    cats.forEach(c => stopsByCat[c[0]] = new Set());

    // 2. セグメントから停車駅を推測収集
    opData.segments.forEach(seg => {
        if (seg.lineId !== lineId) return;
        const prefix = `SGM-${lineId}-`;
        const suffix = `-${seg.fromStationId}-${seg.toStationId}`;
        if (seg.segmentId.startsWith(prefix) && seg.segmentId.endsWith(suffix)) {
            const rawServiceId = seg.segmentId.substring(prefix.length, seg.segmentId.length - suffix.length);
            let matchedCat = null;
            for (const cat of cats) {
                if (rawServiceId === cat[0] ||
                    rawServiceId.startsWith(cat[0] + '-') ||
                    cat[0].startsWith(rawServiceId + '-') ||
                    rawServiceId.split('-')[0] === cat[0].split('-')[0]) {
                    matchedCat = cat[0];
                    break;
                }
            }
            if (matchedCat) {
                stopsByCat[matchedCat].add(seg.fromStationId);
                stopsByCat[matchedCat].add(seg.toStationId);
            }
        }
    });

    const order = line.stationOrder || [];

    // もしセグメントから全く抽出できなかった場合のフォールバック（全停車扱い）
    cats.forEach(c => {
        const catId = c[0];
        if (stopsByCat[catId].size === 0) {
            order.forEach(stId => stopsByCat[catId].add(stId));
        }
    });

    // 3. 各種別の最初と最後のインデックスを計算
    const boundsByCat = {};
    cats.forEach(c => {
        const catId = c[0];
        let minIdx = Infinity;
        let maxIdx = -Infinity;
        order.forEach((stId, idx) => {
            if (stopsByCat[catId].has(stId)) {
                if (idx < minIdx) minIdx = idx;
                if (idx > maxIdx) maxIdx = idx;
            }
        });
        boundsByCat[catId] = { min: minIdx, max: maxIdx };
    });

    // この路線の区間で影響を受けている範囲
    const st = opStatusByLine.get(lineId);
    let affectedStart = null;
    let affectedEnd = null;
    if (st && st.affected_segment && !st.affected_segment.is_full_line) {
        affectedStart = st.affected_segment.start_station_id;
        affectedEnd = st.affected_segment.end_station_id;
    }

    const affectedIndices = new Set();
    let minAffectedIdx = -1;
    let maxAffectedIdx = -1;
    if (affectedStart && affectedEnd) {
        const sIdx = order.indexOf(affectedStart);
        const eIdx = order.indexOf(affectedEnd);
        if (sIdx !== -1 && eIdx !== -1) {
            const [from, to] = sIdx <= eIdx ? [sIdx, eIdx] : [eIdx, sIdx];
            minAffectedIdx = from;
            maxAffectedIdx = to;
            for (let i = from; i <= to; i++) affectedIndices.add(i);
        }
    }

    // --- DOM生成 ---

    // ヘッダー行 (種別名)
    const headerRow = document.createElement('div');
    headerRow.className = 'op-header-row';
    const headerDiagram = document.createElement('div');
    headerDiagram.className = 'op-diagram-headers';

    cats.forEach(c => {
        const lbl = document.createElement('div');
        lbl.className = 'service-label';
        lbl.textContent = c[1];
        headerDiagram.appendChild(lbl);
    });

    const headerSpacer = document.createElement('div');
    headerSpacer.className = 'op-station-spacer';
    headerRow.appendChild(headerDiagram);
    headerRow.appendChild(headerSpacer);
    lineLayoutEl.appendChild(headerRow);

    // データ行 (駅ごと)
    order.forEach((stId, idx) => {
        const station = opStationMap.get(stId);
        const isStationAffected = affectedIndices.has(idx);

        const row = document.createElement('div');
        row.className = 'op-body-row';

        const rowDiagram = document.createElement('div');
        rowDiagram.className = 'op-diagram-cells';

        // 判定: 路線の全種別がここで止まるか（種別が複数ある場合のみ）
        let isAllStop = false;
        if (cats.length > 1) {
            isAllStop = cats.every(c => stopsByCat[c[0]].has(stId));
        }

        if (isAllStop) {
            rowDiagram.style.position = 'relative';
            const pill = document.createElement('div');
            pill.className = 'diagram-pill';
            rowDiagram.appendChild(pill);
        }

        cats.forEach(c => {
            const catId = c[0];
            const bounds = boundsByCat[catId];
            const cell = document.createElement('div');
            cell.className = 'op-diagram-cell';

            let isCatAffected = false;
            if (isStationAffected && st) {
                if (st.notice_types_all !== false) {
                    isCatAffected = true;
                } else if (Array.isArray(st.notice_types) && st.notice_types.includes(catId)) {
                    isCatAffected = true;
                }
            }

            if (idx >= bounds.min && idx <= bounds.max) {
                const lineBar = document.createElement('div');
                lineBar.className = 'diagram-line';
                lineBar.style.backgroundColor = line.lineColor || 'var(--primary-color)';

                if (isCatAffected) {
                    lineBar.classList.add('affected');
                    if (idx === minAffectedIdx) lineBar.classList.add('affected-start');
                    if (idx === maxAffectedIdx) lineBar.classList.add('affected-end');
                }

                if (idx === bounds.min) lineBar.classList.add('line-start');
                if (idx === bounds.max) lineBar.classList.add('line-end');
                if (idx === bounds.min && idx === bounds.max) lineBar.style.display = 'none';

                cell.appendChild(lineBar);
            }

            if (stopsByCat[catId].has(stId)) {
                const node = document.createElement('div');
                node.className = 'diagram-node';
                node.style.borderColor = line.lineColor || 'var(--primary-color)';
                // 種別に応じた色などの調整が必要な場合はここに。今回は共通デザイン。
                if (isAllStop) node.classList.add('is-all-stop');
                if (isCatAffected) node.classList.add('affected');
                cell.appendChild(node);
            }

            rowDiagram.appendChild(cell);
        });

        // 右：駅名
        const stationCell = document.createElement('div');
        stationCell.className = 'op-station-cell';

        const nameMain = document.createElement('div');
        nameMain.className = 'station-name-main';
        nameMain.textContent = station ? station.stationName : stId;

        stationCell.appendChild(nameMain);

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
                stationCell.appendChild(transfer);
            }
        }

        row.appendChild(rowDiagram);
        row.appendChild(stationCell);
        lineLayoutEl.appendChild(row);
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
        let selectedBtn = null;
        buttons.forEach(btn => {
            const m = btn.dataset.mode;
            const selected = m === mode;
            btn.classList.toggle('selected', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            if (selected) selectedBtn = btn;
        });

        if (selectedBtn) {
            const btnRect = selectedBtn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const leftOffset = btnRect.left - containerRect.left;
            
            container.style.setProperty('--bg-width', `${btnRect.width}px`);
            container.style.setProperty('--bg-left', `${leftOffset}px`);
        }

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

    // `requestAnimationFrame` helps ensure styles flow has calculated button dimensions 
    // before computing init layout position, matching best practice for element geometries.
    requestAnimationFrame(() => {
        setMode('company');
    });

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            setMode(mode);
        });
    });
}

// Bottom sheet
function openBottomSheet() {
    const sheet = document.getElementById('bottom-sheet');
    const btn = document.getElementById('mb-menu-btn');
    const backdrop = document.getElementById('sheet-backdrop');
    if (!sheet) return;
    if (btn) btn.classList.add('active');
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
    if (btn) btn.classList.remove('active');
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

    const mbNav = document.getElementById('mobile-bottom-nav');
    if (mbNav) {
        mbNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.mb-item');
            if (!btn) return;
            if (btn.classList.contains('mb-menu')) {
                toggleBottomSheet();
                return;
            }
            closeBottomSheet();
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

    // Placeholder links (#) and current-page links should not navigate.
    document.querySelectorAll('a[data-noop="true"], a.is-current-page').forEach(link => {
        link.addEventListener('click', (e) => e.preventDefault());
    });
}

// ローディング表示
function showLoading() {
    const el = document.getElementById('loading-section');
    if (!el) return;
    el.style.display = 'flex';

    try {
        const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            const onTouchMove = function(e) {
                e.preventDefault();
            };
            const onWheel = function(e) {
                e.preventDefault();
            };
            const onKeyDown = function(e) {
                const keys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
                if (keys.includes(e.key)) {
                    e.preventDefault();
                }
            };

            _loadingPreventHandlers = { onTouchMove, onWheel, onKeyDown };

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('wheel', onWheel, { passive: false });
            document.addEventListener('keydown', onKeyDown, { passive: false });
            el.style.pointerEvents = 'auto';
        } else {
            document.body.classList.add('no-scroll');
            document.documentElement.classList.add('no-scroll');
        }
    } catch (e) {
        /* ignore */
    }

    const main = document.querySelector('main');
    if (main) main.setAttribute('aria-hidden', 'true');
}

function hideLoading() {
    const el = document.getElementById('loading-section');
    if (el) el.style.display = 'none';

    try {
        if (_loadingPreventHandlers) {
            document.removeEventListener('touchmove', _loadingPreventHandlers.onTouchMove, { passive: false });
            document.removeEventListener('wheel', _loadingPreventHandlers.onWheel, { passive: false });
            document.removeEventListener('keydown', _loadingPreventHandlers.onKeyDown, { passive: false });
            _loadingPreventHandlers = null;
            if (el) el.style.pointerEvents = '';
        }
        document.body.classList.remove('no-scroll');
        document.documentElement.classList.remove('no-scroll');
    } catch (e) {
        /* ignore */
    }

    const main = document.querySelector('main');
    if (main) main.removeAttribute('aria-hidden');
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
