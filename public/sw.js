const CACHE_VERSION = "diav1-v2";
const CACHE_NAME = `${CACHE_VERSION}-${self.registration.scope}`;
const OFFLINE_URL = "/offline";

const STATIC_ASSETS = [
  "/",
  "/login",
  "/offline",
  "/manifest.json",
  "/logo_diav1.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();

  self.clients.matchAll().then((clients) => {
    clients.forEach((client) =>
      client.postMessage({ type: "SW_ACTIVATED" })
    );
  });
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Handle push events (received even when app is closed)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SIVAX", body: event.data ? event.data.text() : "New notification" };
  }

  const title = data.title || "SIVAX";
  const options = {
    body: data.body || "You have a new notification",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || `notification-${Date.now()}`,
    data: { url: data.url || "/", buildId: data.buildId || null },
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
  };

  // Update app badge if supported (Android Chrome)
  if (navigator.setAppBadge) {
    self.registration.getNotifications().then((notifications) => {
      const unreadCount = notifications.length + 1;
      navigator.setAppBadge(unreadCount).catch(() => {});
    });
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click for push notifications
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICKED", url: targetUrl });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  if (request.url.includes("/version.json")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method === "GET") {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
