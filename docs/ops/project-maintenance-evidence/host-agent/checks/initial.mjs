import assert from 'node:assert/strict';
import {importDevices} from '../src/importer.mjs';
assert.deepEqual(importDevices('device_id,label\n7, Router '),[{device_id:7,label:'Router'}]);
assert.throws(()=>importDevices('device_id,label\n7,   '),/line 2: label required/);
console.log('PASS: valid single device and blank-label diagnostics; positive-id edge cases not checked');
