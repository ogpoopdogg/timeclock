'use strict';
// Every time clock function runs as the ec-apps account, not the default one with Editor.
// (Reads the source: CI runs these tests without installing firebase-functions.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('the run-as account is set before any function is defined', () => {
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const set = src.indexOf("setGlobalOptions({ serviceAccount: 'ec-apps@eandccourier-36fcc.iam.gserviceaccount.com' })");
  assert.ok(set > 0, 'setGlobalOptions with ec-apps is missing');
  assert.ok(set < src.indexOf('exports.'), 'setGlobalOptions must come before the first export');
});
