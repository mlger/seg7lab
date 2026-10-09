# seg7lab — Product Requirements Document

**One-line positioning:** seg7lab is an interactive 7-segment display decoder design lab for students of combinational logic and their instructors; this document specifies the product for the engineers who maintain and extend it.

**Scope and preconditions:** In scope are the web application and its exports described below, built on Next.js 16 (App Router) + React 19 + TypeScript, Tailwind 4 + shadcn/ui, a Zustand store as single source of truth, Prisma + SQLite for persistence, REST at `/api/projects` and `/api/presets`, deployed to Vercel from GitHub. Out of scope: everything listed as a non-goal in §2. Claims below reflect the codebase at the version noted; a value that could not be established from the repository is marked `[TO CONFIRM]` rather than guessed.

**Version and date:** package `seg7lab` version 0.2.1 (`seg7lab/package.json`); document dated 2026-10-09.

## 1. Overview and problem statement

Audience: students learning combinational logic and digital design, and instructors teaching it.

The pain: a textbook presents the truth table, the K-map, the Boolean expression and the gate schematic as four disconnected artefacts. A student fills a truth table by hand, minimises on paper, then draws a schematic separately, and nothing in the workflow checks that the three agree. Mistakes in a single cell of the K-map or a dropped don't-care propagate silently into an expression and a drawing that no tool ever re-validates.

seg7lab removes that gap by construction. ONE truth table is the single source of truth. Every other representation — K-maps, Boolean expressions, the gate circuit, the display glyph, every export — is DERIVED from that table by pure functions in `src/logic/`. Nothing is stored twice, so no two views can drift apart. Minimisation is a real Quine-McCluskey minimiser with don't-care handling; expressions are computed, never hard-coded.

The product is therefore not a drawing tool with a table attached, and not a table with a drawing attached: it is one model rendered six ways, live.

## 2. Goals and non-goals

Goals of v1:

