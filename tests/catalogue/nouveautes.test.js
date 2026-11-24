import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { openDb } from '../../src/db/index.js';
import { importMaquettes } from '../../src/catalogue/import.js';
import { addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { fakeSite, EXPECTED_KITS } from './fake-site.js';

// Local date, like SQLite's date('now','localtime'); noon avoids DST edges when shifting by days.
const day = (offset) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const text = async (app, path) => (await fetch(app.base + path)).text();
const ids = async (app, qs = '') => (await app.api('GET', `/api/kits?limit=100${qs}`)).body.kits.map((k) => k.id).sort((a, b) => a - b);
const row = (db, id) => ({ ...db.prepare('SELECT hidden, removed, read_at, imported_at FROM kits WHERE id = ?').get(id) });

// A kit as the importer would have left it (in scope unless a shelf is given).
function kit(db, n, { date, shelf = 'Gunpla 1/100', at = new Date().toISOString(), hidden = 0, removed = 0 } = {}) {
  const id = addRealKit(db, n, `MG 1/100 KIT NUMERO ${n}`, 'Gundam');
  db.prepare('UPDATE kits SET release_date = ?, shelf = ?, imported_at = ?, hidden = ?, removed = ? WHERE id = ?').run(date ?? null, shelf, at, hidden, removed, id);
  return id;
}

const withApp = (fn) => async () => {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    await fn(app, tmp);
  } finally {
    await app.close();
    tmp.cleanup();
  }
};

test('nouveau : fenêtre de 30 jours, bornes, date absente, précommande ; reste dans le catalogue général', withApp(async (app) => {
  const k10 = kit(app.db, 1, { date: day(-10) });
  const k30 = kit(app.db, 2, { date: day(-30) }); // boundary: included
  const k31 = kit(app.db, 3, { date: day(-31) });
  const none = kit(app.db, 4, { date: null });
  const future = kit(app.db, 5, { date: day(20) }); // pre-order: new
  assert.deepEqual(await ids(app, '&new=1'), [k10, k30, future]);
  assert.deepEqual(await ids(app), [k10, k30, k31, none, future]); // « Nouveau » kits stay in the general catalogue
  const all = (await app.api('GET', '/api/kits?limit=100')).body.kits;
  assert.deepEqual(all.map((k) => [k.id, k.is_new]).sort((a, b) => a[0] - b[0]), [[k10, 1], [k30, 1], [k31, 0], [none, 0], [future, 1]]);
  assert.equal((await app.api('GET', '/api/kits/facets')).body.news, 3);
  assert.equal((await app.api('GET', `/api/kits?new=1&q=NUMERO%201`)).body.total, 1); // composes with the other filters
  assert.equal((await app.api('GET', `/api/kits?new=1&grade=PG`)).body.total, 0);
  assert.equal((await app.api('GET', `/api/kits?new=0&limit=100`)).body.total, 5); // only new=1 filters
}));

test('marquer comme lu : un kit, ou tous ; persistant, jamais réécrit, 404 propre, origine étrangère refusée', withApp(async (app) => {
  const a = kit(app.db, 1, { date: day(-5) });
  const b = kit(app.db, 2, { date: day(-6) });
  const old = kit(app.db, 3, { date: day(-90) });
  const r = await app.api('POST', `/api/kits/${a}/read`);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, a);
  assert.deepEqual(await ids(app, '&new=1'), [b]);
  const first = row(app.db, a).read_at;
  assert.ok(first);
  await app.api('POST', `/api/kits/${a}/read`);
  assert.equal(row(app.db, a).read_at, first, 'read_at is set once');
  assert.equal((await app.api('POST', '/api/kits/999999/read')).status, 404);
  assert.equal((await app.api('POST', '/api/kits/abc/read')).status, 404);

  const all = await app.api('POST', '/api/kits/read');
  assert.deepEqual(all.body, { marked: 1 }); // only b: a is read, old is not new
  assert.equal(row(app.db, old).read_at, null);
  assert.deepEqual(await ids(app, '&new=1'), []);
  assert.equal((await app.api('GET', '/api/kits/facets')).body.news, 0);

  const evil = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: app.server.address().port, method: 'POST', path: `/api/kits/${old}/read`, headers: { origin: 'http://evil.example' } }, (res) => (res.resume(), resolve(res.statusCode)));
    req.on('error', reject);
    req.end();
  });
  assert.equal(evil, 403);
  assert.equal(row(app.db, old).read_at, null);
}));

test('import : read_at jamais touché, removed remis à 0 quand le kit revient', withApp(async (app) => {
  await importMaquettes({ db: app.db, fetch: fakeSite().fetch, delayMs: 0 });
  const id = app.db.prepare('SELECT id FROM kits LIMIT 1').get().id;
  app.db.prepare("UPDATE kits SET read_at = '2026-11-01T00:00:00.000Z', removed = 1 WHERE id = ?").run(id);
  await importMaquettes({ db: app.db, fetch: fakeSite().fetch, delayMs: 0 });
  assert.deepEqual(row(app.db, id).read_at, '2026-11-01T00:00:00.000Z');
  assert.equal(row(app.db, id).removed, 0);
}));

