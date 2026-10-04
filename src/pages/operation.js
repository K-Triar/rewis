// ========================================
// 路線・運行情報ページ用スクリプト
// ========================================
import { loadPublicModel } from '../shared/data-source.js';
import { setupInstallPrompt } from '../shared/install-prompt.js';
import { createStatusIcon } from '../shared/status-icon.js';
import { computeAffectedIndices } from '../shared/model.js';
import { ownCompanyIds } from '../shared/ids.js';
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
const SVG_NS = 'http://www.w3.org/2000/svg';
// 専用線のぼかし用 SVG <filter>/<clipPath> の id をページ内で一意にするための連番
let loopGlowSeq = 0;
// 路線図の線の太さ（CSS の --diagram-line-w と対応。駅の丸の内側の白い点と同じ幅）
const DIAGRAM_LINE_W = 12;

function applyLineTypeIcon(el, line) {
    if (!el || !line) return;

    const vehicleTypeId = (line.vehicleTypeId || 'TC').toUpperCase();
    const iconPath = `../assets/icons/${vehicleTypeId}.svg`;

    el.textContent = '';
    el.style.backgroundColor = line.color || 'var(--color-primary)';
    el.style.webkitMaskImage = `url(${iconPath})`;
    el.style.maskImage = `url(${iconPath})`;
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
        const params = new URLSearchParams(urlObj.search);

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
        const container = document.querySelector('.page-container');
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

// ========================================
// 運行情報行（区間・原因）の構築
// ========================================
function getNoticeFields(notice) {
    const fields = [];
    if (notice.range == null) {
        fields.push({ label: '区間', value: '全線' });
    } else {
        const sName = model.stationName(notice.range.fromStationId) || '一部区間';
        const eName = model.stationName(notice.range.toStationId) || '';
        if (sName && eName) {
            fields.push({ label: '区間', value: `${sName} ～ ${eName}` });
        }
    }
    const causeHeading = getCauseHeading(notice);
    if (causeHeading) {
        fields.push({ label: '事由', value: causeHeading });
    }
    return fields;
}

function buildLineNoticeAction(lineId) {
    const action = document.createElement('div');
    action.className = 'line-notice-action';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline-pill line-notice-detail-btn';
    btn.textContent = '詳細';
    btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showLineDetail(lineId, { syncUrl: true });
    });

    action.appendChild(btn);
    return action;
}

function buildLineNoticeRow(notice, lineId) {
    const isSuspend = isSuspendNotice(notice);

    const row = document.createElement('div');
    row.className = `line-notice-row${isSuspend ? ' line-notice-row--suspend' : ' line-notice-row--warning'}`;

    const iconCol = document.createElement('div');
    iconCol.className = 'line-notice-icon-col';
    const icon = document.createElement('span');
    icon.className = 'line-notice-icon';
    icon.appendChild(createStatusIcon(isSuspend ? 'suspend' : 'warning'));
    icon.setAttribute('aria-hidden', 'true');
    iconCol.appendChild(icon);

    const main = document.createElement('div');
    main.className = 'line-notice-main';

    const title = document.createElement('div');
    title.className = 'line-notice-title';
    title.textContent = notice.status?.heading || '運行情報';
    main.appendChild(title);

    const fields = getNoticeFields(notice);
    if (fields.length > 0) {
        const fieldsWrap = document.createElement('div');
        fieldsWrap.className = 'line-notice-fields';
        fields.forEach(f => {
            const fieldEl = document.createElement('div');
            fieldEl.className = 'line-notice-field';

            const label = document.createElement('span');
            label.className = 'line-notice-label';
            label.textContent = f.label;

            const value = document.createElement('span');
            value.className = 'line-notice-value';
            value.textContent = f.value;

            fieldEl.appendChild(label);
            fieldEl.appendChild(value);
            fieldsWrap.appendChild(fieldEl);
        });
        main.appendChild(fieldsWrap);
    }

    if (notice.updatedAt) {
        const updated = document.createElement('div');
        updated.className = 'line-notice-updated';
        updated.textContent = `${formatJaDateTime(notice.updatedAt)} 更新`;
        main.appendChild(updated);
    }

    row.appendChild(iconCol);
    row.appendChild(main);
    row.appendChild(buildLineNoticeAction(lineId));
    return row;
}

function buildLineNoticeNormalRow(lineId) {
    const row = document.createElement('div');
    row.className = 'line-notice-row line-notice-row--normal';

    const iconCol = document.createElement('div');
    iconCol.className = 'line-notice-icon-col';
    const icon = document.createElement('span');
    icon.className = 'line-notice-icon';
    icon.appendChild(createStatusIcon('normal'));
    icon.setAttribute('aria-hidden', 'true');
    iconCol.appendChild(icon);

    const main = document.createElement('div');
    main.className = 'line-notice-main';
    const title = document.createElement('div');
    title.className = 'line-notice-title';
    title.textContent = '遅れの情報はありません';
    main.appendChild(title);

    row.appendChild(iconCol);
    row.appendChild(main);
    row.appendChild(buildLineNoticeAction(lineId));
    return row;
}

// ========================================
// 路線一覧ビュー描画（会社から探す）
// ========================================
function renderLineListView() {
    const container = document.getElementById('line-list-view');
    if (!container || !model) return;
    container.innerHTML = '';

    const ownIds = ownCompanyIds(model.network.meta).length ? ownCompanyIds(model.network.meta) : ['KT'];

    // 登録されている全ての会社を取得し、自社(ownCompanyId)を先頭にする
    const allCompanyIds = model.network.companies.map(c => c.id);
    const targetCompanies = [...ownIds, ...allCompanyIds.filter(id => !ownIds.includes(id))];

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
            const notices = model.noticesByLine.get(line.id) || [];

            const card = document.createElement('article');
            card.className = 'line-card';
            card.dataset.lineId = line.id;

            const header = document.createElement('div');
            header.className = 'line-card-header';
            header.tabIndex = 0;
            header.setAttribute('role', 'button');
            header.setAttribute('aria-label', `${line.name}の運行情報を開く`);

            const iconContent = document.createElement('div');
            iconContent.className = 'line-icon';
            applyLineTypeIcon(iconContent, line);

            const nameEl = document.createElement('div');
            nameEl.className = 'line-name';
            nameEl.textContent = line.name;

            header.appendChild(iconContent);
            header.appendChild(nameEl);

            const openDetail = () => showLineDetail(line.id, { syncUrl: true });
            header.addEventListener('click', openDetail);
            header.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    openDetail();
                }
            });

            const list = document.createElement('div');
            list.className = 'line-notice-list';

            if (notices.length === 0) {
                list.appendChild(buildLineNoticeNormalRow(line.id));
            } else {
                const rep = model.primaryNotice(line.id);
                const ordered = rep ? [rep, ...notices.filter(n => n !== rep)] : notices;
                ordered.forEach(n => list.appendChild(buildLineNoticeRow(n, line.id)));
            }

            card.appendChild(header);
            card.appendChild(list);
            cardsWrap.appendChild(card);
        });

        section.appendChild(cardsWrap);
        container.appendChild(section);
    });
}

