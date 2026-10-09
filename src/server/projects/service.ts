import type { ProjectRow, ProjectSummary } from "@/types/api";
import { validateProject } from "@/logic/project";
import { ApiError, isJsonObject, prismaErrorCode, readExpectedUpdatedAt } from "../kernel";
import type {
  ProjectCreateInput,
  ProjectRecord,
  ProjectRepository,
  ProjectUpdateInput,
} from "./repository";

/**
 * Project use cases — the business rules for /api/projects.
 *
 * Everything that used to live inline in the route handlers now lives here:
 * ownership visibility, existence-hiding 404s (foreign rows 404, never 403,
 * on reads — but 403 on writes), the 404 → 403 → 409 → 400 PUT error
 * precedence, optimistic locking, and field validation with canonicalized
 * storage blobs. Dependencies enter as a repository (function-level DI,
 * wired in src/server/composition.ts); nothing here imports Prisma at
 * runtime, so scripts/verify-services.ts can run the whole service against
 * an in-memory fake on plain Node.
 */

// ---------------------------------------------------------------------------
// Row serialization (DB row → wire DTO)
// ---------------------------------------------------------------------------

/** Serialize a row to its wire DTO: ISO date strings plus `ownerId`. */
function toPayload(row: ProjectRecord, full: false): ProjectSummary;
function toPayload(row: ProjectRecord, full: true): ProjectRow;
function toPayload(row: ProjectRecord, full: boolean): ProjectSummary | ProjectRow;
function toPayload(row: ProjectRecord, full: boolean): ProjectSummary | ProjectRow {
  const base: ProjectSummary = {
    id: row.id,
    name: row.name,
    inputBits: row.inputBits,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ownerId: row.ownerId,
  };
  if (!full) return base;

  let data: unknown = null;
  let corrupt = false;
  if (typeof row.data === "string") {
    try {
      data = JSON.parse(row.data);
    } catch {
      corrupt = true;
    }
  } else {
    corrupt = true; // full mode without a data column should never happen
  }
  return { ...base, data, corrupt };
}

// ---------------------------------------------------------------------------
// Field validation (manual validators, per codebase convention)
// ---------------------------------------------------------------------------

/** Client-supplied row id charset (offline push-up ids must be URL-safe). */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Validated/normalized fields for create. `data` is the canonical JSON string. */
export type ProjectCreateFields = {
  /** Optional client-supplied id (offline push-up); server cuid otherwise. */
  id?: string;
  name: string;
  inputBits: number;
  data: string;
};

/** Validated/normalized fields for update. Only provided keys are updated. */
export type ProjectUpdateFields = {
  name?: string;
  inputBits?: number;
  data?: string;
};

/** Discriminated validation result; `errors` carries E-coded details. */
export type ValidationResult<F> =
  | { ok: true; fields: F }
  | { ok: false; error: string; errors?: string[] };

/**
 * Validate a create body: { name (1..100, required), inputBits (4|5, required),
 * data (object, required — run through validateProject), id? (optional
 * client-supplied, ^[A-Za-z0-9_-]{8,64}$) }. The stored blob is the
 * canonicalized form returned by validateProject, never the raw input.
 */
export function validateProjectCreate(body: unknown): ValidationResult<ProjectCreateFields> {
  if (!isJsonObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  // name: non-empty string, trimmed, max 100 chars
  if (typeof body.name !== "string") {
    return { ok: false, error: 'Field "name" is required and must be a string.' };
  }
  const name = body.name.trim();
  if (name.length === 0) {
    return { ok: false, error: 'Field "name" must be a non-empty string.' };
  }
  if (name.length > 100) {
    return { ok: false, error: 'Field "name" must be at most 100 characters long.' };
  }

  // inputBits: must be exactly 4 or 5
  if (
    typeof body.inputBits !== "number" ||
    !Number.isInteger(body.inputBits) ||
    (body.inputBits !== 4 && body.inputBits !== 5)
  ) {
    return { ok: false, error: 'Field "inputBits" must be 4 or 5.' };
  }

  // id: optional client-supplied (offline push-up), restricted charset
  let id: string | undefined;
  if (body.id !== undefined) {
    if (typeof body.id !== "string" || !CLIENT_ID_RE.test(body.id)) {
      return {
        ok: false,
        error: 'Field "id" is optional and must match ^[A-Za-z0-9_-]{8,64}$.',
      };
    }
    id = body.id;
  }

  // data: required object, validated + canonicalized server-side (E-2xx codes)
  if (!isJsonObject(body.data)) {
    return { ok: false, error: 'Field "data" must be a JSON object.' };
  }
  const result = validateProject(body.data);
  if (!result.ok || result.data === undefined) {
    return { ok: false, error: "Invalid project data", errors: result.errors };
  }

  return {
    ok: true,
    fields: {
      ...(id !== undefined ? { id } : {}),
      name,
      inputBits: body.inputBits,
      data: JSON.stringify(result.data),
    },
  };
}

/**
 * Validate an update body: { name?, inputBits?, data?, expectedUpdatedAt? } —
 * every field optional; `data` (when present) is validated exactly like on
 * create. `expectedUpdatedAt` must be a string when present; the optimistic-
 * locking comparison itself happens in {@link ProjectService.update} (409 on
 * mismatch).
 */
export function validateProjectUpdate(
  body: unknown
): ValidationResult<ProjectUpdateFields> {
  if (!isJsonObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const fields: ProjectUpdateFields = {};

  // name: non-empty string, trimmed, max 100 chars
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return { ok: false, error: 'Field "name" must be a string.' };
    }
    const name = body.name.trim();
    if (name.length === 0) {
      return { ok: false, error: 'Field "name" must be a non-empty string.' };
    }
    if (name.length > 100) {
      return { ok: false, error: 'Field "name" must be at most 100 characters long.' };
    }
    fields.name = name;
  }

  // inputBits: must be exactly 4 or 5
  if (body.inputBits !== undefined) {
    if (
      typeof body.inputBits !== "number" ||
      !Number.isInteger(body.inputBits) ||
      (body.inputBits !== 4 && body.inputBits !== 5)
    ) {
      return { ok: false, error: 'Field "inputBits" must be 4 or 5.' };
    }
    fields.inputBits = body.inputBits;
  }

  // data: validated + canonicalized exactly like on create
  if (body.data !== undefined) {
    if (!isJsonObject(body.data)) {
      return { ok: false, error: 'Field "data" must be a JSON object.' };
    }
    const result = validateProject(body.data);
    if (!result.ok || result.data === undefined) {
      return { ok: false, error: "Invalid project data", errors: result.errors };
    }
    fields.data = JSON.stringify(result.data);
  }

  // expectedUpdatedAt: ISO string; compared by update() for optimistic locking
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== "string") {
    return { ok: false, error: 'Field "expectedUpdatedAt" must be an ISO date string.' };
  }

  return { ok: true, fields };
}

