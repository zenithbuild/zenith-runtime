import { hydrate } from '../src/hydrate.js';
import { cleanup, _getCounts } from '../src/cleanup.js';

describe('hydrate() event contract', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        cleanup();
        document.body.removeChild(container);
    });

    test('binds event listeners by explicit index', () => {
        let clicks = 0;
        container.innerHTML = '<button data-zx-on-click="0">+</button>';

        hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, state_index: 0 }],
            markers: [{ index: 0, kind: 'event', selector: '[data-zx-on-click="0"]' }],
            events: [{ index: 0, event: 'click', selector: '[data-zx-on-click="0"]' }],
            state_values: [() => { clicks += 1; }],
            signals: []
        });

        container.querySelector('button').click();
        container.querySelector('button').click();
        expect(clicks).toBe(2);
        expect(_getCounts().listeners).toBe(1);
    });

    test('fails when event expression does not resolve to function', () => {
        container.innerHTML = '<button data-zx-on-click="0">+</button>';

        expect(() => hydrate({
            ir_version: 1,
            root: container,
            expressions: [{ marker_index: 0, state_index: 0 }],
            markers: [{ index: 0, kind: 'event', selector: '[data-zx-on-click="0"]' }],
            events: [{ index: 0, event: 'click', selector: '[data-zx-on-click="0"]' }],
            state_values: [42],
            signals: []
        })).toThrow('did not resolve to a function');
    });
});
