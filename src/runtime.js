// ---------------------------------------------------------------------------
// runtime.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// The single public mount API.
//
// mount(container, pageModule):
//   1. Calls __zenith_page() → { html, expressions }
//   2. Injects HTML into container
//   3. Hydrates bindings (expressions + events)
//   4. Returns unmount function
//
// No component tree. No routing. No framework.
// ---------------------------------------------------------------------------

import { hydrate } from './hydrate.js';
import { cleanup } from './cleanup.js';

/**
 * Mount a page module into a DOM container.
 *
 * @param {HTMLElement} container - The DOM element to mount into
 * @param {object} pageModule - The page module (must export __zenith_page)
 * @returns {function} unmount - Call to teardown all bindings
 */
export function mount(container, pageModule) {
    // 1. Validate inputs
    if (!container || !(container instanceof HTMLElement)) {
        throw new Error('[Zenith] mount() requires an HTMLElement container');
    }

    if (!pageModule || typeof pageModule.__zenith_page !== 'function') {
        throw new Error('[Zenith] mount() requires a page module with __zenith_page()');
    }

    // 2. Clean up any previous mount
    cleanup();

    // 3. Execute page function — receive immutable output
    const page = pageModule.__zenith_page();

    if (!page || typeof page.html !== 'string' || !Array.isArray(page.expressions)) {
        throw new Error('[Zenith] __zenith_page() must return { html: string, expressions: (() => any)[] }');
    }

    // 4. Hydrate — inject HTML, bind expressions, wire events
    hydrate(container, page);

    // 5. Return unmount handle
    return function unmount() {
        cleanup();
        container.innerHTML = '';
    };
}
