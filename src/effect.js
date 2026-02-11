// ---------------------------------------------------------------------------
// effect.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Auto-tracking reactive effect.
//
// API:
//   const dispose = effect(() => {
//     node.textContent = count();
//   });
//   dispose(); // cleanup
//
// Internals:
//   - Sets itself as `_currentEffect` during execution
//   - Any signal read during execution registers this effect
//   - When a dependency signal changes, the effect re-runs
//   - `dispose()` removes from all subscriber sets
//
// Constraints:
//   - No dependency arrays
//   - No diffing
//   - No async
//   - No scheduler
//   - Synchronous execution only
// ---------------------------------------------------------------------------

import { _currentEffect, _setCurrentEffect } from './signal.js';

/**
 * Create a reactive effect.
 *
 * @param {function} fn - The effect function to execute
 * @returns {function} dispose - Call to teardown the effect
 */
export function effect(fn) {
    const e = {
        _fn: fn,
        _dependencies: new Set(), // Set of subscriber-Sets this effect belongs to
        _disposed: false,

        _run() {
            if (e._disposed) return;

            // 1. Cleanup old subscriptions
            _cleanup(e);

            // 2. Set as current tracking context
            const prev = _currentEffect;
            _setCurrentEffect(e);

            // 3. Execute — signal reads during this call will subscribe
            try {
                fn();
            } finally {
                // 4. Restore previous context
                _setCurrentEffect(prev);
            }
        }
    };

    // Initial execution — captures dependencies
    e._run();

    // Return dispose function
    return function dispose() {
        if (e._disposed) return;
        e._disposed = true;
        _cleanup(e);
    };
}

/**
 * Remove an effect from all its dependency subscriber sets.
 *
 * @param {object} e - The effect object
 */
function _cleanup(e) {
    for (const subscriberSet of e._dependencies) {
        subscriberSet.delete(e);
    }
    e._dependencies.clear();
}
