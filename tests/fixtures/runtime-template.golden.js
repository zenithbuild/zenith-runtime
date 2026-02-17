const BOOLEAN_ATTRIBUTES = new Set(['disabled', 'checked', 'readonly', 'required', 'selected', 'open', 'hidden']);
const __listeners = [];
const __components = [];

function cleanup() {
  for (let i = 0; i < __components.length; i++) {
    const instance = __components[i];
    if (instance && typeof instance.destroy === 'function') {
      instance.destroy();
    }
  }
  __components.length = 0;

  for (let i = 0; i < __listeners.length; i++) {
    const item = __listeners[i];
    item.node.removeEventListener(item.event, item.handler);
  }
  __listeners.length = 0;
}

function __coerceText(value) {
  if (value === null || value === undefined || value === false) return '';
  return String(value);
}

function __applyAttribute(node, attrName, value) {
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
        styleText += entries[i][0] + ': ' + entries[i][1] + ';';
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

function __isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function __deepFreezeStructuredValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      __deepFreezeStructuredValue(value[i], seen);
    }
    return Object.freeze(value);
  }

  if (!__isPlainObject(value)) {
    return value;
  }

  const keys = Reflect.ownKeys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key === 'string') {
      __deepFreezeStructuredValue(value[key], seen);
    }
  }
  return Object.freeze(value);
}

function __freezeHydrationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const targets = [
    payload.expressions,
    payload.markers,
    payload.events,
    payload.state_values,
    payload.signals,
    payload.components,
    payload.params,
    payload.ssr_data
  ];
  for (let i = 0; i < targets.length; i++) {
    __deepFreezeStructuredValue(targets[i]);
  }
  return Object.freeze(payload);
}

function __getComponentBinding(bindingsByInstance, instance, binding) {
  if (!bindingsByInstance || typeof bindingsByInstance !== 'object') return undefined;
  const instanceBindings = bindingsByInstance[instance];
  if (!instanceBindings || typeof instanceBindings !== 'object') return undefined;
  return instanceBindings[binding];
}

function __resolveComponentProps(propEntries, signalMap, context = {}) {
  if (!Array.isArray(propEntries)) {
    throw new Error('[Zenith Runtime] component props must be an array');
  }
  const resolved = Object.create(null);
  for (let i = 0; i < propEntries.length; i++) {
    const descriptor = propEntries[i];
    if (!descriptor || typeof descriptor !== 'object') {
      throw new Error('[Zenith Runtime] component prop descriptor at index ' + i + ' must be an object');
    }
    if (typeof descriptor.name !== 'string' || descriptor.name.length === 0) {
      throw new Error('[Zenith Runtime] component prop descriptor at index ' + i + ' must include non-empty name');
    }
    if (Object.prototype.hasOwnProperty.call(resolved, descriptor.name)) {
      throw new Error('[Zenith Runtime] duplicate component prop "' + descriptor.name + '"');
    }
    if (descriptor.type === 'static') {
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error('[Zenith Runtime] component prop "' + descriptor.name + '" static value is missing');
      }
      resolved[descriptor.name] = descriptor.value;
      continue;
    }
    if (descriptor.type === 'signal') {
      if (!Number.isInteger(descriptor.index)) {
        throw new Error('[Zenith Runtime] component prop "' + descriptor.name + '" signal index must be an integer');
      }
      const signalValue = signalMap.get(descriptor.index);
      if (!signalValue || typeof signalValue.get !== 'function') {
        throw new Error(
          '[Zenith Runtime]\\n' +
          'Component: ' + (context.component || '<unknown>') + '\\n' +
          'Route: ' + (context.route || '<unknown>') + '\\n' +
          'Prop: ' + descriptor.name + '\\n' +
          'Reason: signal index ' + descriptor.index + ' did not resolve'
        );
      }
      resolved[descriptor.name] = signalValue;
      continue;
    }
    throw new Error('[Zenith Runtime] unsupported component prop type "' + descriptor.type + '" for "' + descriptor.name + '"');
  }
  return Object.freeze(resolved);
}

