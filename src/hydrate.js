// ---------------------------------------------------------------------------
// hydrate.js — Zenith Runtime V0
// ---------------------------------------------------------------------------
// Contract-driven hydration engine.
//
// Runtime discovery is forbidden: this module only resolves selectors from
// bundler-provided tables and executes explicit index-based bindings.
// ---------------------------------------------------------------------------

import { _registerDisposer, _registerListener, cleanup } from './cleanup.js';
import { ref } from './ref.js';
import { signal } from './signal.js';
import { state } from './state.js';
import {
    activateSideEffectScope,
    createSideEffectScope,
    disposeSideEffectScope,
    zenEffect,
    zenMount,
    zeneffect
} from './zeneffect.js';

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
 * Hydrate a pre-rendered DOM tree using explicit payload tables.
 *
 * @param {{
 *   ir_version: number,
 *   root: Document | Element,
 *   expressions: Array<{ marker_index: number, signal_index?: number|null, state_index?: number|null, component_instance?: string|null, component_binding?: string|null, literal?: string|null }>,
 *   markers: Array<{ index: number, kind: 'text' | 'attr' | 'event', selector: string, attr?: string }>,
 *   events: Array<{ index: number, event: string, selector: string }>,
 *   state_values: Array<*>,
 *   signals: Array<{ id: number, kind: 'signal', state_index: number }>,
 *   route?: string,
 *   params?: Record<string, string>,
 *   ssr_data?: Record<string, unknown>,
 *   components?: Array<{ instance: string, selector: string, create: Function, props?: Array<{ name: string, type: 'static', value: any } | { name: string, type: 'signal', index: number }> }>
 * }} payload
 * @returns {() => void}
 */
