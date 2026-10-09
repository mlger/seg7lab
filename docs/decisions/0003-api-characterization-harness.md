# 0003 — API contract characterization harness

**Status:** accepted · **Date:** 2026-10-09 · **Phases:** 0, 1

## Context

The REST API has no executable test coverage, yet Phase 1 rewrites every route and
helper. The contract is subtle: status-code precedence (415 before 404 on PUT),
existence-hiding 404s vs 403s, the `{error, errors?}` envelope, canonicalization of
stored blobs, list ordering by `updatedAt desc`, clamped pagination, shared-row
writeability. Documentation alone cannot catch a regression.

## Alternatives considered

1. **Jest/Vitest route unit tests.** Adds dev dependencies (ADR-0005 forbids) and
   framework setup; the repo's convention is runnable verification scripts
   (`verify-logic`, `verify-circuitverse`).
2. **Golden-file characterization against a live dev server.** Matches the repo
   culture; exercises the real stack end-to-end (route → validation → Prisma →
   SQLite); needs determinism discipline.
3. **No new coverage, rely on tsc.** Rejected — tsc proves nothing about behavior.

## Decision

`scripts/verify-api.mjs`: a 70-check sequential request sequence against a running
dev server with a **fresh database**. All row ids are client-supplied, ISO
timestamps are normalized to `<TS>`, so the recorded output
(`docs/verification/api-contract.json`) is deterministic — proven by recording
twice against two fresh databases and diffing byte-identical.

Modes: `--record` (re-baseline) and default (compare). Wired as
`npm run verify:api`.

## Consequences

- Phase 1 is gated on 70/70 byte-identical output; any contract drift (status,
  body, ordering, envelope) fails loudly.
- The harness doubles as a permanent regression test going forward.
- Limitations: it cannot exercise server-generated cuid ids (client ids only),
  corrupt-blob tolerance on read (all writes validate), or concurrent races —
  documented as gaps in VERIFICATION.md; the in-repo service tests (Phase 1)
  cover corrupt-blob and kind-mismatch logic at the unit level.
- Requires the reset dance (stop server → `rm db/custom.db` → `prisma db push` →
  start) documented in the script header.

**Related:** [0002](./0002-server-service-repository.md)
