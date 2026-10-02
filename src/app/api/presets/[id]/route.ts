import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  jsonError,
  ownerFromRequest,
  prismaErrorCode,
  readExpectedUpdatedAt,
  readJsonBody,
  toPayload,
  validatePresetUpdate,
} from "../helpers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/presets/[id] — fetch a single preset as a full row.
 *
 * Read rule matches the list filter: shared rows (ownerId = null) are
 * readable by everyone; rows owned by another owner return 404 (not 403) so
 * the endpoint does not leak the existence of other owners' rows.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const preset = await db.preset.findUnique({ where: { id } });
    if (!preset) {
      return jsonError("Preset not found.", 404);
    }
    const owner = ownerFromRequest(request);
    if (preset.ownerId !== null && preset.ownerId !== owner) {
      return jsonError("Preset not found.", 404);
    }
    return NextResponse.json(toPayload(preset, true));
  } catch (err) {
    console.error("GET /api/presets/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * PUT /api/presets/[id] — partial update (name and/or data; id/kind immutable).
 *
 * Body: { name?, data?, expectedUpdatedAt? }. `data` is validated against the
 * stored row's kind and its embedded id must match the row id. Error
 * precedence per the API contract: 404 (missing) → 403 (not your row) → 409
 * (stale expectedUpdatedAt, optimistic locking) → 400 (invalid fields) → 404
 * (P2025: concurrently deleted between check and update). Responds with the
 * full row so clients can chain optimistic locks on the new updatedAt.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const existing = await db.preset.findUnique({ where: { id } });
    if (!existing) {
      return jsonError("Preset not found.", 404);
    }

    const owner = ownerFromRequest(request);
    if (existing.ownerId !== null && existing.ownerId !== owner) {
      return jsonError("not your row", 403);
    }

    // Optimistic locking: when the client sends the updatedAt it last saw,
    // reject the write if the row changed underneath it.
    const expectedUpdatedAt = readExpectedUpdatedAt(bodyResult.body);
    if (
      expectedUpdatedAt !== undefined &&
      expectedUpdatedAt !== existing.updatedAt.toISOString()
    ) {
      return NextResponse.json(
        { error: "conflict", currentUpdatedAt: existing.updatedAt.toISOString() },
        { status: 409 }
      );
    }

    const result = validatePresetUpdate(bodyResult.body, existing);
    if (!result.ok) {
      return jsonError(result.error, 400, result.errors);
    }

    // Empty update (no recognized fields provided) is a no-op.
    if (Object.keys(result.fields).length === 0) {
      return NextResponse.json(toPayload(existing, true));
    }

    try {
      const preset = await db.preset.update({
        where: { id: existing.id },
        data: result.fields,
      });
      return NextResponse.json(toPayload(preset, true));
    } catch (err) {
      // Row deleted between the fetch above and this update → 404, not 500.
      if (prismaErrorCode(err) === "P2025") {
        return jsonError("Preset not found.", 404);
      }
      throw err;
    }
  } catch (err) {
    console.error("PUT /api/presets/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}

/**
 * DELETE /api/presets/[id] — delete a preset.
 * Missing → 404; owned by someone else → 403; success → 204 (no body).
 * P2025 (concurrent delete) is mapped to 404.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const existing = await db.preset.findUnique({ where: { id } });
    if (!existing) {
      return jsonError("Preset not found.", 404);
    }

    const owner = ownerFromRequest(request);
    if (existing.ownerId !== null && existing.ownerId !== owner) {
      return jsonError("not your row", 403);
    }

    try {
      await db.preset.delete({ where: { id: existing.id } });
    } catch (err) {
      if (prismaErrorCode(err) === "P2025") {
        return jsonError("Preset not found.", 404);
      }
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("DELETE /api/presets/[id] failed:", err);
    return jsonError("Internal server error", 500);
  }
}
