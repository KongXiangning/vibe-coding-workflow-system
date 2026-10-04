import assert from 'node:assert/strict';
import {importDevices} from '../src/importer.mjs';
assert.deepEqual(importDevices('device_id,label\n7, Router '),[{device_id:7,label:'Router'}]);
for(const id of ['', '0','-1','1.2','abc']) assert.throws(()=>importDevices('device_id,label\n'+id+',Router'),/line 2: device_id must be a positive integer/);
assert.throws(()=>importDevices('device_id,label\n7,   '),/line 2: label required/);
console.log('PASS: valid single device, empty/zero/negative/decimal/nonnumeric ID rejection and blank-label diagnostics');
