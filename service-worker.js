const CACHE_NAME = 'rewis-v13';
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');

function toScopedPath(path) {
  const base = SCOPE_PATH === '/' ? '' : SCOPE_PATH;
  return `${base}${path}`;
}

const APP_SHELL_URLS = [
  toScopedPath('/'),
  toScopedPath('/index.html'),
  toScopedPath('/about/'),
  toScopedPath('/information/'),
  toScopedPath('/transfer/'),
  toScopedPath('/operation/'),
  toScopedPath('/editor-v1/'),
  toScopedPath('/editor/'),
  // 旧URL（.html直置き）は移動先へリダイレクトするスタブとして残しているため、オフライン時も動くようキャッシュ対象に含める
  toScopedPath('/about.html'),
  toScopedPath('/information.html'),
  toScopedPath('/transfer.html'),
  toScopedPath('/operation.html'),
  toScopedPath('/editor.html'),
  toScopedPath('/assets/css/style.css'),
  toScopedPath('/assets/css/index-page.css'),
  toScopedPath('/assets/css/transfer-page.css'),
  toScopedPath('/assets/css/operation-page.css'),
  toScopedPath('/assets/design-system/tokens.css'),
  toScopedPath('/assets/design-system/layout.css'),
  toScopedPath('/assets/design-system/components.css'),
  toScopedPath('/src/pages/index.js'),
  toScopedPath('/assets/js/rewis_public_config.js'),
  toScopedPath('/editor-v1/editor.css'),
  toScopedPath('/editor-v1/editor.js'),
  toScopedPath('/src/pages/transfer.js'),
  toScopedPath('/src/pages/operation.js'),
  toScopedPath('/src/shared/validate-v1.js'),
  toScopedPath('/src/shared/escape.js'),
  toScopedPath('/src/shared/ids.js'),
  toScopedPath('/src/shared/schema-v2.js'),
  toScopedPath('/src/shared/convert-v1-to-v2.js'),
  toScopedPath('/src/shared/v1-overrides.js'),
  toScopedPath('/src/shared/notice-text.js'),
  toScopedPath('/src/shared/public-v1.js'),
  toScopedPath('/src/shared/model.js'),
  toScopedPath('/src/shared/data-source.js'),
  toScopedPath('/src/shared/ui-dom.js'),
  toScopedPath('/src/shared/route-search.js')
];

// インストールイベント
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(APP_SHELL_URLS).catch((error) => {
          console.log('キャッシュの一部が利用できません:', error);
        });
      })
  );
  self.skipWaiting();
});

// フェッチイベント
self.addEventListener('fetch', (event) => {
  // GETリクエストのみ処理
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const requestPath = requestUrl.pathname;
  const isHtmlRequest = event.request.mode === 'navigate' || event.request.destination === 'document';
  const isJsonRequest = requestUrl.pathname.endsWith('.json');
  const isScriptOrStyleRequest =
    event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    requestUrl.pathname.endsWith('.js') ||
    requestUrl.pathname.endsWith('.css');
  const isWorkerApiRequest =
    requestPath.startsWith('/api/') ||
    requestPath.includes('/api/') ||
    requestPath.includes('/data/');
  const isNoStoreLikeRequest =
    event.request.cache === 'no-store' ||
    event.request.cache === 'reload' ||
    requestPath.endsWith('/data/latest') ||
    requestPath.endsWith('/data/latest/');

  // API/データ取得や no-store 指定のリクエストはオリジンに関係なく常にネットワークのみ
  // （外部Workersの /data/latest が cacheFirst に入って古いデータ化するのを防ぐ）
  if (isWorkerApiRequest || isNoStoreLikeRequest) {
    event.respondWith(networkOnlyNoCache(event.request));
    return;
  }

  // HTML/JSON/JS/CSS は通常のネットワーク優先（古い資産の固定化を防ぐ）
  if (isSameOrigin && (isHtmlRequest || isJsonRequest || isScriptOrStyleRequest)) {
    event.respondWith(networkFirstWithValidation(event.request));
    return;
  }

  // それ以外の静的リソースはキャッシュ優先で高速表示
  event.respondWith(cacheFirst(event.request));
});

// Worker APIはキャッシュせずにネットワークオンリー
async function networkOnlyNoCache(request) {
  try {
    console.log('Worker API リクエスト（ネットワークのみ）:', request.url);
    const response = await fetch(request);
    console.log('Worker API レスポンス:', response.status, response.statusText);
    return response;
  } catch (error) {
    console.error('Worker API リクエスト失敗:', error);
    // キャッシュなしなのでエラーをそのまま返す
    throw error;
  }
}

// ネットワーク優先だが、レスポンスヘッダを検査してキャッシュを更新
async function networkFirstWithValidation(request) {
  try {
    const response = await fetch(request);

    if (response && response.status === 200 && response.type !== 'error') {
      // キャッシュ制御ヘッダを確認
      const cacheControl = response.headers.get('cache-control') || '';
      
      // Cache-Control に no-store または no-cache がない場合のみキャッシュ保存
      if (!cacheControl.includes('no-store') && !cacheControl.includes('no-cache')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
    }

    return response;
  } catch (error) {
    console.log('ネットワーク取得失敗（キャッシュを利用）:', error);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    if (request.mode === 'navigate') {
      const fallback = await caches.match(toScopedPath('/index.html'));
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.status === 200 && response.type !== 'error') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

// アクティベーションイベント（古いキャッシュを削除）
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});
