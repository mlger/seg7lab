/**
 * Anonymous per-browser owner identity for API persistence.
 *
 * The API layer is unauthenticated (no login), so every browser generates a
 * stable random owner token on first use. It is sent with every API request
 * via the `x-sevenseg-owner` header; the server stores it on created rows and
 * filters lists / guards writes with it. Rows created before this mechanism
 * (ownerId = null) are treated as shared/legacy: readable by everyone,
 * writable by everyone — this keeps existing demo data working.
 *
 * Client-side only (localStorage); server code must never import this module —
 * it reads the header directly.
 */

const OWNER_STORAGE_KEY = 'sevenseg-owner-v1';
const OWNER_RE = /^[a-f0-9-]{8,64}$/;

/** The HTTP header used to transmit the owner identity. */
export const OWNER_HEADER = 'x-sevenseg-owner';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers: best-effort random hex.
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * Stable owner id for this browser (created on first call, persisted in
 * localStorage). Returns '' on the server / when storage is unavailable —
 * callers should simply omit the header in that case.
 */
export function getOwnerId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (existing && OWNER_RE.test(existing)) return existing;
    const fresh = randomId();
    window.localStorage.setItem(OWNER_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

/** Request headers carrying the owner identity (for fetch calls). */
export function ownerHeaders(): Record<string, string> {
  const id = getOwnerId();
  return id ? { [OWNER_HEADER]: id } : {};
}
