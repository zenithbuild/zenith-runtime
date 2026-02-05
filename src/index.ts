// Zenith Runtime
// Ported from hydration_runtime.js

// Global types for internal use
declare global {
    interface Window {
        __ZENITH_RUNTIME__: any;
        __ZENITH_STATE__: any;
        __ZENITH_SCOPES__: any;
        __ZENITH_EXPRESSIONS__: any;
        __zenith: any;
        zenSignal: any;
        zenState: any;
        zenEffect: any;
        zenMemo: any;
        zenBatch: any;
        zenUntrack: any;
        zenRef: any;
        zenOnMount: any;
        zenOnUnmount: any;
        zenithHydrate: any;
        zenithNotify: any;
        zenithSubscribe: any;
        zenOrder: any;
        zenFixSVGNamespace: any;
    }
}

// Internal reactivity state
let cE: any = null;
const cS: any[] = [];
let bD = 0;
const pE = new Set<any>();
if (typeof window !== 'undefined') {
    window.__ZENITH_EXPRESSIONS__ = new Map();
    window.__ZENITH_SCOPES__ = {};
}
let isFlushing = false;
let flushScheduled = false;

// Phase A3: Post-Mount Execution Hook
const mountedScopes = new Set<string>();

export function mountComponent(scopeId: string) {
    if (mountedScopes.has(scopeId)) return;
    mountedScopes.add(scopeId);

    const scope = window.__ZENITH_SCOPES__[scopeId];
    if (!scope) return;

    if (typeof scope.__run === 'function') {
        scope.__run();
    }
}

function pC(e: any) { cS.push(cE); cE = e; }
function oC() { cE = cS.pop(); }
function tD(s: Set<any>) { if (cE) { s.add(cE); cE.dependencies.add(s); } }

export function zenRoute() {
    if (typeof window === 'undefined') return { path: '/', slugs: [] };
    const path = window.location.pathname;
    return {
        path: path,
        slugs: path.split('/').filter(Boolean)
    };
}

function nS(s: Set<any> | undefined) {
    if (!s) return;
    const es = Array.from(s);
    for (const e of es) {
        if (e.isRunning) continue;
        if (bD > 0 || isFlushing) pE.add(e);
        else e.run();
    }
}

function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
        flushScheduled = false;
        flushEffects();
    });
}

function flushEffects() {
    if (isFlushing || bD > 0) return;
    isFlushing = true;
    try {
        while (pE.size > 0) {
            const efs = Array.from(pE);
            pE.clear();
            for (const e of efs) {
                if (!e.isRunning) e.run();
            }
        }
    } finally {
        isFlushing = false;
    }
}

function cEf(e: any) { for (const d of e.dependencies) d.delete(e); e.dependencies.clear(); }

export const signal = function (v: any) {
    const s = new Set<any>();
    function sig(nV?: any) {
        if (arguments.length === 0) { tD(s); return v; }
        if (nV !== v) { v = nV; nS(s); scheduleFlush(); }
        return v;
    }
    sig._isSignal = true; sig.toString = () => String(v); sig.valueOf = () => v;
    return sig;
};

export const state = function (o: any) {
    const subs = new Map<string, Set<any>>();
    function gS(p: string) { if (!subs.has(p)) subs.set(p, new Set()); return subs.get(p); }
    function notify(p: string) { nS(gS(p)); scheduleFlush(); }
    function subscribe(p: string, ef: any) { gS(p)!.add(ef); ef.dependencies.add(gS(p)); }
    function cP(obj: any, pPath = ''): any {
        if (obj === null || typeof obj !== 'object' || obj._isSignal) return obj;
        return new Proxy(obj, {
            get(t, p) {
                if (p === Symbol.for('zenith_notify')) return notify;
                if (p === Symbol.for('zenith_subscribe')) return subscribe;
                if (typeof p === 'symbol') return t[p];
                const path = pPath ? `${pPath}.${String(p)}` : String(p);
                tD(gS(path)!);
                const v = t[p];
                if (v !== null && typeof v === 'object' && !v._isSignal) return cP(v, path);
                return v;
            },
            set(t, p, nV) {
                if (typeof p === 'symbol') { t[p] = nV; return true; }
                const path = pPath ? `${pPath}.${String(p)}` : String(p);
                const oV = t[p];
                if (oV && typeof oV === 'function' && oV._isSignal) oV(nV);
                else if (oV !== nV) {
                    t[p] = nV;
                    nS(gS(path));
                    const pts = path.split('.');
                    for (let i = pts.length - 1; i >= 0; i--) {
                        const pp = pts.slice(0, i).join('.');
                        if (pp) nS(gS(pp));
                    }
                    scheduleFlush();
                }
                return true;
            }
        });
    }
    return cP(o);
};

