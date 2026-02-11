// ---------------------------------------------------------------------------
// event.spec.js — Event binding tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { hydrate } from '../src/hydrate.js';
import { cleanup, _getCounts } from '../src/cleanup.js';

describe('Event Binding', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('binds click handler from data-zx-on-click', () => {
        const count = signal(0);
        const increment = () => count.set(count() + 1);

        hydrate(container, {
            html: '<button data-zx-on-click="0">Click</button>',
            expressions: [() => increment]
        });

        const btn = container.querySelector('button');
        btn.click();
        expect(count()).toBe(1);
        btn.click();
        expect(count()).toBe(2);
    });

    test('ignores non-function event expressions', () => {
        hydrate(container, {
            html: '<button data-zx-on-click="0">Click</button>',
            expressions: [() => 42]
        });

        const btn = container.querySelector('button');
        expect(_getCounts().listeners).toBe(0);
        btn.click();
        expect(_getCounts().listeners).toBe(0);
    });

    test('multiple event types on same element', () => {
        let clicked = false;
        let focused = false;

        hydrate(container, {
            html: '<input data-zx-on-click="0" data-zx-on-focus="1" />',
            expressions: [
                () => () => { clicked = true; },
                () => () => { focused = true; }
            ]
        });

        const input = container.querySelector('input');
        input.click();
        expect(clicked).toBe(true);

        input.dispatchEvent(new Event('focus'));
        expect(focused).toBe(true);
    });

    test('supports mouseover and key events', () => {
        let hovered = false;
        let keyValue = '';

        hydrate(container, {
            html: '<input data-zx-on-mouseover="0" data-zx-on-keyup="1" />',
            expressions: [
                () => () => { hovered = true; },
                () => (e) => { keyValue = e.key; }
            ]
        });

        const input = container.querySelector('input');
        input.dispatchEvent(new Event('mouseover'));
        expect(hovered).toBe(true);

        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'k' }));
        expect(keyValue).toBe('k');
    });

    test('event handler receives event object', () => {
        let receivedEvent = null;

        hydrate(container, {
            html: '<button data-zx-on-click="0">Click</button>',
            expressions: [() => (e) => { receivedEvent = e; }]
        });

        const btn = container.querySelector('button');
        btn.click();
        expect(receivedEvent).toBeInstanceOf(Event);
        expect(receivedEvent.type).toBe('click');
    });
});
