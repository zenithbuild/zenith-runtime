// ---------------------------------------------------------------------------
// events.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Event binding system.
//
// For: <button data-zx-on-click="1">
//
// Algorithm:
//   1. Extract event name from attribute suffix ("click")
//   2. Resolve expression at index → must be a function
//   3. addEventListener directly
//
// No synthetic events.
// No delegation.
// No wrapping.
// ---------------------------------------------------------------------------

import { _registerListener } from './cleanup.js';

/**
 * Bind an event listener to a DOM element.
 *
 * @param {Element} element - The DOM element
 * @param {string} eventName - The event name (e.g. "click")
 * @param {() => any} exprFn - Pre-bound expression function that returns a handler
 */
export function bindEvent(element, eventName, exprFn) {
    // The expression function either IS the handler or returns one.
    // For events, the expression should resolve to a function.
    //
    // Two valid patterns:
    //   expressions[i] = () => increment       → returns a function reference
    //   expressions[i] = () => count.set(...)   → IS the handler itself
    //
    // We handle both:
    const resolved = exprFn();

    if (typeof resolved === 'function') {
        // Pattern A: expression returns a function reference
        element.addEventListener(eventName, resolved);
        _registerListener(element, eventName, resolved);
    } else {
        // Pattern B: expression IS the handler (wrap exprFn as the handler)
        // This covers inline expressions like () => count.set(count() + 1)
        element.addEventListener(eventName, exprFn);
        _registerListener(element, eventName, exprFn);
    }
}
