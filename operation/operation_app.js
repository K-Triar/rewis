// ========================================
// 路線・運行情報ページ用スクリプト
// ========================================
import { loadPublicModel } from '../shared/data-source.js';
import { computeAffectedIndices } from '../shared/model.js';
import {
    showShareDialog,
    setupBottomSheet,
    setupHelpModal,
    setupNoopLinks,
    showLoading,
    hideLoading,
    showError,
    hideError,
} from '../shared/ui-dom.js';

let model = null;
let opCurrentLineId = null;

function applyLineTypeIcon(el, line) {
    if (!el || !line) return;

    const vehicleTypeId = (line.vehicleTypeId || 'TC').toUpperCase();
    const iconPathMap = {
        TC: '../assets/icons/TC.svg',
        SX: '../assets/icons/SX.svg',
        MC: '../assets/icons/mc.svg'
    };
    const iconPath = iconPathMap[vehicleTypeId] || iconPathMap.TC;

    el.textContent = '';
    el.style.backgroundColor = line.color || 'var(--primary-color)';
    el.style.webkitMaskImage = `url(${iconPath})`;
    el.style.maskImage = `url(${iconPath})`;
}

function formatVerticalServiceLabel(label) {
    return String(label || '')
        .replace(/\(/g, '（')
        .replace(/\)/g, '）');
}

function formatSeconds(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    const minutes = Math.floor(total / 60);
    const remSec = total % 60;
    if (minutes === 0) return `${remSec}秒`;
    if (remSec === 0) return `${minutes}分`;
    return `${minutes}分${remSec}秒`;
}

function isSuspendNotice(notice) {
    if (!notice) return false;
    const masters = model.masters || {};
    const template = (masters.statusTemplates || []).find(t => t.code === notice.status?.code);
    const statusId = template ? template.statusId : '';
    const code = notice.status?.code || '';
    const heading = notice.status?.heading || '';
    return statusId === 'OfS' || /SUSPEND/i.test(code) || (heading && heading.includes('運転見合わせ'));
}

function getCauseHeading(notice) {
    const cause = notice.cause;
    if (!cause) return null;
    if (cause.heading) return cause.heading;
    const tpl = (model.masters?.causes || []).find(c => c.code === cause.code);
    return tpl ? (tpl.heading || tpl.label) : null;
}

function getLatestNoticeUpdatedAt() {
    let latest = null;
    model.noticesByLine.forEach(list => {
        list.forEach(n => {
            if (!latest || n.updatedAt > latest) latest = n.updatedAt;
        });
    });
    return latest;
}

// データ読み込み
async function loadOperationData() {
    try {
        hideError();
        showLoading();

        ({ model } = await loadPublicModel({}));
        renderLineListView();
        loadOperationFromUrlParams();
    } catch (err) {
        console.error(err);
        showError('運行情報の取得に失敗しました。時間をおいて再度お試しください。');
    } finally {
        hideLoading();
    }
}

function setOperationUrlLineParam(lineId, useReplace) {
    try {
        const urlObj = new URL(window.location.href);
        const params = new URLSearchParams();

        if (lineId) {
            params.set('line', lineId);
        } else {
            params.delete('line');
        }

        const query = params.toString();
        const newUrl = `${urlObj.pathname}${query ? '?' + query : ''}`;
        if (useReplace) {
            window.history.replaceState({}, '', newUrl);
        } else {
            window.history.pushState({}, '', newUrl);
        }
    } catch (e) {
        console.warn('URL更新に失敗しました:', e);
    }
}

function loadOperationFromUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const lineId = params.get('line');
    if (!lineId) return;

    if (model && model.lineById.has(lineId)) {
        showLineDetail(lineId, { syncUrl: false });
    } else {
        setOperationUrlLineParam(null, true);
    }
}

function handleOperationPopState() {
    const params = new URLSearchParams(window.location.search);
    const lineId = params.get('line');
    if (lineId && model && model.lineById.has(lineId)) {
        showLineDetail(lineId, { syncUrl: false });
    } else {
        hideLineDetail({ syncUrl: false });
    }
}

function scrollOperationTopOnMobile() {
    if (!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches)) {
        return;
    }

    // Wait for layout to settle after view switching, then force top position.
    requestAnimationFrame(() => {
        const container = document.querySelector('.container');
        if (container) {
            container.scrollTop = 0;
            try {
                container.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            } catch (e) {
                /* ignore */
            }
        }

        const root = document.scrollingElement || document.documentElement;
        if (root) root.scrollTop = 0;
        document.body.scrollTop = 0;
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } catch (e) {
            window.scrollTo(0, 0);
        }
    });
}

