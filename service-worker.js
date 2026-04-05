const CACHE_NAME = 'rewis-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/about.html',
  '/information.html',
  '/transfer.html',
  '/operation.html',
  '/editor.html',
  '/style.css',
  '/index_style.css',
  '/editor.css',
  '/data.json',
  '/new_data.json'
];

// インストールイベント
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache).catch((error) => {
          console.log('キャッシュの一部が利用できません:', error);
        });
      })
  );
});

// フェッチイベント
self.addEventListener('fetch', (event) => {
  // GETリクエストのみ処理
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // キャッシュがあればそれを返す
        if (response) {
          return response;
        }

        return fetch(event.request).then((response) => {
          // ステータスコードが失敗している場合はそのまま返す
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          // 正常なレスポンスをキャッシュに追加
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
        }).catch((error) => {
          console.log('フェッチ失敗:', error);
          // オフライン時のオプション：キャッシュ内のオフラインページを返す
          return caches.match('/index.html');
        });
      })
  );
});

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
});
