import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, serializeProject, validateProjectFields } from "../helpers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id] — fetch a single project (data parsed as object)
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) {
      return jsonError("Project not found.", 404);
    }
    return NextResponse.json(serializeProject(project));
  } catch {
    return jsonError("Failed to fetch project.", 500);
  }
}

// PUT /api/projects/[id] — partial update (name and/or inputBits and/or data)
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const result = validateProjectFields(body, false);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }

    const existing = await db.project.findUnique({ where: { id } });
    if (!existing) {
      return jsonError("Project not found.", 404);
    }

    // Empty update (no recognized fields provided) is a no-op.
    const project =
      Object.keys(result.fields).length === 0
        ? existing
        : await db.project.update({
            where: { id },
            data: result.fields,
          });

    return NextResponse.json(serializeProject(project));
  } catch {
    return jsonError("Failed to update project.", 500);
  }
}

// DELETE /api/projects/[id] — delete a project
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = await db.project.deleteMany({ where: { id } });
    if (deleted.count === 0) {
      return jsonError("Project not found.", 404);
    }
    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Failed to delete project.", 500);
  }
}
