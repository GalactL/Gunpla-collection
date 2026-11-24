import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import routes from '../../src/catalogue/routes.js';
import { importMaquettes } from '../../src/catalogue/import.js';
import { tmpDataDir } from '../helpers/index.js';
import { EXPECTED_KITS, fakeSite } from './fake-site.js';

let tmp, db, server, base, release, fail;

// The importer is injected: it serves fixtures, and can be held open to test the 409.
const importer = async ({ db }) => {
  if (release) await release;
  if (fail) {
    const err = new Error('Canal BD injoignable (fetch failed)');
    err.partial = { imported: 2, updated: 0, total: 2 };
    throw err;
  }
  return importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
};

const api = async (method, path) => {
  const res = await fetch(base + path, { method });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

before(async () => {
  tmp = tmpDataDir();
  db = openDb(tmp.dir);
  const router = createRouter();
  routes(router, { db, dataDir: tmp.dir, importer });
  server = createHttpServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
  tmp.cleanup();
});

test('status avant tout import', async () => {
  assert.deepEqual((await api('GET', '/api/import/status')).body, { running: false, last: null });
});

test('POST /api/import : 409 pendant qu’un import tourne, puis résultat et statut', async () => {
  let open;
  release = new Promise((r) => (open = r));
  const first = api('POST', '/api/import');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await api('GET', '/api/import/status')).body.running, true);
  assert.equal((await api('POST', '/api/import')).status, 409);
  release = undefined;
  open();
  const done = await first;
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { imported: EXPECTED_KITS, updated: 0, total: EXPECTED_KITS });
  const status = (await api('GET', '/api/import/status')).body;
  assert.equal(status.running, false);
  assert.equal(status.last.imported, EXPECTED_KITS);
  assert.equal(status.last.error, null);
  // second run: no duplicates
  assert.deepEqual((await api('POST', '/api/import')).body, { imported: 0, updated: EXPECTED_KITS, total: EXPECTED_KITS });
});

test('GET /api/kits : pagination, tri, total', async () => {
  const all = (await api('GET', '/api/kits?limit=100')).body;
  assert.equal(all.total, EXPECTED_KITS);
  assert.equal(all.kits.length, EXPECTED_KITS);
  const page = (await api('GET', '/api/kits?limit=5&offset=13')).body;
  assert.equal(page.total, EXPECTED_KITS);
  assert.equal(page.kits.length, 1);
  const recent = all.kits.map((k) => k.release_date);
  assert.deepEqual(recent, [...recent].sort().reverse()); // default: most recent first
  const az = (await api('GET', '/api/kits?sort=az&limit=100')).body.kits.map((k) => k.title.toLowerCase());
  assert.deepEqual(az, [...az].sort());
  const za = (await api('GET', '/api/kits?sort=za&limit=100')).body.kits.map((k) => k.title.toLowerCase());
  assert.deepEqual(za, [...az].reverse());
});

test('GET /api/kits : filtres grade, échelle, série, recherche', async () => {
  const get = async (qs) => (await api('GET', `/api/kits?limit=100&${qs}`)).body;
  const mg100 = await get('grade=MG&scale=1%2F100');
  assert.equal(mg100.total, 4);
  assert.ok(mg100.kits.every((k) => k.grade === 'MG' && k.scale === '1/100'));
  assert.equal((await get('series=UC')).total, 5);
  assert.equal((await get('franchise=Evangelion')).total, 2);
  assert.deepEqual((await get('q=fazz')).kits.map((k) => k.title), ['Fazz Ver.Ka']);
  assert.equal((await get('q=BANMK58880')).total, 1); // raw title is searchable
  assert.equal((await get('q=evangelion')).total, 2); // franchise is searchable
  assert.equal((await get('q=%25')).total, 0); // LIKE wildcards are escaped
  assert.equal((await get("q=a'%3B%20DROP%20TABLE%20kits%3B--")).total, 0);
  assert.equal((await get('grade=null')).total, 0);
});

