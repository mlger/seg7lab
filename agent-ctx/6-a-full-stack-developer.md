# Task 6-a — full-stack-developer (P2 performance batch)

## Scope (file ownership honored)
- src/components/simulator/ProjectManagerCard.tsx
- src/components/simulator/CircuitVerseExportDialog.tsx
- src/components/simulator/TruthTableCard.tsx
- src/lib/useEngine.ts
- src/logic/minimizer.ts
- src/types/simulator.ts
- src/components/simulator/KarnaughMapCard.tsx (small badge only)
- NOT touched: src/lib/store.ts (6-b owns it), src/app/api/**, prisma/**

## Changes

### 1. N+1 project refresh (ProjectManagerCard)
- refresh() = ONE `GET /api/projects?full=1&limit=200` (rows come with data + corrupt flag).
  Verified in dev.log: exactly one SQL SELECT per refresh, no per-id GETs.
- Every fetch carries `{ ...ownerHeaders() }` (GET list / POST / PUT / DELETE / push-up POST).
- Corrupt rows: destructive "corrupt" badge next to the name, Load AND Duplicate disabled
  (duplicate needs readable data; Delete stays enabled), destructive-row border tint,
  explicit corrupt-load/duplicate toast guards. `LocalProject.data: ProjectData | null`
  + `corrupt?: boolean`.
- DELETE → 204 with NO body: only `res.ok` checked, never `res.json()`.
- Push-up (best-effort, non-blocking, fired after each successful cloud refresh):
  local-only localStorage projects are POSTed with their client id
  (`id` ∈ ^[A-Za-z0-9_-]{8,64}$ — localId() UUIDs satisfy this). 201 or 409 → marked
  pushed. 400/413 → also marked (permanently rejected, no retry storm). Network errors →
  unmarked (retried next refresh). Marker key: `sevenseg-projects-pushed-v1` (string[]).

### 2. CircuitVerse dialog keystroke rebuild (CircuitVerseExportDialog)
- Stats memo is title-INDEPENDENT: deps [inputBits, engines, logicSource, variableNames],
  builds with `PREVIEW_TITLE` placeholder. Gate counts/depth/chips never change on typing.
- The full ~50KB JSON is built exactly once inside handleDownload with the CURRENT title
  (download captured in E2E: JSON `name` + filename carry the typed title, top-level key
  order intact, module counts identical to on-screen stats).
- `varNames: variableNames` preserved in BOTH call sites (the E-242 regression fix).
- Download button disabled when the stats build failed (`!stats`), same error Alert UX.

### 3. Drag re-render fix (TruthTableCard)
- New `TruthRow = memo(function TruthRow(...))` component (top of file). Props are
  primitives / stable store refs / stable callbacks only.
- Stable handler block in the parent (all useCallback): registerRowRef, handleSelectRow,
  handleTogglePreviewSegment, handleDragRowStart/End, handleRowHover, handleRowLeave,
  handleRowDrop ([table, inputBits, setRowPattern]).
- dropRow guard: `setDropRow(prev => prev === input ? prev : input)` (functional, no
  stale closure; same-value returns bail out). dragleave: `prev === input ? null : prev`.
- All behavior preserved and E2E-verified: drag-to-copy (inputs excluded), toast, drop
  ring highlight + source dim + highlight move + clear on dragend, row select, output
  cell cycling, preview segment toggles, font/hex char column, 4/5-bit, a11y labels.

### 4. usePresetModified ×4 computation (useEngine.ts)
- Module-level cache `presetModifiedCache` keyed on the identity of ALL inputs it reads
  (table, behavior, fontStart, tableStartCode, customFont, activeFontId, appliedPresetId,
  library). All 4 hook consumers (AppHeader, TruthTableCard, DisplayCard via
  PresetGalleryDialog/useAppliedTablePreset) share one computation per store change.
- The computation + cache write live in module function `computePresetModified` —
  React Compiler lint (react-hooks/globals) forbids reassigning module vars inside
  hooks, so the hook body just delegates. Hook API unchanged.
- NOTE: keying on (table, preset) alone would be WRONG — behavior/fontStart/tableStartCode
  changes alone must invalidate (they do, via full-input identity keying).

### 5. MinimizeResult.exact (types/simulator.ts + minimizer.ts + KarnaughMapCard)
- `exact: boolean` added to MinimizeResult (single producer: minimize()).
  - constant 0 → exact: true (no search needed)
  - essentials alone cover → true (no search needed)
  - search ran fully → !budgetExhausted (a truncated search that found a solution is
    still NOT proven minimal → false — stricter than the minimum requirement)
  - greedy fallback (best === null) → false
- Search now sets `budgetExhausted` when the budget check trips.
- BONUS (optional item, implemented): precomputed `Map<PrimeInfo, Set<coveredOnes>>` +
  per-call `chosenSet` in the search hot loop — replaces `.includes` linear scans,
  mechanically equivalent (coveredOnes never has duplicates). 200× 5-var fuzz clean.
- UI: KarnaughMapCard prime-groups legend header shows a subtle amber badge
  "heuristic cover — search budget limit" (AlertTriangle icon, amber tokens, title
  tooltip) ONLY when the displayed form's MinimizeResult.exact === false. Legend row
  is now `flex flex-wrap ... gap-2` with an inner flex wrapper for h4 + badge.
  Default path verified: badge absent.

## Verification
- `bun run lint` → exit 0 clean.
- `bunx tsc --noEmit` → zero errors in src/** (only pre-existing examples/ + skills/).
- Minimizer bun sanity (stdin script, nothing written): BCD all 8 segments exact+covered,
  A = 4T/6L textbook match, const-0 true, single-minterm true, 200× 5-var fuzz exact +
  full coverage, all-ones → 1 term.
- Browser E2E in an ISOLATED `--session 6a` (the default session is being driven by the
  parallel 6-b agent — use your own session name!): page load zero errors; 6/6 tabs
  (Radix tabs need native pointer clicks — element.click() does NOT activate them);
  K-map legend ok, no badge; Projects: refresh = 1 query, create 201, corrupt row UI
  (badge + disabled Load/Duplicate + enabled Delete), push-up 201 with ownerId + marker +
  no duplicate POST on second refresh, deletes all 204, DB cleaned to 0 rows;
  drag-to-copy m2→m5 (inputs stayed 0101) + full highlight lifecycle + redundant-dragover
  guard; 5-bit 32 rows + drag m3→m17; modified indicator appears after edit and clears
  after re-apply (proves the shared cache flips correctly); CircuitVerse dialog: opens
  (no crash), stats 4/16/7/3/1/134 depth 3, typing keeps stats stable, download carries
  custom title + valid schema + counts match stats, Direct SOP live recompute
  (49 AND / 9 OR / 512 wires), dialog closes clean; final hard reload zero errors.
- dev.log: no errors from my code paths.

## Observations for other agents
- /api/presets intermittently 500s (P2023 "Inconsistent column data") — caused by the
  6-b test row `user:6bcorrupt-test-row` (invalid blob inserted directly). Presets API +
  store.ts are NOT mine; 6-b appears to have cleaned it later (DELETE 204 in log).
- Radix TabsTrigger does not activate on synthetic element.click() (pointerdown-based).
  For E2E use native clicks (scroll tablist below the sticky header first — the header
  covers it when scrolled) or dispatch pointer events.