// ========================================
// 詳細ビュー表示
// ========================================
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
        btn.className = 'btn btn-outline-pill';
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

// ========================================
// 運行情報ボックス（1路線に複数件あれば、代表の1件を先頭にすべて積み重ねる）
// ========================================
function renderLineAlertBox(lineId) {
    const box = document.getElementById('line-alert-box');
    box.innerHTML = '';

    const list = model.noticesByLine.get(lineId) || [];
    if (list.length === 0) {
        box.appendChild(buildNormalAlertItem());
        return;
    }

    const rep = model.primaryNotice(lineId);
    const ordered = [rep, ...list.filter(n => n !== rep)];
    ordered.forEach(notice => box.appendChild(buildAlertItem(notice)));
}

function buildNormalAlertItem() {
    const item = document.createElement('div');
    item.className = 'alert-item alert-item--normal';

    const header = document.createElement('div');
    header.className = 'alert-header';

    const main = document.createElement('div');
    main.className = 'alert-main';

    const icon = document.createElement('span');
    icon.className = 'alert-icon';
    icon.appendChild(createStatusIcon('normal'));
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'alert-title';
    title.textContent = '平常運転';

    main.appendChild(icon);
    main.appendChild(title);
    header.appendChild(main);

    const body = document.createElement('div');
    body.className = 'alert-body';
    body.textContent = '現在、列車の遅れなどの情報はありません。';

    item.appendChild(header);
    item.appendChild(body);
    return item;
}

function buildAlertItem(notice) {
    const isSuspend = isSuspendNotice(notice);

    const item = document.createElement('div');
    item.className = `alert-item${isSuspend ? ' alert-item--suspend' : ''}`;

    const header = document.createElement('div');
    header.className = 'alert-header';

    const main = document.createElement('div');
    main.className = 'alert-main';

    const icon = document.createElement('span');
    icon.className = 'alert-icon';
    icon.appendChild(createStatusIcon(isSuspend ? 'suspend' : 'warning'));
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'alert-title';
    title.textContent = notice.status?.heading || '運行情報';

    main.appendChild(icon);
    main.appendChild(title);

    const updated = document.createElement('span');
    updated.className = 'alert-updated';
    updated.textContent = notice.updatedAt ? `${formatJaDateTime(notice.updatedAt)} 更新` : '';

    header.appendChild(main);
    header.appendChild(updated);

    const body = document.createElement('div');
    body.className = 'alert-body';
    body.textContent = (notice.rendered && notice.rendered.body) || notice.status?.body || '';

    item.appendChild(header);
    item.appendChild(body);
    return item;
}

// ========================================
// 他路線への直通（運行系統の sections が路線をまたぐ箇所）
// ========================================
// 返り値: [{ idx, drawSide, otherLineId, categoryIds:Set, flowsByCat:Map(種別→Set('out'|'in')) }]
// 'out' はこの路線から他路線へ、'in' は他路線からこの路線へ直通する列車がある
// usedSide は直通列車がこの路線内で走る側（'up' = 駅の並びの前側）。分岐の曲線は
// 線路の続きとして見えるよう、その反対側（drawSide）に描く。
function computeThroughBranches(line) {
    const order = line.stations || [];
    const groups = new Map();
    const lastIdx = order.length - 1;
    const loopStart = line.loop ? line.loop.startIndex : -1;
    // adjacentId は分岐駅の隣の停車駅（直通列車がこの路線内で分岐駅の次／前に止まる駅）
    function add(junctionId, otherId, adjacentId, categoryId, flow) {
        const idx = order.indexOf(junctionId);
        const adjIdx = order.indexOf(adjacentId);
        if (idx === -1 || adjIdx === -1 || adjIdx === idx) return;
        let usedSide = adjIdx < idx ? 'up' : 'down';
        // 環状・ラケット型で、終端駅⇔始点（戻る駅）を専用線経由で隣り合う場合は専用線の側。
        // 終端駅では下の折り返し、環状線の始点では上の半円、ラケット型の戻る駅では下から合流する
        if (line.loop && idx === loopStart && adjIdx === lastIdx) usedSide = loopStart === 0 ? 'up' : 'down';
        else if (line.loop && idx === lastIdx && adjIdx === loopStart) usedSide = 'down';
        const drawSide = usedSide === 'up' ? 'down' : 'up';
        const key = `${idx}|${drawSide}|${otherId}`;
        if (!groups.has(key)) {
            groups.set(key, { idx, drawSide, otherLineId: otherId, categoryIds: new Set(), flowsByCat: new Map() });
        }
        const g = groups.get(key);
        g.categoryIds.add(categoryId);
        if (!g.flowsByCat.has(categoryId)) g.flowsByCat.set(categoryId, new Set());
        g.flowsByCat.get(categoryId).add(flow);
    }
    (model.activeServices || []).forEach(service => {
        const sections = service.sections || [];
        const stopId = i => service.stops[i] && service.stops[i].stationId;
        // 隣の停車駅。区間が1駅だけ（from === to）なら判定できない
        for (let i = 0; i < sections.length - 1; i++) {
            const cur = sections[i];
            const next = sections[i + 1];
            if (cur.lineId === line.id && next.lineId !== line.id) {
                if (cur.to > cur.from) add(stopId(cur.to), next.lineId, stopId(cur.to - 1), cur.categoryId, 'out');
            } else if (next.lineId === line.id && cur.lineId !== line.id) {
                if (next.to > next.from) add(stopId(next.from), cur.lineId, stopId(next.from + 1), next.categoryId, 'in');
            }
        }
    });
    return Array.from(groups.values());
}