export function hydrate(payload) {
    cleanup();

    const frozenPayload = _freezeHydrationPayload(payload);
    const normalized = _validatePayload(frozenPayload);
    const { root, expressions, markers, events, stateValues, signals, components, route, params, ssrData } = normalized;

    const componentBindings = Object.create(null);

    const signalMap = new Map();
    for (let i = 0; i < signals.length; i++) {
        const signalDescriptor = signals[i];
        const candidate = stateValues[signalDescriptor.state_index];
        if (!candidate || typeof candidate !== 'object') {
            throw new Error(`[Zenith Runtime] signal id ${signalDescriptor.id} did not resolve to an object`);
        }
        if (typeof candidate.get !== 'function' || typeof candidate.subscribe !== 'function') {
            throw new Error(`[Zenith Runtime] signal id ${signalDescriptor.id} must expose get() and subscribe()`);
        }
        signalMap.set(i, candidate);
    }

    for (let i = 0; i < components.length; i++) {
        const component = components[i];
        const resolvedProps = _resolveComponentProps(component.props || [], signalMap, {
            component: component.instance,
            route
        });
        const hosts = _resolveNodes(root, component.selector, i, 'component');
        for (let j = 0; j < hosts.length; j++) {
            const componentScope = createSideEffectScope(`${component.instance}:${j}`);
            const runtimeApi = Object.freeze({
                signal,
                state,
                ref,
                zeneffect(effect, dependenciesOrOptions) {
                    return zeneffect(effect, dependenciesOrOptions, componentScope);
                },
                zenEffect(effect, options) {
                    return zenEffect(effect, options, componentScope);
                },
                zenMount(callback) {
                    return zenMount(callback, componentScope);
                }
            });
            const instance = component.create(hosts[j], resolvedProps, runtimeApi);
            if (!instance || typeof instance !== 'object') {
                throw new Error(`[Zenith Runtime] component factory for ${component.instance} must return an object`);
            }
            if (typeof instance.mount === 'function') {
                instance.mount();
            }
            activateSideEffectScope(componentScope);
            _registerDisposer(() => {
                disposeSideEffectScope(componentScope);
                if (typeof instance.destroy === 'function') {
                    instance.destroy();
                }
            });
            if (instance.bindings && typeof instance.bindings === 'object') {
                componentBindings[component.instance] = instance.bindings;
            }
        }
    }

    const expressionMarkerIndices = new Set();
    for (let i = 0; i < expressions.length; i++) {
        const expression = expressions[i];
        if (expressionMarkerIndices.has(expression.marker_index)) {
            throw new Error(`[Zenith Runtime] duplicate expression marker_index ${expression.marker_index}`);
        }
        expressionMarkerIndices.add(expression.marker_index);
    }

    const markerByIndex = new Map();
    const markerNodesByIndex = new Map();
    const markerIndices = new Set();
    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        if (markerIndices.has(marker.index)) {
            throw new Error(`[Zenith Runtime] duplicate marker index ${marker.index}`);
        }
        markerIndices.add(marker.index);
        markerByIndex.set(marker.index, marker);

        if (marker.kind === 'event') {
            continue;
        }

        const nodes = _resolveNodes(root, marker.selector, marker.index, marker.kind);
        markerNodesByIndex.set(marker.index, nodes);
        const value = _evaluateExpression(
            expressions[marker.index],
            stateValues,
            signalMap,
            componentBindings,
            params,
            ssrData,
            marker.kind
        );
        _applyMarkerValue(nodes, marker, value);
    }

    for (let i = 0; i < expressions.length; i++) {
        if (!markerIndices.has(i)) {
            throw new Error(`[Zenith Runtime] missing marker index ${i}`);
        }
    }

    function renderMarkerByIndex(index) {
        const marker = markerByIndex.get(index);
        if (!marker || marker.kind === 'event') {
            return;
        }
        const nodes = markerNodesByIndex.get(index) || _resolveNodes(root, marker.selector, marker.index, marker.kind);
        markerNodesByIndex.set(index, nodes);
        const value = _evaluateExpression(
            expressions[index],
            stateValues,
            signalMap,
            componentBindings,
            params,
            ssrData,
            marker.kind
        );
        _applyMarkerValue(nodes, marker, value);
    }

    const dependentMarkersBySignal = new Map();
    for (let i = 0; i < expressions.length; i++) {
        const expression = expressions[i];
        if (!Number.isInteger(expression.signal_index)) {
            continue;
        }
        if (!dependentMarkersBySignal.has(expression.signal_index)) {
            dependentMarkersBySignal.set(expression.signal_index, []);
        }
        dependentMarkersBySignal.get(expression.signal_index).push(expression.marker_index);
    }

    for (const [signalId, markerIndexes] of dependentMarkersBySignal.entries()) {
        const targetSignal = signalMap.get(signalId);
        if (!targetSignal) {
            throw new Error(`[Zenith Runtime] expression references unknown signal id ${signalId}`);
        }
        const unsubscribe = targetSignal.subscribe(() => {
            for (let i = 0; i < markerIndexes.length; i++) {
                renderMarkerByIndex(markerIndexes[i]);
            }
        });
        if (typeof unsubscribe === 'function') {
            _registerDisposer(unsubscribe);
        }
    }

    const dependentMarkersByComponentSignal = new Map();
    for (let i = 0; i < expressions.length; i++) {
        const expression = expressions[i];
        if (!expression || typeof expression !== 'object') {
            continue;
        }
        if (typeof expression.component_instance !== 'string' || typeof expression.component_binding !== 'string') {
            continue;
        }
        const instanceBindings = componentBindings[expression.component_instance];
        const candidate =
            instanceBindings && Object.prototype.hasOwnProperty.call(instanceBindings, expression.component_binding)
                ? instanceBindings[expression.component_binding]
                : undefined;
        if (!candidate || typeof candidate !== 'object') {
            continue;
        }
        if (typeof candidate.get !== 'function' || typeof candidate.subscribe !== 'function') {
            continue;
        }
        if (!dependentMarkersByComponentSignal.has(candidate)) {
            dependentMarkersByComponentSignal.set(candidate, []);
        }
        dependentMarkersByComponentSignal.get(candidate).push(expression.marker_index);
    }

    for (const [componentSignal, markerIndexes] of dependentMarkersByComponentSignal.entries()) {
        const unsubscribe = componentSignal.subscribe(() => {
            for (let i = 0; i < markerIndexes.length; i++) {
                renderMarkerByIndex(markerIndexes[i]);
            }
        });
        if (typeof unsubscribe === 'function') {
            _registerDisposer(unsubscribe);
        }
    }

    const eventIndices = new Set();
    for (let i = 0; i < events.length; i++) {
        const eventBinding = events[i];
        if (eventIndices.has(eventBinding.index)) {
            throw new Error(`[Zenith Runtime] duplicate event index ${eventBinding.index}`);
        }
        eventIndices.add(eventBinding.index);

        const nodes = _resolveNodes(root, eventBinding.selector, eventBinding.index, 'event');
        const handler = _evaluateExpression(
            expressions[eventBinding.index],
            stateValues,
            signalMap,
            componentBindings,
            params,
            ssrData,
            'event'
        );
        if (typeof handler !== 'function') {
            throw new Error(`[Zenith Runtime] event binding at index ${eventBinding.index} did not resolve to a function`);
        }

        for (let j = 0; j < nodes.length; j++) {
            const node = nodes[j];
            node.addEventListener(eventBinding.event, handler);
            _registerListener(node, eventBinding.event, handler);
        }
    }

    return cleanup;
}

