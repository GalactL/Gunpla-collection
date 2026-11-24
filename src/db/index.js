import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTitle } from '../catalogue/title.js';
import { IN_SCOPE_SQL, SCOPE_LABELS, applyScope, scopeFranchise } from '../catalogue/import.js';

// Idempotent: every statement is IF NOT EXISTS, safe to run at each startup.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kits (
  id INTEGER PRIMARY KEY,
  source_id TEXT UNIQUE NOT NULL,
  raw_title TEXT NOT NULL,
  title TEXT NOT NULL,
  grade TEXT,
  scale TEXT,
  series TEXT,
  franchise TEXT,
  shelf TEXT,
  release_date TEXT,
  source_url TEXT,
  imported_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER,
  price_source TEXT,
  price_state TEXT,
  price_checked_at TEXT,
  read_at TEXT,
  removed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS photos (
  kit_id INTEGER PRIMARY KEY REFERENCES kits(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('auto','user')),
  file TEXT NOT NULL,
  source_url TEXT,
  updated_at TEXT NOT NULL,
  uncertain INTEGER NOT NULL DEFAULT 0
);
-- Fallback image by link (never downloaded). url NULL = searched, nothing found.
CREATE TABLE IF NOT EXISTS image_links (
  kit_id INTEGER PRIMARY KEY REFERENCES kits(id) ON DELETE CASCADE,
  url TEXT,
  thumb_url TEXT,
  page_url TEXT,
  uncertain INTEGER NOT NULL DEFAULT 1,
  searched_at TEXT NOT NULL
);
-- Match refusals remembered per (kit, source) so a refresh does not ask again (see RULES_VERSION in photos/fetch.js).
CREATE TABLE IF NOT EXISTS photo_refusals (
  kit_id INTEGER NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  reason TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  title_key TEXT NOT NULL,
  refused_at TEXT NOT NULL,
  PRIMARY KEY (kit_id, provider)
);
CREATE TABLE IF NOT EXISTS copies (
  id INTEGER PRIMARY KEY,
  kit_id INTEGER NOT NULL REFERENCES kits(id),
  status TEXT NOT NULL CHECK(status IN ('souhaite','possede','monte')),
  notes TEXT NOT NULL DEFAULT '',
  price_cents INTEGER,
  purchased_on TEXT,
  purchased_at TEXT,
  created_at TEXT NOT NULL
);
`;

// Kits imported before franchises existed: add the column, then derive franchise (and the Gundam-only
// series) from raw_title. Only rows with a NULL franchise are touched, so it is safe at each startup.
function migrate(db) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('kits') WHERE name = 'franchise'").get()) {
    db.exec('ALTER TABLE kits ADD COLUMN franchise TEXT');
  }
  // 'a verifier' mark on auto photos; existing photos stay 0 (never marked retroactively).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('photos') WHERE name = 'uncertain'").get()) {
    db.exec('ALTER TABLE photos ADD COLUMN uncertain INTEGER NOT NULL DEFAULT 0');
  }
  const todo = db.prepare('SELECT id, raw_title FROM kits WHERE franchise IS NULL').all();
  const set = db.prepare('UPDATE kits SET franchise = ?, series = ? WHERE id = ?');
  const needScope = !db.prepare("SELECT 1 FROM pragma_table_info('kits') WHERE name = 'hidden'").get();
  const needRemoved = !db.prepare("SELECT 1 FROM pragma_table_info('kits') WHERE name = 'removed'").get();
  db.exec('BEGIN');
  try {
    for (const k of todo) {
      const c = cleanTitle(k.raw_title);
      set.run(c.franchise, c.series, k.id);
    }
    // Catalogue scope (#16): hidden + price columns, only ALTERed when missing. The masking and the franchise
    // relabel run once, when hidden is added, so a later restart never re-hides or relabels anything.
    for (const [col, type] of [
      ['hidden', 'INTEGER NOT NULL DEFAULT 0'],
      ['price_cents', 'INTEGER'],
      ['price_source', 'TEXT'],
      ['price_state', 'TEXT'],
      ['price_checked_at', 'TEXT'],
      ['read_at', 'TEXT'],
      ['removed', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (!db.prepare("SELECT 1 FROM pragma_table_info('kits') WHERE name = ?").get(col)) db.exec(`ALTER TABLE kits ADD COLUMN ${col} ${type}`);
    }
    if (needScope) {
      applyScope(db);
      // In-scope kits not already Gundam/Evangelion ("Autre", Macross...) show under Gundam; series untouched.
      const rows = db
        .prepare(`SELECT id, raw_title, shelf FROM kits WHERE shelf IN ${IN_SCOPE_SQL} AND franchise NOT IN ('Gundam', 'Evangelion')`)
        .all(...SCOPE_LABELS);
      const relabel = db.prepare('UPDATE kits SET franchise = ? WHERE id = ?');
      for (const k of rows) relabel.run(scopeFranchise(cleanTitle(k.raw_title).franchise, k.shelf), k.id);
    }
    // Nouveautes/Supprimes (#27), once: kits already masked while their shelf is in scope were retired from the site.
    if (needRemoved) db.prepare(`UPDATE kits SET removed = 1 WHERE hidden = 1 AND shelf IN ${IN_SCOPE_SQL}`).run(...SCOPE_LABELS);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'gunpla.db'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
