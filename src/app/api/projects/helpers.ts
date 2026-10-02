import { NextResponse } from "next/server";
import type { Project } from "@prisma/client";
import type { ProjectRow, ProjectSummary } from "@/types/api";
import { validateProject } from "@/logic/project";

/**
 * Shared request plumbing for the /api/projects routes.
 *
 * Mirrors src/app/api/presets/helpers.ts on purpose: both folders keep a
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
export type ProjectDbRow = Omit<Project, "data"> & { data?: string };

/**
 * Serialize a DB row to its wire DTO: ISO date strings (never Prisma Date
 * objects) plus `ownerId`. In full mode the stored blob is parsed back into
 * `data`; a blob that fails JSON.parse yields `data: null` and `corrupt: true`
 * instead of a 500, so clients can surface and repair it.
 */
export function toPayload(row: ProjectDbRow, full: false): ProjectSummary;
export function toPayload(row: ProjectDbRow, full: true): ProjectRow;
export function toPayload(row: ProjectDbRow, full: boolean): ProjectSummary | ProjectRow;
export function toPayload(row: ProjectDbRow, full: boolean): ProjectSummary | ProjectRow {
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

/** True when the value is a plain JSON object (not null, not an array). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Client-supplied row id charset (offline push-up ids must be URL-safe). */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Validated/normalized fields for POST. `data` is the canonical JSON string. */
export type ProjectCreateFields = {
  /** Optional client-supplied id (offline push-up); server cuid otherwise. */
  id?: string;
  name: string;
  inputBits: number;
  data: string;
};

/** Validated/normalized fields for PUT. Only provided keys are updated. */
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
 * Validate a POST body: { name (1..100, required), inputBits (4|5, required),
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
 * Validate a PUT body: { name?, inputBits?, data?, expectedUpdatedAt? } —
 * every field optional; `data` (when present) is validated exactly like on
 * POST. `expectedUpdatedAt` must be a string when present; the optimistic-
 * locking comparison itself happens in the route (409 on mismatch).
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

  // data: validated + canonicalized exactly like on POST
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
