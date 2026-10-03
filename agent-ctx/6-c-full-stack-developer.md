# Task 6-c — full-stack-developer (P3 UX/a11y/cleanup batch, components layer)

Scope owned: src/app/** (error.tsx, globals.css), src/components/simulator/**, src/utils/exporters.ts, src/lib/colors.ts, src/hooks/** (untouched). Did NOT touch 6-d's files (src/logic/**, next.config.ts, tsconfig.json, scripts/**, package.json) or store.ts.

## Changes per file

1. **src/app/error.tsx (NEW)** — route-level client error boundary: destructive icon card, readable error.message box, mono `digest:` line when present, "Try again" (reset()) + "Reload page" (location.reload) buttons, shadcn tokens, min-h-screen centered, no indigo/blue.

2. **src/components/simulator/ProjectManagerCard.tsx** —
   - Delete now requires AlertDialog confirmation (`deleteTarget` state, destructive-styled AlertDialogAction via `buttonVariants({ variant: 'destructive' })`). Cancel = pure no-op (state untouched, verified).
   - Per-row busy gating: `rowBusy: Record<id, 'duplicate' | 'delete'>` + **`rowBusyRef: Set<string>` synchronous mirror**. IMPORTANT: the ref is required — the state-only guard was empirically beaten by a programmatic double click (two clicks dispatched in one task before React commits the disabled attribute → two POSTs). With the ref, a triple-click produces exactly ONE POST. markRowBusy/clearRowBusy update both.
   - Row buttons: Load/Duplicate/Delete disable for the whole row while any row op is in flight; the running op's button swaps its icon for a spinning Loader2. Unrelated rows stay usable (per-row, not global). handleDuplicate/handleDelete no longer touch the global `busy` flag (refresh/persistCurrent still do).
   - DELETE is still 204-no-body/res.ok only; ownerHeaders on every fetch; corrupt rows keep Load/Duplicate disabled + Delete enabled (6-a contract preserved).

3. **src/components/simulator/PresetGalleryDialog.tsx** — user-preset delete now requires AlertDialog confirmation (nested inside the gallery Dialog — works fine with Radix). `deleteTarget: { kind, id, name }` state; Cancel = no-op; confirm → deleteUserPreset + toast (204 path via store).

4. **src/components/simulator/ExportMenu.tsx** — rewrote busy UX using the "keep menu open" option: dropdown is now CONTROLLED (`open`/`onOpenChange`), every export item switched from onClick to `onSelect` with `e.preventDefault()` (menu stays open while the export runs), the running item shows an in-menu Loader2, ALL items get `disabled` while busy, the trigger swaps Download→spinning Loader2 while busy, and `run()` closes the menu programmatically (`setOpen(false)`) in its finally. Re-entry guarded (`if (busy !== null) return`). Success/error toasts unchanged. CircuitVerse item closes the menu normally (opens the dialog) but is disabled during a run. Shared `exportItem(kind, fn)` helper builds item props.

5. **src/components/simulator/TruthTableCard.tsx** — keyboard a11y, memo discipline preserved:
   - TruthRow: `tabIndex={0}`, focus ring (`focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`), `aria-keyshortcuts="Enter Space c v"`, richer aria-label, new `onRowKeyDown` prop (STABLE useCallback from parent — extend that handler block for any future row key features).
   - Parent `handleRowKeyDown` (useCallback, deps [table, inputBits, setInput, setRowPattern]): guard `e.target !== e.currentTarget` (segment buttons handle their own keys — verified: 'c' on a focused inner button does nothing), Enter/Space → select, 'c'/'C' → copy row outputs to `rowClipboardRef` (useRef, no re-render) + confirm toast, 'v'/'V' → paste via the exact drag-path apply logic (`setRowPattern` + identical "Pattern copied" toast wording); 'v' with empty clipboard → "Nothing to paste" toast.
   - Help paragraph below the table gained a visible keyboard hint (kbd-styled Tab/Enter/C/V).

6. **src/components/simulator/KarnaughMapCard.tsx** —
   - role="grid" now has the valid structure: `role="grid"` (aria-label kept) > `role="row"` (absolute flex wrappers at `top: r*CELL`) > `role="gridcell"` (relative CELL×CELL) > the interactive buttons (now `absolute inset-0` filling their gridcell — z-index/focus-ring/current-ring/uncovered-pulse behavior identical). Group overlay layer got `aria-hidden` (decorative).
   - Palette dedup: local GROUP_PALETTE + hexToRgba deleted; imports `groupColor, hexToRgba` from '@/lib/colors'; call sites use `groupColor(g.colorIndex)`.

7. **src/components/simulator/SevenSegmentDisplay.tsx** — local hexToRgba removed (was byte-identical to colors.ts incl. the red fallback); imports from '@/lib/colors'.

8. **src/utils/exporters.ts** — local GROUP_PALETTE + hexToRgb deleted; imports `groupColor, hexToRgb01` from '@/lib/colors' (hexToRgb01 was already there — nothing needed adding to colors.ts); `void idx;` dead statement removed and `(seg, idx)` → `(seg)`.

9. **src/components/simulator/LogicCircuitCard.tsx** — dead code: `onWheel={undefined}` removed; identical-branch ternary `const toH = to.type === 'out' ? to.h : to.h;` removed (inlined `to.h` into the py computation).

10. **src/components/simulator/BooleanExpressionsCard.tsx** — identical-branch ternary around `<TermView literals={t.literals} op="·" />` simplified to the single element.

11. **src/components/simulator/AppHeader.tsx** — duplicate displayMode selector removed (`displayModeLabel` deleted; the lg-only status line uses `displayMode`); the amber "modified" dot converted from aria-label-on-span (invalid: non-interactive) to `aria-hidden` (the parent button's aria-label + the visible "modified" Badge already carry the state).

12. **src/app/globals.css** — prefers-reduced-motion block now also kills `.animate-pulse` (compiled rule verified in-browser: `.wire-active, .animate-pulse { animation: auto ease 0s 1 normal none running none; }`).

## Verification (dedicated agent-browser session "6c")

- lint: exit 0. tsc --noEmit: **0 errors total** (src + everything).
- Page loads, zero console/page errors (console shows only HMR/Fast-Refresh).
- Truth-table keyboard: rows focusable (16/16 have tabIndex), Enter selects, Space selects, c → "Outputs copied" toast, v on m5 → m5 outputs became m2's (inputs stayed 0101), "re-apply preset" appears (modified=true) and re-apply restores BCD (modified=false). 'c' on a focused inner segment button correctly does nothing (guard).
- K-map: grid renders as role=grid > 4 role=row > 16 role=gridcell > 16 buttons; group overlay colors byte-identical: rgb(245,158,11)=#f59e0b, rgb(16,185,129)=#10b981, rgb(244,63,94)=#f43f5e, rgb(168,85,247)=#a855f7; legend swatches match overlays exactly; cell clicks cycle 1→X→0→1 through the new gridcell structure.
- Projects: Create → 201; delete click → AlertDialog (title/desc/buttons correct); Cancel → dialog closed, row intact, NO request; Confirm → DELETE 204, row gone; duplicate mid-flight: whole row disabled + spinners (verified at 25ms); triple-click duplicate → exactly ONE copy (ref guard; the pre-fix state-only guard DID double-fire under programmatic double-click — fixed and re-verified); all 4 test rows deleted via UI, DB left at 0 projects, list refresh stayed single-query (no N+1 regression).
- Presets: saved "6c-del-test" → nested AlertDialog on delete; Cancel no-op; Confirm → 204 + removed.
- ExportMenu: menu STAYS OPEN during a slowed PNG export (canvas.toBlob patched to 2.5s) — mid-flight: menuOpen=true, 10/10 items data-disabled, "Display PNG" item shows in-menu spinner, trigger disabled + spinner; on completion menu closes programmatically, trigger re-enabled; error path verified (E-232 "Export failed" toast via wait --text) and success path verified ("Export complete — CSV truth table downloaded." toast). Instant exports just close the menu as before.
- dev.log: only expected 200/201/204s from my tests; no errors, no 500s.
- error.tsx: verified by compilation + types only (rendered only on runtime render errors; no safe way to induce one in the live page without code edits).

## Notes / gotchas for future agents

- The programmatic double-click finding is general: **React state guards cannot prevent same-task double dispatch**; use a ref mirror for any double-submit protection. Buttons' `disabled` only helps across real, separate event-loop tasks.
- Radix DropdownMenuTrigger does NOT open on synthetic `el.click()` — use native clicks (agent-browser `find role button click`) or keyboard.
- shadcn toasts here render with `role="status"` (NOT `data-slot="toast"` — that selector silently returns empty; several of my early toast checks were false negatives because of it). TOAST_LIMIT=1 (new toast replaces old); effective on-screen duration ≈ 5s (radix default) despite TOAST_REMOVE_DELAY=1e6 in the hook.
- Projects tab content is unmounted unless the tab is active (Radix) — don't eval the project list right after a reload without clicking the tab first.
- The sticky header covers the tablist when scrolled; `window.scrollTo(0,0)` before clicking tabs (6-a's note, still true).
