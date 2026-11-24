import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import photoRoutes from '../../src/photos/routes.js';
import { SCOPE_SHELVES, applyScope, importMaquettes } from '../../src/catalogue/import.js';
import { cleanTitle } from '../../src/catalogue/title.js';
import { addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { fakeSite } from './fake-site.js';

// kits.shelf holds the label the importer wrote, never the id: these are the labels of the real database.
test('SCOPE_SHELVES : ids Canal BD et libellés réellement stockés, en un seul endroit', () => {
  assert.deepEqual(
    SCOPE_SHELVES.map((s) => [s.id, s.label]),
    [['13221', 'Gunpla 1/144'], ['13222', 'Gunpla 1/100'], ['13223', 'Gunpla 1/60 1/48'], ['13224', 'Evangelion']],
  );
});

// [source_id, raw_title, shelf label, franchise stored by the old importer, expected hidden, expected franchise after]
const OLD_KITS = [
  ['A', 'BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA', 'Gunpla 1/100', 'Gundam', 0, 'Gundam'],
  ['B', 'HG VF-31C SIEGFRIED', 'Gunpla 1/100', 'Macross', 0, 'Gundam'],
  ['C', 'BAN0002 NEO TOKYO PROTOTYPE', 'Gunpla 1/144', 'Autre', 0, 'Gundam'],
  ['D', 'BAN0001 EVANGELION GUNPLA EVA-01 TEST TYPE', 'Gunpla 1/144', 'Evangelion', 0, 'Evangelion'],
  ['E', 'BAN0003 PROTOTYPE UNIT', 'Evangelion', 'Autre', 0, 'Evangelion'],
  ['F', 'PKP68850 POKEMON POKEPLA 59 SELECT MIRAIDON', 'Pokemon', 'Pokémon', 1, 'Pokémon'],
  ['G', 'ONE PIECE MAQUETTE GRAND SHIP COLLECTION GOING MERRY', 'Maquettes diverses', 'One Piece', 0, 'One Piece'], // has a copy
  ['H', 'INITIAL D TOYOTA TRUENO AE86', 'Initial D', 'Autre', 1, 'Autre'],
  ['I', 'BAN0004 PG 1/60 RX-93 V GUNDAM UNLEASHED', 'Gunpla 1/60 1/48', 'Gundam', 0, 'Gundam'],
  ['J', 'BAN0005 SD CROSS SILHOUETTE', 'SD & BB', 'Gundam', 1, 'Gundam'],
];

// A database as it was before #16: no hidden / price columns, with photos, image links and a copy.
function oldDb(dir) {
  const old = new DatabaseSync(join(dir, 'gunpla.db'));
  old.exec(`
    CREATE TABLE kits (id INTEGER PRIMARY KEY, source_id TEXT UNIQUE NOT NULL, raw_title TEXT NOT NULL, title TEXT NOT NULL, grade TEXT, scale TEXT,
      series TEXT, franchise TEXT, shelf TEXT, release_date TEXT, source_url TEXT, cover_url TEXT, imported_at TEXT);
    CREATE TABLE photos (kit_id INTEGER PRIMARY KEY REFERENCES kits(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('auto','user')), file TEXT NOT NULL,
      source_url TEXT, updated_at TEXT NOT NULL, uncertain INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE image_links (kit_id INTEGER PRIMARY KEY REFERENCES kits(id) ON DELETE CASCADE, url TEXT, thumb_url TEXT, page_url TEXT,
      uncertain INTEGER NOT NULL DEFAULT 1, searched_at TEXT NOT NULL);
    CREATE TABLE copies (id INTEGER PRIMARY KEY, kit_id INTEGER NOT NULL REFERENCES kits(id), status TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      price_cents INTEGER, purchased_on TEXT, purchased_at TEXT, created_at TEXT NOT NULL);
  `);
  const ins = old.prepare('INSERT INTO kits (source_id, raw_title, title, grade, scale, series, franchise, shelf, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const [sid, raw, shelf, fr] of OLD_KITS) {
    const c = cleanTitle(raw);
    ins.run(sid, raw, c.title, c.grade, c.scale, c.series, fr, shelf, `https://www.canalbd.net/manga-dokaze/articles/x-${sid}/`);
  }
  const id = (sid) => old.prepare('SELECT id FROM kits WHERE source_id = ?').get(sid).id;
  old.prepare("INSERT INTO photos (kit_id, kind, file, updated_at) VALUES (?, 'auto', 'f.jpg', '2026-01-01')").run(id('F')); // photo on a masked kit
  old.prepare("INSERT INTO image_links (kit_id, url, searched_at) VALUES (?, 'https://img.example.com/h.jpg', '2026-01-01')").run(id('H'));
  old.prepare("INSERT INTO copies (kit_id, status, notes, price_cents, created_at) VALUES (?, 'possede', 'ma copie', 4200, '2026-01-01')").run(id('G'));
  old.close();
}

const snapshot = (db) => ({
  kits: db.prepare('SELECT id, source_id, raw_title, title, grade, scale, series, franchise, shelf, hidden FROM kits ORDER BY id').all().map((r) => ({ ...r })),
  photos: db.prepare('SELECT * FROM photos').all().map((r) => ({ ...r })),
  links: db.prepare('SELECT * FROM image_links').all().map((r) => ({ ...r })),
  copies: db.prepare('SELECT * FROM copies').all().map((r) => ({ ...r })),
});

test('migration d’une base ancienne, deux fois : rien supprimé, masquage et relabel, idempotent', () => {
  const tmp = tmpDataDir();
  try {
    oldDb(tmp.dir);
    const pre = new DatabaseSync(join(tmp.dir, 'gunpla.db'));
    const kitsBefore = pre.prepare('SELECT id, source_id, raw_title, title, grade, scale, series, shelf FROM kits ORDER BY id').all().map((r) => ({ ...r }));
    const photosBefore = pre.prepare('SELECT * FROM photos').all().map((r) => ({ ...r }));
    const linksBefore = pre.prepare('SELECT * FROM image_links').all().map((r) => ({ ...r }));
    const copiesBefore = pre.prepare('SELECT * FROM copies').all().map((r) => ({ ...r }));
    pre.close();

    const db1 = openDb(tmp.dir);
    const first = snapshot(db1);
    assert.equal(first.kits.length, OLD_KITS.length); // nothing deleted
    for (const [sid, , , , hidden, franchise] of OLD_KITS) {
      const k = first.kits.find((x) => x.source_id === sid);
      assert.deepEqual([sid, k.hidden, k.franchise], [sid, hidden, franchise]);
    }
    assert.equal(first.kits.filter((k) => !k.hidden).length, 7);
    // titles, series, photos, links, copies untouched
    const cols = ['id', 'source_id', 'raw_title', 'title', 'grade', 'scale', 'series', 'shelf'];
    assert.deepEqual(first.kits.map((k) => Object.fromEntries(cols.map((c) => [c, k[c]]))), kitsBefore);
    assert.deepEqual(first.photos, photosBefore);
    assert.deepEqual(first.links, linksBefore);
    assert.deepEqual(first.copies, copiesBefore);
    // the new columns exist and are empty
    const k = db1.prepare('SELECT price_cents, price_source, price_state, price_checked_at FROM kits').get();
    assert.deepEqual({ ...k }, { price_cents: null, price_source: null, price_state: null, price_checked_at: null });
    db1.close();

    const db2 = openDb(tmp.dir); // second start: same result
    assert.deepEqual(snapshot(db2), first);
    db2.close();
  } finally {
    tmp.cleanup();
  }
});

test('API : kits masqués absents de /api/kits, de son total et des facettes ; facettes = Gundam + Evangelion', async () => {
  const tmp = tmpDataDir();
  try {
    oldDb(tmp.dir);
    const app = await startApp(tmp.dir);
    try {
      const all = (await app.api('GET', '/api/kits?limit=100')).body;
      assert.equal(all.total, 7);
      assert.equal(all.kits.length, 7);
      assert.ok(!all.kits.some((k) => ['F', 'H', 'J'].includes(k.source_id)));
      assert.equal((await app.api('GET', '/api/kits?q=miraidon')).body.total, 0);
      assert.equal((await app.api('GET', '/api/kits?q=initial')).body.total, 0);
      const f = (await app.api('GET', '/api/kits/facets')).body;
      assert.deepEqual(f.franchises.map((x) => x.value), ['Gundam', 'Evangelion', 'One Piece']); // One Piece: the kit that has a copy
      // the masked kits still exist in the database
      assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM kits').get().n, OLD_KITS.length);
    } finally {
      await app.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('kit masqué avec exemplaire : jamais masqué (migration, applyScope), exemplaire gardé dans la collection', async () => {
  const tmp = tmpDataDir();
  try {
    oldDb(tmp.dir);
    const app = await startApp(tmp.dir);
    try {
      const copies = (await app.api('GET', '/api/copies')).body;
      assert.equal(copies.length, 1);
      assert.equal(copies[0].title, cleanTitle(OLD_KITS[6][1]).title);
      const g = app.db.prepare("SELECT id FROM kits WHERE source_id = 'G'").get().id;
      applyScope(app.db); // re-running the rule keeps it
      assert.equal(app.db.prepare('SELECT hidden FROM kits WHERE id = ?').get(g).hidden, 0);
      // a copy created on a masked kit unmasks it and the rule keeps it so
      const f = app.db.prepare("SELECT id FROM kits WHERE source_id = 'F'").get().id;
      assert.equal(app.db.prepare('SELECT hidden FROM kits WHERE id = ?').get(f).hidden, 1);
      assert.equal((await app.api('POST', '/api/copies', { kitId: f, status: 'souhaite' })).status, 201);
      applyScope(app.db);
      assert.equal(app.db.prepare('SELECT hidden FROM kits WHERE id = ?').get(f).hidden, 0);
      // delete the copy: the kit, now out of scope without copy, is masked again by the rule
      for (const c of (await app.api('GET', '/api/copies')).body) if (c.kit_id === f) await app.api('DELETE', `/api/copies/${c.id}`);
      applyScope(app.db);
      assert.equal(app.db.prepare('SELECT hidden FROM kits WHERE id = ?').get(f).hidden, 1);
    } finally {
      await app.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('import : un kit hors périmètre reste masqué, un kit du périmètre est visible, relancer ne duplique rien', async () => {
  const tmp = tmpDataDir();
  try {
    oldDb(tmp.dir);
    const db = openDb(tmp.dir);
    const site = fakeSite();
    const first = await importMaquettes({ db, fetch: site.fetch, delayMs: 0 });
    const second = await importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
    assert.equal(second.imported, 0);
    assert.equal(second.total, first.total);
    const hidden = (sid) => db.prepare('SELECT hidden FROM kits WHERE source_id = ?').get(sid).hidden;
    assert.deepEqual(['F', 'H', 'J'].map(hidden), [1, 1, 1]); // the import never unhides them
    assert.equal(hidden('G'), 0); // copy
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kits WHERE hidden = 0 AND shelf IS NULL').get().n, 0);
    const shelves = new Set(db.prepare('SELECT DISTINCT shelf FROM kits WHERE hidden = 0 AND source_id NOT IN (\'G\')').all().map((r) => r.shelf));
    assert.ok([...shelves].every((s) => SCOPE_SHELVES.some((x) => x.label === s)));
    db.close();
  } finally {
    tmp.cleanup();
  }
});

test('champs de prix et source_url dans /api/kits et dans les exemplaires de la collection', async () => {
  const tmp = tmpDataDir();
  try {
    const app = await startApp(tmp.dir);
    try {
      const id = addRealKit(app.db, 1, 'BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA');
      app.db.prepare("UPDATE kits SET source_url = 'https://www.canalbd.net/x-1/', price_cents = 1290, price_source = 'canalbd', price_state = 'priced', price_checked_at = '2026-11-23T10:00:00.000Z' WHERE id = ?").run(id);
      const k = (await app.api('GET', '/api/kits')).body.kits[0];
      assert.deepEqual(
        [k.source_url, k.price_cents, k.price_source, k.price_state, k.price_checked_at],
        ['https://www.canalbd.net/x-1/', 1290, 'canalbd', 'priced', '2026-11-23T10:00:00.000Z'],
      );
      const c = (await app.api('POST', '/api/copies', { kitId: id, status: 'possede', price_cents: 999 })).body;
      for (const row of [c, (await app.api('GET', '/api/copies')).body[0]]) {
        assert.equal(row.price_cents, 999); // « Prix payé » : the copy's own price, never the catalogue price
        assert.deepEqual(
          [row.source_url, row.catalogue_price_cents, row.price_source, row.price_state, row.price_checked_at],
          ['https://www.canalbd.net/x-1/', 1290, 'canalbd', 'priced', '2026-11-23T10:00:00.000Z'],
        );
      }
      // never relevé: all NULL
      const other = addRealKit(app.db, 2, 'HG 1/144 GUNDAM AERIAL');
      assert.equal((await app.api('POST', '/api/copies', { kitId: other, status: 'souhaite' })).body.price_state, null);
    } finally {
      await app.close();
    }
  } finally {
    tmp.cleanup();
  }
});

// Photo refresh job with a recording provider.
test('récupération des photos : les kits masqués ne sont jamais interrogés', async () => {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const router = createRouter();
  const hljCalls = [];
  const provider = { name: 'rec', find: async (name) => (hljCalls.push(name), null) };
  photoRoutes(router, { db, dataDir: tmp.dir, delayMs: 0, providers: [provider] });
  const server = createServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const log = console.error;
  console.error = () => {};
  try {
    addRealKit(db, 1, 'HG 1/144 GUNDAM AERIAL');
    const masked = addRealKit(db, 2, 'MG 1/100 SINANJU MASQUE');
    db.prepare('UPDATE kits SET hidden = 1 WHERE id = ?').run(masked);
    assert.equal((await fetch(`${base}/api/photos/refresh`, { method: 'POST' })).status, 202);
    for (;;) {
      await new Promise((r) => setTimeout(r, 5));
      const st = await (await fetch(`${base}/api/photos/status`)).json();
      if (!st.running) break;
    }
    assert.equal(hljCalls.length, 1);
    assert.ok(!hljCalls.some((q) => /masque/i.test(q)));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_links WHERE kit_id = ?').get(masked).n, 0);
  } finally {
    console.error = log;
    server.closeAllConnections();
    server.close();
    db.close();
    tmp.cleanup();
  }
});
