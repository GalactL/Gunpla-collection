import { HttpError } from '../routes/index.js';
import { importMaquettes } from './import.js';
import { LINK_COLUMNS, LINK_UNCERTAIN_SQL } from '../photos/store.js';
import { FRANCHISES } from './title.js';
import { gradeList } from '../../public/render.js';

const SORTS = {
  recent: 'k.release_date IS NULL, k.release_date DESC, k.id DESC',
  az: 'k.title COLLATE NOCASE ASC, k.id ASC',
  za: 'k.title COLLATE NOCASE DESC, k.id DESC',
  // Unpriced kits last in both directions; id breaks ties so pages never overlap.
  price_asc: 'k.price_cents IS NULL, k.price_cents ASC, k.id ASC',
  price_desc: 'k.price_cents IS NULL, k.price_cents DESC, k.id DESC',
};
const MAX_LIMIT = 100;
// Nouveau (#27): released in the last 30 days (no upper bound: a pre-order is new) and not read. A NULL date never matches.
const NEW_SQL = "k.release_date >= date('now', 'localtime', '-30 day') AND k.read_at IS NULL";
const kitIdOf = (raw) => {
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new HttpError(404, 'Introuvable');
  return Number(raw);
};

const intParam = (query, name, def, min, max) => {
  const raw = query.get(name);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Paramètre « ${name} » invalide`);
  return n;
};

const facet = (db, col, where = '', args = []) =>
  db
    .prepare(`SELECT ${col} AS value, COUNT(*) AS count FROM kits WHERE ${col} IS NOT NULL AND hidden = 0 AND removed = 0${where} GROUP BY ${col} ORDER BY ${col} COLLATE NOCASE`)
    .all(...args);

// ctx.importer is injectable so tests can serve fixtures instead of the real site.
export default function routes(router, { db, importer = importMaquettes, jobs = {} }) {
  let running = false;
  let last = null;

  jobs.import = async () => {
    if (running) throw new HttpError(409, 'Un import est déjà en cours');
    running = true;
    try {
      const stats = await importer({ db });
      last = { at: new Date().toISOString(), ...stats, error: null };
      return stats;
    } catch (err) {
      last = { at: new Date().toISOString(), imported: 0, updated: 0, total: 0, ...err.partial, error: err.message };
      throw new HttpError(502, `Import interrompu : ${err.message}`);
    } finally {
      running = false;
    }
  };
  router.add('POST', '/api/import', () => jobs.import());

  router.add('GET', '/api/import/status', () => ({ running, last }));

  // ?franchise=X scopes the series list to that franchise.
  router.add('GET', '/api/kits/facets', (req, res, { query } = {}) => {
    const fr = query?.get('franchise');
    return {
      grades: facet(db, 'grade'),
      scales: facet(db, 'scale'),
      franchises: facet(db, 'franchise').sort((a, b) => FRANCHISES.indexOf(a.value) - FRANCHISES.indexOf(b.value)),
      series: fr ? facet(db, 'series', ' AND franchise = ?', [fr]) : facet(db, 'series'),
      news: db.prepare(`SELECT COUNT(*) AS n FROM kits k WHERE k.hidden = 0 AND k.removed = 0 AND ${NEW_SQL}`).get().n,
      removed: db.prepare('SELECT COUNT(*) AS n FROM kits WHERE removed = 1').get().n,
    };
  });

  // Marks as read (read_at is kept once set); « tout » = every kit currently new.
  router.add('POST', '/api/kits/read', () => ({
    marked: Number(db.prepare(`UPDATE kits AS k SET read_at = ? WHERE k.hidden = 0 AND k.removed = 0 AND ${NEW_SQL}`).run(new Date().toISOString()).changes),
  }));
  router.add('POST', '/api/kits/:id/read', (req, res, { params }) => {
    const id = kitIdOf(params.id);
    const r = db.prepare('UPDATE kits SET read_at = COALESCE(read_at, ?) WHERE id = ? RETURNING read_at').get(new Date().toISOString(), id);
    if (!r) throw new HttpError(404, 'Kit introuvable');
    return { id, read_at: r.read_at };
  });

  router.add('GET', '/api/kits', (req, res, { query }) => {
    const sort = query.get('sort') || 'recent';
    if (!Object.hasOwn(SORTS, sort)) throw new HttpError(400, 'Paramètre « sort » invalide');
    const limit = intParam(query, 'limit', 50, 1, MAX_LIMIT);
    const offset = intParam(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);

    const args = [];
    const id = Number(query.get('id'));
    // Masked kits (outside the Gundam/Evangelion scope) never show; removed kits only in their own view or by id (their page).
    const byId = Number.isInteger(id) && id > 0;
    const where = byId ? ['(k.hidden = 0 OR k.removed = 1)', 'k.id = ?'] : query.get('removed') === '1' ? ['k.removed = 1'] : ['k.hidden = 0 AND k.removed = 0'];
    if (byId) args.push(id);
    if (query.get('new') === '1') where.push(NEW_SQL);
    const q = (query.get('q') || '').trim();
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(k.title LIKE ? ESCAPE '\\' OR k.raw_title LIKE ? ESCAPE '\\' OR k.series LIKE ? ESCAPE '\\' OR k.franchise LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
    const gl = gradeList(query.get('grade'));
    if (gl.length) (where.push(`k.grade IN (${gl.map(() => '?').join(',')})`), args.push(...gl));
    for (const col of ['scale', 'franchise', 'series']) {
      const v = query.get(col);
      if (v) {
        where.push(`k.${col} = ?`);
        args.push(v);
      }
    }
    const pmin = intParam(query, 'price_min', null, 0, Number.MAX_SAFE_INTEGER);
    const pmax = intParam(query, 'price_max', null, 0, Number.MAX_SAFE_INTEGER);
    if (pmin !== null && pmax !== null && pmin > pmax) throw new HttpError(400, 'Paramètre « price_min » invalide');
    // A NULL price never satisfies a comparison, so unpriced kits drop out once a bound is set.
    if (pmin !== null) (where.push('k.price_cents >= ?'), args.push(pmin));
    if (pmax !== null) (where.push('k.price_cents <= ?'), args.push(pmax));
    if (query.get('uncertain') === '1') where.push(`${LINK_UNCERTAIN_SQL} = 1`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM kits k LEFT JOIN photos p ON p.kit_id = k.id LEFT JOIN image_links l ON l.kit_id = k.id ${clause}`).get(...args).n;
    const kits = db
      .prepare(
        `SELECT k.id, k.source_id, k.raw_title, k.title, k.grade, k.scale, k.series, k.franchise, k.shelf, k.release_date,
                k.source_url, k.read_at, k.removed, CASE WHEN k.removed = 0 AND ${NEW_SQL} THEN 1 ELSE 0 END AS is_new, k.price_cents, k.price_source, k.price_state, k.price_checked_at, p.file AS photo_file, p.kind AS photo_kind,
                ${LINK_COLUMNS}
         FROM kits k LEFT JOIN photos p ON p.kit_id = k.id LEFT JOIN image_links l ON l.kit_id = k.id ${clause}
         ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset);
    return { total, kits };
  });
}
