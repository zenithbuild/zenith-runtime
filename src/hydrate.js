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
import { _registerDisposer } from './cleanup.js';

const DATA_PREFIX = 'data-zx-';
const TEXT_BINDING_ATTR = 'data-zx-e';
const EVENT_PREFIX = 'data-zx-on-';
const BOOLEAN_ATTRIBUTES = new Set([
    'disabled',
    'checked',
    'readonly',
    'required',
    'selected',
    'open',
    'hidden'
]);

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

    // 2. Walk DOM once and build binding tables
    const bindingTable = [];
    const eventBindings = [];
    const allElements = container.querySelectorAll('*');

    for (let i = 0; i < allElements.length; i++) {
        const node = allElements[i];
        const attrs = node.attributes;

        for (let j = 0; j < attrs.length; j++) {
            const attr = attrs[j];
            const name = attr.name;
            const value = attr.value.trim();

            if (name === TEXT_BINDING_ATTR) {
                const indices = _parseIndices(value, expressions.length);
                if (indices.length > 0) {
                    bindingTable.push({
                        type: 'text',
                        node,
                        indices
                    });
                }
                continue;
            }

            if (name.startsWith(EVENT_PREFIX)) {
                const index = _parseIndex(value, expressions.length);
                if (index !== null) {
                    eventBindings.push({
                        node,
                        eventName: name.slice(EVENT_PREFIX.length),
                        index
                    });
                }
                continue;
            }

            if (!name.startsWith(DATA_PREFIX)) continue;

            const attrName = name.slice(DATA_PREFIX.length);
            if (!attrName || attrName === 'e' || attrName.startsWith('on-')) {
                continue;
            }

            const index = _parseIndex(value, expressions.length);
            if (index !== null) {
                bindingTable.push({
                    type: 'attr',
                    node,
                    attrName,
                    index
                });
            }
        }
    }

    // 3. Initialize effects for expression bindings
    for (let i = 0; i < bindingTable.length; i++) {
        const binding = bindingTable[i];

        if (binding.type === 'text') {
            _bindText(binding.node, binding.indices, expressions);
            continue;
        }

        _bindAttribute(binding.node, binding.attrName, expressions[binding.index]);
    }

    // 4. Bind event listeners
    for (let i = 0; i < eventBindings.length; i++) {
        const binding = eventBindings[i];
        bindEvent(binding.node, binding.eventName, expressions[binding.index]);
    }
}

/**
 * Bind one or more expression indices to a node's text content.
 *
 * @param {Element} node
 * @param {number[]} indices
 * @param {(() => any)[]} expressions
 */
function _bindText(node, indices, expressions) {
    const dispose = effect(() => {
        let content = '';
        for (let i = 0; i < indices.length; i++) {
            const value = expressions[indices[i]]();
            content += _coerceText(value);
        }

        node.textContent = content;
    });

    _registerDisposer(dispose);
}

/**
 * Bind an attribute expression to a node.
 *
 * @param {Element} node
 * @param {string} attrName
 * @param {() => any} exprFn
 */
function _bindAttribute(node, attrName, exprFn) {
    const dispose = effect(() => {
        _applyAttribute(node, attrName, exprFn());
    });

    _registerDisposer(dispose);
}

/**
 * Parse a single expression index.
 *
 * @param {string} value
 * @param {number} max
 * @returns {number | null}
 */
function _parseIndex(value, max) {
    const index = Number(value);
    if (!Number.isInteger(index)) return null;
    if (index < 0 || index >= max) return null;
    return index;
}

/**
 * Parse space-separated indices.
 *
 * @param {string} value
 * @param {number} max
 * @returns {number[]}
 */
function _parseIndices(value, max) {
    const parts = value.split(/\s+/).filter(Boolean);
    const indices = [];

    for (let i = 0; i < parts.length; i++) {
        const index = _parseIndex(parts[i], max);
        if (index !== null) {
            indices.push(index);
        }
    }

    return indices;
}

/**
 * Coerce expression output for text binding.
 *
 * @param {*} value
 * @returns {string}
 */
function _coerceText(value) {
    if (value === null || value === undefined || value === false) return '';
    return String(value);
}

/**
 * Apply an evaluated expression result to a DOM attribute.
 *
 * @param {Element} node
 * @param {string} attrName
 * @param {*} value
 */
function _applyAttribute(node, attrName, value) {
    if (attrName === 'class' || attrName === 'className') {
        node.className = value === null || value === undefined || value === false ? '' : String(value);
        return;
    }

    if (attrName === 'style') {
        if (value === null || value === undefined || value === false) {
            node.removeAttribute('style');
            return;
        }

        if (typeof value === 'string') {
            node.setAttribute('style', value);
            return;
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value);
            let styleText = '';

            for (let i = 0; i < entries.length; i++) {
                const [key, rawValue] = entries[i];
                styleText += `${key}: ${rawValue};`;
            }

            node.setAttribute('style', styleText);
            return;
        }

        node.setAttribute('style', String(value));
        return;
    }

    if (BOOLEAN_ATTRIBUTES.has(attrName)) {
        if (value) {
            node.setAttribute(attrName, '');
        } else {
            node.removeAttribute(attrName);
        }
        return;
    }

    if (value === null || value === undefined || value === false) {
        node.removeAttribute(attrName);
        return;
    }

    node.setAttribute(attrName, String(value));
}
