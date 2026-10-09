# 0004 — Zustand store split behind a stable import surface

**Status:** accepted · **Date:** 2026-10-09 · **Phase:** 2a

## Context

`src/lib/store.ts` (1,389 lines) is one `create()` holding: workspace state (truth
table, settings, undo), preset-library state, localStorage persistence, cross-tab
listeners, and ~450 lines of server-sync/conflict machinery (module-level
singletons). Everything imports `@/lib/store` — ~20 consumer files.

## Alternatives considered

1. **Multiple stores per feature.** Breaks the app's own architecture rule: the
   truth table is *the* single source of truth and cross-slice actions (apply
   preset → regenerate table) need one transactional `set()`.
2. **Keep the monolith.** Leaves P5 unresolved; sync machinery untestable and
   unextractable.
3. **One store, slices in separate files, same module path.** Zustand slice
   pattern with a directory index: `src/lib/store/index.ts` re-exports
   `useSimulator` and the state types, so `@/lib/store` imports keep working.

## Decision

Option 3, plus extraction of the sync engine:

- `src/lib/store/types.ts` — the `SimulatorState` surface (unchanged shape).
- `src/lib/store/workspace.ts` — core workspace slice + persistence/hydration.
- `src/lib/store/library.ts` — preset-library slice (CRUD, apply, sync facade).
- `src/lib/store/index.ts` — combines slices, exports the same symbols as before.
- `src/lib/preset-sync.ts` — the fetch/merge/reconcile engine (moved verbatim,
  not rewritten): single-flight guard, lock tokens, 409 recovery, once-per-id
  warnings.

**Rules:** the public surface (`useSimulator`, `toProjectData`, action names,
localStorage keys, debounce timings, toast triggers) stays byte-identical; only
file layout changes. Cross-slice access via `get()`/`set()` exactly as today.

## Consequences

- Import paths unchanged → zero consumer churn; tsc + browser E2E protect the rest.
- The sync engine becomes a module with explicit inputs/outputs — reviewable and
  later testable without a store.
- Tradeoff: slice files still share one `set()`, so the boundary is convention +
  review, not enforced isolation; boundary lint (ADR-0006) covers the coarse rule
  (UI may not import `preset-sync` internals directly).

**Related:** [0006](./0006-boundary-enforcement.md)
