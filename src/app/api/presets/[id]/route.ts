import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, serializePreset, validatePresetUpdate } from "../helpers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/presets/[id] — fetch a single preset (data parsed as object)
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const preset = await db.preset.findUnique({ where: { id } });
    if (!preset) {
      return jsonError("Preset not found.", 404);
    }
    return NextResponse.json(serializePreset(preset));
  } catch {
    return jsonError("Failed to fetch preset.", 500);
  }
}

// PUT /api/presets/[id] — partial update (name and/or data; id/kind are immutable)
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const result = validatePresetUpdate(body);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }

    const existing = await db.preset.findUnique({ where: { id } });
    if (!existing) {
      return jsonError("Preset not found.", 404);
    }

    // Empty update (no recognized fields provided) is a no-op.
    const preset =
      Object.keys(result.fields).length === 0
        ? existing
        : await db.preset.update({
            where: { id },
            data: result.fields,
          });

    return NextResponse.json(serializePreset(preset));
  } catch {
    return jsonError("Failed to update preset.", 500);
  }
}

// DELETE /api/presets/[id] — delete a preset
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = await db.preset.deleteMany({ where: { id } });
    if (deleted.count === 0) {
      return jsonError("Preset not found.", 404);
    }
    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Failed to delete preset.", 500);
  }
}
