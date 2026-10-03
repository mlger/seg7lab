# Task 23-c — full-stack-developer (subagent)
## CircuitVerse export UI — Export menu entry + export dialog

Context sources: /home/z/my-project/worklog.md (Tasks 3-10 UI conventions, 23-a format research, 23-b engine API + verification) and the previous agents' records in this directory.

## Files changed
- NEW `src/components/simulator/CircuitVerseExportDialog.tsx` ('use client', props `{ open, onOpenChange }`)
- `src/components/simulator/ExportMenu.tsx` — added menu item + dialog render (only edit)
- `src/logic/circuitverse.ts`, store, and all other logic files: untouched

## Engine API consumed (read-only)
```ts
buildCircuitverseProject(inputBits: InputWidth, engines: SegmentEngineMap,
  options: { title: string; logicSource: 'minimized' | 'direct' })
  => { json: string; stats: CircuitverseStats }
// stats: { inputs, inverters, andGates, orGates, constants, wires, intermediates, maxDepth,
//          segments: { segment, andGates, orGates, constant: 0|1|null }[] }  // SEGMENT_NAMES order
```

## Dialog structure (top → bottom)
1. **Header** — "Export to CircuitVerse" (CircuitBoard icon) + description.
2. **Options** — Project title `Input` (h-11; defaults to `projectName` each open — `titleOverride` state reset on close; empty name → 'SevenSeg Decoder'); vertical `RadioGroup`, two full-row `<label>`-wrapped options (min-h-11, selected → `border-primary/60 bg-primary/5`): `minimized` ("Minimized (Quine-McCluskey)") and `direct` ("Direct SOP (canonical)") with the spec helper texts.
3. **Live gate-count preview** — `useMemo` on `[inputBits, engines, title, logicSource]` → `buildCircuitverseProject` in try/catch (failure → destructive `Alert`, download disabled). 6 tiles (`rounded-lg border bg-muted/40 p-4`, `grid-cols-2 sm:grid-cols-4 gap-4`): Inputs, AND gates, OR gates, NOT gates, Constants, Wires; below: logic-depth line (`maxDepth` gates + `intermediates` wire bends).
4. **Per-segment strip** — 8 flex-wrapped mono chips (`A · 2 AND · 1 OR`; `constant === 1` → emerald "always on"; `=== 0` → muted "always off"); `title` tooltips.
5. **Education panel** — muted card: GraduationCap (amber) "How to open in CircuitVerse", 3 numbered steps (download → circuitverse.org → File → Import, no account needed), then the live "Inside the file:" note substituting stats counts + `inputVarNames(inputBits)` (MSB → LSB).
6. **Footer** — outline Cancel (DialogClose) + default "Download .cv" (Download icon; Loader2 + "Building…" while busy).

## Download behavior
`downloadText(result.json, `${sanitizeFilename(title) || 'sevenseg'}-circuitverse.cv`, 'application/json')` from the memoized result (preview numbers === downloaded bytes). Success toast "CircuitVerse file downloaded / Import it at circuitverse.org → File → Import."; error toast mirrors ExportMenu `run()` style; **dialog stays open** for option tweaks + re-download; `busy` reset in `finally`.

## ExportMenu integration
New item AFTER "Verilog module" in the "Simulator exports" group: `CircuitBoard` icon, label "CircuitVerse circuit (.cv)", `onSelect={() => setCvOpen(true)}` (menu closes, dialog opens — no direct download). Component return wrapped in a fragment rendering `<CircuitVerseExportDialog open={cvOpen} onOpenChange={setCvOpen} />`.

## Verification
- `bun run lint` → exit 0 (clean).
- `bunx tsc --noEmit` → zero errors in both touched files (only pre-existing errors elsewhere, untouched).
- dev.log after edits: `✓ Compiled` + `GET / 200`, no errors.
- Engine sanity (bun script, deleted after): default BCD (decimal/dontcare) **minimized** = 4 inputs / 16 AND / 7 OR / 3 NOT / 1 constant (DP always off) / 134 wires / depth 3; **direct** = 49 AND / 9 OR / 4 NOT / 512 wires / depth 4 → switching the radio visibly grows counts. 4-bit blank-behavior and 5-bit hex (35 AND min vs 78 direct) also verified.

## Design constraints honored
Responsive (`sm:max-w-lg`, scroll region `max-h-[70vh] custom-scroll min-h-0` inside `flex max-h-[calc(100dvh-2rem)] flex-col` DialogContent); all interactive elements ≥44px; icons `aria-hidden`; DialogTitle/DialogDescription + label-wrapped radios for a11y; shadcn tokens + amber/emerald accents only (no indigo/blue); no emoji; no changes to page layout, footer, or any other component.