function __resolveLiteralPath(source, prefix, objectValue) {
  if (typeof source !== 'string' || !source.startsWith(prefix)) {
    return undefined;
  }
  const keyPath = source.slice(prefix.length);
  if (!keyPath) {
    return '';
  }
  const segments = keyPath.split('.').filter(Boolean);
  let cursor = objectValue;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return '';
    }
    cursor = cursor[segment];
  }
  return cursor === null || cursor === undefined ? '' : cursor;
}

function __evaluateExpression(binding, stateValues, signalMap, componentBindings, routeParams, ssrData, mode) {
  if (!binding || typeof binding !== 'object') {
    throw new Error('[Zenith Runtime] expression binding must be an object');
  }

  if (!Number.isInteger(binding.marker_index) || binding.marker_index < 0) {
    throw new Error('[Zenith Runtime] expression binding requires marker_index');
  }

  if (binding.signal_index !== null && binding.signal_index !== undefined) {
    if (!Number.isInteger(binding.signal_index)) {
      throw new Error('[Zenith Runtime] expression.signal_index must be an integer');
    }
    const signalValue = signalMap.get(binding.signal_index);
    if (!signalValue || typeof signalValue.get !== 'function') {
      throw new Error('[Zenith Runtime] expression.signal_index did not resolve to a signal');
    }
    return mode === 'event' ? signalValue : signalValue.get();
  }

  if (binding.state_index !== null && binding.state_index !== undefined) {
    if (!Number.isInteger(binding.state_index) || binding.state_index < 0 || binding.state_index >= stateValues.length) {
      throw new Error('[Zenith Runtime] expression.state_index out of bounds');
    }
    const resolved = stateValues[binding.state_index];
    if (mode !== 'event' && typeof resolved === 'function') {
      return resolved();
    }
    return resolved;
  }

  if (typeof binding.component_instance === 'string' && typeof binding.component_binding === 'string') {
    const resolved = __getComponentBinding(componentBindings, binding.component_instance, binding.component_binding);
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
      const paramValue = __resolveLiteralPath(binding.literal, 'params.', routeParams);
      if (paramValue !== undefined) {
        return paramValue;
      }
      const ssrValue = __resolveLiteralPath(binding.literal, 'ssr.', ssrData);
      if (ssrValue !== undefined) {
        return ssrValue;
      }
    }
    return binding.literal;
  }

  return '';
}

function __resolveNodes(root, selector, index, kind) {
  const nodes = root.querySelectorAll(selector);
  if (!nodes || nodes.length === 0) {
    throw new Error('[Zenith Runtime] unresolved ' + kind + ' marker index ' + index + ' for selector "' + selector + '"');
  }
  return nodes;
}

