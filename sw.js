// Time clock service worker:
// - opens the app straight from the copy saved on the phone, so it appears instantly, with or without signal.
//   Each time the app opens it downloads the newest files in the background (asking the server for the newest
//   version, so an update you push to GitHub isn't hidden by the browser's cache). Once all of them have arrived
//   they replace the saved copy together, and if any changed the open pages are told ("tc-updated"): pwa.js then
//   reloads to the new version when nobody is in the middle of a punch.
// - keeps a copy of the Firebase code and the fonts the app loads from Google, so it opens with no signal too
//   (those files never change at the same address, so the saved copy is used first),
// - shows the punch-in reminders the server pushes while the time clock is closed (functions/index.js),
// - lets the page show its own reminders as system notifications (Android Chrome needs a service worker for that),
// - opens the clock when a notification is tapped (a "vehicle swap" notification opens the vehicle picker).
// Firebase's own traffic (the database and sign-in) always goes straight to the network.

const CACHE = "tc-offline-v2";
const SHELL = [
    "./", "index.html", "admin.html", "tc-core.js", "pwa.js", "firebase-config.js", "push-config.js", "maps-config.js",
    "clock.webmanifest", "admin.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "icon-logo.png", "apple-touch-icon.png", "favicon.ico"
];
// The Firebase code the pages import (keep the version the same as in tc-core.js, index.html and admin.html)
const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";
const SDK_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-database.js", "firebase-messaging.js"].map(f => SDK + f);
const LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const CODE = /(\/|\.html|\.js|\.webmanifest)$/; // files whose change is a new version of the app (not the pictures)
const REFRESH_GAP_MS = 30 * 1000;               // look for a new version at most this often

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
    if (!req.url.startsWith(self.registration.scope)) return;
    if (req.destination === "") return; // the app's own fetch() calls (pwa.js) always ask the server
    event.respondWith(appFile(event));
});

// pwa.js asks for a check while the app stays open (on return to it, and every 20 minutes)
self.addEventListener("message", event => {
    if (event.data && event.data.type === "tc-refresh") event.waitUntil(refresh().catch(() => {}));
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

// The app's pages and files: the saved copy right away (the page opening also starts a check for a new
// version), else download it and save it
async function appFile(event) {
    const req = event.request;
    const cache = await caches.open(CACHE);
    const saved = await cache.match(req, { ignoreSearch: true });
    if (saved) {
        if (req.mode === "navigate") event.waitUntil(refresh().catch(() => {}));
        return saved;
    }
    try {
        const fresh = await download(req.url);
        if (fresh.ok && fresh.type === "basic") event.waitUntil(cache.put(req.url.split("?")[0], fresh.clone()).catch(() => {}));
        return fresh;
    } catch (err) {
        // no signal and nothing saved for this address: the clock's main page, if there is one
        const page = req.mode === "navigate" ? await cache.match(self.registration.scope) : null;
        if (page) return page;
        throw err;
    }
}

// "no-cache": always check with the server, so a new version is never hidden by the browser's cache.
// A page that was redirected (e.g. /timeclock → /timeclock/) can't be handed back or saved as-is.
async function download(url) {
    const res = await fetch(new Request(url, { cache: "no-cache", credentials: "same-origin", redirect: "follow" }));
    return res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

// Downloads the newest copy of every app file. Nothing is replaced until all of them have arrived, so the
// app never opens half old and half new; with no signal (or a file that won't download) the saved copy stays.
let refreshing = null, refreshedAt = 0;
function refresh() {
    if (refreshing) return refreshing;
    if (Date.now() - refreshedAt < REFRESH_GAP_MS) return Promise.resolve();
    refreshing = (async () => {
        const cache = await caches.open(CACHE);
        const urls = new Set(SHELL.map(u => new URL(u, self.registration.scope).href));
        for (const req of await cache.keys()) if (req.url.startsWith(self.registration.scope) && !req.url.includes("?")) urls.add(req.url);
        const files = await Promise.all([...urls].map(async url => ({ url: url, res: await download(url) })));
        let changed = false;
        const keep = [];
        for (const { url, res } of files) {
            if (!res.ok || res.type !== "basic") continue; // gone from the server: keep the saved copy
            if (CODE.test(new URL(url).pathname)) {
                const old = await cache.match(url);
                if (old && await old.text() !== await res.clone().text()) changed = true;
            }
            keep.push(cache.put(url, res));
        }
        await Promise.all(keep);
        refreshedAt = Date.now();
        if (changed) {
            const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            pages.forEach(page => page.postMessage({ type: "tc-updated" }));
        }
    })().finally(() => { refreshing = null; });
    return refreshing;
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
                    client.postMessage({ type: "tc-open", url: target }); // e.g. …?swap=1 tells the open clock to show the vehicle picker
                    return client.focus();
                }
            }
            return self.clients.openWindow ? self.clients.openWindow(target) : null;
        })
    );
});
