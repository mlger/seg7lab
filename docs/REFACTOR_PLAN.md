# Refactor Plan — Clean Architecture, behavior-preserving

**Repo:** mlger/seg7lab · **Branch:** `refactor/clean-architecture` · **Status doc:** [REFACTOR_PROGRESS.md](./REFACTOR_PROGRESS.md) · **Evidence:** [VERIFICATION.md](./VERIFICATION.md)

**Goal:** restructure the application into a practical Clean Architecture — business rules separated from frameworks, persistence, transport and UI rendering; dependencies pointing toward business logic; less duplication; testable boundaries — while **preserving every externally observable behavior** (API contract, user flows, exports, visual presentation).

---

## 1. Current architectural problems (with examples)

The pure logic layer (`src/logic/`, 22 modules) is already exemplary: no React/DOM, verified by 546 + 64,205 checks. The problems are concentrated around it — in transport, state, and UI wiring:

| # | Problem | Evidence |
|---|---|---|
| P1 | **Duplicated server plumbing.** Two ~360-line helper modules duplicate ~150 lines of transport code verbatim (owner parsing, body guard, error envelope, Prisma-code narrowing, pagination, row serialization, `readExpectedUpdatedAt`). | `src/app/api/projects/helpers.ts` vs `src/app/api/presets/helpers.ts`; the header comment documents the duplication as intentional mirroring. |
| P2 | **Business rules live in HTTP handlers.** Ownership visibility (`OR: [{ownerId: null}, {ownerId: owner}]`), existence-hiding 404s, the 404→403→409→400 error precedence, and optimistic locking are all implemented inline in route files that also call Prisma directly. | `src/app/api/projects/[id]/route.ts` PUT: body guard → `db.project.findUnique` → owner check → lock check → validate → `db.project.update`. |
| P3 | **Persistence coupled to transport.** Routes import the Prisma singleton (`@/lib/db`) and construct queries inline; there is no seam where a repository could be swapped or tested. | `route.ts` files call `db.project.findMany({...})` directly. |
| P4 | **Dead and misleading code.** `src/lib/owner.ts` is entirely dead (superseded by `src/lib/client-owner.ts`, different storage key), yet both API helpers' comments point to it as the client module. `ApiResult` in `src/types/api.ts` is defined and never used; the client blind-casts `res.json()`. | `src/lib/owner.ts` has zero importers; comments at `helpers.ts:21-22`. |
| P5 | **State monolith.** `src/lib/store.ts` (1,389 lines) mixes workspace state, preset-library state, localStorage persistence, cross-tab listeners, and the entire server-sync/conflict-resolution engine (module-level singletons, ~450 lines of fetch/merge/reconcile logic) behind one Zustand `create()`. | `store.ts:220-1192` is sync machinery; actions at `:1124` (`syncPresetsFromServer`) reach into raw `fetch`. |
| P6 | **Transport inline in UI components.** `ProjectManagerCard.tsx` (634 lines) performs raw `fetch` calls, offline fallback, push-up reconciliation and busy-guarding inline with presentation. | `ProjectManagerCard.tsx` `refresh()`/`pushUpLocalOnly()`. |
| P7 | **Component bloat with duplicated chrome.** `LogicCircuitCard.tsx` (1,298 lines) holds modes/forms/styles panels, zoom/pan, trace stepper, sweep player, bands, exports — and duplicates the zoom/trace toolbar JSX between inline and fullscreen layouts. | `LogicCircuitCard.tsx` fullscreen overlay vs inline toolbar blocks. |
| P8 | **A DOM-coupled function inside the "no DOM" logic layer.** `getViewportTransform(request: SVGSVGElement)` lives in `src/logic/circuitNetlist.ts`, whose header claims purity. | `circuitNetlist.ts:493-512`. |
| P9 | **Doc-vs-implementation contradictions** (documented during analysis). | `presets.ts:314-318` docstring vs implementation at `:335`; `factoring.ts` shared-context stats comment at `:414-416`. |
| P10 | **No boundary enforcement.** Nothing prevents the logic layer from growing React/DOM imports, or routes from bypassing the service layer. | No `no-restricted-imports` rules; no boundary check in the verification suite. |

