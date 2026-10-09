import type { PresetRow, PresetSummary } from "@/types/api";
import {
  validateLibraryFontPreset,
  validateLibraryTablePreset,
} from "@/logic/presets";
import { ApiError, isJsonObject, prismaErrorCode, readExpectedUpdatedAt } from "../kernel";
import type {
  PresetCreateInput,
  PresetKind,
  PresetRecord,
  PresetRepository,
  PresetUpdateInput,
} from "./repository";

/**
 * Preset use cases — the business rules for /api/presets.
 *
 * Same shape as the project service: ownership visibility, existence-hiding
 * 404s on reads, the 404 → 403 → 409 → 400 PUT precedence, optimistic
 * locking, and kind-aware blob validation (a data blob is validated against
 * the ROW's kind on update; id and kind are immutable). Duplicate ids are
 * caught by pre-check AND the P2002 race fallback. Preset ids are
 * client-supplied ("user:" + URL-safe charset) — never server-generated.
 */

// ---------------------------------------------------------------------------
// Row serialization (DB row → wire DTO)
// ---------------------------------------------------------------------------

/** Serialize a row to its wire DTO: ISO date strings plus `ownerId`. */
function toPayload(row: PresetRecord, full: false): PresetSummary;
function toPayload(row: PresetRecord, full: true): PresetRow;
function toPayload(row: PresetRecord, full: boolean): PresetSummary | PresetRow;
function toPayload(row: PresetRecord, full: boolean): PresetSummary | PresetRow {
  const base: PresetSummary = {
    id: row.id,
    kind: row.kind,
    name: row.name,
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

/**
 * Client-supplied preset id: "user:" + URL-safe charset. The strict charset
 * (no slashes etc.) keeps ids usable as single path segments in /api/presets/[id].
 */
const PRESET_ID_RE = /^user:[A-Za-z0-9_-]{1,94}$/;

/** Error detail used when a preset blob fails server-side validation. */
const INVALID_PRESET_DATA_ERRORS = ["E-280: preset data failed validation"];

/** Validated/normalized fields for create. `data` is the canonical JSON string. */
export type PresetCreateFields = {
  id: string;
  kind: PresetKind;
  name: string;
  data: string;
};

/** Validated/normalized fields for update. Only provided keys are updated. */
export type PresetUpdateFields = {
  name?: string;
  data?: string;
};

/** Discriminated validation result; `errors` carries E-coded details. */
export type ValidationResult<F> =
  | { ok: true; fields: F }
  | { ok: false; error: string; errors?: string[] };

/**
 * Validate + canonicalize a preset blob for a given kind. Returns the stored
 * JSON string, or an error. The canonical form comes from
 * validateLibraryTablePreset / validateLibraryFontPreset (which preserve the
 * stored createdAt/updatedAt instead of restamping them).
 */
function validatePresetData(
  data: unknown,
  kind: unknown,
  expectedId: string
): { ok: true; data: string } | { ok: false; error: string; errors?: string[] } {
  if (!isJsonObject(data)) {
    return { ok: false, error: 'Field "data" must be a JSON object.' };
  }
  const def =
    kind === "table"
      ? validateLibraryTablePreset(data)
      : kind === "font"
        ? validateLibraryFontPreset(data)
        : null;
  if (def === null) {
    return {
      ok: false,
      error: "Invalid preset data",
      errors: INVALID_PRESET_DATA_ERRORS,
    };
  }
  if (def.id !== expectedId) {
    return { ok: false, error: "id mismatch between body and data" };
  }
  return { ok: true, data: JSON.stringify(def) };
}

/**
 * Validate a create body: { id (required, "user:" + safe charset), kind
 * ("table"|"font", required), name (1..100, required), data (object,
 * required — validated via the library preset validators, embedded id must
 * match the body id) }.
 */
export function validatePresetCreate(body: unknown): ValidationResult<PresetCreateFields> {
  if (!isJsonObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  // id: required, "user:" + 1-94 chars of [A-Za-z0-9_-]
  if (typeof body.id !== "string" || !PRESET_ID_RE.test(body.id)) {
    return {
      ok: false,
      error: 'Field "id" must be "user:" followed by 1-94 letters, digits, "_" or "-".',
    };
  }

  // kind: must be "table" or "font"
  if (body.kind !== "table" && body.kind !== "font") {
    return { ok: false, error: 'Field "kind" must be "table" or "font".' };
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

  // data: validated against the kind; embedded id must match the body id
  const dataResult = validatePresetData(body.data, body.kind, body.id);
  if (!dataResult.ok) {
    return { ok: false, error: dataResult.error, errors: dataResult.errors };
  }

  return {
    ok: true,
    fields: { id: body.id, kind: body.kind, name, data: dataResult.data },
  };
}

/**
 * Validate an update body: { name?, data?, expectedUpdatedAt? } — id and kind
 * are immutable and therefore rejected/ignored. `data` (when present) is
 * validated against the ROW's kind and its embedded id must match the row id.
 * `expectedUpdatedAt` must be a string when present; the optimistic-locking
 * comparison itself happens in {@link PresetService.update} (409 on mismatch).
 */
export function validatePresetUpdate(
  body: unknown,
  row: { id: string; kind: string }
): ValidationResult<PresetUpdateFields> {
  if (!isJsonObject(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const fields: PresetUpdateFields = {};

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

  // data: validated against the stored row's kind; embedded id must match
  if (body.data !== undefined) {
    const dataResult = validatePresetData(body.data, row.kind, row.id);
    if (!dataResult.ok) {
      return { ok: false, error: dataResult.error, errors: dataResult.errors };
    }
    fields.data = dataResult.data;
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

/** Application service surface for presets. */
export interface PresetService {
  /** Paginated list visible to the owner (shared + own), newest first. */
  list(
    ownerId: string | null,
    options: { full: boolean; limit: number; offset: number }
  ): Promise<PresetSummary[] | PresetRow[]>;
  /** Full row by id. Foreign rows throw 404 (existence hiding). */
  get(id: string, ownerId: string | null): Promise<PresetRow>;
  /** Create from a raw request body; duplicate id (pre-check or race) → 409. */
  create(ownerId: string | null, body: unknown): Promise<PresetRow>;
  /**
   * Partial update. Error precedence: 404 (missing) → 403 (not your row) →
   * 409 (stale expectedUpdatedAt) → 400 (invalid fields) → 404 (row deleted
   * concurrently). Empty patches are a no-op returning the current row.
   */
  update(id: string, ownerId: string | null, body: unknown): Promise<PresetRow>;
  /** Delete. Missing → 404, foreign → 403, concurrent delete → 404. */
  remove(id: string, ownerId: string | null): Promise<void>;
}

/** Build a {@link PresetService} bound to a repository. */
export function createPresetService(repository: PresetRepository): PresetService {
  /** Shared read gate: 404 for missing AND foreign rows (hides existence). */
  async function getVisible(id: string, ownerId: string | null): Promise<PresetRecord> {
    const existing = await repository.findById(id);
    if (!existing) {
      throw new ApiError(404, "Preset not found.");
    }
    if (existing.ownerId !== null && existing.ownerId !== ownerId) {
      throw new ApiError(404, "Preset not found.");
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
      const result = validatePresetCreate(body);
      if (!result.ok) {
        throw new ApiError(400, result.error, result.errors);
      }
      const { id, kind, name, data } = result.fields;

      // Pre-check so the common duplicate case never reaches the database;
      // the P2002 fallback below still catches the create race.
      const existing = await repository.findById(id);
      if (existing) {
        throw new ApiError(409, "preset id already exists");
      }

      const input: PresetCreateInput = { id, kind, name, data, ownerId };
      try {
        const row = await repository.create(input);
        return toPayload(row, true);
      } catch (err) {
        // Unique-constraint race on the client-supplied id → 409 instead of 500.
        if (prismaErrorCode(err) === "P2002") {
          throw new ApiError(409, "preset id already exists");
        }
        throw err;
      }
    },

    async update(id, ownerId, body) {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new ApiError(404, "Preset not found.");
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

      const result = validatePresetUpdate(body, existing);
      if (!result.ok) {
        throw new ApiError(400, result.error, result.errors);
      }

      // Empty update (no recognized fields provided) is a no-op.
      if (Object.keys(result.fields).length === 0) {
        return toPayload(existing, true);
      }

      const fields: PresetUpdateInput = result.fields;
      try {
        const row = await repository.update(existing.id, fields);
        return toPayload(row, true);
      } catch (err) {
        // Row deleted between the fetch above and this update → 404, not 500.
        if (prismaErrorCode(err) === "P2025") {
          throw new ApiError(404, "Preset not found.");
        }
        throw err;
      }
    },

    async remove(id, ownerId) {
      const existing = await repository.findById(id);
      if (!existing) {
        throw new ApiError(404, "Preset not found.");
      }
      if (existing.ownerId !== null && existing.ownerId !== ownerId) {
        throw new ApiError(403, "not your row");
      }
      try {
        await repository.remove(existing.id);
      } catch (err) {
        if (prismaErrorCode(err) === "P2025") {
          throw new ApiError(404, "Preset not found.");
        }
        throw err;
      }
    },
  };
}
