// ---------------------------------------------------------------------------
// platform.js — Zenith Runtime canonical DOM/platform helpers
// ---------------------------------------------------------------------------
// zenOn: SSR-safe event subscription with disposer
// zenResize: window resize handler with rAF throttle
// collectRefs: deterministic null-filtered ref collection
// ---------------------------------------------------------------------------

import { zenWindow } from './env.js';

/**
 * SSR-safe event subscription. Returns disposer.
 * @param {EventTarget | null} target
 * @param {string} eventName
 * @param {EventListener} handler
 * @param {AddEventListenerOptions | boolean} [options]
 * @returns {() => void}
 */
export function zenOn(target, eventName, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') {
        return () => {};
    }
    target.addEventListener(eventName, handler, options);
    return () => {
        target.removeEventListener(eventName, handler, options);
    };
}

/**
 * Window resize handler with requestAnimationFrame throttle.
 * Returns disposer.
 * @param {(size: { w: number; h: number }) => void} handler
 * @returns {() => void}
 */
export function zenResize(handler) {
    const win = zenWindow();
    if (!win || typeof win.addEventListener !== 'function') {
        return () => {};
    }
    let rafId = null;
    let lastW = 0;
    let lastH = 0;

    function onResize() {
        if (rafId !== null) return;
        rafId = win.requestAnimationFrame(() => {
            rafId = null;
            const w = win.innerWidth;
            const h = win.innerHeight;
            if (w !== lastW || h !== lastH) {
                lastW = w;
                lastH = h;
                handler({ w, h });
            }
        });
    }

    win.addEventListener('resize', onResize);
    onResize();

    return () => {
        if (rafId !== null) {
            win.cancelAnimationFrame(rafId);
            rafId = null;
        }
        win.removeEventListener('resize', onResize);
    };
}

/**
 * Deterministic null-filtered collection of ref.current values.
 * @param {...{ current?: Element | null }} refs
 * @returns {Element[]}
 */
export function collectRefs(...refs) {
    const out = [];
    for (let i = 0; i < refs.length; i++) {
        const node = refs[i] && refs[i].current;
        if (node && typeof node === 'object' && typeof node.nodeType === 'number') {
            out.push(node);
        }
    }
    return out;
}
