import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { PNG, addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { deleteLink, getLink, getPhoto, markSearched, saveLink, savePhoto } from '../../src/photos/store.js';

const IMG = 'https://img.example.com/a.jpg';
const THUMB = 'https://thumb.example.com/t.jpg';
const PAGE = 'https://shop.example.com/p';

async function withApp(fn) {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    await fn(app, tmp.dir);
  } finally {
    await app.close();
    tmp.cleanup();
  }
}

function withDb(fn) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  try {
    fn(db, tmp.dir);
  } finally {
    db.close();
    tmp.cleanup();
  }
}

test('migration : base ancienne avec photos.uncertain, sans image_links, deux ouvertures, donnees intactes', () => {
  const tmp = tmpDataDir();
  try {
    const old = new DatabaseSync(join(tmp.dir, 'gunpla.db'));
    old.exec(`
      CREATE TABLE kits (id INTEGER PRIMARY KEY, source_id TEXT UNIQUE NOT NULL, raw_title TEXT NOT NULL, title TEXT NOT NULL,
        grade TEXT, scale TEXT, series TEXT, franchise TEXT, shelf TEXT, release_date TEXT, source_url TEXT, cover_url TEXT, imported_at TEXT);
      CREATE TABLE photos (kit_id INTEGER PRIMARY KEY REFERENCES kits(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('auto','user')), file TEXT NOT NULL, source_url TEXT, updated_at TEXT NOT NULL,
        uncertain INTEGER NOT NULL DEFAULT 0);
      INSERT INTO kits (id, source_id, raw_title, title, franchise) VALUES (1, 'S1', 'HG 1/144 Exia', 'Exia', 'Gundam');
      INSERT INTO photos VALUES (1, 'auto', '1.jpg', 'https://hlj.com/x', '2026-01-01', 1);
    `);
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = openDb(tmp.dir);
      assert.deepEqual({ ...getPhoto(db, 1) }, { kit_id: 1, kind: 'auto', file: '1.jpg', source_url: 'https://hlj.com/x', updated_at: '2026-01-01', uncertain: 1 });
      assert.equal(db.prepare('SELECT title FROM kits WHERE id = 1').get().title, 'Exia');
      assert.equal(getLink(db, 1), undefined);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('image_links')").get().n, 6);
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('saveLink : valide enregistre uncertain=1, invalide retourne null sans rien ecrire', () => {
  withDb((db) => {
    const id = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    assert.ok(saveLink({ db, kitId: id, url: IMG, thumbUrl: THUMB, pageUrl: PAGE }));
    assert.deepEqual(
      { ...getLink(db, id), searched_at: 'x' },
      { kit_id: id, url: IMG, thumb_url: THUMB, page_url: PAGE, uncertain: 1, searched_at: 'x' },
    );
    deleteLink(db, id);
    assert.equal(getLink(db, id), undefined);

    const long = `https://a.example.com/${'a'.repeat(2048)}`;
    const bad = [
      'http://img.example.com/a.jpg',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '//img.example.com/a.jpg',
      long,
      'https://user:pw@img.example.com/a.jpg',
      'https://user@img.example.com/a.jpg',
      'https://img.example.com/a b.jpg',
      'https://img.example.com/a\u0000.jpg',
      'https://img.example.com/a\n.jpg',
      '',
      null,
      undefined,
      42,
      'not a url',
    ];
    for (const url of bad) assert.equal(saveLink({ db, kitId: id, url }), null, String(url).slice(0, 30));
    // thumb and page are optional, but invalid when present => whole link refused
    assert.equal(saveLink({ db, kitId: id, url: IMG, thumbUrl: 'http://t.example.com/t.jpg' }), null);
    assert.equal(saveLink({ db, kitId: id, url: IMG, pageUrl: long }), null);
    assert.equal(saveLink({ db, kitId: id, url: IMG, thumbUrl: '' }), null);
    assert.equal(getLink(db, id), undefined, 'rien ecrit');
    assert.ok(saveLink({ db, kitId: id, url: IMG }), 'thumb et page facultatifs');
    assert.equal(saveLink({ db, kitId: 999, url: IMG }), null, 'kit inconnu : null, pas de throw');
  });
});

test('un lien ne remplace jamais une photo locale ; upload et photo auto suppriment le lien', () => {
  withDb((db, dir) => {
    const a = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    savePhoto({ db, dataDir: dir, kitId: a, bytes: PNG, kind: 'auto' });
    assert.equal(saveLink({ db, kitId: a, url: IMG }), null);
    assert.equal(markSearched(db, a), false);
    assert.equal(getLink(db, a), undefined);

    const b = addRealKit(db, 2, 'HG 1/144 Exia');
    saveLink({ db, kitId: b, url: IMG });
    savePhoto({ db, dataDir: dir, kitId: b, bytes: PNG, kind: 'auto' });
    assert.equal(getLink(db, b), undefined, 'photo auto');

    const c = addRealKit(db, 3, 'HG 1/144 Zaku II');
    saveLink({ db, kitId: c, url: IMG });
    savePhoto({ db, dataDir: dir, kitId: c, bytes: PNG, kind: 'user' });
    assert.equal(getLink(db, c), undefined, 'upload');
  });
});

test('markSearched : ligne sans url, n ecrase pas un lien existant, saveLink la remplace', () => {
  withDb((db) => {
    const a = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    assert.equal(markSearched(db, a), true);
    const row = getLink(db, a);
    assert.equal(row.url, null);
    assert.equal(row.searched_at.length > 10, true);
    markSearched(db, a);
    assert.deepEqual({ ...getLink(db, a) }, { ...row });
    assert.ok(saveLink({ db, kitId: a, url: IMG }), 'un lien trouve plus tard remplace la marque vide');
    assert.equal(getLink(db, a).url, IMG);

    const b = addRealKit(db, 2, 'HG 1/144 Exia');
    saveLink({ db, kitId: b, url: IMG, thumbUrl: THUMB });
    markSearched(db, b);
    assert.equal(getLink(db, b).url, IMG, 'lien intact');
    assert.equal(markSearched(db, 999), false);
  });
});

test('champs API du catalogue et de la collection : lien, photo, rien, cherche sans resultat', async () => {
  await withApp(async ({ db, api }, dir) => {
    const link = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    const photo = addRealKit(db, 2, 'HG 1/144 Exia');
    const none = addRealKit(db, 3, 'MG 1/100 Sinanju');
    const empty = addRealKit(db, 4, 'HG 1/144 Zaku II');
    saveLink({ db, kitId: link, url: IMG, thumbUrl: THUMB, pageUrl: PAGE });
    savePhoto({ db, dataDir: dir, kitId: photo, bytes: PNG, kind: 'auto' });
    markSearched(db, empty);

    const fields = (k) => [k.photo_file, k.photo_link, k.photo_thumb, k.photo_uncertain];
    const res = (await api('GET', '/api/kits?limit=100')).body;
    const kits = Object.fromEntries(res.kits.map((k) => [k.id, k]));
    assert.deepEqual(fields(kits[link]), [null, IMG, THUMB, 1]);
    assert.deepEqual(fields(kits[photo]), [`${photo}.png`, null, null, 0]);
    assert.deepEqual(fields(kits[none]), [null, null, null, 0]);
    assert.deepEqual(fields(kits[empty]), [null, null, null, 0]);
    assert.equal(res.total, 4);

    for (const kit of [link, photo, none, empty]) await api('POST', '/api/copies', { kitId: kit, status: 'souhaite' });
    const copies = (await api('GET', '/api/copies')).body;
    assert.deepEqual(copies.map(fields), [
      [null, IMG, THUMB, 1],
      [`${photo}.png`, null, null, 0],
      [null, null, null, 0],
      [null, null, null, 0],
    ]);
    const created = (await api('POST', '/api/copies', { kitId: link, status: 'possede' })).body;
    assert.deepEqual(fields(created), [null, IMG, THUMB, 1]);
  });
});

test('?uncertain=1 inclut les liens marques, compose avec un autre filtre, total juste', async () => {
  await withApp(async ({ db, api }, dir) => {
    const a = addRealKit(db, 1, 'HG 1/144 Gundam Aerial'); // lien
    const b = addRealKit(db, 2, 'MG 1/100 Sinanju'); // lien, autre grade
    const c = addRealKit(db, 3, 'HG 1/144 Exia'); // photo auto douteuse
    const d = addRealKit(db, 4, 'HG 1/144 Zaku II'); // lien confirme
    const e = addRealKit(db, 5, 'HG 1/144 Gelgoog'); // cherche sans resultat
    saveLink({ db, kitId: a, url: IMG });
    saveLink({ db, kitId: b, url: IMG });
    saveLink({ db, kitId: d, url: IMG });
    savePhoto({ db, dataDir: dir, kitId: c, bytes: PNG, kind: 'auto', uncertain: true });
    markSearched(db, e);
    await api('POST', `/api/kits/${d}/photo/verified`);

    const unc = (await api('GET', '/api/kits?uncertain=1')).body;
    assert.deepEqual(unc.kits.map((k) => k.id).sort(), [a, b, c]);
    assert.equal(unc.total, 3);
    const hg = (await api('GET', '/api/kits?uncertain=1&grade=HG')).body;
    assert.deepEqual(hg.kits.map((k) => k.id).sort(), [a, c]);
    assert.equal(hg.total, 2);
    const page = (await api('GET', '/api/kits?uncertain=1&grade=HG&limit=1&offset=1')).body;
    assert.equal(page.kits.length, 1);
    assert.equal(page.total, 2);
  });
});

test('POST /api/kits/:id/photo/verified pour un lien : 200, idempotent, 404 sans rien, photo inchangee', async () => {
  await withApp(async ({ db, api }, dir) => {
    const id = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    const bare = addRealKit(db, 2, 'HG 1/144 Exia');
    const empty = addRealKit(db, 3, 'HG 1/144 Zaku II');
    const photo = addRealKit(db, 4, 'MG 1/100 Sinanju');
    saveLink({ db, kitId: id, url: IMG, thumbUrl: THUMB });
    markSearched(db, empty);
    savePhoto({ db, dataDir: dir, kitId: photo, bytes: PNG, kind: 'auto', uncertain: true });
    const before = { ...getLink(db, id) };

    for (let i = 0; i < 2; i++) {
      const r = await api('POST', `/api/kits/${id}/photo/verified`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { link: true, uncertain: 0 });
      assert.deepEqual({ ...getLink(db, id) }, { ...before, uncertain: 0 });
    }
    const k = (await api('GET', '/api/kits?limit=100')).body.kits.find((x) => x.id === id);
    assert.deepEqual([k.photo_link, k.photo_uncertain], [IMG, 0]);

    assert.equal((await api('POST', `/api/kits/${bare}/photo/verified`)).status, 404);
    assert.equal(getLink(db, bare), undefined);
    assert.equal((await api('POST', `/api/kits/${empty}/photo/verified`)).status, 404, 'cherche sans resultat : rien a confirmer');
    assert.equal(getLink(db, empty).uncertain, 1, 'ligne vide inchangee');
    for (const bad of ['0', '01', 'abc', '99999999999999999']) {
      assert.equal((await api('POST', `/api/kits/${bad}/photo/verified`)).status, 404, bad);
    }

    const p = await api('POST', `/api/kits/${photo}/photo/verified`);
    assert.deepEqual([p.status, p.body], [200, { file: `${photo}.png`, kind: 'auto', uncertain: 0 }]);
  });
});
