import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HttpError } from '../routes/index.js';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Image type from magic bytes only (never trust Content-Type or file names).
function detectExt(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export const photosDir = (dataDir) => join(dataDir, 'photos');
export const getPhoto = (db, kitId) => db.prepare('SELECT * FROM photos WHERE kit_id = ?').get(kitId);

// Shared by the catalogue and the collection: JOIN image_links as l (and photos as p) to use these.
// A local photo always wins; a link only counts when it has a url (NULL = searched, nothing found).
export const LINK_UNCERTAIN_SQL = 'COALESCE(p.uncertain, CASE WHEN l.url IS NOT NULL THEN l.uncertain END, 0)';
export const LINK_COLUMNS = `CASE WHEN p.kit_id IS NULL THEN l.url END AS photo_link,
  CASE WHEN p.kit_id IS NULL THEN l.thumb_url END AS photo_thumb,
  ${LINK_UNCERTAIN_SQL} AS photo_uncertain`;

export const getLink = (db, kitId) => db.prepare('SELECT * FROM image_links WHERE kit_id = ?').get(kitId);
export const deleteLink = (db, kitId) => void db.prepare('DELETE FROM image_links WHERE kit_id = ?').run(kitId);

// A link is only ever shown by the browser: https, no credentials, bounded, no whitespace/control characters.
export function validLink(v, required) {
  if (v == null) return !required;
  if (typeof v !== 'string' || !v || v.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

const canWriteLink = (db, kitId) =>
  Number.isSafeInteger(kitId) && db.prepare('SELECT 1 FROM kits WHERE id = ?').get(kitId) && !getPhoto(db, kitId);

// Stores an uncertain link; returns null (never throws) for an invalid link, an unknown kit or a kit with a local photo.
export function saveLink({ db, kitId, url, thumbUrl = null, pageUrl = null }) {
  if (!validLink(url, true) || !validLink(thumbUrl, false) || !validLink(pageUrl, false)) return null;
  if (!canWriteLink(db, kitId)) return null;
  db.prepare(
    `INSERT INTO image_links (kit_id, url, thumb_url, page_url, uncertain, searched_at) VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(kit_id) DO UPDATE SET url = excluded.url, thumb_url = excluded.thumb_url, page_url = excluded.page_url,
       uncertain = 1, searched_at = excluded.searched_at`,
  ).run(kitId, url, thumbUrl, pageUrl, new Date().toISOString());
  return { url, thumbUrl, pageUrl };
}

// Remembers "searched, nothing found" (url NULL); never overwrites an existing row.
export function markSearched(db, kitId) {
  if (!canWriteLink(db, kitId)) return false;
  db.prepare('INSERT OR IGNORE INTO image_links (kit_id, url, searched_at) VALUES (?, NULL, ?)').run(kitId, new Date().toISOString());
  return true;
}

// 'auto' never replaces a 'user' photo (returns null); 'user' replaces anything.
// Synchronous end to end, so the check and the write cannot interleave.
export function savePhoto({ db, dataDir, kitId, bytes, kind, sourceUrl = null, uncertain = false }) {
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'Image trop volumineuse (8 Mo max)');
  const ext = detectExt(bytes);
  if (!ext) throw new HttpError(400, "Format d'image non reconnu (JPEG, PNG ou WebP attendu)");
  if (!db.prepare('SELECT 1 FROM kits WHERE id = ?').get(kitId)) throw new HttpError(404, 'Kit introuvable');
  const old = getPhoto(db, kitId);
  if (kind === 'auto' && old?.kind === 'user') return null;

  const dir = photosDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const file = `${kitId}.${ext}`;
  const tmp = join(dir, `${file}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, bytes);
  renameSync(tmp, join(dir, file));
  db.prepare(
    `INSERT INTO photos (kit_id, kind, file, source_url, updated_at, uncertain) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kit_id) DO UPDATE SET kind = excluded.kind, file = excluded.file,
       source_url = excluded.source_url, updated_at = excluded.updated_at, uncertain = excluded.uncertain`,
  ).run(kitId, kind, file, sourceUrl, new Date().toISOString(), kind === 'auto' && uncertain ? 1 : 0);
  deleteLink(db, kitId); // a local photo replaces any fallback link
  if (old && old.file !== file) {
    const oldPath = join(dir, basename(old.file));
    if (existsSync(oldPath)) unlinkSync(oldPath);
  }
  return { file, kind };
}
