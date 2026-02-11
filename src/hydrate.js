// ---------------------------------------------------------------------------
// hydrate.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Single-pass DOM hydration engine.
//
// Algorithm:
//   1. Receive { html, expressions } from __zenith_page()
//   2. Set container.innerHTML = html
//   3. Walk DOM once for data-zx-e and data-zx-on-* attributes
//   4. Build binding table
//   5. Initialize effects for expression bindings
//   6. Register event listeners for event bindings
//   7. Return cleanup handle
//
// No recursive diffing. No re-render cycle. No component tree.
// ---------------------------------------------------------------------------

import { effect } from './effect.js';
import { bindEvent } from './events.js';
import { _registerDisposer, _registerListener } from './cleanup.js';

/**
 * Hydrate a container with page module output.
 *
 * @param {HTMLElement} container - DOM element to mount into
 * @param {{ html: string, expressions: (() => any)[] }} page
 * @returns {void}
 */
export function hydrate(container, page) {
    const { html, expressions } = page;

    // 1. Inject HTML
    container.innerHTML = html;

    // 2. Collect all nodes with expression bindings
    const exprNodes = container.querySelectorAll('[data-zx-e]');

    for (let i = 0; i < exprNodes.length; i++) {
        const node = exprNodes[i];
        const attr = node.getAttribute('data-zx-e');
        if (!attr) continue;

        // Parse space-separated indices
        const indices = attr.split(/\s+/).map(Number);

        for (let j = 0; j < indices.length; j++) {
            const index = indices[j];
            if (index >= 0 && index < expressions.length) {
                _bindExpression(node, expressions[index]);
            }
        }
    }

    // 3. Collect all nodes with event bindings (data-zx-on-*)
    // Match any attribute starting with data-zx-on-
    const allElements = container.querySelectorAll('*');

    for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        const attrs = el.attributes;

        for (let j = 0; j < attrs.length; j++) {
            const attrName = attrs[j].name;
            if (!attrName.startsWith('data-zx-on-')) continue;

            const eventName = attrName.slice('data-zx-on-'.length); // e.g. "click"
            const index = Number(attrs[j].value);

            if (index >= 0 && index < expressions.length) {
                bindEvent(el, eventName, expressions[index]);
            }
        }
    }
}

/**
 * Bind a pre-bound expression function to a DOM node via effect.
 *
 * The effect re-runs whenever any signal read inside `exprFn` changes,
 * automatically updating the node's textContent.
 *
 * @param {Element} node
 * @param {() => any} exprFn
 */
function _bindExpression(node, exprFn) {
    const dispose = effect(() => {
        const value = exprFn();
        // Coerce to string, handling null/undefined/false
        if (value === null || value === undefined || value === false) {
            node.textContent = '';
        } else {
            node.textContent = String(value);
        }
    });

    _registerDisposer(dispose);
}
