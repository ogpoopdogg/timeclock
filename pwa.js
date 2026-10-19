// Installable-app (PWA) support shared by the time clock and the admin panel:
// - registers the service worker (sw.js), which opens the app from the copy saved on the phone and
//   fetches the newest files in the background on every open,
// - shows an "Install app" button until the app is installed. It opens the browser's install prompt where
//   there is one (Android / desktop Chrome and Edge), otherwise a sheet with the steps for that phone and
//   browser (iPhone Safari, other iPhone browsers, apps like Facebook or Gmail that open links inside
//   themselves, other Android browsers, computers),
// - on a phone, opens that sheet by itself when the page is opened in the browser (at most once a day,
//   never once they say it's installed),
// - reloads to a newer version once sw.js has saved one (it looks on every open, on return to the app
//   and every 20 minutes), but only when isBusy() says it's safe.
// Nothing needs bumping when the files change: updates are detected from the file contents.

const CHECK_EVERY_MS = 20 * 60 * 1000;
const RETRY_BUSY_MS = 30 * 1000;
const AUTO_SHOW_GAP_MS = 24 * 60 * 60 * 1000; // the install steps open by themselves at most once a day
const AUTO_SHOW_DELAY_MS = 1500;
// The files that make up each page; a change to any of them means a new version
const SHARED_FILES = ["tc-core.js", "pwa.js", "firebase-config.js", "push-config.js"];

export function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Apps that open links inside themselves, where "Add to Home Screen" isn't offered
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Snapchat|LinkedInApp|TikTok|musical_ly|BytedanceWebview|Line\/|Pinterest|Twitter|GSA\//;

/**
 * Which install steps fit this browser:
 * "ios-safari", "ios-other" (Chrome, Firefox, Edge… on iPhone), "ios-inapp", "android", "android-inapp",
 * "mac-safari" or "desktop".
 */
export function installKind(ua, platform, touchPoints) {
    const ios = /iphone|ipad|ipod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1);
    if (ios) {
        // Real iPhone browsers all say "Safari/"; an app's built-in browser usually doesn't
        if (IN_APP.test(ua) || !/Safari\//.test(ua)) return "ios-inapp";
        if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|YaBrowser/.test(ua)) return "ios-other";
        return "ios-safari";
    }
    if (/android/i.test(ua)) return IN_APP.test(ua) || /; wv\)/.test(ua) ? "android-inapp" : "android";
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|Firefox/.test(ua)) return "mac-safari";
    return "desktop";
}

/**
 * installButton: the <button> shown until the app is installed
 * toast(text, warn): shows a short message
 * isBusy(): true while an automatic reload (or the install steps opening by themselves) would interrupt the user
 * Returns { registration: Promise<ServiceWorkerRegistration|null> }
 */
export function setupPwa({ installButton, toast, isBusy }) {
    const registration = "serviceWorker" in navigator
        ? navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(err => { console.warn("Service worker:", err); return null; })
        : Promise.resolve(null);
    const busy = isBusy || (() => false);

    setupInstall(installButton, busy);
    // Don't reload while someone is reading the install steps either
    setupUpdates(registration, toast, () => busy() || !!document.querySelector(".pwa-sheet.show"));
    return { registration };
}

function setupInstall(button, isBusy) {
    if (!button) return;
    if (isStandalone()) { button.hidden = true; return; } // already running as the installed app
    const manifest = document.querySelector('link[rel="manifest"]');
    const key = "tc_installed_" + (manifest ? manifest.getAttribute("href") : location.pathname);
    const shownKey = "tc_install_shown_" + (manifest ? manifest.getAttribute("href") : location.pathname);
    const kind = installKind(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0);
    const phone = /^(ios|android)/.test(kind);
    let deferred = null, installed = false, saidInstalled = false;
    try { installed = localStorage.getItem(key) === "1"; saidInstalled = localStorage.getItem(shownKey) === "never"; } catch (e) {}
    const remember = (value) => { installed = value; try { localStorage.setItem(key, value ? "1" : "0"); } catch (e) {} };
    const render = () => { button.hidden = installed; if (installed) helpSheet.close(); };
    const helpSheet = installSheet(kind, () => deferred, async () => {
        const prompt = deferred;
        deferred = null;
        prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        if (choice && choice.outcome === "accepted") { remember(true); render(); }
    }, () => { saidInstalled = true; try { localStorage.setItem(shownKey, "never"); } catch (e) {} });
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
        if (kind === "android") setTimeout(autoShow, AUTO_SHOW_DELAY_MS);
    });
    window.addEventListener("appinstalled", () => { deferred = null; remember(true); render(); });

    button.addEventListener("click", async () => {
        if (deferred) await helpSheet.install(); // one tap: the browser's own install prompt
        else helpSheet.open();
    });

    // On a phone, open the steps by themselves when the page is opened in the browser. Android Chrome only
    // when it offers its install prompt (it doesn't once the app is installed); iPhones can't tell us, so
    // there it's once a day until they tap "It's installed".
    function autoShow() {
        if (installed || saidInstalled || !phone || helpSheet.isOpen()) return;
        if (kind === "android" && !deferred) return;
        if (document.visibilityState !== "visible" || isBusy()) return;
        const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
        if (typing) return; // e.g. already signing in
        let last = 0;
        try { last = Number(localStorage.getItem(shownKey)) || 0; } catch (e) {}
        if (Date.now() - last < AUTO_SHOW_GAP_MS) return;
        try { localStorage.setItem(shownKey, String(Date.now())); } catch (e) {}
        helpSheet.open();
    }
    if (kind !== "android") setTimeout(autoShow, AUTO_SHOW_DELAY_MS);
}

