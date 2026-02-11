// ---------------------------------------------------------------------------
// reactivity.spec.js — Signal & Effect tests
// ---------------------------------------------------------------------------

import { signal } from '../src/signal.js';
import { effect } from '../src/effect.js';

describe('Signal', () => {
    test('creates with initial value', () => {
        const count = signal(0);
        expect(count()).toBe(0);
    });

    test('reads current value', () => {
        const name = signal('Zenith');
        expect(name()).toBe('Zenith');
    });

    test('writes new value via .set()', () => {
        const count = signal(0);
        count.set(5);
        expect(count()).toBe(5);
    });

    test('peek reads without tracking', () => {
        const count = signal(0);
        let runs = 0;

        effect(() => {
            count.peek(); // Should NOT track
            runs++;
        });

        expect(runs).toBe(1);
        count.set(1);
        expect(runs).toBe(1); // Effect should NOT re-run
    });

    test('no-op when setting same value (Object.is)', () => {
        const count = signal(0);
        let runs = 0;

        effect(() => {
            count();
            runs++;
        });

        expect(runs).toBe(1);
        count.set(0); // Same value
        expect(runs).toBe(1); // Should NOT re-run
    });

    test('handles NaN correctly (NaN === NaN via Object.is)', () => {
        const val = signal(NaN);
        let runs = 0;

        effect(() => {
            val();
            runs++;
        });

        expect(runs).toBe(1);
        val.set(NaN); // NaN is same via Object.is
        expect(runs).toBe(1);
    });
});

describe('Effect', () => {
    test('runs immediately on creation', () => {
        let ran = false;
        effect(() => { ran = true; });
        expect(ran).toBe(true);
    });

    test('re-runs when dependency signal changes', () => {
        const count = signal(0);
        let observed = -1;

        effect(() => {
            observed = count();
        });

        expect(observed).toBe(0);
        count.set(42);
        expect(observed).toBe(42);
    });

    test('tracks multiple signals', () => {
        const a = signal(1);
        const b = signal(2);
        let sum = 0;

        effect(() => {
            sum = a() + b();
        });

        expect(sum).toBe(3);
        a.set(10);
        expect(sum).toBe(12);
        b.set(20);
        expect(sum).toBe(30);
    });

    test('dispose stops re-execution', () => {
        const count = signal(0);
        let runs = 0;

        const dispose = effect(() => {
            count();
            runs++;
        });

        expect(runs).toBe(1);
        dispose();
        count.set(1);
        expect(runs).toBe(1); // Should NOT re-run after dispose
    });

    test('re-tracks dependencies on each run (dynamic deps)', () => {
        const cond = signal(true);
        const a = signal('A');
        const b = signal('B');
        let value = '';

        effect(() => {
            value = cond() ? a() : b();
        });

        expect(value).toBe('A');

        // Switch condition — now depends on b, not a
        cond.set(false);
        expect(value).toBe('B');

        // Changing a should NOT trigger (no longer a dependency)
        a.set('A2');
        expect(value).toBe('B');

        // Changing b SHOULD trigger
        b.set('B2');
        expect(value).toBe('B2');
    });

    test('nested signal updates are synchronous', () => {
        const count = signal(0);
        const double = signal(0);

        effect(() => {
            double.set(count() * 2);
        });

        expect(double()).toBe(0);
        count.set(5);
        expect(double()).toBe(10);
    });
});
