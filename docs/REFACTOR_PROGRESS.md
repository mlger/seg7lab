# Refactor Progress

**Branch:** `refactor/clean-architecture` · **Plan:** [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) · **Evidence:** [VERIFICATION.md](./VERIFICATION.md)

Status legend: pending · in progress · blocked · **complete**

## Phase status

| Phase | Scope | Status | Gate result |
|---|---|---|---|
| 0 | Baseline + harness + plan | **complete** | verify-logic 546/546 · circuitverse 64,205/64,205 (bun) · eslint 0 · tsc 0 · verify-api 70/70 (deterministic, recorded) |
| 1 | Server clean architecture | **complete** | verify-api 70/70 **byte-identical to pre-refactor recording** · verify-services 62/62 (new) · verify-logic 546/546 · eslint 0 · tsc 0 · browser smoke (app renders, API 200) |
| 2a | Store split + preset-sync extraction | in progress | — |
| 2b | API client + ProjectManagerCard transport | pending | — |
| 2c | LogicCircuitCard decomposition | pending | — |
| 3 | Cross-cutting cleanup + boundary enforcement | pending | — |
| 4 | Final verification + docs | pending | — |

## Completed changes

- Phase 0: `scripts/verify-api.mjs` (70-check characterization harness,
  record/compare modes) + `docs/verification/api-contract.json` baseline recorded
  against the pre-refactor implementation; determinism proven across two fresh-DB
  runs. Planning docs + seven ADRs written. Work on branch `refactor/clean-architecture`.
- Phase 1: `src/server/` created — `kernel.ts` (framework-free owner/body-guard/
  error/pagination primitives, ONE copy replacing ~150 duplicated lines),
  `projects/` + `presets/` (repository contract, Prisma adapter, service with
  use cases), `composition.ts`, `db.ts` (moved from `src/lib`). Four route files
  rewritten as thin handlers + `src/app/api/_lib/http.ts` (ApiError → NextResponse
  mapping). Deleted both mirrored `helpers.ts`, dead `src/lib/owner.ts`, `src/lib/db.ts`.
  Added `scripts/verify-services.ts` (62 checks, in-memory repos). Committed
  as `15479f8`.

## Remaining work

- Phase 2a: split `src/lib/store.ts` into `src/lib/store/` slices behind the same
  import surface; extract `src/lib/preset-sync.ts` (ADR-0004).
- Phase 2b/2c, Phase 3, Phase 4 — see the plan.

## Active blockers

None.

## Significant decisions

See [decisions/](./decisions/). Latest: [0007 — production API defect documented,
not fixed](./decisions/0007-production-api-defect.md).

## Repository coverage checklist

First-party areas and their refactor status:

| Area | Path | Status |
|---|---|---|
| Pure logic layer | `src/logic/**` | untouched (ADR-1; comment fixes + 1 function move in Phase 3) |
| Server transport | `src/app/api/**` | **done (Phase 1)** |
| Server services/infra | `src/server/**` | **done (Phase 1)** |
| Shared contract | `src/types/api.ts` | Phase 1 (ApiResult wired in Phase 2b) |
| Client state | `src/lib/store*` | Phase 2a |
| Client sync engine | `src/lib/preset-sync.ts` (new) | Phase 2a |
| Client transport | `src/lib/api-client.ts` (new) | Phase 2b |
| Client misc | `src/lib/{useEngine,colors,client-owner,utils}.ts`, `src/utils/**` | unchanged (already cohesive) |
| UI — giant components | `components/simulator/{LogicCircuitCard,ProjectManagerCard}.tsx` | Phase 2c / 2b |
| UI — other simulator components | `components/simulator/**` | unchanged (already feature-cohesive) |
| UI — stock primitives | `src/components/ui/**` | excluded (shadcn stock) |
| Verification scripts | `scripts/**` | extended in Phases 0/1/3 |
| Docs | `README.md`, `AGENTS.md`, `docs/**` | Phase 0 (plan) → Phase 4 (final) |
| Prisma schema / migrations | `prisma/**` | excluded (unchanged) |
| App shell | `src/app/{page,layout,error}.tsx`, `globals.css` | unchanged |
