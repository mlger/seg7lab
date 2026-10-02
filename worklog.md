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
