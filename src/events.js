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
 * @param {() => any} exprFn - Pre-bound expression function that must resolve to a handler
 */
export function bindEvent(element, eventName, exprFn) {
    const resolved = exprFn();

    if (typeof resolved !== 'function') return;

    element.addEventListener(eventName, resolved);
    _registerListener(element, eventName, resolved);
}
