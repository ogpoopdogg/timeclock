import test from 'node:test';
import assert from 'node:assert';
// tc-core.js says which Firebase version it loads (FIREBASE_SDK); Garage loads the rest of Firebase from that address,
// so it must be the version the imports in tc-core.js use. Run with: node --test tests/sdk.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tc-core.js'), 'utf8');

test('FIREBASE_SDK is the address the Firebase imports in tc-core.js use', () => {
  const sdk = (src.match(/export const FIREBASE_SDK = "([^"]+)"/) || [])[1];
  assert.ok(sdk, 'FIREBASE_SDK is exported');
  const imports = [...src.matchAll(/^import .* from "(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/)firebase-[a-z]+\.js";$/gm)].map(m => m[1]);
  assert.ok(imports.length >= 3);
  for (const base of imports) assert.strictEqual(base, sdk);
});
