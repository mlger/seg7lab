/**
 * scripts/verify-services.ts — use-case tests for the server service layer.
 *
 * Runs the FULL ProjectService/PresetService behavior against an in-memory
 * repository fake (no Prisma, no HTTP, no Next) on plain Node:
 *
 *   npm run verify:services
 *   node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/verify-services.ts
 *
 * Covers what scripts/verify-api.mjs cannot reach without a database:
 * corrupt-blob tolerance on reads (data: null + corrupt: true instead of a
 * 500), the P2002/P2025 error mappings (faked by throwing from the repo),
 * and the exact 404 → 403 → 409 → 400 precedence with real thrown ApiErrors.
 *
 * The wire contract itself (status codes + bodies over HTTP) is pinned by
 * verify-api.mjs against a live dev server; this suite pins the logic one
 * layer down.
 */

import {
  createProjectService,
  type ProjectService,
} from "../src/server/projects/service";
import type {
  ProjectCreateInput,
  ProjectRecord,
  ProjectRepository,
  ProjectUpdateInput,
} from "../src/server/projects/repository";
import {
  createPresetService,
  type PresetService,
} from "../src/server/presets/service";
import type {
  PresetCreateInput,
  PresetRecord,
  PresetRepository,
  PresetUpdateInput,
} from "../src/server/presets/repository";
import { ApiError } from "../src/server/kernel";

// ---------------------------------------------------------------------------
// Harness (same PASS/FAIL conventions as verify-logic.ts)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

