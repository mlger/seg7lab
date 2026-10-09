import { getPresetService } from "@/server/composition";
import { ApiError, ownerFromRequest, parseLimit, parseOffset, parseJsonBody } from "@/server/kernel";
import { apiErrorResponse, jsonError, ok } from "../_lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/presets — paginated list, newest first.
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
    const presets = await getPresetService().list(owner, { full, limit, offset });
    return ok(presets);
  } catch (err) {
    console.error("GET /api/presets failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * POST /api/presets — create a preset with a client-supplied id.
 *
 * Body: { id ("user:" + safe charset), kind ("table"|"font"), name (1..100),
 * data (object — validated via the library preset validators, canonical form
 * stored with timestamps preserved) }. Duplicate ids (pre-check or P2002
 * race) → 409. Owner identity comes from the `x-sevenseg-owner` header.
 */
export async function POST(request: Request) {
  try {
    const bodyResult = await parseJsonBody(request);
    if (!bodyResult.ok) return apiErrorResponse(bodyResult.error);

    const owner = ownerFromRequest(request);
    const preset = await getPresetService().create(owner, bodyResult.body);
    return ok(preset, 201);
  } catch (err) {
    if (err instanceof ApiError) return apiErrorResponse(err);
    console.error("POST /api/presets failed:", err);
    return jsonError("Internal server error", 500);
  }
}
