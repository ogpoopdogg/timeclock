// Shared code for the E&C time clock (employee page and admin panel).
//
// Database layout (Firebase Realtime Database, project eandccourier-36fcc):
//   timeclock/settings                 { reminderMinutes, weekStart }
//   timeclock/employees/{ek}           { email, name, active, schedule: { sun..sat: { start, end } } }
//   timeclock/shifts/{ek}/{shiftId}    { in, out, vehicleId, vehicleName, nickname, src, edited,
//                                        inLoc, inAddr, outLoc, outAddr, vans, swapHint }
//       vehicleId/vehicleName/nickname   the van the driver has now
//       inLoc / outLoc                   where the phone was at the punch: { lat, lng, acc, at } or { err }
//       inAddr / outAddr                 the street address for it, added by the admin panel (Google geocoder)
//       vans/{id}                        every van change in the shift: { at, vehicleId, vehicleName, how, by, loc, addr }
//                                        how: "pick" | "swap" | "taken" (another driver took it; written by the server)
//       swapHint                         set by the server when another driver takes this driver's van:
//                                        { at, by, vehicleId, vehicleName, suggestId, suggestName }
//   timeclock/vehicle_claims/{gpsId}   { ek, email, name, nickname, shiftId, vehicleName, at, fromId, fromName }
//   timeclock/prefs/{ek}               { punchReminder: true | false }  the driver's own choice, kept across phones
//   timeclock/audit/{id}               admin edit history
//   timeclock/push_tokens/{ek}/{key}   { token, at, device }  phones that get closed-app reminders
//   timeclock/push_tests/{ek}          written to ask the server for a test notification
//   timeclock/reminders_sent/{day}/{ek} written by the server (functions/) once a reminder is handled
// {ek} is the employee's email in lower case with "." replaced by "," (keys can't contain ".").
//
// GPS units and their nicknames are the ones RouteWatcher uses:
//   developer/dispatch_dashboard/drivers/{gpsId}            { name, deviceId, color, ... }
//   developer/dispatch_dashboard/driver_nicknames/{gpsId}   "Matt"
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Accounts that can open the admin panel. database.rules.json lists the same emails, so change both together.
export const ADMIN_EMAILS = ["justin@ec.com", "desirae@ec.com", "celeste@ec.com"];
export const EMAIL_DOMAIN = "@ec.com";
export const TZ = "America/Winnipeg"; // Brandon, MB runs on Central Time

export const P = {
    settings: "timeclock/settings",
    employees: "timeclock/employees",
    shifts: "timeclock/shifts",
    claims: "timeclock/vehicle_claims",
    audit: "timeclock/audit",
    pushTokens: "timeclock/push_tokens",
    pushTests: "timeclock/push_tests",
    prefs: "timeclock/prefs",
    gps: "developer/dispatch_dashboard/drivers",
    nicknames: "developer/dispatch_dashboard/driver_nicknames"
};

export const DEFAULT_SETTINGS = { reminderMinutes: 10, weekStart: 1 };
export const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const NICKNAME_MAX = 24; // RouteWatcher's nickname input allows 24 characters

export function settingsWithDefaults(v) {
    const s = Object.assign({}, DEFAULT_SETTINGS, v || {});
    s.reminderMinutes = clampInt(s.reminderMinutes, 0, 240, DEFAULT_SETTINGS.reminderMinutes);
    s.weekStart = clampInt(s.weekStart, 0, 6, DEFAULT_SETTINGS.weekStart);
    return s;
}

function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// ---------- People ----------
export function normEmail(email) { return String(email || "").trim().toLowerCase(); }
export function emailKey(email) { return normEmail(email).replace(/\./g, ","); }
export function isAdminEmail(email) { return ADMIN_EMAILS.includes(normEmail(email)); }

function capitalize(word) { return word ? word.charAt(0).toUpperCase() + word.slice(1) : ""; }

export function displayName(emp, email) {
    const name = emp && typeof emp.name === "string" ? emp.name.trim() : "";
    if (name) return name;
    const local = normEmail(email || (emp && emp.email)).split("@")[0];
    return local.split(/[._-]+/).filter(Boolean).map(capitalize).join(" ") || "Employee";
}

export function firstName(emp, email) { return displayName(emp, email).split(/\s+/)[0]; }

// The name a GPS gets in RouteWatcher: Matt@ec.com -> "Matt" (or the first name the admin entered)
export function nicknameFor(emp, email) { return firstName(emp, email).slice(0, NICKNAME_MAX); }

export function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join("") || "?";
}

// ---------- Time (always in Brandon, MB time, whatever the device is set to) ----------
const partsFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
});

