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
  validatePresetCreate,
} from "./helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/presets — paginated list, newest first.
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

    const presets = full
      ? await db.preset.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        })
      : await db.preset.findMany({
          where,
          select: {
            id: true,
            kind: true,
            name: true,
            ownerId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        });

    return NextResponse.json(presets.map((p) => toPayload(p, full)));
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
 * race) → 409. The owner identity is taken from the `x-sevenseg-owner`
 * header (null when absent).
 */
export async function POST(request: Request) {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;

    const result = validatePresetCreate(bodyResult.body);
    if (!result.ok) {
      return jsonError(result.error, 400, result.errors);
    }
    const { id, kind, name, data } = result.fields;

    const owner = ownerFromRequest(request);

    const existing = await db.preset.findUnique({ where: { id } });
    if (existing) {
      return jsonError("preset id already exists", 409);
    }

    try {
      const preset = await db.preset.create({
        data: {
          id,
          kind,
          name,
          data,
          ...(owner !== null ? { ownerId: owner } : {}),
        },
      });
      return NextResponse.json(toPayload(preset, true), { status: 201 });
    } catch (err) {
      // Unique-constraint race on the client-supplied id → 409 instead of 500.
      if (prismaErrorCode(err) === "P2002") {
        return jsonError("preset id already exists", 409);
      }
      throw err;
    }
  } catch (err) {
    console.error("POST /api/presets failed:", err);
    return jsonError("Internal server error", 500);
  }
}