// ---------- The install steps (a bottom sheet, the same on the clock and the admin panel) ----------
const ICONS = {
    share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"/>',
    add: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
    more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
    menu: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'
};
const icon = name => '<span class="pwa-key" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg></span>';
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SHEET_CSS = `
.pwa-backdrop { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, 0.6); opacity: 0; pointer-events: none; transition: opacity 0.3s; }
.pwa-backdrop.show { opacity: 1; pointer-events: auto; }
.pwa-sheet { position: fixed; left: 50%; bottom: 0; z-index: 201; width: min(520px, 100vw); max-height: 92vh; display: flex; flex-direction: column;
    background: linear-gradient(180deg, #1b1f23, #121517); color: var(--text, #eef0f2); border-radius: 24px 24px 0 0;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16), 0 -30px 80px rgba(0, 0, 0, 0.6);
    transform: translate(-50%, 105%); visibility: hidden; transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0.45s;
    padding-bottom: env(safe-area-inset-bottom, 0px); font-family: var(--font-body, system-ui, sans-serif); text-align: left; }
.pwa-sheet:focus { outline: none; }
.pwa-sheet.show { transform: translate(-50%, 0); visibility: visible; transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1); }
.pwa-head { display: flex; align-items: center; gap: 14px; padding: 22px 22px 6px; }
.pwa-head img { width: 60px; height: 60px; border-radius: 14px; flex: none; box-shadow: 0 0 0 1px rgba(255, 204, 0, 0.45); }
.pwa-head h2 { font-family: var(--font-display, system-ui, sans-serif); font-weight: 800; font-size: 1.8rem; line-height: 1.05; margin: 0; }
.pwa-head p { color: var(--muted, #9aa1a9); margin: 4px 0 0; font-size: 0.95rem; line-height: 1.35; }
.pwa-body { overflow-y: auto; padding: 8px 22px 16px; -webkit-overflow-scrolling: touch; }
.pwa-note { background: rgba(255, 204, 0, 0.12); border: 1px solid rgba(255, 204, 0, 0.4); border-radius: 12px; padding: 10px 12px; margin: 6px 0 4px; font-size: 0.95rem; line-height: 1.4; }
.pwa-steps { list-style: none; margin: 8px 0 0; padding: 0; counter-reset: pwa; }
.pwa-steps li { counter-increment: pwa; position: relative; padding: 12px 0 12px 46px; border-top: 1px solid rgba(255, 255, 255, 0.09); font-size: 1.05rem; line-height: 1.45; }
.pwa-steps li:first-child { border-top: 0; }
.pwa-steps li::before { content: counter(pwa); position: absolute; left: 0; top: 10px; width: 32px; height: 32px; border-radius: 50%;
    background: var(--yellow, #ffcc00); color: #111; font-weight: 800; display: grid; place-items: center; font-size: 1.05rem; }
.pwa-steps small { display: block; color: var(--muted, #9aa1a9); font-size: 0.9rem; margin-top: 2px; }
.pwa-steps b { font-weight: 700; }
.pwa-key { display: inline-grid; place-items: center; width: 30px; height: 30px; margin: -4px 2px; border-radius: 8px; vertical-align: middle;
    background: rgba(255, 255, 255, 0.1); color: #4da3ff; }
.pwa-key svg { width: 20px; height: 20px; }
.pwa-link { display: flex; gap: 8px; margin: 6px 0 2px; }
.pwa-link input { flex: 1; min-width: 0; height: 44px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.16); background: #0c0e10; color: inherit;
    padding: 0 10px; font: inherit; font-size: 0.95rem; }
.pwa-btn { height: 46px; padding: 0 16px; border-radius: 12px; border: 0; font: inherit; font-weight: 700; font-size: 1.05rem; cursor: pointer;
    background: rgba(255, 255, 255, 0.1); color: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.pwa-btn svg { width: 18px; height: 18px; }
.pwa-btn.go { background: var(--yellow, #ffcc00); color: #111; }
.pwa-foot { display: flex; gap: 10px; padding: 12px 22px 18px; border-top: 1px solid rgba(255, 255, 255, 0.09); }
.pwa-foot .pwa-btn { flex: 1; }
`;

