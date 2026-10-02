import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, serializeProject, validateProjectFields } from "./helpers";

export const dynamic = "force-dynamic";

// GET /api/projects — list projects (omit heavy `data` unless ?full=1)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const full = searchParams.get("full");

    if (full === "1" || full === "true") {
      const projects = await db.project.findMany({
        orderBy: { updatedAt: "desc" },
      });
      return NextResponse.json(projects.map(serializeProject));
    }

    const projects = await db.project.findMany({
      select: {
        id: true,
        name: true,
        inputBits: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch {
    return jsonError("Failed to list projects.", 500);
  }
}

// POST /api/projects — create a project
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const result = validateProjectFields(body, true);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }
    const { name, inputBits, data } = result.fields;
    if (name === undefined || inputBits === undefined || data === undefined) {
      return jsonError(
        'Fields "name", "inputBits" and "data" are required.',
        400
      );
    }

    const project = await db.project.create({
      data: { name, inputBits, data },
    });
    return NextResponse.json(serializeProject(project), { status: 201 });
  } catch {
    return jsonError("Failed to create project.", 500);
  }
}
