/**
 * Typed REST client for the app's own API (client-side transport layer).
 *
 * Every call goes through the same conventions the server enforces:
 *  - `application/json` bodies (which also blocks cross-origin form POSTs),
 *  - the per-browser owner header via {@link ownerHeaders},
 *  - relative URLs only (same-origin; works behind any proxy).
 *
 * Results are discriminated {@link ApiResult}s — the error envelope
 * `{ error, errors? }` is surfaced verbatim so UI code can show the exact
 * server message (including E-coded validation details). 204 No Content
 * responses (DELETE) never attempt to parse a body.
 */

import type { ApiResult, ProjectRow } from '@/types/api';
import type { ProjectData } from '@/types/simulator';
import { ownerHeaders } from '@/lib/client-owner';

/** Body for POST /api/projects (create). */
export interface CreateProjectBody {
  name: string;
  inputBits: number;
  data: ProjectData;
  /** Client-supplied id for offline push-up (optional). */
  id?: string;
}

/** Body for PUT /api/projects/:id (partial update). */
export interface UpdateProjectBody {
  name?: string;
  inputBits?: number;
  data?: ProjectData;
  /** Optimistic-lock token — the updatedAt the client last saw. */
  expectedUpdatedAt?: string;
}

/** Read the error envelope when present; never throws on non-2xx. */
async function readError(res: Response): Promise<{ status: number; error: string; errors?: string[] }> {
  let error = `HTTP ${res.status}`;
  let errors: string[] | undefined;
  try {
    const text = await res.text();
    if (text.length > 0) {
      const parsed = JSON.parse(text) as { error?: unknown; errors?: unknown };
      if (typeof parsed.error === 'string') error = parsed.error;
      if (Array.isArray(parsed.errors)) errors = parsed.errors.filter((e) => typeof e === 'string');
    }
  } catch {
    /* non-JSON error body — keep the HTTP status line */
  }
  return { status: res.status, error, errors };
}

/** GET /api/projects — full rows, paginated (slim mode is not used by the UI). */
export async function listProjects(
  options: { full?: boolean; limit?: number; offset?: number } = {},
): Promise<ApiResult<ProjectRow[]>> {
  const params = new URLSearchParams();
  if (options.full !== false) params.set('full', '1');
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  try {
    const res = await fetch(`/api/projects${query ? `?${query}` : ''}`, { headers: ownerHeaders() });
    if (!res.ok) return { ok: false, ...(await readError(res)) };
    return { ok: true, value: (await res.json()) as ProjectRow[] };
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
}

/** POST /api/projects — create; 409 on duplicate client-supplied id. */
export async function createProject(body: CreateProjectBody): Promise<ApiResult<ProjectRow>> {
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, ...(await readError(res)) };
    return { ok: true, value: (await res.json()) as ProjectRow };
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
}

/** PUT /api/projects/:id — partial update with optional optimistic locking. */
export async function updateProject(id: string, body: UpdateProjectBody): Promise<ApiResult<ProjectRow>> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, ...(await readError(res)) };
    return { ok: true, value: (await res.json()) as ProjectRow };
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
}

/** DELETE /api/projects/:id — 204 No Content on success (no body to parse). */
export async function deleteProject(id: string): Promise<ApiResult<null>> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: ownerHeaders(),
    });
    if (!res.ok) return { ok: false, ...(await readError(res)) };
    return { ok: true, value: null };
  } catch {
    return { ok: false, status: 0, error: 'network error' };
  }
}
