import { NextResponse } from "next/server";
import { ApiError } from "@/server/kernel";

/**
 * Presentation-edge response builders for the REST routes.
 *
 * This is where the internal error model (ApiError, plain data) becomes the
 * external wire contract (NextResponse). Kept out of src/server so the
 * service layer stays framework-free and runnable on plain Node.
 */

/**
 * Uniform `{ error, errors? }` JSON error response.
 * `errors` is omitted unless non-empty (matches the original envelope).
 */
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

/** Map an {@link ApiError} onto its exact wire response. */
export function apiErrorResponse(err: ApiError): NextResponse {
  if (err.body !== undefined) {
    return NextResponse.json(err.body, { status: err.status });
  }
  return jsonError(err.message, err.status, err.errors);
}

/** 2xx JSON response (200 by default). */
export function ok(payload: unknown, status: 200 | 201 = 200): NextResponse {
  return NextResponse.json(payload, { status });
}

/** 204 No Content (no body — clients must check res.ok, never res.json()). */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