test('supprimé : positionné par un import réussi (périmètre seulement), hors du général, dans ?removed=1 ; import raté ou vide : rien ne bouge', withApp(async (app) => {
  await importMaquettes({ db: app.db, fetch: fakeSite().fetch, delayMs: 0 });
  const old = '2020-01-01T00:00:00.000Z';
  const gone = kit(app.db, 101, { at: old, date: day(-3) });
  const owned = kit(app.db, 102, { at: old });
  await app.api('POST', '/api/copies', { kitId: owned, status: 'possede' });
  const outside = kit(app.db, 103, { at: old, shelf: 'Pokemon', hidden: 1 });

  // failed run (network) and empty run: nothing becomes removed
  const boom = fakeSite({ failOn: (u) => u.searchParams.get('shelf') === '13222' });
  await assert.rejects(importMaquettes({ db: app.db, fetch: boom.fetch, delayMs: 0 }));
  const empty = async () => ({ ok: true, status: 200, text: async () => '<html><body><section class="six-landscape-grid"></section></body></html>' });
  await importMaquettes({ db: app.db, fetch: empty, delayMs: 0 });
  assert.deepEqual([gone, owned, outside].map((i) => row(app.db, i).removed), [0, 0, 0]);
  app.db.prepare('UPDATE kits SET removed = 1 WHERE id = ?').run(gone);
  await assert.rejects(importMaquettes({ db: app.db, fetch: boom.fetch, delayMs: 0 }));
  assert.equal(row(app.db, gone).removed, 1, 'a failed run does not bring it back either');
  app.db.prepare('UPDATE kits SET removed = 0 WHERE id = ?').run(gone);

  await importMaquettes({ db: app.db, fetch: fakeSite().fetch, delayMs: 0 });
  assert.deepEqual([gone, owned, outside].map((i) => row(app.db, i).removed), [1, 1, 0]); // never removed outside the scope
  assert.deepEqual([gone, owned].map((i) => row(app.db, i).hidden), [1, 0]);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM kits WHERE removed = 1').get().n, 2);

  const list = (await app.api('GET', '/api/kits?limit=100')).body;
  assert.equal(list.total, EXPECTED_KITS);
  assert.ok(![gone, owned].some((i) => list.kits.some((k) => k.id === i)));
  assert.deepEqual(await ids(app, '&removed=1'), [gone, owned]);
  assert.ok((await app.api('GET', '/api/kits?removed=1&limit=100')).body.kits.every((k) => k.removed === 1));
  assert.deepEqual(await ids(app, '&removed=1&new=1'), [gone]); // composes: only `gone` is also recent
  const f = (await app.api('GET', '/api/kits/facets')).body;
  assert.equal(f.removed, 2);
  assert.equal(f.news, 0, 'a removed kit is not counted in Nouveautés');
  assert.match(await text(app, '/'), new RegExp(`id="n-kits">${EXPECTED_KITS}<`)); // header count
}));

test('supprimé : kit revenu sur le site = removed 0', withApp(async (app) => {
  await importMaquettes({ db: app.db, fetch: fakeSite().fetch, delayMs: 0 });
  const id = app.db.prepare("SELECT id FROM kits WHERE shelf = 'Gunpla 1/100' LIMIT 1").get().id;
  app.db.prepare('UPDATE kits SET removed = 1, hidden = 1 WHERE id = ?').run(id);
  await importMaquettes({ db: app.db, fetch: fakeSite().fetch, delayMs: 0 });
  assert.deepEqual([row(app.db, id).removed, row(app.db, id).hidden], [0, 0]);
}));

test('migration unique : kits masqués du périmètre -> removed = 1, hors périmètre intact, relance sans effet', () => {
  const tmp = tmpDataDir();
  try {
    let db = openDb(tmp.dir);
    const inScope = kit(db, 1, { hidden: 1 });
    const outside = kit(db, 2, { shelf: 'Pokemon', hidden: 1 });
    const visible = kit(db, 3);
    db.exec('ALTER TABLE kits DROP COLUMN removed; ALTER TABLE kits DROP COLUMN read_at'); // a database from before #27
    db.close();
    db = openDb(tmp.dir);
    assert.deepEqual([inScope, outside, visible].map((i) => row(db, i).removed), [1, 0, 0]);
    db.prepare('UPDATE kits SET removed = 0 WHERE id = ?').run(inScope);
    db.close();
    db = openDb(tmp.dir); // once only: a restart does not redo it
    assert.equal(row(db, inScope).removed, 0);
    db.close();
  } finally {
    tmp.cleanup();
  }
});

