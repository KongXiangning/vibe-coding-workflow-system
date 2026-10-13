import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRecords} from './parse.mjs';
test('valid rows preserve identifiers and values', () => assert.deepEqual(parseRecords('id,value\na,1\nb,2'), [{id:'a',value:'1'},{id:'b',value:'2'}]));
test('missing field reports row', () => assert.throws(() => parseRecords('id,value\na,'), /row 2/));
