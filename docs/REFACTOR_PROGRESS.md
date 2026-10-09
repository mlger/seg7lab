# Refactor Progress

**Branch:** `refactor/clean-architecture` · **Plan:** [REFACTOR_PLAN.md](./REFACTOR_PLAN.md) · **Evidence:** [VERIFICATION.md](./VERIFICATION.md)

Status legend: pending · in progress · blocked · **complete**

## Phase status

| Phase | Scope | Status | Gate result |
|---|---|---|---|
| 0 | Baseline + harness + plan | **complete** | verify-logic 546/546 · circuitverse 64,205/64,205 (bun) · eslint 0 · tsc 0 · verify-api 70/70 recorded + determinism proven (two fresh-DB runs byte-identical) |
| 1 | Server clean architecture | **complete** | verify-api 70/70 **byte-identical to pre-refactor recording** · verify-services 62/62 (new) · verify-logic 546/546 · eslint 0 · tsc 0 · browser smoke (app renders, API 200). Commit `15479f8` |
| 2a | Store split + preset-sync extraction | **complete** | browser E2E: hydration, cell edit + persist + reload, preset apply, user preset save + server POST 201 (engine verified end-to-end), project create/load · verify-logic 546/546 · verify-api 70/70 · tsc 0 · eslint 0. Commit `dc67d41` |
| 2b | API client + ProjectManagerCard transport | **complete** | E2E: cloud create · **induced-offline fallback + push-up (server-verified)** · duplicate · delete via confirm dialog · tsc 0 · eslint 0. Commit `b7aacfc` |
| 2c | LogicCircuitCard decomposition | **complete** | E2E: TRACE/stepper, decoder bands, fullscreen toolbar, zoom in fullscreen, Escape, sweep player · tsc 0 · eslint 0. Commit `4a7388d` |
| 3 | Cross-cutting cleanup + boundary enforcement | **complete** | verify-logic 546/546 · circuitverse 64,205/64,205 (binary.ts move + comment fixes behavior-neutral) · boundaries 0 violations (61 imports) · eslint 0 (layer rules active) · tsc 0 · zoom smoke OK. Commit `4b8fbac` |
| 4 | Final verification + docs | **complete** | Full sweep: all 8 gates green (see VERIFICATION.md §Final) + production `next build` succeeds + consolidated browser E2E (golden path). This commit |

## Completed changes (summary per phase)

- **Phase 0** — `scripts/verify-api.mjs` (70-check characterization harness, record/compare) + committed contract baseline; planning docs + seven ADRs.
- **Phase 1** — `src/server/` (kernel, projects/presets service+repository+Prisma, composition, db) + thin routes + `_lib/http.ts`; deleted both mirrored `helpers.ts`, dead `lib/owner.ts`, `lib/db.ts`; added `verify-services.ts` (62 checks).
- **Phase 2a** — `src/lib/store/` slices (types/persistence/presets/workspace/library/index) behind the unchanged `@/lib/store` surface; `src/lib/preset-sync.ts` engine behind `PresetSyncAccess` (DI, verbatim); deleted the 1,389-line monolith.
- **Phase 2b** — `src/lib/api-client.ts` (typed, `ApiResult` now used) + `src/lib/use-projects-manager.ts`; `ProjectManagerCard` → presentation-only; render-phase name sync.
- **Phase 2c** — `logic-circuit/controls.tsx` (ZoomControl, TraceControls, ZoomButtons, BandStepButtons, LiveOutputPanel); card 1,298 → 1,172 lines; inline/fullscreen toolbars share one source.
- **Phase 3** — `getViewportTransform` → `src/utils/svg-viewport.ts`; `binary.ts` → `src/logic/binary.ts` (boundary check caught the leak); doc/impl contradictions fixed (standardPatternTable, builtin:standard7 description, factorTermsWith stats caveat); vestigial ternary removed; `verify:boundaries` + eslint layer rules.
- **Phase 4** — full verification sweep (8 gates + build + E2E), README/AGENTS/ARCHITECTURE final, this file, VERIFICATION.md final.

## Remaining work

None within the refactor scope. Follow-up items for the maintainer (all
documented, deliberately out of scope per the plan's exclusions):

- Fix the production Vercel API 500s (ADR-0007 — needs an owner decision +
  Vercel env config; the repository seam makes the adapter swap small).
- Send `expectedUpdatedAt` on project saves (dead optimistic-locking path).
- Deduplicate the double localStorage persistence per action.
- Prune unused dependencies (`zod`, …) — versions were frozen (ADR-0005).
- Multi-step undo/redo; toast auto-dismiss; pinch-zoom (pre-existing).

## Active blockers

None.

## Significant decisions

See [decisions/](./decisions/): 0001 logic layer is the domain · 0002
service+repository with function DI · 0003 API characterization harness ·
0004 store split behind a stable surface · 0005 no dependency changes · 0006
boundary enforcement · 0007 production API defect documented, not fixed.

## Repository coverage checklist

| Area | Path | Status |
|---|---|---|
| Pure logic layer | `src/logic/**` | **refactored conservatively** (binary.ts joined it; DOM helper + comment fixes; behavior pinned by 546 + 64,205 checks) |
| Server transport | `src/app/api/**` | **done (Phase 1)** — thin handlers |
| Server services/infra | `src/server/**` | **done (Phase 1)** |
| Shared contract | `src/types/api.ts` | **done** (ApiResult wired in 2b) |
| Client state | `src/lib/store/**` | **done (Phase 2a)** |
| Client sync engine | `src/lib/preset-sync.ts` | **done (Phase 2a)** |
| Client transport | `src/lib/api-client.ts` + `use-projects-manager.ts` | **done (Phase 2b)** |
| Client misc | `src/lib/{useEngine,colors,client-owner,utils}.ts`, `src/utils/**` | reviewed, unchanged (cohesive; svg-viewport added in 3) |
| UI — giant components | `LogicCircuitCard`, `ProjectManagerCard` | **done (2c / 2b)** |
| UI — other simulator components | `src/components/simulator/**` | reviewed, unchanged (feature-cohesive, no duplication found) |
| UI — stock primitives | `src/components/ui/**` | excluded (shadcn stock) |
| Verification scripts | `scripts/**` | **extended** (verify-api, verify-services, verify-boundaries) |
| Docs | `README.md`, `AGENTS.md`, `docs/**`, `worklog.md` | **final (Phase 4)** |
| Prisma schema / migrations | `prisma/**` | excluded (unchanged, per plan) |
| App shell | `src/app/{page,layout,error}.tsx`, `globals.css` | reviewed, unchanged |
| Dependencies | `package.json`, `bun.lock` | frozen (ADR-0005); scripts added only |