- One editable truth table driving six tabs that can never disagree with it (§6, NFR-1).
- A full design loop at 4-bit (A–D) and 5-bit (A–E) input widths, with per-cell values 0 / 1 / X (don't-care).
- Textbook-grade outputs a student can hand in or wire up: minimal expressions, a schematic, and exports for CircuitVerse, Falstad / CircuitJS1, Verilog, CSV, SVG/PNG and PDF.
- Honest instrumentation: every claim the UI makes about a design (gate count, sharing, layering outcome) is backed by a check (§8).

Non-goals of v1 — these are limitations, not future promises:

- **Layering is not a win on the shipped example.** Multi-level factoring measures net-NEGATIVE on the built-in BCD table: better in 1 of 15 segment × form cases, worse in 7. Quine-McCluskey already flattens these covers, so factoring mostly adds depth. The UI states this plainly instead of implying an improvement.
- **The Falstad export is incomplete.** It draws the decoder logic plus a logic-output probe. It does NOT emit the seven-segment display element, and it does not yet follow the on-screen style chips. *(RESOLVED 2026-10-09: the export is now ONE combined file — all decoders, one shared input bus, a real SevenSegElm (157) — and it follows the on-screen form and gate style, canonical forms included.)*
- **Verilog and CircuitVerse exports stay two-level SOP** even when the tab shows Layered or Universal.
- **Zero cross-segment sharing** on the BCD table in the full-decoder Layered view.
- **No timing or hazard analysis.** No gate delays, no static/dynamic hazard reporting.
- **Gate layout is not persisted** in a saved project: a reload re-derives the layout.
- **No pinch-zoom on touch devices.**
- No user accounts, roles, or sharing permissions: ownership is the anonymous per-browser token described in §7.

## 3. Users and use cases

**U1 — Student, guided exercise.** Given "drive segment A for the decimal digits 0–9 with BCD input", the student fills the truth table, opens the K-map, groups the 1s, and reads the minimised SOP from Expressions. The use case ends when the student can compare the canonical Σm form against the minimised one and see the gate count fall on the Circuit tab.

**U2 — Student, self-check.** Unsure whether a don't-care was used correctly, the student sets a cell to X, watches the K-map regroup and the expression change, and confirms the display glyph still shows the intended digit.

**U3 — Instructor, lecture demo.** Projecting the full decoder (all eight segments as stacked bands sharing input rails), the instructor clicks an input rail and every band, gate output and the display glyph re-evaluate in the same beat — a visible demonstration that the display is a function of the table.

**U4 — Student, lab hand-off.** The student exports a Verilog module and a Falstad / CircuitJS1 netlist for a lab session, plus a PDF engineering report (truth table + K-maps + Boolean equations) as the written submission.

**U5 — Student, circuit comprehension.** Using TRACE, the student walks the schematic one logic layer at a time, then clicks individual gates to inspect live inputs/outputs and the gate's fan-in/fan-out cone, to answer "where does this signal come from?".

**U6 — Maker / hobbyist.** Designing a non-standard character set, the maker opens Characters, builds glyphs, exports font JSON (current table window or the full 74-glyph reference chart) for use elsewhere.

## 4. Functional requirements

Priorities: P0 = required for v1, P1 = important, P2 = desirable. Each requirement is one line and independently testable.

### 4.1 Truth table tab

- **FR-1 (P0)** The table supports 4-bit (A–D) and 5-bit (A–E) input widths; switching width re-derives every dependent view without data loss.
- **FR-2 (P0)** Each cell holds a segment value and cycles 0 → 1 → X on click.
- **FR-3 (P0)** The row and column corresponding to the current selection are highlighted.
- **FR-4 (P1)** Bulk row and column operations apply an operation to a whole row or a whole column in one action.
- **FR-5 (P0)** Table edits support undo.
- **FR-6 (P0)** Display mode can be set to decimal, binary, hex, font, custom or raw, and the choice affects how rows are labelled and how the display interprets the current input.
- **FR-7 (P0)** Any cell edit is reflected in the K-map, Expressions, Circuit and Characters tabs without a reload or manual refresh.

### 4.2 K-map tab

- **FR-8 (P0)** A K-map is generated for 4-bit and 5-bit tables with Gray-code axis ordering.
- **FR-9 (P0)** Cell contents come from the truth table only; no K-map state is stored.
- **FR-10 (P0)** Cover groups are drawn over the 1s (and the X cells they absorb) for the selected segment.
- **FR-11 (P0)** Each cover group's colour matches the colour of the corresponding term gate on the Circuit tab.
- **FR-12 (P1)** The K-map reflects the current segment selection made elsewhere in the app.

### 4.3 Expressions tab

- **FR-13 (P0)** Canonical Σm and ΠM forms are displayed for the selected segment.
- **FR-14 (P0)** Minimised SOP and POS forms are displayed, produced by the Quine-McCluskey minimiser with don't-care handling.
- **FR-15 (P1)** Prime implicants can be selected: the user adds or excludes covers and the displayed expression follows the selection.
- **FR-16 (P0)** No expression is hard-coded; every displayed expression is a function of the truth table and the user's cover selection.

### 4.4 Circuit tab

Detailed requirements are in §5.

- **FR-17 (P0)** The circuit is derived from the same truth table as every other tab.
- **FR-18 (P0)** The circuit supports single Segment and Full decoder modes.
- **FR-19 (P0)** The circuit supports SOP, POS, canonical Σm and canonical ΠM forms, and rebuilds visibly between them.
- **FR-20 (P0)** The circuit supports AND/OR, Universal and Layered implementation styles.

### 4.5 Characters tab

- **FR-21 (P1)** A custom glyph builder lets the user set the eight segments of a glyph.
- **FR-22 (P0)** The displayed glyph is computed from the truth table row selected by the current input.
- **FR-23 (P2)** Glyph definitions can be exported as font JSON for the current table window and for the full 74-glyph reference chart.

### 4.5a Standard pattern set

- **FR-21a (P0)** The canonical ASCII 7-segment character chart is available as a built-in preset, so a student can start from a recognised reference rather than an empty table.
- **FR-21b (P0)** Each glyph's pattern is DERIVED from the chart's printed code, which IS the segment bitmask (bit0 = a … bit6 = g), and the derivation is asserted by test rather than read from the picture.
- **FR-21c (P1)** The chart's ten digit patterns match the standard encodings (0 = 0x3F, 1 = 0x06 … 9 = 0x6F) and are pinned by test.
- **FR-21d (P1)** Where the chart prints one code against two glyphs (109 for both the digit 5 and the letter S), the shared pattern is preserved as-is: seven segments genuinely cannot distinguish them, and the chart documents that rather than hiding it.
- **FR-21e (P1)** The chart is applied by glyph order windowed onto the live code space (4-bit → the first 16 glyphs, 5-bit → the first 32), because the chart's own codes need 7 address bits and would leave most of a 4-bit space empty.

### 4.6 Projects tab

- **FR-24 (P0)** A design can be saved as a project and loaded again.
- **FR-25 (P0)** Loading a project restores the truth table and the settings that are persisted (see §7 for what is not).
- **FR-26 (P1)** A project can be shared via a link or identifier derived from the stored project.
- **FR-27 (P0)** Saved projects are listed from `GET /api/projects`, filtered to the requesting browser's owner token plus shared legacy rows.
- **FR-28 (P1)** Project create/update/delete operations report server failures to the user rather than failing silently.

### 4.7 Exports

- **FR-29 (P0)** Truth-table CSV.
- **FR-30 (P0)** Project JSON, re-importable by the app.
- **FR-31 (P1)** Font JSON for the current table window.
- **FR-32 (P1)** Font JSON for the full 74-glyph reference chart.
- **FR-33 (P1)** Preset JSON.
- **FR-34 (P0)** Verilog module.
- **FR-35 (P0)** CircuitVerse `.cv` file.
- **FR-36 (P0)** Falstad / CircuitJS1 `.txt` file in the classic `$` netlist format.
- **FR-37 (P1)** Display SVG.
- **FR-38 (P1)** Display PNG.
- **FR-39 (P0)** PDF engineering report containing the truth table, the K-maps and the Boolean equations.
- **FR-40 (P0)** Every export is generated from the current truth table at export time; no export reads a cached copy.

## 5. Circuit tab requirements

The Circuit tab is the core surface: it is where the design stops being a table and becomes a machine. All requirements in this section are P0 unless marked otherwise.

### 5.1 Modes

- **FR-41** Single Segment mode renders the circuit for one segment.
- **FR-42** Full decoder mode renders all eight segments as stacked bands that share the input rails, so shared signals are visibly one net rather than eight copies.

### 5.2 Forms

- **FR-43** SOP form renders the minimised sum-of-products network.
- **FR-44** POS form renders the minimised product-of-sums network.
- **FR-45** Canonical Σm form renders the unminimised sum-of-minterms network.
- **FR-46** Canonical ΠM form renders the unminimised product-of-maxterms network.
- **FR-47** Switching form genuinely rebuilds the netlist; canonical forms are visibly larger than their minimised counterparts (see §9 for the metric).

### 5.3 Implementation styles

- **FR-48 AND/OR (two-level):** literals feed AND terms, terms feed an OR (or the dual for POS); the network has logic depth 2 after inverters.
- **FR-49 Universal (De Morgan):** SOP is realised as NAND-NAND and POS as NOR-NOR, using the stated dualities so the same function is expressed in one gate family.
- **FR-50 Layered (multi-level factoring):** shared sub-expressions are computed once in an earlier logic LAYER and wired to every consumer, so a signal used in several terms is not recomputed. Depth increases; literal count is intended to decrease.
- **FR-51** The Layered view reports its measured outcome for the current design, including when it is worse than two-level, and does not present the style as an improvement by default.
- **FR-52** In Full decoder Layered mode, cross-segment sharing is reported for the current table; a value of zero is shown as zero rather than hidden.

### 5.4 Interaction model

- **FR-53** Clicking an input rail toggles that input and every panel re-evaluates.
- **FR-54** Clicking a gate opens an inspector showing its live inputs, its live output, and its fan-in/fan-out cone.
- **FR-55** Gates can be dragged.
- **FR-56** The canvas supports wheel zoom anchored at the cursor, panning, and a fit-to-view command.
- **FR-57** The canvas supports a fullscreen view.
- **FR-58** TRACE walks the circuit one logic layer at a time, revealing gates in layer order.
- **FR-59** An input auto-sweep player steps the input code automatically, so the display and the circuit can be observed without manual clicking.
- **FR-60 (P1)** Toggling an input re-evaluates displayed values without re-deriving the netlist (see NFR-3).

### 5.5 74-series labelling

- **FR-61** Each gate type renders its real 74-series part number next to the gate: 74HC08 / 74HC11 (AND), 74HC32 / 74HC4075 (OR), 74HC04 (NOT), 74HC00 / 74HC10 (NAND), 74HC02 / 74HC27 (NOR), 74HC86 (XOR), 74HC7266 (XNOR).
- **FR-62** The part number shown matches the gate type actually instantiated; the mapping is asserted by the verification suite (§8).

### 5.6 Visual language

- **FR-63** Inputs are plain text labels with wire stubs, not boxed components.
- **FR-64** Gates are drawn as monoline symbols with pale-blue bodies and open inversion bubbles.
- **FR-65** Junction dots mark shared nets.
- **FR-66** The rendering reads as a textbook schematic: consistent stroke weight, orthogonal wires, no ornamental styling.
- **FR-67** Cover-group colours from the K-map are reused on the matching term gates (§4.2, FR-11).

## 6. Non-functional requirements

- **NFR-1 Correctness.** For all eight segments and both input widths, no derived view may disagree with the truth table. The verification suite (§8) is the enforcement mechanism; a view that cannot be checked does not ship.
- **NFR-2 Determinism.** The same truth table plus the same mode/form/style selections always yields the same circuit layout and the same export bytes. No randomness, no time dependence, no reliance on object-iteration order.
- **NFR-3 Performance.** Toggling an input rail must not rebuild the netlist; netlist derivation is keyed on the truth table and the mode/form/style selection, while input evaluation is a lookup. Target interaction latency budget: `[TO CONFIRM]`.
- **NFR-4 Accessibility.** The canvas is operable by keyboard for its core actions (input toggling, gate selection, zoom/pan), exposes ARIA roles for the interactive regions, and honours `prefers-reduced-motion` for animations such as TRACE and the auto-sweep player.
- **NFR-5 Portability.** Development and verification run on Windows, macOS and Linux. `npm run verify:logic:node` must not depend on platform-specific paths or shells.
- **NFR-6 Offline / local fallback for persistence.** When the API is unreachable, the app keeps working: the workspace and the preset library are persisted to `localStorage` and API failures are surfaced as warnings rather than blocking the session.

## 7. Data model and persistence

**Project** (SQLite via Prisma): `id` (cuid), `name`, `inputBits` (default 4), `data` (the full project JSON blob), `ownerId` (nullable), `createdAt`, `updatedAt`; indexed on `updatedAt` and `ownerId`.

**Preset**: `id` (client-supplied, and required to match `"user:"` followed by a safe charset rather than a cuid), `kind` (`"table"` or `"font"`), `name`, `data` (preset JSON blob), `ownerId` (nullable), `createdAt`, `updatedAt`; indexed on `updatedAt` and `ownerId`.

**Ownership.** The API is unauthenticated. Each browser generates a stable random owner token on first use, stores it in `localStorage`, and sends it on every request in the `x-sevenseg-owner` header. Rows with `ownerId = null` are shared/legacy: readable and writable by everyone, so existing demo data keeps working. A token is never treated as a secret or an authentication credential.

**Write path.** The project/preset JSON blob is validated and canonicalised on write, so a malformed or non-canonical payload is rejected rather than stored.

**Local fallback.** The current workspace and the preset library are mirrored to `localStorage`; on startup they are loaded and validated. A server failure for a preset leaves the local copy authoritative for that session.

**Not persisted.** Gate layout is not part of a saved project (§2); it is re-derived on load.

## 8. Verification strategy

`scripts/verify-logic.ts` is a permanent pure-logic test suite of **477 checks**, run with `npm run verify:logic:node` (Node, `--experimental-strip-types`, alias-registered). It is not a one-off script: it is the product's correctness argument.

What it covers:

- Minimiser behaviour, including don't-care handling, and agreement between minimised expressions and the table for every input code.
- The derived views (K-map cells, expressions, circuit netlist, font glyphs) agreeing with the truth table.
- Netlist structure and layout invariants, including that repeated builds of the same input produce identical counts.
- Export grammar and geometry for the Falstad / CircuitJS1 output: pinned gate-type ids against the shipped gate definitions, gate pin offsets for 2/3/4/5 inputs, header shape, element-line grammar, integer coordinates on the 16px grid, no dangling wire endpoints, no endpoint landing on a foreign run, no collinear overlap between different nets, no wire passing through a gate body, constant-only segments skipped rather than exported as a floating probe, and gate counts agreeing with the circuit builder.
- Determinism: byte-level identical output for identical input.

A separate suite, `scripts/verify-circuitverse.ts`, validates the CircuitVerse geometry, mirroring CircuitVerse's rendering model (pin nodes) and asserting the geometric invariants at scale, including the 5-bit font case where segments reach up to 32 minterms.

Governing principle: **a claim the UI makes must be backed by a check.** If the interface says a form is larger, or that layering shared N signals, that number is derived from the same data the test suite exercises.

## 9. Success metrics

Falsifiable, and each one tied to an automated or reproducible check:

1. Every derived view agrees with the truth table for all 8 segments at both 4-bit and 5-bit widths (NFR-1) — asserted by the suite, not by inspection.
2. Switching a segment from canonical Σm to minimised SOP shows a strictly larger gate count in the canonical form.
3. A canonical vs minimised comparison in Full decoder mode shows the minimised decoder uses fewer gates than the canonical one.
4. All 477 checks pass via `npm run verify:logic:node`, with 0 failures, on a clean checkout.
5. Every exported file opens in its target tool: CircuitVerse `.cv` loads in CircuitVerse, the Falstad / CircuitJS1 `.txt` loads in CircuitJS1, the Verilog module compiles in the chosen simulator, the CSV opens as a table, the SVG and PNG render, and the PDF opens with readable tables and equations. Target tool versions: `[TO CONFIRM]`.
6. Re-exporting the same design twice produces byte-identical output (NFR-2).
7. Toggling an input rail on the Circuit tab produces no netlist rebuild (NFR-3) — observable in the derivation count reported by the app or by the absence of a rebuild in a test harness.

## 10. Open questions and future work

Derived from the v1 limitations, in rough order of user impact:

- **Does multi-level factoring ever pay off here, and how should that be presented?** Measured net-negative on the shipped BCD table (better in 1 of 15 segment × form cases, worse in 7). Options: keep the style with the honest verdict, restrict it to tables where it wins, or replace the factoring algorithm. Unresolved.
- **Falstad export completeness.** ~~Emitting the seven-segment display element, and making the export follow the on-screen style chips.~~ RESOLVED: one combined file with shared switches + a real display, following the on-screen form/style.
- **Export fidelity for non-two-level styles.** Verilog and CircuitVerse currently stay two-level SOP even when Layered or Universal is displayed. Either the exports must follow the tab, or the UI must state the mismatch at export time.
- **Cross-segment sharing.** The BCD table yields zero sharing in the full-decoder Layered view; whether that is a property of the table, of the factoring algorithm, or of both, is unknown.
- **Timing and hazards.** Not analysed at all: gate delays, static and dynamic hazards, and whether the schematic should annotate them.
- **Layout persistence.** Gate positions are lost on save/load; deciding whether layout belongs in the project blob.
- **Touch support.** No pinch-zoom on touch devices; full touch gesture set undefined.
- **Accessibility depth.** Which canvas operations must be keyboard-reachable, and whether the schematic needs a non-visual equivalent (for example a netlist text view).
- **Thresholds.** Performance budget for NFR-3, supported browser matrix, and maximum project/preset size are all `[TO CONFIRM]`.

## 11. Glossary

- **Truth table** — a table listing every combination of the input bits and the required segment outputs for each combination. In seg7lab it is the single source of truth.
- **Minterm** — a product term true for exactly one input combination; the canonical Σm form is the OR of the minterms where the function is 1.
- **Maxterm** — a sum term false for exactly one input combination; the canonical ΠM form is the AND of the maxterms where the function is 0.
- **Don't-care (X)** — an input combination whose output may be either 0 or 1; the minimiser may use it to enlarge a cover. Stored per cell as X.
- **SOP / POS** — sum-of-products (OR of AND terms) and product-of-sums (AND of OR terms), the two standard two-level forms.
- **Canonical form** — the unminimised Σm / ΠM expression in which every listed combination appears as a full-width term.
- **Prime implicant** — a product term covering 1s (and usable Xs) that cannot be enlarged without covering a 0.
- **Essential prime implicant** — a prime implicant covering at least one 1 that no other prime implicant covers; required in every minimal cover.
- **Two-level vs multi-level** — two-level networks have depth 2 after inverters (AND-OR or OR-AND); multi-level networks introduce intermediate signals, trading depth for fewer literals or gates.
- **De Morgan duality** — the identities that let an AND/OR network be re-expressed in NAND or NOR gates: `(A·B)' = A' + B'` and `(A+B)' = A'·B'`; SOP becomes NAND-NAND and POS becomes NOR-NOR.
- **Fan-out** — the number of gate inputs a signal drives; the fan-out cone of a gate is the set of gates reachable downstream from it.
- **Logic layer** — one stage of the network at a given depth from the primary inputs; TRACE reveals one layer at a time, and the Layered style computes shared sub-expressions in an earlier layer and wires them to every consumer.
