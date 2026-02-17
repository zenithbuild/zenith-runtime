# Zenith Runtime V0 Hydration Contract

Status: FROZEN (V0)

This contract locks hydration and reactivity boundaries for Zenith V0.

## 1. No Runtime Discovery

Runtime must not discover bindings by scanning unknown DOM structure.

Allowed:
- Resolve selectors from bundler-provided marker/event tables.

Forbidden:
- Global `querySelectorAll('*')` discovery passes.
- Runtime inference of binding intent from HTML shape.

## 2. No Implicit Reactivity

Runtime primitives are explicit:
- `signal(initial)`
- `state(initialObject)`
- `zeneffect(fn, dependencies)`

Forbidden:
- Proxy-based tracking.
- Implicit dependency capture contexts.
- Scheduler/queue abstractions.

## 3. Deterministic Ordering

Compiler expression ordering is canonical.
Bundler and runtime must preserve index semantics exactly.

Required:
- Marker indices are sequential `0..N-1`.
- Marker count equals expression table length.
- Runtime never remaps indices.

## 4. Explicit Bootstrap

Hydration is explicit and called by bundler bootstrap only:

```js
hydrate({
  ir_version: 1,
  graph_hash: __zenith_graph_hash,
  root: document,
  expressions: __zenith_expr,
  markers: __zenith_markers,
  events: __zenith_events,
  state_values: __zenith_state_values,
  signals: __zenith_signals,
  components: __zenith_components,
  params: __zenith_params,
  ssr_data: __zenith_ssr_data
});
```

Runtime must export functions only. Runtime must not auto-run.

`graph_hash` is compile-time identity metadata. Runtime does not recompute graph shape.

## 5. Component Factory Payload

Component scripts are compile-time hoisted and emitted as factory modules.
Runtime receives only explicit component references in `payload.components`.

Required:
- Component host selectors are provided by bundler.
- Runtime instantiates factories only from payload.
- Runtime merges returned `bindings` into hydration state by instance key.

Forbidden:
- Runtime component discovery by scanning unknown DOM shape.
- Runtime-generated component wrappers or lifecycle registries.

## 6. Hard Fail Semantics

Runtime must throw for contract drift:
- Missing or unsupported `ir_version`.
- Duplicate marker indices.
- Missing index in sequence.
- Out-of-order expression table entries.
- Out-of-order marker table entries.
- Marker index out of bounds.
- Marker/expression count mismatch.
- Event index out of bounds.

No fallback behavior is allowed for broken payload contracts.

## 7. Determinism and Purity

Forbidden in runtime/bundler output:
- `eval(`
- `new Function(`
- `require(`
- `Date(`
- `Math.random(`
- `crypto.randomUUID(`
- `process.env`

Compile-time guarantees override runtime flexibility.

## 8. Runtime API Freeze

Runtime public API is closed for V0:
- `hydrate(payload)`
- `signal(initial)`
- `state(initialObject)`
- `zeneffect(dependencies, fn)`
- `zeneffect(fn, dependencies)`

No additional runtime helpers may be exported in V0.

Any runtime API expansion requires:
1. A contract update.
2. Integration hardening tests.
3. Major version bump.
