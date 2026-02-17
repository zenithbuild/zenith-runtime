// ---------------------------------------------------------------------------
// signal.js — Zenith Runtime signal primitive
// ---------------------------------------------------------------------------

import { _nextReactiveId, _trackDependency } from './zeneffect.js';

/**
 * Create a deterministic signal with explicit subscription semantics.
 *
 * @param {*} initialValue
 * @returns {{ get: () => *, set: (next: *) => *, subscribe: (fn: (value: *) => void) => () => void }}
 */
export function signal(initialValue) {
    let value = initialValue;
    const subscribers = new Set();

    const self = {
        get() {
            _trackDependency(self);
            return value;
        },
        set(nextValue) {
            if (Object.is(value, nextValue)) {
                return value;
            }

            value = nextValue;

            const snapshot = [...subscribers];
            for (let i = 0; i < snapshot.length; i++) {
                snapshot[i](value);
            }

            return value;
        },
        subscribe(fn) {
            if (typeof fn !== 'function') {
                throw new Error('[Zenith Runtime] signal.subscribe(fn) requires a function');
            }

            subscribers.add(fn);
            return function unsubscribe() {
                subscribers.delete(fn);
            };
        }
    };

    Object.defineProperty(self, '__zenith_id', {
        value: _nextReactiveId(),
        enumerable: false,
        configurable: false,
        writable: false
    });

    return self;
}