export const effect = function (fn: () => any, opts: any = {}) {
    let cl: any, tm: any;
    const ef: any = {
        dependencies: new Set(),
        isRunning: false,
        run: () => {
            if (ef.isRunning) return;
            const schedule = opts.scheduler || ((f: any) => f());
            if (opts.debounce) {
                if (tm) clearTimeout(tm);
                tm = setTimeout(() => schedule(ex), opts.debounce);
            } else schedule(ex);
        }
    };
    function ex() {
        if (ef.isRunning) return;
        ef.isRunning = true;
        cEf(ef);
        pC(ef);
        try { if (cl) cl(); cl = fn(); }
        finally {
            oC();
            ef.isRunning = false;
        }
    }
    if (!opts.defer) ex();
    return () => { cEf(ef); if (cl) cl(); };
};

export const memo = function (fn: () => any) {
    const sig = signal(undefined);
    effect(() => sig(fn()));
    const m = () => sig(); m._isSignal = true; return m;
};

export const batch = function (fn: () => void) {
    bD++;
    try { fn(); } finally {
        bD--;
        if (bD === 0) flushEffects();
    }
};

export const untrack = function (fn: () => any) {
    pC(null);
    try { return fn(); } finally { oC(); }
};

export const ref = (i: any) => ({ current: i || null });
export const onMount = (cb: () => void) => { if (window.__zenith && window.__zenith.activeInstance) window.__zenith.activeInstance.mountHooks.push(cb); };
export const onUnmount = (cb: () => void) => { /* TODO */ };