function _validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires an object payload');
    }

    if (payload.ir_version !== 1) {
        throw new Error('[Zenith Runtime] unsupported ir_version (expected 1)');
    }

    const root = payload.root;
    const hasQuery = !!root && typeof root.querySelectorAll === 'function';
    if (!hasQuery) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires payload.root with querySelectorAll');
    }

    const expressions = payload.expressions;
    if (!Array.isArray(expressions)) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires expressions[]');
    }

    const markers = payload.markers;
    if (!Array.isArray(markers)) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires markers[]');
    }

    const events = payload.events;
    if (!Array.isArray(events)) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires events[]');
    }

    const stateValues = payload.state_values;
    if (!Array.isArray(stateValues)) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires state_values[]');
    }

    const signals = payload.signals;
    if (!Array.isArray(signals)) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires signals[]');
    }

    if (payload.route !== undefined && typeof payload.route !== 'string') {
        throw new Error('[Zenith Runtime] hydrate(payload) requires route string when provided');
    }
    if (
        payload.params !== undefined &&
        (!payload.params || typeof payload.params !== 'object' || Array.isArray(payload.params))
    ) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires params object when provided');
    }
    if (
        payload.ssr_data !== undefined &&
        (!payload.ssr_data || typeof payload.ssr_data !== 'object' || Array.isArray(payload.ssr_data))
    ) {
        throw new Error('[Zenith Runtime] hydrate(payload) requires ssr_data object when provided');
    }

    const components = Array.isArray(payload.components) ? payload.components : [];
    const route = typeof payload.route === 'string' && payload.route.length > 0
        ? payload.route
        : '<unknown>';
    const params = payload.params && typeof payload.params === 'object'
        ? payload.params
        : Object.freeze({});
    const ssrData = payload.ssr_data && typeof payload.ssr_data === 'object'
        ? payload.ssr_data
        : Object.freeze({});

    if (markers.length !== expressions.length) {
        throw new Error(
            `[Zenith Runtime] marker/expression mismatch: markers=${markers.length}, expressions=${expressions.length}`
        );
    }

    for (let i = 0; i < expressions.length; i++) {
        const expression = expressions[i];
        if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
            throw new Error(`[Zenith Runtime] expression at position ${i} must be an object`);
        }
        if (!Number.isInteger(expression.marker_index) || expression.marker_index < 0 || expression.marker_index >= expressions.length) {
            throw new Error(`[Zenith Runtime] expression at position ${i} has invalid marker_index`);
        }
        if (expression.marker_index !== i) {
            throw new Error(
                `[Zenith Runtime] expression table out of order at position ${i}: marker_index=${expression.marker_index}`
            );
        }
        if (expression.signal_index !== null && expression.signal_index !== undefined) {
            if (!Number.isInteger(expression.signal_index) || expression.signal_index < 0 || expression.signal_index >= signals.length) {
                throw new Error(`[Zenith Runtime] expression at position ${i} has out-of-bounds signal_index`);
            }
        }
        if (expression.state_index !== null && expression.state_index !== undefined) {
            if (!Number.isInteger(expression.state_index) || expression.state_index < 0 || expression.state_index >= stateValues.length) {
                throw new Error(`[Zenith Runtime] expression at position ${i} has out-of-bounds state_index`);
            }
        }
    }

    for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
            throw new Error(`[Zenith Runtime] marker at position ${i} must be an object`);
        }
        if (!Number.isInteger(marker.index) || marker.index < 0 || marker.index >= expressions.length) {
            throw new Error(`[Zenith Runtime] marker at position ${i} has out-of-bounds index`);
        }
        if (marker.index !== i) {
            throw new Error(`[Zenith Runtime] marker table out of order at position ${i}: index=${marker.index}`);
        }
        if (marker.kind !== 'text' && marker.kind !== 'attr' && marker.kind !== 'event') {
            throw new Error(`[Zenith Runtime] marker at position ${i} has invalid kind`);
        }
        if (typeof marker.selector !== 'string' || marker.selector.length === 0) {
            throw new Error(`[Zenith Runtime] marker at position ${i} requires selector`);
        }
        if (marker.kind === 'attr' && (typeof marker.attr !== 'string' || marker.attr.length === 0)) {
            throw new Error(`[Zenith Runtime] attr marker at position ${i} requires attr name`);
        }
    }

    for (let i = 0; i < events.length; i++) {
        const eventBinding = events[i];
        if (!eventBinding || typeof eventBinding !== 'object' || Array.isArray(eventBinding)) {
            throw new Error(`[Zenith Runtime] event binding at position ${i} must be an object`);
        }
        if (!Number.isInteger(eventBinding.index) || eventBinding.index < 0 || eventBinding.index >= expressions.length) {
            throw new Error(`[Zenith Runtime] event binding at position ${i} has out-of-bounds index`);
        }
        if (typeof eventBinding.event !== 'string' || eventBinding.event.length === 0) {
            throw new Error(`[Zenith Runtime] event binding at position ${i} requires event name`);
        }
        if (typeof eventBinding.selector !== 'string' || eventBinding.selector.length === 0) {
            throw new Error(`[Zenith Runtime] event binding at position ${i} requires selector`);
        }
    }

    for (let i = 0; i < signals.length; i++) {
        const signalDescriptor = signals[i];
        if (!signalDescriptor || typeof signalDescriptor !== 'object' || Array.isArray(signalDescriptor)) {
            throw new Error(`[Zenith Runtime] signal descriptor at position ${i} must be an object`);
        }
        if (signalDescriptor.kind !== 'signal') {
            throw new Error(`[Zenith Runtime] signal descriptor at position ${i} requires kind="signal"`);
        }
        if (!Number.isInteger(signalDescriptor.id) || signalDescriptor.id < 0) {
            throw new Error(`[Zenith Runtime] signal descriptor at position ${i} requires non-negative id`);
        }
        if (signalDescriptor.id !== i) {
            throw new Error(
                `[Zenith Runtime] signal table out of order at position ${i}: id=${signalDescriptor.id}`
            );
        }
        if (!Number.isInteger(signalDescriptor.state_index) || signalDescriptor.state_index < 0 || signalDescriptor.state_index >= stateValues.length) {
            throw new Error(`[Zenith Runtime] signal descriptor at position ${i} has out-of-bounds state_index`);
        }
    }

    for (let i = 0; i < components.length; i++) {
        const component = components[i];
        if (!component || typeof component !== 'object' || Array.isArray(component)) {
            throw new Error(`[Zenith Runtime] component at position ${i} must be an object`);
        }
        if (typeof component.instance !== 'string' || component.instance.length === 0) {
            throw new Error(`[Zenith Runtime] component at position ${i} requires instance`);
        }
        if (typeof component.selector !== 'string' || component.selector.length === 0) {
            throw new Error(`[Zenith Runtime] component at position ${i} requires selector`);
        }
        if (typeof component.create !== 'function') {
            throw new Error(`[Zenith Runtime] component at position ${i} requires create() function`);
        }
        if (component.props !== undefined && !Array.isArray(component.props)) {
            throw new Error(`[Zenith Runtime] component at position ${i} requires props[] when provided`);
        }
    }

    return { root, expressions, markers, events, stateValues, signals, components, route, params, ssrData };
}

