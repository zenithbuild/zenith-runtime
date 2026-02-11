// ---------------------------------------------------------------------------
// dom-binding.spec.js — Hydration & DOM binding tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { hydrate } from '../src/hydrate.js';
import { cleanup } from '../src/cleanup.js';

describe('Hydration', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('injects HTML into container', () => {
        hydrate(container, {
            html: '<p>Hello</p>',
            expressions: []
        });

        expect(container.innerHTML).toBe('<p>Hello</p>');
    });

    test('binds single expression to text content', () => {
        const count = signal(0);

        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => count()]
        });

        expect(container.querySelector('span').textContent).toBe('0');
    });

    test('updates text when signal changes', () => {
        const count = signal(0);

        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => count()]
        });

        count.set(42);
        expect(container.querySelector('span').textContent).toBe('42');
    });

    test('binds multiple expressions to different nodes', () => {
        const name = signal('Zenith');
        const version = signal('1.0');

        hydrate(container, {
            html: '<h1 data-zx-e="0"></h1><p data-zx-e="1"></p>',
            expressions: [() => name(), () => version()]
        });

        expect(container.querySelector('h1').textContent).toBe('Zenith');
        expect(container.querySelector('p').textContent).toBe('1.0');

        name.set('Zenith V2');
        expect(container.querySelector('h1').textContent).toBe('Zenith V2');
    });

    test('handles merged indices (space-separated)', () => {
        const a = signal('A');
        const b = signal('B');

        hydrate(container, {
            html: '<div data-zx-e="0 1"></div>',
            expressions: [() => a(), () => b()]
        });

        // Both expressions bound — last one wins for textContent
        const div = container.querySelector('div');
        expect(div.textContent).toBe('B');
    });

    test('handles null/undefined/false by clearing content', () => {
        const val = signal(null);

        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => val()]
        });

        expect(container.querySelector('span').textContent).toBe('');

        val.set(undefined);
        expect(container.querySelector('span').textContent).toBe('');

        val.set(false);
        expect(container.querySelector('span').textContent).toBe('');

        val.set('visible');
        expect(container.querySelector('span').textContent).toBe('visible');
    });

    test('handles no expressions gracefully', () => {
        hydrate(container, {
            html: '<p>Static content</p>',
            expressions: []
        });

        expect(container.innerHTML).toBe('<p>Static content</p>');
    });
});
