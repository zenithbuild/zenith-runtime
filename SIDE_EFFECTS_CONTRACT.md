# Side Effects Contract

Zenith Canonical Law — governing all imperative side effects.

---

## 1. Purpose

Zenith is compile-time first. Templates compile to deterministic DOM instructions. Reactive bindings resolve via stable IDs generated at compilation. No virtual DOM. No runtime diffing.

Side effects exist for one reason: **third-party libraries and DOM imperatives that cannot be expressed as compile-time transforms.** GSAP animations, ScrollTrigger instances, intersection observers, canvas contexts, WebSocket connections — these require imperative setup and teardown that the compiler cannot own.

Zenith provides exactly three primitives for this: `zenMount`, `zenEffect`, and `ref`. No others exist or will be added.

---

## 2. Primitives

### `zenMount(callback)`

Runs once per component instance when the DOM is ready. Receives a context object with a `cleanup` registration function.

```ts
zenMount(({ cleanup }) => {
    const ctx = gsap.context(() => { /* ... */ }, host);

    cleanup(() => {
        ctx.revert();
    });
});
```

**Behavior:**
- Executes after the component's host element exists in the DOM.
- Runs exactly once per scope lifetime. Never re-runs.
- Cleanup functions run on scope disposal (navigation, unmount).
- If the scope is already disposed when mount fires, the callback is skipped.

**Cleanup patterns (all supported):**

```ts
// Pattern A: return a function
zenMount(() => {
    const instance = setup();
    return () => instance.destroy();
});

// Pattern B: cleanup registration
zenMount(({ cleanup }) => {
    const instance = setup();
    cleanup(() => instance.destroy());
});

// Pattern C: return object with cleanup property
zenMount(() => {
    const instance = setup();
    return { cleanup: () => instance.destroy() };
});
```

All three patterns are equivalent. Pattern B allows registering multiple cleanup functions within a single mount.

---

### `zenEffect(effect, options?)`

Reactive effect with automatic dependency tracking. Re-runs when any tracked `signal` or `state` dependency changes. Cleanup runs before every re-run and on scope disposal.

```ts
const ready = signal(false);

zenEffect(() => {
    if (!ready.get()) return;

    const frameId = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(frameId);
});
```

**Behavior:**
- Auto-tracks: any `signal.get()` or `state.get()` call during execution is registered as a dependency.
- Re-runs when any tracked dependency changes.
- Cleanup (returned function) runs **before** re-run and **on** scope disposal.
- First run happens when the scope is ready (after mount).

---

### `ref<T>()`

Structural DOM pointer. Returns a plain object `{ current: T | null }` that the compiler wires to Deterministic DOM node at mount time. **Non-reactive** — accessing `ref.current` never triggers dependency tracking.

```ts
const hero = ref<HTMLElement>();
// In template: <section ref={hero}> ... </section>
```

After mount, `hero.current` is the `<section>` DOM node.

**Markup:**

```html
<section ref={hero}>...</section>
```

Only bare identifiers are allowed. The following are compile-time errors:

```html
<!-- ❌ string literal -->
<section ref="hero">

<!-- ❌ expression -->
<section ref={getRef()}>

<!-- ❌ conditional -->
<section ref={cond ? a : b}>
```

**Behavior:**
- `ref()` returns `{ current: null }` (or `{ current: initialValue }` if provided).
- `.current` is assigned synchronously in `mount()`, before any `zenMount` or `zenEffect` callbacks fire.
- `.current` is **not** reactive — reading it does not register as a dependency for `zenEffect`.
- On scope disposal, `.current` is eligible for garbage collection (no explicit null needed — the ref object itself goes away).

**Internal mechanism:**
1. The compiler transforms `ref={identifier}` into `data-zx-r="<index>"` on the element.
2. The bundler injects `host.querySelector('[data-zx-r="<index>"]')` in the component's `mount()` and assigns `.current`.
3. No `MutationObserver`, no runtime discovery, no framework magic.

**Canonical example — ref + GSAP:**

```ts
<script lang="ts">
const section = ref<HTMLElement>();
const title = ref<HTMLElement>();

zenMount(({ cleanup }) => {
    // section.current and title.current are guaranteed non-null here
    const split = new SplitText(title.current, { type: "chars", mask: "chars" });
    const ctx = gsap.context(() => {
        gsap.from(split.chars, { yPercent: 110, autoAlpha: 0, stagger: 0.02 });
    }, section.current);

    cleanup(() => {
        ctx.revert();
        split.revert();
    });
});
</script>
<section ref={section}>
    <h1 ref={title}>ZENITH</h1>
</section>
```

## 3. Scheduling Options