/** Run a promise-returning case; a rejected ApiError fails the check. */
async function checkOk<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    passed++;
    console.log(`  PASS  ${name}`);
    return value;
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name} — threw ${(err as Error).message}`);
    return undefined;
  }
}

/** Run a case that must reject with an ApiError of the expected shape. */
async function checkApiError(
  name: string,
  fn: () => Promise<unknown>,
  status: number,
  message: string,
  extra?: (err: ApiError) => boolean
): Promise<ApiError | undefined> {
  try {
    await fn();
    failed++;
    console.log(`  FAIL  ${name} — resolved instead of throwing ${status}`);
    return undefined;
  } catch (err) {
    if (!(err instanceof ApiError)) {
      failed++;
      console.log(`  FAIL  ${name} — threw non-ApiError: ${(err as Error).message}`);
      return undefined;
    }
    const okStatus = err.status === status;
    const okMessage = err.message === message;
    const okExtra = extra === undefined || extra(err);
    if (okStatus && okMessage && okExtra) {
      passed++;
      console.log(`  PASS  ${name}`);
      return err;
    }
    failed++;
    console.log(
      `  FAIL  ${name} — got ${err.status}/${JSON.stringify(err.message)}${okExtra ? "" : " (extra predicate failed)"}`
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// In-memory repository fakes
// ---------------------------------------------------------------------------

/** Minimal clock: bump per write so updatedAt ordering is deterministic. */
let clock = 0;
function tick(): Date {
  return new Date(2026, 0, 1, 0, 0, 0, ++clock);
}

class UniqueConstraintError extends Error {
  readonly code = "P2002";
  constructor() {
    super("Unique constraint violation");
  }
}

class RecordNotFoundError extends Error {
  readonly code = "P2025";
  constructor() {
    super("Record not found");
  }
}

class InMemoryProjectRepository implements ProjectRepository {
  readonly rows = new Map<string, ProjectRecord>();
  /** When set, create() throws the fake unique-constraint error. */
  failCreateWith: "P2002" | null = null;
  /** When set, update()/remove() throw the fake not-found error. */
  failWriteWith: "P2025" | null = null;

  async listVisible(ownerId: string | null, { full, limit, offset }: { full: boolean; limit: number; offset: number }) {
    const visible = [...this.rows.values()].filter(
      (row) => row.ownerId === null || row.ownerId === ownerId
    );
    visible.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const page = visible.slice(offset, offset + limit);
    return page.map((row) => (full ? { ...row } : { ...row, data: undefined }));
  }

  async findById(id: string) {
    const row = this.rows.get(id);
    return row === undefined ? null : { ...row };
  }

  async create(input: ProjectCreateInput) {
    if (this.failCreateWith === "P2002") throw new UniqueConstraintError();
    if (input.id !== undefined && this.rows.has(input.id)) throw new UniqueConstraintError();
    const now = tick();
    const row: ProjectRecord = {
      id: input.id ?? `cuid-${this.rows.size + 1}`,
      name: input.name,
      inputBits: input.inputBits,
      ownerId: input.ownerId,
      createdAt: now,
      updatedAt: now,
      data: input.data,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async update(id: string, fields: ProjectUpdateInput) {
    if (this.failWriteWith === "P2025") throw new RecordNotFoundError();
    const row = this.rows.get(id);
    if (row === undefined) throw new RecordNotFoundError();
    Object.assign(row, fields, { updatedAt: tick() });
    return { ...row };
  }

  async remove(id: string) {
    if (this.failWriteWith === "P2025") throw new RecordNotFoundError();
    if (!this.rows.delete(id)) throw new RecordNotFoundError();
  }
}

class InMemoryPresetRepository implements PresetRepository {
  readonly rows = new Map<string, PresetRecord>();
  failCreateWith: "P2002" | null = null;
  failWriteWith: "P2025" | null = null;

  async listVisible(ownerId: string | null, { full, limit, offset }: { full: boolean; limit: number; offset: number }) {
    const visible = [...this.rows.values()].filter(
      (row) => row.ownerId === null || row.ownerId === ownerId
    );
    visible.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const page = visible.slice(offset, offset + limit);
    return page.map((row) => (full ? { ...row } : { ...row, data: undefined }));
  }

  async findById(id: string) {
    const row = this.rows.get(id);
    return row === undefined ? null : { ...row };
  }

  async create(input: PresetCreateInput) {
    if (this.failCreateWith === "P2002") throw new UniqueConstraintError();
    if (this.rows.has(input.id)) throw new UniqueConstraintError();
    const now = tick();
    const row: PresetRecord = {
      id: input.id,
      kind: input.kind,
      name: input.name,
      ownerId: input.ownerId,
      createdAt: now,
      updatedAt: now,
      data: input.data,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async update(id: string, fields: PresetUpdateInput) {
    if (this.failWriteWith === "P2025") throw new RecordNotFoundError();
    const row = this.rows.get(id);
    if (row === undefined) throw new RecordNotFoundError();
    Object.assign(row, fields, { updatedAt: tick() });
    return { ...row };
  }

  async remove(id: string) {
    if (this.failWriteWith === "P2025") throw new RecordNotFoundError();
    if (!this.rows.delete(id)) throw new RecordNotFoundError();
  }
}

// ---------------------------------------------------------------------------
// Fixtures (valid blobs in the app's own wire format)
// ---------------------------------------------------------------------------

const OWNER_A = "11111111-2222-3333-4444-555555555555";
const OWNER_B = "abcdefab-cdef-abcd-efab-cdefabcdefab";

const zeroOutputs = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, DP: 0 };
const zeroRows = Array.from({ length: 16 }, (_, i) => ({ input: i, outputs: { ...zeroOutputs } }));

const validProjectData = {
  version: 1,
  name: "Service Test Project",
  inputBits: 4,
  displayMode: "custom",
  invalidBehavior: "blank",
  currentInput: 0,
  truthTable: { inputBits: 4, rows: zeroRows },
  displaySettings: {
    activeColor: "#ff2d2d",
    inactiveColor: "#3a1214",
    brightness: 0.95,
    commonAnode: false,
    reverseLogic: false,
    showDP: true,
    skew: true,
  },
  coverExcluded: {},
  coverAdded: {},
};

const validTablePreset = {
  id: "user:svc-01",
  name: "Service Table",
  category: "User",
  inputBits: 4,
  generator: "literal",
  options: { tableStartCode: 0, invalidBehavior: "blank" },
  table: { inputBits: 4, rows: zeroRows },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Project service cases
// ---------------------------------------------------------------------------

async function projectServiceCases(): Promise<void> {
  console.log("\n[projects] create + validation");
  const repo = new InMemoryProjectRepository();
  const svc: ProjectService = createProjectService(repo);

  await checkApiError(
    "create rejects missing name with 400",
    () => svc.create(OWNER_A, { inputBits: 4, data: validProjectData }),
    400,
    'Field "name" is required and must be a string.'
  );
  await checkApiError(
    "create rejects invalid inputBits with 400",
    () => svc.create(OWNER_A, { name: "n", inputBits: 6, data: validProjectData }),
    400,
    'Field "inputBits" must be 4 or 5.'
  );
  await checkApiError(
    "create rejects bad id charset with 400",
    () => svc.create(OWNER_A, { name: "n", inputBits: 4, data: validProjectData, id: "bad id!" }),
    400,
    'Field "id" is optional and must match ^[A-Za-z0-9_-]{8,64}$.'
  );
  await checkApiError(
    "create rejects invalid project data with 400 + E-201",
    () => svc.create(OWNER_A, { name: "n", inputBits: 4, data: { version: 99 } }),
    400,
    "Invalid project data",
    (err) => err.errors !== undefined && err.errors[0].startsWith("E-201")
  );

  const created = await checkOk("create stores canonical blob and returns full row", () =>
    svc.create(OWNER_A, { name: "svc-project-01", inputBits: 4, data: validProjectData, id: "svc-project-01" })
  );
  check("create echoes id and ownerId", created?.id === "svc-project-01" && created?.ownerId === OWNER_A);
  check(
    "create returns canonicalized data (key order irrelevant, content canonical)",
    JSON.stringify((created?.data as Record<string, unknown>)?.truthTable) ===
      JSON.stringify((JSON.parse(JSON.stringify(validProjectData)) as Record<string, unknown>)?.truthTable)
  );

  await checkApiError(
    "create duplicate id maps P2002 to 409 'id already exists'",
    () => svc.create(OWNER_A, { name: "dup", inputBits: 4, data: validProjectData, id: "svc-project-01" }),
    409,
    "id already exists"
  );

  console.log("\n[projects] list visibility + pagination");
  await svc.create(null, { name: "shared", inputBits: 4, data: validProjectData, id: "svc-shared-01" });
  await svc.create(OWNER_B, { name: "b-only", inputBits: 4, data: validProjectData, id: "svc-project-b1" });

  const listA = await checkOk("list for owner A", () => svc.list(OWNER_A, { full: false, limit: 100, offset: 0 }));
  check(
    "list A sees shared + own, not B's",
    Array.isArray(listA) &&
      [...listA.map((r) => r.id)].sort().join(",") === "svc-project-01,svc-shared-01"
  );
  check(
    "slim rows carry no data field",
    Array.isArray(listA) && listA.every((r) => (r as { data?: unknown }).data === undefined)
  );
  const listB = await checkOk("list for owner B", () => svc.list(OWNER_B, { full: false, limit: 100, offset: 0 }));
  check(
    "list B sees shared + own, not A's",
    Array.isArray(listB) &&
      [...listB.map((r) => r.id)].sort().join(",") === "svc-project-b1,svc-shared-01"
  );
  const listAnon = await checkOk("list for anonymous", () => svc.list(null, { full: false, limit: 100, offset: 0 }));
  check("anonymous sees only shared", Array.isArray(listAnon) && listAnon.map((r) => r.id).join(",") === "svc-shared-01");
  const paged = await checkOk("limit=1 newest only", () => svc.list(null, { full: false, limit: 1, offset: 0 }));
  check("limit=1 returns exactly the newest row", Array.isArray(paged) && paged.length === 1);
  const offsetPage = await checkOk("offset=1 skips newest", () => svc.list(null, { full: false, limit: 100, offset: 1 }));
  check("offset=1 returns nothing beyond the single shared row", Array.isArray(offsetPage) && offsetPage.length === 0);

  console.log("\n[projects] get (existence hiding)");
  await checkOk("get own row", () => svc.get("svc-project-01", OWNER_A));
  await checkApiError(
    "get foreign row hides existence with 404",
    () => svc.get("svc-project-01", OWNER_B),
    404,
    "Project not found."
  );
  await checkApiError(
    "get unknown row 404",
    () => svc.get("svc-missing-01", OWNER_A),
    404,
    "Project not found."
  );
  await checkOk("get shared row as anonymous", () => svc.get("svc-shared-01", null));

  console.log("\n[projects] update precedence 404 → 403 → 409 → 400");
  await checkApiError(
    "update unknown row 404",
    () => svc.update("svc-missing-01", OWNER_A, { name: "x" }),
    404,
    "Project not found."
  );
  await checkApiError(
    "update foreign row 403 'not your row'",
    () => svc.update("svc-project-01", OWNER_B, { name: "x" }),
    403,
    "not your row"
  );
  await checkApiError(
    "stale expectedUpdatedAt 409 with conflict body",
    () => svc.update("svc-project-01", OWNER_A, { name: "x", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    409,
    "conflict",
    (err) =>
      err.body !== undefined &&
      (err.body as { error?: string }).error === "conflict" &&
      typeof (err.body as { currentUpdatedAt?: string }).currentUpdatedAt === "string"
  );
  await checkApiError(
    "409 beats 400: stale lock with INVALID fields still 409",
    () => svc.update("svc-project-01", OWNER_A, { name: "", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    409,
    "conflict"
  );
  await checkApiError(
    "invalid fields 400 after lock passes",
    () => svc.update("svc-project-01", OWNER_A, { name: "   " }),
    400,
    'Field "name" must be a non-empty string.'
  );
  const noop = await checkOk("empty patch is a no-op returning the current row", () =>
    svc.update("svc-project-01", OWNER_A, { unknown: true })
  );
  check("no-op row keeps its id", noop?.id === "svc-project-01");
  const renamed = await checkOk("rename returns updated full row", () =>
    svc.update("svc-project-01", OWNER_A, { name: "Renamed" })
  );
  check("rename persisted", renamed?.name === "Renamed");

  console.log("\n[projects] update with matching lock token");
  const current = await svc.get("svc-project-01", OWNER_A);
  const locked = await checkOk("update with correct expectedUpdatedAt succeeds", () =>
    svc.update("svc-project-01", OWNER_A, { name: "Locked Rename", expectedUpdatedAt: current.updatedAt })
  );
  check("locked rename persisted", locked?.name === "Locked Rename");

  console.log("\n[projects] P2025 race mapping");
  repo.failWriteWith = "P2025";
  await checkApiError(
    "update P2025 maps to 404",
    () => svc.update("svc-project-01", OWNER_A, { name: "gone" }),
    404,
    "Project not found."
  );
  await checkApiError(
    "remove P2025 maps to 404",
    () => svc.remove("svc-project-01", OWNER_A),
    404,
    "Project not found."
  );
  repo.failWriteWith = null;

  console.log("\n[projects] delete");
  await checkApiError("delete foreign 403", () => svc.remove("svc-project-01", OWNER_B), 403, "not your row");
  await checkOk("delete own row", () => svc.remove("svc-project-01", OWNER_A));
  await checkApiError("delete again 404", () => svc.remove("svc-project-01", OWNER_A), 404, "Project not found.");
  await checkOk("delete shared row as foreign owner (shared rows deletable by design)", () =>
    svc.remove("svc-shared-01", OWNER_B)
  );

  console.log("\n[projects] corrupt blob tolerance on read");
  const corruptRow: ProjectRecord = {
    id: "svc-corrupt-01",
    name: "Corrupt",
    inputBits: 4,
    ownerId: null,
    createdAt: tick(),
    updatedAt: tick(),
    data: "{not json",
  };
  repo.rows.set("svc-corrupt-01", corruptRow);
  const corrupt = await checkOk("corrupt blob read yields data:null + corrupt:true, not an error", () =>
    svc.get("svc-corrupt-01", OWNER_A)
  );
  check("corrupt flag set", corrupt?.data === null && corrupt?.corrupt === true);
}

// ---------------------------------------------------------------------------
// Preset service cases
// ---------------------------------------------------------------------------

async function presetServiceCases(): Promise<void> {
  console.log("\n[presets] create + validation");
  const repo = new InMemoryPresetRepository();
  const svc: PresetService = createPresetService(repo);

  await checkApiError(
    "create rejects non-'user:' id",
    () => svc.create(OWNER_A, { id: "svc-01", kind: "table", name: "n", data: validTablePreset }),
    400,
    'Field "id" must be "user:" followed by 1-94 letters, digits, "_" or "-".'
  );
  await checkApiError(
    "create rejects bad kind",
    () => svc.create(OWNER_A, { id: "user:svc-01", kind: "other", name: "n", data: validTablePreset }),
    400,
    'Field "kind" must be "table" or "font".'
  );
  await checkApiError(
    "create rejects data.id mismatch",
    () => svc.create(OWNER_A, { id: "user:different-01", kind: "table", name: "n", data: validTablePreset }),
    400,
    "id mismatch between body and data"
  );
  await checkApiError(
    "create rejects invalid data with E-280",
    () => svc.create(OWNER_A, { id: "user:svc-01", kind: "table", name: "n", data: { wrong: true } }),
    400,
    "Invalid preset data",
    (err) => err.errors?.[0] === "E-280: preset data failed validation"
  );

  const created = await checkOk("create valid table preset", () =>
    svc.create(OWNER_A, { id: "user:svc-01", kind: "table", name: "Service Table", data: validTablePreset })
  );
  check("created preset echoes id/kind/owner", created?.id === "user:svc-01" && created?.kind === "table" && created?.ownerId === OWNER_A);
  check(
    "created preset preserves embedded timestamps (no restamp)",
    (created?.data as { updatedAt?: string })?.updatedAt === "2026-01-01T00:00:00.000Z"
  );

  await checkApiError(
    "create duplicate (pre-check) 409",
    () => svc.create(OWNER_A, { id: "user:svc-01", kind: "table", name: "Again", data: validTablePreset }),
    409,
    "preset id already exists"
  );
  const presetBody = { id: "user:svc-02", kind: "table", name: "Race", data: { ...validTablePreset, id: "user:svc-02" } };
  repo.failCreateWith = "P2002";
  await checkApiError(
    "create duplicate (P2002 race) 409",
    () => svc.create(OWNER_A, presetBody),
    409,
    "preset id already exists"
  );
  repo.failCreateWith = null;

  console.log("\n[presets] update rules");
  await svc.create(null, { id: "user:svc-font-01", kind: "font", name: "F", data: { id: "user:svc-font-01", name: "F", builtin: false, glyphs: [{ char: "0", segments: "ABCDEF" }] } });

  const fontBlobAgainstTable = {
    id: "user:svc-01",
    name: "F",
    builtin: false,
    glyphs: [{ char: "0", segments: "ABCDEF" }],
  };
  await checkApiError(
    "update table row with font data → 400 E-280 (kind-validated)",
    () => svc.update("user:svc-01", OWNER_A, { data: fontBlobAgainstTable }),
    400,
    "Invalid preset data",
    (err) => err.errors?.[0] === "E-280: preset data failed validation"
  );
  const wrongEmbeddedId = { ...validTablePreset, id: "user:other-01" };
  await checkApiError(
    "update data with mismatched embedded id → 400",
    () => svc.update("user:svc-01", OWNER_A, { data: wrongEmbeddedId }),
    400,
    "id mismatch between body and data"
  );
  const current = await svc.get("user:svc-01", OWNER_A);
  const locked = await checkOk("update with correct lock token", () =>
    svc.update("user:svc-01", OWNER_A, { name: "Renamed Table", expectedUpdatedAt: current.updatedAt })
  );
  check("rename persisted", locked?.name === "Renamed Table");
  const noop = await checkOk("empty patch no-op (id/kind in body ignored)", () =>
    svc.update("user:svc-01", OWNER_A, { id: "user:something-else", kind: "font" })
  );
  check("no-op keeps row id and kind", noop?.id === "user:svc-01" && noop?.kind === "table");

  console.log("\n[presets] delete + shared semantics");
  await checkApiError("delete foreign 403", () => svc.remove("user:svc-01", OWNER_B), 403, "not your row");
  await checkOk("delete shared row as owner B (shared deletable by design)", () =>
    svc.remove("user:svc-font-01", OWNER_B)
  );
  await checkOk("delete own row", () => svc.remove("user:svc-01", OWNER_A));
  const list = await checkOk("list empty after deletes", () => svc.list(OWNER_A, { full: false, limit: 100, offset: 0 }));
  check("list is empty", Array.isArray(list) && list.length === 0);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("verify-services: project service");
  await projectServiceCases();
  console.log("\nverify-services: preset service");
  await presetServiceCases();

  console.log(`\nverify-services: ${passed} checks passed, ${failed} failed`);
  if (failed > 0) {
    console.error("VERIFY-SERVICES: FAILED");
    process.exit(1);
  }
  console.log("VERIFY-SERVICES: ALL PASS");
}

void main();