function installSheet(kind, getPrompt, runPrompt, onSaidInstalled) {
    const titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const app = escapeHtml(titleMeta ? titleMeta.getAttribute("content") : document.title);
    const link = location.origin + location.pathname;
    let backdrop = null, sheet = null, shown = false, lastFocus = null;

    const copyRow = '<div class="pwa-link"><input type="text" readonly value="' + escapeHtml(link) + '" aria-label="Link to this page">' +
        '<button type="button" class="pwa-btn go" data-copy><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.copy + '</svg>Copy</button></div>';
    const steps = items => '<ol class="pwa-steps">' + items.map(i => "<li>" + i + "</li>").join("") + "</ol>";
    const openIt = "Open <b>" + app + "</b> from your Home Screen.<small>Sign in again if it asks.</small>";

    function content() {
        const iosSteps = [
            "Tap the <b>Share</b> button " + icon("share") + "<small>Don't see it? Tap " + icon("more") + " first.</small>",
            "Scroll down and tap <b>Add to Home Screen</b> " + icon("add") + "<small>Not in the list? Tap <b>View More</b>.</small>",
            "If you see <b>Open as Web App</b>, leave it on. Then tap <b>Add</b>.",
            openIt
        ];
        switch (kind) {
            case "ios-safari":
                return { sub: "Put it on your Home Screen so it opens like an app. It only takes a few taps.", body: steps(iosSteps) };
            case "ios-other":
                return {
                    sub: "Put it on your Home Screen so it opens like an app.",
                    body: steps([
                        "Tap your browser's <b>Share</b> button " + icon("share") + "<small>It's in the address bar or behind " + icon("more") + ".</small>",
                        "Tap <b>Add to Home Screen</b> " + icon("add") + "<small>Not in the list? Tap <b>More</b> or <b>View More</b>.</small>",
                        "Tap <b>Add</b>.",
                        openIt
                    ]) + '<p class="pwa-note">Can\'t find it? Copy the link, open it in <b>Safari</b>, and tap <b>Install</b> there.</p>' + copyRow
                };
            case "ios-inapp":
            case "android-inapp": {
                const browser = kind === "ios-inapp" ? "Safari" : "Chrome";
                return {
                    sub: "Put it on your Home Screen so it opens like an app.",
                    body: '<p class="pwa-note">This page is open inside another app (like Facebook or Gmail), which can\'t install it. Open it in <b>' + browser + "</b> instead.</p>" +
                        steps([
                            "Tap <b>Copy</b> below." + copyRow,
                            "Open <b>" + browser + "</b>, tap the address bar, and paste the link.",
                            "Tap <b>Install</b> at the top of the page and follow the steps."
                        ])
                };
            }
            case "android":
                if (getPrompt()) return { sub: "Tap <b>Install</b> below. It goes on your Home Screen like any other app.", body: "", install: true };
                return {
                    sub: "Put it on your Home Screen so it opens like an app.",
                    body: steps([
                        "Open the browser menu " + icon("menu") + "<small>Top right in Chrome, or ☰ at the bottom in Samsung Internet.</small>",
                        "Tap <b>Install app</b> or <b>Add to Home screen</b>.<small>If it says <b>Open app</b>, it's already installed.</small>",
                        "Tap <b>Install</b> (or <b>Add</b>).",
                        "Open <b>" + app + "</b> from your Home Screen."
                    ])
                };
            case "mac-safari":
                return { sub: "Add it to your Dock so it opens like an app.", body: steps(["In the menu bar, choose <b>File</b> → <b>Add to Dock</b>.", "Click <b>Add</b>."]) };
            default:
                return {
                    sub: "Install it so it opens in its own window like an app.",
                    body: steps([
                        "In Chrome or Edge, click the install icon at the right end of the address bar.<small>Or open the browser menu and look for <b>Install</b>.</small>",
                        "Click <b>Install</b>."
                    ])
                };
        }
    }

    function build() {
        if (sheet) return;
        const style = document.createElement("style");
        style.textContent = SHEET_CSS;
        document.head.appendChild(style);
        backdrop = document.createElement("div");
        backdrop.className = "pwa-backdrop";
        backdrop.addEventListener("click", close);
        sheet = document.createElement("section");
        sheet.className = "pwa-sheet";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        sheet.setAttribute("aria-labelledby", "pwaTitle");
        sheet.setAttribute("aria-hidden", "true");
        sheet.tabIndex = -1;
        sheet.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
        sheet.addEventListener("click", async e => {
            const btn = e.target.closest("button");
            if (!btn) return;
            if (btn.hasAttribute("data-close")) close();
            else if (btn.hasAttribute("data-installed")) { onSaidInstalled(); close(); }
            else if (btn.hasAttribute("data-install")) { close(); if (getPrompt()) await runPrompt(); }
            else if (btn.hasAttribute("data-copy")) copy(btn);
        });
        document.body.append(backdrop, sheet);
    }

    async function copy(btn) {
        const input = btn.parentNode.querySelector("input");
        let ok = false;
        try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {}
        if (!ok) { try { input.focus(); input.select(); ok = document.execCommand("copy"); } catch (e) {} }
        if (!ok) { input.focus(); input.select(); return; } // selected: they can copy it themselves
        btn.lastChild.textContent = "Copied";
        setTimeout(() => { btn.lastChild.textContent = "Copy"; }, 2500);
    }

    function open() {
        build();
        const c = content();
        const ios = kind.startsWith("ios");
        sheet.innerHTML =
            '<div class="pwa-head"><img src="apple-touch-icon.png" alt="" width="60" height="60"><div><h2 id="pwaTitle">Install ' + app + "</h2><p>" + c.sub + "</p></div></div>" +
            (c.body ? '<div class="pwa-body">' + c.body + "</div>" : "") +
            '<div class="pwa-foot">' +
            (c.install ? '<button type="button" class="pwa-btn" data-close>Not now</button><button type="button" class="pwa-btn go" data-install>Install</button>'
                : (ios ? '<button type="button" class="pwa-btn" data-installed>It\'s installed</button>' : "") + '<button type="button" class="pwa-btn go" data-close>OK</button>') +
            "</div>";
        lastFocus = document.activeElement;
        shown = true;
        sheet.setAttribute("aria-hidden", "false");
        backdrop.classList.add("show");
        sheet.classList.add("show");
        sheet.focus({ preventScroll: true }); // so Escape closes it
    }

    function close() {
        if (!shown) return;
        shown = false;
        sheet.setAttribute("aria-hidden", "true");
        backdrop.classList.remove("show");
        sheet.classList.remove("show");
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    return { open, close, isOpen: () => shown, install: runPrompt };
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
    const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;

    // sw.js says "tc-updated" once it has saved a newer version. The page's first lines also listen
    // (window.tcUpdateReady), in case it said so before this file was loaded.
    if (sw) sw.addEventListener("message", e => { if (e.data && e.data.type === "tc-updated") { pending = true; applyUpdate(); } });
    if (window.tcUpdateReady) pending = true;

    async function check() {
        if (checking || reloading || !navigator.onLine) return;
        checking = true;
        try {
            const reg = await registration;
            if (reg) reg.update().catch(() => {}); // also pick up a new sw.js
            // The service worker downloads the newest files and tells us if they changed
            if (sw && sw.controller) { sw.controller.postMessage({ type: "tc-refresh" }); return; }
            // No service worker running this page (yet): compare the files themselves
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

    let retryTimer = null;
    function applyUpdate() {
        if (reloading) return;
        clearTimeout(retryTimer);
        if (document.visibilityState !== "visible" || isBusy()) {
            retryTimer = setTimeout(applyUpdate, RETRY_BUSY_MS);
            return;
        }
        reloading = true;
        toast("Updating to the latest version…");
        setTimeout(() => location.reload(), 1200);
    }

    if (pending) applyUpdate();
    // Baseline a few seconds after load (the files this page is running), then keep checking
    setTimeout(check, 4000);
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    window.addEventListener("online", check);
}
