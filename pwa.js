// Installable-app (PWA) support shared by the time clock and the admin panel:
// - registers the service worker (sw.js), which fetches the newest files on every open,
// - shows an "Install app" button until the app is installed: it opens the browser's install
//   prompt where there is one (Android / desktop Chrome and Edge), otherwise shows the steps,
// - checks for a newer version of the app while it stays open (on return to the app and
//   every 20 minutes) and reloads to it automatically, but only when isBusy() says it's safe.
// Nothing needs bumping when the files change: updates are detected from the file contents.

const CHECK_EVERY_MS = 20 * 60 * 1000;
const RETRY_BUSY_MS = 30 * 1000;
// The files that make up each page; a change to any of them means a new version
const SHARED_FILES = ["tc-core.js", "pwa.js", "firebase-config.js", "push-config.js"];

export function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * installButton: the <button> shown until the app is installed
 * toast(text, warn): shows a short message
 * isBusy(): true while an automatic reload would interrupt the user
 * Returns { registration: Promise<ServiceWorkerRegistration|null> }
 */
export function setupPwa({ installButton, toast, isBusy }) {
    const registration = "serviceWorker" in navigator
        ? navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(err => { console.warn("Service worker:", err); return null; })
        : Promise.resolve(null);

    setupInstall(installButton, toast);
    setupUpdates(registration, toast, isBusy || (() => false));
    return { registration };
}

function setupInstall(button, toast) {
    if (!button) return;
    if (isStandalone()) { button.hidden = true; return; } // already running as the installed app
    const manifest = document.querySelector('link[rel="manifest"]');
    const key = "tc_installed_" + (manifest ? manifest.getAttribute("href") : location.pathname);
    let deferred = null, installed = false;
    try { installed = localStorage.getItem(key) === "1"; } catch (e) {}
    const remember = (value) => { installed = value; try { localStorage.setItem(key, value ? "1" : "0"); } catch (e) {} };
    const render = () => { button.hidden = installed; };
    render();

    // Chrome/Edge can tell us if this app is already installed on the device (manifest related_applications)
    if (navigator.getInstalledRelatedApps) {
        navigator.getInstalledRelatedApps().then(apps => { if (apps && apps.length) { remember(true); render(); } }).catch(() => {});
    }
    // The browser only offers this when the app is NOT installed
    window.addEventListener("beforeinstallprompt", e => {
        e.preventDefault(); // use our button instead of the browser's mini bar
        deferred = e;
        remember(false);
        render();
    });
    window.addEventListener("appinstalled", () => { deferred = null; remember(true); render(); });

    button.addEventListener("click", async () => {
        if (deferred) {
            const prompt = deferred;
            deferred = null;
            prompt.prompt();
            const choice = await prompt.userChoice.catch(() => null);
            if (choice && choice.outcome === "accepted") { remember(true); render(); }
        } else if (isIOS()) {
            toast("To install: tap the Share button, then “Add to Home Screen”.");
        } else {
            toast("To install: open your browser menu (⋮) and tap “Install app” or “Add to Home screen”.");
        }
    });
}

// ---------- Automatic updates while the app stays open ----------
async function fingerprint() {
    const page = location.pathname.endsWith("/") ? "index.html" : location.pathname.split("/").pop();
    const texts = await Promise.all([page].concat(SHARED_FILES).map(async file => {
        // "no-cache" asks the server whether the file changed (a cheap "not modified" reply when it hasn't)
        const res = await fetch(file, { cache: "no-cache" });
        if (!res.ok) throw new Error(file + " returned " + res.status);
        return file + "\n" + await res.text();
    }));
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texts.join("\n\u0000\n")));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

function setupUpdates(registration, toast, isBusy) {
    let baseline = null, checking = false, pending = false, reloading = false;

    async function check() {
        if (checking || reloading || !navigator.onLine) return;
        checking = true;
        try {
            const reg = await registration;
            if (reg) reg.update().catch(() => {}); // also pick up a new sw.js
            const current = await fingerprint();
            if (baseline === null) baseline = current;
            else if (current !== baseline) pending = true;
        } catch (e) {
            // offline or a file briefly unavailable: try again next time
        } finally {
            checking = false;
        }
        if (pending) applyUpdate();
    }

    function applyUpdate() {
        if (reloading) return;
        if (document.visibilityState !== "visible" || isBusy()) {
            setTimeout(applyUpdate, RETRY_BUSY_MS);
            return;
        }
        reloading = true;
        toast("Updating to the latest version…");
        setTimeout(() => location.reload(), 1200);
    }

    // Baseline a few seconds after load (the files this page is running), then keep checking
    setTimeout(check, 4000);
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    window.addEventListener("online", check);
}
