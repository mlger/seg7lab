/**
 * Shared server kernel — transport-agnostic request/response primitives.
 *
 * ONE copy of the plumbing that /api/projects and /api/presets previously
 * duplicated in mirrored helper files: owner identity, the request body guard,
 * the internal error model, Prisma error narrowing, list pagination and the
 * optimistic-lock peek. This module is deliberately framework-free (no
 * `next/server` import): it consumes the standard Request/Response Web APIs
 * only, so the service layer and its tests can run on plain Node.
 *
 * Response *building* (NextResponse) lives at the presentation edge in
 * src/app/api/_lib/http.ts — the kernel talks in plain data and ApiError.
 */

// ---------------------------------------------------------------------------
// Internal error model
// ---------------------------------------------------------------------------

/**
 * Error thrown by server services when a request must fail with a specific
 * HTTP status. Routes map it 1:1 onto the wire contract:
 * `{ error: message, errors? }` — or `body` verbatim when present (the 409
 * optimistic-lock conflict shape).
 *
 * Note: no TypeScript constructor parameter properties — this module stays
 * runnable under Node's --experimental-strip-types (see scripts/verify-services.ts).
 */
export class ApiError extends Error {
  /** HTTP status the route must respond with. */
  readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 500;
  /** E-coded validation details for the `errors` array of the envelope. */
  readonly errors?: string[];
  /** Exact response body override (used by the 409 conflict contract). */
  readonly body?: Record<string, unknown>;

  constructor(
    status: 400 | 403 | 404 | 409 | 413 | 415 | 500,
    message: string,
    errors?: string[],
    body?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Owner identity
// ---------------------------------------------------------------------------

/** Header carrying the anonymous per-browser owner token. */
export const OWNER_HEADER = "x-sevenseg-owner";

/** Valid owner-token shape (lowercase hex + dashes, 8-64 chars). */
const OWNER_RE = /^[a-f0-9-]{8,64}$/;

/**
 * Extract and validate the owner identity from the request header.
 * Returns null when the header is absent or malformed — callers treat that
 * as "anonymous" (sees only shared rows, cannot own rows).
 *
 * The client-side counterpart is src/lib/client-owner.ts (`ownerHeaders`);
 * the two header literals MUST stay in sync.
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

/** Discriminated result of {@link parseJsonBody}. */
export type BodyResult =
  | { ok: true; body: unknown }
  | { ok: false; error: ApiError };

/**
 * Read and guard a JSON request body:
 * 1. Content-Type must be application/json (also blocks cross-origin form
 *    POSTs, which cannot set this header without a CORS preflight) → 415.
 * 2. Body text larger than 1 MB → 413.
 * 3. Must parse as JSON → 400, and must be a non-array object → 400.
 * On success returns the parsed body as `unknown` — field validation is the
 * service's job.
 */
export async function parseJsonBody(request: Request): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return { ok: false, error: new ApiError(415, "Content-Type must be application/json") };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    // Unreadable body (aborted request, encoding error) — treat as bad request.
    return { ok: false, error: new ApiError(400, "Invalid JSON") };
  }

  if (text.length > MAX_BODY_CHARS) {
    return { ok: false, error: new ApiError(413, "Payload too large (max 1 MB)") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: new ApiError(400, "Invalid JSON") };
  }

  if (!isJsonObject(parsed)) {
    return { ok: false, error: new ApiError(400, "Request body must be a JSON object.") };
  }
  return { ok: true, body: parsed };
}

// ---------------------------------------------------------------------------
// Prisma error narrowing
// ---------------------------------------------------------------------------

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
// Shared validation primitives
// ---------------------------------------------------------------------------

/** True when the value is a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Peek at `expectedUpdatedAt` in a raw PUT body without full validation.
 * Returns the value only when it is a string (the optimistic-lock comparison
 * in the service runs BEFORE field validation, per the API contract's
 * 404 → 403 → 409 → 400 error precedence).
 */
export function readExpectedUpdatedAt(body: unknown): string | undefined {
  if (!isJsonObject(body)) return undefined;
  return typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;
}
