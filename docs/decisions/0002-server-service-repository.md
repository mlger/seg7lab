# 0002 — Server: service + repository layering with function-level DI

**Status:** accepted · **Date:** 2026-10-09 · **Phase:** 1

## Context

Today the four API route files implement business rules inline (ownership visibility,
existence-hiding 404s, the 404→403→409→400 error precedence, optimistic locking) and
query Prisma directly. `helpers.ts` in both route folders duplicates ~150 lines of
transport plumbing. There are no tests at the use-case level and no seam where
persistence could be replaced or faked.

## Alternatives considered

1. **Keep mirrored helpers, extract only a shared kernel.** Kills half the
   duplication but leaves business rules in HTTP handlers — P2/P3 unresolved.
2. **Class-based DI framework (tsyringe/inversify).** Disproportionate for a
   2-resource REST API; adds a dependency (see ADR-0005) and indirection.
3. **Service functions + repository interfaces, composed in a single module.**
   Matches the codebase's functional style; services are plain functions taking a
   repository; a composition module wires Prisma once.

## Decision

`src/server/<domain>/{service,repository,prisma}.ts` with:

- `service.ts` — pure use cases taking `(repo, input)`; own the business rules
  (visibility, precedence, locking, validation). Throw a typed `ApiError`
  (status + message + optional `errors`) — the internal error model.
- `repository.ts` — the persistence *contract* (interface + row types), owned by
  the domain, importable without Prisma at runtime (type-only Prisma imports).
- `prisma.ts` — the implementation; the only server module importing the Prisma
  singleton.
- `src/server/composition.ts` — composition root: `getProjectService()` /
  `getPresetService()` memoize a service wired to the Prisma repository.
- Routes: parse → resolve owner → call service → map `ApiError`/result to the
  exact existing `NextResponse` shapes.

No DI framework; injection is a function argument.

## Consequences

- Routes shrink to transport mapping; the error-precedence rules become testable
  use-case logic (Phase 1 adds `scripts/verify-services.ts` with an in-memory repo).
- The external contract is unchanged (guaranteed by ADR-0003's harness).
- One more directory hop for contributors; AGENTS.md documents the "add a field
  to a resource" path explicitly.
- A future Turso/Postgres adapter (relevant to ADR-0007) slots in as one new
  `*.prisma.ts`-style module without touching services.

**Related:** [0003](./0003-api-characterization-harness.md) · [0007](./0007-production-api-defect.md)
