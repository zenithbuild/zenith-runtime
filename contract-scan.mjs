import assert from 'node:assert/strict';
import { runtimeModuleSource } from './src/template.js';

const source = runtimeModuleSource();

assert.equal(source.includes('fetch('), false, 'runtime output must not contain fetch(');
assert.equal(source.includes('.zen'), false, 'runtime output must not contain .zen');
assert.equal(source.includes('zenith:'), false, 'runtime output must not contain zenith:');
assert.equal(source.includes('\r'), false, 'runtime output must use \\n newlines');

console.log('contract-scan.mjs passed');
