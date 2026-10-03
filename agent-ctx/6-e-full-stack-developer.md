# Task 6-e — final P3 refactor wave (component splits + tab-state preservation + validation dedup)

Agent: full-stack-developer · Session: dedicated agent-browser `--session 6e`

## What was done

### 1. TruthTableCard split (775 → 6 files, max 252 lines)
Old `src/components/simulator/TruthTableCard.tsx` DELETED. New canonical path: `@/components/simulator/truth-table` (index.ts re-export). page.tsx updated.
- `truth-table/TruthRow.tsx` (163) — memoized row + TruthRowProps + cellColor, verbatim. Memo discipline preserved: parent still passes ONLY primitives / stable store refs / useCallback handlers.
- `truth-table/TruthTableToolbar.tsx` (252) — start-code input (owns the startCodeText draft + applyStartCode locally), font window (glyph select/stepper/custom-font popover), shift tools (row/col/all), undo, re-apply. Subscribes to its own store slices (atomic selectors); usePresetModified/useAppliedTablePreset go through the 6-a shared cache → no extra cost.
- `truth-table/TruthTableHeader.tsx` (145) — Inputs/Outputs banner + variable rename inline editing (owns editingVar/varDraft + commitVarName/toast) + segment header buttons.
- `truth-table/TruthTableHelp.tsx` (112) — help paragraph (always) + ExplainBlock (explain prop). Fully presentational; engines/current arrive as props so it adds NO new useEngines instance.
- `truth-table/TruthTableCard.tsx` (232) — composition root: the ENTIRE stable handler block kept verbatim (registerRowRef, handleSelectRow, handleTogglePreviewSegment, handleDragRowStart/End, handleRowHover/Leave guarded, handleRowDrop [table, inputBits, setRowPattern], handleRowKeyDown [table, inputBits, setInput, setRowPattern] with parent rowClipboardRef), orderedRows/rowChar memos, scroll effect, drag/dropRow state.

### 2. LogicCircuitCard split + pure netlist extraction (725 → logic + 6 files)
- NEW `src/logic/circuitNetlist.ts` (194, PURE, no React/DOM) — GateType/CNode/CWire/Circuit types, buildCircuit() (verbatim netlist+layout math), evaluateCircuit() (the values memo extracted verbatim). Joins the logic DAG as a leaf (imports only types/simulator).
- Old `src/components/simulator/LogicCircuitCard.tsx` DELETED. New canonical path: `@/components/simulator/logic-circuit`. page.tsx updated.
  - `logic-circuit/LogicCircuitCard.tsx` (260) — view state owner (zoom/pan/drag/overrides/selected/moved/svgRef), wheel effect (verbatim), toGraph math, pointer handlers (onCanvasPointerDown / onNodePointerDown / onPointerMove / onPointerUp incl. rail-toggle + inspect-click), header zoom/reset buttons, SegmentSelector usage, legend, explain.
  - `logic-circuit/CircuitCanvas.tsx` (189) — presentational SVG (wires + input/out/const/gate nodes); all interaction via stable callbacks.
  - `logic-circuit/GateInspector.tsx` (90) — amber inspect panel.
  - `logic-circuit/GateReference.tsx` (41) — collapsible gate reference.
  - `logic-circuit/gateVisuals.tsx` (88) — GATE_INFO + gateSymbol (JSX, stays out of the pure logic layer).
- NEW `src/components/simulator/shared/SegmentSelector.tsx` (41) — ONE segment-selector button group (role=tablist > role=tab, identical classes/aria) used by BOTH KarnaughMapCard and LogicCircuitCard (was copy-pasted in both). KarnaughMapCard: 427 → 414 lines.

