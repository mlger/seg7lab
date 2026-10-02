# 7-Segment Display Logic Simulator — Shared Worklog

Project: Interactive 7-segment decoder design & simulation lab (Next.js 16, App Router, TypeScript, Tailwind 4, shadcn/ui, Prisma/SQLite, Zustand).

Architecture decisions:
- Single source of truth: Zustand store holds inputBits, currentInput, truthTable (all segment outputs incl. X/don't-care), display settings, cover exclusions. K-maps, Boolean expressions (SOP/POS/canonical), logic circuit, and the 7-seg display are all DERIVED from the truth table via a pure logic engine in `src/logic/`.
- Real Quine-McCluskey minimizer with don't-care handling + exact cover (essential primes + branch & bound) — NO hard-coded expressions.
- Input variable naming: 4-bit = D C B A (D = MSB, weight 8); 5-bit = E D C B A (E = MSB, weight 16). Segment outputs named A-G + DP (standard).
- Only route visible to user: `/` (src/app/page.tsx). Backend REST at /api/projects (Prisma SQLite) with localStorage fallback for offline/demo mode.

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Project exploration, environment init, planning, worklog creation.

Work Log:
- Loaded fullstack-dev skill; ran init script (dev.sh already running on port 3000).
- Explored package.json (Next 16, React 19, zustand 5, prisma 6, sonner, lucide, radix incl. slider/switch/tabs/dialog/dropdown-menu/tooltip, TanStack Query available).
- Confirmed full shadcn/ui set in src/components/ui; src/lib/db.ts exports PrismaClient singleton `db`; DATABASE_URL=file:/home/z/my-project/db/custom.db.
- Created this worklog; created todo plan with Task IDs (2-a subagent backend; 2-b/2-c engine; 3-8 frontend; 9-10 verification).

Stage Summary:
- Environment ready; dev server live on :3000; starting engine + backend work in parallel.

---
Task ID: 2-a
Agent: full-stack-developer (subagent)
Task: Projects persistence backend — Prisma Project model + REST CRUD API at /api/projects.

Work Log:
- Added `Project` model to prisma/schema.prisma (id/name/inputBits/data JSON blob/createdAt/updatedAt), kept User/Post; ran `bun run db:push` — schema in sync, client regenerated.
- Created src/app/api/projects/helpers.ts: shared validation (name non-empty ≤100 chars trimmed; inputBits ∈ {4,5}; data object or valid-JSON string, stored as JSON string) + `serializeProject` (parses data back to object) + `jsonError` helper.
- Created src/app/api/projects/route.ts (GET list w/o data, ?full=1 includes parsed data, updatedAt desc order; POST create with 400 validation, 201 with parsed data). `dynamic = 'force-dynamic'`.
- Created src/app/api/projects/[id]/route.ts (GET/PUT partial update/DELETE; params awaited as Promise per Next 15+; 404 {error} when missing; all handlers try/catch → 500 {error}). `dynamic = 'force-dynamic'`.
- Curl-verified end-to-end on the running dev server; deleted all test rows afterwards (list is `[]`).
- `bun run lint` → clean. dev.log clean.

Stage Summary:
- Endpoints: GET/POST /api/projects; GET/PUT/DELETE /api/projects/[id]. All curl tests passed: 201 create (data round-trips as object), list omits data / ?full=1 includes it, PUT partial updates work (name-only, data-only, inputBits-only), DELETE → {success:true} then GET → 404, invalid bodies (inputBits=3, whitespace name, >100-char name, non-JSON data string, malformed body) → 400 {error}. API contract documented in agent-ctx/2-a-full-stack-developer.md for the frontend agents.

---
Task ID: 2-b / 2-c
Agent: main (Z.ai Code)
Task: Digital logic engine + correctness verification

Work Log:
- src/types/simulator.ts — all shared types (SegmentName, SegmentOutput 0/1/X, TruthTable, ProjectData, KMap/Implicant/engine types).
- src/utils/binary.ts — conversions + strict parse/validate (binary/dec/hex), gray code helpers, popcount, tri-state cycle.
- src/logic/truthTable.ts — BCD/hex presets (valueToChar fix for b/d keys), invalid-input behavior (blank/dontcare/custom), row editing ops, width resize preserving overlap, segmentSets extraction.
- src/logic/decoder.ts — polarity model lit = output XOR reverseLogic XOR commonAnode, default project, default display settings.
- src/logic/minimizer.ts — Quine-McCluskey: prime generation via grouped single-bit merging, prime chart, essential primes, exact cover via branch&bound (cost = terms then literals, deterministic), greedy fallback guard.
- src/logic/expressions.ts — Term/Literal, SOP/POS/canonical converters, unicode/ascii/verilog notations. Fixed POS De-Morgan complemented-bit bug.
- src/logic/kmap.ts — Gray-ordered 4-var map + 5-var two-plane map (E weight 16), cover→groups with eliminated-var lists.
- src/logic/engine.ts — computeSegmentEngine/computeEngines: derived views incl. user cover exclusions and stats.
- src/logic/booleanParser.ts — recursive descent parser (OR<XOR<AND<NOT, prefix !/~/¬, postfix ', implicit AND), evaluator, gate counter.
- src/logic/verilogGenerator.ts — synthesizable module from minimized covers.
- src/logic/project.ts — validateProject with engineering error codes E-200..E-216, migration.
- Ran .engine-check.ts via bun (temporary, deleted after): 11,771/11,771 checks pass — includes BCD textbook result match (A= C'A'+B+CA+D 4t/6l; B=3t/5l), cover correctness on all defined cells, brute-force minimality cross-check (48 random 4-var functions), 300 fuzz correctness tests 4/5-var SOP+POS, Gray ordering, parser, validation.

Stage Summary:
- Logic engine is complete and verified. Classic BCD minimal expressions match published textbook results. No hard-coded expressions anywhere.

---
Task ID: 3-10
Agent: main (Z.ai Code)
Task: State store, complete frontend, exports, page assembly, E2E verification

Work Log:
- src/lib/store.ts — Zustand single-source-of-truth store (truth table, input, display settings, coverExcluded/coverAdded per segment+form, UI state), debounced localStorage persistence + hydrate, preset loading with invalid-behavior application, width resize preserving overlap.
- src/lib/useEngine.ts — memoized computeEngines + useCurrentInput + usePresetModified hooks.
- Components (src/components/simulator/): SevenSegmentDisplay (realistic SVG, skew, glow, clickable segments, polarity, X rendering, mini + bit-strip variants), DisplayCard (settings popover: colors/brightness/polarity/reverse/skew/DP, readouts, explain), InputControlsCard (bit toggles, validated bin/dec/hex with E-codes, inc/dec), TruthTableCard (editable cells 0→1→X, row select + auto-scroll, sticky header, scroll areas), KarnaughMapCard (Gray-code 4-var + 5-var two-plane, clickable cells, colored group overlays incl. wrap-around rects, prime legend with Add/Remove per group, essential badges, uncovered-minterm E-101 banner, SOP/POS grouping toggle), BooleanExpressionsCard (4 forms, Σm/ΠM/d lists, stats + reduction %, custom-expression parser/verify/apply with E-220/221), LogicCircuitCard (auto netlist from expression, live signal evaluation, animated active wires, zoom/pan/drag gates, click-to-inspect, clickable input rails, gate reference for all 7 gate types), CustomCharacterCard (per-value pattern editor dialog + presets + invalid-behavior selector), ProjectManagerCard (REST + localStorage fallback, save/load/duplicate/delete/rename, validated import with E-2xx codes), AppHeader (width/mode toggles, explain switch, issues popover, export menu, theme toggle), ExplainBlock/TermView (overline rendering).
- Exports: utils/pdf.ts (dependency-free PDF 1.4 writer), utils/exporters.ts (CSV, JSON, Verilog, SVG, PNG via canvas, multi-page PDF report with truth table + K-maps with colored groups + expressions + Verilog appendix), utils/download.ts.
- page.tsx (dashboard layout, tabs, sticky footer w/ safe-area, min-w-0 grid fix), layout.tsx (metadata + dark ThemeProvider), globals.css (custom scrollbars, wire animation, reduced-motion).
- Cover model upgraded: users can remove cover groups AND add alternative primes; engine derives active expressions/coverage from (cover ∪ additions − exclusions); persisted in ProjectData; verified via bun script.
- Fixed during E2E: hex pattern b/d key bug, POS De-Morgan bit bug, PAGE_W refs in exporters, display SVG ref forwarding (E-233), X-segment polarity in common-anode mode, React-Compiler lint rules (setState-in-effect → render-time sync), grid min-w-0 for mobile table scroll, circuit letterbox-correct toGraph.
- Agent-browser E2E (all verified): digit 0-9 rendering (5 = 1011011 ✓), bit toggles, bin/dec/hex inputs, truth-table cell cycling + row select, K-map Gray cells + textbook groups (A = C'A'+B+CA+D 4T/6L), group Add (3T→4T) / Remove (E-101 + issues badge) / Restore, expression verifier match, circuit live eval + input-rail toggle + gate drag + gate inspect (OR 4-input values), 5-bit two-plane K-map, HEX preset (m12 → 'C' 1001110), BIN bit strip, custom char 'H' drawn + displayed, common-anode inversion, project create/load/duplicate/delete via SQLite API, import valid + corrupt JSON, exports CSV/JSON/Verilog(valid module)/PDF(7 pages, valid xref)/PNG(400x480)/SVG, responsive mobile (1-col, no overflow, table scrolls) + desktop (2-col), sticky footer structure, toasts.
- VLM visual review: desktop 9/10, K-map/circuit clean (minor wire crossing note), mobile 8/10 no defects.
- bun run lint: clean. dev.log: no runtime errors.

Stage Summary:
- Complete interactive simulator delivered: all 22 spec requirement areas implemented with real algorithms (QM minimizer, Gray-code K-maps, parser, polarity model) and a single source of truth. Backend REST + SQLite with localStorage fallback. All exports functional. Browser-verified end-to-end.

---
Task ID: 11
Agent: main (Z.ai Code)
Task: Fix hydration mismatch on theme-toggle icon (user-reported error).

Work Log:
- Diagnosed: AppHeader rendered `{theme === 'dark' ? <Sun/> : <Moon/>}` — `useTheme().theme` is undefined during SSR (server always rendered Moon) but populated from localStorage on the client's first render (stored 'dark' → Sun) → element-structure mismatch (circle vs path), unfixable via suppressHydrationWarning.
- Audited other hydration risks: Zustand store hydrate() is window-guarded + `hydrated` flag → applies persisted state only post-mount (SSR-safe); layout already has `suppressHydrationWarning` on <html>; Tailwind class-based dark variant confirmed (`@custom-variant dark`).
- Fix (canonical shadcn/next-themes pattern): render BOTH icons unconditionally; visibility driven purely by CSS `dark:` variants (the .dark class is applied by next-themes' blocking script before hydration, so server HTML === client first render). Click handler now uses `resolvedTheme`. Added relative/absolute layout + rotate/scale cross-fade (motion-reduce:transition-none). Visual semantics preserved: dark → Sun, light → Moon.
- `bun run lint` clean; dev.log clean.
- Agent-browser verification: page loads with zero console errors/page errors; dark mode icons correct (Sun scale 1 / Moon scale 0); toggle click → light mode (class removed, localStorage 'light', body bg white, icons swapped); hard reload with stored 'light' → no hydration error; toggled to stored 'dark' (the exact failing scenario from the report) + hard reload → no hydration error, theme restored, icons correct; content smoke check (h1, 18 SVGs, theme button) + desktop/mobile screenshots OK.

Stage Summary:
- Hydration error eliminated at the root (no theme-dependent branch during render). Theme toggle verified interactive in both directions across reloads. No other hydration risks found in store/layout.

---
Task ID: 12-21
Agent: main (Z.ai Code)
Task: Font preset from user-uploaded reference chart + truth-table row previews + shift tools + start-code customization + font import/export.

Work Log:
- Analyzed the uploaded chart image (1015x160, 3 rows: Uppercase 26 / Lowercase 26 / Punctuation 22) with sharp pixel analysis: detected cell grid (pitch 32.6, 22x38 cells, red lit segments over gray ghost "8" outlines), extracted all 74 glyphs segment-by-segment via region classification, verified each against ASCII-art renderings; cross-checked against the dmadison/LED-Segment-ASCII font table (fetched from GitHub) — 16/22 punctuation + most letters match; image conventions kept where they differ (B=full-8, D/O=0-shape, G=ACDEF, I=BC, K/M/T/W/X quirky, ':' renders as '=', '(' / '[' share segments).
- src/logic/font.ts — FONT_GLYPHS (74 glyphs + groups), fontPattern, listedCodes(bits, startCode) (row order with wrap), buildFontTable(bits, fontStart, tableStartCode) (glyph window → codes in listed order, font+code wrap-around), fontCharAt, fontIndexOf.
- src/types/simulator.ts — DisplayMode +'font'; FontGlyphData/CustomFont; ProjectData + tableStartCode?/fontStart?/customFont? (backward compatible).
- src/logic/truthTable.ts — presetTable 'font' branch w/ FontPresetOptions; matchesPreset accepts fontOpts; shift ops: shiftRowValues (A→B→…→DP rotation), shiftColumnValues / shiftAllRows / shiftAllColumns (vertical rotation in listed order, dir=1 = down, wrap).
- src/logic/project.ts — parseFontFile (E-260..E-266), validateProject accepts new fields (E-218..E-220), parseFontGlyphsField for embedded customFont.
- src/lib/store.ts — state tableStartCode/fontStart/customFont/undoSnapshot; actions setTableStartCode (font mode re-applies preset; other modes reorder only), setFontStart/stepFontStart/applyFontPreset, setCustomFont/clearCustomFont, shiftRow/shiftColumn/shiftAllRows/shiftAllColumns/undoShift (one-level undo; non-shift edits clear snapshot); setDisplayMode/setInputBits/loadProject/hydrate/toProjectData extended.
- src/lib/useEngine.ts — usePresetModified font-aware.
- Components: TruthTableCard rewritten (GlyphPreview column per row + char labels, toolbar with start-code binary input + font-window stepper/select/reset + row/col/all shift buttons + undo, clickable segment headers set active column target, rows in listed order, live badge); SevenSegmentDisplay + GlyphPreview (lightweight bare SVG, amber/dashed-X); AppHeader + FONT mode button; DisplayCard font char badge; CustomCharacterCard font-aware labels; ExportMenu + Font JSON (current table) & Font JSON (full chart font); ProjectManagerCard import detects sevenseg-font format → setCustomFont + font mode, "Import JSON / Font" button.
- utils/exporters.ts — buildFontJson (table window w/ code+binary+segments+pattern), buildBuiltinFontJson.
- Verification: bun script 139/139 checks (font integrity vs pixel extraction, listedCodes wrap, buildFontTable mapping incl. start=1 (A→0001, P→0000 wrap) and font-window wrap (72→( )→A), 5-bit 32 glyphs, matchesPreset, all 4 shift ops incl. wrap/X-preservation/listed-order semantics + restores, font-file parse + rejections, project validation new fields + legacy defaults + E-codes).
- Agent-browser E2E: FONT preset loads (0000=A=ABCEFG, 0001=B=full-8) with 16/32 previews rendering correct fills; row shift right ×2 verified on m8 (I=BC→D,E), undo restores exactly one level; column B shift up wraps; all-rows down wraps; start code 0001 → row order 0001..1111,0000 with A→0001/P→0000; font window stepper B→Q and 5-bit B..g; imported 16-glyph font cycles with wrap; export→import round-trip reproduces table exactly (code 00001=B, 00000=g wrap); restore built-in font; export menu items + toasts; expressions derive live from font table (6T/19L SOP); K-map Gray labels; mobile no overflow, footer ok; VLM review clean.
- bun run lint clean; dev.log no runtime errors.

Stage Summary:
- All 6 requested features delivered: (1) FONT preset reproducing the uploaded chart's 74 glyphs pixel-accurately, (2) live mini-preview per truth-table row, (3) shift by row/column individually or all (+undo), (4) customizable DCBA/EDCBA start code (e.g. 0001, wraps), (5) live output everywhere (single source of truth), (6) font JSON import/export + full-chart-font export. Font data is pure data — importable custom fonts drive the entire engine with no hard-coded expressions.

---
Task ID: 22-b
Agent: full-stack-developer (subagent)
Task: Preset library backend — Prisma Preset model + REST CRUD at /api/presets.

Work Log:
- Added `Preset` model to prisma/schema.prisma (id client-supplied @id without cuid, kind "table"|"font", name, data JSON blob, createdAt/updatedAt); kept User/Post/Project untouched; ran `bun run db:push` — schema in sync, Prisma client regenerated.
- Hit a stale-singleton issue: the running dev server's `globalThis.prisma` instance predated the model push, so `db.preset` was undefined → 500 on first curls (no prisma:query lines in dev.log; confirmed via a temporary error-detail diagnostic, then reverted). Fixed by triggering Next dev's built-in restart (appended a comment to next.config.ts, verified "Restarting the server to apply the changes…" + fresh process, then removed the comment — next.config.ts is back to its original content). NOTE for future agents: after adding a Prisma model, touch next.config.ts so the dev server reloads the regenerated client.
- Created src/app/api/presets/helpers.ts mirroring projects/helpers.ts conventions: `validatePresetCreate` (id required non-empty string ≤100 chars MUST start with "user:" → exact 400 error "id must start with 'user:'"; kind must be "table"|"font"; name non-empty trimmed ≤100; data must be a JSON object OR a valid JSON string containing an object — string form parsed first, then re-serialized canonically; arrays/primitives rejected), `validatePresetUpdate` (partial name/data only — id/kind immutable and ignored), `serializePreset` (parses stored data string back into an object), `jsonError(message, status)` extended with 409.
- Created src/app/api/presets/route.ts (`dynamic = 'force-dynamic'`): GET list ordered by updatedAt desc without `data` (select id/kind/name/createdAt/updatedAt), `?full=1` (or `true`) includes parsed data; POST create → 201 serialized preset, pre-checked duplicate id → 409 {error:"preset id already exists"} (+ P2002 race guard in catch → 409), 400 on validation, 500 catch-all.
- Created src/app/api/presets/[id]/route.ts (`dynamic = 'force-dynamic'`; `params` typed `{ params: Promise<{ id: string }> }` and awaited, exactly like projects/[id]): GET → 200 serialized / 404; PUT partial update of name and/or data (empty update = no-op, returns current row) → 200 / 404 / 400; DELETE via deleteMany + count check → {success:true} / 404. All handlers try/catch → 500 {error}.
- Curl-tested end-to-end against the running dev server on localhost:3000 (see Stage Summary), then deleted every row created during testing; verified GET /api/presets → `[]` and directly in SQLite via a Prisma count (0 rows).
- `bun run lint` → clean. dev.log clean (correct Preset SQL, no runtime errors).

Stage Summary:
- Endpoints: GET/POST /api/presets; GET/PUT/DELETE /api/presets/[id]. All curl tests passed: POST valid table preset → 201 with data round-tripped as object; duplicate id → 409; GET list omits data / ?full=1 includes parsed data (order = updatedAt desc, newest first); PUT name-only and data-only updates → 200 (updatedAt bumped, other fields preserved); GET user:test-1 → 200, GET user:missing → 404; invalid POSTs → 400 (id without "user:" prefix → "id must start with 'user:'", kind "bogus", whitespace-only name, data "not-json"); data as valid JSON string → 201 OK (parsed back as object); PUT/DELETE missing id → 404; PUT invalid data on existing → 400; DELETE → {success:true} then GET → 404. Preset table left empty after cleanup (list `[]`, 0 rows in DB). API contract written to agent-ctx/22-b-full-stack-developer.md for the frontend agent.

---
Task ID: 22-a / 22-c / 22-d / 22-e
Agent: main (Z.ai Code)
Task: Preset system — logic registry, store layer, gallery UI, E2E verification (plan approved by user: "proceed with the suggested sequence"; backend 22-b done by subagent).

Work Log:
- 22-a (logic): src/logic/presets.ts — new first-class preset layer: code generators (excess3Table digit d at d+3, aikenTable 2-4-2-1, grayCounterTable g(i)=i^(i>>1) with grayDecode inverse + 5-bit positions 16-31 as don't-cares, allSegmentsTable boundary), CALCULATOR_GLYPHS (16-glyph calculator HEX font with distinct lowercase b/d), BUILTIN_TABLE_PRESETS (8: bcd/hex/font/excess3/gray/aiken/allon/alloff), BUILTIN_FONTS (chart + calculator), buildPresetTable (generator dispatch, literal exact-restore + width resize, existing-table for 'custom' behavior), matchesTablePreset, presetDisplayMode mapping, sevenseg-preset file format (parsePresetFile E-270..E-279, buildTablePresetFile/buildFontPresetFile, fresh user ids on import), detectImportFormat (project/font/preset auto-detection), validateLibraryTablePreset/FontPreset (server/localStorage library entry validation). types/simulator.ts: PresetKind/PresetCategory/PresetGenerator/TablePresetOptions/TablePresetDef/FontPresetDef/PresetLibrary + ProjectData appliedPresetId?/appliedPresetName?/activeFontId?. project.ts: E-222/223/224 validation of new fields (backward compatible). truthTable.ts: patternToX exported.
- 22-a verification: bun script 102/102 checks — xs3/gray/aiken/boundary spot values at 4&5 bits (incl. gray code 8='F' position 15, aiken 1011='5'), calculator b≠8/d≠0, buildPresetTable per builtin, matchesTablePreset flip/revert, preset file round-trips + all E-27x rejections, detectImportFormat, project validation incl. legacy.
- 22-c (store): presetLibrary state + localStorage 'sevenseg-presets-v1' (loadLibrary/persistLibrary with validation); activeFontId font selection (builtin:chart | builtin:calculator | user:<id>, reconcileFont synthesis incl. legacy customFont migration); appliedPresetId/Name with mode-implied builtins (setDisplayMode/hydrate/loadProject synthesize builtin:bcd/hex/font); actions: applyPreset (effective options, literal width restore, behavior restore), activateFont, reapplyPreset, saveCurrentUserPreset, saveCurrentTableAsFont (listed-order glyph conversion with patternToChar + '#i' fallback labels, X→unlit), rename/duplicate/deleteUserPreset, importPresetFile, syncPresetsFromServer (hydration-gated merge by updatedAt + local-only push-up, apiUpsertPreset POST→409→PUT, DELETE cleanup); setInputBits regenerates code-generator presets at new width; setInvalidBehavior regenerates behavior-sensitive presets (bcd/hex/xs3/aiken); setCustomFont registers imported fonts in the library (dedupe by name+glyphs); useEngine: usePresetModified is preset-based (effective options vs live state) + useAppliedTablePreset.
- 22-c verification: bun script 67/67 (fetch mocked) — apply/restore/reapply flows, width+behavior regen, save/rename/duplicate/delete, calculator/chart activation, table→font round-trip, legacy loadProject reconciliation, server POST/DELETE fired.
- 22-b (subagent full-stack-developer): Prisma Preset model + GET/POST /api/presets (409 dup), GET/PUT/DELETE /api/presets/[id]; curl-verified; table empty after tests.
- 22-d (UI): PresetGalleryDialog (Tabs Tables/Fonts, mini GlyphPreview strips per preset card via buildPresetTable at preview bits, category/generator badges, active+modified badges, save-current-as-preset / save-table-as-font inputs, inline rename, duplicate/delete/export per user preset, max-h scroll containers); AppHeader preset indicator button (name + amber modified dot, opens gallery); TruthTableCard generalized re-apply button (any preset, not just font) + active-font popover via resolveFontPreset; ExportMenu "Preset JSON — current table" (literal snapshot file); ProjectManagerCard import auto-detects project/font/preset (E-251 for unrecognized); DisplayCard/CustomCharacterCard/TruthTableCard font resolution via activeFontGlyphs(customFont, activeFontId); page.tsx calls syncPresetsFromServer on mount.
- 22-e (agent-browser E2E, all verified): page loads zero errors/warnings; gallery opens with 8 table presets + 2 fonts with preview strips; Excess-3 applied (code 3='0', 12='9', invalid codes X per don't-care); Gray applied (code 0→'0',1→'1',3→'2',2→'3',6→'4',8→'F',12→'8',15→'A'); cell edit → header "Gray-Code Counter · modified" badge + dot + re-apply button → click restores table and clears indicators; Calculator font activated (FONT mode, code 11='b'=CDEFG, code 13='d'=BCDEG — distinct forms verified); user preset saved ("My Calc Font Window") → renamed ("Renamed Calc Window", header + library + server PUT updatedAt bump) → duplicated → copy deleted; server sync verified via /api/presets (both rows present, then re-push after reload with empty server → merge-back proved bidirectional offline-first sync); Preset JSON exported (toast); sevenseg-preset file uploaded via Import JSON → auto-detected → "Imported Aiken Test" added to gallery → applied → Aiken table verified (0-4 at 0000-0100, 5 at 1011, 9 at 1111, 5-10 blank); 5-bit switch with literal preset resizes (32 rows, overlap preserved, X fill); builtin Aiken + invalid-behavior switch → table regenerated (X→blank); save-current-table-as-font ("Aiken As Font" 16 glyphs, '#i' fallback labels, active); localStorage round-trips (workspace + library keys, activeFontId persisted); mobile 390px: no horizontal overflow, footer present, header usable; VLM review desktop 9/10 + mobile 9/10 (no defects); hard reloads with full and empty storage: zero hydration errors; cleanup: server rows deleted + localStorage cleared + final reload → default BCD state, empty library, server [].
- bun run lint clean; dev.log no runtime errors (only 200 API responses).

Stage Summary:
- Preset system delivered end-to-end: 8 builtin table presets (incl. classic teaching codes excess-3 / Gray counter / Aiken + boundary patterns), 2 builtin fonts (chart + calculator), user preset library (save/rename/duplicate/delete/export/import) with REST+SQLite sync and localStorage-first offline fallback, preset gallery dialog with live preview strips, applied-preset indicator with modified dot and one-click re-apply, and sevenseg-preset file format (E-270..E-279) auto-detected on import alongside project/font files. All flows browser-verified; engine/store checks 102/102 + 67/67.