test('GET /api/kits : kit sans grade, photo jointe', async () => {
  const k = (await api('GET', '/api/kits?q=neo%20tokyo')).body.kits[0];
  assert.equal(k.grade, null);
  assert.equal(k.photo_file, null);
  assert.equal(k.photo_kind, null);
  db.prepare("INSERT INTO photos (kit_id, kind, file, updated_at) VALUES (?, 'auto', 'x.jpg', '2026-01-01')").run(k.id);
  const again = (await api('GET', '/api/kits?q=neo%20tokyo')).body.kits[0];
  assert.deepEqual([again.photo_file, again.photo_kind], ['x.jpg', 'auto']);
});

test('GET /api/kits : paramètres invalides -> 400, limit plafonnée', async () => {
  for (const qs of ['limit=abc', 'limit=0', 'limit=101', 'offset=-1', 'offset=1.5', 'sort=hack']) {
    assert.equal((await api('GET', `/api/kits?${qs}`)).status, 400, qs);
  }
});

test('GET /api/kits/facets', async () => {
  const f = (await api('GET', '/api/kits/facets')).body;
  assert.deepEqual(f.grades.find((g) => g.value === 'MG'), { value: 'MG', count: 4 });
  assert.ok(f.scales.some((s) => s.value === '1/100' && s.count > 0));
  assert.ok(f.series.some((s) => s.value === 'UC' && s.count === 5));
  assert.ok(f.series.every((s) => s.value !== 'Macross' && s.value !== 'One Piece')); // licences are franchises, not series
  assert.deepEqual(f.franchises.map((x) => x.value), ['Gundam', 'Evangelion']);
  assert.ok(f.grades.every((g) => g.value !== null));
});

test('import en échec : 502, statut garde l’erreur et la progression', async () => {
  fail = true;
  const r = await api('POST', '/api/import');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /injoignable/);
  const status = (await api('GET', '/api/import/status')).body;
  assert.equal(status.running, false);
  assert.match(status.last.error, /injoignable/);
  assert.equal(status.last.imported, 2);
  fail = false;
});

test('franchise : seulement Gundam ou Evangelion, les anciens « Autre » et Macross des rayons Gunpla sont Gundam', async () => {
  const all = (await api('GET', '/api/kits?limit=100')).body.kits;
  assert.ok(all.every((k) => k.franchise === 'Gundam' || k.franchise === 'Evangelion'));
  const by = (t) => all.find((k) => k.title.includes(t)).franchise;
  assert.equal(by('Siegfried'), 'Gundam'); // Macross by title, Gunpla 1/100 shelf
  assert.equal(by('Northern Pod'), 'Gundam'); // no keyword recognised
  assert.equal(by('Neo Tokyo'), 'Evangelion'); // no keyword, but the Evangelion shelf
  assert.equal(by('EVA-01'), 'Evangelion');
});

test('filtre franchise=Gundam : douze kits, série null pour Evangelion', async () => {
  const g = (await api('GET', '/api/kits?limit=100&franchise=Gundam')).body;
  assert.equal(g.total, 12);
  assert.ok(g.kits.every((k) => k.franchise === 'Gundam'));
  const others = (await api('GET', '/api/kits?limit=100')).body.kits.filter((k) => k.franchise !== 'Gundam');
  assert.equal(others.length, 2);
  assert.ok(others.every((k) => k.series === null));
});

test('facets : la liste des séries suit la franchise choisie', async () => {
  const series = async (qs) => (await api('GET', `/api/kits/facets${qs}`)).body.series.map((s) => s.value);
  const gundam = await series('?franchise=Gundam');
  assert.ok(gundam.includes('UC') && gundam.includes('SEED'));
  assert.deepEqual(await series('?franchise=Macross'), []);
  assert.deepEqual(await series('?franchise=One%20Piece'), []);
  assert.deepEqual(await series('?franchise=Inconnue'), []);
});
