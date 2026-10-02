# Task 2-a — full-stack-developer (subagent): Projects REST API backend

## Scope
Backend only: Prisma `Project` model, `/api/projects` REST endpoints. Did NOT touch page.tsx / layout.tsx / components / store / logic / types / utils (owned by other agents).

## Files created/modified
- `prisma/schema.prisma` — added `Project` model (kept existing User/Post models untouched). Ran `bun run db:push` (schema in sync, client regenerated).
- `src/app/api/projects/helpers.ts` (NEW) — shared validation + serialization:
  - `validateProjectFields(body, requireAll)` → validates name (non-empty, trimmed, ≤100 chars), inputBits (integer 4 or 5), data (object OR JSON string; string must parse). Returns normalized `{name?, inputBits?, data-as-JSON-string}`.
  - `serializeProject(project)` → parses stored `data` JSON string back to an object.
  - `jsonError(msg, 400|404|500)` → uniform `{error}` responses.
- `src/app/api/projects/route.ts` (NEW) — `export const dynamic = 'force-dynamic'`
  - GET: list `{id,name,inputBits,createdAt,updatedAt}` (no `data`), ordered by updatedAt desc. `?full=1` (or `true`) includes parsed `data`.
  - POST: full validation → 201 with created project incl. parsed `data`; 400 on invalid.
- `src/app/api/projects/[id]/route.ts` (NEW) — `export const dynamic = 'force-dynamic'`; params typed `{ params: Promise<{ id: string }> }` and awaited (Next.js 15+ convention)
  - GET: project with parsed data, 404 `{error}` if missing.
  - PUT: partial update (name and/or inputBits and/or data; same validation); empty update = no-op; 404 if missing.
  - DELETE: `{success:true}` or 404 (uses deleteMany + count check).
- All handlers try/catch → 500 `{error}`. Uses `db` from `@/lib/db`.

## Curl test results (against running dev server :3000)
- POST {name:"Test A",inputBits:4,data:{hello:"world"}} → **201**, data parsed back as object ✓
- GET /api/projects → list without `data` field ✓ ; ?full=1 includes parsed `data` ✓
- GET /api/projects/{id} → data parsed as object ✓
- PUT {name:"Test A2"} → 200 updated (updatedAt bumped) ✓ ; PUT data-only ✓ ; PUT inputBits-only ✓ ; PUT unknown id → 404 ✓
- DELETE → {success:true} ✓ ; GET after delete → 404 ✓ ; DELETE unknown id → 404 ✓
- POST inputBits=3 → 400 ✓ ; POST empty/whitespace name → 400 ✓ ; name>100 chars → 400 ✓ ; data="not-json{" → 400 ✓ ; malformed body → 400 ✓
- POST 5-bit + data as JSON string → 201, parsed back as object ✓
- **All test rows deleted; final GET /api/projects → `[]` (DB left clean)**
- `bun run lint` → clean, no errors. dev.log shows no server-side errors.

## API contract for frontend agents
- `GET /api/projects` → `[{id,name,inputBits,createdAt,updatedAt}]` (ISO date strings)
- `GET /api/projects?full=1` → same + `data` (parsed object)
- `GET /api/projects/{id}` → `{id,name,inputBits,data,createdAt,updatedAt}`
- `POST /api/projects` body `{name,inputBits,data}` → 201 (data may be object or JSON string)
- `PUT /api/projects/{id}` body: any subset of `{name,inputBits,data}` → 200
- `DELETE /api/projects/{id}` → `{success:true}`
- Errors: `{error: string}` with 400 (validation) / 404 (missing) / 500 (server).