`zenEffect` accepts an optional second argument for scheduling control:

```ts
zenEffect(effect, {
    debounceMs: 200,   // Debounce re-runs by N milliseconds
    throttleMs: 100,   // Throttle re-runs to at most once per N milliseconds
    raf: true,          // Schedule re-runs via requestAnimationFrame
    flush: 'post'       // 'post' (default, microtask) or 'sync' (immediate)
});
```

**Rules:**
- Only one scheduling mode may be active: `debounceMs`, `throttleMs`, or `raf`. Using more than one throws.
- `flush: 'sync'` runs the effect synchronously on dependency change. `flush: 'post'` (default) defers to microtask.
- Pending scheduled callbacks are cancelled on cleanup and disposal.

---

## 4. Cleanup Rules

### Cleanup-before-rerun
When a `zenEffect` dependency changes, the previous cleanup runs **before** the next invocation. This prevents resource leaks from overlapping setups.

### Cleanup-on-dispose
When a component scope is disposed (navigation, unmount), all registered cleanups run in **reverse registration order**. This guarantees LIFO teardown — later setups tear down first.

### Cleanup failures are swallowed
A cleanup function that throws will not break the teardown chain. Other cleanups continue executing. This is a stability guarantee for third-party library cleanup that may fail in edge cases.

---

## 5. Determinism Guarantees

### Scoped isolation
Each component instance gets its own side-effect scope. Effects in component A cannot leak into component B. Navigation destroys all scopes for the outgoing page and creates fresh scopes for the incoming page.

### No leak across navigation
Scope disposal is deterministic. After navigation cleanup:
- All `zenMount` cleanups have run.
- All `zenEffect` cleanups have run.
- All pending scheduled callbacks are cancelled.
- No timers, animation frames, or subscriptions survive.

### Stable dependency tracking
Dependencies are tracked in call order during effect execution. The reactive ID (`__zenith_id`) determines subscription ordering when multiple effects track the same source. This is deterministic and stable across re-runs.

---

## 6. Prohibitions

### No nested `<script>` in markup
Component scripts live in a single `<script lang="ts">` block. Inline `<script>` tags in the template are not processed by the Zenith compiler and will not have access to `zenMount`, `zenEffect`, `signal`, `state`, or `host`.

### No reactive boundary creation
Component scripts execute within the parent's reactive scope. A component `<script>` must NOT create a new reactive boundary. Slot content reactivity remains in the parent scope. This is a compiler invariant.

### No direct innerHTML takeover
After the SSR-preserving innerHTML guard, components must not unconditionally overwrite `host.innerHTML`. The bundler injects template content only when `host.innerHTML.trim().length === 0`. Component scripts must work with the existing DOM, not replace it.

---

## 7. Canonical Examples

### GSAP + ScrollTrigger + SplitText

```ts
<script lang="ts">
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

const sectionReady = signal(false);

zenEffect(() => {
    if (!sectionReady.get()) return;
    const frameId = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(frameId);
});

zenMount(({ cleanup }) => {
    gsap.registerPlugin(ScrollTrigger, SplitText);

    const section = host;
    if (!section) return;

    const splits = [];

    const split = new SplitText(section.querySelector("[data-title]"), {
        type: "chars",
        mask: "chars"
    });
    splits.push(split);

    const ctx = gsap.context(() => {
        gsap.timeline({
            scrollTrigger: {
                trigger: section,
                start: "top 70%",
                toggleActions: "play none none reverse"
            }
        }).from(split.chars, {
            yPercent: 110,
            autoAlpha: 0,
            duration: 0.9,
            stagger: 0.02
        });
    }, section);

    sectionReady.set(true);

    cleanup(() => {
        sectionReady.set(false);
        ctx.revert();
        splits.forEach(s => s.revert());
    });
});
</script>
```

### Lenis / Locomotive Scroll

```ts
<script lang="ts">
import Lenis from "lenis";

zenMount(({ cleanup }) => {
    const lenis = new Lenis({ wrapper: host });

    function raf(time) {
        lenis.raf(time);
        handle = requestAnimationFrame(raf);
    }
    let handle = requestAnimationFrame(raf);

    cleanup(() => {
        cancelAnimationFrame(handle);
        lenis.destroy();
    });
});
</script>
```

### Barba.js page transitions

```ts
<script lang="ts">
import barba from "@barba/core";

zenMount(({ cleanup }) => {
    barba.init({
        transitions: [{
            leave: ({ current }) => gsap.to(current.container, { opacity: 0 }),
            enter: ({ next }) => gsap.from(next.container, { opacity: 0 })
        }]
    });

    cleanup(() => {
        barba.destroy();
    });
});
</script>
```
