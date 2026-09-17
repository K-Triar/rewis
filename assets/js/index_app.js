import { loadPublicModel } from '../../shared/data-source.js';
import { setupBottomSheet, setupNoopLinks } from '../../shared/ui-dom.js';

const targetLineNames = ['瑠璃線', '貿易港線', '地下鉄中央線'];
const statusRank = { normal: 0, warning: 1, suspend: 2 };
const rankToState = ['normal', 'warning', 'suspend'];
const STATE_SYMBOLS = { normal: '○', warning: '△', suspend: '×' };
const STATE_LABELS = { normal: '平常運転', warning: '遅延あり', suspend: '運転見合わせ' };

const summaryEl = document.getElementById('home-status-summary');
const gridEl = document.getElementById('home-status-grid');
const errorEl = document.getElementById('home-search-error');
const departureInput = document.getElementById('home-departure');
const arrivalInput = document.getElementById('home-arrival');
const formEl = document.getElementById('quick-search-form');
const swapBtn = document.getElementById('home-swap');
const detailBtn = document.getElementById('home-detail-search');

let model = null;

function formatJaDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
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

function classifyStatus(notice) {
    if (!notice) return { state: 'normal' };
    return { state: isSuspendNotice(notice) ? 'suspend' : 'warning' };
}

function getStatusSeverity(notice) {
    return statusRank[classifyStatus(notice).state] ?? 0;
}

function convertToHiragana(text) {
    return String(text || '').toLowerCase();
}

function normalizeLineDisplayName(name) {
    let display = String(name || '').trim();
    const idx = display.indexOf('線');
    if (idx !== -1) {
        display = display.slice(0, idx + 1).trim();
    }
    return display;
}

function searchStations(query) {
    if (!model) return [];

    const lowerQuery = query.toLowerCase();
    return model.network.stations.filter(station => {
        const stationName = String(station.name || '');
        const stationKana = String(station.kana || '').toLowerCase();
        return stationName.includes(query)
            || stationKana.includes(lowerQuery)
            || convertToHiragana(stationName).includes(lowerQuery);
    }).slice(0, 10);
}

function displaySuggestions(stations, suggestionsDiv, input) {
    if (stations.length === 0) {
        suggestionsDiv.classList.remove('is-open');
        return;
    }

    suggestionsDiv.innerHTML = '';
    stations.forEach(station => {
        const item = document.createElement('div');
        item.className = 'field-suggestion';

        const lineIds = model.linesByStation.get(station.id) || [];
        const displayNames = lineIds.map(lineId => normalizeLineDisplayName(model.lineName(lineId)));
        const uniqueNames = [];
        const seen = new Set();
        displayNames.forEach(name => {
            if (!seen.has(name)) {
                seen.add(name);
                uniqueNames.push(name);
            }
        });
        const linesText = uniqueNames.join('・');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'field-suggestion__name';
        nameSpan.textContent = station.name;

        const linesSpan = document.createElement('span');
        linesSpan.className = 'field-suggestion__lines';
        linesSpan.textContent = linesText;

        item.appendChild(nameSpan);
        item.appendChild(linesSpan);

        item.addEventListener('click', () => {
            input.value = station.name;
            suggestionsDiv.classList.remove('is-open');
        });

        suggestionsDiv.appendChild(item);
    });

    suggestionsDiv.classList.add('is-open');
}

function setupStationInput(inputId) {
    const input = document.getElementById(inputId);
    const suggestionsDiv = document.getElementById(`${inputId}-suggestions`);
    if (!input || !suggestionsDiv) return;

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (!query) {
            suggestionsDiv.classList.remove('is-open');
            return;
        }

        const matchingStations = searchStations(query);
        displaySuggestions(matchingStations, suggestionsDiv, input);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => suggestionsDiv.classList.remove('is-open'), 200);
    });
}