// DOM Helper (hC)
function hC(parent: Node, child: any) {
    if (child == null || child === false) return;

    let fn = child;
    let id: string | null = null;
    if (typeof child === 'object' && child.fn) {
        fn = child.fn;
        id = child.id;
    }

    const isTitle = parent && (parent as any).tagName && (parent as any).tagName.toLowerCase() === 'title';

    if (typeof fn === 'function') {
        if (isTitle) {
            const val = fn();
            if (val != null && val !== false) {
                const text = String(val);
                parent.appendChild(document.createTextNode(text));
                document.title = text;
            }
            effect(() => {
                const newVal = fn();
                if (newVal != null && newVal !== false) {
                    const newText = String(newVal);
                    if (document.title !== newText) {
                        parent.textContent = newText;
                        document.title = newText;
                    }
                }
            }, { id: id ? `title-${id}` : 'title-sync' });
        } else {
            const ph = document.createComment('expr' + (id ? ':' + id : ''));
            parent.appendChild(ph);
            let curNodes: Node[] = [];
            effect(() => {
                const r = fn();
                curNodes.forEach(n => { if (n.parentNode) n.parentNode.removeChild(n); });
                curNodes = [];
                if (r == null || r === false) return;
                const items = Array.isArray(r) ? r.flat(Infinity) : [r];
                items.forEach(item => {
                    if (item == null || item === false) return;
                    const node = item instanceof Node ? item : document.createTextNode(String(item));
                    if (ph.parentNode) {
                        ph.parentNode.insertBefore(node, ph);
                        curNodes.push(node);
                    }
                });
            }, { id });
        }
    } else if (Array.isArray(child)) {
        child.flat(Infinity).forEach(c => hC(parent, c));
    } else {
        parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

// Global Hydration
export function hydrate(state: any, container: Element | Document = document, locals: any = {}) {
    const ir = (window as any).canonicalIR; if (!ir) return;
    window.__ZENITH_STATE__ = state;
    const rootScope = { state, props: {}, locals: locals };
    const nodes = ir(rootScope);

    function findTag(items: any, tag: string): any {
        const list = Array.isArray(items) ? items : [items];
        for (const item of list) {
            if (item instanceof Element && item.tagName.toLowerCase() === tag) return item;
            if (item instanceof DocumentFragment) {
                const found = findTag(Array.from(item.childNodes), tag);
                if (found) return found;
            }
        }
        return null;
    }

    const headNode = findTag(nodes, 'head');
    const bodyNode = findTag(nodes, 'body');

    if (headNode) {
        const headMount = document.head;
        const newTitle = headNode.querySelector('title');
        if (newTitle) {
            let oldTitle = headMount.querySelector('title');
            if (!oldTitle) {
                oldTitle = document.createElement('title');
                headMount.appendChild(oldTitle);
            }
            const resolveContent = (children: any): string => {
                let result = '';
                (Array.isArray(children) ? children : [children]).forEach(child => {
                    if (child == null || child === false) return;
                    if (typeof child === 'function') {
                        const val = child();
                        if (val != null && val !== false) result += String(val);
                    } else if (typeof child === 'object' && child.fn) {
                        const val = child.fn();
                        if (val != null && val !== false) result += String(val);
                    } else if (child instanceof Node) {
                        result += child.textContent || '';
                    } else {
                        result += String(child);
                    }
                });
                return result;
            };
            const titleContent = newTitle.childNodes.length > 0
                ? Array.from(newTitle.childNodes).map((n: any) => n.textContent).join('')
                : '';
            oldTitle.textContent = titleContent;
            document.title = titleContent;
            effect(() => {
                const text = oldTitle!.textContent?.trim();
                if (text && document.title !== text) {
                    document.title = text;
                }
            }, { id: 'title-sync' });
        }
        headNode.querySelectorAll('meta').forEach((newMeta: Element) => {
            const name = newMeta.getAttribute('name');
            if (name) {
                const oldMeta = headMount.querySelector(`meta[name="${name}"]`);
                if (oldMeta) oldMeta.setAttribute('content', newMeta.getAttribute('content')!);
                else headMount.appendChild(newMeta.cloneNode(true));
            }
        });
        headNode.childNodes.forEach((n: Node) => {
            if ((n as Element).tagName === 'TITLE' || (n as Element).tagName === 'META') return;
            headMount.appendChild(n.cloneNode(true));
        });
    }

    const bodyMount = container === document ? document.body : (container as Element);
    if (bodyNode) {
        bodyMount.innerHTML = '';
        Array.from(bodyNode.childNodes).forEach(n => hC(bodyMount, n));
    } else {
        bodyMount.innerHTML = '';
        const items = Array.isArray(nodes) ? nodes : [nodes];
        items.forEach(n => hC(bodyMount, n));
    }

    for (const scopeId in window.__ZENITH_SCOPES__) {
        mountComponent(scopeId);
    }

    queueMicrotask(() => {
        flushEffects();
        const titleEl = document.querySelector('title');
        if (titleEl && titleEl.textContent) {
            const text = titleEl.textContent.trim();
            if (text && document.title !== text) {
                document.title = text;
            }
        }
    });
}

// Ordered Effects
export function order(fn: () => void) {
    if (typeof fn === 'function') fn();
}

// Hyperscript
let currentNamespace: string | null = null;
export function h(tag: string, props: any, children: any) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const SVG_TAGS = new Set(['svg', 'path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect', 'g', 'defs', 'clipPath', 'mask', 'use', 'symbol', 'text', 'tspan', 'textPath', 'image', 'foreignObject', 'switch', 'desc', 'title', 'metadata', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feFlood', 'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feSpecularLighting', 'feTile', 'feTurbulence', 'animate', 'animateMotion', 'animateTransform', 'set', 'marker']);

    const isSvgTag = SVG_TAGS.has(tag) || SVG_TAGS.has(tag.toLowerCase());
    const useSvgNamespace = isSvgTag || currentNamespace === SVG_NS;

    const el = useSvgNamespace ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

    const previousNamespace = currentNamespace;
    if (tag === 'svg' || tag === 'SVG') {
        currentNamespace = SVG_NS;
    }

    if (props) {
        const setClass = (element: Element, value: any) => {
            if (useSvgNamespace && 'className' in element && typeof (element as any).className === 'object') {
                (element as any).className.baseVal = String(value || '');
            } else {
                (element as any).className = String(value || '');
            }
        };

        for (const [k, v] of Object.entries(props)) {
            if (k === 'ref') {
                if (v && typeof v === 'object' && 'current' in v) (v as any).current = el;
                else if (typeof v === 'string') {
                    const s = window.__ZENITH_STATE__;
                    if (s && s[v] && typeof s[v] === 'object' && 'current' in s[v]) s[v].current = el;
                }
            } else if (k.startsWith('on')) {
                let fn = v;
                if (v && typeof v === 'object' && (v as any).fn) fn = (v as any).fn;
                if (typeof fn === 'function') {
                    el.addEventListener(k.slice(2).toLowerCase(), (e) => {
                        // Fix: this binding via call(el, e, el)
                        const h = (fn as Function).call(el, e, el);
                        if (typeof h === 'function') h.call(el, e, el);
                    });
                }
            } else {
                let fn = v;
                let id = null;
                if (typeof v === 'object' && (v as any).fn) {
                    fn = (v as any).fn;
                    id = (v as any).id;
                }
                if (typeof fn === 'function') {
                    effect(() => {
                        const val = (fn as Function)();
                        if (k === 'class' || k === 'className') setClass(el, val);
                        else if (val == null || val === false) el.removeAttribute(k);
                        else if (el.setAttribute) el.setAttribute(k, String(val));
                    }, { id });
                } else {
                    if (k === 'class' || k === 'className') setClass(el, v);
                    else if (el.setAttribute) el.setAttribute(k, String(v));
                }
            }
        }
    }
    if (children) {
        const items = Array.isArray(children) ? children : [children];
        items.forEach(c => hC(el, c));
    }

    currentNamespace = previousNamespace;
    return el;
}

export function fragment(c: any) {
    const f = document.createDocumentFragment();
    const items = Array.isArray(c) ? c : [c];
    items.forEach(i => hC(f, i));
    return f;
}