### 3. Tab-switch state loss (page.tsx)
Radix TabsContent unmounts inactive panels (confirmed in node_modules: `hidden: !present`, `children: present && children`; with forceMount present is ALWAYS true → panel stays mounted and VISIBLE → must hide manually).
- forceMount decisions (per tab): **kmap YES** (hover/scroll view state), **expressions YES** (CustomExpressionEditor holds typed text + verify result), **circuit YES** (zoom/pan/gate-drag overrides/selected node), **truth-table NO** (drafts are low-harm to lose; heaviest DOM panel — avoids permanent re-render cost), **characters NO** (only "editing row" marker; 16–32 glow SVGs would render forever), **projects NO** (mount-fetch semantics — forceMount would fetch at page load for every visitor).
- Inactive forceMounted panels hidden via `data-[state=inactive]:hidden` (Tailwind display:none — verified in browser: display:none, offsetHeight 0, excluded from a11y tree).
- Browser-verified: circuit zoom(1.44)/pan(100,60)/gate-override(149.25,146.75)/selected-inspect-panel ALL survive Truth-Table AND K-Map round-trips; expressions editor text `!(AB) + C'D` + E-221 m1/m4 result survives round-trip. Only one panel visible at a time; no horizontal scrollbar; footer still at document bottom (987=987).
- Perf: bit-toggle ~29ms/cycle, K-map cell edit ~76ms/cycle with all forceMounted panels live; standalone computeEngines = 0.55ms warm — no visible regression (engines don't recompute on currentInput changes; hidden panels only reconcile, never paint).

### 4. NEW `src/logic/validation.ts` (44 lines) — shared primitives
API: `isSegmentOutput(v): v is SegmentOutput`, `parseGlyphEntry(raw): FontGlyphData | null` (char 1–4 chars + segments ⊆ ABCDEFGDP), `isSegmentName` re-exported from './font'.
- presets.ts: local isSegmentOutput deleted; parseGlyphs' glyph loop → parseGlyphEntry + its OWN E-278/E-279 reporting (unchanged strings).
- project.ts: local isSegmentOutput deleted; parseFontFile loop → parseGlyphEntry + E-265 reporting; parseFontGlyphsField loop → parseGlyphEntry (silent). E-2xx/E-27x families untouched.
- verify:logic 283/283 PASS (incl. timestamp preservation + validator pins) → zero behavior change.

### 5. use-mobile.ts
NOT deleted — has one live consumer: `src/components/ui/sidebar.tsx` (shadcn scaffold, imported by nothing in the app but kept in components/ui which is outside my ownership; deleting the hook would break tsc repo-wide). Left in place.

## Verification (all green)
- `bun run lint` exit 0 · `bunx tsc --noEmit` 0 errors repo-wide · `bun run verify:logic` 283/283 · `bun run scripts/verify-circuitverse.ts` 30,893 ALL PASS.
- agent-browser --session 6e: page renders; all 6 tabs activate; truth table: row select (12→6 + active bg), X cycling (1→X→0), keyboard c (Outputs copied toast) / v (m2 outputs → m5, inputs 0101 unchanged), drag copy (synthetic DnD m5→m11: outputs copied, inputs excluded, "Pattern copied" toast; agent-browser `drag` also applied copies — its ref resolution picked neighbor rows, CLI quirk, app behavior correct); K-map: 7 overlay rects with palette #f59e0b/#10b981/#f43f5e/#a855f7, grid 4 rows/16 gridcells/16 buttons, cell click cycles 1→X, heuristic badge absent, 5-bit = 2 planes (A=0/A=1) × 16 cells + 32 rows; circuit: zoom buttons (scale 1.44), canvas pan drag (translate 100,60), gate drag override, input-rail click toggles store bit (1100), gate click opens inspect panel, wheel listener verified (synthetic wheel: defaultPrevented=true + scale → 1.4049); expressions: `!(AB) + C'D` → E-221 diff m1/m4 (parser live); projects: create 201 → listed → delete AlertDialog confirm → 204 → gone + toast; preset gallery dialog opens/apply/Escape-closes; export menu: 10 items, CSV + PDF complete with toasts, CircuitVerse dialog opens with stats; console ZERO errors/warnings, page errors ZERO; dev.log clean (one preset sync GET per load); DB left at 0 projects / 0 presets.
- Operational quirks hit (documented for future waves): agent-browser default viewport is 1280×577 — elements measured via getBoundingClientRect can be below the fold → use `set viewport 1440 900` first; DOM reads in the SAME tick as a synthetic click see the pre-render state (React commits after the task) — always wait before asserting; mixing element refs across MULTIPLE snapshot invocations resolves to neighbor elements (the `drag` command applied m8→m7 when asked for m3→m7); the 6e session was reset to about:blank twice mid-test by outside interference (same class of issue 6-a hit with the shared default session) — reopen and re-verify after any reset.

## Deviations
- None functional. Two copy-level slips during the move were caught and fixed in-flight (a `…←DP` title typo and a stray trailing import in TruthTableCard.tsx). The always-visible help <p> and conditional ExplainBlock were consolidated into TruthTableHelp with an `explain` prop (same render output).