function findStationByName(name) {
    if (!model || !name) return null;
    return model.network.stations.find(station => station.name === name) || null;
}

function buildRouteUrl(departureStation, arrivalStation) {
    const params = new URLSearchParams();
    if (departureStation?.id) params.set('from', departureStation.id);
    if (arrivalStation?.id) params.set('to', arrivalStation.id);
    const query = params.toString();
    return query ? `transfer/?${query}` : 'transfer/';
}

function buildOperationLineUrl(lineId) {
    if (!lineId) return 'operation/';
    const params = new URLSearchParams();
    params.set('line', lineId);
    return `operation/?${params.toString()}`;
}

function showSearchError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
}

function clearSearchError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
}

function renderStatusCard(lineName, state, lineId = null, forceLink = false) {
    const card = document.createElement('article');
    card.className = `status-card status-card--${state}`;

    const title = document.createElement('div');
    title.className = 'status-card-title';
    title.textContent = lineName;

    const icon = document.createElement('div');
    icon.className = 'status-card-icon';
    icon.textContent = STATE_SYMBOLS[state];
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('div');
    label.className = 'status-card-text';
    label.textContent = STATE_LABELS[state];

    card.appendChild(title);
    card.appendChild(icon);
    card.appendChild(label);

    if (lineId || forceLink) {
        const destination = buildOperationLineUrl(lineId);
        card.classList.add('status-card--link');
        card.setAttribute('role', 'link');
        card.tabIndex = 0;
        card.setAttribute('aria-label', `${lineName}の運行情報を開く`);

        card.addEventListener('click', () => {
            window.location.href = destination;
        });

        card.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                window.location.href = destination;
            }
        });
    }

    return card;
}

function renderStatusGrid() {
    const lineMap = new Map(model.network.lines.map(line => [line.name, line]));
    const targetLines = targetLineNames.map(name => lineMap.get(name) || null);
    const targetIds = new Set(targetLines.filter(Boolean).map(line => line.id));
    const otherLines = model.network.lines.filter(line => line && Array.isArray(line.stations) && line.stations.length > 0 && !targetIds.has(line.id));

    const cards = [];
    targetLineNames.forEach(name => {
        const line = lineMap.get(name) || null;
        const notice = line ? model.primaryNotice(line.id) : null;
        cards.push(renderStatusCard(name, classifyStatus(notice).state, line ? line.id : null, false));
    });

    let otherSeverity = -1;
    let latestUpdatedAt = null;
    otherLines.forEach(line => {
        const notice = model.primaryNotice(line.id);
        const severity = getStatusSeverity(notice);
        if (severity > otherSeverity) {
            otherSeverity = severity;
        }
    });

    model.noticesByLine.forEach(list => {
        list.forEach(notice => {
            if (!latestUpdatedAt || notice.updatedAt > latestUpdatedAt) latestUpdatedAt = notice.updatedAt;
        });
    });

    const otherState = rankToState[Math.max(0, otherSeverity)];
    cards.push(renderStatusCard('その他の路線', otherState, null, true));

    gridEl.innerHTML = '';
    cards.forEach(card => gridEl.appendChild(card));

    summaryEl.textContent = latestUpdatedAt
        ? `最新更新: ${formatJaDateTime(latestUpdatedAt)}`
        : '最新の運行情報を表示しています。';
}

function setLoadingState(isLoading) {
    formEl.classList.toggle('is-loading', isLoading);
    departureInput.disabled = isLoading;
    arrivalInput.disabled = isLoading;
    swapBtn.disabled = isLoading;
    detailBtn.disabled = isLoading;
}

