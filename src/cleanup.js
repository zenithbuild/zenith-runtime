// ---------------------------------------------------------------------------
// cleanup.js — Zenith Runtime teardown
// ---------------------------------------------------------------------------

import { resetGlobalSideEffects } from './zeneffect.js';

/** @type {function[]} */
const _disposers = [];

/** @type {{ element: Element, event: string, handler: function }[]} */
const _listeners = [];

let _cleaned = false;

/**
 * Register a disposer for deterministic teardown.
 *
 * @param {function} dispose
 */
export function _registerDisposer(dispose) {
    if (typeof dispose !== 'function') {
        throw new Error('[Zenith Runtime] _registerDisposer(dispose) requires a function');
    }
    _disposers.push(dispose);
    _cleaned = false;
}

/**
 * Register an event listener for deterministic teardown.
 *
 * @param {Element} element
 * @param {string} event
 * @param {function} handler
 */
export function _registerListener(element, event, handler) {
    _listeners.push({ element, event, handler });
    _cleaned = false;
}

/**
 * Tear down all active effects and event listeners.
 *
 * Idempotent: calling twice is a no-op.
 */
export function cleanup() {
    if (_cleaned) return;

    // Dispose in reverse registration order for deterministic teardown semantics.
    for (let i = _disposers.length - 1; i >= 0; i--) {
        try {
            _disposers[i]();
        } catch {
            // cleanup errors must not interrupt teardown
        }
    }
    _disposers.length = 0;

    for (let i = _listeners.length - 1; i >= 0; i--) {
        const { element, event, handler } = _listeners[i];
        try {
            element.removeEventListener(event, handler);
        } catch {
            // DOM teardown should stay resilient
        }
    }
    _listeners.length = 0;

    // Any page-level zenEffect/zenMount registrations are tied to the global side-effect scope.
    resetGlobalSideEffects();

    _cleaned = true;
}

/**
 * Get counts for testing/debugging.
 * @returns {{ effects: number, listeners: number }}
 */
export function _getCounts() {
    return {
        effects: _disposers.length,
        listeners: _listeners.length
    };
}
