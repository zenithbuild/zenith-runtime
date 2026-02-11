// ---------------------------------------------------------------------------
// state.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Proxy-free immutable state helper.
//
// API:
//   const store = state({ count: 0 });
//   store.get();
//   store.set({ count: 1 });
//   store.set((prev) => ({ ...prev, count: prev.count + 1 }));
// ---------------------------------------------------------------------------

/**
 * Create a proxy-free immutable state container.
 *
 * @param {object} initialValue
 * @returns {{ get: () => object, set: (patch: object | ((prev: object) => object)) => object, subscribe: (fn: (next: object) => void) => () => void }}
 */
export function state(initialValue) {
    if (!initialValue || typeof initialValue !== 'object' || Array.isArray(initialValue)) {
        throw new Error('[Zenith Runtime] state(initial) requires a plain object');
    }

    let current = Object.freeze({ ...initialValue });
    const subscribers = new Set();

    return {
        get() {
            return current;
        },
        set(nextPatch) {
            const nextValue = typeof nextPatch === 'function'
                ? nextPatch(current)
                : { ...current, ...nextPatch };

            if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
                throw new Error('[Zenith Runtime] state.set(next) must resolve to a plain object');
            }

            const frozenNext = Object.freeze({ ...nextValue });
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
}
