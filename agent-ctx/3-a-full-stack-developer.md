# Task 3-a — full-stack-developer: API layer hardening (implementation)

Predecessor research: 3-b (API/data layer), 3-c (UI), 3-a-research (logic layer) reports in worklog.md Tasks 3-a/3-b/3-c; P0 fixes (owner.ts, types/api.ts, presets.ts timestamp preservation) already in place.

## Files changed (owned)
- `prisma/schema.prisma` — dropped scaffold User/Post models; Project + Preset gained `ownerId String?` (null = shared/legacy) + `@@index([updatedAt])` + `@@index([ownerId])`. `bun run db:push` run; SQLite verified: only Project/Preset tables remain, 4 new indexes live.
- `src/app/api/projects/helpers.ts` — full rewrite (transport plumbing + project validators).
- `src/app/api/projects/route.ts` — full rewrite (paginated/filtered list + hardened POST).
- `src/app/api/projects/[id]/route.ts` — full rewrite (ownership read rule, optimistic-lock PUT, 204 DELETE).
- `src/app/api/presets/helpers.ts` — full rewrite (same plumbing + preset validators, E-280).
- `src/app/api/presets/route.ts` — full rewrite.
- `src/app/api/presets/[id]/route.ts` — full rewrite.
- Ops only (byte-identical after): `next.config.ts` touched + git-restored (md5 verified) to reload the regenerated Prisma client in the running dev server — same workaround as Task 22-b.

