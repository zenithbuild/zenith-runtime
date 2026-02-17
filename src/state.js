// ---------------------------------------------------------------------------
// state.js — Zenith Runtime state primitive
// ---------------------------------------------------------------------------

import { _nextReactiveId, _trackDependency } from './zeneffect.js';

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return Object.prototype.toString.call(value) === '[object Object]';
}

function freezeSnapshot(value) {
    if (Array.isArray(value)) {
        return Object.freeze([...value]);
    }
    if (isPlainObject(value)) {
        return Object.freeze({ ...value });
    }
    return value;
}

/**
 * Create a deterministic reactive state container.
 *
 * - Primitive values are set directly.
 * - Plain-object patches merge into prior object snapshots.
 * - Functional updaters receive the previous snapshot.
 *
 * @param {*} initialValue
 * @returns {{ get: () => *, set: (next: * | ((prev: *) => *)) => *, subscribe: (fn: (next: *) => void) => () => void }}
 */
export function state(initialValue) {
    let current = freezeSnapshot(initialValue);
    const subscribers = new Set();

    const self = {
        get() {
            _trackDependency(self);
            return current;
        },
        set(nextPatch) {
            const candidate = typeof nextPatch === 'function'
                ? nextPatch(current)
                : nextPatch;

            const nextValue = isPlainObject(current) && isPlainObject(candidate)
                ? { ...current, ...candidate }
                : candidate;

            const frozenNext = freezeSnapshot(nextValue);
            if (Object.is(current, frozenNext)) {
                return current;
            }

            current = frozenNext;

            const snapshot = [...subscribers];
            for (let i = 0; i < snapshot.length; i++) {
                snapshot[i](current);
            }

            return current;
        },
        subscribe(fn) {
            if (typeof fn !== 'function') {
                throw new Error('[Zenith Runtime] state.subscribe(fn) requires a function');
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
