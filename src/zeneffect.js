// ---------------------------------------------------------------------------
// zeneffect.js — Zenith Runtime side-effects contract
// ---------------------------------------------------------------------------
// Provides:
// - zenMount(fn)
// - zenEffect(effect, options?)
// - zeneffect(...) compatibility alias
//
// Contract guarantees:
// - Autotracks reactive reads from signal/state via get()
// - Cleanup before rerun and on scope disposal
// - Deterministic subscription ordering by reactive id
// - Optional scheduling controls
// ---------------------------------------------------------------------------

const DEFAULT_EFFECT_OPTIONS = Object.freeze({
    debounceMs: 0,
    throttleMs: 0,
    raf: false,
    flush: 'post'
});

let _activeDependencyCollector = null;
let _reactiveIdCounter = 0;
let _scopeIdCounter = 0;
let _effectIdCounter = 0;

function createInternalScope(label, mountReady) {
    _scopeIdCounter += 1;
    return {
        __zenith_scope: true,
        id: _scopeIdCounter,
        label,
        mountReady: mountReady === true,
        disposed: false,
        pendingMounts: [],
        disposers: []
    };
}

let _globalScope = createInternalScope('global', true);

function isScope(value) {
    return !!value && typeof value === 'object' && value.__zenith_scope === true;
}

function resolveScope(scopeOverride) {
    if (isScope(scopeOverride)) {
        return scopeOverride;
    }
    return _globalScope;
}

function registerScopeDisposer(scope, disposer) {
    if (typeof disposer !== 'function') {
        return () => {};
    }

    if (!scope || scope.disposed) {
        disposer();
        return () => {};
    }

    scope.disposers.push(disposer);

    return function unregisterScopeDisposer() {
        if (!scope || scope.disposed) {
            return;
        }
        const index = scope.disposers.indexOf(disposer);
        if (index >= 0) {
            scope.disposers.splice(index, 1);
        }
    };
}

function disposeScope(scope) {
    if (!scope || scope.disposed) {
        return;
    }

    scope.disposed = true;

    const disposers = scope.disposers.slice();
    scope.disposers.length = 0;
    scope.pendingMounts.length = 0;

    for (let i = disposers.length - 1; i >= 0; i--) {
        const disposer = disposers[i];
        if (typeof disposer !== 'function') {
            continue;
        }
        try {
            disposer();
        } catch {
            // cleanup failures must never break teardown flow
        }
    }
}

function normalizeDelay(value, fieldName) {
    if (value === undefined || value === null) {
        return 0;
    }
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(
            `[Zenith Runtime] zenEffect options.${fieldName} must be a non-negative number`
        );
    }
    return Math.floor(value);
}

function normalizeEffectOptions(options) {
    if (options === undefined || options === null) {
        return DEFAULT_EFFECT_OPTIONS;
    }

    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('[Zenith Runtime] zenEffect(effect, options) requires options object when provided');
    }

    const normalized = {
        debounceMs: normalizeDelay(options.debounceMs, 'debounceMs'),
        throttleMs: normalizeDelay(options.throttleMs, 'throttleMs'),
        raf: options.raf === true,
        flush: options.flush === 'sync' ? 'sync' : 'post'
    };

    if (options.flush !== undefined && options.flush !== 'sync' && options.flush !== 'post') {
        throw new Error('[Zenith Runtime] zenEffect options.flush must be "post" or "sync"');
    }

    const schedulingModes =
        (normalized.debounceMs > 0 ? 1 : 0) +
        (normalized.throttleMs > 0 ? 1 : 0) +
        (normalized.raf ? 1 : 0);

    if (schedulingModes > 1) {
        throw new Error('[Zenith Runtime] zenEffect options may use only one scheduler: debounceMs, throttleMs, or raf');
    }

    return normalized;
}

function drainCleanupStack(cleanups) {
    for (let i = cleanups.length - 1; i >= 0; i--) {
        const cleanup = cleanups[i];
        if (typeof cleanup !== 'function') {
            continue;
        }
        try {
            cleanup();
        } catch {
            // swallow cleanup errors to preserve deterministic teardown
        }
    }
    cleanups.length = 0;
}

