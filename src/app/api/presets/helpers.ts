import { NextResponse } from "next/server";
import type { Preset } from "@prisma/client";

/** Allowed preset kinds (stored in the `kind` column). */
export const PRESET_KINDS = ["table", "font"] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

/** Shape returned to clients: same as the DB row but with `data` parsed from JSON. */
export type PresetPayload = {
  id: string;
  kind: string;
  name: string;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** Validated/normalized fields for create. `data` is a JSON string. */
export type PresetCreateFields = {
  id: string;
  kind: PresetKind;
  name: string;
  data: string;
};

/** Validated/normalized fields ready to be written to the DB. `data` is a JSON string. */
export type PresetFields = {
  name?: string;
  data?: string;
};

/** Serialize a DB row: parse the stored JSON blob back into a JS value. */
export function serializePreset(preset: Preset): PresetPayload {
  let data: unknown = null;
  try {
    data = JSON.parse(preset.data);
  } catch {
    data = null;
  }
  return {
    id: preset.id,
    kind: preset.kind,
    name: preset.name,
    data,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}

/** Small helper for uniform { error } JSON error responses. */
export function jsonError(
  message: string,
  status: 400 | 404 | 409 | 500
): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** True when the value is a plain JSON object (not null, not an array). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize/validate the `data` field: must be a JSON object, or a string that
 * parses as valid JSON containing an object. Returns the canonical JSON string
 * to store, or an error message.
 */
function validateData(
  raw: unknown
): { ok: true; data: string } | { ok: false; error: string } {
  if (typeof raw === "string") {
    // String form: parse it first, then require the parsed value to be an object.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: 'Field "data" must be a valid JSON string containing an object.',
      };
    }
    if (!isJsonObject(parsed)) {
      return {
        ok: false,
        error:
          'Field "data" must be a JSON object or a JSON string containing an object.',
      };
    }
    try {
      return { ok: true, data: JSON.stringify(parsed) };
    } catch {
      return { ok: false, error: 'Field "data" must be JSON-serializable.' };
    }
  }
  if (isJsonObject(raw)) {
    try {
      return { ok: true, data: JSON.stringify(raw) };
    } catch {
      return { ok: false, error: 'Field "data" must be JSON-serializable.' };
    }
  }
  return {
    ok: false,
    error: 'Field "data" must be a JSON object or a JSON string containing an object.',
  };
}

/**
 * Validate the POST body: { id, kind, name, data } — all required.
 * Returns normalized fields on success or an error message on failure.
 */
export function validatePresetCreate(
  body: unknown
): { ok: true; fields: PresetCreateFields } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;

  // id: required non-empty string, at most 100 chars, MUST start with "user:"
  if (typeof raw.id !== "string") {
    return { ok: false, error: 'Field "id" is required and must be a string.' };
  }
  if (raw.id.length === 0) {
    return { ok: false, error: 'Field "id" must be a non-empty string.' };
  }
  if (raw.id.length > 100) {
    return {
      ok: false,
      error: 'Field "id" must be at most 100 characters long.',
    };
  }
  if (!raw.id.startsWith("user:")) {
    return { ok: false, error: "id must start with 'user:'" };
  }

  // kind: must be "table" or "font"
  if (typeof raw.kind !== "string") {
    return {
      ok: false,
      error: 'Field "kind" is required and must be a string.',
    };
  }
  if (raw.kind !== "table" && raw.kind !== "font") {
    return { ok: false, error: 'Field "kind" must be "table" or "font".' };
  }

  // name: non-empty string, trimmed, max 100 chars
  if (typeof raw.name !== "string") {
    return { ok: false, error: 'Field "name" is required and must be a string.' };
  }
  const name = raw.name.trim();
  if (name.length === 0) {
    return { ok: false, error: 'Field "name" must be a non-empty string.' };
  }
  if (name.length > 100) {
    return {
      ok: false,
      error: 'Field "name" must be at most 100 characters long.',
    };
  }

  // data: JSON object, or valid JSON string containing an object
  const dataResult = validateData(raw.data);
  if (!dataResult.ok) {
    return { ok: false, error: dataResult.error };
  }

  return {
    ok: true,
    fields: { id: raw.id, kind: raw.kind, name, data: dataResult.data },
  };
}

/**
 * Validate the PUT body: partial update of `name` and/or `data`
 * (id and kind are immutable and therefore ignored).
 * Returns normalized fields on success or an error message on failure.
 */
export function validatePresetUpdate(
  body: unknown
): { ok: true; fields: PresetFields } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;
  const fields: PresetFields = {};

  // name: non-empty string, trimmed, max 100 chars
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") {
      return { ok: false, error: 'Field "name" must be a string.' };
    }
    const name = raw.name.trim();
    if (name.length === 0) {
      return { ok: false, error: 'Field "name" must be a non-empty string.' };
    }
    if (name.length > 100) {
      return {
        ok: false,
        error: 'Field "name" must be at most 100 characters long.',
      };
    }
    fields.name = name;
  }

  // data: JSON object, or valid JSON string containing an object
  if (raw.data !== undefined) {
    const dataResult = validateData(raw.data);
    if (!dataResult.ok) {
      return { ok: false, error: dataResult.error };
    }
    fields.data = dataResult.data;
  }

  return { ok: true, fields };
}
