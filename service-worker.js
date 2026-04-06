const CACHE_NAME = 'rewis-v2';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/about.html',
  '/information.html',
  '/transfer.html',
  '/operation.html',
  '/editor.html',
  '/style.css',
  '/index_style.css',
  '/editor.css'
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
  const isWorkerApiRequest = requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.includes('/data/');

  // Worker API リクエスト（/api/*、/data/latest など）は常にネットワーク優先で、キャッシュ保存しない
  if (isSameOrigin && isWorkerApiRequest) {
    event.respondWith(networkOnlyNoCache(event.request));
    return;
  }

  // HTML/JSON は通常のネットワーク優先（ただしキャッシュリフレッシュ機構を使用）
  if (isSameOrigin && (isHtmlRequest || isJsonRequest)) {
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
