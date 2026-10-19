import test from 'node:test';
import assert from 'node:assert';
// Which install steps pwa.js shows for each phone and browser (installKind), and the files iPhones need
// to install the app. Run with: node --test tests/install.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installKind, safariVersion } from '../pwa.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBDV/iPhone15,2;FBSN/iOS;FBSV/18.5]',
  iphoneGoogleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.794170431 Mobile/15E148 Safari/604.1',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0'
};

test('iPhone: Safari, other browsers, and apps that open links inside themselves', () => {
  assert.strictEqual(installKind(UA.iphoneSafari, 'iPhone', 5), 'ios-safari');
  assert.strictEqual(installKind(UA.iphoneChrome, 'iPhone', 5), 'ios-other');
  assert.strictEqual(installKind(UA.iphoneFirefox, 'iPhone', 5), 'ios-other');
  assert.strictEqual(installKind(UA.iphoneFacebook, 'iPhone', 5), 'ios-inapp');
  assert.strictEqual(installKind(UA.iphoneGoogleApp, 'iPhone', 5), 'ios-inapp');
  assert.strictEqual(installKind(UA.iphoneWebView, 'iPhone', 5), 'ios-inapp');
});

test('an iPad (which says it is a Mac) gets the iPhone steps; a real Mac does not', () => {
  assert.strictEqual(installKind(UA.ipadSafari, 'MacIntel', 5), 'ios-safari');
  assert.strictEqual(installKind(UA.macSafari, 'MacIntel', 0), 'mac-safari');
  assert.strictEqual(installKind(UA.macChrome, 'MacIntel', 0), 'desktop');
  assert.strictEqual(installKind(UA.windowsEdge, 'Win32', 0), 'desktop');
});

test('Android: browsers, and apps that open links inside themselves', () => {
  assert.strictEqual(installKind(UA.androidChrome, 'Linux armv8l', 5), 'android');
  assert.strictEqual(installKind(UA.androidSamsung, 'Linux armv8l', 5), 'android');
  assert.strictEqual(installKind(UA.androidWebView, 'Linux armv8l', 5), 'android-inapp');
  assert.strictEqual(installKind(UA.androidInstagram, 'Linux armv8l', 5), 'android-inapp');
});

test('Safari 26 is told apart from older Safari (its user agent no longer gives the real iOS version)', () => {
  const ios26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  assert.strictEqual(installKind(ios26, 'iPhone', 5), 'ios-safari');
  assert.strictEqual(safariVersion(ios26), 26);
  assert.strictEqual(safariVersion(UA.iphoneSafari), 18);
  assert.strictEqual(safariVersion(UA.iphoneWebView), 0);
});

test('both pages give iPhones a home-screen icon and name, and the offline copy includes the icon', () => {
  const icon = fs.readFileSync(path.join(root, 'apple-touch-icon.png'));
  assert.strictEqual(icon.readUInt32BE(16), 180); // PNG width
  assert.strictEqual(icon.readUInt32BE(20), 180); // PNG height
  assert.strictEqual(icon[25], 2, 'no see-through corners (iPhones fill them with black)'); // colour type 2 = RGB, no alpha
  for (const page of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">/, page);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="[^"]+">/, page);
    assert.match(html, /<link rel="manifest" href="[a-z]+\.webmanifest">/, page);
  }
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /"apple-touch-icon.png"/);
});
