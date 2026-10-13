// Settings for punch-in reminders that arrive while the time clock is closed (web push through
// Firebase Cloud Messaging). Both values come from the Firebase console, project eandccourier-36fcc;
// README.md walks through it. If either is emptied, phones only get the reminder while the
// time clock is open. Neither value is secret: browsers receive both when the clock loads.

// Project settings → General → Your apps → the Web app (</>) → its appId, e.g. "1:1067680083511:web:abc123..."
export const WEB_APP_ID = "1:1067680083511:web:5e9d457d5913e0a0bd19b2";

// Project settings → Cloud Messaging → Web configuration → Web Push certificates → the key pair (public key)
export const VAPID_KEY = "BA1S09dDHyCTLXZfDGckfFdg0kvCyezfgst5eMhe0TnL03C7eHn3yogeC_u20knFpMxFNsHGZHsDjNp0RXjKHfI";
