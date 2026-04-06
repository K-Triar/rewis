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

  // HTML/JSON は常に最新を優先（失敗時のみキャッシュにフォールバック）
  if (isSameOrigin && (isHtmlRequest || isJsonRequest)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // それ以外の静的リソースはキャッシュ優先で高速表示
  event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    if (response && response.status === 200 && response.type !== 'error') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
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
