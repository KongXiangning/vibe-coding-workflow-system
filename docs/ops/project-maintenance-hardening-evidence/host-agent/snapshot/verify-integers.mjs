import assert from 'node:assert/strict';
import { total } from './src/amount.mjs';
assert.equal(total([1, 2]), 3);
console.log('PASS synthetic integer amounts [1,2]; no decimal/export claim');
