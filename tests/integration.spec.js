import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtimeApi from '../src/index.js';
import { hydrate } from '../src/hydrate.js';
import { cleanup } from '../src/cleanup.js';

describe('runtime API lock', () => {
    test('exports explicit hydration/reactivity functions', () => {
        const keys = Object.keys(runtimeApi).sort();
        expect(keys).toEqual(['hydrate', 'signal', 'state', 'zeneffect']);
    });
});

describe('hydrate integration contract', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        container.innerHTML = '<p data-zx-e="0"></p>';
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('applies one explicit bootstrap call with no auto-run discovery', () => {
        const unmount = hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, literal: 'Hello Zenith' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: []
        });

        expect(container.querySelector('p').textContent).toBe('Hello Zenith');
        expect(typeof unmount).toBe('function');
    });

    test('resolves params.* and ssr.* literal bindings deterministically', () => {
        container.innerHTML = '<p data-zx-e="0"></p><p data-zx-e="1"></p>';

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [
                { marker_index: 0, literal: 'params.id' },
                { marker_index: 1, literal: 'ssr.user.name' }
            ],
            markers: [
                { index: 0, kind: 'text', selector: '[data-zx-e~="0"]' },
                { index: 1, kind: 'text', selector: '[data-zx-e~="1"]' }
            ],
            events: [],
            state_values: [],
            signals: [],
            params: { id: '42' },
            ssr_data: { user: { name: 'Ada' } }
        });

        const nodes = container.querySelectorAll('p');
        expect(nodes[0].textContent).toBe('42');
        expect(nodes[1].textContent).toBe('Ada');
    });

    test('propagates signal props through component bindings', () => {
        container.innerHTML = '<Card data-zx-c="c0"><span data-zx-e="0"></span></Card>';
        const count = runtimeApi.signal(0);

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, component_instance: 'c0', component_binding: 'count' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [count],
            signals: [{ id: 0, kind: 'signal', state_index: 0 }],
            components: [{
                instance: 'c0',
                selector: '[data-zx-c~="c0"]',
                props: [{ name: 'count', type: 'signal', index: 0 }],
                create: (_host, props) => ({
                    mount() {},
                    destroy() {},
                    bindings: Object.freeze({
                        count: props.count
                    })
                })
            }]
        });

        expect(container.querySelector('span').textContent).toBe('0');
        count.set(3);
        expect(container.querySelector('span').textContent).toBe('3');
    });

    test('keeps static props immutable for component factories', () => {
        container.innerHTML = '<Card data-zx-c="c0"><span data-zx-e="0"></span></Card>';
        let propsFrozen = false;

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, component_instance: 'c0', component_binding: 'label' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: [],
            components: [{
                instance: 'c0',
                selector: '[data-zx-c~="c0"]',
                props: [{ name: 'label', type: 'static', value: 'Clicks' }],
                create: (_host, props) => {
                    propsFrozen = Object.isFrozen(props);
                    return {
                        mount() {},
                        destroy() {},
                        bindings: Object.freeze({
                            label: props.label
                        })
                    };
                }
            }]
        });

        expect(propsFrozen).toBe(true);
        expect(container.querySelector('span').textContent).toBe('Clicks');
    });

    test('hard-fails on corrupted component prop payload', () => {
        container.innerHTML = '<Card data-zx-c="c0"><span data-zx-e="0"></span></Card>';

        expect(() =>
            hydrate({
                ir_version: 1,
                root: container,
                expressions: [{ marker_index: 0, literal: 'x' }],
                markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
                events: [],
                state_values: [],
                signals: [],
                components: [{
                    instance: 'c0',
                    selector: '[data-zx-c~="c0"]',
                    props: [{ name: 'count', type: 'signal', index: 99 }],
                    create: () => ({ mount() {}, destroy() {}, bindings: Object.freeze({}) })
                }]
            })
        ).toThrow(/signal index .* did not resolve/);
    });

    test('hard-fails on malformed params/ssr payloads', () => {
        expect(() =>
            hydrate({
                ir_version: 1,
                root: container,
                expressions: [{ marker_index: 0, literal: 'x' }],
                markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
                events: [],
                state_values: [],
                signals: [],
                params: []
            })
        ).toThrow(/requires params object/);

        expect(() =>
            hydrate({
                ir_version: 1,
                root: container,
                expressions: [{ marker_index: 0, literal: 'x' }],
                markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
                events: [],
                state_values: [],
                signals: [],
                ssr_data: []
            })
        ).toThrow(/requires ssr_data object/);
    });

    test('freezes hydration payload tables and nested descriptors', () => {
        container.innerHTML = '<Card data-zx-c="c0"><span data-zx-e="0"></span></Card>';
        const payload = {
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, component_instance: 'c0', component_binding: 'label' }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [],
            signals: [],
            components: [{
                instance: 'c0',
                selector: '[data-zx-c~="c0"]',
                props: [{ name: 'label', type: 'static', value: { text: 'ok' } }],
                create: (_host, props) => ({
                    mount() {},
                    destroy() {},
                    bindings: Object.freeze({ label: props.label.text })
                })
            }]
        };

        hydrate(payload);

        expect(Object.isFrozen(payload)).toBe(true);
        expect(Object.isFrozen(payload.expressions)).toBe(true);
        expect(Object.isFrozen(payload.expressions[0])).toBe(true);
        expect(Object.isFrozen(payload.markers)).toBe(true);
        expect(Object.isFrozen(payload.signals)).toBe(true);
        expect(Object.isFrozen(payload.components)).toBe(true);
        expect(Object.isFrozen(payload.components[0])).toBe(true);
        expect(Object.isFrozen(payload.components[0].props)).toBe(true);
        expect(Object.isFrozen(payload.components[0].props[0])).toBe(true);
        expect(Object.isFrozen(payload.components[0].props[0].value)).toBe(true);

        expect(() => {
            payload.expressions[0].marker_index = 1;
        }).toThrow(TypeError);
        expect(() => {
            payload.signals.push({ id: 0, kind: 'signal', state_index: 0 });
        }).toThrow(TypeError);
    });

    test('hard-fails when signal table order is mutated', () => {
        const tracked = createTrackedSignal(0);
        expect(() =>
            hydrate({
                ir_version: 1,
                root: container,
                expressions: [{ marker_index: 0, signal_index: 0 }],
                markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
                events: [],
                state_values: [tracked],
                signals: [{ id: 1, kind: 'signal', state_index: 0 }]
            })
        ).toThrow(/signal table out of order/);
    });

    test('shared signal props keep identity across many component instances and cleanup subscriptions', () => {
        const instanceCount = 100;
        const componentRows = [];
        const expressions = [];
        const markers = [];
        const components = [];
        const seenSignalRefs = [];

        for (let i = 0; i < instanceCount; i++) {
            componentRows.push(`<Card data-zx-c="c${i}"><span data-zx-e="${i}"></span></Card>`);
            expressions.push({ marker_index: i, component_instance: `c${i}`, component_binding: 'count' });
            markers.push({ index: i, kind: 'text', selector: `[data-zx-e~="${i}"]` });
            components.push({
                instance: `c${i}`,
                selector: `[data-zx-c~="c${i}"]`,
                props: [{ name: 'count', type: 'signal', index: 0 }],
                create: (_host, props) => {
                    seenSignalRefs.push(props.count);
                    return {
                        mount() {},
                        destroy() {},
                        bindings: Object.freeze({ count: props.count })
                    };
                }
            });
        }

        container.innerHTML = `<main>${componentRows.join('')}</main>`;
        const count = runtimeApi.signal(0);
        let subscribeCalls = 0;
        const originalSubscribe = count.subscribe.bind(count);
        count.subscribe = (fn) => {
            subscribeCalls += 1;
            return originalSubscribe(fn);
        };

        const unmount = hydrate({
            ir_version: 1,
            root: container,
            expressions,
            markers,
            events: [],
            state_values: [count],
            signals: [{ id: 0, kind: 'signal', state_index: 0 }],
            components
        });

        expect(seenSignalRefs.length).toBe(instanceCount);
        for (let i = 0; i < seenSignalRefs.length; i++) {
            expect(seenSignalRefs[i]).toBe(count);
        }
        // The runtime should subscribe once for a shared component signal reference.
        expect(subscribeCalls).toBe(1);

        count.set(5);
        const textsAfterUpdate = Array.from(container.querySelectorAll('[data-zx-e]')).map((node) => node.textContent);
        expect(textsAfterUpdate.every((value) => value === '5')).toBe(true);

        unmount();
        count.set(9);
        const textsAfterCleanup = Array.from(container.querySelectorAll('[data-zx-e]')).map((node) => node.textContent);
        expect(textsAfterCleanup.every((value) => value === '5')).toBe(true);
    });

    test('hydrates deterministically across 100 runs without payload mutation or retained subscriptions', () => {
        const tracked = createTrackedSignal(0);
        const payload = {
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, signal_index: 0 }],
            markers: [{ index: 0, kind: 'text', selector: '[data-zx-e~="0"]' }],
            events: [],
            state_values: [tracked],
            signals: [{ id: 0, kind: 'signal', state_index: 0 }]
        };

        const snapshotBefore = JSON.stringify({
            expressions: payload.expressions,
            markers: payload.markers,
            events: payload.events,
            signals: payload.signals
        });

        let unmount = null;
        for (let i = 0; i < 100; i++) {
            unmount = hydrate(payload);
            tracked.set(i);
            expect(container.querySelector('p').textContent).toBe(String(i));
            expect(tracked.activeSubscribers()).toBe(1);
        }

        expect(tracked.subscribeCount()).toBe(100);
        expect(tracked.unsubscribeCount()).toBe(99);

        unmount();
        expect(tracked.activeSubscribers()).toBe(0);
        expect(tracked.unsubscribeCount()).toBe(100);

        const snapshotAfter = JSON.stringify({
            expressions: payload.expressions,
            markers: payload.markers,
            events: payload.events,
            signals: payload.signals
        });
        expect(snapshotAfter).toBe(snapshotBefore);
    });
});

