# Refactor Progress

**Branch:** `refactor/clean-architecture` · **Plan:** [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) · **Evidence:** [VERIFICATION.md](./VERIFICATION.md)

Status legend: pending · in progress · blocked · **complete**

## Phase status

| Phase | Scope | Status | Gate result |
|---|---|---|---|
| 0 | Baseline + harness + plan | **complete** | verify-logic 546/546 · circuitverse 64,205/64,205 (bun) · eslint 0 · tsc 0 · verify-api 70/70 (deterministic, recorded) |
| 1 | Server clean architecture | in progress | — |
| 2a | Store split + preset-sync extraction | pending | — |
| 2b | API client + ProjectManagerCard transport | pending | — |
| 2c | LogicCircuitCard decomposition | pending | — |
| 3 | Cross-cutting cleanup + boundary enforcement | pending | — |
| 4 | Final verification + docs | pending | — |

## Completed changes

- Phase 0: `scripts/verify-api.mjs` (70-check characterization harness,
  record/compare modes) + `docs/verification/api-contract.json` baseline recorded
  against the pre-refactor implementation; determinism proven across two fresh-DB
  runs. Planning docs + seven ADRs written. Work on branch `refactor/clean-architecture`.

## Remaining work

- Phase 1: extract `src/server/**` kernel/services/repositories; rewrite the four
  route files as thin handlers; delete both mirrored `helpers.ts`; remove dead
  `src/lib/owner.ts`; add `scripts/verify-services.ts` (in-memory repo).
- Phase 2a/2b/2c, Phase 3, Phase 4 — see the plan.

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
| Server transport | `src/app/api/**` | Phase 1 |
| Server services/infra | `src/server/**` (new) | Phase 1 |
| Shared contract | `src/types/api.ts` | Phase 1 (ApiResult wired) |
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
