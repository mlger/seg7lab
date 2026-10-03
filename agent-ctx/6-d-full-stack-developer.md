# Task 6-d — full-stack-developer (P3 hygiene batch: logic layer + toolchain strictness + verification script)

Date: 2026-02 (wave 2, parallel with 6-c which owns components/app/exporters/hooks)

## Scope honored
Owned files only: src/logic/**, src/utils/binary.ts, src/types/** (untouched — no change needed),
next.config.ts, tsconfig.json, scripts/**, package.json (script lines only).
NOT touched: src/components/**, src/app/**, src/utils/exporters.ts, src/hooks/**, store.ts, api routes, prisma, db.

## 1. Dead-export purge (src/logic/** + src/utils/binary.ts)
Re-verified every symbol at execution time with a project-wide grep (all *.ts/tsx under the whole
repo incl. scripts/ and examples/): every one of the 14 still-present symbols appeared ONLY at its
own definition line — zero consumers anywhere (3-a research list still accurate; agents 6-a/6-b
added none). scripts/verify-circuitverse.ts uses NONE of them (no import fix needed).

Purged (with zero-consumer evidence = the project-wide grep above):
- truthTable.ts: matchesPreset (matchesTablePreset KEPT — live via src/lib/useEngine.ts)
- font.ts: fontIndexOf
- presets.ts: glyphPatternByChar (+ trimmed now-unused fontPattern import)
- kmap.ts: isValidGroupSize
- utils/binary.ts: varWeight
- booleanParser.ts: collectVars, astGateCount, parserVarNames (+ removed orphaned InputWidth import)
- expressions.ts: sigmaNotation, piNotation, dontCareNotation, expressionVarNames
  (the "sigma/pi" of the research = sigmaNotation/piNotation; + removed orphaned InputWidth import)
- decoder.ts: decodeRow, bitOf (+ removed orphaned getRow import + Bit/SegmentPatternX/TruthTable
  type imports — all were only used by the two dead functions)
No private helper became orphaned; nothing with a live consumer was deleted.

## 2. tsconfig.json
exclude: added "examples" and "skills" (platform reference scaffolding with missing deps —
socket.io etc. — permanent tsc errors). Result: `bunx tsc --noEmit` exits 0 with ZERO errors
repo-wide (was: 4 permanent errors in examples/websocket + skills/{image-edit,stock-analysis}).

## 3. next.config.ts
- typescript.ignoreBuildErrors: true → false (repo is tsc-clean; errors must fail builds honestly)
- reactStrictMode: false → true
Observed dev.log after the running server restarted on the change: exactly ONE
GET /api/presets?full=1 per page load (6-b's presetSyncInFlight dedup + idempotent attach absorb
the StrictMode double-mount), no duplicate server rows, no double-POST noise, page / 200.
=> reactStrictMode: true KEPT (no breakage observed; no revert needed).
(The POST/DELETE /api/projects pairs in the log window were the parallel 6-c agent's own browser
testing on the shared dev server — not from my dedicated 6d session, which only read/exported.)

## 4. scripts/verify-logic.ts (NEW, permanent) + package.json "verify:logic"
`bun run scripts/verify-logic.ts` / `bun run verify:logic` — 283 checks, exit 0, non-zero on any
failure, clear PASS/FAIL lines. Sections:
1. booleanParser astToAscii round-trip: exact-output pins for the P0 fix (!(A·B) → "(AB)'" —
   see Deviations), nested NOT over OR/XOR, multi-literal products, constant cases; 24-expression
   corpus parse → print → reparse → eval-equivalence over ALL 16 input combos each.
2. Multi-char variable names (W1/X2/Ab, ≤3 chars): 5 expressions × 32-input eval equivalence;
   semantic pins (W1X2 + !W1); "AB" resolves as a variable when named AB, as A·B otherwise;
   single-letter fallback intact; junk (Q9, AQ, W9) still parse-errors with "Unknown variable".
3. Minimizer: BCD segment A — ones=[0,2,3,5,6,7,8,9] pin, cover = textbook 4 terms / 6 literals,
   exact===true, uncovered=0, every one-minterm inside a cover implicant's implicantMinterms set,
   cover ⊆ primes; all 8 segments (A–G + DP) exact + fully covered (DP = constant-0 path);
   all-ones → 1 term / 0 literals.
4. MinimizeResult.exact: type-level proof (function reading .exact off MinimizeResult) + runtime
   boolean present-and-true on every normal run (greedy path unreachable ≤5 vars, as expected).
5. circuitverse: all four builds succeed — default names × {minimized, direct}, custom
   ['W','X','Y','Z'] × {direct (the E-242 regression: engines carry default names, builder must
   thread options.varNames), minimized (custom-named engines), direct (custom engines)}; stats
   pinned to 6-a's browser-verified values: minimized 4/16/7/3/1/134/depth 3, direct 49 AND /
   9 OR / 512 wires; renames produce identical counts; custom labels W,X,Y,Z present in the JSON.
6. presets: validateLibraryTablePreset/FontPreset preserve a 2024-01-01T00:00:00.000Z
   createdAt/updatedAt stamp pair (P0 data-loss guard for the store's merge-by-updatedAt sync);
   id/name/glyphs preserved; junk + non-user: ids → null.
7. kmap: 4-bit minterm = grayRow·4 + grayCol bijection 0..15, rowVars/colVars/planeVar per the
   documented convention (A B / C D / null), custom-name variant; 5-bit minterm =
   plane·16 + grayRow·4 + grayCol bijection 0..31 (planeVar A, rows B C, cols D E); getValue
   plumbed to the right minterms; gray labels 00/01/11/10.
8. decoder isSegmentLit: full 8-row polarity matrix (output 0/1 × commonAnode × reverseLogic),
   'X' never lights (4 combos), digit-8 known pattern under all 4 setting combos.
9. validateProject: positive control (default project ok, 16 rows); slightly-off blob (17 rows +
   invalid segment value 2 on row 0) → ok=false, E-210 + E-211 reported, canonical table returned
   (16 rows, extra row dropped, invalid value → 0, positional reindex 0..15, name preserved).

## Verification (all green)
- `bun run lint` exit 0.
- `bunx tsc --noEmit` exit 0 — ZERO errors anywhere (first time repo-wide).
- `bun run verify:logic` → 283 checks passed, 0 failed, exit 0.
- `bun run scripts/verify-circuitverse.ts` (untouched) → 30893 checks across 9 cases ALL PASS,
  exit 0.
- agent-browser DEDICATED --session 6d: / renders (title ok), zero page/console errors, all 6
  tabs activate (Truth Table default; K-Map/Circuit/Characters/Projects clicked through),
  Expressions tab renders (segment A heading shows the 4T·6L textbook result); custom expression
  "!(AB) + C'D" typed + Verify → precise E-221 diff (m1, m4) — parser live end-to-end; Export
  menu → CircuitVerse dialog → Download .cv → 50,642-byte blob captured via URL.createObjectURL
  patch. Session closed cleanly.
- dev.log tail clean (see §3 for the reactStrictMode observation).

## Deviations (all deliberate)
1. The task brief said !(A·B) must print "(A·B)'" — the actual P0-fixed output is "(AB)'": ASCII
   notation prints AND as juxtaposition (astToAscii's 'and' case joins with '' — "·" is not
   ASCII). The P0 fix is the PARENTHESIZATION of the compound operand (old bug printed "AB'",
   i.e. NOT over the last literal). verify-logic pins the real fixed forms
   ("(AB)'", "(A + B)'", "(A ^ B)'", "((AB) + (CD))'").
2. First run had 1 failing check of my own making: I assumed "Abc" (uppercased ABC) is junk under
   default vars — the greedy tokenizer legitimately reads it as A·B·C juxtaposition. Replaced the
   junk cases with genuinely-unknown names (Q9, AQ, W9) and added a juxtaposition pin for "Abc".
3. "sigma, pi" from the 3-a list = sigmaNotation/piNotation (named functions, not bare sigma/pi).

## Notes for Wave-3
- verify-logic.ts pins CircuitVerse structure counts (16 AND/7 OR/3 NOT/1 const/134 wires/depth 3
  minimized; 49/9/512 direct). If you intentionally change the builder's gate structure, update
  the pins IN THE SAME CHANGE and say so in the worklog — a failing pin means an accidental
  structural regression until proven otherwise.
- examples/ + skills/ are now tsconfig-excluded platform scaffolding; never import them from
  src/ (tsc would catch it, but don't).
- reactStrictMode: true is LIVE: every new effect must be StrictMode-safe (double-invoked in
  dev). Follow 6-b's patterns: module-level once-guards for attach, in-flight promise dedup for
  syncs, idempotent server writes. If you ever see duplicate server rows/double POSTs, fix the
  effect — do not flip reactStrictMode back off.
- Dead-export purge is complete for the logic layer; if you add a logic-layer export, consume it
  from src/ or scripts/ immediately — dead exports now get purged by hygiene waves.
- Bun resolves @/ imports in scripts/ (tsconfig paths) — plain `bun run scripts/<x>.ts` works;
  keep verification scripts tsc-clean (they are inside the tsconfig include).