function setupMobileHeaderTransition() {
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const container = document.querySelector('.page-container');
    const mainEl = document.querySelector('.page-main.home-main');

    function updateHeaderState(e) {
        if (!mobileQuery.matches) {
            document.body.classList.remove('is-header-scrolled');
            return;
        }

        // 入力サジェストなど内部要素のスクロール発火は除外する
        if (e && e.target && e.target.nodeType === 1) {
            const targetTag = e.target.tagName.toLowerCase();
            if (targetTag !== 'div' && targetTag !== 'main' && targetTag !== 'body' && targetTag !== 'html') {
                return;
            }
            if (e.target.classList.contains('field-suggestions')) {
                return;
            }
        }

        // 各主要スクロールコンテナからscrollTopを取得
        // design-systemの定義により .page-container や main など特定要素がスクロール領域になる環境も対応
        const currentScroll = Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            document.body.scrollTop || 0,
            (container ? container.scrollTop : 0),
            (mainEl ? mainEl.scrollTop : 0)
        );

        if (currentScroll > 4) {
            document.body.classList.add('is-header-scrolled');
        } else {
            document.body.classList.remove('is-header-scrolled');
        }
    }

    updateHeaderState();

    // すべての可能性のあるスクロール領域にイベントをアタッチし、
    // トランジションが確実に発火するようにcapture: trueを使用（scrollイベントはバブリングしないため）
    window.addEventListener('scroll', updateHeaderState, { passive: true, capture: true });

    if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', updateHeaderState);
    } else if (typeof mobileQuery.addListener === 'function') {
        mobileQuery.addListener(updateHeaderState);
    }
}

async function init() {
    setLoadingState(true);
    setupMobileHeaderTransition();

    try {
        ({ model } = await loadPublicModel({}));
        setupStationInput('home-departure');
        setupStationInput('home-arrival');
        renderStatusGrid();
        setLoadingState(false);
    } catch (error) {
        console.error(error);
        summaryEl.textContent = '運行情報を読み込めませんでした。';
        gridEl.innerHTML = '';

        const fallbackCard = document.createElement('article');
        fallbackCard.className = 'status-card status-card--warning';
        fallbackCard.innerHTML = '<div class="status-card-title">運行情報</div><div class="status-card-icon" aria-hidden="true">！</div><div class="status-card-text">読み込み失敗</div>';
        gridEl.appendChild(fallbackCard);

        const otherCard = document.createElement('article');
        otherCard.className = 'status-card status-card--warning';
        otherCard.innerHTML = '<div class="status-card-title">その他の路線</div><div class="status-card-icon" aria-hidden="true">！</div><div class="status-card-text">読み込み失敗</div>';
        gridEl.appendChild(otherCard);

        setLoadingState(false);
    }
}

formEl.addEventListener('submit', event => {
    event.preventDefault();
    clearSearchError();

    const departure = departureInput.value.trim();
    const arrival = arrivalInput.value.trim();
    const departureStation = findStationByName(departure);
    const arrivalStation = findStationByName(arrival);

    if (!departure || !arrival) {
        showSearchError('出発駅と到着駅の両方を入力してください。');
        return;
    }

    if (!departureStation || !arrivalStation) {
        showSearchError('駅名が正しく入力されていません。候補から選んでください。');
        return;
    }

    window.location.href = buildRouteUrl(departureStation, arrivalStation);
});

swapBtn.addEventListener('click', () => {
    const departure = departureInput.value;
    departureInput.value = arrivalInput.value;
    arrivalInput.value = departure;
    clearSearchError();

    // アニメーションをトリガー
    swapBtn.classList.remove('is-spinning');
    void swapBtn.offsetWidth; // リフローを強制してアニメーションをリセット
    swapBtn.classList.add('is-spinning');
});
swapBtn.addEventListener('animationend', () => {
    swapBtn.classList.remove('is-spinning');
});

detailBtn.addEventListener('click', () => {
    const departure = departureInput.value.trim();
    const arrival = arrivalInput.value.trim();
    const departureStation = findStationByName(departure);
    const arrivalStation = findStationByName(arrival);
    window.location.href = buildRouteUrl(departureStation, arrivalStation);
});

setupBottomSheet();
setupNoopLinks();

init();