function _freezeHydrationPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }

    const freezeTargets = [
        payload.expressions,
        payload.markers,
        payload.events,
        payload.state_values,
        payload.signals,
        payload.components,
        payload.params,
        payload.ssr_data
    ];

    for (let i = 0; i < freezeTargets.length; i++) {
        _deepFreezeStructuredValue(freezeTargets[i]);
    }

    return Object.freeze(payload);
}

function _deepFreezeStructuredValue(value, seen = new WeakSet()) {
    if (value === null || value === undefined) {
        return value;
    }
    const valueType = typeof value;
    if (valueType !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return value;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            _deepFreezeStructuredValue(value[i], seen);
        }
        return Object.freeze(value);
    }

    if (!_isPlainObject(value)) {
        return value;
    }

    const keys = Reflect.ownKeys(value);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (typeof key === 'string') {
            _deepFreezeStructuredValue(value[key], seen);
        }
    }

    return Object.freeze(value);
}

function _isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (Object.prototype.toString.call(value) !== '[object Object]') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function _resolveComponentProps(propTable, signalMap, context = {}) {
    if (!Array.isArray(propTable)) {
        throw new Error('[Zenith Runtime] component props must be an array');
    }
    const resolved = Object.create(null);
    for (let i = 0; i < propTable.length; i++) {
        const descriptor = propTable[i];
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw new Error(`[Zenith Runtime] component prop descriptor at index ${i} must be an object`);
        }
        if (typeof descriptor.name !== 'string' || descriptor.name.length === 0) {
            throw new Error(`[Zenith Runtime] component prop descriptor at index ${i} requires non-empty name`);
        }
        if (Object.prototype.hasOwnProperty.call(resolved, descriptor.name)) {
            throw new Error(`[Zenith Runtime] duplicate component prop "${descriptor.name}"`);
        }
        if (descriptor.type === 'static') {
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                throw new Error(`[Zenith Runtime] component prop "${descriptor.name}" static value is missing`);
            }
            resolved[descriptor.name] = descriptor.value;
            continue;
        }
        if (descriptor.type === 'signal') {
            if (!Number.isInteger(descriptor.index)) {
                throw new Error(`[Zenith Runtime] component prop "${descriptor.name}" signal index must be an integer`);
            }
            const signalValue = signalMap.get(descriptor.index);
            if (!signalValue || typeof signalValue.get !== 'function') {
                throw new Error(
                    `[Zenith Runtime]\nComponent: ${context.component || '<unknown>'}\nRoute: ${context.route || '<unknown>'}\nProp: ${descriptor.name}\nReason: signal index ${descriptor.index} did not resolve`
                );
            }
            resolved[descriptor.name] = signalValue;
            continue;
        }
        throw new Error(
            `[Zenith Runtime] unsupported component prop type "${descriptor.type}" for "${descriptor.name}"`
        );
    }
    return Object.freeze(resolved);
}

