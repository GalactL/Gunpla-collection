import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { PNG, addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { savePhoto, getPhoto } from '../../src/photos/store.js';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);

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

test('migration : base ancienne sans colonne, deux ouvertures, photos intactes et a 0', () => {
  const tmp = tmpDataDir();
  try {
    const old = new DatabaseSync(join(tmp.dir, 'gunpla.db'));
    old.exec(`
      CREATE TABLE kits (id INTEGER PRIMARY KEY, source_id TEXT UNIQUE NOT NULL, raw_title TEXT NOT NULL, title TEXT NOT NULL,
        grade TEXT, scale TEXT, series TEXT, franchise TEXT, shelf TEXT, release_date TEXT, source_url TEXT, cover_url TEXT, imported_at TEXT);
      CREATE TABLE photos (kit_id INTEGER PRIMARY KEY REFERENCES kits(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('auto','user')), file TEXT NOT NULL, source_url TEXT, updated_at TEXT NOT NULL);
      INSERT INTO kits (id, source_id, raw_title, title, franchise) VALUES (1, 'S1', 'HG 1/144 Exia', 'Exia', 'Gundam');
      INSERT INTO photos VALUES (1, 'auto', '1.jpg', 'https://hlj.com/x', '2026-01-01');
    `);
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = openDb(tmp.dir);
      assert.deepEqual(
        { ...getPhoto(db, 1) },
        { kit_id: 1, kind: 'auto', file: '1.jpg', source_url: 'https://hlj.com/x', updated_at: '2026-01-01', uncertain: 0 },
      );
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('savePhoto : auto douteux, user remet a 0, auto ne remplace pas user', () => {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  try {
    const id = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    savePhoto({ db, dataDir: tmp.dir, kitId: id, bytes: PNG, kind: 'auto', uncertain: true });
    assert.equal(getPhoto(db, id).uncertain, 1);
    savePhoto({ db, dataDir: tmp.dir, kitId: id, bytes: PNG, kind: 'auto' });
    assert.equal(getPhoto(db, id).uncertain, 0, 'auto sans drapeau : 0');
    savePhoto({ db, dataDir: tmp.dir, kitId: id, bytes: PNG, kind: 'auto', uncertain: true });
    savePhoto({ db, dataDir: tmp.dir, kitId: id, bytes: JPG, kind: 'user', uncertain: true });
    assert.deepEqual([getPhoto(db, id).kind, getPhoto(db, id).uncertain], ['user', 0], "l'upload efface la marque");
    assert.equal(savePhoto({ db, dataDir: tmp.dir, kitId: id, bytes: PNG, kind: 'auto', uncertain: true }), null);
    assert.deepEqual([getPhoto(db, id).kind, getPhoto(db, id).uncertain], ['user', 0]);
  } finally {
    db.close();
    tmp.cleanup();
  }
});

test('photo_uncertain dans le catalogue et la collection, ?uncertain=1 compose avec les autres filtres', async () => {
  await withApp(async ({ db, api }, dir) => {
    const a = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    const b = addRealKit(db, 2, 'MG 1/100 Sinanju');
    const c = addRealKit(db, 3, 'HG 1/144 Exia');
    const none = addRealKit(db, 4, 'HG 1/144 Zaku II'); // sans photo
    savePhoto({ db, dataDir: dir, kitId: a, bytes: PNG, kind: 'auto', uncertain: true });
    savePhoto({ db, dataDir: dir, kitId: b, bytes: PNG, kind: 'auto', uncertain: true });
    savePhoto({ db, dataDir: dir, kitId: c, bytes: PNG, kind: 'auto' });

    const all = (await api('GET', '/api/kits?limit=100')).body;
    const flag = Object.fromEntries(all.kits.map((k) => [k.id, k.photo_uncertain]));
    assert.deepEqual(flag, { [a]: 1, [b]: 1, [c]: 0, [none]: 0 });
    assert.equal(all.total, 4);

    const unc = (await api('GET', '/api/kits?uncertain=1')).body;
    assert.deepEqual(unc.kits.map((k) => k.id).sort(), [a, b]);
    assert.equal(unc.total, 2);
    const both = (await api('GET', '/api/kits?uncertain=1&grade=HG')).body;
    assert.deepEqual(both.kits.map((k) => k.id), [a]);
    assert.equal(both.total, 1);
    assert.equal((await api('GET', '/api/kits?uncertain=1&grade=HG&limit=1&offset=1')).body.kits.length, 0);

    for (const [kit, want] of [[a, 1], [c, 0], [none, 0]]) {
      assert.equal((await api('POST', '/api/copies', { kitId: kit, status: 'souhaite' })).body.photo_uncertain, want);
    }
    assert.deepEqual((await api('GET', '/api/copies')).body.map((x) => x.photo_uncertain), [1, 0, 0]);
  });
});

test('POST /api/kits/:id/photo/verified : 200, idempotent, 404, kind et fichier intacts', async () => {
  await withApp(async ({ db, api, base }, dir) => {
    const id = addRealKit(db, 1, 'HG 1/144 Gundam Aerial');
    const bare = addRealKit(db, 2, 'HG 1/144 Exia');
    savePhoto({ db, dataDir: dir, kitId: id, bytes: PNG, kind: 'auto', uncertain: true });
    const before = { ...getPhoto(db, id) };

    const r = await api('POST', `/api/kits/${id}/photo/verified`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { file: before.file, kind: 'auto', uncertain: 0 });
    assert.deepEqual({ ...getPhoto(db, id) }, { ...before, uncertain: 0 });

    const again = await api('POST', `/api/kits/${id}/photo/verified`);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, r.body);
    assert.deepEqual({ ...getPhoto(db, id) }, { ...before, uncertain: 0 });

    assert.equal((await api('POST', `/api/kits/${bare}/photo/verified`)).status, 404);
    assert.equal(getPhoto(db, bare), undefined);
    for (const bad of ['0', '01', '-1', 'abc', '1e3', '99999999999999999']) {
      assert.equal((await api('POST', `/api/kits/${bad}/photo/verified`)).status, 404, bad);
    }
    const res = await fetch(`${base}/api/kits/${id}/photo/verified`, { method: 'POST', headers: { origin: 'http://evil.example' } });
    assert.equal(res.status, 403, 'origine etrangere refusee par le routeur');
  });
});
