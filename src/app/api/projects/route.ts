import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  jsonError,
  ownerFromRequest,
  parseLimit,
  parseOffset,
  prismaErrorCode,
  readJsonBody,
  toPayload,
  validateProjectCreate,
} from "./helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects — paginated list, newest first.
 *
 * Query params: `full` ("1" includes the parsed `data` blob), `limit`
 * (1..200, default 100), `offset` (>= 0, default 0). Slim mode selects
 * WITHOUT the data column so listing never loads megabytes of blobs.
 *
 * Ownership: rows with ownerId = null are shared/legacy and visible to
 * everyone; owned rows are visible only when the request carries the
 * matching `x-sevenseg-owner` header.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const full =
      searchParams.get("full") === "1" || searchParams.get("full") === "true";
    const limit = parseLimit(searchParams.get("limit"));
    const offset = parseOffset(searchParams.get("offset"));

    const owner = ownerFromRequest(request);
    const where = {
      OR: [{ ownerId: null }, ...(owner !== null ? [{ ownerId: owner }] : [])],
    };

    const projects = full
      ? await db.project.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        })
      : await db.project.findMany({
          where,
          select: {
            id: true,
            name: true,
            inputBits: true,
            ownerId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        });

    return NextResponse.json(projects.map((p) => toPayload(p, full)));
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
 * The stored blob is the canonicalized form from validateProject. The owner
 * identity is taken from the `x-sevenseg-owner` header (null when absent).
 */
export async function POST(request: Request) {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const result = validateProjectCreate(bodyResult.body);
    if (!result.ok) {
      return jsonError(result.error, 400, result.errors);
    }

    const owner = ownerFromRequest(request);
    try {
      const project = await db.project.create({
        data: {
          ...(result.fields.id !== undefined ? { id: result.fields.id } : {}),
          name: result.fields.name,
          inputBits: result.fields.inputBits,
          data: result.fields.data,
          ...(owner !== null ? { ownerId: owner } : {}),
        },
      });
      return NextResponse.json(toPayload(project, true), { status: 201 });
    } catch (err) {
      // Client-supplied id colliding with an existing row → 409, not 500.
      if (prismaErrorCode(err) === "P2002") {
        return jsonError("id already exists", 409);
      }
      throw err;
    }
  } catch (err) {
    console.error("POST /api/projects failed:", err);
    return jsonError("Internal server error", 500);
  }
}
