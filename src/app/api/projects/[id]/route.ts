import { getProjectService } from "@/server/composition";
import { ApiError, ownerFromRequest, parseJsonBody } from "@/server/kernel";
import { apiErrorResponse, jsonError, noContent, ok } from "../../_lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/[id] — fetch a single project as a full row.
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
    const project = await getProjectService().get(id, owner);
    return ok(project);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("GET /api/projects/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * PUT /api/projects/[id] — partial update (name and/or inputBits and/or data).
 *
 * Body: { name?, inputBits?, data?, expectedUpdatedAt? }. The body guard
 * (415/413/400) runs before anything else — even before the 404. The error
 * precedence 404 (missing) → 403 (not your row) → 409 (stale
 * expectedUpdatedAt, optimistic locking) → 400 (invalid fields) → 404
 * (P2025: concurrently deleted) is implemented in the service. Responds with
 * the full row so clients can chain optimistic locks on the new updatedAt.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const bodyResult = await parseJsonBody(request);
    if (!bodyResult.ok) return apiErrorResponse(bodyResult.error);

    const owner = ownerFromRequest(request);
    const project = await getProjectService().update(id, owner, bodyResult.body);
    return ok(project);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("PUT /api/projects/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * DELETE /api/projects/[id] — delete a project.
 * Missing → 404; owned by someone else → 403; success → 204 (no body).
 * P2025 (concurrent delete) is mapped to 404 — all in the service.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const owner = ownerFromRequest(request);
    await getProjectService().remove(id, owner);
    return noContent();
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("DELETE /api/projects/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}
