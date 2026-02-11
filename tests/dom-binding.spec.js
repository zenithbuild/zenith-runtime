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

        const div = container.querySelector('div');
        expect(div.textContent).toBe('AB');

        a.set('X');
        expect(div.textContent).toBe('XB');

        b.set('Y');
        expect(div.textContent).toBe('XY');
    });

    test('binds attribute expressions from data-zx-* markers', () => {
        const klass = signal('ready');
        const href = signal('/a');

        hydrate(container, {
            html: '<a data-zx-class="0" data-zx-href="1">go</a>',
            expressions: [() => klass(), () => href()]
        });

        const anchor = container.querySelector('a');
        expect(anchor.className).toBe('ready');
        expect(anchor.getAttribute('href')).toBe('/a');

        klass.set('active');
        href.set('/b');

        expect(anchor.className).toBe('active');
        expect(anchor.getAttribute('href')).toBe('/b');
    });

    test('supports text and attribute bindings on the same node', () => {
        const left = signal('L');
        const right = signal('R');
        const title = signal('pair');

        hydrate(container, {
            html: '<button data-zx-e="0 1" data-zx-title="2"></button>',
            expressions: [() => left(), () => right(), () => title()]
        });

        const button = container.querySelector('button');
        expect(button.textContent).toBe('LR');
        expect(button.getAttribute('title')).toBe('pair');

        left.set('A');
        right.set('B');
        title.set('updated');

        expect(button.textContent).toBe('AB');
        expect(button.getAttribute('title')).toBe('updated');
    });

    test('style binding does not mutate text content', () => {
        const text = signal('label');
        const style = signal({ color: 'red' });

        hydrate(container, {
            html: '<div data-zx-e="0" data-zx-style="1"></div>',
            expressions: [() => text(), () => style()]
        });

        const div = container.querySelector('div');
        expect(div.textContent).toBe('label');
        expect(div.getAttribute('style')).toContain('color: red;');

        style.set(null);
        expect(div.hasAttribute('style')).toBe(false);
        expect(div.textContent).toBe('label');

        style.set('font-weight: bold;');
        expect(div.getAttribute('style')).toBe('font-weight: bold;');
        expect(div.textContent).toBe('label');
    });

    test('boolean attribute semantics: false/null/undefined/0 remove, true sets', () => {
        const disabled = signal(false);

        hydrate(container, {
            html: '<button data-zx-disabled="0">Save</button>',
            expressions: [() => disabled()]
        });

        const button = container.querySelector('button');
        expect(button.hasAttribute('disabled')).toBe(false);

        disabled.set(true);
        expect(button.hasAttribute('disabled')).toBe(true);

        disabled.set(false);
        expect(button.hasAttribute('disabled')).toBe(false);

        disabled.set(null);
        expect(button.hasAttribute('disabled')).toBe(false);

        disabled.set(undefined);
        expect(button.hasAttribute('disabled')).toBe(false);

        disabled.set(0);
        expect(button.hasAttribute('disabled')).toBe(false);
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
