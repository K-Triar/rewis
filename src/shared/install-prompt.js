// ブラウザ専用。「ホーム画面に追加（PWAインストール）」の導線をまとめる。
//
// 表示対象: モバイル端末のブラウザで開いているユーザーのみ。
//   - PWAとして起動中（display-mode: standalone 等）は出さない
//   - PCは出さない（PCのChromeでも beforeinstallprompt は発火するため、端末判定で弾く）
//   - LINE/Instagram等のアプリ内ブラウザはインストールできないため出さない
//
// 導線は2種類。どちらもHTML側に hidden で置いておき、条件を満たしたときだけ表示する。
//   - #install-card  : トップページのカード。「閉じる」で一定期間出さない
//   - #sheet-install : 全ページ共通のメニュー（ボトムシート）内の項目。閉じる操作がなく常に控えめに置く
//
// 動作:
//   - Android（Chrome/Edge/Samsung Internet等）: beforeinstallprompt を保持し、ボタン1タップで
//     ブラウザ純正のインストールダイアログを開く。既にインストール済みならイベント自体が来ないので出ない
//   - iOS/iPadOS: インストールAPIがないため、ブラウザ・バージョン別の手順を示すモーダルを開く

const DISMISS_KEY = 'rewis-install-card-dismissed-at';
const DISMISS_DAYS = 30;

let deferredPrompt = null;

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches
        || window.navigator.standalone === true;
}

function isIos() {
    const ua = navigator.userAgent;
    // iPadOS 13+ はデスクトップ版SafariのUAを名乗るため、タッチ点数で見分ける
    return /iPhone|iPad|iPod/.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        if (navigator.userAgentData.mobile) return true;
    }
    return isIos() || /Android/.test(navigator.userAgent);
}

function isInAppBrowser() {
    return /Line\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK/i.test(navigator.userAgent);
}

function isCardDismissed() {
    try {
        const at = Number(localStorage.getItem(DISMISS_KEY));
        if (!at) return false;
        return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch (e) {
        return false;
    }
}

function rememberCardDismissed() {
    try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) { /* プライベートモード等では保存できないが、表示を消すだけで十分 */ }
}

function setEntriesVisible(visible) {
    const card = document.getElementById('install-card');
    const sheetItem = document.getElementById('sheet-install');
    if (card) card.hidden = !(visible && !isCardDismissed());
    if (sheetItem) sheetItem.hidden = !visible;
}

const SHARE_ICON = `
    <span class="install-guide__key" aria-label="共有ボタン">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>
    </span>`;
const MORE_ICON = '<span class="install-guide__key" aria-label="その他ボタン">…</span>';

// iOSのブラウザ・バージョンごとに「ホーム画面に追加」までの手順が違うため出し分ける。
//   - Safari（iOS 26以降）: 共有ボタンがアドレスバー右の「…」の中に移動。「Webアプリとして開く」スイッチが追加された
//   - Safari（iOS 18以前）: 画面下部（iPadは上部）の共有ボタンから
//   - Chrome（CriOS）: アドレスバー右の共有ボタンから
//   - Edge / Firefox 等: 共有の入口が各アプリのメニュー内にあるため、共通の言い方にとどめる
// Safari 26 はUAのOSバージョンを 18_x に固定しているので、iOSのメジャー版は Version/xx から読む。
function getIosGuideSteps() {
    const ua = navigator.userAgent;
    if (/CriOS/.test(ua)) {
        return [
            `アドレスバー右側の共有ボタン${SHARE_ICON}をタップ`,
            '「ホーム画面に追加」をタップ（見当たらない場合は下にスクロール）',
            '「追加」をタップ',
        ];
    }
    if (/EdgiOS|FxiOS|OPiOS/.test(ua)) {
        return [
            `ブラウザのメニューから「共有」${SHARE_ICON}をタップ`,
            '「ホーム画面に追加」をタップ（見当たらない場合は下にスクロール）',
            '「追加」をタップ',
        ];
    }
    const safariVersion = Number((ua.match(/Version\/(\d+)/) || [])[1]);
    if (safariVersion >= 26) {
        return [
            `アドレスバー右側の${MORE_ICON}をタップし、「共有」${SHARE_ICON}を選ぶ`,
            '「ホーム画面に追加」をタップ（見当たらない場合は「その他」から、または下にスクロール）',
            '「Webアプリとして開く」がオンのまま「追加」をタップ',
        ];
    }
    return [
        `画面下部（iPadは上部）の共有ボタン${SHARE_ICON}をタップ`,
        '「ホーム画面に追加」をタップ（見当たらない場合は下にスクロール）',
        '「追加」をタップ',
    ];
}

function showIosGuide() {
    let overlay = document.getElementById('install-guide');
    if (!overlay) {
        const steps = getIosGuideSteps().map((step) => `<li>${step}</li>`).join('');
        overlay = document.createElement('div');
        overlay.id = 'install-guide';
        overlay.className = 'modal-overlay install-guide';
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
                <h3 id="install-guide-title">ホーム画面に追加</h3>
                <p>次の手順で、REWISをアプリのようにホーム画面から開けるようになります。</p>
                <ol>${steps}</ol>
                <div class="modal-actions">
                    <button type="button" class="btn btn-neutral-pill" data-install-guide-close>閉じる</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay || ev.target.closest('[data-install-guide-close]')) {
                overlay.hidden = true;
            }
        });
    }
    overlay.hidden = false;
}

async function startInstall() {
    if (deferredPrompt) {
        const promptEvent = deferredPrompt;
        // prompt() は1つのイベントにつき1回しか呼べない。次の beforeinstallprompt が来るまで導線を隠す
        deferredPrompt = null;
        setEntriesVisible(false);
        promptEvent.prompt();
        try { await promptEvent.userChoice; } catch (e) { /* noop */ }
        return;
    }
    if (isIos()) showIosGuide();
}

export function setupInstallPrompt() {
    if (isStandalone() || !isMobileDevice() || isInAppBrowser()) return;

    const card = document.getElementById('install-card');
    const sheetItem = document.getElementById('sheet-install');

    if (card) {
        const action = card.querySelector('[data-install-action]');
        const close = card.querySelector('[data-install-close]');
        if (action) action.addEventListener('click', startInstall);
        if (close) close.addEventListener('click', () => {
            rememberCardDismissed();
            card.hidden = true;
        });
    }
    if (sheetItem) sheetItem.addEventListener('click', startInstall);

    window.addEventListener('beforeinstallprompt', (event) => {
        // ブラウザ既定のミニバーは出さず、REWIS側の導線から開く
        event.preventDefault();
        deferredPrompt = event;
        setEntriesVisible(true);
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        setEntriesVisible(false);
    });

    if (isIos()) setEntriesVisible(true);
}
