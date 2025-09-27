/// <reference lib="WebWorker" />

declare const self: ServiceWorkerGlobalScope;

const APP_SHELL_CACHE = 'preburner-shell-v1';
const DATA_CACHE = 'preburner-data-v1';
const APP_SHELL_ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const OFFLINE_PLAN_PATH = 'offline-plan.json';

function resolveWithinScope(path: string): string {
  const scopeUrl = new URL(self.registration.scope);
  return new URL(path, scopeUrl).toString();
}

async function precacheAppShell(): Promise<void> {
  const cache = await caches.open(APP_SHELL_CACHE);
  const urls = APP_SHELL_ASSETS.map((asset) => resolveWithinScope(asset));
  await cache.addAll(urls);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

async function cleanupOldCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith('preburner-') && key !== APP_SHELL_CACHE && key !== DATA_CACHE)
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await cleanupOldCaches();
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request: Request, fallbackRequest: Request): Promise<Response> {
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(fallbackRequest, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(APP_SHELL_CACHE);
    const cached = await cache.match(fallbackRequest, { ignoreSearch: true });
    if (cached) {
      return cached;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    const indexRequest = new Request(resolveWithinScope('index.html'));
    event.respondWith(networkFirst(request, indexRequest));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.endsWith(OFFLINE_PLAN_PATH)) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'font') {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }

  if (request.destination === 'image' || url.pathname.endsWith('.json')) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
  }
});

interface PlanSnapshot {
  windows: unknown;
  weekly: unknown;
  workouts: unknown;
  timestamp: string;
}

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; payload?: PlanSnapshot } | undefined;
  if (!data || data.type !== 'PREBURNER_CACHE_PLAN' || !data.payload) {
    return;
  }

  const snapshot = data.payload;
  const response = new Response(JSON.stringify(snapshot), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

  event.waitUntil(
    caches.open(DATA_CACHE).then((cache) => {
      const request = new Request(resolveWithinScope(OFFLINE_PLAN_PATH));
      return cache.put(request, response);
    }),
  );
});

export {};
