import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMaquettes } from '../../src/catalogue/import.js';
import catalogueRoutes from '../../src/catalogue/routes.js';
import { updateNeeded, startAutoUpdate } from '../../src/update.js';
import { missTray, searchUrl } from '../../public/render.js';
import { startApp, tmpDataDir } from '../helpers/index.js';
import { EXPECTED_KITS, fakeSite } from './fake-site.js';

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-11-23T12:00:00Z');
const OLD = '2020-01-01T00:00:00.000Z';

async function withApp(fn) {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    await fn(app);
  } finally {
    await app.close();
    tmp.cleanup();
  }
}

// Kits the source no longer lists: old imported_at, in scope; one has a photo, one has a copy.
function addRetired(db) {
  const ins = db.prepare(`INSERT INTO kits (source_id, raw_title, title, shelf, franchise, imported_at) VALUES (?, 'RAW', ?, 'Gunpla 1/144', 'Gundam', '${OLD}')`);
  const gone = Number(ins.run('GONE', 'Gone').lastInsertRowid);
  const kept = Number(ins.run('KEPT', 'Kept').lastInsertRowid);
  db.prepare("INSERT INTO photos (kit_id, kind, file, updated_at) VALUES (?, 'auto', 'g.jpg', '2020')").run(gone);
  db.prepare("INSERT INTO copies (kit_id, status, notes, created_at) VALUES (?, 'possede', '', '2020')").run(kept);
  return { gone, kept };
}
const hidden = (db, id) => db.prepare('SELECT hidden FROM kits WHERE id = ?').get(id).hidden;

test('import réussi : kit retiré masqué (photo gardée), sauf en collection', async () => {
  await withApp(async ({ db }) => {
    const { gone, kept } = addRetired(db);
    await importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
    assert.equal(hidden(db, gone), 1);
    assert.equal(hidden(db, kept), 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos WHERE kit_id = ?').get(gone).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kits WHERE hidden = 0').get().n, EXPECTED_KITS + 1); // + the kept copy
  });
});

test('un kit masqué qui revient dans la source est démasqué', async () => {
  await withApp(async ({ db }) => {
    await importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
    const { id } = db.prepare('SELECT id FROM kits LIMIT 1').get();
    db.prepare('UPDATE kits SET hidden = 1, imported_at = ? WHERE id = ?').run(OLD, id);
    await importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
    assert.equal(hidden(db, id), 0);
  });
});

test('import vide, avec une étagère vide, ou en erreur : rien n’est masqué', async () => {
  const EMPTY = '<html><body><section class="six-landscape-grid"></section></body></html>';
  const emptyAll = async () => ({ ok: true, status: 200, text: async () => EMPTY });
  const site = fakeSite();
  const emptyOne = (url) => (new URL(url).searchParams.get('shelf') === '13221' ? emptyAll() : site.fetch(url));
  const failing = fakeSite({ failOn: (u) => u.searchParams.get('shelf') === '13224' }).fetch;
  for (const fetch of [emptyAll, emptyOne, failing]) {
    await withApp(async ({ db }) => {
      const { gone } = addRetired(db);
      await importMaquettes({ db, fetch, delayMs: 0 }).catch(() => {});
      assert.equal(hidden(db, gone), 0);
    });
  }
});

test('un kit retiré reste masqué après un import en erreur ou avec étagère vide, revient démasqué', async () => {
  const EMPTY = '<html><body><section class="six-landscape-grid"></section></body></html>';
  const emptyOne = (url) => (new URL(url).searchParams.get('shelf') === '13221' ? { ok: true, status: 200, text: async () => EMPTY } : fakeSite().fetch(url));
  const failing = fakeSite({ failOn: (u) => u.searchParams.get('shelf') === '13224' }).fetch;
  await withApp(async ({ db }) => {
    const { gone, kept } = addRetired(db);
    await importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
    assert.equal(hidden(db, gone), 1);
    for (const fetch of [failing, emptyOne]) {
      await importMaquettes({ db, fetch, delayMs: 0 }).catch(() => {});
      assert.equal(hidden(db, gone), 1);
      assert.equal(hidden(db, kept), 0);
    }
    db.prepare('UPDATE kits SET hidden = 1 WHERE id = ?').run(kept); // copy: the rule still shows it
    await importMaquettes({ db, fetch: failing, delayMs: 0 }).catch(() => {});
    assert.equal(hidden(db, kept), 0);
    const { id } = db.prepare("SELECT id FROM kits WHERE hidden = 0 AND source_id NOT IN ('GONE', 'KEPT') LIMIT 1").get();
    db.prepare('UPDATE kits SET hidden = 1, imported_at = ? WHERE id = ?').run(OLD, id);
    await importMaquettes({ db, fetch: fakeSite().fetch, delayMs: 0 });
    assert.equal(hidden(db, id), 0); // back in the source
    assert.equal(hidden(db, gone), 1);
  });
});