// ステータス判定
function getLineStatusSummary(lineId) {
    const st = (model.noticesByLine.get(lineId) || [])[0];
    if (!st) {
        return {
            level: 'normal',
            icon: 'circle',
            heading: '遅れの情報はありません',
            subLines: []
        };
    }

    const heading = st.status?.heading || 'お知らせあり';
    const isSuspend = isSuspendNotice(st);

    const level = isSuspend ? 'suspend' : 'warning';
    const icon = isSuspend ? 'cross' : 'warning';

    const subLines = [];
    if (st.range != null) {
        const sName = model.stationName(st.range.fromStationId) || '一部区間';
        const eName = model.stationName(st.range.toStationId) || '';
        if (sName && eName) {
            subLines.push(`区間：${sName} から ${eName} まで`);
        }
    }
    const causeHeading = getCauseHeading(st);
    if (causeHeading) {
        subLines.push(`事由：${causeHeading}`);
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
    if (!container || !model) return;
    container.innerHTML = '';

    const ownCompanyId = model.network.meta?.ownCompanyId || 'KT';

    // 登録されている全ての会社を取得し、自社(ownCompanyId)を先頭にする
    const allCompanyIds = model.network.companies.map(c => c.id);
    const targetCompanies = [ownCompanyId, ...allCompanyIds.filter(id => id !== ownCompanyId)];

    targetCompanies.forEach(companyId => {
        const company = model.companyById.get(companyId);
        if (!company) return;

        const lines = model.network.lines.filter(l => l.companyId === companyId && (l.stations || []).length > 0);
        if (lines.length === 0) return;

        const section = document.createElement('section');
        section.className = 'line-section';

        const title = document.createElement('h2');
        title.className = 'line-section-title';
        title.textContent = company.name;
        section.appendChild(title);

        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'line-cards';

        lines.forEach(line => {
            const status = getLineStatusSummary(line.id);
            const card = document.createElement('article');
            card.className = 'line-card';
            card.dataset.lineId = line.id;

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
            nameEl.textContent = line.name;

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
                status.subLines.forEach(s => {
                    const line = document.createElement('div');
                    line.textContent = s;
                    sub.appendChild(line);
                });
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
                showLineDetail(line.id, { syncUrl: true });
            });

            cardsWrap.appendChild(card);
        });

        section.appendChild(cardsWrap);
        container.appendChild(section);
    });
}

// 詳細ビュー表示
function showLineDetail(lineId, options) {
    const opts = options || {};
    const syncUrl = opts.syncUrl !== false;

    const line = model.lineById.get(lineId);
    if (!line) return;
    opCurrentLineId = lineId;

    const listView = document.getElementById('operation-section');
    const detailView = document.getElementById('line-detail-view');

    listView.style.display = 'none';
    detailView.style.display = 'block';
    detailView.setAttribute('aria-hidden', 'false');

    const icon = document.getElementById('line-detail-icon');
    const nameEl = document.getElementById('line-detail-name');

    applyLineTypeIcon(icon, line);
    nameEl.textContent = line.name;

    renderLineAlertBox(lineId);
    renderLineDiagram(lineId);
    ensureLineShareButton();
    scrollOperationTopOnMobile();

    if (syncUrl) {
        setOperationUrlLineParam(lineId, false);
    }
}

function hideLineDetail(options) {
    const opts = options || {};
    const syncUrl = opts.syncUrl !== false;

    const listView = document.getElementById('operation-section');
    const detailView = document.getElementById('line-detail-view');
    detailView.style.display = 'none';
    detailView.setAttribute('aria-hidden', 'true');
    listView.style.display = 'block';
    opCurrentLineId = null;

    if (syncUrl) {
        setOperationUrlLineParam(null, false);
    }
}