function applyCleanupResult(result, registerCleanup) {
    if (typeof result === 'function') {
        registerCleanup(result);
        return;
    }

    if (result && typeof result === 'object' && typeof result.cleanup === 'function') {
        registerCleanup(result.cleanup);
    }
}

function requireFunction(callback, label) {
    if (typeof callback !== 'function') {
        throw new Error(`[Zenith Runtime] ${label} requires callback function`);
    }
}

function createMountContext(registerCleanup) {
    return Object.freeze({
        cleanup: registerCleanup
    });
}

function createEffectContext(registerCleanup) {
    return Object.freeze({
        cleanup: registerCleanup,
        timeout(callback, delayMs = 0) {
            requireFunction(callback, 'zenEffect context.timeout(callback, delayMs)');
            const timeoutId = setTimeout(callback, normalizeDelay(delayMs, 'timeout'));
            registerCleanup(() => clearTimeout(timeoutId));
            return timeoutId;
        },
        raf(callback) {
            requireFunction(callback, 'zenEffect context.raf(callback)');
            if (typeof requestAnimationFrame === 'function') {
                const frameId = requestAnimationFrame(callback);
                registerCleanup(() => cancelAnimationFrame(frameId));
                return frameId;
            }
            const timeoutId = setTimeout(callback, 16);
            registerCleanup(() => clearTimeout(timeoutId));
            return timeoutId;
        },
        debounce(callback, delayMs) {
            requireFunction(callback, 'zenEffect context.debounce(callback, delayMs)');
            const waitMs = normalizeDelay(delayMs, 'debounce');
            let timeoutId = null;

            const wrapped = (...args) => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(() => {
                    timeoutId = null;
                    callback(...args);
                }, waitMs);
            };

            registerCleanup(() => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            });

            return wrapped;
        },
        throttle(callback, delayMs) {
            requireFunction(callback, 'zenEffect context.throttle(callback, delayMs)');
            const waitMs = normalizeDelay(delayMs, 'throttle');
            let timeoutId = null;
            let lastRun = 0;
            let pendingArgs = null;

            const invoke = (args) => {
                lastRun = Date.now();
                callback(...args);
            };

            const wrapped = (...args) => {
                const now = Date.now();
                const elapsed = now - lastRun;
                if (lastRun === 0 || elapsed >= waitMs) {
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    pendingArgs = null;
                    invoke(args);
                    return;
                }

                pendingArgs = args;
                if (timeoutId !== null) {
                    return;
                }

                timeoutId = setTimeout(() => {
                    timeoutId = null;
                    if (pendingArgs) {
                        const next = pendingArgs;
                        pendingArgs = null;
                        invoke(next);
                    }
                }, waitMs - elapsed);
            };

            registerCleanup(() => {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                pendingArgs = null;
            });

            return wrapped;
        }
    });
}

function createScheduler(runNow, options) {
    let microtaskQueued = false;
    let debounceTimer = null;
    let throttleTimer = null;
    let rafHandle = null;
    let lastRunAt = 0;

    function clearScheduledWork() {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (throttleTimer !== null) {
            clearTimeout(throttleTimer);
            throttleTimer = null;
        }
        if (rafHandle !== null) {
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(rafHandle);
            } else {
                clearTimeout(rafHandle);
            }
            rafHandle = null;
        }
        microtaskQueued = false;
    }

    function invokeNow() {
        microtaskQueued = false;
        debounceTimer = null;
        throttleTimer = null;
        rafHandle = null;
        lastRunAt = Date.now();
        runNow();
    }

    function schedule() {
        if (options.debounceMs > 0) {
            if (debounceTimer !== null) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(invokeNow, options.debounceMs);
            return;
        }

        if (options.throttleMs > 0) {
            const now = Date.now();
            const elapsed = now - lastRunAt;
            if (lastRunAt === 0 || elapsed >= options.throttleMs) {
                invokeNow();
                return;
            }

            if (throttleTimer !== null) {
                return;
            }

            throttleTimer = setTimeout(invokeNow, options.throttleMs - elapsed);
            return;
        }

        if (options.raf) {
            if (rafHandle !== null) {
                if (typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(rafHandle);
                } else {
                    clearTimeout(rafHandle);
                }
            }

            if (typeof requestAnimationFrame === 'function') {
                rafHandle = requestAnimationFrame(invokeNow);
            } else {
                rafHandle = setTimeout(invokeNow, 16);
            }
            return;
        }

        if (options.flush === 'sync') {
            invokeNow();
            return;
        }

        if (microtaskQueued) {
            return;
        }
        microtaskQueued = true;
        queueMicrotask(invokeNow);
    }

    return {
        schedule,
        cancel: clearScheduledWork
    };
}