// ---------------------------------------------------------------------------
// Service (use cases)
// ---------------------------------------------------------------------------

/** Application service surface for projects. */
export interface ProjectService {
  /** Paginated list visible to the owner (shared + own), newest first. */
  list(
    ownerId: string | null,
    options: { full: boolean; limit: number; offset: number }
  ): Promise<ProjectSummary[] | ProjectRow[]>;
  /** Full row by id. Foreign rows throw 404 (existence hiding). */
  get(id: string, ownerId: string | null): Promise<ProjectRow>;
  /** Create from a raw request body; duplicate id → 409. */
  create(ownerId: string | null, body: unknown): Promise<ProjectRow>;
  /**
   * Partial update. Error precedence: 404 (missing) → 403 (not your row) →
   * 409 (stale expectedUpdatedAt) → 400 (invalid fields) → 404 (row deleted
   * concurrently). Empty patches are a no-op returning the current row.
   */
  update(id: string, ownerId: string | null, body: unknown): Promise<ProjectRow>;
  /** Delete. Missing → 404, foreign → 403, concurrent delete → 404. */
  remove(id: string, ownerId: string | null): Promise<void>;
}

/** Build a {@link ProjectService} bound to a repository. */
export function createProjectService(repository: ProjectRepository): ProjectService {
  /** Shared read gate: 404 for missing AND foreign rows (hides existence). */
  async function getVisible(id: string, ownerId: string | null): Promise<ProjectRecord> {
    const existing = await repository.findById(id);
    if (!existing) {
      throw new ApiError(404, "Project not found.");
    }
    if (existing.ownerId !== null && existing.ownerId !== ownerId) {
      throw new ApiError(404, "Project not found.");
    }
    return existing;
  }

  return {
    async list(ownerId, { full, limit, offset }) {
      const rows = await repository.listVisible(ownerId, { full, limit, offset });
      return rows.map((row) => toPayload(row, full));
    },

    async get(id, ownerId) {
      const row = await getVisible(id, ownerId);
      return toPayload(row, true);
    },

    async create(ownerId, body) {
      const result = validateProjectCreate(body);
      if (!result.ok) {
        throw new ApiError(400, result.error, result.errors);
      }
      const input: ProjectCreateInput = { ...result.fields, ownerId };
      try {
        const row = await repository.create(input);
        return toPayload(row, true);
      } catch (err) {
        // Client-supplied id colliding with an existing row → 409, not 500.
        if (prismaErrorCode(err) === "P2002") {
          throw new ApiError(409, "id already exists");
        }
        throw err;
      }
    },

    async update(id, ownerId, body) {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new ApiError(404, "Project not found.");
      }
      if (existing.ownerId !== null && existing.ownerId !== ownerId) {
        throw new ApiError(403, "not your row");
      }

      // Optimistic locking: when the client sends the updatedAt it last saw,
      // reject the write if the row changed underneath it. Runs BEFORE field
      // validation, per the 404 → 403 → 409 → 400 error precedence.
      const expectedUpdatedAt = readExpectedUpdatedAt(body);
      if (
        expectedUpdatedAt !== undefined &&
        expectedUpdatedAt !== existing.updatedAt.toISOString()
      ) {
        throw new ApiError(409, "conflict", undefined, {
          error: "conflict",
          currentUpdatedAt: existing.updatedAt.toISOString(),
        });
      }

      const result = validateProjectUpdate(body);
      if (!result.ok) {
        throw new ApiError(400, result.error, result.errors);
      }

      // Empty update (no recognized fields provided) is a no-op.
      if (Object.keys(result.fields).length === 0) {
        return toPayload(existing, true);
      }

      const fields: ProjectUpdateInput = result.fields;
      try {
        const row = await repository.update(existing.id, fields);
        return toPayload(row, true);
      } catch (err) {
        // Row deleted between the fetch above and this update → 404, not 500.
        if (prismaErrorCode(err) === "P2025") {
          throw new ApiError(404, "Project not found.");
        }
        throw err;
      }
    },

    async remove(id, ownerId) {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new ApiError(404, "Project not found.");
      }
      if (existing.ownerId !== null && existing.ownerId !== ownerId) {
        throw new ApiError(403, "not your row");
      }
      try {
        await repository.remove(existing.id);
      } catch (err) {
        if (prismaErrorCode(err) === "P2025") {
          throw new ApiError(404, "Project not found.");
        }
        throw err;
      }
    },
  };
}
