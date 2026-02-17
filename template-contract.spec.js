import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runtimeDevClientSource, runtimeModuleSource } from './src/template.js';
import * as runtimeApi from './src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, 'package.json');
const goldenPath = path.join(__dirname, 'tests', 'fixtures', 'runtime-template.golden.js');
const srcDir = path.join(__dirname, 'src');

const sourceA = runtimeModuleSource();
const sourceB = runtimeModuleSource();
const devSourceA = runtimeDevClientSource();
const devSourceB = runtimeDevClientSource();

assert.equal(typeof sourceA, 'string', 'runtimeModuleSource() must return a string');
assert.ok(sourceA.length > 0, 'runtime template source must not be empty');
assert.equal(sourceA, sourceB, 'runtime template bytes must be deterministic');
assert.equal(devSourceA, devSourceB, 'runtime dev client bytes must be deterministic');
assert.equal(devSourceA.includes('\r'), false, 'runtime dev client must normalize line endings to \\n');

assert.equal(sourceA.includes('.zen'), false, 'runtime template must not contain .zen imports');
assert.equal(sourceA.includes('zenith:'), false, 'runtime template must not contain zenith:* imports');
assert.equal(sourceA.includes('fetch('), false, 'runtime template must not contain fetch(');
assert.equal(devSourceA.includes('.zen'), false, 'runtime dev client must not contain .zen imports');
assert.equal(devSourceA.includes('zenith:'), false, 'runtime dev client must not contain zenith:* imports');
assert.equal(devSourceA.includes('new Function'), false, 'runtime dev client must not contain new Function');
assert.equal(devSourceA.includes('eval('), false, 'runtime dev client must not contain eval(');
assert.equal(devSourceA.includes('EventSource('), true, 'runtime dev client must include EventSource transport');
assert.equal(devSourceA.includes('/__zenith_dev/state'), true, 'runtime dev client must resolve dev state endpoint');
assert.equal(
    sourceA,
    readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    'runtime template output must match golden bytes for the fixed fixture'
);

const runtimeApiKeys = Object.keys(runtimeApi).sort();
assert.deepEqual(
    runtimeApiKeys,
    ['hydrate', 'signal', 'state', 'zeneffect'],
    'runtime API must export only explicit hydration/reactivity functions'
);

const srcFiles = readdirSync(srcDir).filter((name) => name.endsWith('.js'));
for (const fileName of srcFiles) {
    const source = readFileSync(path.join(srcDir, fileName), 'utf8');
    assert.equal(source.includes('eval('), false, `runtime source ${fileName} must not contain eval(`);
    assert.equal(
        source.includes('new Function'),
        false,
        `runtime source ${fileName} must not contain new Function`
    );
    assert.equal(
        source.includes('process.env'),
        false,
        `runtime source ${fileName} must not contain process.env`
    );
}

const hydrateSource = readFileSync(path.join(srcDir, 'hydrate.js'), 'utf8');
assert.equal(
    hydrateSource.includes('requires params object'),
    true,
    'hydrate.js must preserve malformed params guardrail diagnostic'
);
assert.equal(
    hydrateSource.includes('requires ssr_data object'),
    true,
    'hydrate.js must preserve malformed ssr_data guardrail diagnostic'
);
assert.equal(
    hydrateSource.includes('signal index ${descriptor.index} did not resolve'),
    true,
    'hydrate.js must preserve unresolved signal descriptor diagnostic'
);
assert.equal(
    hydrateSource.includes('signal table out of order'),
    true,
    'hydrate.js must preserve signal table ordering diagnostic'
);
assert.equal(
    hydrateSource.includes("querySelectorAll('*')"),
    false,
    'hydrate.js must not use full-tree DOM discovery'
);

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
assert.equal(
    packageJson.exports['./template'],
    './src/template.js',
    'package export ./template must point to src/template.js'
);

console.log('template-contract.spec.js passed');
