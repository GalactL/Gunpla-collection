import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { SCOPE_SHELVES, importMaquettes } from '../../src/catalogue/import.js';
import { tmpDataDir } from '../helpers/index.js';
import { EXPECTED_KITS, fakeSite } from './fake-site.js';

let tmp, db;
beforeEach(() => {
  tmp = tmpDataDir();
  db = openDb(tmp.dir);
});
afterEach(() => {
  db.close();
  tmp.cleanup();
});

const run = (site) => importMaquettes({ db, fetch: site.fetch, delayMs: 0 });
const ids = () => Object.fromEntries(db.prepare('SELECT source_id, id FROM kits').all().map((r) => [r.source_id, r.id]));

test('premier import puis relance : aucun doublon, ids stables', async () => {
  const first = await run(fakeSite());
  assert.deepEqual(first, { imported: EXPECTED_KITS, updated: 0, total: EXPECTED_KITS });
  const before = ids();

  const second = await run(fakeSite());
  assert.deepEqual(second, { imported: 0, updated: EXPECTED_KITS, total: EXPECTED_KITS });
  assert.deepEqual(ids(), before);
});

test('titres nettoyés, grade/échelle remplis, kit Evangelion sans grade', async () => {
  await run(fakeSite());
  const kit = (sid) => db.prepare('SELECT * FROM kits WHERE source_id = ?').get(sid);
  const fazz = kit('1327128');
  assert.equal(fazz.raw_title, 'BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA');
  assert.deepEqual([fazz.title, fazz.grade, fazz.scale, fazz.shelf], ['Fazz Ver.Ka', 'MG', '1/100', 'Gunpla 1/100']);
  const neo = kit('1400002');
  assert.equal(neo.grade, null);
  assert.equal(neo.scale, null);
  assert.equal(neo.shelf, 'Evangelion');
  // a kit listed on two shelves keeps the first (Gunpla) shelf
  assert.equal(kit('1272841').shelf, 'Gunpla 1/100');
});

test('la relance ne touche pas aux exemplaires ni aux photos', async () => {
  await run(fakeSite());
  const id = ids()['1327128'];
  db.prepare("INSERT INTO copies (kit_id, status, notes, created_at) VALUES (?, 'possede', 'mes notes', '2026-01-01')").run(id);
  db.prepare("INSERT INTO photos (kit_id, kind, file, updated_at) VALUES (?, 'user', 'a.jpg', '2026-01-01')").run(id);
  db.prepare('UPDATE kits SET title = ? WHERE id = ?').run('Ancien titre', id);

  await run(fakeSite());
  assert.equal(db.prepare('SELECT title FROM kits WHERE id = ?').get(id).title, 'Fazz Ver.Ka'); // refreshed
  const copy = db.prepare('SELECT * FROM copies').all();
  assert.equal(copy.length, 1);
  assert.deepEqual([copy[0].kit_id, copy[0].status, copy[0].notes], [id, 'possede', 'mes notes']);
  assert.equal(db.prepare('SELECT file FROM photos WHERE kit_id = ?').get(id).file, 'a.jpg');
});

test('ne demande que les quatre rayons du périmètre, jamais l’accueil, les sections adultes, Outils ni les autres rayons', async () => {
  const site = fakeSite();
  await run(site);
  const paths = site.requested.map((u) => new URL(u));
  assert.ok(paths.every((u) => u.origin === 'https://www.canalbd.net' && u.pathname === '/manga-dokaze/recherche/catalogue/'));
  assert.ok(!site.requested.some((u) => /audience|adult|genres|section-test|show_adult|shelf=13234|shelf=13233|shelf=13230/i.test(u)));
  const shelves = paths.map((u) => u.searchParams.get('shelf'));
  assert.deepEqual([...new Set(shelves)], SCOPE_SHELVES.map((s) => s.id)); // the four ids, in this order
  assert.ok(site.requested.some((u) => u.includes('shelf=13221') && u.includes('page=2'))); // pagination followed
});

test('délai entre requêtes et User-Agent générique', async () => {
  const calls = [];
  const site = fakeSite();
  const fetch = async (url, init) => (calls.push([Date.now(), init.headers['user-agent']]), site.fetch(url));
  await importMaquettes({ db, fetch, delayMs: 20 });
  assert.ok(calls.length >= 5);
  assert.ok(calls.every(([, ua]) => ua === 'gunpla-personal-importer/1.0'));
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i][0] - calls[i - 1][0] >= 15, `requête ${i} trop rapprochée`);
});

test('erreur réseau : message clair, progression déjà faite conservée', async () => {
  const site = fakeSite({ failOn: (u) => u.searchParams.get('shelf') === '13222' });
  await assert.rejects(run(site), (err) => {
    assert.match(err.message, /injoignable/);
    assert.equal(err.partial.imported, 4); // shelf 13221 was saved before the failure
    return true;
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kits').get().n, 4);
  // the next run completes without duplicating what was kept
  const done = await run(fakeSite());
  assert.deepEqual(done, { imported: EXPECTED_KITS - 4, updated: 4, total: EXPECTED_KITS });
});

test('réponse HTTP en erreur : message clair', async () => {
  const fetch = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(importMaquettes({ db, fetch, delayMs: 0 }), /503/);
});

test("import sur une base ancienne qui a encore la colonne cover_url", async () => {
  db.exec("ALTER TABLE kits ADD COLUMN cover_url TEXT");
  const stats = await run(fakeSite());
  assert.equal(stats.imported, EXPECTED_KITS);
});