export function hydrate(payload) {
  cleanup();

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires an object payload');
  }
  payload = __freezeHydrationPayload(payload);
  if (payload.ir_version !== 1) {
    throw new Error('[Zenith Runtime] unsupported ir_version (expected 1)');
  }
  if (!payload.root || typeof payload.root.querySelectorAll !== 'function') {
    throw new Error('[Zenith Runtime] hydrate(payload) requires payload.root with querySelectorAll');
  }
  if (!Array.isArray(payload.expressions)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires expressions[]');
  }
  if (!Array.isArray(payload.markers)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires markers[]');
  }
  if (!Array.isArray(payload.events)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires events[]');
  }
  if (!Array.isArray(payload.state_values)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires state_values[]');
  }
  if (!Array.isArray(payload.signals)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires signals[]');
  }
  if (payload.route !== undefined && typeof payload.route !== 'string') {
    throw new Error('[Zenith Runtime] hydrate(payload) requires route string when provided');
  }
  if (payload.ssr_data !== undefined && (!payload.ssr_data || typeof payload.ssr_data !== 'object' || Array.isArray(payload.ssr_data))) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires ssr_data object when provided');
  }
  if (payload.params !== undefined && (!payload.params || typeof payload.params !== 'object' || Array.isArray(payload.params))) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires params object when provided');
  }
  if (payload.components !== undefined && !Array.isArray(payload.components)) {
    throw new Error('[Zenith Runtime] hydrate(payload) requires components[] when provided');
  }
  if (payload.markers.length !== payload.expressions.length) {
    throw new Error('[Zenith Runtime] marker/expression mismatch: markers=' + payload.markers.length + ', expressions=' + payload.expressions.length);
  }

  const root = payload.root;
  const expressions = payload.expressions;
  const markers = payload.markers;
  const events = payload.events;
  const stateValues = payload.state_values;
  const signals = payload.signals;
  const components = Array.isArray(payload.components) ? payload.components : [];
  const routeParams = payload.params && typeof payload.params === 'object'
    ? payload.params
    : Object.freeze({});
  const ssrData = payload.ssr_data && typeof payload.ssr_data === 'object'
    ? payload.ssr_data
    : Object.freeze({});
  const signalMap = new Map();
  const componentBindings = Object.create(null);

  for (let i = 0; i < signals.length; i++) {
    const entry = signals[i];
    if (!entry || typeof entry !== 'object') {
      throw new Error('[Zenith Runtime] signal descriptor at position ' + i + ' must be an object');
    }
    if (entry.kind !== 'signal') {
      throw new Error('[Zenith Runtime] signal descriptor at position ' + i + ' requires kind=\"signal\"');
    }
    if (!Number.isInteger(entry.id) || entry.id < 0) {
      throw new Error('[Zenith Runtime] signal descriptor at position ' + i + ' requires non-negative id');
    }
    if (entry.id !== i) {
      throw new Error('[Zenith Runtime] signal table out of order at position ' + i + ': id=' + entry.id);
    }
    if (!Number.isInteger(entry.state_index) || entry.state_index < 0 || entry.state_index >= stateValues.length) {
      throw new Error('[Zenith Runtime] signal descriptor at position ' + i + ' has out-of-bounds state_index');
    }

    const candidate = stateValues[entry.state_index];
    if (!candidate || typeof candidate !== 'object' || typeof candidate.get !== 'function' || typeof candidate.subscribe !== 'function') {
      throw new Error('[Zenith Runtime] signal descriptor id ' + entry.id + ' did not resolve to a signal object');
    }
    signalMap.set(i, candidate);
  }

  const runtimeApi = Object.freeze({ signal, state, zeneffect });
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    if (!component || typeof component !== 'object') {
      throw new Error('[Zenith Runtime] component at position ' + i + ' must be an object');
    }
    if (typeof component.selector !== 'string' || component.selector.length === 0) {
      throw new Error('[Zenith Runtime] component at position ' + i + ' requires selector');
    }
    if (typeof component.instance !== 'string' || component.instance.length === 0) {
      throw new Error('[Zenith Runtime] component at position ' + i + ' requires instance');
    }
    if (typeof component.create !== 'function') {
      throw new Error('[Zenith Runtime] component at position ' + i + ' requires create() function');
    }

    if (component.props !== undefined && !Array.isArray(component.props)) {
      throw new Error('[Zenith Runtime] component props for ' + component.instance + ' must be an array');
    }

    const resolvedProps = __resolveComponentProps(component.props || [], signalMap, {
      component: component.instance,
      route: payload.route || '<unknown>'
    });
    const hosts = __resolveNodes(root, component.selector, i, 'component');
    for (let j = 0; j < hosts.length; j++) {
      const instance = component.create(hosts[j], resolvedProps, runtimeApi);
      if (!instance || typeof instance !== 'object') {
        throw new Error('[Zenith Runtime] component factory for ' + component.instance + ' must return an object');
      }
      if (typeof instance.mount === 'function') {
        instance.mount();
      }
      if (typeof instance.destroy === 'function') {
        __components.push({ destroy: instance.destroy.bind(instance) });
      }
      if (instance.bindings && typeof instance.bindings === 'object') {
        componentBindings[component.instance] = instance.bindings;
      }
    }
  }

  const expressionMarkerIndices = new Set();
  for (let i = 0; i < expressions.length; i++) {
    const expression = expressions[i];
    if (!expression || typeof expression !== 'object') {
      throw new Error('[Zenith Runtime] expression at position ' + i + ' must be an object');
    }
    if (!Number.isInteger(expression.marker_index) || expression.marker_index < 0 || expression.marker_index >= expressions.length) {
      throw new Error('[Zenith Runtime] expression at position ' + i + ' has invalid marker_index');
    }
    if (expression.marker_index !== i) {
      throw new Error('[Zenith Runtime] expression table out of order at position ' + i + ': marker_index=' + expression.marker_index);
    }
    if (expression.signal_index !== null && expression.signal_index !== undefined) {
      if (!Number.isInteger(expression.signal_index) || expression.signal_index < 0 || expression.signal_index >= signals.length) {
        throw new Error('[Zenith Runtime] expression at position ' + i + ' has out-of-bounds signal_index');
      }
    }
    if (expression.state_index !== null && expression.state_index !== undefined) {
      if (!Number.isInteger(expression.state_index) || expression.state_index < 0 || expression.state_index >= stateValues.length) {
        throw new Error('[Zenith Runtime] expression at position ' + i + ' has out-of-bounds state_index');
      }
    }
    if (expressionMarkerIndices.has(expression.marker_index)) {
      throw new Error('[Zenith Runtime] duplicate expression marker_index ' + expression.marker_index);
    }
    expressionMarkerIndices.add(expression.marker_index);
  }

  const markerIndices = new Set();
  const markerByIndex = new Map();
  const markerNodesByIndex = new Map();
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!marker || typeof marker !== 'object') {
      throw new Error('[Zenith Runtime] marker at position ' + i + ' must be an object');
    }
    if (!Number.isInteger(marker.index) || marker.index < 0 || marker.index >= expressions.length) {
      throw new Error('[Zenith Runtime] marker at position ' + i + ' has out-of-bounds index');
    }
    if (marker.index !== i) {
      throw new Error('[Zenith Runtime] marker table out of order at position ' + i + ': index=' + marker.index);
    }
    if (markerIndices.has(marker.index)) {
      throw new Error('[Zenith Runtime] duplicate marker index ' + marker.index);
    }
    markerIndices.add(marker.index);
    markerByIndex.set(marker.index, marker);

    if (marker.kind === 'event') {
      continue;
    }

    if (typeof marker.selector !== 'string' || marker.selector.length === 0) {
      throw new Error('[Zenith Runtime] marker at position ' + i + ' requires selector');
    }

    const nodes = __resolveNodes(root, marker.selector, marker.index, marker.kind);
    markerNodesByIndex.set(marker.index, nodes);
    const value = __evaluateExpression(expressions[marker.index], stateValues, signalMap, componentBindings, routeParams, ssrData, marker.kind);

    for (let j = 0; j < nodes.length; j++) {
      if (marker.kind === 'text') {
        nodes[j].textContent = __coerceText(value);
      } else if (marker.kind === 'attr') {
        if (typeof marker.attr !== 'string' || marker.attr.length === 0) {
          throw new Error('[Zenith Runtime] attr marker at position ' + i + ' requires attr');
        }
        __applyAttribute(nodes[j], marker.attr, value);
      } else {
        throw new Error('[Zenith Runtime] marker at position ' + i + ' has invalid kind');
      }
    }
  }

  for (let i = 0; i < expressions.length; i++) {
    if (!markerIndices.has(i)) {
      throw new Error('[Zenith Runtime] missing marker index ' + i);
    }
  }

  function renderMarkerByIndex(index) {
    const marker = markerByIndex.get(index);
    if (!marker || marker.kind === 'event') return;
    const nodes = markerNodesByIndex.get(index) || __resolveNodes(root, marker.selector, marker.index, marker.kind);
    markerNodesByIndex.set(index, nodes);

    const value = __evaluateExpression(expressions[index], stateValues, signalMap, componentBindings, routeParams, ssrData, marker.kind);
    for (let j = 0; j < nodes.length; j++) {
      if (marker.kind === 'text') {
        nodes[j].textContent = __coerceText(value);
      } else if (marker.kind === 'attr') {
        __applyAttribute(nodes[j], marker.attr, value);
      }
    }
  }

  const dependentMarkersBySignal = new Map();
  for (let i = 0; i < expressions.length; i++) {
    const binding = expressions[i];
    if (!binding || typeof binding !== 'object') continue;
    if (!Number.isInteger(binding.signal_index)) continue;
    if (!dependentMarkersBySignal.has(binding.signal_index)) {
      dependentMarkersBySignal.set(binding.signal_index, []);
    }
    dependentMarkersBySignal.get(binding.signal_index).push(binding.marker_index);
  }
  const dependentMarkersByComponentSignal = new Map();
  for (let i = 0; i < expressions.length; i++) {
    const binding = expressions[i];
    if (!binding || typeof binding !== 'object') continue;
    if (typeof binding.component_instance !== 'string' || typeof binding.component_binding !== 'string') {
      continue;
    }
    const candidate = __getComponentBinding(
      componentBindings,
      binding.component_instance,
      binding.component_binding
    );
    if (!candidate || typeof candidate !== 'object') continue;
    if (typeof candidate.get !== 'function' || typeof candidate.subscribe !== 'function') continue;
    if (!dependentMarkersByComponentSignal.has(candidate)) {
      dependentMarkersByComponentSignal.set(candidate, []);
    }
    dependentMarkersByComponentSignal.get(candidate).push(binding.marker_index);
  }

  for (const [signalId, markerIndicesForSignal] of dependentMarkersBySignal.entries()) {
    const targetSignal = signalMap.get(signalId);
    if (!targetSignal) {
      throw new Error('[Zenith Runtime] expression references unknown signal id ' + signalId);
    }
    const unsubscribe = targetSignal.subscribe(() => {
      for (let i = 0; i < markerIndicesForSignal.length; i++) {
        renderMarkerByIndex(markerIndicesForSignal[i]);
      }
    });
    if (typeof unsubscribe === 'function') {
      __components.push({ destroy: unsubscribe });
    }
  }
  for (const [componentSignal, markerIndicesForSignal] of dependentMarkersByComponentSignal.entries()) {
    const unsubscribe = componentSignal.subscribe(() => {
      for (let i = 0; i < markerIndicesForSignal.length; i++) {
        renderMarkerByIndex(markerIndicesForSignal[i]);
      }
    });
    if (typeof unsubscribe === 'function') {
      __components.push({ destroy: unsubscribe });
    }
  }

  const eventIndices = new Set();
  const validatedEvents = [];
  for (let i = 0; i < events.length; i++) {
    const binding = events[i];
    if (!binding || typeof binding !== 'object') {
      throw new Error('[Zenith Runtime] event binding at position ' + i + ' must be an object');
    }
    if (!Number.isInteger(binding.index) || binding.index < 0 || binding.index >= expressions.length) {
      throw new Error('[Zenith Runtime] event binding at position ' + i + ' has out-of-bounds index');
    }
    if (eventIndices.has(binding.index)) {
      throw new Error('[Zenith Runtime] duplicate event index ' + binding.index);
    }
    eventIndices.add(binding.index);
    if (typeof binding.event !== 'string' || binding.event.length === 0) {
      throw new Error('[Zenith Runtime] event binding at position ' + i + ' requires event name');
    }
    if (typeof binding.selector !== 'string' || binding.selector.length === 0) {
      throw new Error('[Zenith Runtime] event binding at position ' + i + ' requires selector');
    }
    const marker = markerByIndex.get(binding.index);
    if (!marker || marker.kind !== 'event') {
      throw new Error('[Zenith Runtime] event binding at index ' + binding.index + ' must target an event marker');
    }
    validatedEvents.push(binding);
  }

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (marker.kind === 'event' && !eventIndices.has(marker.index)) {
      throw new Error('[Zenith Runtime] missing event binding for marker index ' + marker.index);
    }
  }

  for (let i = 0; i < validatedEvents.length; i++) {
    const binding = validatedEvents[i];
    const nodes = __resolveNodes(root, binding.selector, binding.index, 'event');
    const handler = __evaluateExpression(expressions[binding.index], stateValues, signalMap, componentBindings, routeParams, ssrData, 'event');
    if (typeof handler !== 'function') {
      throw new Error('[Zenith Runtime] event binding at index ' + binding.index + ' did not resolve to a function');
    }

    for (let j = 0; j < nodes.length; j++) {
      nodes[j].addEventListener(binding.event, handler);
      __listeners.push({ node: nodes[j], event: binding.event, handler });
    }
  }

  return cleanup;
}

