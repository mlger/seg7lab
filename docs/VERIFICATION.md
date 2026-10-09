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

### Phase 2a — store split (2026-10-09)

Browser E2E (agent-browser, evidence recorded in worklog Task 26): hydration from empty storage; display toggle persisted; truth-table cell cycle 1→X persisted and restored after reload; preset apply (allon); user preset saved locally AND POSTed (`/api/presets` → 201, row verified server-side with the owner header — the extracted sync engine works end-to-end); project create + load through the split store. `verify-logic` 546/546 · `verify-api` 70/70 · tsc 0 · eslint 0. Commit `dc67d41`.

### Phase 2b — api-client + Projects hook (2026-10-09)

Browser E2E (worklog Task 27): cloud create (server row verified) · **induced offline** (network route `**/api/projects*` aborted): Local mode badge + fallback banner + localStorage-only list · offline create · unblock + refresh → SQLite badge + push-up POST verified server-side (client-kept UUID id) · duplicate · delete via AlertDialog · render-phase name sync against the persisted workspace name. tsc 0 · eslint 0 (the react-hooks `set-state-in-effect` error resolved by the codebase's render-phase sync idiom, not by suppression). Commit `b7aacfc`.

### Phase 2c — circuit card decomposition (2026-10-09)

Browser E2E (worklog Task 28): TRACE toggle + layer stepper; Full decoder mode + band chips + stepping (`aria-current` moves); fullscreen toolbar (band stepper with center letter, zoom, TRACE, exit); zoom-in inside fullscreen; Escape exits; sweep player play/pause; zero console errors. Byte-diff protocol on moved JSX (subagent-verified). tsc 0 · eslint 0. Commit `4a7388d`.

### Phase 3 — cross-cutting cleanup + boundaries (2026-10-09)

`verify-logic` **546/546** and `verify-circuitverse` **64,205/64,205** after moving `binary.ts` into `src/logic` and the comment/description fixes — proof the logic layer is behavior-identical. `verify:boundaries` 61 imports, 0 violations. eslint 0 with the new layer rules active. Browser smoke: zoom works through the moved `getViewportTransform` (104% → 135%), 16 truth-table rows render, badge "SOP · 5 gates · 5 layers". Commit `4b8fbac`.

### Phase 4 — final acceptance (2026-10-09)

Full sweep, executed in order on a clean checkout of the branch:

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Pure logic suite | `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/verify-logic.ts` | **546 passed, 0 failed** |
| 2 | CircuitVerse geometry | `bun run scripts/verify-circuitverse.ts` | **64,205 passed, 0 failed** (10 cases) |
| 3 | Service use cases | `npm run verify:services` | **62 passed, 0 failed** |
| 4 | Layer boundaries | `npm run verify:boundaries` | **61 imports checked, 0 violations** |
| 5 | Types | `bunx tsc --noEmit` | **clean** |
| 6 | Lint (incl. layer rules) | `bunx eslint .` | **clean** |
| 7 | **REST contract** | fresh DB → dev server → `node scripts/verify-api.mjs` | **70/70, byte-identical to the pre-refactor baseline** |
| 8 | Production build | `bunx next build` | **success** — compiled, typechecked, 5 routes generated (`/`, `/api/projects`, `/api/presets` + `[id]`s) |

Consolidated browser E2E (agent-browser, fresh DB): default load → truth-table cell cycle 1→X → **K-map cell shows X, expressions re-derive (Σm/POS/minimized present), circuit gate count drops 5→2 in response to the don't-care** (the everything-derived loop works end-to-end after all phases) → export menu with all 11 items + CSV export toast → Projects tab in cloud mode (`/api/presets?full=1` 200, `/api/projects?full=1&limit=200` 200) → zero console errors, zero server-log errors.

**Final acceptance status: PASS.** The refactor's compatibility requirement (API contract, exports, user flows, visual presentation, persisted shapes) is verified to the extent listed; gaps below are stated explicitly.

### Roman letters standard pattern (2026-10-09)

The owner-supplied reference picture ("Example set of Roman letters", 3 rows:
Uppercase / Lowercase / Punctuation, 74 glyphs) added as a standard pattern.

| Check | Command | Result |
|---|---|---|
| Picture ground truth | pixel-level extraction of the uploaded chart (red = lit over grey ghost), then diffed against `FONT_GLYPHS` | **74/74 glyphs identical — the picture is exactly the Chart Font** |
| Pure logic suite | `bun run verify:logic` | **582 passed, 0 failed** (546 + 36 new: picture pin, roman code convention, windowing, registration, E-275 regression) |
| Lint / types | `bunx eslint .` · `bunx tsc --noEmit` | **clean** |
| Boundary / services / CircuitVerse | `bun run verify:boundaries` · `npm run verify:services` · `bun run scripts/verify-circuitverse.ts` | **0 violations · 62/62 · 64,205/64,205** |

Changes: `RomanPattern` + `ROMAN_LETTER_PATTERNS` + `codeFromSegments` in
`src/logic/standardPatterns.ts` (derived from `FONT_GLYPHS` — single source of
truth, pinned to the picture by the new fixture), generator `'roman'` +
`builtin:roman` preset + `romanPatternTable` in `src/logic/presets.ts`,
`'roman'` in the `PresetGenerator` union, width-regen list in
`src/lib/store/workspace.ts`. Two latent defects fixed on the same paths:
`'standard7'` (and `'roman'`) were missing from the preset-file `GENERATORS`
import whitelist (E-275 on import) and from the width-change regen list
(wrong resize behavior). Reference image committed at
`docs/images/roman-letters-chart.png`.

### Character editor: Roman palette in "Apply a standard pattern" (2026-10-09)

The per-minterm character editor dialog (the second owner-supplied picture)
gained the Roman-letters chart as a quick-apply palette under its existing
hex row.

| Check | Command | Result |
|---|---|---|
| Pure logic suite | `bun run verify:logic` | **592 passed, 0 failed** (582 + 10 new: editor-palette coverage, hex-twin identity, grouping, applicability) |
| Lint / types / build | `bunx eslint .` · `bunx tsc --noEmit` · `bun run build` | **clean · clean · success** |
| Boundary / services / CircuitVerse | `bun run verify:boundaries` · `npm run verify:services` · `bun run scripts/verify-circuitverse.ts` | **0 violations · 62/62 · 64,205/64,205** |
| REST contract | unchanged code paths (no API/preset-registry edit); CI re-runs the 70-check suite | **n/a locally, pinned by CI** |
| Browser E2E (dev server :3000) | agent-browser + VLM screenshot check | **68 Roman buttons (22 Uppercase / 24 Lowercase / 22 Punctuation), hex twins deduped; apply 'K' → segments BDEFG + truth-table m3 rewrite + emerald active highlight; 375px dialog no horizontal overflow (341 = 341); reload persistence via localStorage; zero console/page errors** |

Changes: `CHARACTER_EDITOR_ROMAN` in `src/logic/standardPatterns.ts`
(the Roman chart grouped by the picture's rows minus the six hex twins —
A C E F b d carry byte-identical patterns in both families, pinned by the
suite), the dialog's pattern section in
`src/components/simulator/CustomCharacterCard.tsx` (scrollable
`custom-scroll` grid, per-glyph tooltips + aria-pressed, active-pattern
emerald highlight across hex, Roman and Blank/All X buttons).

### Falstad combined display export (2026-10-09)

The Falstad export became ONE self-contained file: every segment decoder
stacked as a band, ONE shared input bus (a switch per variable whose vertical
rail passes exactly through every band's input pin), and a real SevenSegElm
(157, 8 pins incl. DP) — flip the switches at falstad.com/circuit and the
digit lights up. It follows the on-screen form and gate style (canonical
csop/cpos included; factored falls back to basic there exactly like the
circuit tab). The format facts (157 pin geometry, east/e dp pins, classic `$`
import) were re-verified live against falstad.com/circuit before
implementation.

| Check | Command | Result |
|---|---|---|
| Pure logic suite | `bun run verify:logic` | **1252 passed, 0 failed on the branch (546 + 706 new); 1298 after the PR #4 rebase (592 + 706)** |
| Netlist semantics | (in-suite `evalFalstadDisplay`) | **every input combination lights the correct segments** for 4/5-bit × sop/pos × basic/factored × minimized/canonical — the exported file is parsed, nets union-found, values propagated, display pins compared against the expected forms |
| Geometry invariants | (in-suite, combined file) | **no dangling endpoints, no endpoint on a foreign run, no cross-net collinear overlap, no wire through gate or display body, all 8 pins driven, one shared L per used variable, determinism** |
| Lint / types | `bunx eslint .` · `bunx tsc --noEmit` | **clean** |
| Boundary / services / CircuitVerse | `bun run verify:boundaries` · `npm run verify:services` · `bun run scripts/verify-circuitverse.ts` | **0 violations · 62/62 · 64,205/64,205** |
| REST contract | no API/persisted-shape change (circuitStyle is session state like expressionForm; ProjectData untouched) | **pinned by CI's 70-check suite** |
| Live tool import | falstad.com/circuit "Import From Text" + switch toggling | **see worklog — display digit follows the input switches** |

Changes: `buildFalstadDisplayNetlist` + `termsForSegment` + `canonical`
option in `src/logic/falstad.ts` (emitCircuit gained shared-input /
skip-probe modes and returns the display-net plumbing); `circuitStyle` lifted
from LogicCircuitCard local state into the store (session state — the
Falstad export follows it); ExportMenu exports ONE combined file named
`<project>-falstad-display-<form>.txt`; PRD/README limitations lifted.
Per-segment export (`buildFalstadNetlist`) kept as a tested API and gained
the same canonical + engine-based const-detection fixes (inverter-only
segments are no longer wrongly skipped).

## Known gaps

- verify-api cannot exercise: server-generated cuid ids (the harness always
  supplies client ids) and true concurrent request races. Corrupt-blob reads
  and the error-precedence rules ARE covered by `scripts/verify-services.ts`
  at the use-case level (in-memory repositories).
- No automated UI test framework exists (none was added — ADR-0005 froze
  dependencies); user flows were verified by scripted agent-browser sweeps,
  recorded per phase above. Visual pixel-equality was verified by rendering,
  not by screenshot diffing.
- The production `next build` ran against a local SQLite `DATABASE_URL`; the
  Vercel deployment itself was not exercised (its API is broken pre-existing —
  ADR-0007).
- 4 untracked-by-design areas were reviewed but intentionally not modified:
  stock shadcn primitives (`src/components/ui/**`), `prisma/**` (no schema
  change), the app shell, and `src/lib/{useEngine,colors,client-owner}.ts`.

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
