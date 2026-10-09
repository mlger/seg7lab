# 0006 — Boundary enforcement via lint rules + verify script

**Status:** accepted · **Date:** 2026-10-09 · **Phases:** 3

## Context

The architecture's value erodes if future commits silently violate it: a React
import in `src/logic`, a Prisma import in a route handler, a component importing
`src/server/*`. The repo's culture is "a claim the UI makes must be backed by a
check" (README, §Verification) — the architectural claims deserve the same.

## Alternatives considered

1. **ESLint `no-restricted-imports` with per-folder overrides.** Idiomatic,
   editor-visible, but pattern-based path matching can be gamed by relative
   imports and is awkward for "anything under server/ must not import
   components/" style rules.
2. **A small verification script that walks `import` statements.** Fits the
   `verify-*` script convention; precise, greppable in CI; not editor-visible.
3. **Both.** Lint for the rules it expresses well; script as the authoritative
   check wired into package.json (`npm run verify:boundaries`).

## Decision

Option 3:

- `eslint.config.mjs` gains `no-restricted-imports` blocks: `src/logic/**`
  bans `react`, `react-dom`, `next/**`; `src/app/api/**` bans `@/lib/db`,
  `@/server/db`, `@prisma/client`; `src/lib/**` + `src/components/**` ban
  `@/server/**`.
- `scripts/verify-boundaries.mjs` walks first-party `src/**` files, parses
  import specifiers with a regex tuned to this codebase (ESM, `@/` alias,
  relative), and asserts the full dependency matrix from ARCHITECTURE.md,
  including "logic is import-free of everything below it".

## Consequences

- `npm run lint` and `npm run verify:boundaries` both fail on violations;
  PR review gets an objective check.
- Regex import-parsing is conservative: dynamic `import()` and `require` of
  non-analyzable specifiers would be missed — acceptable at this codebase's
  style (verified: no dynamic imports in first-party src).
- Maintenance cost: one small script + one lint block, both documented in
  AGENTS.md.
