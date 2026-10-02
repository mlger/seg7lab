import { NextResponse } from "next/server";
import type { Preset } from "@prisma/client";
import type { PresetRow, PresetSummary } from "@/types/api";
import {
  validateLibraryFontPreset,
  validateLibraryTablePreset,
} from "@/logic/presets";

/**
 * Shared request plumbing for the /api/presets routes.
 *
 * Mirrors src/app/api/projects/helpers.ts on purpose: both folders keep a
 * self-contained helper module so the two resource families can evolve their
 * validation rules independently while the transport-level conventions
 * (owner header, body guard, error envelope, pagination) stay identical.
 */

// ---------------------------------------------------------------------------
// Owner identity
// ---------------------------------------------------------------------------

/**
 * Header carrying the anonymous per-browser owner token.
 * MUST match OWNER_HEADER in src/lib/owner.ts (server code must not import
 * that client module, hence the duplicated literal).
 */
const OWNER_HEADER = "x-sevenseg-owner";

/** Valid owner-token shape (lowercase hex + dashes, 8-64 chars). */
const OWNER_RE = /^[a-f0-9-]{8,64}$/;

/**
 * Extract and validate the owner identity from the request header.
 * Returns null when the header is absent or malformed — callers treat that
 * as "anonymous" (sees only shared rows, cannot own rows).
 */
export function ownerFromRequest(request: Request): string | null {
  const raw = request.headers.get(OWNER_HEADER);
  if (raw === null) return null;
  return OWNER_RE.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Request body guard
// ---------------------------------------------------------------------------

/** Maximum accepted body size (characters of the raw request text). */
const MAX_BODY_CHARS = 1_000_000;

/** Discriminated result of {@link readJsonBody}. */
export type BodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Read and guard a JSON request body:
 * 1. Content-Type must be application/json (also blocks cross-origin form
 *    POSTs, which cannot set this header without a CORS preflight) → 415.
 * 2. Body text larger than 1 MB → 413.
 * 3. Must parse as JSON → 400, and must be a non-array object → 400.
 * On success returns the parsed body as `unknown` — field validation is the
 * caller's job.
 */
export async function readJsonBody(request: Request): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return { ok: false, response: jsonError("Content-Type must be application/json", 415) };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    // Unreadable body (aborted request, encoding error) — treat as bad request.
    return { ok: false, response: jsonError("Invalid JSON", 400) };
  }

  if (text.length > MAX_BODY_CHARS) {
    return { ok: false, response: jsonError("Payload too large (max 1 MB)", 413) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError("Invalid JSON", 400) };
  }

  if (!isJsonObject(parsed)) {
    return { ok: false, response: jsonError("Request body must be a JSON object.", 400) };
  }
  return { ok: true, body: parsed };
}

// ---------------------------------------------------------------------------
// Error envelope + Prisma error narrowing
// ---------------------------------------------------------------------------

/** Uniform `{ error, errors? }` JSON error response. */
export function jsonError(
  message: string,
  status: 400 | 403 | 404 | 409 | 413 | 415 | 500,
  errors?: string[]
): NextResponse {
  return NextResponse.json(
    errors && errors.length > 0 ? { error: message, errors } : { error: message },
    { status }
  );
}

/** Narrow an unknown thrown value to a Prisma error code (null when not one). */
export function prismaErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

// ---------------------------------------------------------------------------
// List pagination
// ---------------------------------------------------------------------------

/** Parse the `limit` query param: integer, default 100, clamped to 1..200. */
export function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(n, 1), 200);
}

/** Parse the `offset` query param: non-negative integer, default 0. */
export function parseOffset(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// ---------------------------------------------------------------------------
// Row serialization
// ---------------------------------------------------------------------------

/** DB row shape accepted by {@link toPayload} — `data` is only selected in full mode. */
export type PresetDbRow = Omit<Preset, "data"> & { data?: string };

/**
 * Serialize a DB row to its wire DTO: ISO date strings (never Prisma Date
 * objects) plus `ownerId`. In full mode the stored blob is parsed back into
 * `data`; a blob that fails JSON.parse yields `data: null` and `corrupt: true`
 * instead of a 500, so clients can surface and repair it.
 */
export function toPayload(row: PresetDbRow, full: false): PresetSummary;
export function toPayload(row: PresetDbRow, full: true): PresetRow;
export function toPayload(row: PresetDbRow, full: boolean): PresetSummary | PresetRow;
export function toPayload(row: PresetDbRow, full: boolean): PresetSummary | PresetRow {
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

/** True when the value is a plain JSON object (not null, not an array). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Client-supplied preset id: "user:" + URL-safe charset. The strict charset
 * (no slashes etc.) keeps ids usable as single path segments in /api/presets/[id].
 */
const PRESET_ID_RE = /^user:[A-Za-z0-9_-]{1,94}$/;

/** Error detail used when a preset blob fails server-side validation. */
const INVALID_PRESET_DATA_ERRORS = ["E-280: preset data failed validation"];

/** Validated/normalized fields for POST. `data` is the canonical JSON string. */
export type PresetCreateFields = {
  id: string;
  kind: "table" | "font";
  name: string;
  data: string;
};

/** Validated/normalized fields for PUT. Only provided keys are updated. */
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
 * Validate a POST body: { id (required, "user:" + safe charset), kind
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
 * Validate a PUT body: { name?, data?, expectedUpdatedAt? } — id and kind are
 * immutable and therefore rejected/ignored. `data` (when present) is
 * validated against the ROW's kind and its embedded id must match the row id.
 * `expectedUpdatedAt` must be a string when present; the optimistic-locking
 * comparison itself happens in the route (409 on mismatch).
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

  // expectedUpdatedAt: ISO string; compared by the route for optimistic locking
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== "string") {
    return { ok: false, error: 'Field "expectedUpdatedAt" must be an ISO date string.' };
  }

  return { ok: true, fields };
}

/**
 * Peek at `expectedUpdatedAt` in a raw PUT body without full validation.
 * Returns the value only when it is a string (the optimistic-lock comparison
 * in the route runs BEFORE field validation, per the API contract's
 * 404 → 403 → 409 → 400 error precedence).
 */
export function readExpectedUpdatedAt(body: unknown): string | undefined {
  if (!isJsonObject(body)) return undefined;
  return typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
}