NOT touched: src/lib/store.ts, src/lib/api.ts (parallel agent), src/components/**, src/logic/** (imports only), src/types/**, src/lib/db.ts, src/lib/owner.ts.

## Final API contract as implemented

### Shared conventions (both /api/projects and /api/presets)
- Owner identity: header `x-sevenseg-owner`, must match `^[a-f0-9-]{8,64}$` (same regex as src/lib/owner.ts); absent/invalid → treated as anonymous.
- Body guard (all POST/PUT): Content-Type must be `application/json` (media type before `;`, charset suffix OK) → else **415** `{"error":"Content-Type must be application/json"}`; body text > 1,000,000 chars → **413** `{"error":"Payload too large (max 1 MB)"}`; JSON.parse fail → **400** `{"error":"Invalid JSON"}`; non-object/array root → **400** `{"error":"Request body must be a JSON object."}`.
- Error envelope: `{"error": string, "errors"?: string[]}`; unexpected errors → **500** `{"error":"Internal server error"}` (console.error logged, no stack leakage).
- Row serialization (`toPayload`, renamed from serializeProject/serializePreset to avoid the logic/project.ts export collision): `createdAt`/`updatedAt` are **ISO strings** (never Date objects); `ownerId: string|null` always present; full mode adds `data` (parsed JSON or null) + `corrupt: boolean` (true iff stored blob fails JSON.parse → 200, not 500).
- Ownership model: `ownerId = null` = shared/legacy row → readable+writable by everyone; owned rows visible only to the matching owner.

### GET /api/projects (+ /api/presets) — list
- Query: `full` (`1` or `true` = include data), `limit` (int, default 100, clamp 1..200), `offset` (int, default 0, min 0).
- Filter: `OR: [{ownerId: null}, ...(owner ? [{ownerId: owner}] : [])]` — anonymous sees shared only; owner sees shared + own.
- orderBy updatedAt desc, take/skip. Slim mode selects WITHOUT the data column.
- 200 → array of rows: `{id, name, inputBits}` (projects) / `{id, kind, name}` (presets) + `{createdAt, updatedAt, ownerId}` (+ `data, corrupt` when full).

### POST /api/projects
- Body: `{name: 1..100 chars (required), inputBits: 4|5 (required), data: object (required), id?: ^[A-Za-z0-9_-]{8,64}$ (optional, offline push-up)}`.
- `data` validated server-side via `validateProject` → **400** `{"error":"Invalid project data","errors":[E-2xx...]}`; stored blob = `JSON.stringify(result.data)` (canonicalized).
- `ownerId` from header (null if absent). Client-id conflict (P2002) → **409** `{"error":"id already exists"}`.
- **201** full row.

### POST /api/presets
- Body: `{id: ^user:[A-Za-z0-9_-]{1,94}$ (required), kind: 'table'|'font' (required), name: 1..100, data: object (required)}`.
- `data` validated via `validateLibraryTablePreset`/`validateLibraryFontPreset` (canonical form, stored createdAt/updatedAt preserved) → null → **400** `{"error":"Invalid preset data","errors":["E-280: preset data failed validation"]}`; `def.id !== body.id` → **400** `{"error":"id mismatch between body and data"}`.
- Duplicate id (pre-check or P2002 race) → **409** `{"error":"preset id already exists"}`. **201** full row.

### GET /api/{projects|presets}/[id]
- Full row; missing → **404**; owned by someone else → **404** (existence-leak avoidance). 200 full row.

### PUT /api/{projects|presets}/[id]
- Body: `{name?, inputBits? (projects only), data?, expectedUpdatedAt?: ISO string}`.
- Error precedence (contract order): **404** missing → **403** `{"error":"not your row"}` (row.ownerId != null && != header owner) → **409** `{"error":"conflict","currentUpdatedAt":<row ISO>}` (expectedUpdatedAt mismatch) → **400** invalid fields (data validated same as POST; preset data validated against the stored row's kind and embedded def.id must equal row id) → **404** P2025 (concurrent delete).
- Empty update (no recognized fields) = no-op returning current row (200).
- **200** full row (client chains optimistic locks on the returned updatedAt).

### DELETE /api/{projects|presets}/[id]
- Missing → **404**; ownership violation → **403**; success → **204 no body** (CHANGED from old `{success:true}`); P2025 → 404.

## Curl verification (all against running dev :3000, full matrix PASSED)
- POST project `{garbage:1}` data → 400 + E-202/203/204/205/208 errors ✓
- POST valid project (canonical buildDefaultProject→validateProject) with owner header → 201, ownerId stored, ISO timestamps, data object ✓
- POST with `Content-Type: text/plain` → 415 ✓ ; with `application/json; charset=utf-8` → accepted ✓
- POST client id `offline-pushup-test-01` → 201 (id honored, ownerId null) ✓ ; duplicate → 409 `id already exists` ✓ ; id `"bad id!"` → 400 ✓
- PUT wrong expectedUpdatedAt → 409 `{"error":"conflict","currentUpdatedAt":...}` ✓ ; with current → 200, updatedAt bumped, full row returned ✓
- PUT/DELETE/GET single owned by other owner header → 403 / 403 / 404 ✓ ; own GET → 200 ✓
- List: anonymous → shared only (1 row) ✓ ; owner A → shared+own (2 rows) ✓ ; owner B → shared only ✓ ; invalid owner header → anonymous behavior ✓
- POST preset id `user:a/b` → 400 (charset) ✓ ; id/body-data mismatch → 400 `id mismatch between body and data` ✓ ; invalid data → 400 E-280 ✓ ; duplicate → 409 ✓ ; valid table preset → 201 (fixture timestamps 2024-01-01 PRESERVED in stored blob) ✓ ; font preset → 201 ✓
- PUT preset stale lock → 409 ✓ ; data-only PUT invalid → 400 E-280 ✓ ; other owner → 403 ✓
- Oversized body (1,100,047 bytes) → 413 ✓
- Pagination `?limit=1&offset=0` / `offset=1` → correct single-row pages, updatedAt desc order ✓
- Corrupt blob (direct DB insert `'{not valid json!!'`) → GET 200 `{data:null, corrupt:true}`, list full mode same ✓ (no more data:null-hidden-as-200 without flag)
- Invalid JSON → 400 `Invalid JSON` ✓ ; array body → 400 ✓ ; blank name / 101-char name / inputBits 3 → 400 ✓ ; missing id GET/PUT/DELETE → 404 ✓
- DELETE own + shared rows → 204 with 0-byte body ✓
- Cleanup: all test rows deleted; both lists `[]` for anonymous AND owner A ✓
- dev.log: zero 500s / zero runtime errors across the whole run; page `/` still 200.
- `bun run lint` clean; `bunx tsc --noEmit`: ZERO errors in src/app/api/** + prisma (29 pre-existing errors elsewhere — components/logic/store/examples — owned by other agents).

## Deviations / decisions (documented for orchestrator)
1. Shared helpers (ownerFromRequest, readJsonBody, jsonError, pagination) are DUPLICATED in projects/helpers.ts and presets/helpers.ts instead of a new shared module — keeps the enumerated owned-file list intact and mirrors the existing per-folder helpers convention (Tasks 2-a/22-b). Both copies documented as intentional mirrors.
2. PUT error precedence implemented in the literal contract bullet order (404→403→409→400) via a `readExpectedUpdatedAt` peek helper, so a request with both a stale lock AND invalid fields returns 409 (validation runs after the lock check).
3. `full` query param accepts `1` or `true` (old behavior preserved; contract names only `1`).
4. Preset PUT data validation uses the stored ROW's kind (body has no kind) and requires embedded `def.id === row id` — the PUT analogue of POST's id-match rule ("same as POST").
5. `corrupt` is present (boolean, true/false) on full rows only; slim rows have neither `data` nor `corrupt`.
6. DELETE now returns 204 no body (was `{success:true}`) — src/lib/api.ts must treat `res.ok` as success.
7. Body `data` must be a JSON object on POST/PUT both resources (old projects route also accepted pre-encoded JSON strings — dropped per contract).
8. Manual validators kept (codebase convention; zod still unused).
