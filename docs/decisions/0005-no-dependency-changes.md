# 0005 — No dependency changes

**Status:** accepted · **Date:** 2026-10-09 · **Phases:** all

## Context

The refactor must be reviewable in isolation. `package.json` carries several
installed-but-unused dependencies (`zod` — never imported; `next-auth`,
`next-intl`, `@tanstack/react-query`, `sharp`, `uuid`, `input-otp`,
`react-day-picker`, … — used only by the stock shadcn primitives in
`src/components/ui/`, if at all). The build works with the current set.

## Alternatives considered

1. **Prune unused deps.** Tempting for `zod`, but any removal risks breaking a
   transitive or shadcn-primitive import discovered only at build time, and it
   pollutes the refactor diff with unrelated churn.
2. **Add a DI/test framework.** Rejected in ADR-0002; the function-injection +
   script-verification style covers the need.
3. **Freeze versions, note the unused set.** Keeps the diff purely structural.

## Decision

Freeze: no additions, no removals, no version bumps in `package.json` /
`bun.lock`. The unused-dependency list is recorded in VERIFICATION.md as a
follow-up cleanup item for the maintainer.

## Consequences

- The refactor diff is reviewable as structure-only; CI/lockfile noise is zero.
- `ApiResult` becomes used (api-client) rather than deleted; `zod` stays unused
  but present — flagged, not removed.
- Follow-up PR can prune deps with its own verification story.