function _resolveNodes(root, selector, index, kind) {
    const nodes = root.querySelectorAll(selector);
    if (!nodes || nodes.length === 0) {
        throw new Error(`[Zenith Runtime] unresolved ${kind} marker index ${index} for selector "${selector}"`);
    }
    return nodes;
}

function _evaluateExpression(binding, stateValues, signalMap, componentBindings, params, ssrData, mode) {
    if (binding.signal_index !== null && binding.signal_index !== undefined) {
        const signalValue = signalMap.get(binding.signal_index);
        if (!signalValue || typeof signalValue.get !== 'function') {
            throw new Error('[Zenith Runtime] expression.signal_index did not resolve to a signal');
        }
        return mode === 'event' ? signalValue : signalValue.get();
    }

    if (binding.state_index !== null && binding.state_index !== undefined) {
        const resolved = stateValues[binding.state_index];
        if (mode !== 'event' && typeof resolved === 'function') {
            return resolved();
        }
        return resolved;
    }

    if (typeof binding.component_instance === 'string' && typeof binding.component_binding === 'string') {
        const instanceBindings = componentBindings[binding.component_instance];
        const resolved =
            instanceBindings && Object.prototype.hasOwnProperty.call(instanceBindings, binding.component_binding)
                ? instanceBindings[binding.component_binding]
                : undefined;
        if (mode !== 'event' && resolved && typeof resolved === 'object' && typeof resolved.get === 'function') {
            return resolved.get();
        }
        if (mode !== 'event' && typeof resolved === 'function') {
            return resolved();
        }
        return resolved;
    }

    if (binding.literal !== null && binding.literal !== undefined) {
        if (typeof binding.literal === 'string') {
            const paramValue = _resolveLiteralPath(binding.literal, 'params.', params);
            if (paramValue !== undefined) {
                return paramValue;
            }
            const ssrValue = _resolveLiteralPath(binding.literal, 'ssr.', ssrData);
            if (ssrValue !== undefined) {
                return ssrValue;
            }
        }
        return binding.literal;
    }

    return '';
}

function _resolveLiteralPath(literal, prefix, source) {
    if (typeof literal !== 'string' || !literal.startsWith(prefix)) {
        return undefined;
    }

    const path = literal.slice(prefix.length).trim();
    if (!path) {
        return source;
    }

    const segments = path.split('.').filter(Boolean);
    let cursor = source;
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
            return undefined;
        }
        cursor = cursor[segment];
    }
    return cursor;
}

function _applyMarkerValue(nodes, marker, value) {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (marker.kind === 'text') {
            node.textContent = _coerceText(value);
            continue;
        }

        if (marker.kind === 'attr') {
            _applyAttribute(node, marker.attr, value);
        }
    }
}

function _coerceText(value) {
    if (value === null || value === undefined || value === false) return '';
    return String(value);
}

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