// ========================================
// 路線図＋駅リスト
// ========================================
function renderLineDiagram(lineId) {
    const line = model.lineById.get(lineId);
    if (!line) return;

    const lineLayoutEl = document.getElementById('line-layout');
    lineLayoutEl.innerHTML = '';

    const cats = line.categories || [];

    const stopsByCategory = model.stopsByLineCategory.get(lineId) || new Map();
    const stopsByCat = {};
    cats.forEach(c => stopsByCat[c.id] = new Set(stopsByCategory.get(c.id) || []));

    const order = line.stations || [];

    cats.forEach(c => {
        if (stopsByCat[c.id].size === 0) {
            order.forEach(stId => stopsByCat[c.id].add(stId));
        }
    });

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

    const noticeList = model.noticesByLine.get(lineId) || [];
    // 影響区間は「駅（node）」と「駅間（線）」の2つで判定する。駅間は隣り合う2駅の
    // 組 'a-b'（a<b）と、環状・ラケット型の終端駅→戻る駅の区間 'loop'（専用線）で表す。
    // computeAffectedIndices は進行順の駅添字を返すので、連続する2駅から駅間を作る。
    const lastIdx = order.length - 1;
    const loopEdgeStart = line.loop ? line.loop.startIndex : -1;
    function edgeKey(a, b) {
        if (line.loop && Math.abs(a - b) !== 1
            && Math.min(a, b) === loopEdgeStart && Math.max(a, b) === lastIdx) return 'loop';
        return `${Math.min(a, b)}-${Math.max(a, b)}`;
    }
    const noticeAffected = noticeList.map(notice => {
        const seq = computeAffectedIndices(line, notice.range);
        const edges = new Set();
        if (notice.range == null) {
            for (let i = 0; i < lastIdx; i++) edges.add(edgeKey(i, i + 1));
            if (line.loop) edges.add('loop');
        } else {
            for (let i = 0; i < seq.length - 1; i++) edges.add(edgeKey(seq[i], seq[i + 1]));
        }
        return { notice, indices: new Set(seq), edges };
    });

    function noticeAppliesTo(notice, categoryId) {
        return categoryId == null || notice.categoryIds == null || notice.categoryIds.includes(categoryId);
    }

    function worstSeverity(matches) {
        let severity = null;
        matches.forEach(notice => {
            if (isSuspendNotice(notice)) severity = 'suspend';
            else if (!severity) severity = 'warning';
        });
        return severity;
    }

    function isCategoryAffectedAt(idx, categoryId) {
        return noticeAffected.some(({ notice, indices }) => indices.has(idx) && noticeAppliesTo(notice, categoryId));
    }

    // categoryId が null のときは種別を問わない（専用線は全種別で共有のため）
    function getEdgeSeverity(key, categoryId) {
        return worstSeverity(noticeAffected
            .filter(({ notice, edges }) => edges.has(key) && noticeAppliesTo(notice, categoryId))
            .map(({ notice }) => notice));
    }

    // cont: 上端/下端が隣のセルのぼかしへ続いている側。続く側はぼかしの減衰が隣と
    // 二重に重ならないよう、CSS で隣へはみ出して作った一様な部分だけを切り出す。
    function buildGlow(severity, extraClass, cont) {
        const glow = document.createElement('div');
        glow.className = `diagram-line-glow affected--${severity}`;
        if (extraClass) glow.classList.add(extraClass);
        if (cont && cont.top) glow.classList.add('glow-cont-top');
        if (cont && cont.bottom) glow.classList.add('glow-cont-bottom');
        return glow;
    }

    const loopSeverity = line.loop ? getEdgeSeverity('loop', null) : null;

    // 環状・ラケット型路線: 終端駅の下で本線から分岐し、専用の線で始点/分岐駅へ戻る。
    // 環状線（loop.startIndex === 0）は始点駅の高さで半円を描いてピル型に、
    // ラケット型（loop.startIndex > 0）は戻る駅の高さで直角に曲がって本線へ合流する。
    const hasLoop = !!line.loop;
    const loopStartIdx = hasLoop ? line.loop.startIndex : -1;
    const loopTerminalIdx = order.length - 1;
    const LOOP_CELL = 32;
    const LOOP_R = 16;
    const LOOP_ROWH = 48;
    const LOOP_TOP_STRAIGHT = 24;
    // 専用線の曲線のぼかし。CSS の .diagram-line-glow のグラデーションはこの値から計算した断面
    const LOOP_GLOW_W = 20;
    const LOOP_GLOW_SIGMA = 5;
    const LOOP_GLOW_OPACITY = 0.84;
    // 接合位置で切り落とすぶん、実線を直線方向へ延ばす長さ（ぼかしの減衰が収まる 3σ 以上）
    const LOOP_GLOW_EXT = 20;
    // 曲線の付け根ちょうどで切ると、曲線のぼかしのうち直線側へにじむぶんが失われて段差に
    // なるので、接合位置は曲線から直線方向へこの長さだけ離す（CSS の glow-join-* と対応）
    const LOOP_GLOW_JOIN = 12;

    // SVG は曲線部分だけを固定サイズ（64×48、伸縮なし）で描き、行の高さに応じて
    // 伸びる必要がある縦の直線部分は通常の diagram-line（div）で描く。
    // 以前は SVG を top:0; bottom:0 でセル高さに追従させようとしていたが、<svg> は
    // 置換要素のため絶対配置で top/bottom を両方指定しても高さが伸びず（viewBox の
    // 縦横比から 48px に固定される）、行が 48px を超えると（駅名の行高・乗換表記の
    // 折返しなど）SVG の下端とセル下端の間に隙間ができていた。
    //
    // glowSeverity を渡すと、同じ形の曲線を影響区間のぼかしとして描く。直線部分の
    // .diagram-line-glow（横方向のグラデーション）と同じ断面になるよう、幅 LOOP_GLOW_W の
    // 実線を標準偏差 LOOP_GLOW_SIGMA でぼかす（CSS 側のグラデーションはこの断面から計算）。
    // 直線部分と重なって濃くならないよう、実線は接合位置の先まで延ばしたうえで、
    // ぼかした結果を接合位置で clipPath により切り落とす。
    function buildLoopArcSvg(kind, glowSeverity) {
        const isGlow = !!glowSeverity;
        // 'top' だけは駅中心の上に短い直線を挟むぶん SVG を上へ伸ばす（CSS の --top と対応）
        const svgH = kind === 'top' ? LOOP_ROWH + LOOP_TOP_STRAIGHT : LOOP_ROWH;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', String(LOOP_CELL * 2));
        svg.setAttribute('height', String(svgH));
        svg.setAttribute('viewBox', `0 0 ${LOOP_CELL * 2} ${svgH}`);
        svg.classList.add('diagram-loop-svg');
        if (kind === 'top') svg.classList.add('diagram-loop-svg--top');
        if (kind === 'bottom') svg.classList.add('diagram-loop-svg--bottom');

        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('fill', 'none');
        if (isGlow) {
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-opacity', String(LOOP_GLOW_OPACITY));
            path.setAttribute('stroke-width', String(LOOP_GLOW_W));
            path.setAttribute('stroke-linecap', 'butt');
        } else {
            path.setAttribute('stroke', line.color || 'var(--color-primary)');
            path.setAttribute('stroke-width', String(DIAGRAM_LINE_W));
            // 端点の接線方向へ線幅の半分はみ出させ、隣接する div の縦線と重ねて継ぎ目を防ぐ
            path.setAttribute('stroke-linecap', 'square');
        }
        const ext = isGlow ? LOOP_GLOW_EXT : 0;
        const cy = svgH - LOOP_ROWH / 2;
        const loopX = LOOP_CELL / 2;
        const mainX = LOOP_CELL + LOOP_CELL / 2;
        let d = '';
        if (kind === 'top') {
            // 始点駅：駅中心から短く直線で上がり、半円で折り返して専用線側を駅中心の高さまで
            // 下ろす（node に斜めに刺さらないよう、終端側の直線→U字と同じ見え方にする）。
            // 駅中心より下の専用線の縦線は div
            const arcY = cy - LOOP_TOP_STRAIGHT;
            d = `M ${mainX} ${cy + ext} L ${mainX} ${arcY} A ${LOOP_R} ${LOOP_R} 0 0 0 ${loopX} ${arcY} L ${loopX} ${cy + ext}`;
        } else if (kind === 'bottom') {
            // 終端駅の下：本線から間を空けずに半円で折り返して環状運転専用線へつなぐ
            const top = isGlow ? -(LOOP_GLOW_JOIN + ext) : 0;
            d = `M ${mainX} ${top} L ${mainX} 0 A ${LOOP_R} ${LOOP_R} 0 0 1 ${loopX} 0 L ${loopX} ${top}`;
        } else if (kind === 'corner') {
            // ラケット型の戻る駅：専用線（駅中心+R から下は div）を曲げて本線へ合流させる
            d = `M ${loopX} ${cy + LOOP_R + (isGlow ? LOOP_GLOW_JOIN + ext : 0)} L ${loopX} ${cy + LOOP_R} A ${LOOP_R} ${LOOP_R} 0 0 1 ${loopX + LOOP_R} ${cy} L ${mainX} ${cy}`;
        }
        path.setAttribute('d', d);
        if (!isGlow) {
            svg.appendChild(path);
            return svg;
        }
        svg.classList.add('diagram-loop-glow', `affected--${glowSeverity}`);
        // 直線部分（div のぼかし）との接合位置。'top' と 'corner' はそれより下、
        // 'bottom' はそれより上が div 側の担当
        const seq = ++loopGlowSeq;
        const defs = document.createElementNS(SVG_NS, 'defs');
        const filter = document.createElementNS(SVG_NS, 'filter');
        filter.setAttribute('id', `diagram-loop-glow-f${seq}`);
        filter.setAttribute('filterUnits', 'userSpaceOnUse');
        filter.setAttribute('x', '-60');
        filter.setAttribute('y', '-60');
        filter.setAttribute('width', String(LOOP_CELL * 2 + 120));
        filter.setAttribute('height', String(svgH + 120));
        const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
        blur.setAttribute('stdDeviation', String(LOOP_GLOW_SIGMA));
        filter.appendChild(blur);
        const clip = document.createElementNS(SVG_NS, 'clipPath');
        clip.setAttribute('id', `diagram-loop-glow-c${seq}`);
        clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const rect = document.createElementNS(SVG_NS, 'rect');
        const joinY = kind === 'bottom' ? -LOOP_GLOW_JOIN : kind === 'corner' ? cy + LOOP_R + LOOP_GLOW_JOIN : cy;
        rect.setAttribute('x', '-60');
        rect.setAttribute('width', String(LOOP_CELL * 2 + 120));
        if (kind === 'bottom') {
            rect.setAttribute('y', String(joinY));
            rect.setAttribute('height', String(svgH + 60 - joinY));
        } else {
            rect.setAttribute('y', '-60');
            rect.setAttribute('height', String(joinY + 60));
        }
        clip.appendChild(rect);
        defs.appendChild(filter);
        defs.appendChild(clip);
        svg.appendChild(defs);
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('clip-path', `url(#diagram-loop-glow-c${seq})`);
        path.setAttribute('filter', `url(#diagram-loop-glow-f${seq})`);
        g.appendChild(path);
        svg.appendChild(g);
        return svg;
    }

    function buildLoopBar(modifier) {
        const bar = document.createElement('div');
        bar.className = 'diagram-line';
        if (modifier) bar.classList.add(modifier);
        bar.style.backgroundColor = line.color || 'var(--color-primary)';
        return bar;
    }

    function buildLoopCell(idx) {
        const loopCell = document.createElement('div');
        loopCell.className = 'op-diagram-cell op-diagram-cell--loop';
        const inSpan = idx >= loopStartIdx && idx <= loopTerminalIdx;
        if (inSpan) {
            const isTopBoundary = idx === loopStartIdx;
            // 専用線は終端駅→戻る駅の1区間を表すので、その区間が影響区間なら全体をぼかす
            let kind = null;
            let barModifier = null;
            if (isTopBoundary && loopStartIdx === 0) {
                kind = 'top';
                barModifier = 'line-start';
            } else if (isTopBoundary) {
                kind = 'corner';
                barModifier = 'loop-corner-start';
            }
            if (loopSeverity) {
                // 縦線部分は本線と同じ .diagram-line-glow。上端は上のセルか曲線へ、
                // 下端は下のセルか終端駅の下の折り返しへ必ず続く
                if (kind) loopCell.appendChild(buildLoopArcSvg(kind, loopSeverity));
                const glow = buildGlow(loopSeverity, barModifier === 'line-start' ? 'affected-start' : barModifier,
                    { top: true, bottom: true });
                if (kind === 'corner') glow.classList.add('glow-join-corner');
                if (idx === loopTerminalIdx) glow.classList.add('glow-join-loop-bottom');
                loopCell.appendChild(glow);
            }
            if (kind) loopCell.appendChild(buildLoopArcSvg(kind));
            loopCell.appendChild(buildLoopBar(barModifier));
        }
        return loopCell;
    }

    // 他路線への直通の分岐。駅の上下（drawSide）ごとに1行の分岐行へまとめる
    const throughByRow = new Map();
    computeThroughBranches(line).forEach(b => {
        if (!cats.some(c => b.categoryIds.has(c.id))) return;
        const key = `${b.idx}|${b.drawSide}`;
        if (!throughByRow.has(key)) throughByRow.set(key, []);
        throughByRow.get(key).push(b);
    });
    function throughTargetAt(idx, side, categoryId) {
        const list = throughByRow.get(`${idx}|${side}`) || [];
        return list.find(b => b.categoryIds.has(categoryId)) || null;
    }

    // 運行情報で中止になっている直通の向き（他路線ID → Set('out'|'in')）。
    // target は運行情報の路線（＝この路線）から見た向き
    const suspendedThrough = new Map();
    noticeList.forEach(notice => {
        (notice.throughServices || []).forEach(ts => {
            if (!ts || ts.state !== 'suspended' || !ts.lineId) return;
            if (!suspendedThrough.has(ts.lineId)) suspendedThrough.set(ts.lineId, new Set());
            const set = suspendedThrough.get(ts.lineId);
            if (ts.target !== 'through_to_affected') set.add('out');
            if (ts.target !== 'affected_to_through') set.add('in');
        });
    });
    // 種別の直通がすべての向きで中止なら 'all'、一部の向きだけなら 'some'、中止なしなら null
    function catSuspension(b, categoryId) {
        const stopped = suspendedThrough.get(b.otherLineId);
        const flows = Array.from(b.flowsByCat.get(categoryId) || []);
        if (!stopped || flows.length === 0) return null;
        const hit = flows.filter(f => stopped.has(f)).length;
        if (hit === 0) return null;
        return hit === flows.length ? 'all' : 'some';
    }
    // 分岐全体（路線名の札）: すべての種別が全面中止なら 'all'、どれかに中止があれば 'some'
    function branchSuspension(b) {
        const states = Array.from(b.flowsByCat.keys()).map(id => catSuspension(b, id));
        if (states.every(st => st === 'all')) return 'all';
        return states.some(Boolean) ? 'some' : null;
    }
    // categoryId を渡すとその種別の曲線の色、省略すると横線の色（全種別が全面中止のときだけ灰色）
    function throughColor(b, categoryId) {
        const suspended = categoryId ? catSuspension(b, categoryId) : branchSuspension(b) === 'all';
        if (suspended) return 'var(--color-through-suspended)';
        const other = model.lineById.get(b.otherLineId);
        return (other && other.color) || 'var(--color-primary)';
    }

    const THROUGH_R = 16;
    const THROUGH_LANE_FIRST = 30;
    const THROUGH_LANE_GAP = 24;
    const THROUGH_PAD = 18;
    // 横線上の矢印の先端が曲線の終わりから届く距離（矢印の中心 +5px、半分の長さ 5px）
    const THROUGH_ARROW_REACH = 10;
    // 横線のうち、最後に合流する曲線の先を濃いまま伸ばす長さ
    const THROUGH_SOLID_AFTER = 4;
    // 横線の終わりのぼかしのグラデーションの分割数
    const THROUGH_FADE_STEPS = 12;

    // 片方向だけの直通に付ける、進む向きの白い矢印（線の内側に収まる軸付きの →）。
    // placement:
    //   'vertical'   その種別の線が分岐駅で終わるとき。駅と曲線の間の縦の部分（分岐行の端）
    //   'horizontal' 続く線から分かれるとき。縦の部分は自分の線と重なるので、曲線を抜けた
    //                先の横線（次の列の縦線にはかからない位置）
    //   'arc'        環状線の始点で、縦の部分が上の半円の付け根と重なるとき。曲線の中ほど
    // outward は分岐駅から他路線へ向かう向き
    function buildThroughArrow(x, y, height, side, placement, outward) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.classList.add('op-through-arrow');
        svg.setAttribute('width', String(32 + THROUGH_R));
        svg.setAttribute('height', String(height));
        const awayFromStation = side === 'down' ? 90 : -90;
        let tx, ty, angle;
        if (placement === 'vertical') {
            tx = x;
            ty = side === 'down' ? 6 : height - 6;
            angle = awayFromStation;
        } else if (placement === 'arc') {
            // 曲線（中心 (x+R, y∓R) の四分円）の中点。接線は斜め45°
            const k = THROUGH_R * Math.SQRT1_2;
            tx = x + THROUGH_R - k;
            ty = side === 'down' ? y - THROUGH_R + k : y + THROUGH_R - k;
            angle = side === 'down' ? 45 : -45;
        } else {
            tx = x + THROUGH_R + 5;
            ty = y;
            angle = 0;
        }
        if (!outward) angle += 180;
        const arrow = document.createElementNS(SVG_NS, 'path');
        // 線幅 12px に収まる大きさ（全長 10px・幅 7.6px）。横線上では曲線の終わりから
        // THROUGH_ARROW_REACH までに収まり、次の列の縦線にかからない
        arrow.setAttribute('d', 'M -5 0 L 4.2 0 M 0.4 -3.8 L 4.2 0 L 0.4 3.8');
        arrow.setAttribute('fill', 'none');
        arrow.setAttribute('stroke', '#fff');
        arrow.setAttribute('stroke-width', '1.8');
        arrow.setAttribute('stroke-linecap', 'round');
        arrow.setAttribute('stroke-linejoin', 'round');
        arrow.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${angle})`);
        svg.appendChild(arrow);
        return svg;
    }

    // 駅の上（side='up'）または下（'down'）に挟む分岐行。直通する種別の線を曲線で
    // 横へ曲げ、他路線の色で右端の路線名へつなぐ。直通しない種別の線はそのまま通す。
    function buildThroughRow(idx, side, branches) {
        const row = document.createElement('div');
        row.className = 'op-body-row op-through-row';

        const catIndex = new Map(cats.map((c, i) => [c.id, i]));
        const leftmost = b => Math.min(...cats.filter(c => b.categoryIds.has(c.id)).map(c => catIndex.get(c.id)));
        // 右の列から曲がるものほど駅に近いレーンにすると、横線どうしが交差しない
        const lanes = branches.slice().sort((a, b) => leftmost(b) - leftmost(a));
        const height = THROUGH_LANE_FIRST + (lanes.length - 1) * THROUGH_LANE_GAP + THROUGH_PAD;
        const laneY = k => {
            const fromJunction = THROUGH_LANE_FIRST + k * THROUGH_LANE_GAP;
            return side === 'down' ? fromJunction : height - fromJunction;
        };
        row.style.height = `${height}px`;

        const rowDiagram = document.createElement('div');
        rowDiagram.className = 'op-diagram-cells';
        const neighbor = side === 'down' ? idx + 1 : idx - 1;
        // 環状・ラケット型の終端駅の下は、下の行の折り返しへ続く専用線の区間
        const toLoopBottom = hasLoop && side === 'down' && idx === lastIdx;
        let segKey = null;
        if (toLoopBottom) segKey = 'loop';
        else if (neighbor >= 0 && neighbor <= lastIdx) segKey = edgeKey(idx, neighbor);

        if (hasLoop) {
            // 専用線の列は、分岐行が専用線の範囲（戻る駅〜終端駅〜折り返し）の中にあれば通す
            const loopCell = document.createElement('div');
            loopCell.className = 'op-diagram-cell op-diagram-cell--loop op-through-cell';
            if (Math.min(idx, neighbor) >= loopStartIdx) {
                if (loopSeverity) loopCell.appendChild(buildGlow(loopSeverity, null, { top: true, bottom: true }));
                loopCell.appendChild(buildLoopBar(null));
            }
            rowDiagram.appendChild(loopCell);
        }

        const cellByCat = new Map();
        const continuingCats = new Set();
        cats.forEach(c => {
            const bounds = boundsByCat[c.id];
            const cell = document.createElement('div');
            cell.className = 'op-diagram-cell op-through-cell';
            const continues = toLoopBottom
                ? bounds.max === lastIdx
                : segKey && Math.min(idx, neighbor) >= bounds.min && Math.max(idx, neighbor) <= bounds.max;
            if (continues) {
                continuingCats.add(c.id);
                const sev = getEdgeSeverity(segKey, c.id);
                if (sev) cell.appendChild(buildGlow(sev, null, { top: true, bottom: true }));
                const bar = document.createElement('div');
                bar.className = 'diagram-line';
                bar.style.backgroundColor = line.color || 'var(--color-primary)';
                cell.appendChild(bar);
            }
            cellByCat.set(c.id, cell);
            rowDiagram.appendChild(cell);
        });

        const stationCell = document.createElement('div');
        stationCell.className = 'op-station-cell';
        row.appendChild(rowDiagram);
        row.appendChild(stationCell);

        const bars = [];
        lanes.forEach((b, k) => {
            const color = throughColor(b);
            const suspension = branchSuspension(b);
            const y = laneY(k);
            const curveCats = cats.filter(c => b.categoryIds.has(c.id));
            // 横線上に矢印を置いた種別のうち最も右のもの（終わりのぼかしは矢印より先から）
            let arrowOnBarCat = null;
            let barSvg = null;
            curveCats.forEach(c => {
                // 曲線は各列のセル内に、直線部分の縦線より下のレイヤーで描く（続く線から分かれて見える）
                const cell = cellByCat.get(c.id);
                const svg = document.createElementNS(SVG_NS, 'svg');
                svg.classList.add('op-through-curve');
                svg.setAttribute('width', String(32 + THROUGH_R));
                svg.setAttribute('height', String(height));
                const path = document.createElementNS(SVG_NS, 'path');
                const x = 16;
                const d = side === 'down'
                    ? `M ${x} 0 L ${x} ${y - THROUGH_R} A ${THROUGH_R} ${THROUGH_R} 0 0 0 ${x + THROUGH_R} ${y} L ${x + THROUGH_R + 1} ${y}`
                    : `M ${x} ${height} L ${x} ${y + THROUGH_R} A ${THROUGH_R} ${THROUGH_R} 0 0 1 ${x + THROUGH_R} ${y} L ${x + THROUGH_R + 1} ${y}`;
                path.setAttribute('d', d);
                path.setAttribute('fill', 'none');
                const catColor = throughColor(b, c.id);
                path.setAttribute('stroke', catColor);
                path.setAttribute('stroke-width', String(DIAGRAM_LINE_W));
                svg.appendChild(path);
                // 片方向だけの直通は、進む向きの矢印を置く
                const flows = b.flowsByCat.get(c.id);
                if (flows && flows.size === 1) {
                    let placement = continuingCats.has(c.id) ? 'horizontal' : 'vertical';
                    // 環状線の始点の上は、上の半円が同じ列（最初の種別の列）から左へ折り返している
                    if (placement === 'vertical' && hasLoop && loopStartIdx === 0 && idx === 0 && side === 'up'
                        && c.id === cats[0].id) placement = 'arc';
                    cell.appendChild(buildThroughArrow(x, y, height, side, placement, flows.has('out')));
                    if (placement === 'horizontal') arrowOnBarCat = c.id;
                }
                if (!barSvg) barSvg = svg;
                cell.appendChild(svg);
            });

            // 路線名。横線は最も左の列の曲線と同じ SVG に描く（div で描くと画素への合わせ方が
            // 曲線とずれ、合流するところで角がのぞく）。長さは描画後に測って決める
            const branch = document.createElement('div');
            branch.className = 'op-through-branch';
            branch.style.top = `${y}px`;
            branch.style.setProperty('--through-color', color);
            if (suspension === 'all') branch.classList.add('is-suspended');
            bars.push({
                branch, svg: barSvg, y, color,
                fromCat: curveCats[0].id,
                toCat: curveCats[curveCats.length - 1].id,
                arrowCat: arrowOnBarCat,
            });
            const label = document.createElement('a');
            label.className = 'op-through-label';
            label.href = `?line=${encodeURIComponent(b.otherLineId)}`;
            label.textContent = model.lineName(b.otherLineId) || b.otherLineId;
            if (suspension) {
                const note = document.createElement('span');
                note.className = 'op-through-note';
                note.textContent = suspension === 'all' ? '直通中止' : '一部直通中止';
                label.appendChild(note);
            }
            label.addEventListener('click', ev => {
                ev.preventDefault();
                showLineDetail(b.otherLineId, { syncUrl: true });
            });
            branch.appendChild(label);
            row.appendChild(branch);
        });
        return { row, cellByCat, stationCell, bars };
    }

    // 分岐行の横線は曲線の終わり（列の中心 + 半径）から駅名の左端まで。路線名は駅名の左端にそろえる
    const throughRowsToPlace = [];
    let throughGradSeq = 0;
    function placeThroughBranches() {
        throughRowsToPlace.forEach(({ row, cellByCat, stationCell, bars }) => {
            const rowLeft = row.getBoundingClientRect().left;
            const labelLeft = stationCell.getBoundingClientRect().left - rowLeft;
            const cellLeft = catId => cellByCat.get(catId).getBoundingClientRect().left - rowLeft;
            const curveEnd = catId => cellLeft(catId) + 16 + THROUGH_R;
            bars.forEach(({ branch, svg, y, color, fromCat, toCat, arrowCat }) => {
                branch.style.left = `${labelLeft}px`;
                // SVG（最も左の列のセル）内の座標に直す
                const origin = cellLeft(fromCat);
                const start = curveEnd(fromCat) - origin;
                const end = labelLeft - origin;
                if (end <= start) return;
                // 終わりのぼかしは、右端の列の曲線が合流した先（横線上の矢印があればその先）を
                // THROUGH_SOLID_AFTER だけ濃いまま伸ばしてから（合流点で途切れて見えないように）、
                // 長くても最後の 28px だけ
                let solidEnd = curveEnd(toCat);
                if (arrowCat) solidEnd = Math.max(solidEnd, curveEnd(arrowCat) + THROUGH_ARROW_REACH);
                const fadeTo = end - 2;
                const fadeFrom = Math.min(fadeTo - 1, Math.max(solidEnd + THROUGH_SOLID_AFTER - origin, end - 28));

                const gradId = `op-through-grad${++throughGradSeq}`;
                const defs = document.createElementNS(SVG_NS, 'defs');
                const grad = document.createElementNS(SVG_NS, 'linearGradient');
                grad.setAttribute('id', gradId);
                grad.setAttribute('gradientUnits', 'userSpaceOnUse');
                grad.setAttribute('x1', String(fadeFrom));
                grad.setAttribute('x2', String(fadeTo));
                grad.setAttribute('y1', '0');
                grad.setAttribute('y2', '0');
                // 直線的に薄くすると、始まりで濃さの変化が急に切り替わって縦の境目が見える
                // （マッハバンド）。smoothstep の S 字で始まりと終わりをなめらかにする
                for (let i = 0; i <= THROUGH_FADE_STEPS; i++) {
                    const t = i / THROUGH_FADE_STEPS;
                    const stop = document.createElementNS(SVG_NS, 'stop');
                    stop.setAttribute('offset', t.toFixed(3));
                    stop.style.stopColor = color;
                    stop.style.stopOpacity = (1 - t * t * (3 - 2 * t)).toFixed(3);
                    grad.appendChild(stop);
                }
                defs.appendChild(grad);
                svg.appendChild(defs);

                const bar = document.createElementNS(SVG_NS, 'path');
                bar.setAttribute('d', `M ${start} ${y} L ${end} ${y}`);
                bar.setAttribute('stroke', `url(#${gradId})`);
                bar.setAttribute('stroke-width', String(DIAGRAM_LINE_W));
                svg.appendChild(bar);
                svg.setAttribute('width', String(Math.ceil(end)));
            });
        });
    }

    // ヘッダー行（種別名）
    const headerRow = document.createElement('div');
    headerRow.className = 'op-header-row';
    const headerDiagram = document.createElement('div');
    headerDiagram.className = 'op-diagram-headers';

    if (hasLoop) {
        const loopHeaderCell = document.createElement('div');
        loopHeaderCell.className = 'op-diagram-cell op-diagram-cell--loop';
        headerDiagram.appendChild(loopHeaderCell);
    }

    cats.forEach(c => {
        const lbl = document.createElement('div');
        lbl.className = 'service-label';
        lbl.textContent = String(c.name || '').replace(/\(/g, '（').replace(/\)/g, '）');
        headerDiagram.appendChild(lbl);
    });

    const headerSpacer = document.createElement('div');
    headerSpacer.className = 'op-station-spacer';
    headerRow.appendChild(headerDiagram);
    headerRow.appendChild(headerSpacer);
    lineLayoutEl.appendChild(headerRow);

    // データ行（駅ごと）
    order.forEach((stId, idx) => {
        const station = model.stationById.get(stId);

        const row = document.createElement('div');
        row.className = 'op-body-row';

        const rowDiagram = document.createElement('div');
        rowDiagram.className = 'op-diagram-cells';

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

        if (hasLoop) {
            rowDiagram.appendChild(buildLoopCell(idx));
        }

        cats.forEach(c => {
            const bounds = boundsByCat[c.id];
            const cell = document.createElement('div');
            cell.className = 'op-diagram-cell';

            const isCatAffected = isCategoryAffectedAt(idx, c.id);

            if (idx >= bounds.min && idx <= bounds.max) {
                const isLineStart = idx === bounds.min;
                const isLineEnd = idx === bounds.max && !line.loop;

                // affectedのぼかし効果は diagram-line とは別レイヤー（別要素）にする。
                // diagram-line 側の疑似要素にすると、各区間ごとに独立したスタッキング
                // コンテキストが作られてしまい、区間の境目で隣のセルの diagram-line に
                // よってぼかしが不自然に途切れて見えるため、必ず diagram-line 本体より
                // 下に表示されるよう z-index で全体を通して制御する。
                // セルの上半分は「前の駅との駅間」、下半分は「次の駅との駅間」
                // （終端駅の下半分は環状・ラケット型の専用線へ向かう 'loop' 区間）。
                // diagram-line 本体が line-start/line-end で半分だけ表示される側には
                // ぼかしも出さない（線のない部分にぼかしだけが残らないように）。
                const topSev = !isLineStart && idx > 0 ? getEdgeSeverity(edgeKey(idx - 1, idx), c.id) : null;
                let bottomSev = null;
                if (!isLineEnd) {
                    if (idx < lastIdx) bottomSev = getEdgeSeverity(edgeKey(idx, idx + 1), c.id);
                    else if (line.loop) bottomSev = getEdgeSeverity('loop', c.id);
                }
                // 終端駅の下半分は、下の行の折り返しの曲線のぼかしへ続く
                const joinsLoopBottom = idx === lastIdx && hasLoop;
                if (topSev && topSev === bottomSev) {
                    const glow = buildGlow(topSev, null, { top: true, bottom: true });
                    if (joinsLoopBottom) glow.classList.add('glow-join-loop-bottom');
                    cell.appendChild(glow);
                } else {
                    if (topSev) cell.appendChild(buildGlow(topSev, 'affected-end', { top: true }));
                    // 環状線の始点駅は、駅中心から上へ伸びる専用線の曲線のぼかしとつなぐ
                    const joinsLoopArc = idx === 0 && hasLoop && loopStartIdx === 0 && !!loopSeverity;
                    if (bottomSev) {
                        const glow = buildGlow(bottomSev, 'affected-start', { top: joinsLoopArc, bottom: true });
                        if (joinsLoopBottom) glow.classList.add('glow-join-loop-bottom');
                        cell.appendChild(glow);
                    }
                }

                const lineBar = document.createElement('div');
                lineBar.className = 'diagram-line';
                lineBar.style.backgroundColor = line.color || 'var(--color-primary)';

                if (isLineStart) lineBar.classList.add('line-start');
                if (isLineEnd) lineBar.classList.add('line-end');
                if (idx === bounds.min && idx === bounds.max) lineBar.style.display = 'none';

                cell.appendChild(lineBar);

                // この種別の線が途切れる側に直通の分岐があれば、駅中心から他路線の色で分岐行へつなぐ
                [['up', isLineStart, 'line-end'], ['down', isLineEnd || idx === bounds.max, 'line-start']].forEach(([side, ends, half]) => {
                    if (!ends) return;
                    const b = throughTargetAt(idx, side, c.id);
                    if (!b) return;
                    const stub = document.createElement('div');
                    stub.className = `diagram-line ${half} op-through-stub`;
                    stub.style.backgroundColor = throughColor(b, c.id);
                    cell.appendChild(stub);
                });
            }

            if (stopsByCat[c.id].has(stId)) {
                const node = document.createElement('div');
                node.className = 'diagram-node';
                node.style.borderColor = line.color || 'var(--color-primary)';
                if (isAllStop) node.classList.add('is-all-stop');
                if (isCatAffected) node.classList.add('affected');
                cell.appendChild(node);
            }

            rowDiagram.appendChild(cell);
        });

        const stationCell = document.createElement('div');
        stationCell.className = 'op-station-cell';

        const nameMain = document.createElement('div');
        nameMain.className = 'station-name-main';
        nameMain.textContent = station ? station.name : stId;

        stationCell.appendChild(nameMain);

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

        const walks = model.walkTransfersByStation.get(stId) || [];
        if (walks.length > 0) {
            // のりばごとに複数登録された同じ駅への徒歩連絡は、所要時間の幅で1つにまとめる
            const rangeByStation = new Map();
            walks.forEach(w => {
                const range = rangeByStation.get(w.toStationId);
                if (range) {
                    range.min = Math.min(range.min, w.seconds);
                    range.max = Math.max(range.max, w.seconds);
                } else {
                    rangeByStation.set(w.toStationId, { min: w.seconds, max: w.seconds });
                }
            });
            const walkText = Array.from(rangeByStation, ([toStationId, { min, max }]) => {
                let time;
                if (min === max) time = formatSeconds(min);
                else if (max < 60) time = `${Math.round(min)}〜${formatSeconds(max)}`;
                else time = `${formatSeconds(min)}〜${formatSeconds(max)}`;
                return `${model.stationName(toStationId)}（${time}）`;
            }).join('・');
            const walk = document.createElement('div');
            walk.className = 'station-transfer';
            walk.textContent = `徒歩：${walkText}`;
            stationCell.appendChild(walk);
        }

        const upBranches = throughByRow.get(`${idx}|up`);
        if (upBranches) {
            const through = buildThroughRow(idx, 'up', upBranches);
            lineLayoutEl.appendChild(through.row);
            throughRowsToPlace.push(through);
        }

        row.appendChild(rowDiagram);
        row.appendChild(stationCell);
        lineLayoutEl.appendChild(row);

        const downBranches = throughByRow.get(`${idx}|down`);
        if (downBranches) {
            const through = buildThroughRow(idx, 'down', downBranches);
            lineLayoutEl.appendChild(through.row);
            throughRowsToPlace.push(through);
        }
    });
    placeThroughBranches();

    if (line.loop) {
        const row = document.createElement('div');
        row.className = 'op-body-row';

        const rowDiagram = document.createElement('div');
        rowDiagram.className = 'op-diagram-cells';
        const loopBottomCell = document.createElement('div');
        loopBottomCell.className = 'op-diagram-cell op-diagram-cell--loop';
        if (loopSeverity) loopBottomCell.appendChild(buildLoopArcSvg('bottom', loopSeverity));
        loopBottomCell.appendChild(buildLoopArcSvg('bottom'));
        rowDiagram.appendChild(loopBottomCell);
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

// ========================================
// 検索モード（会社 / 方面）トグル
// ========================================
function setupOperationModeToggle() {
    const container = document.getElementById('operation-mode-toggle');
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('.segmented-btn'));

    function setMode(mode) {
        let selectedBtn = null;
        buttons.forEach(btn => {
            const m = btn.dataset.mode;
            const selected = m === mode;
            btn.classList.toggle('is-selected', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
            if (selected) selectedBtn = btn;
        });

        if (selectedBtn) {
            const btnRect = selectedBtn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const leftOffset = btnRect.left - containerRect.left;

            container.style.setProperty('--seg-width', `${btnRect.width}px`);
            container.style.setProperty('--seg-left', `${leftOffset}px`);
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
    setupInstallPrompt();
    setupHelpModal();
    setupNoopLinks();

    const backBtn = document.getElementById('back-to-list-btn');
    if (backBtn) backBtn.addEventListener('click', () => hideLineDetail({ syncUrl: true }));

    window.addEventListener('popstate', handleOperationPopState);
}

initializeOperationUI();
loadOperationData();
