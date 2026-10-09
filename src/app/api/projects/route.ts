import { getProjectService } from "@/server/composition";
import { ApiError, ownerFromRequest, parseLimit, parseOffset, parseJsonBody } from "@/server/kernel";
import { apiErrorResponse, jsonError, ok } from "../_lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects — paginated list, newest first.
 *
 * Query params: `full` ("1" includes the parsed `data` blob), `limit`
 * (1..200, default 100), `offset` (>= 0, default 0).
 *
 * Transport only: parse query → resolve owner → call the use case → map the
 * result. The visibility rule (shared rows + the requesting owner's rows)
 * lives in the service; slim mode never loads the blob column.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const full =
      searchParams.get("full") === "1" || searchParams.get("full") === "true";
    const limit = parseLimit(searchParams.get("limit"));
    const offset = parseOffset(searchParams.get("offset"));

    const owner = ownerFromRequest(request);
    const projects = await getProjectService().list(owner, { full, limit, offset });
    return ok(projects);
  } catch (err) {
    console.error("GET /api/projects failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * POST /api/projects — create a project.
 *
 * Body: { name (1..100), inputBits (4|5), data (object, validated via
 * validateProject), id? (optional client-supplied, for offline push-up) }.
 * The stored blob is the canonicalized form from the service's validator;
 * owner identity comes from the `x-sevenseg-owner` header (null when absent).
 * Client-supplied id colliding with an existing row → 409.
 */
export async function POST(request: Request) {
  try {
    const bodyResult = await parseJsonBody(request);
    if (!bodyResult.ok) return apiErrorResponse(bodyResult.error);

    const owner = ownerFromRequest(request);
    const project = await getProjectService().create(owner, bodyResult.body);
    return ok(project, 201);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("POST /api/projects failed:", err);
    return jsonError("Internal server error", 500);
  }
}
