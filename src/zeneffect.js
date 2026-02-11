// ---------------------------------------------------------------------------
// zeneffect.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Explicit dependency effect primitive.
//
// API:
//   const dispose = zeneffect([countSignal], () => { ... });
//
// Constraints:
//   - Dependencies are explicit
//   - No implicit tracking context
//   - No scheduler
//   - No async queue
// ---------------------------------------------------------------------------

/**
 * Run an effect with explicit dependencies.
 *
 * @param {Array<{ subscribe: (fn: Function) => Function }>} dependencies
 * @param {Function} fn
 * @returns {Function} dispose
 */
export function zeneffect(dependencies, fn) {
    if (!Array.isArray(dependencies)) {
        throw new Error('[Zenith Runtime] zeneffect(deps, fn) requires an array of dependencies');
    }

    if (dependencies.length === 0) {
        throw new Error('[Zenith Runtime] zeneffect(deps, fn) requires at least one dependency');
    }

    if (typeof fn !== 'function') {
        throw new Error('[Zenith Runtime] zeneffect(deps, fn) requires a function');
    }

    const unsubscribers = dependencies.map((dep, index) => {
        if (!dep || typeof dep.subscribe !== 'function') {
            throw new Error(`[Zenith Runtime] zeneffect dependency at index ${index} must expose subscribe(fn)`);
        }

        return dep.subscribe(() => {
            fn();
        });
    });

    fn();

    return function dispose() {
        for (let i = 0; i < unsubscribers.length; i++) {
            unsubscribers[i]();
        }
    };
}