Functional defects observed but **out of scope** (reported, not fixed here — see §6): production API 500s on Vercel (SQLite incompatible with serverless), project saves not using optimistic locking, double localStorage persistence, one-level undo only.

---

## 2. Target structure

A modular monolith on the existing stack (Next.js 16 App Router, no new packages, no workspace split — the app is a single deployable and stays one). The layering maps onto the existing code rather than renaming it:

```text
src/
  logic/                     DOMAIN + APPLICATION (pure) — unchanged location, see ADR-1
  server/                    SERVER-SIDE APPLICATION + INFRASTRUCTURE (new)
    kernel/http.ts             shared transport kernel (one copy of P1's duplicates)
    kernel/owner.ts            owner-token parsing (header → identity)
    projects/service.ts        use cases: list/get/create/update/delete (+ validation rules)
    projects/repository.ts     ProjectRepository interface (domain-owned contract)
    projects/prisma.ts         Prisma implementation of the interface
    presets/…                   same three-part shape for presets
    composition.ts             composition root: wires repositories into services
    db.ts                       Prisma singleton (moved from src/lib/db.ts)
  app/api/                   PRESENTATION (transport) — thin route handlers
    projects/route.ts           parse → owner → service → map response
    projects/[id]/route.ts
    presets/route.ts, presets/[id]/route.ts
  lib/                       CLIENT-SIDE STATE + TRANSPORT
    store/                     Zustand store split into cohesive slices (same '@/lib/store' import surface, see ADR-4)
    preset-sync.ts             server-sync/conflict engine extracted from the store
    api-client.ts              typed fetch client shared by UI (uses ApiResult — fixes P4)
  components/simulator/      PRESENTATION (UI) — feature-cohesive, giants decomposed
  types/api.ts               SHARED CONTRACT (DTOs used by both server and client)
```

**Dependency rules (enforced in Phase 3, ADR-6):**

- `src/logic` imports nothing from `server/`, `app/`, `components/`, `lib/`, and no React/Next/DOM.
- `src/server/**` imports `src/logic`, `src/types/api`, Prisma — never React/components/store.
- `src/app/api/**` (routes) import only `src/server/*` + kernel — never Prisma directly.
- `src/lib/**` and `src/components/**` import `src/logic` + `src/types` freely; never `src/server`.
- All arrows point toward `src/logic` (the domain).

---

## 3. Implementation phases

Each phase ends with: relevant checks green (§5), superseded code deleted, docs updated. A phase is not "complete" until its acceptance criteria pass.

| Phase | Scope | Key work |
|---|---|---|
| **0 — Baseline** (done) | Evidence capture | Run all existing suites; build `scripts/verify-api.mjs` characterization harness (70 checks) + record `docs/verification/api-contract.json`; prove determinism across fresh-DB runs; write this plan + ADRs. |
| **1 — Server CA** | `src/server/**`, 4 route files | Extract kernel (dedupe P1); create services + repository interfaces + Prisma implementations (P2, P3); routes become thin transport mapping; delete both `helpers.ts`; wire `ApiResult` into services; remove dead `src/lib/owner.ts` and stale comments (P4). **Gate: `verify-api` 70/70 byte-identical vs recorded contract; tsc; eslint; verify-logic unchanged.** |
| **2a — Store split** | `src/lib/store/**`, `preset-sync.ts` | Split the monolith into slices behind the same `@/lib/store` import surface; extract the sync/conflict engine module (P5). **Gate: browser E2E of workspace + preset flows; tsc; eslint.** |
| **2b — API client** | `src/lib/api-client.ts`, `ProjectManagerCard` | Typed client used by the card; transport extracted into a hook; identical URLs/headers/fallback semantics (P6). **Gate: browser E2E project CRUD (cloud + induced-offline); tsc; eslint.** |
| **2c — Circuit card split** | `components/simulator/logic-circuit/*` | Extract duplicated toolbar chrome and view-state hooks from `LogicCircuitCard` (P7); no behavior/visual change. **Gate: browser E2E circuit interactions; tsc; eslint.** |
| **3 — Cross-cutting** | logic layer, lint config | Move `getViewportTransform` out of `circuitNetlist.ts` to a client util (P8); fix doc/impl contradictions (P9); add boundary enforcement (ESLint `no-restricted-imports` + `scripts/verify-boundaries.mjs`, P10); remove dead code. **Gate: verify-logic 546/546 + circuitverse 64,205 unchanged (proves logic layer untouched semantically); boundary check green.** |
| **4 — Final** | Docs + full verification | README/AGENTS/ARCHITECTURE final; full suite; `next build`; browser E2E sweep; push branch. |

