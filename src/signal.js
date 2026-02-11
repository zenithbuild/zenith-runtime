// ---------------------------------------------------------------------------
// signal.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Minimal reactive signal primitive.
//
// API:
//   const count = signal(0)
//   count()       → read (tracks dependency if inside an effect)
//   count.set(1)  → write (notifies all subscribers synchronously)
//
// Internals:
//   - Each signal has a Set<Effect> of subscribers
//   - Reading during effect execution registers the effect
//   - Writing notifies all subscribers synchronously
//
// Constraints:
//   - No batching
//   - No scheduler
//   - No async
// ---------------------------------------------------------------------------

// The currently executing effect (if any).
// This is the sole mechanism for auto-tracking.
export let _currentEffect = null;

/**
 * @param {*} e - The effect to set as current
 */
export function _setCurrentEffect(e) {
    _currentEffect = e;
}

/**
 * Create a reactive signal.
 *
 * @param {*} initialValue
 * @returns {function & { set: function, peek: function }}
 */
export function signal(initialValue) {
    let _value = initialValue;
    const _subscribers = new Set();

    // Reading: sig()
    function sig() {
        // If an effect is currently executing, register it as a subscriber
        if (_currentEffect !== null) {
            _subscribers.add(_currentEffect);
            _currentEffect._dependencies.add(_subscribers);
        }
        return _value;
    }

    // Writing: sig.set(newValue)
    sig.set = function set(newValue) {
        if (Object.is(_value, newValue)) return; // No-op on same value
        _value = newValue;
        // Notify all subscribers synchronously
        // Snapshot to avoid mutation during iteration
        const subs = [..._subscribers];
        for (let i = 0; i < subs.length; i++) {
            subs[i]._run();
        }
    };

    // Peek without tracking (no subscription)
    sig.peek = function peek() {
        return _value;
    };

    // Internal: for cleanup
    sig._subscribers = _subscribers;

    return sig;
}