function createTrackedSignal(initial) {
    let value = initial;
    const subscribers = new Set();
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;

    return {
        get() {
            return value;
        },
        set(nextValue) {
            value = nextValue;
            const snapshot = Array.from(subscribers);
            for (let i = 0; i < snapshot.length; i++) {
                snapshot[i](value);
            }
        },
        subscribe(fn) {
            subscribeCalls += 1;
            subscribers.add(fn);
            return () => {
                if (subscribers.delete(fn)) {
                    unsubscribeCalls += 1;
                }
            };
        },
        subscribeCount() {
            return subscribeCalls;
        },
        unsubscribeCount() {
            return unsubscribeCalls;
        },
        activeSubscribers() {
            return subscribers.size;
        }
    };
}

describe('runtime source guardrails', () => {
    test('contains no forbidden execution primitives', () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const srcDir = path.resolve(__dirname, '../src');
        const files = fs.readdirSync(srcDir).filter((name) => name.endsWith('.js'));

        for (let i = 0; i < files.length; i++) {
            const source = fs.readFileSync(path.join(srcDir, files[i]), 'utf8');
            expect(source.includes('eval(')).toBe(false);
            expect(source.includes('new Function')).toBe(false);
            expect(source.includes('process.env')).toBe(false);
        }
    });

    test('does not use full-tree DOM discovery', () => {
        const source = fs.readFileSync(
            path.resolve(
                path.dirname(fileURLToPath(import.meta.url)),
                '../src/hydrate.js'
            ),
            'utf8'
        );

        expect(source.includes("querySelectorAll('*')")).toBe(false);
    });
});
