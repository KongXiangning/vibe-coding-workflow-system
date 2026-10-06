import assert from 'node:assert/strict';
import { total } from './src/amount.mjs';
assert.equal(total([0.1, 0.2]), 0.3);
console.log('PASS synthetic decimal sample [0.1,0.2]; only this fixture version');
