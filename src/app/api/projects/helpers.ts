import { NextResponse } from "next/server";
import type { Project } from "@prisma/client";

/** Shape returned to clients: same as the DB row but with `data` parsed from JSON. */
export type ProjectPayload = {
  id: string;
  name: string;
  inputBits: number;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Validated/normalized fields ready to be written to the DB. `data` is a JSON string. */
export type ProjectFields = {
  name?: string;
  inputBits?: number;
  data?: string;
};

/** Serialize a DB row: parse the stored JSON blob back into a JS value. */
export function serializeProject(project: Project): ProjectPayload {
  let data: unknown = null;
  try {
    data = JSON.parse(project.data);
  } catch {
    data = null;
  }
  return {
    id: project.id,
    name: project.name,
    inputBits: project.inputBits,
    data,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** Small helper for uniform { error } JSON error responses. */
export function jsonError(message: string, status: 400 | 404 | 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Validate request fields for create (requireAll = true) or partial update.
 * Returns normalized fields on success or an error message on failure.
 */
export function validateProjectFields(
  body: unknown,
  requireAll: boolean
): { ok: true; fields: ProjectFields } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;
  const fields: ProjectFields = {};

  // name: non-empty string, trimmed, max 100 chars
  if (requireAll || raw.name !== undefined) {
    if (typeof raw.name !== "string") {
      return { ok: false, error: 'Field "name" is required and must be a string.' };
    }
    const name = raw.name.trim();
    if (name.length === 0) {
      return { ok: false, error: 'Field "name" must be a non-empty string.' };
    }
    if (name.length > 100) {
      return { ok: false, error: 'Field "name" must be at most 100 characters long.' };
    }
    fields.name = name;
  }

  // inputBits: must be exactly 4 or 5
  if (requireAll || raw.inputBits !== undefined) {
    if (typeof raw.inputBits !== "number" || !Number.isInteger(raw.inputBits)) {
      return { ok: false, error: 'Field "inputBits" must be an integer of 4 or 5.' };
    }
    if (raw.inputBits !== 4 && raw.inputBits !== 5) {
      return { ok: false, error: 'Field "inputBits" must be 4 or 5.' };
    }
    fields.inputBits = raw.inputBits;
  }

  // data: JSON-serializable object, or a string that parses as valid JSON
  if (requireAll || raw.data !== undefined) {
    if (typeof raw.data === "string") {
      try {
        JSON.parse(raw.data);
      } catch {
        return { ok: false, error: 'Field "data" must be a valid JSON string.' };
      }
      fields.data = raw.data;
    } else if (typeof raw.data === "object" && raw.data !== null) {
      try {
        fields.data = JSON.stringify(raw.data);
      } catch {
        return { ok: false, error: 'Field "data" must be JSON-serializable.' };
      }
    } else {
      return { ok: false, error: 'Field "data" must be an object or a JSON string.' };
    }
  }

  return { ok: true, fields };
}
