// ブラウザ専用。transfer_app.js・operation_app.js・index.html にあった同じ処理を1か所にまとめる。
// 動作と見た目は変えない。

export function showShareDialog(url, { title = '検索結果を共有する', ariaLabel = '検索結果を共有' } = {}) {
  let existing = document.getElementById('share-modal');
  if (existing) {
    const input = existing.querySelector('.share-url-input');
    if (input) input.value = url;
    existing.style.display = 'flex';
    try { existing.querySelector('.share-url-input').select(); } catch (e) {}
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'share-modal';
  modal.className = 'share-modal';

  modal.innerHTML = `
        <div class="share-modal-content" role="dialog" aria-modal="true" aria-label="${ariaLabel}">
            <h3>${title}</h3>
            <p>以下のURLを共有してください。</p>
            <input class="share-url-input" type="text" readonly aria-label="共有URL">
            <div class="share-modal-actions">
                <button type="button" class="back-to-search-btn share-copy-btn">コピー</button>
                <button type="button" class="back-to-search-btn share-native-btn">共有</button>
                <button type="button" class="back-to-search-btn share-close-btn">閉じる</button>
            </div>
        </div>
    `;

  document.body.appendChild(modal);

  const input = modal.querySelector('.share-url-input');
  const copyBtn = modal.querySelector('.share-copy-btn');
  const nativeBtn = modal.querySelector('.share-native-btn');
  const closeBtn = modal.querySelector('.share-close-btn');

  input.value = url;
  try { input.select(); } catch (e) {}

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      copyBtn.textContent = 'コピーしました';
      setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
    } catch (err) {
      try { input.select(); } catch (e) {}
      copyBtn.textContent = 'クリップボード失敗';
      setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
    }
  });

  nativeBtn.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url: input.value });
      } catch (e) { /* user cancelled or failed */ }
    } else {
      try {
        await navigator.clipboard.writeText(input.value);
        nativeBtn.textContent = 'コピーしました';
        setTimeout(() => { nativeBtn.textContent = '共有'; }, 1500);
      } catch (err) {
        try { input.select(); } catch (e) {}
      }
    }
  });

  function closeModal() {
    modal.style.display = 'none';
  }

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeModal();
  });
}

export function openBottomSheet() {
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

export function closeBottomSheet() {
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

export function setupBottomSheet() {
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
    items.forEach((item) => {
      item.addEventListener('click', () => closeBottomSheet());
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', () => closeBottomSheet());
  }
  if (closeBtn) closeBtn.addEventListener('click', closeBottomSheet);
}

let _loadingPreventHandlers = null;

export function showLoading() {
  const el = document.getElementById('loading-section');
  if (!el) return;
  el.style.display = 'flex';

  try {
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      const onTouchMove = function (e) { e.preventDefault(); };
      const onWheel = function (e) { e.preventDefault(); };
      const onKeyDown = function (e) {
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

export function hideLoading() {
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

export function showError(message) {
  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');
  if (!errorSection || !errorMessage) return;

  errorMessage.innerHTML = '';

  const msgSpan = document.createElement('span');
  msgSpan.className = 'error-text';
  msgSpan.textContent = message;
  msgSpan.setAttribute('role', 'status');
  msgSpan.setAttribute('aria-live', 'assertive');
  errorMessage.appendChild(msgSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'error-close';
  closeBtn.setAttribute('aria-label', '閉じる');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', hideError);
  errorMessage.appendChild(closeBtn);

  errorSection.style.display = 'block';
}

export function hideError() {
  const errorSection = document.getElementById('error-section');
  if (!errorSection) return;
  errorSection.style.display = 'none';
  const errorMessage = document.getElementById('error-message');
  if (errorMessage) errorMessage.innerHTML = '';
  if (errorSection._hideTimeout) {
    clearTimeout(errorSection._hideTimeout);
    errorSection._hideTimeout = null;
  }
}

export function setupHelpModal() {
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

export function setupNoopLinks() {
  document.querySelectorAll('a[data-noop="true"], a.is-current-page').forEach((link) => {
    link.addEventListener('click', (e) => e.preventDefault());
  });
}
