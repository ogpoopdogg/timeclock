// Settings for punch-in reminders that arrive while the time clock is closed (web push through
// Firebase Cloud Messaging). Both values come from the Firebase console, project eandccourier-36fcc;
// README.md walks through it. While either is empty, phones only get the reminder while the
// time clock is open, as before.

// Project settings → General → Your apps → the Web app (</>) → its appId, e.g. "1:1067680083511:web:abc123..."
export const WEB_APP_ID = "";

// Project settings → Cloud Messaging → Web configuration → Web Push certificates → the key pair (public key)
export const VAPID_KEY = "";