export function zoned(ts) {
    const out = {};
    for (const p of partsFmt.formatToParts(new Date(ts))) out[p.type] = p.value;
    const hh = parseInt(out.hour, 10) % 24;
    return {
        y: +out.year, m: +out.month, d: +out.day, hh: hh, mm: +out.minute, ss: +out.second,
        dow: DOW_SHORT.indexOf(out.weekday)
    };
}

function tzOffset(ts) {
    const z = zoned(ts);
    return Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm, z.ss) - Math.floor(ts / 1000) * 1000;
}

// Brandon wall-clock time -> epoch ms (handles daylight saving changes)
export function epochFromZoned(y, m, d, hh, mm) {
    const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
    const first = guess - tzOffset(guess);
    return guess - tzOffset(first);
}

const pad2 = n => String(n).padStart(2, "0");

export function dayKey(ts) { const z = zoned(ts); return z.y + "-" + pad2(z.m) + "-" + pad2(z.d); }
export function parseDayKey(key) { const [y, m, d] = key.split("-").map(Number); return { y, m, d }; }
export function addDaysKey(key, n) {
    const { y, m, d } = parseDayKey(key);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function dowOfKey(key) { const { y, m, d } = parseDayKey(key); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export function keyToEpoch(key, hhmm) {
    const { y, m, d } = parseDayKey(key);
    const [hh, mm] = (hhmm || "00:00").split(":").map(Number);
    return epochFromZoned(y, m, d, hh, mm);
}
export function weekStartKey(key, weekStart) { return addDaysKey(key, -((dowOfKey(key) - weekStart + 7) % 7)); }
export function weekDays(startKey) { return Array.from({ length: 7 }, (_, i) => addDaysKey(startKey, i)); }
export function hhmmOf(ts) { const z = zoned(ts); return pad2(z.hh) + ":" + pad2(z.mm); }

const timeFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const longDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });

const tidy = s => s.replace(/\./g, "").replace(/\s+/g, " ").replace(/am|pm/i, m => m.toUpperCase());
export function fmtTime(ts) { return ts ? tidy(timeFmt.format(new Date(ts))) : "—"; }
export function fmtDate(ts) { return tidy(dateFmt.format(new Date(ts))); }
export function fmtLongDate(ts) { return longDateFmt.format(new Date(ts)); }
export function fmtKey(key, long) {
    const ts = keyToEpoch(key, "12:00");
    return long ? fmtLongDate(ts) : fmtDate(ts);
}
export function fmtHHMM(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return (h % 12 || 12) + ":" + pad2(m) + " " + (h < 12 ? "AM" : "PM");
}

export function fmtDur(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + "h " + pad2(m) + "m" : m + "m";
}
export function fmtClockDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 3600) + ":" + pad2(Math.floor(s / 60) % 60) + ":" + pad2(s % 60);
}
export function fmtHours(ms) { return (Math.max(0, ms) / 3600000).toFixed(2); }

// ---------- Shifts ----------
export function shiftList(obj) {
    return Object.entries(obj || {})
        .filter(([, s]) => s && typeof s.in === "number")
        .map(([id, s]) => Object.assign({ id: id }, s))
        .sort((a, b) => a.in - b.in);
}

export function shiftMs(s, now) {
    const end = typeof s.out === "number" ? s.out : now;
    return Math.max(0, end - s.in);
}

export function openShift(list) {
    for (let i = list.length - 1; i >= 0; i--) if (typeof list[i].out !== "number") return list[i];
    return null;
}

// Overtime: hours past 8 in a day, or past 40 regular hours in a week (counted once, never twice)
export const DAILY_OT_MS = 8 * 3600000;
export const WEEKLY_OT_MS = 40 * 3600000;

// Hours per day for one week, split into regular and overtime; a shift counts on the day it started.
// Shifts are taken in time order: within a day the first 8 hours worked are regular and the rest
// is daily overtime; regular hours then add up across the week, and past 40 they become weekly
// overtime. Daily overtime hours don't count toward the 40.
export function weekTotals(list, days, now) {
    const byDay = {}, byShift = {};
    days.forEach(k => { byDay[k] = { ms: 0, regular: 0, overtime: 0, shifts: [] }; });
    let total = 0, regular = 0, overtime = 0;
    const ordered = list.slice().sort((a, b) => a.in - b.in);
    for (const s of ordered) {
        const k = dayKey(s.in);
        const day = byDay[k];
        if (!day) continue;
        const ms = shiftMs(s, now);
        const withinDay = Math.min(ms, Math.max(0, DAILY_OT_MS - day.ms));   // part inside the day's first 8 h
        const reg = Math.min(withinDay, Math.max(0, WEEKLY_OT_MS - regular)); // ...and inside the week's 40 h
        const ot = ms - reg;
        byShift[s.id] = { regular: reg, overtime: ot };
        day.ms += ms; day.regular += reg; day.overtime += ot;
        day.shifts.push(s);
        total += ms; regular += reg; overtime += ot;
    }
    days.forEach(k => byDay[k].shifts.sort((a, b) => a.in - b.in));
    return { byDay, byShift, total, regular, overtime };
}

