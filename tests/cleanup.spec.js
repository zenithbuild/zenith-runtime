// ---------------------------------------------------------------------------
// cleanup.spec.js — Teardown & memory safety tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { effect } from '../src/effect.js';
import { hydrate } from '../src/hydrate.js';
import { cleanup, _getCounts } from '../src/cleanup.js';

describe('Cleanup', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('cleanup disposes all effects', () => {
        const count = signal(0);
        let runs = 0;

        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => { runs++; return count(); }]
        });

        expect(runs).toBe(1);

        cleanup();

        count.set(1);
        expect(runs).toBe(1); // Effect should NOT re-run after cleanup
    });

    test('cleanup removes all event listeners', () => {
        const count = signal(0);

        hydrate(container, {
            html: '<button data-zx-on-click="0">Click</button>',
            expressions: [() => () => count.set(count.peek() + 1)]
        });

        const btn = container.querySelector('button');
        btn.click();
        expect(count()).toBe(1);

        cleanup();

        btn.click();
        expect(count()).toBe(1); // Listener removed, no increment
    });

    test('cleanup is idempotent', () => {
        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => 'test']
        });

        cleanup();
        cleanup(); // Second call should be a no-op
        cleanup(); // Third call too
        // No throw = pass
    });

    test('tracks effect and listener counts', () => {
        const count = signal(0);

        hydrate(container, {
            html: '<span data-zx-e="0"></span><button data-zx-on-click="1">Go</button>',
            expressions: [() => count(), () => () => count.set(0)]
        });

        const counts = _getCounts();
        expect(counts.effects).toBe(1);
        expect(counts.listeners).toBe(1);

        cleanup();

        const afterCounts = _getCounts();
        expect(afterCounts.effects).toBe(0);
        expect(afterCounts.listeners).toBe(0);
    });

    test('no memory leak: signal subscribers cleared after cleanup', () => {
        const count = signal(0);

        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => count()]
        });

        // Signal should have subscribers
        expect(count._subscribers.size).toBeGreaterThan(0);

        cleanup();

        // After cleanup, signal should have no subscribers
        expect(count._subscribers.size).toBe(0);
    });

    test('destroying container after cleanup removes subscriptions', () => {
        const count = signal(0);
        let runs = 0;

        hydrate(container, {
            html: '<span data-zx-e="0"></span>',
            expressions: [() => { runs++; return count(); }]
        });

        cleanup();
        container.innerHTML = '';

        count.set(999);
        expect(runs).toBe(1); // No re-run
    });
});
