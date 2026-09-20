// NorthVenture Valbona Trails — Service Worker
// Strategy:
//  - App shell (this page + manifest + icons + the CDN libraries it needs):
//    cache-first, so the app opens instantly and works with no signal.
//  - Map tiles (OpenTopoMap + Esri satellite imagery): cache-first with a
//    long lifetime, so areas you've already viewed stay available offline.
//    Tiles are added to the cache as you pan/zoom while online — visit the
//    trail area at least once with a connection before you head out.
//  - Weather API: network-first, since it's only useful when it's fresh.

const APP_SHELL_CACHE = "nv-valbona-shell-v1";
const TILE_CACHE = "nv-valbona-tiles-v1";

const APP_SHELL_FILES = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.js",
  "https://unpkg.com/leaflet-image@0.4.0/leaflet-image.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js"
];

// Hosts whose responses are map tiles worth caching for offline hiking.
const TILE_HOSTS = [
  "tile.opentopomap.org",
  "server.arcgisonline.com"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      // Add files individually so one failed CDN fetch doesn't block install.
      return Promise.all(
        APP_SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn("Precache failed:", url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== APP_SHELL_CACHE && name !== TILE_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

function isTileRequest(url) {
  return TILE_HOSTS.some((host) => url.hostname.endsWith(host));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Map tiles: cache-first, cache whatever gets fetched for next time.
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request)
            .then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => cached); // offline and not cached: nothing we can do for this tile
        })
      )
    );
    return;
  }

  // Weather: network-first, fall back to nothing meaningful offline.
  if (url.hostname.endsWith("api.open-meteo.com")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  // Everything else (the page itself, Leaflet/jsPDF libraries, icons):
  // cache-first so the app shell works offline, refresh cache in background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
