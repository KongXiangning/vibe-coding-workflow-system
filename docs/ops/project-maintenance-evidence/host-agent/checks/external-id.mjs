import assert from 'node:assert/strict';
import {importDevices} from '../src/importer.mjs';
assert.throws(()=>importDevices('device_id,label\n,Router'),/line 2: device_id must be a positive integer/);
console.log('PASS: empty device_id rejected with row and cause');
