# Task 22-b — full-stack-developer (subagent): Preset library REST API backend

## Scope
Backend only: Prisma `Preset` model, `/api/presets` REST endpoints. Did NOT touch page.tsx / layout.tsx / components / store / logic / types / utils (owned by other agents). Mirrors the /api/projects conventions from Task 2-a exactly.

## Files created/modified
- `prisma/schema.prisma` — added `Preset` model (User/Post/Project untouched). Ran `bun run db:push` (schema in sync, client regenerated).
  - `id String @id` — **client-supplied**, must start with `"user:"` (no cuid default)
  - `kind String` — `"table"` | `"font"`; `name String`; `data String` (JSON blob); `createdAt`/`updatedAt`.
- `src/app/api/presets/helpers.ts` (NEW):
  - `validatePresetCreate(body)` → id (required non-empty string ≤100 chars, MUST start with `"user:"` else 400 `"id must start with 'user:'"`), kind (`"table"`|`"font"`), name (non-empty trimmed ≤100), data (JSON object OR valid JSON string containing an object — string parsed first, stored canonically; arrays/primitives rejected).
  - `validatePresetUpdate(body)` → partial `name` and/or `data` only (id/kind immutable, ignored).
  - `serializePreset(row)` → parses stored `data` JSON string back into an object.
  - `jsonError(message, 400|404|409|500)` → uniform `{error}` responses.
- `src/app/api/presets/route.ts` (NEW) — `export const dynamic = 'force-dynamic'`
  - GET: list `{id,kind,name,createdAt,updatedAt}` (no `data`), updatedAt desc. `?full=1` (or `true`) includes parsed `data`.
  - POST: full validation → 201 with created preset incl. parsed `data`; duplicate id → 409 `{error:"preset id already exists"}` (findUnique pre-check + P2002 race guard).
- `src/app/api/presets/[id]/route.ts` (NEW) — `dynamic = 'force-dynamic'`; `params` awaited as `Promise` (Next 15+ convention, copied from projects/[id])
  - GET: preset with parsed data, 404 `{error}` if missing.
  - PUT: partial update (name and/or data; same validation); empty update = no-op returning current row; 404 if missing.
  - DELETE: `{success:true}` or 404 (deleteMany + count check).
- All handlers try/catch → 500 `{error}`. Uses `db` from `@/lib/db`.
- Ops note: the running dev server held a stale `globalThis.prisma` singleton (pre-model-push) → `db.preset` was undefined → 500s. Fixed via Next dev's built-in restart by touching `next.config.ts` (comment added then removed; file restored to original). **Any agent adding a Prisma model must touch next.config.ts afterwards so the dev server reloads the regenerated client.**

## Curl test results (against running dev server :3000) — ALL PASSED
- POST `{id:"user:test-1",kind:"table",name:"Test",data:{generator:"literal",table:{inputBits:4,rows:[]}}}` → **201**, `data` round-trips as object ✓
- POST same id again → **409** `{"error":"preset id already exists"}` ✓
- GET `/api/presets` → list without `data`, newest-first ✓ ; `?full=1` → includes parsed `data` ✓
- PUT `{"name":"Test Renamed"}` → 200 (name updated, data preserved, updatedAt bumped) ✓ ; PUT `{"data":{...}}` data-only → 200 ✓
- GET `/api/presets/user:test-1` → 200 ✓ ; GET `/api/presets/user:missing` → 404 ✓ ; PUT/DELETE missing id → 404 ✓
- Invalid POSTs → 400: id `"test-1"` → `"id must start with 'user:'"` ✓ ; kind `"bogus"` ✓ ; whitespace-only name ✓ ; data `"not-json"` ✓ ; PUT invalid data on existing → 400 ✓
- POST data as valid JSON string (`"{\"generator\":\"font\",\"glyphs\":{}}"`) → **201**, parsed back as object ✓
- DELETE → `{success:true}` ✓ ; GET after delete → 404 ✓
- **Cleanup: all test rows deleted; GET /api/presets → `[]`; direct DB check → 0 rows. Table left empty.**
- `bun run lint` → clean. dev.log clean (correct Preset SQL, no runtime errors).

## API contract for the frontend agent

### `GET /api/presets`
→ 200 `[{ "id", "kind", "name", "createdAt", "updatedAt" }]` (ISO strings, no `data`; ordered by `updatedAt` desc)
`GET /api/presets?full=1` → same + `"data"` (parsed object).

### `GET /api/presets/{id}`
→ 200 `{ "id", "kind", "name", "data": {...}, "createdAt", "updatedAt" }` | 404 `{ "error": "Preset not found." }`
(id in the URL path is the raw client id, e.g. `/api/presets/user:test-1` — colons are fine unencoded.)

### `POST /api/presets`
Body `{ "id", "kind", "name", "data" }` (all required; `data` may be an object or a JSON string containing an object).
→ 201 `{ id, kind, name, data: <parsed object>, createdAt, updatedAt }`
→ 400 `{ "error" }` (id not starting `"user:"` → `"id must start with 'user:'"`; kind not table/font; empty/whitespace or >100-char name; data not object/valid-JSON-object-string; malformed JSON body)
→ 409 `{ "error": "preset id already exists" }`

### `PUT /api/presets/{id}`
Body: any subset of `{ "name", "data" }` (id/kind immutable — ignored if sent; empty body `{}` = no-op returning current row).
→ 200 `{ id, kind, name, data: <parsed object>, createdAt, updatedAt }` | 400 `{ "error" }` | 404 `{ "error" }`

### `DELETE /api/presets/{id}`
→ 200 `{ "success": true }` | 404 `{ "error": "Preset not found." }`

All errors: `{ "error": string }` with status 400 (validation) / 404 (missing) / 409 (duplicate id) / 500 (server).
