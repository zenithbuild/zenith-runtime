import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtimeApi from '../src/index.js';
import { hydrate } from '../src/hydrate.js';
import { cleanup } from '../src/cleanup.js';

describe('runtime API lock', () => {
    test('exports explicit hydration/reactivity functions', () => {
        const keys = Object.keys(runtimeApi).sort();
        expect(keys).toEqual(['hydrate', 'signal', 'state', 'zeneffect']);
    });
});

describe('hydrate integration contract', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        container.innerHTML = '<p data-zx-e="0"></p>';
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('applies one explicit bootstrap call with no auto-run discovery', () => {
        const unmount = hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, literal: 'Hello Zenith' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: []
        });

        expect(container.querySelector('p').textContent).toBe('Hello Zenith');
        expect(typeof unmount).toBe('function');
    });
});

describe('runtime source guardrails', () => {
    test('contains no forbidden execution primitives', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const srcDir = path.resolve(__dirname, '../src');
        const files = fs.readdirSync(srcDir).filter((name) => name.endsWith('.js'));

        for (let i = 0; i < files.length; i++) {
            const source = fs.readFileSync(path.join(srcDir, files[i]), 'utf8');
            expect(source.includes('eval(')).toBe(false);
            expect(source.includes('new Function')).toBe(false);
            expect(source.includes('process.env')).toBe(false);
        }
    });

    test('does not use full-tree DOM discovery', () => {
        const source = fs.readFileSync(
            path.resolve(
                path.dirname(fileURLToPath(import.meta.url)),
                '../src/hydrate.js'
            ),
            'utf8'
        );

        expect(source.includes("querySelectorAll('*')")).toBe(false);
    });
});
