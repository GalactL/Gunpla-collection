import { BASE_URL, parseListing } from './parse.js';
import { cleanTitle } from './title.js';

const USER_AGENT = 'gunpla-personal-importer/1.0';
const HOME = '/manga-dokaze/';

// The only shelves imported and shown (spec #16). `label` is what kits.shelf stores (the importer writes the
// label, not the id): this table is the single id <-> label mapping. Fetched in this order, no menu lookup.
export const SCOPE_SHELVES = [
  { id: '13221', label: 'Gunpla 1/144' },
  { id: '13222', label: 'Gunpla 1/100' },
  { id: '13223', label: 'Gunpla 1/60 1/48' },
  { id: '13224', label: 'Evangelion' },
];
export const SCOPE_LABELS = SCOPE_SHELVES.map((s) => s.label);
export const IN_SCOPE_SQL = `(${SCOPE_LABELS.map(() => '?').join(',')})`; // bind SCOPE_LABELS

// Franchise of a visible kit: Evangelion (title or shelf), otherwise Gundam.
export const scopeFranchise = (titleFranchise, shelfLabel) =>
  titleFranchise === 'Evangelion' || shelfLabel === 'Evangelion' ? 'Evangelion' : 'Gundam';

// Masking rule, one place: hidden = (shelf outside the scope OR retired from the source) AND no copy.
// `since` (ISO) is the start of a successful import: a kit not re-imported since then was retired. Never
// deletes (photo kept). Without `since` (failed/empty/partial import) an already hidden kit stays hidden unless
// it has a copy; the upsert (hidden = 0) is what unhides a kit that came back.
export function applyScope(db, since = null) {
  db.prepare(
    `UPDATE kits SET hidden = CASE WHEN (shelf IS NULL OR shelf NOT IN ${IN_SCOPE_SQL} OR imported_at < ?)
       AND NOT EXISTS (SELECT 1 FROM copies c WHERE c.kit_id = kits.id) THEN 1
       WHEN ? IS NULL AND hidden = 1 AND NOT EXISTS (SELECT 1 FROM copies c WHERE c.kit_id = kits.id) THEN 1
       ELSE 0 END`,
  ).run(...SCOPE_LABELS, since, since);
  // Supprimé (#27): in scope but absent from a successful import. Only the upsert resets it; without `since` it is left alone.
  if (since) db.prepare(`UPDATE kits SET removed = 1 WHERE shelf IN ${IN_SCOPE_SQL} AND imported_at < ?`).run(...SCOPE_LABELS, since);
}

const MAX_PAGES = 200;

// Only the scope shelves are ever requested: no adult section, no age-gate form.
const ALLOWED = new RegExp(`^${HOME}recherche/catalogue/\\?shelf=\\d+(?:&[\\w=]+)*$`);

const UPSERT = `
INSERT INTO kits (source_id, raw_title, title, grade, scale, series, franchise, shelf, release_date, source_url, imported_at, hidden)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(source_id) DO UPDATE SET
  raw_title = excluded.raw_title, title = excluded.title, grade = excluded.grade, scale = excluded.scale,
  series = excluded.series, franchise = excluded.franchise, shelf = excluded.shelf,
  release_date = COALESCE(excluded.release_date, kits.release_date),
  source_url = excluded.source_url,
  imported_at = excluded.imported_at, hidden = 0, removed = 0`; // read_at is never touched

export async function importMaquettes({ db, fetch = globalThis.fetch, delayMs = 1100, log = () => {} }) {
  const stats = { imported: 0, updated: 0, total: 0 };
  const startedAt = new Date().toISOString();
  let emptyShelf = false;
  let requests = 0;

  const get = async (path) => {
    if (!ALLOWED.test(path)) throw new Error(`URL non autorisée : ${path}`);
    if (requests++) await new Promise((r) => setTimeout(r, delayMs));
    let res;
    try {
      res = await fetch(BASE_URL + path, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
    } catch (err) {
      throw new Error(`Canal BD injoignable (${err.message})`, { cause: err });
    }
    if (!res.ok) throw new Error(`Canal BD a répondu ${res.status} pour ${path}`);
    return res.text();
  };

  const exists = db.prepare('SELECT 1 FROM kits WHERE source_id = ?');
  const upsert = db.prepare(UPSERT);
  const seen = new Set(); // a kit listed on two shelves counts once; the first shelf wins

  try {
    for (const shelf of SCOPE_SHELVES) {
      let page = 1;
      let listed = 0;
      while (page && page <= MAX_PAGES) {
        const qs = `shelf=${shelf.id}&results_per_page=30&sort=newest${page > 1 ? `&page=${page}` : ''}`;
        const { kits, nextPage } = parseListing(await get(`${HOME}recherche/catalogue/?${qs}`));
        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          for (const k of kits) {
            if (seen.has(k.source_id)) continue;
            seen.add(k.source_id);
            const existed = !!exists.get(k.source_id);
            const c = cleanTitle(k.raw_title);
            upsert.run(k.source_id, k.raw_title, c.title, c.grade, c.scale, c.series, scopeFranchise(c.franchise, shelf.label), shelf.label, k.release_date, k.source_url, now);
            stats[existed ? 'updated' : 'imported']++;
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        listed += kits.length;
        log(`${shelf.label} page ${page} : ${kits.length} kits`);
        page = nextPage > page ? nextPage : 0;
      }
      if (!listed) emptyShelf = true;
    }
  } catch (err) {
    applyScope(db);
    stats.total = db.prepare('SELECT COUNT(*) AS n FROM kits').get().n;
    err.partial = stats; // earlier pages are already saved
    throw err;
  }
  // Safety net: retire kits only after a full run where every shelf listed something; an empty or
  // blocked page must never hide the catalogue.
  applyScope(db, seen.size && !emptyShelf ? startedAt : null);
  stats.total = db.prepare('SELECT COUNT(*) AS n FROM kits').get().n;
  return stats;
}