test('collection : un kit supprimé possédé garde sa ligne avec le badge « Supprimé »', withApp(async (app) => {
  const a = kit(app.db, 1, { removed: 1 });
  const b = kit(app.db, 2);
  for (const k of [a, b]) await app.api('POST', '/api/copies', { kitId: k, status: 'possede' });
  const copies = (await app.api('GET', '/api/copies')).body;
  assert.deepEqual(copies.map((c) => c.removed), [1, 0]);
  const html = await text(app, '/collection');
  assert.equal(html.match(/<span class="tag gone">Supprimé<\/span>/g).length, 1);
  assert.equal((await app.api('GET', `/api/kits?removed=1`)).body.total, 1); // still listed in Supprimés
  assert.equal((await app.api('GET', `/api/kits?limit=100`)).body.total, 1); // but not in the general catalogue
}));

test('rendu : badges, filtres Nouveautés / Supprimés, exclusion mutuelle, bouton « Tout marquer comme lu », page du kit', withApp(async (app) => {
  const fresh = kit(app.db, 1, { date: day(-2) });
  const stale = kit(app.db, 2, { date: day(-60) });
  const gone = kit(app.db, 3, { removed: 1, hidden: 1 });
  const hiddenOnly = kit(app.db, 4, { shelf: 'Pokemon', hidden: 1 });

  const home = await text(app, '/');
  assert.match(home, /<input type="checkbox" name="new" value="1"> Nouveautés \(<span id="nnew">1<\/span>\)/);
  assert.match(home, /<input type="checkbox" name="removed" value="1"> Supprimés \(<span id="nrem">1<\/span>\)/);
  assert.equal(home.match(/<span class="tag hot">Nouveau<\/span>/g).length, 1);
  assert.ok(!home.includes('tag gone') && !home.includes('data-act="readall"'));
  assert.match(home, /id="n-kits">2</);

  const news = await text(app, '/?new=1');
  assert.match(news, /name="new" value="1" checked/);
  assert.match(news, /id="count"[^>]*>1\skit\b/);
  assert.match(news, /Filtres<span id="nfilt"> \(1\)<\/span>/);
  assert.match(news, /data-act="readall">Tout marquer comme lu \(1\)</);
  for (const qs of ["new=1&grade=HG", "new=1&q=x", "new=1&grade=MG"]) assert.ok(!(await text(app, `/?${qs}`)).includes("readall"), qs); // the endpoint marks all: no button on a narrowed view
  assert.match(await text(app, "/?new=1&sort=name"), /data-act="readall"/);
  // a removed kit is never new, but stays in Supprimés with its badge only
  app.db.prepare("UPDATE kits SET release_date = ? WHERE id = ?").run(day(-1), gone);
  const rm = await text(app, "/?removed=1");
  assert.ok(rm.includes("tag gone") && !rm.includes("tag hot") && !rm.includes("data-act=\"read\""));
  assert.ok(!(await text(app, `/kit/${gone}`)).includes("data-act=\"read\""));
  assert.ok(!news.includes(`data-kit="${stale}"`));

  const rem = await text(app, '/?removed=1');
  assert.match(rem, /name="removed" value="1" checked/);
  assert.match(rem, new RegExp(`data-kit="${gone}"`));
  assert.match(rem, /<span class="tag gone">Supprimé<\/span>/);
  assert.ok(!rem.includes('readall') && !rem.includes(`data-kit="${fresh}"`));

  const both = await text(app, '/?new=1&removed=1'); // mutually exclusive: one only
  assert.match(both, /name="new" value="1" checked/);
  assert.ok(!/name="removed" value="1" checked/.test(both));
  assert.match(both, /Filtres<span id="nfilt"> \(1\)<\/span>/);
  assert.ok(!/name="new" value="1" checked/.test(await text(app, '/?new=2')));
  assert.match(await text(app, '/?new=1&franchise=Autre'), /Aucun kit nouveau Autre\./);
  assert.match(await text(app, '/?removed=1&grade=PG'), /Aucun kit supprimé PG\./);

  // kit page: new = badge + button ; removed = banner, page renders ; hidden-only = 404
  const page = await text(app, `/kit/${fresh}`);
  assert.match(page, /<span class="tag hot">Nouveau<\/span><button type="button" class="lk" data-act="read">Marquer comme lu<span class="vh"> : /);
  assert.ok(!page.includes('kban'));
  assert.ok(!(await text(app, `/kit/${stale}`)).includes('data-act="read"'));
  const gonePage = await fetch(`${app.base}/kit/${gone}`);
  assert.equal(gonePage.status, 200);
  assert.match(await gonePage.text(), /<p class="kban" role="note"><span class="tag gone">Supprimé<\/span> Ce kit n'est plus au catalogue Canal BD\.<\/p>/);
  assert.equal((await fetch(`${app.base}/kit/${hiddenOnly}`)).status, 404);

  await app.api('POST', `/api/kits/${fresh}/read`);
  assert.ok(!(await text(app, `/kit/${fresh}`)).includes('data-act="read"'));
  assert.ok(!(await text(app, '/')).includes('tag hot'));
}));
