// ---------------------------------------------------------------------------
// event.spec.js — Event binding tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { hydrate } from '../src/hydrate.js';
import { cleanup } from '../src/cleanup.js';

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

    test('binds inline handler (expression IS the handler)', () => {
        const count = signal(0);

        hydrate(container, {
            html: '<button data-zx-on-click="0">Click</button>',
            // Expression returns non-function — exprFn itself becomes the handler
            expressions: [() => count.set(count.peek() + 1)]
        });

        // Note: this pattern means the expression executes once during binding
        // and the result is not a function, so exprFn is bound as handler
        const btn = container.querySelector('button');
        // The inline handler runs count.set() when the expression is evaluated
        // during bindEvent, so count is already 1
        expect(count()).toBe(1);
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
