// Time clock service worker:
// - loads every app file from the network first, asking the server for the newest version
//   each time, so an update you push to GitHub reaches installed apps on their next open.
//   A saved copy is used only when the phone is offline, so the app still opens.
// - shows the punch-in reminders the server pushes while the time clock is closed (functions/index.js),
// - lets the page show its own reminders as system notifications (Android Chrome needs a service worker for that),
// - opens the clock when a notification is tapped (a "van swap" notification opens the van picker).
// Only this site's own files are handled here; Firebase and Google Fonts go straight to the network.

const CACHE = "tc-offline-v2";
const SHELL = [
    "./", "index.html", "admin.html", "tc-core.js", "pwa.js", "firebase-config.js", "push-config.js", "maps-config.js",
    "clock.webmanifest", "admin.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon-logo.png", "Time.ico"
];

self.addEventListener("install", event => {
    // Save an offline copy of the app (a missing file doesn't stop the install), then take over right away
    event.waitUntil(caches.open(CACHE)
        .then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: "no-cache" })).catch(() => {}))))
        .then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k.startsWith("tc-") && k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return;
    event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
    const cache = await caches.open(CACHE);
    try {
        // "no-cache": always check with the server, so a new version is never hidden by the browser's cache
        const fresh = req.mode === "navigate"
            ? await fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "follow" }))
            : await fetch(new Request(req, { cache: "no-cache" }));
        if (fresh.ok && fresh.type === "basic") cache.put(req.url.split("#")[0], fresh.clone()).catch(() => {});
        // A page that was redirected (e.g. /timeclock → /timeclock/) can't be handed back as-is for a navigation
        return fresh.redirected && req.mode === "navigate"
            ? new Response(fresh.body, { status: fresh.status, statusText: fresh.statusText, headers: fresh.headers })
            : fresh;
    } catch (err) {
        const saved = await cache.match(req, { ignoreSearch: true })
            || (req.mode === "navigate" ? await cache.match(new URL("./", self.registration.scope).href) : null);
        if (saved) return saved;
        throw err;
    }
}

// Firebase Cloud Messaging delivers the server's data-only message here as JSON with a "data" object
self.addEventListener("push", event => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (e) {}
    const d = Object.assign({}, payload.notification || {}, payload.data || {});
    event.waitUntil(self.registration.showNotification(d.title || "E&C Time Clock", {
        body: d.body || "",
        icon: "icon-192.png",
        badge: "icon-192.png",
        tag: d.tag || "tc-push",
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { url: d.url || self.registration.scope }
    }));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || self.registration.scope;
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
            for (const client of list) {
                if (client.url.startsWith(self.registration.scope) && !/admin\.html/.test(client.url) && "focus" in client) {
                    client.postMessage({ type: "tc-open", url: target }); // e.g. …?swap=1 tells the open clock to show the van picker
                    return client.focus();
                }
            }
            return self.clients.openWindow ? self.clients.openWindow(target) : null;
        })
    );
});
