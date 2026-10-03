/**
 * REST DTO shapes for the /api/projects and /api/presets endpoints.
 *
 * These are wire-format types only — the domain contract lives in
 * ./simulator.ts. Kept separate so the domain types stay client-agnostic
 * and API responses have one canonical home.
 */

/** Slim project row as returned by GET /api/projects (no `data`). */
export interface ProjectSummary {
  id: string;
  name: string;
  inputBits: number;
  createdAt: string;
  updatedAt: string;
  /** Owning browser token (null/absent = shared/legacy row created before ownership). */
  ownerId?: string | null;
}

/** Full project row (GET ?full=1, GET /api/projects/:id, POST/PUT responses). */
export interface ProjectRow extends ProjectSummary {
  data: unknown;
  /** True when the stored JSON blob could not be parsed — data is null then. */
  corrupt?: boolean;
}

/** Slim preset row as returned by GET /api/presets (no `data`). */
export interface PresetSummary {
  id: string;
  kind: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string | null;
}

/** Full preset row (GET ?full=1, GET /api/presets/:id, POST/PUT responses). */
export interface PresetRow extends PresetSummary {
  data: unknown;
  corrupt?: boolean;
}

/** Discriminated client-side result of an API call. */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; errors?: string[] };
