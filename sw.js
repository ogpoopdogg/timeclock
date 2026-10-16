// Time clock service worker:
// - loads every app file from the network first, asking the server for the newest version
//   each time, so an update you push to GitHub reaches installed apps on their next open.
//   A saved copy is used when the phone is offline, or when the signal is so weak the server doesn't answer within
//   a few seconds, so the app still opens and a driver can punch.
// - keeps a copy of the Firebase code and the fonts the app loads from Google, so it opens with no signal too
//   (those files never change at the same address, so the saved copy is used first),
// - shows the punch-in reminders the server pushes while the time clock is closed (functions/index.js),
// - lets the page show its own reminders as system notifications (Android Chrome needs a service worker for that),
// - opens the clock when a notification is tapped (a "van swap" notification opens the van picker).
// Firebase's own traffic (the database and sign-in) always goes straight to the network.

const CACHE = "tc-offline-v2";
const SHELL = [
    "./", "index.html", "admin.html", "tc-core.js", "pwa.js", "firebase-config.js", "push-config.js", "maps-config.js",
    "clock.webmanifest", "admin.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon-logo.png", "favicon.ico"
];
// The Firebase code the pages import (keep the version the same as in tc-core.js, index.html and admin.html)
const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";
const SDK_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-database.js", "firebase-messaging.js"].map(f => SDK + f);
const LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const SLOW_MS = 3000; // weak signal: open the saved copy if the server hasn't answered by then

self.addEventListener("install", event => {
    // Save an offline copy of the app (a missing file doesn't stop the install), then take over right away
    event.waitUntil(caches.open(CACHE)
        .then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: "no-cache" })).catch(() => {}))
            .concat(SDK_FILES.map(url => cache.match(url).then(hit => hit || cache.add(url)).catch(() => {})))))
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
    if (LIBS.test(req.url)) { event.respondWith(savedFirst(req)); return; }
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return;
    event.respondWith(networkFirst(event));
});

// Firebase code and fonts: the saved copy, else download it and save it for next time
async function savedFirst(req) {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(req.url, { ignoreVary: true });
    if (saved) return saved;
    const fresh = await fetch(req);
    // A font stylesheet comes back unreadable ("opaque"), which is fine to save and hand back as-is
    if (fresh.ok || fresh.type === "opaque") cache.put(req.url, fresh.clone()).catch(() => {});
    return fresh;
}

async function networkFirst(event) {
    const req = event.request;
    const cache = await caches.open(CACHE);
    const network = (async () => {
        // "no-cache": always check with the server, so a new version is never hidden by the browser's cache
        const fresh = req.mode === "navigate"
            ? await fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "follow" }))
            : await fetch(new Request(req, { cache: "no-cache" }));
        if (fresh.ok && fresh.type === "basic") await cache.put(req.url.split("#")[0], fresh.clone()).catch(() => {});
        // A page that was redirected (e.g. /timeclock → /timeclock/) can't be handed back as-is for a navigation
        return fresh.redirected && req.mode === "navigate"
            ? new Response(fresh.body, { status: fresh.status, statusText: fresh.statusText, headers: fresh.headers })
            : fresh;
    })();
    event.waitUntil(network.catch(() => {})); // a slow download carries on and updates the saved copy
    // The page and its files fall back to the saved copy after SLOW_MS. The app's own fetch() calls
    // (the update check in pwa.js) wait for the server, so they never compare against an old copy.
    let timer = null;
    const slow = new Promise(resolve => { if (req.destination !== "") timer = setTimeout(resolve, SLOW_MS, null); });
    try {
        const res = await Promise.race([network, slow]);
        if (res) return res;
    } catch (err) {
        // no signal: use the saved copy below
    } finally {
        clearTimeout(timer);
    }
    const saved = await cache.match(req, { ignoreSearch: true })
        || (req.mode === "navigate" ? await cache.match(new URL("./", self.registration.scope).href) : null);
    return saved || network; // nothing saved: wait for the server after all
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