export function scheduleFor(emp, key) {
    const day = emp && emp.schedule ? emp.schedule[DOW_KEYS[dowOfKey(key)]] : null;
    return day && day.start ? day : null;
}

// ---------- GPS units (from RouteWatcher) ----------
export function gpsList(drivers) {
    return Object.entries(drivers || {})
        .filter(([, d]) => d && String(d.deviceId || "").trim())
        .map(([id, d]) => ({ id: id, name: String(d.name || "").trim() || "Unnamed GPS", color: d.color || "#ffcc00" }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// Every van change in a shift, oldest first
export function vanHistory(shift) {
    return Object.entries((shift && shift.vans) || {})
        .filter(([, v]) => v && typeof v.at === "number")
        .map(([id, v]) => Object.assign({ id: id }, v))
        .sort((a, b) => a.at - b.at);
}

// ---------- Location ----------
// Where the phone is right now, for a punch or a van swap. Never fails: resolves to
// { lat, lng, acc, at } or { err: "denied" | "unavailable" | "timeout" | "unsupported" }.
export const LOCATION_WAIT_MS = 10000;
export function readLocation() {
    return new Promise(resolve => {
        if (!("geolocation" in navigator)) { resolve({ err: "unsupported" }); return; }
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        // Backstop: some browsers never call back while their permission prompt is open
        const timer = setTimeout(() => finish({ err: "timeout" }), LOCATION_WAIT_MS + 2000);
        try {
            navigator.geolocation.getCurrentPosition(pos => {
                clearTimeout(timer);
                const c = pos.coords;
                finish({ lat: round6(c.latitude), lng: round6(c.longitude), acc: Math.round(c.accuracy || 0), at: Math.round(pos.timestamp || Date.now()) });
            }, err => {
                clearTimeout(timer);
                finish({ err: err && err.code === 1 ? "denied" : err && err.code === 3 ? "timeout" : "unavailable" });
            }, { enableHighAccuracy: true, timeout: LOCATION_WAIT_MS, maximumAge: 15000 });
        } catch (e) { clearTimeout(timer); finish({ err: "unavailable" }); }
    });
}
const round6 = n => Math.round(n * 1e6) / 1e6; // about 0.1 m, plenty for a street address

export function hasCoords(loc) { return !!(loc && typeof loc.lat === "number" && typeof loc.lng === "number"); }

export const LOCATION_ERRORS = {
    denied: "location blocked on the phone",
    unavailable: "the phone couldn't find its location",
    timeout: "no location fix within 10 seconds",
    unsupported: "the browser can't share location"
};

// Locations in a shift that still need a street address: [{ lat, lng, addrPath, errPath }] (paths relative to
// the shift). The admin panel looks them up with Google's geocoder and saves them (see admin.html).
export function addressJobs(shift) {
    if (!shift) return [];
    const jobs = [];
    const want = (loc, addrPath, errPath, done) => {
        if (hasCoords(loc) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180 && !done) jobs.push({ lat: loc.lat, lng: loc.lng, addrPath: addrPath, errPath: errPath });
    };
    want(shift.inLoc, "inAddr", "inAddrErr", shift.inAddr || shift.inAddrErr);
    want(shift.outLoc, "outAddr", "outAddrErr", shift.outAddr || shift.outAddrErr);
    for (const [id, v] of Object.entries(shift.vans || {})) {
        if (v) want(v.loc, "vans/" + id + "/addr", "vans/" + id + "/addrErr", v.addr || v.addrErr);
    }
    return jobs;
}

// Google Maps link that works without a key (Maps URLs)
export function mapsLink(loc) { return "https://www.google.com/maps/search/?api=1&query=" + loc.lat + "%2C" + loc.lng; }

// ---------- Small DOM helpers ----------
export function esc(v) {
    return String(v === null || v === undefined ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function errText(err) {
    const code = err && err.code ? String(err.code) : "";
    if (/PERMISSION_DENIED|permission[-_]denied/i.test(code + " " + (err && err.message))) {
        return "The database refused this change (permission denied).";
    }
    return (err && err.message) || "Something went wrong.";
}

export const AUTH_MESSAGES = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "Incorrect email or password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
};
