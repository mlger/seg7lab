# 0001 — `src/logic` stays the domain + application layer

**Status:** accepted · **Date:** 2026-10-09 · **Phases:** all

## Context

The refactor brief asks for Domain / Application / Infrastructure / Presentation layering.
`src/logic/` (22 modules, ~4,300 lines) already satisfies the domain + application
contract: it is pure (no React, no DOM, no framework imports), dependency-free at the
bottom of the module graph, and its behavior is pinned by 1298 logic checks and 64,205
CircuitVerse checks.

A textbook rename would move it to `src/domain/` + `src/application/`, rewriting
imports in ~30 consumer files (components, hooks, scripts) for zero behavioral gain.

## Alternatives considered

1. **Rename + regroup into `src/domain/`, `src/application/`.** Highest churn; the
   flat `src/logic` folder is already organized by capability (truth table, minimizer,
   circuits, exporters, formats) and every consumer path is verified by tests.
2. **Leave untouched, document as domain.** Zero risk; naming is clear from context
   ("pure logic layer — no React, no DOM" is the folder's own header convention).
3. **Regroup into subfolders without renaming the root.** Moderate churn for
   discoverability only; deferred (open question in ARCHITECTURE.md, not blocking).

## Decision

`src/logic` remains the domain + application layer, in place, with its current file
names. The Clean Architecture layering is introduced where coupling actually exists
(server, client state, UI wiring). The only edits inside `src/logic` are:
comment fixes, removal of the DOM-coupled `getViewportTransform` (Phase 3), and
nothing that changes behavior.

## Consequences

- Import paths for the most-used modules stay stable (`@/logic/engine`, …).
- The two verification suites act as the regression net for the whole layer.
- Future maintainers read `src/logic` as "domain — keep pure"; boundary lint
  (ADR-0006) enforces it mechanically.
- Tradeoff: the CA layer names differ from the folder names; ARCHITECTURE.md maps
  them explicitly so nobody has to rediscover this reasoning.

**Related:** [0002](./0002-server-service-repository.md) · [0006](./0006-boundary-enforcement.md)
