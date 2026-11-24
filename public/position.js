/* Position du catalogue : logique pure (la sauvegarde elle-même est dans app.js). */
export const MAX_KEPT = 500; // bound on kits re-fetched when coming back
const CHUNK = 100; // the API caps `limit` at 100

export const keyOf = (pathname, search) => `pos:${pathname}${search}`;

// Saved JSON -> { loaded, scrollY } or null for anything stale, corrupt or out of range.
export function parseSaved(raw) {
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Number.isFinite(s?.loaded) || !Number.isFinite(s.scrollY) || s.loaded < 1 || s.scrollY < 0) return null;
  return { loaded: Math.min(Math.floor(s.loaded), MAX_KEPT), scrollY: Math.round(s.scrollY) };
}

// Requests needed to go from `have` displayed kits to `want`.
export function chunks(want, have) {
  const out = [];
  const end = Math.min(want, MAX_KEPT);
  for (let offset = have; offset < end; offset += CHUNK) out.push({ offset, limit: Math.min(CHUNK, end - offset) });
  return out;
}

// True when the previous page was the catalogue (same origin, path `/`, any query).
export function fromCatalogue(referrer, origin) {
  try {
    const u = new URL(referrer);
    return u.origin === origin && u.pathname === '/';
  } catch {
    return false;
  }
}
