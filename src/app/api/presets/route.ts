import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, serializePreset, validatePresetCreate } from "./helpers";

export const dynamic = "force-dynamic";

// GET /api/presets — list presets (omit heavy `data` unless ?full=1)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const full = searchParams.get("full");

    if (full === "1" || full === "true") {
      const presets = await db.preset.findMany({
        orderBy: { updatedAt: "desc" },
      });
      return NextResponse.json(presets.map(serializePreset));
    }

    const presets = await db.preset.findMany({
      select: {
        id: true,
        kind: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(presets);
  } catch {
    return jsonError("Failed to list presets.", 500);
  }
}

// POST /api/presets — create a preset with a client-supplied id
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const result = validatePresetCreate(body);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }
    const { id, kind, name, data } = result.fields;

    const existing = await db.preset.findUnique({ where: { id } });
    if (existing) {
      return jsonError("preset id already exists", 409);
    }

    const preset = await db.preset.create({
      data: { id, kind, name, data },
    });
    return NextResponse.json(serializePreset(preset), { status: 201 });
  } catch (err) {
    // Unique-constraint race on the client-supplied id → 409 instead of 500.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "P2002"
    ) {
      return jsonError("preset id already exists", 409);
    }
    return jsonError("Failed to create preset.", 500);
  }
}