function queueWhenScopeReady(scope, callback) {
    if (!scope || scope.disposed) {
        return;
    }
    if (scope.mountReady) {
        callback();
        return;
    }
    scope.pendingMounts.push(callback);
}

function createAutoTrackedEffect(effect, options, scope) {
    let disposed = false;
    const activeSubscriptions = new Map();
    const runCleanups = [];

    _effectIdCounter += 1;
    const effectId = _effectIdCounter;

    function registerCleanup(cleanup) {
        if (typeof cleanup !== 'function') {
            throw new Error('[Zenith Runtime] cleanup(fn) requires a function');
        }
        runCleanups.push(cleanup);
    }

    function runEffectNow() {
        if (disposed || !scope || scope.disposed) {
            return;
        }

        drainCleanupStack(runCleanups);

        const nextDependenciesById = new Map();
        const previousCollector = _activeDependencyCollector;

        _activeDependencyCollector = (source) => {
            if (!source || typeof source.subscribe !== 'function') {
                return;
            }
            const reactiveId = Number.isInteger(source.__zenith_id) ? source.__zenith_id : 0;
            if (!nextDependenciesById.has(reactiveId)) {
                nextDependenciesById.set(reactiveId, source);
            }
        };

        try {
            const result = effect(createEffectContext(registerCleanup));
            applyCleanupResult(result, registerCleanup);
        } finally {
            _activeDependencyCollector = previousCollector;
        }

        const nextDependencies = Array.from(nextDependenciesById.values()).sort((left, right) => {
            const leftId = Number.isInteger(left.__zenith_id) ? left.__zenith_id : 0;
            const rightId = Number.isInteger(right.__zenith_id) ? right.__zenith_id : 0;
            return leftId - rightId;
        });

        const nextSet = new Set(nextDependencies);

        for (const [dependency, unsubscribe] of activeSubscriptions.entries()) {
            if (nextSet.has(dependency)) {
                continue;
            }
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            activeSubscriptions.delete(dependency);
        }

        for (let i = 0; i < nextDependencies.length; i++) {
            const dependency = nextDependencies[i];
            if (activeSubscriptions.has(dependency)) {
                continue;
            }

            const unsubscribe = dependency.subscribe(() => {
                scheduler.schedule();
            });

            activeSubscriptions.set(
                dependency,
                typeof unsubscribe === 'function' ? unsubscribe : () => {}
            );
        }

        void effectId;
    }

    const scheduler = createScheduler(runEffectNow, options);

    function disposeEffect() {
        if (disposed) {
            return;
        }
        disposed = true;

        scheduler.cancel();

        for (const unsubscribe of activeSubscriptions.values()) {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        }
        activeSubscriptions.clear();

        drainCleanupStack(runCleanups);
    }

    registerScopeDisposer(scope, disposeEffect);
    queueWhenScopeReady(scope, () => scheduler.schedule());

    return disposeEffect;
}