function ensureLineShareButton() {
    const detailView = document.getElementById('line-detail-view');
    if (!detailView) return;

    let wrapper = document.getElementById('line-share-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'line-share-wrapper';
        wrapper.className = 'share-result-wrapper';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'back-to-search-btn share-result-btn';
        btn.id = 'share-line-btn';
        btn.textContent = '路線を共有する';

        btn.addEventListener('click', () => {
            const lineId = opCurrentLineId;
            if (!lineId) return;
            try {
                const urlObj = new URL(window.location.href);
                const params = new URLSearchParams();
                params.set('line', lineId);
                const shareUrl = `${urlObj.origin}${urlObj.pathname}?${params.toString()}`;
                showShareDialog(shareUrl, { title: '路線を共有する', ariaLabel: '路線を共有' });
            } catch (e) {
                showShareDialog(window.location.href, { title: '路線を共有する', ariaLabel: '路線を共有' });
            }
        });

        wrapper.appendChild(btn);
        detailView.appendChild(wrapper);
    }
}

// アラート枠
function renderLineAlertBox(lineId) {
    const box = document.getElementById('line-alert-box');
    box.innerHTML = '';

    const st = (model.noticesByLine.get(lineId) || [])[0];
    if (!st) {
        box.classList.add('alert-normal');
        const inner = document.createElement('div');
        inner.className = 'alert-body';
        const metaTime = getLatestNoticeUpdatedAt();
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
    updated.textContent = st.updatedAt ? `${formatJaDateTime(st.updatedAt)} 更新` : '';

    header.appendChild(main);
    header.appendChild(updated);

    const body = document.createElement('div');
    body.className = 'alert-body';
    body.textContent = (st.rendered && st.rendered.body) || st.status?.body || '';

    box.appendChild(header);
    box.appendChild(body);
}

// 路線図＋駅リスト
function renderLineDiagram(lineId) {
    const line = model.lineById.get(lineId);
    if (!line) return;

    const lineLayoutEl = document.getElementById('line-layout');

    // 古い行をクリア
    lineLayoutEl.innerHTML = '';

    const cats = line.categories || [];

    // 1. 各種別の停車駅IDのSetを作成（有効な運行系統の区間から）
    const stopsByCategory = model.stopsByLineCategory.get(lineId) || new Map();
    const stopsByCat = {};
    cats.forEach(c => stopsByCat[c.id] = new Set(stopsByCategory.get(c.id) || []));

    const order = line.stations || [];

    // もし運行系統から全く抽出できなかった場合のフォールバック（全停車扱い）
    cats.forEach(c => {
        if (stopsByCat[c.id].size === 0) {
            order.forEach(stId => stopsByCat[c.id].add(stId));
        }
    });

    // 2. 各種別の最初と最後のインデックスを計算
    const boundsByCat = {};
    cats.forEach(c => {
        let minIdx = Infinity;
        let maxIdx = -Infinity;
        order.forEach((stId, idx) => {
            if (stopsByCat[c.id].has(stId)) {
                if (idx < minIdx) minIdx = idx;
                if (idx > maxIdx) maxIdx = idx;
            }
        });
        boundsByCat[c.id] = { min: minIdx, max: maxIdx };
    });

    // この路線の区間で影響を受けている範囲（要望4：computeAffectedIndicesを使う）
    const st = (model.noticesByLine.get(lineId) || [])[0];
    const affectedIndicesArray = st ? computeAffectedIndices(line, st.range) : [];
    const affectedIndices = new Set(affectedIndicesArray);
    const minAffectedIdx = affectedIndicesArray.length ? affectedIndicesArray[0] : -1;
    const maxAffectedIdx = affectedIndicesArray.length ? affectedIndicesArray[affectedIndicesArray.length - 1] : -1;

    // --- DOM生成 ---

    // ヘッダー行 (種別名)
    const headerRow = document.createElement('div');
    headerRow.className = 'op-header-row';
    const headerDiagram = document.createElement('div');
    headerDiagram.className = 'op-diagram-headers';

    cats.forEach(c => {
        const lbl = document.createElement('div');
        lbl.className = 'service-label';
        lbl.textContent = formatVerticalServiceLabel(c.name);
        headerDiagram.appendChild(lbl);
    });

    const headerSpacer = document.createElement('div');
    headerSpacer.className = 'op-station-spacer';
    headerRow.appendChild(headerDiagram);
    headerRow.appendChild(headerSpacer);
    lineLayoutEl.appendChild(headerRow);

    // データ行 (駅ごと)
    order.forEach((stId, idx) => {
        const station = model.stationById.get(stId);
        const isStationAffected = affectedIndices.has(idx);

        const row = document.createElement('div');
        row.className = 'op-body-row';

        const rowDiagram = document.createElement('div');
        rowDiagram.className = 'op-diagram-cells';

        // 判定: 路線の全種別がここで止まるか（種別が複数ある場合のみ）
        let isAllStop = false;
        if (cats.length > 1) {
            isAllStop = cats.every(c => stopsByCat[c.id].has(stId));
        }

        if (isAllStop) {
            rowDiagram.style.position = 'relative';
            const pill = document.createElement('div');
            pill.className = 'diagram-pill';
            rowDiagram.appendChild(pill);
        }

        cats.forEach(c => {
            const bounds = boundsByCat[c.id];
            const cell = document.createElement('div');
            cell.className = 'op-diagram-cell';

            let isCatAffected = false;
            if (isStationAffected && st) {
                if (st.categoryIds == null) {
                    isCatAffected = true;
                } else if (Array.isArray(st.categoryIds) && st.categoryIds.includes(c.id)) {
                    isCatAffected = true;
                }
            }

            if (idx >= bounds.min && idx <= bounds.max) {
                const lineBar = document.createElement('div');
                lineBar.className = 'diagram-line';
                lineBar.style.backgroundColor = line.color || 'var(--primary-color)';

                if (isCatAffected) {
                    lineBar.classList.add('affected');
                    if (idx === minAffectedIdx) lineBar.classList.add('affected-start');
                    if (idx === maxAffectedIdx) lineBar.classList.add('affected-end');
                }

                if (idx === bounds.min) lineBar.classList.add('line-start');
                if (idx === bounds.max && !line.loop) lineBar.classList.add('line-end');
                if (idx === bounds.min && idx === bounds.max) lineBar.style.display = 'none';

                cell.appendChild(lineBar);
            }

            if (stopsByCat[c.id].has(stId)) {
                const node = document.createElement('div');
                node.className = 'diagram-node';
                node.style.borderColor = line.color || 'var(--primary-color)';
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
        nameMain.textContent = station ? station.name : stId;

        stationCell.appendChild(nameMain);

        // 乗換情報
        const lineIds = model.linesByStation.get(stId) || [];
        if (lineIds.length > 1) {
            const others = lineIds
                .filter(lid => lid !== lineId)
                .map(lid => model.lineName(lid))
                .filter(Boolean);
            if (others.length > 0) {
                const transfer = document.createElement('div');
                transfer.className = 'station-transfer';
                transfer.textContent = `乗換：${others.join('・')}`;
                stationCell.appendChild(transfer);
            }
        }

        // 徒歩連絡（要望5）
        const walks = model.walkTransfersByStation.get(stId) || [];
        if (walks.length > 0) {
            const walkText = walks
                .map(w => `${model.stationName(w.toStationId)}（${formatSeconds(w.seconds)}）`)
                .join('・');
            const walk = document.createElement('div');
            walk.className = 'station-transfer';
            walk.textContent = `徒歩：${walkText}`;
            stationCell.appendChild(walk);
        }

        row.appendChild(rowDiagram);
        row.appendChild(stationCell);
        lineLayoutEl.appendChild(row);
    });

    // 環状線：最後に「戻る」行を追加する（要望4）
    if (line.loop) {
        const row = document.createElement('div');
        row.className = 'op-body-row';

        const rowDiagram = document.createElement('div');
        rowDiagram.className = 'op-diagram-cells';
        cats.forEach(() => {
            const cell = document.createElement('div');
            cell.className = 'op-diagram-cell';
            rowDiagram.appendChild(cell);
        });

        const stationCell = document.createElement('div');
        stationCell.className = 'op-station-cell';
        const loopStationId = order[line.loop.startIndex];
        const transfer = document.createElement('div');
        transfer.className = 'station-transfer';
        transfer.textContent = `↺ ${model.stationName(loopStationId)} へ戻る`;
        stationCell.appendChild(transfer);

        row.appendChild(rowDiagram);
        row.appendChild(stationCell);
        lineLayoutEl.appendChild(row);
    }
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

// 初期化
function initializeOperationUI() {
    setupOperationModeToggle();
    setupBottomSheet();
    setupHelpModal();
    setupNoopLinks();

    const backBtn = document.getElementById('back-to-list-btn');
    if (backBtn) backBtn.addEventListener('click', () => hideLineDetail({ syncUrl: true }));

    // Error popup close button
    const errorCloseBtn = document.getElementById('error-close');
    if (errorCloseBtn) errorCloseBtn.addEventListener('click', hideError);

    window.addEventListener('popstate', handleOperationPopState);
}

initializeOperationUI();
loadOperationData();
