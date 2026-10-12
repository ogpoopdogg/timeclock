// Time clock service worker: lets the page show punch-in reminders as system notifications
// (Android Chrome only shows notifications through a service worker) and opens the clock when one is tapped.
// It does not cache anything, so the clock always loads the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

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