export function signal(initialValue) {
  let value = initialValue;
  const subscribers = new Set();
  return {
    get() { return value; },
    set(nextValue) {
      if (Object.is(value, nextValue)) return value;
      value = nextValue;
      const snapshot = [...subscribers];
      for (let i = 0; i < snapshot.length; i++) snapshot[i](value);
      return value;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') {
        throw new Error('[Zenith Runtime] signal.subscribe(fn) requires a function');
      }
      subscribers.add(fn);
      return function unsubscribe() { subscribers.delete(fn); };
    }
  };
}

export function state(initialValue) {
  if (!initialValue || typeof initialValue !== 'object' || Array.isArray(initialValue)) {
    throw new Error('[Zenith Runtime] state(initial) requires a plain object');
  }
  let current = Object.freeze({ ...initialValue });
  const subscribers = new Set();
  return {
    get() { return current; },
    set(nextPatch) {
      const nextValue = typeof nextPatch === 'function'
        ? nextPatch(current)
        : { ...current, ...nextPatch };
      if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
        throw new Error('[Zenith Runtime] state.set(next) must resolve to a plain object');
      }
      const frozen = Object.freeze({ ...nextValue });
      if (Object.is(current, frozen)) return current;
      current = frozen;
      const snapshot = [...subscribers];
      for (let i = 0; i < snapshot.length; i++) snapshot[i](current);
      return current;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') {
        throw new Error('[Zenith Runtime] state.subscribe(fn) requires a function');
      }
      subscribers.add(fn);
      return function unsubscribe() { subscribers.delete(fn); };
    }
  };
}

export function zeneffect(fn, dependencies) {
  if (typeof fn !== 'function') {
    if (Array.isArray(fn) && typeof dependencies === 'function') {
      return zeneffect(dependencies, fn);
    }
    throw new Error('[Zenith Runtime] zeneffect(fn, deps) requires fn');
  }
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    throw new Error('[Zenith Runtime] zeneffect(fn, deps) requires non-empty deps');
  }
  let activeCleanup = null;
  let disposed = false;
  const runEffect = () => {
    if (disposed) return;
    if (typeof activeCleanup === 'function') {
      activeCleanup();
      activeCleanup = null;
    }
    const nextCleanup = fn();
    activeCleanup = typeof nextCleanup === 'function' ? nextCleanup : null;
  };
  const unsubscribers = dependencies.map((dep, index) => {
    if (!dep || typeof dep.subscribe !== 'function') {
      throw new Error('[Zenith Runtime] zeneffect dependency at index ' + index + ' must expose subscribe(fn)');
    }
    return dep.subscribe(runEffect);
  });
  runEffect();
  return function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < unsubscribers.length; i++) unsubscribers[i]();
    if (typeof activeCleanup === 'function') {
      activeCleanup();
      activeCleanup = null;
    }
  };
}
