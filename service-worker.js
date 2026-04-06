const CACHE_NAME = 'rewis-v3';
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');

function toScopedPath(path) {
  const base = SCOPE_PATH === '/' ? '' : SCOPE_PATH;
  return `${base}${path}`;
}

const APP_SHELL_URLS = [
  toScopedPath('/'),
  toScopedPath('/index.html'),
  toScopedPath('/about.html'),
  toScopedPath('/information.html'),
  toScopedPath('/transfer.html'),
  toScopedPath('/operation.html'),
  toScopedPath('/editor.html'),
  toScopedPath('/style.css'),
  toScopedPath('/index_style.css'),
  toScopedPath('/editor.css'),
  toScopedPath('/editor.js'),
  toScopedPath('/transfer_app.js'),
  toScopedPath('/operation_app.js')
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
  const isHtmlRequest = event.request.mode === 'navigate' || event.request.destination === 'document';
  const isJsonRequest = requestUrl.pathname.endsWith('.json');
  const isScriptOrStyleRequest =
    event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    requestUrl.pathname.endsWith('.js') ||
    requestUrl.pathname.endsWith('.css');
  const isWorkerApiRequest = requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.includes('/api/') || requestUrl.pathname.includes('/data/');

  // Worker API リクエスト（/api/*、/data/latest など）は常にネットワーク優先で、キャッシュ保存しない
  if (isSameOrigin && isWorkerApiRequest) {
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
      const fallback = await caches.match('/index.html');
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