function createExplicitDependencyEffect(effect, dependencies, scope) {
    if (!Array.isArray(dependencies)) {
        throw new Error('[Zenith Runtime] zeneffect(fn, deps) requires deps array');
    }
    if (dependencies.length === 0) {
        throw new Error('[Zenith Runtime] zeneffect(fn, deps) requires at least one dependency');
    }

    const normalizedOptions = DEFAULT_EFFECT_OPTIONS;

    let disposed = false;
    const runCleanups = [];
    const unsubscribers = [];

    function registerCleanup(cleanup) {
        if (typeof cleanup !== 'function') {
            throw new Error('[Zenith Runtime] cleanup(fn) requires a function');
        }
        runCleanups.push(cleanup);
    }

    function runNow() {
        if (disposed || !scope || scope.disposed) {
            return;
        }

        drainCleanupStack(runCleanups);
        const result = effect(createEffectContext(registerCleanup));
        applyCleanupResult(result, registerCleanup);
    }

    const scheduler = createScheduler(runNow, normalizedOptions);

    for (let i = 0; i < dependencies.length; i++) {
        const dependency = dependencies[i];
        if (!dependency || typeof dependency.subscribe !== 'function') {
            throw new Error(
                `[Zenith Runtime] zeneffect dependency at index ${i} must expose subscribe(fn)`
            );
        }

        const unsubscribe = dependency.subscribe(() => scheduler.schedule());
        unsubscribers.push(typeof unsubscribe === 'function' ? unsubscribe : () => {});
    }

    function disposeEffect() {
        if (disposed) {
            return;
        }
        disposed = true;

        scheduler.cancel();

        for (let i = 0; i < unsubscribers.length; i++) {
            unsubscribers[i]();
        }
        unsubscribers.length = 0;

        drainCleanupStack(runCleanups);
    }

    registerScopeDisposer(scope, disposeEffect);
    queueWhenScopeReady(scope, () => scheduler.schedule());

    return disposeEffect;
}

export function zenMount(callback, scopeOverride) {
    requireFunction(callback, 'zenMount(callback)');

    const scope = resolveScope(scopeOverride);
    const mountCleanups = [];
    let disposed = false;

    function registerCleanup(cleanup) {
        if (typeof cleanup !== 'function') {
            throw new Error('[Zenith Runtime] cleanup(fn) requires a function');
        }
        mountCleanups.push(cleanup);
    }

    const invokeMount = () => {
        if (disposed || !scope || scope.disposed) {
            return;
        }

        const result = callback(createMountContext(registerCleanup));
        applyCleanupResult(result, registerCleanup);
    };

    queueWhenScopeReady(scope, invokeMount);

    function disposeMount() {
        if (disposed) {
            return;
        }
        disposed = true;

        if (scope && !scope.mountReady && Array.isArray(scope.pendingMounts)) {
            const index = scope.pendingMounts.indexOf(invokeMount);
            if (index >= 0) {
                scope.pendingMounts.splice(index, 1);
            }
        }

        drainCleanupStack(mountCleanups);
    }

    registerScopeDisposer(scope, disposeMount);

    return disposeMount;
}

export function zenEffect(effect, options, scopeOverride) {
    requireFunction(effect, 'zenEffect(effect, options)');

    const scope = resolveScope(scopeOverride);
    const normalizedOptions = normalizeEffectOptions(options);

    return createAutoTrackedEffect(effect, normalizedOptions, scope);
}

export function zeneffect(effect, dependenciesOrOptions, scopeOverride) {
    if (Array.isArray(effect) && typeof dependenciesOrOptions === 'function') {
        return zeneffect(dependenciesOrOptions, effect, scopeOverride);
    }

    requireFunction(effect, 'zeneffect(fn, deps)');

    const scope = resolveScope(scopeOverride);

    if (Array.isArray(dependenciesOrOptions)) {
        return createExplicitDependencyEffect(effect, dependenciesOrOptions, scope);
    }

    return zenEffect(effect, dependenciesOrOptions, scope);
}

export function createSideEffectScope(label = 'component') {
    return createInternalScope(String(label || 'component'), false);
}

export function activateSideEffectScope(scope) {
    if (!scope || scope.disposed) {
        return;
    }

    scope.mountReady = true;

    if (!Array.isArray(scope.pendingMounts) || scope.pendingMounts.length === 0) {
        return;
    }

    const pending = scope.pendingMounts.slice();
    scope.pendingMounts.length = 0;

    for (let i = 0; i < pending.length; i++) {
        pending[i]();
    }
}

export function disposeSideEffectScope(scope) {
    if (!scope || scope === _globalScope) {
        return;
    }
    disposeScope(scope);
}

export function resetGlobalSideEffects() {
    disposeScope(_globalScope);
    _globalScope = createInternalScope('global', true);
}

export function _trackDependency(source) {
    if (typeof _activeDependencyCollector === 'function') {
        _activeDependencyCollector(source);
    }
}

export function _nextReactiveId() {
    _reactiveIdCounter += 1;
    return _reactiveIdCounter;
}
