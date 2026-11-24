import { HttpError } from '../routes/index.js';
import { LINK_COLUMNS } from '../photos/store.js';

const STATUSES = ['souhaite', 'possede', 'monte'];

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const nullable = (check) => (v) => v === null || check(v);
const FIELDS = {
  status: [(v) => STATUSES.includes(v), `status doit valoir ${STATUSES.join(', ')}`],
  notes: [(v) => typeof v === 'string', 'notes doit être une chaîne'],
  price_cents: [nullable((v) => Number.isInteger(v) && v >= 0), 'price_cents doit être un entier >= 0 ou null'],
  purchased_on: [nullable(isDate), 'purchased_on doit être AAAA-MM-JJ ou null'],
  purchased_at: [nullable((v) => typeof v === 'string'), 'purchased_at doit être une chaîne ou null'],
};

// Returns the validated fields of body; throws 400 on any unknown/invalid field.
function validate(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps JSON objet attendu');
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) throw new HttpError(400, `Champ inconnu : ${k}`);
    const [ok, msg] = FIELDS[k];
    if (!ok(v)) throw new HttpError(400, msg);
    out[k] = v;
  }
  return out;
}

const SELECT = `
  SELECT c.*, k.title, k.grade, k.scale, k.series, k.franchise, k.removed, k.source_url, k.price_cents AS catalogue_price_cents,
         k.price_source, k.price_state, k.price_checked_at, p.file AS photo_file, p.kind AS photo_kind,
         ${LINK_COLUMNS}
  FROM copies c JOIN kits k ON k.id = c.kit_id LEFT JOIN photos p ON p.kit_id = c.kit_id
  LEFT JOIN image_links l ON l.kit_id = c.kit_id`;

function getCopy(db, id) {
  return db.prepare(`${SELECT} WHERE c.id = ?`).get(id);
}

export function listCopies(db) {
  return db.prepare(`${SELECT} ORDER BY c.id`).all();
}

export function createCopy(db, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps JSON objet attendu');
  const { kitId, ...rest } = body;
  if (!Number.isInteger(kitId)) throw new HttpError(400, 'kitId doit être un entier');
  if (rest.status === undefined) throw new HttpError(400, 'status est obligatoire');
  const f = validate(rest, Object.keys(FIELDS));
  if (!db.prepare('SELECT 1 FROM kits WHERE id = ?').get(kitId)) throw new HttpError(404, 'Kit introuvable');
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO copies (kit_id, status, notes, price_cents, purchased_on, purchased_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(kitId, f.status, f.notes ?? '', f.price_cents ?? null, f.purchased_on ?? null, f.purchased_at ?? null, new Date().toISOString());
  db.prepare('UPDATE kits SET hidden = 0 WHERE id = ?').run(kitId); // a kit with a copy is never masked
  return getCopy(db, Number(lastInsertRowid));
}

export function updateCopy(db, id, body) {
  if (!getCopy(db, id)) throw new HttpError(404, 'Exemplaire introuvable');
  const f = validate(body, Object.keys(FIELDS));
  const keys = Object.keys(f);
  if (!keys.length) throw new HttpError(400, 'Aucun champ à modifier');
  db.prepare(`UPDATE copies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  return getCopy(db, id);
}

export function deleteCopy(db, id) {
  if (db.prepare('DELETE FROM copies WHERE id = ?').run(id).changes === 0) throw new HttpError(404, 'Exemplaire introuvable');
}
