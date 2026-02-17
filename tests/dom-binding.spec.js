import { hydrate } from '../src/hydrate.js';
import { cleanup } from '../src/cleanup.js';
import { signal } from '../src/signal.js';

describe('hydrate() marker contract', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('binds text and attribute markers by index', () => {
        container.innerHTML = '<h1 data-zx-e="0"></h1><a data-zx-href="1">go</a>';

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [
                { marker_index: 0, literal: 'Hello' },
                { marker_index: 1, literal: '/about' }
            ],
            markers: [
                { index: 0, kind: 'text', selector: '[data-zx-e~="0"]' },
                { index: 1, kind: 'attr', selector: '[data-zx-href="1"]', attr: 'href' }
            ],
            events: [],
            state_values: [],
            signals: []
        });

        expect(container.querySelector('h1').textContent).toBe('Hello');
        expect(container.querySelector('a').getAttribute('href')).toBe('/about');
    });

    test('supports index-addressed state value bindings', () => {
        container.innerHTML = '<button data-zx-disabled="0">Save</button>';

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, state_index: 0 }],
            markers: [
                { index: 0, kind: 'attr', selector: '[data-zx-disabled="0"]', attr: 'disabled' }
            ],
            events: [],
            state_values: [true],
            signals: []
        });

        expect(container.querySelector('button').hasAttribute('disabled')).toBe(true);
    });

    test('fails on marker/expression count mismatch', () => {
        container.innerHTML = '<span data-zx-e="0"></span>';

        expect(() => hydrate({
            ir_version: 1,
            root: container,
            expressions: [
                { marker_index: 0, literal: 'a' },
                { marker_index: 1, literal: 'b' }
            ],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: []
        })).toThrow('marker/expression mismatch');
    });

    test('fails when ir_version is missing or unsupported', () => {
        container.innerHTML = '<span data-zx-e="0"></span>';

        expect(() => hydrate({
            root: container,
            expressions: [{ marker_index: 0, literal: 'x' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: []
        })).toThrow('unsupported ir_version');

        expect(() => hydrate({
            ir_version: 2,
            root: container,
            expressions: [{ marker_index: 0, literal: 'x' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: []
        })).toThrow('unsupported ir_version');
    });

    test('fails when marker table order is mutated', () => {
        container.innerHTML = '<span data-zx-e="0"></span><span data-zx-e="0"></span>';

        expect(() => hydrate({
            ir_version: 1,
            root: container,
            expressions: [
                { marker_index: 0, literal: 'x' },
                { marker_index: 1, literal: 'y' }
            ],
            markers: [
                { index: 0, kind: 'text', selector: '[data-zx-e~="0"]' },
                { index: 0, kind: 'event', selector: '[data-zx-on-click="0"]' }
            ],
            events: [],
            state_values: [],
            signals: []
        })).toThrow('marker table out of order');
    });

    test('updates DOM when bound signal changes', () => {
        container.innerHTML = '<p data-zx-e="0"></p>';
        const count = signal(0);

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, signal_index: 0 }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [count],
            signals: [{ id: 0, kind: 'signal', state_index: 0 }]
        });

        expect(container.querySelector('p').textContent).toBe('0');
        count.set(3);
        expect(container.querySelector('p').textContent).toBe('3');
    });

    test('fails when expression references unknown signal index', () => {
        container.innerHTML = '<p data-zx-e="0"></p>';
        const count = signal(0);

        expect(() => hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, signal_index: 2 }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [count],
            signals: [{ id: 0, kind: 'signal', state_index: 0 }]
        })).toThrow('out-of-bounds signal_index');
    });
});
