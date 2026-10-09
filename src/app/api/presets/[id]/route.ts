import { getPresetService } from "@/server/composition";
import { ApiError, ownerFromRequest, parseJsonBody } from "@/server/kernel";
import { apiErrorResponse, jsonError, noContent, ok } from "../../_lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/presets/[id] — fetch a single preset as a full row.
 *
 * Transport only. The read rule lives in the service: shared rows
 * (ownerId = null) are readable by everyone; rows owned by another owner
 * return 404 (not 403) so the endpoint does not leak the existence of other
 * owners' rows.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const owner = ownerFromRequest(request);
    const preset = await getPresetService().get(id, owner);
    return ok(preset);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("GET /api/presets/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * PUT /api/presets/[id] — partial update (name and/or data; id/kind immutable).
 *
 * Body: { name?, data?, expectedUpdatedAt? }. `data` is validated against the
 * stored row's kind and its embedded id must match the row id. The body guard
 * (415/413/400) runs before anything else. The error precedence 404 (missing)
 * → 403 (not your row) → 409 (stale expectedUpdatedAt) → 400 (invalid fields)
 * → 404 (P2025: concurrently deleted) is implemented in the service.
 * Responds with the full row so clients can chain optimistic locks.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const bodyResult = await parseJsonBody(request);
    if (!bodyResult.ok) return apiErrorResponse(bodyResult.error);

    const owner = ownerFromRequest(request);
    const preset = await getPresetService().update(id, owner, bodyResult.body);
    return ok(preset);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("PUT /api/presets/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * DELETE /api/presets/[id] — delete a preset.
 * Missing → 404; owned by someone else → 403; success → 204 (no body).
 * P2025 (concurrent delete) is mapped to 404 — all in the service.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const owner = ownerFromRequest(request);
    await getPresetService().remove(id, owner);
    return noContent();
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("DELETE /api/presets/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}
