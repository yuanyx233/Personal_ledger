/* global self, caches */

import {
  NETWORK_ONLY,
  SHELL_NETWORK_FIRST,
  isCacheableStaticResponse,
  serviceWorkerRequestStrategy,
} from "./service-worker-policy.js";

const CACHE_PREFIX = "personal-ledger-static-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_CACHE_KEY = new Request(new URL("/__personal-ledger_shell__", self.location.origin));

async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    if (
      isCacheableStaticResponse(response) &&
      response.headers.get("Content-Type")?.includes("text/html")
    ) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(SHELL_CACHE_KEY, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(SHELL_CACHE_KEY);
    return (
      cached ??
      new Response(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>离线 · Personal Ledger</title><body><main><h1>当前处于离线状态</h1><p>重新联网后再试；不会显示缓存的交易记录。</p></main></body></html>',
        {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
          },
          status: 503,
        },
      )
    );
  }
}

async function networkFirstStatic(request) {
  try {
    const response = await fetch(request);
    if (isCacheableStaticResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("STATIC_ASSET_OFFLINE");
  }
}

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const strategy = serviceWorkerRequestStrategy(event.request, self.location.origin);
  if (strategy === NETWORK_ONLY) {
    return;
  }
  event.respondWith(
    strategy === SHELL_NETWORK_FIRST
      ? networkFirstShell(event.request)
      : networkFirstStatic(event.request),
  );
});
