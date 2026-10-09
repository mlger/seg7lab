# Verification Evidence

**Plan:** [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) · **Progress:** [REFACTOR_PROGRESS.md](./REFACTOR_PROGRESS.md)

Environment: Node v24.21.0, Bun 1.3.14, repo checkout at
`/home/z/seg7lab`, branch `refactor/clean-architecture`. Dev server for API checks:
`next dev -p 3100` with `DATABASE_URL=file:/home/z/seg7lab/db/custom.db` (local
SQLite). Dates below are ISO; commands were executed exactly as recorded.

## Baseline (pre-refactor, 2026-10-09)

| Check | Command | Result |
|---|---|---|
| Pure logic suite | `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/verify-logic.ts` | **546 passed, 0 failed** |
| CircuitVerse geometry suite | `bun run scripts/verify-circuitverse.ts` | **64,205 passed, 0 failed** (10 cases) |
| Lint | `bunx eslint .` | **clean (no output, exit 0)** |
| Types | `bunx tsc --noEmit` | **clean (exit 0)** |
| REST characterization | `node scripts/verify-api.mjs --record` then re-run against a second fresh DB | **70 checks recorded, re-run 70/70 identical** |

Pre-existing failure noted: `verify-circuitverse.ts` cannot run under Node's
`--experimental-strip-types` (TS parameter properties are unsupported in
strip-only mode) — it is a Bun script; `bun run` passes it. Not a regression of
this refactor; recorded as a baseline quirk.

## API contract baseline

- Recorded file: [`verification/api-contract.json`](./verification/api-contract.json)
  (70 checks: body guard 415/413/400, field validation 400s with E-codes,
  create 201 / duplicate 409, ownership 404-vs-403, optimistic-lock 409,
  no-op PUT 200, pagination clamps, shared-row write/delete semantics, kind
  mismatch E-280, embedded-id mismatch).
- Determinism protocol: stop server → `rm -f db/custom.db` →
  `DATABASE_URL=file:/home/z/seg7lab/db/custom.db npx prisma db push` → start
  server → run harness. Verified twice — byte-identical.

## Phase evidence

### Phase 1 — server clean architecture (2026-10-09)

| Check | Command | Result |
|---|---|---|
| **REST contract (the gate)** | fresh DB → dev server → `node scripts/verify-api.mjs` | **70/70, byte-identical to the pre-refactor recording** |
| Use-case tests (new) | `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/verify-services.ts` | **62 passed, 0 failed** (visibility, 404/403/409/400 precedence incl. "409 beats 400", P2002/P2025 mappings, corrupt-blob reads, kind-aware preset validation, shared-row semantics) |
| Pure logic regression | `npm run verify:logic:node` | **546/546** |
| Lint | `bunx eslint .` | **clean** |
| Types | `bunx tsc --noEmit` | **clean** |
| Browser smoke | agent-browser vs `http://localhost:3100` | app renders all tabs; `/api/presets?full=1` → **200** through the new layer (production still 500s per ADR-0007 — that is the deployment, not this code) |

Files: `src/server/{kernel,composition,db}.ts`, `src/server/{projects,presets}/{repository,prisma,service}.ts`, `src/app/api/_lib/http.ts`, 4 rewritten route files, `scripts/verify-api.mjs`, `scripts/verify-services.ts`. Deleted: both `helpers.ts`, `src/lib/db.ts`, `src/lib/owner.ts` (dead). Commit `15479f8`.

Fix during phase: `ApiError` initially used TS constructor parameter properties — incompatible with Node strip-types (the same pre-existing quirk `verify-circuitverse.ts` has); rewritten with explicit field assignments so `verify:services` runs on plain Node.

## Known gaps

- verify-api cannot exercise: server-generated cuid ids, corrupt-blob reads
  (all writes validate first), concurrent request races. Corrupt-blob and
  precedence logic are covered by `scripts/verify-services.ts` (Phase 1) at the
  use-case level.
- No automated UI tests exist; user flows are verified by scripted agent-browser
  sweeps (recorded per phase below).
- `next build` production build: run at Phase 4.

## Pre-existing defects (reported, not fixed — ADR-0007)

1. **Production API 500s.** On https://seg7.mlger.dev (Vercel), `GET /api/projects`
   and `GET /api/presets` return 500 (`{"error":"Internal server error"}`) —
   Prisma/SQLite cannot initialize on Vercel serverless; the `db/` dir ships only
   `.gitkeep`. The UI survives via its local-mode fallback. Requires an
   owner decision + Vercel env config (ADR-0007).
2. Project saves never send `expectedUpdatedAt` — server-side optimistic locking
   is dead code for the project path (the preset path uses it).
3. Every store action writes localStorage immediately AND a 250 ms debounced
   subscriber re-writes it (double persistence).
4. Undo is one level deep, shifts only, no redo.
5. `src/components/ui/use-toast.ts` sets `TOAST_REMOVE_DELAY = 1000000` — toasts
   effectively never auto-dismiss.
6. Unused installed deps (see ADR-0005): `zod` never imported in first-party code;
   several others used only by stock shadcn primitives.
7. `scripts/verify-circuitverse.ts` Node incompatibility (baseline quirk above).
