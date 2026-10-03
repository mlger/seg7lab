# Task 6-b — Client contract completion (src/lib/store.ts)

Owner: full-stack-developer (this agent). Files OWNED and modified: `src/lib/store.ts`.
Out-of-scope one-line fix (required to unblock): `src/lib/client-owner.ts` — see "Incident" below.
Read-only: worklog.md, src/app/api/**, src/logic/presets.ts, src/types/*, src/lib/client-owner.ts, page.tsx.

## Incident: client-owner.ts had a syntax-breaking comment

The orchestrator's fresh `src/lib/client-owner.ts` contained `src/app/api/*/helpers.ts` inside its
JSDoc header — the `*/` in `api/*/` TERMINATED the block comment early, so lines 10-12 became raw
code → `tsc` failed with 12 syntax errors (TS1127/TS1128/TS1434...) on an UNTOUCHED baseline.
Any import of that file (my store imports it) would have broken the whole app. Fixed by rewording
the comment to name both helper files explicitly (no behavior change). Baseline tsc was clean after
this fix and before any store.ts edit.

## What changed in store.ts (per contract area)

### 1. Owner headers everywhere
`ownerHeaders()` merged into ALL 5 preset fetches: POST (create), PUT (update — new helper),
409-recovery GET, DELETE, and the `?full=1` sync GET. Verified in dev.log: list queries now use
`WHERE (ownerId IS NULL OR ownerId = ?)` and POSTed rows carry `ownerId = <token>`.

### 2. Optimistic locking on PUT + 409 recovery
- New module map `serverUpdatedAt: Map<id, rowUpdatedAt>` — the optimistic-lock tokens, populated
  from every POST 201 / PUT 200 / GET (sync + conflict recovery) response.
- `apiUpsertPreset` → POST; on 409 → `apiPutPreset(def, kind, serverUpdatedAt.get(id) ?? def.updatedAt)`.
  The map token is exact ("last-seen server row version"); the def stamp is the fallback when this
  browser never saw the row (a guaranteed 409 → recovery, which is the task-specified behavior).
  When BOTH are absent the token is OMITTED (empty string would be a guaranteed 409; omission =
  legacy unconditional write).
- `apiPutPreset` sends `{ name, data, expectedUpdatedAt? }`; on 200 records the returned row's
  updatedAt (chains the next lock). On 409 (first time) → `reconcilePresetConflict`.
- **409 merge policy (exact)**: GET the fresh row → record its updatedAt token →
  (a) row corrupt/`data:null`/fails validation → never import; warn once; REPAIR the row from the
  local good copy via one token-guarded PUT (no further recovery on that attempt);
  (b) valid server copy → re-run the SAME merge-by-updatedAt policy as sync (pure helper
  `mergePresetIntoList`: server replaces local iff `local.updatedAt < server.updatedAt` AND content
  differs) → if changed, adopt server (setState + persistLibrary) and STOP;
  (c) not changed (local newer or identical) → keep local AND re-push once with the fresh token so
  the newer local edit also wins server-side. A second consecutive 409 warns and keeps local.
  Never destroys the newer side silently; every step console.warns.

### 3. Corrupt blob flag in syncPresetsFromServer
Rows with `corrupt === true || data == null` are skipped entirely: never imported, never overwrite
a good local preset; `warnServerIssue` logs once per row id per page load (Set). Rows whose blob
parses but fails validateLibrary* get the same protective skip (legacy pre-hardening rows).
Corrupt rows still count as `seen` (no push-up attempt during background syncs) and still seed the
optimistic-lock map — so the row is repaired the next time the user edits that preset locally
(apiUpsertPreset → POST 409 → PUT with the remembered token).

### 4. Sync triggers beyond mount (in attachPersistence, idempotent)
- window `focus` → debounced (2000 ms) `syncPresetsFromServer`.
- window `storage` where `event.key === 'sevenseg-presets-v1'` (PRESET_LIB_KEY) → same debounce
  (multi-tab coordination; storage fires only in OTHER tabs).
- Module flag `syncTriggersAttached` prevents double-attachment; listeners intentionally live for
  the page lifetime (no detach path — the app shell never unmounts; the returned cleanup still only
  unsubscribes the persist subscription, exactly as before).
- `syncPresetsFromServer` itself now dedups concurrent runs via `presetSyncInFlight` (mount sync +
  focus trigger overlapping returns the same in-flight promise instead of double-pushing).
- All registration is inside the window-guarded attachPersistence → never runs during SSR.
- Verified: 4 rapid focus events → exactly ONE GET; mount sync unchanged.

### 5. Charset + shape alignment (audit of every preset push)
- `newUserId()` (`user:<uuid>`) and every import/duplicate path already satisfy
  `^user:[A-Za-z0-9_-]{1,94}$`; parsePresetFile generates fresh ids and slices names to ≤100.
- Safety net: `apiUpsertPreset`/`apiPutPreset` pre-check the id charset and name (1..100 trimmed)
  client-side; violators (e.g. legacy slash ids that the API would 400) stay local-only, warned
  once — no network spam on every sync.
- POST body `{ id, kind, name, data }` with `data = def` (embedded id always matches body id).
  PUT body `{ name, data, expectedUpdatedAt? }` — the exact shape the hardened API validates.

### 6. DELETE 204
`deleteUserPreset`'s DELETE now sends owner headers, treats success via `res.ok` (204 has NO body —
nothing ever calls res.json on it), deletes the optimistic-lock token, and warns once on unexpected
statuses (403/404 are the benign "not ours / already gone" cases). URL uses encodeURIComponent.

## Also fixed in passing
- Sync GET now carries owner headers (previously anonymous → owned rows invisible).
- The old inline duplicated merge logic in syncPresetsFromServer was extracted into the pure
  `mergePresetIntoList` helper shared with the 409 path (identical semantics, incl. the
  def.updatedAt-then-row.updatedAt fallback and the JSON.stringify content-difference guard).

## Deliberately NOT changed (constraints)
- localStorage keys/format (`sevenseg-workspace-v1`, `sevenseg-presets-v1`), `hydrated` flag,
  presetLibrary shape, all store action signatures — components (6-a) are unaffected.
- No toasts added (toast infra lives in components/hooks, not the store). Conflict/corrupt events
  surface via console.warn + data-level recovery. TODO for a later agent: optionally toast on
  409-merge outcomes (a small subscribe or explicit callback would be needed).
- Offline DELETE + later online sync still re-imports the server row (resurrection) — pre-existing
  behavior, needs tombstones (localStorage format change) → out of scope, noted for the orchestrator.

## Verification (all green)
- `bun run lint` exit 0; `bunx tsc --noEmit` zero errors for src/** (examples/skills excluded).
- agent-browser E2E on :3000: page renders; gallery opens; created "6b Sync Test Preset" via UI →
  POST 201 (row stored with our ownerId); renamed → POST 409 → PUT 200 (chained lock, no spurious
  409); reload → preset survived (no offline data-loss regression); DB-injected corrupt row →
  skipped + warned exactly once per page load, never imported into localStorage; forced 409 with
  newer server copy (2030 stamp) → server copy adopted locally; forced 409 with stale server copy
  (2020 stamp) → local kept + re-pushed (server row updated to the local name); UI delete →
  DELETE 204, gallery back to 8 presets; anon list 200 []. All test rows cleaned up (DB has 0
  preset rows). dev.log: only 200/201/204/409 — the four 500s were MY intentional malformed test
  row (P2023, TEXT datetimes); the client tolerated them gracefully (silent return, no crash).
  NOTE for anyone injecting test rows via raw SQL: Prisma 6 SQLite stores DateTime as INTEGER ms —
  TEXT timestamps make every findMany on the table 500 with P2023.
