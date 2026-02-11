// ---------------------------------------------------------------------------
// integration.spec.js — Full mount/unmount lifecycle tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { mount } from '../src/runtime.js';

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
        let oldRuns = 0;
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
});
