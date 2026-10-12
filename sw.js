// Time clock service worker:
// - shows the punch-in reminders the server pushes while the time clock is closed (functions/index.js),
// - lets the page show its own reminders as system notifications (Android Chrome needs a service worker for that),
// - opens the clock when a notification is tapped.
// It does not cache anything, so the clock always loads the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

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
                if (client.url.startsWith(self.registration.scope) && "focus" in client) return client.focus();
            }
            return self.clients.openWindow ? self.clients.openWindow(target) : null;
        })
    );
});
