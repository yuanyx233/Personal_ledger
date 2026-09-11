export const NETWORK_ONLY = "NETWORK_ONLY";
export const SHELL_NETWORK_FIRST = "SHELL_NETWORK_FIRST";
export const STATIC_NETWORK_FIRST = "STATIC_NETWORK_FIRST";

const PRIVATE_PATH_PREFIXES = ["/api/", "/exports/"];
const CACHEABLE_DESTINATIONS = new Set(["font", "image", "script", "style"]);
const VERSIONED_ASSET_PATH = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[^/]+$/;

export function serviceWorkerRequestStrategy(request, appOrigin) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return NETWORK_ONLY;
  }
  if (
    request.method !== "GET" ||
    url.origin !== appOrigin ||
    PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    return NETWORK_ONLY;
  }
  if (request.mode === "navigate") return SHELL_NETWORK_FIRST;
  if (CACHEABLE_DESTINATIONS.has(request.destination) && VERSIONED_ASSET_PATH.test(url.pathname)) {
    return STATIC_NETWORK_FIRST;
  }
  return NETWORK_ONLY;
}

export function isCacheableStaticResponse(response) {
  const cacheControl = response.headers.get("Cache-Control")?.toLowerCase() ?? "";
  return response.ok && !/(?:^|,)\s*(?:no-store|no-cache|private)(?:\s|,|$)/.test(cacheControl);
}
