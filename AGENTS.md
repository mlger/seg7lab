# AGENTS.md — working guide for coding agents (and humans in a hurry)

Facts below are verified against the repository. Precedence: the repo's own
conventions (README, PRD, worklog) come first; this file summarizes and adds
the refactor's rules.

## What this repository is

An interactive 7-segment decoder design lab. ONE truth table (Zustand store)
is the single source of truth; K-maps, expressions, circuits, exports are all
derived by pure functions in `src/logic/`. Never store derived state.

## Module ownership (who owns what)

| Path | Owner / responsibility |
|---|---|
| `src/logic/**` | Domain + application, PURE: no React, no DOM, no fetch, no store. Modifying it requires updating `scripts/verify-logic.ts` (and `verify-circuitverse.ts` for `.cv` geometry). |
| `src/server/**` | Server use cases + persistence. Business rules (ownership, error precedence, locking, validation) live in `service.ts` files, NOT in routes. |
| `src/app/api/**` | Transport only: parse → service → response. Never import Prisma or `@/server/db` here. |
| `src/lib/store/**` | Zustand slices behind the stable `@/lib/store` import surface. Slice actions may set any state field; cross-slice calls go through `get()`. |
| `src/lib/preset-sync.ts` | Server sync engine; depends only on the injected `PresetSyncAccess` — do not import the store here. |
| `src/lib/api-client.ts` | The ONLY module client code should use to call `/api/projects` (returns `ApiResult`). |
| `src/components/simulator/**` | Presentation. Transport-free (use hooks from `src/lib/`); logic-free (call `@/logic` or the store). |
| `src/types/{simulator,api}.ts` | Domain contract / wire DTOs. Shared both sides — change carefully. |
| `src/utils/**` | Client-side helpers (DOM-coupled allowed here, NOT in `src/logic`). |

## Architectural dependency rules (mechanically enforced)

- `src/logic` imports nothing app-side and no framework packages — enforced by
  `npm run verify:boundaries` AND eslint `no-restricted-imports`.
- `src/app/api/**` must not import `@prisma/client`, `@/server/db`, `@/lib/db`.
- `src/lib/**`, `src/components/**`, `src/hooks/**` must not import `@/server/**`.
- All arrows point toward `src/logic` + `src/types` (see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the diagram).

Run `npm run verify:boundaries` after touching imports; it fails CI-style on
violations.

## Commands (all verified working)

```bash
bun install                                   # or npm install
cp .env.example .env                          # DATABASE_URL=file:./db/custom.db
npx prisma generate && npx prisma db push
npm run dev                                   # port 3000 (dev.log via tee)

npm run verify:logic:node                     # 546 pure-logic checks (plain Node)
bun run scripts/verify-circuitverse.ts        # 64,205 .cv geometry checks (Bun only —
                                               #  TS parameter properties break Node strip-types)
npm run verify:services                       # 62 service-layer checks (in-memory repos)
npm run verify:boundaries                     # import-matrix layer check
npm run lint                                  # eslint (includes layer rules)
bunx tsc --noEmit                             # typecheck

# REST contract characterization (needs a running dev server + FRESH db):
#   stop server; rm -f db/custom.db; DATABASE_URL=<abs path> npx prisma db push; start server
node scripts/verify-api.mjs                   # 70 checks vs docs/verification/api-contract.json
node scripts/verify-api.mjs --record          # re-baseline (ONLY when intentionally changing the API)
```

Do not run `next build` casually in dev sandboxes; it is the final gate, not
a loop tool.

## Conventions that matter

- **Verification culture:** every claim gets a check. New logic → new checks
  in the right verify suite. UI claims (gate counts, sharing) must be derived,
  never asserted.
- **Error codes:** user-facing failures carry E-codes (E-1xx UI, E-2xx
  project blob, E-26x font files, E-27x presets, E-28x server preset
  validation). Keep the numbering when adding rules.
- **Manual validators, not zod** (per codebase convention; zod is installed
  but unused — do not start using it without a decision record).
- **Comments document WHY and contracts**, including known traps (see
  `factorTermsWith` stats caveat). Fix stale comments when you find them —
  several bugs here were doc/impl contradictions.
- **localStorage keys are compatibility contracts:**
  `sevenseg-workspace-v1`, `sevenseg-presets-v1`, `sevenseg-projects-v1`,
  `sevenseg-projects-pushed-v1`, `sevenseg-owner-token`.
- **No indigo/blue** in the UI palette (see `src/lib/colors.ts` and the
  globals.css voice contract). Phosphor palette: emerald/amber/rose.
- **`prefers-reduced-motion`** must be honored for any new animation.

## How to add features within this architecture

- **Truth-table feature:** logic in `src/logic/` (+checks) → store action in
  `src/lib/store/workspace.ts` (persist!) → component change.
- **New REST endpoint:** service use case → route handler (thin) → contract
  check in `scripts/verify-api.mjs` (re-record after deciding the contract
  change is intentional).
- **New export:** pure generator in `src/logic/` + checks + `ExportMenu` item.
- **New UI card:** `src/components/simulator/`, state via atomic
  `useSimulator` selectors, derived state via `useEngine`-style memoization —
  never copy pipeline calls around.

## Documentation maintenance

- `worklog.md` (repo root): append a dated Task entry for every significant
  change — this is the repo's engineering log and the first thing the next
  agent reads.
- `docs/REFACTOR_PROGRESS.md`: update phase status when touching refactored
  areas.
- `docs/VERIFICATION.md`: record executed checks + results; keep planned
  checks separate.
- ADRs (`docs/decisions/`) for significant architectural choices.
- Keep `docs/ARCHITECTURE.md` synchronized when boundaries move.

## Known traps (read before touching)

- `verify-circuitverse.ts` runs ONLY under Bun (TS parameter properties).
  Likewise, anything `verify:services` imports must avoid parameter
  properties (see `ApiError`).
- The presets service validates PUT `data` against the STORED row's kind;
  embedded `data.id` must equal the row id. Don't "simplify" this.
- PUT error precedence is 404 → 403 → 409 → 400 (lock check BEFORE field
  validation, body guard before everything) — pinned by verify-api checks.
- Project saves intentionally do NOT send `expectedUpdatedAt` (pre-existing;
  see VERIFICATION.md known gaps). Changing that is a behavior change — decide
  it explicitly.
- Shared rows (`ownerId: null`) are writable/deletable by anyone by design.
- Production (Vercel) API returns 500 — SQLite cannot initialize there
  (ADR-0007). Local dev works; the branch does not fix production.