---

## 4. Compatibility requirements

- **REST contract:** status codes, response bodies (incl. error envelopes and E-codes), header semantics, ordering — pinned by `docs/verification/api-contract.json`.
- **Persistence:** Prisma schema unchanged; no migrations; SQLite file compatible; localStorage keys unchanged (`sevenseg-workspace-v1`, `sevenseg-presets-v1`, `sevenseg-projects-v1`, `sevenseg-owner-token`, …).
- **Exports:** all 11 export formats byte-stable (covered by existing verify suites).
- **UI:** user flows, keyboard/a11y behavior, visuals unchanged.
- **Import surfaces:** `@/lib/store`, `@/logic/*`, `@/types/api` keep their public paths (internal file moves only).

## 5. Acceptance criteria & verification steps

| Criterion | Check |
|---|---|
| No API contract drift | `node scripts/verify-api.mjs` → 70/70 vs recorded baseline (fresh DB + dev server) |
| Pure logic untouched | `npm run verify:logic:node` → 546/546; `bun run scripts/verify-circuitverse.ts` → 64,205/64,205 |
| Types safe | `bunx tsc --noEmit` clean |
| Lint clean | `bunx eslint .` clean |
| Boundaries hold | `node scripts/verify-boundaries.mjs` (new) + ESLint restricted-import rules |
| App builds | `bunx next build` succeeds |
| User flows intact | Agent-browser E2E sweep: tabs, cell edit, K-map regroup, circuit toggle+trace, project save/load, preset gallery, export menu |
| Docs accurate | README/AGENTS/ARCHITECTURE/PROGRESS/VERIFICATION cross-linked and truthful |

## 6. Explicit exclusions

- No schema, migration, or dependency changes (versions retained).
- No visual redesign, no new features, no perf tuning.
- Pre-existing defects are **reported only**: production Vercel API 500s (SQLite on serverless — infra, needs a decision outside this refactor); project saves bypassing optimistic locking; double localStorage writes; one-level undo; toast never auto-dismissing; unused deps (`zod`, `next-auth`, …).
- `src/components/ui/*` (stock shadcn primitives), `node_modules`, generated Prisma client — untouched.
- No push to `main` (Vercel auto-deploy); work lands on `refactor/clean-architecture` for review.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| API drift during server rewrite | Phase 1 gated on byte-identical `verify-api` output (timestamps normalized). |
| Store split breaks hydration/sync | Same import surface; browser E2E on workspace + presets + reload; sync logic moved verbatim, not rewritten. |
| Import churn breaks build | tsc after every phase; `next build` at the end. |
| Subagent edits conflict | Strict file-ownership assignment per task; worklog coordination. |
| Scope creep into feature work | Exclusions list above; defects recorded in VERIFICATION.md rather than fixed. |

## 8. Decision records

- [0001 — `src/logic` stays the domain+application layer](./decisions/0001-logic-layer-is-the-domain.md)
- [0002 — Service + repository layering with function-level DI](./decisions/0002-server-service-repository.md)
- [0003 — API contract characterization harness](./decisions/0003-api-characterization-harness.md)
- [0004 — Zustand store split behind a stable import surface](./decisions/0004-store-split-stable-surface.md)
- [0005 — No dependency changes](./decisions/0005-no-dependency-changes.md)
- [0006 — Boundary enforcement via lint + verify script](./decisions/0006-boundary-enforcement.md)
- [0007 — Pre-existing production API defect: documented, not fixed](./decisions/0007-production-api-defect.md)
