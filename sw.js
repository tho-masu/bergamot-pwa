// アプリ本体は都度更新、エンジンとモデルは一度取ったら使い回す。
// これで2回目以降はネットワークを完全に切っても動きます。

const SHELL = 'nagi-shell-v1';
const ASSETS = 'nagi-assets-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // エンジン(wasm/js)とモデル: キャッシュ優先。サイズが大きく更新も稀なため。
  if (url.pathname.includes('/models/') || url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // アプリ本体: ネットワーク優先、落ちたらキャッシュ。
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((cache) => cache.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
