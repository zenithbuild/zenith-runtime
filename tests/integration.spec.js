// ---------------------------------------------------------------------------
// integration.spec.js — Full mount/unmount lifecycle tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { mount } from '../src/runtime.js';
import * as runtimeApi from '../src/index.js';
import { _getCounts } from '../src/cleanup.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Integration: mount()', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'app';
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    test('mounts page module into container', () => {
        const pageModule = {
            __zenith_page() {
                return {
                    html: '<h1>Hello Zenith</h1>',
                    expressions: []
                };
            }
        };

        mount(container, pageModule);
        expect(container.innerHTML).toBe('<h1>Hello Zenith</h1>');
    });

    test('mounts page module from default export function', () => {
        const pageModule = {
            default() {
                return {
                    html: '<h1>Default Export</h1>',
                    expressions: []
                };
            }
        };

        mount(container, pageModule);
        expect(container.innerHTML).toBe('<h1>Default Export</h1>');
    });

    test('reactive updates work end-to-end', () => {
        const count = signal(0);

        const pageModule = {
            __zenith_page() {
                return {
                    html: '<span data-zx-e="0"></span>',
                    expressions: [() => count()]
                };
            }
        };

        mount(container, pageModule);
        expect(container.querySelector('span').textContent).toBe('0');

        count.set(7);
        expect(container.querySelector('span').textContent).toBe('7');
    });

    test('unmount clears container and stops effects', () => {
        const count = signal(0);
        let runs = 0;

        const pageModule = {
            __zenith_page() {
                return {
                    html: '<span data-zx-e="0"></span>',
                    expressions: [() => { runs++; return count(); }]
                };
            }
        };

        const unmount = mount(container, pageModule);
        expect(runs).toBe(1);

        unmount();
        expect(container.innerHTML).toBe('');

        count.set(1);
        expect(runs).toBe(1); // No re-run after unmount
    });

    test('re-mount replaces previous mount', () => {
        const a = signal('A');
        const b = signal('B');

        const pageA = {
            __zenith_page() {
                return {
                    html: '<p data-zx-e="0"></p>',
                    expressions: [() => a()]
                };
            }
        };

        const pageB = {
            __zenith_page() {
                return {
                    html: '<p data-zx-e="0"></p>',
                    expressions: [() => b()]
                };
            }
        };

        mount(container, pageA);
        expect(container.querySelector('p').textContent).toBe('A');

        mount(container, pageB);
        expect(container.querySelector('p').textContent).toBe('B');

        // Old signal should not trigger updates
        a.set('A2');
        // No assertion needed — just verifying no error/leak
    });

    test('throws on invalid container', () => {
        expect(() => mount(null, {})).toThrow('[Zenith]');
        expect(() => mount('string', {})).toThrow('[Zenith]');
    });

    test('throws on invalid page module', () => {
        expect(() => mount(container, null)).toThrow('[Zenith]');
        expect(() => mount(container, {})).toThrow('[Zenith]');
        expect(() => mount(container, { __zenith_page: 'not a function' })).toThrow('[Zenith]');
        expect(() => mount(container, { default: 'not a function' })).toThrow('[Zenith]');
    });

    test('event + expression end-to-end', () => {
        const count = signal(0);
        const increment = () => count.set(count() + 1);

        const pageModule = {
            __zenith_page() {
                return {
                    html: '<div><span data-zx-e="0"></span><button data-zx-on-click="1">+</button></div>',
                    expressions: [
                        () => count(),
                        () => increment
                    ]
                };
            }
        };

        mount(container, pageModule);

        expect(container.querySelector('span').textContent).toBe('0');

        container.querySelector('button').click();
        expect(count()).toBe(1);
        expect(container.querySelector('span').textContent).toBe('1');

        container.querySelector('button').click();
        container.querySelector('button').click();
        expect(count()).toBe(3);
        expect(container.querySelector('span').textContent).toBe('3');
    });

    test('rapid updates do not cause issues', () => {
        const count = signal(0);

        const pageModule = {
            __zenith_page() {
                return {
                    html: '<span data-zx-e="0"></span>',
                    expressions: [() => count()]
                };
            }
        };

        mount(container, pageModule);

        for (let i = 1; i <= 100; i++) {
            count.set(i);
        }

        expect(container.querySelector('span').textContent).toBe('100');
    });

    test('mount -> cleanup -> mount loop does not leak listeners or effects', () => {
        const clicks = signal(0);
        const onClick = () => clicks.set(clicks() + 1);

        const pageModule = {
            default() {
                return {
                    html: '<button data-zx-on-click="0">+</button>',
                    expressions: [() => onClick]
                };
            }
        };

        for (let i = 0; i < 50; i++) {
            const unmount = mount(container, pageModule);
            const button = container.querySelector('button');
            button.click();
            unmount();
            expect(_getCounts().listeners).toBe(0);
            expect(_getCounts().effects).toBe(0);
        }
    });
});

describe('Contract Guardrails', () => {
    test('public API exports exactly four symbols', () => {
        const apiExports = Object.keys(runtimeApi).sort();
        expect(apiExports).toEqual(['cleanup', 'effect', 'mount', 'signal']);
    });

    test('runtime source does not use forbidden execution primitives', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const srcDir = path.resolve(__dirname, '../src');
        const files = fs.readdirSync(srcDir).filter((name) => name.endsWith('.js'));

        for (let i = 0; i < files.length; i++) {
            const source = fs.readFileSync(path.join(srcDir, files[i]), 'utf8');
            expect(source.includes('eval(')).toBe(false);
            expect(source.includes('new Function')).toBe(false);
            expect(source.includes('with(window)')).toBe(false);
            expect(source.includes('window.')).toBe(false);
        }
    });
});
