/**
 * Client-side owner token: a per-browser UUID that tags every project/preset
 * this browser creates, so the API can enforce ownership (PUT/DELETE by other
 * browsers → 403/404) and filter list responses to "shared + mine".
 *
 * The token is generated once and persisted in localStorage. All access is
 * window-guarded so SSR imports are safe (return no headers server-side).
 *
 * The API accepts header `x-sevenseg-owner` matching ^[a-f0-9-]{8,64}$
 * (see ownerFromRequest in src/app/api/projects/helpers.ts and
 * src/app/api/presets/helpers.ts). A standard UUID v4
 * (36 chars, hex + dashes) satisfies that pattern.
 */

const OWNER_STORAGE_KEY = 'sevenseg-owner-token';

/** Get (or lazily create + persist) this browser's owner token. SSR → null. */
export function getOwnerToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (existing && /^[a-f0-9-]{8,64}$/.test(existing)) return existing;
    const token =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`.padEnd(8, '0');
    window.localStorage.setItem(OWNER_STORAGE_KEY, token);
    return token;
  } catch {
    // localStorage unavailable (private mode / blocked) — degrade to anonymous.
    return null;
  }
}

/** Fetch headers carrying the owner token. Empty object when unavailable. */
export function ownerHeaders(): Record<string, string> {
  const token = getOwnerToken();
  return token ? { 'x-sevenseg-owner': token } : {};
}