test('mise à jour nécessaire : jamais faite, plus de 7 jours, récente', () => {
  assert.equal(updateNeeded(null, NOW), true);
  assert.equal(updateNeeded(new Date(NOW - 8 * DAY).toISOString(), NOW), true);
  assert.equal(updateNeeded(new Date(NOW - 6 * DAY).toISOString(), NOW), false);
});

test('mise à jour auto : ordre import, prix, photos ; un échec réseau ne bloque pas ; une seule à la fois', async () => {
  await withApp(async ({ db }) => {
    const calls = [];
    const jobs = {
      import: async () => (calls.push('import'), Promise.reject(new Error('réseau'))),
      prices: async () => calls.push('prices'),
      photos: async () => calls.push('photos'),
    };
    const state = { running: false };
    const run = () => startAutoUpdate({ db, jobs, state, log: () => {}, now: NOW });
    const first = run();
    assert.equal(state.running, true);
    assert.equal(await run(), false); // second start while running
    assert.equal(await first, true);
    assert.deepEqual(calls, ['import', 'prices', 'photos']);
    assert.equal(state.running, false);
    db.prepare('INSERT INTO kits (source_id, raw_title, title, imported_at) VALUES (?, ?, ?, ?)').run('N', 'N', 'N', new Date(NOW).toISOString());
    assert.equal(await run(), false); // fresh data: nothing starts
    assert.equal(calls.length, 3);
  });
});

test('job déjà en cours (clic manuel) : 409 inchangé, l’auto saute l’étape', async () => {
  await withApp(async ({ db }) => {
    let release;
    const importer = () => new Promise((r) => (release = () => r({ imported: 0, updated: 0, total: 0 })));
    const jobs = {};
    catalogueRoutes({ add() {} }, { db, importer, jobs });
    const manual = jobs.import();
    await assert.rejects(jobs.import(), { status: 409 });
    const calls = [];
    const auto = startAutoUpdate({ db, jobs: { ...jobs, prices: async () => calls.push('prices'), photos: async () => calls.push('photos') }, state: { running: false }, log: () => {}, now: NOW });
    await auto;
    assert.deepEqual(calls, ['prices', 'photos']);
    release();
    await manual;
  });
});

test('indicateur « Mise à jour en cours » rendu seulement pendant la mise à jour auto', async () => {
  await withApp(async (app) => {
    const page = async () => (await fetch(`${app.base}/`)).text();
    const idle = await page();
    assert.match(idle, /<div class="stripe" id="stripe" hidden>/);
    assert.doesNotMatch(idle, /Mise à jour en cours/);
    app.auto.running = true;
    assert.deepEqual((await app.api('GET', '/api/update/status')).body, { running: true });
    const busy = await page();
    assert.match(busy, /<div class="stripe" id="stripe">/);
    assert.match(busy, /Mise à jour en cours/);
  });
});

test('« Chercher une photo » : URL encodée, nouvel onglet, noopener, titre échappé', () => {
  const k = { title: 'MG "Zaku" <b>&', grade: 'MG' };
  assert.equal(searchUrl(k), `https://www.google.com/search?tbm=isch&q=${encodeURIComponent('MG "Zaku" <b>& MG gunpla')}`);
  const html = missTray(k);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Chercher une photo/);
  assert.doesNotMatch(html, /<b>&|"Zaku" </);
  assert.doesNotMatch(missTray(k, true), /Chercher/);
});
