import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG, addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { savePhoto } from '../../src/photos/store.js';
import { uncertain } from '../../public/render.js';

test('badge, filtre et bouton : rendu serveur du catalogue et de la collection', async () => {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    const a = addRealKit(app.db, 1, 'HG 1/144 Gundam Aerial', 'Gundam');
    const b = addRealKit(app.db, 2, 'HG 1/144 Zaku II', 'Gundam');
    const c = addRealKit(app.db, 3, 'HG 1/144 Evangelion Unit-01', 'Evangelion');
    const d = addRealKit(app.db, 4, 'HG 1/144 Sans photo', 'Gundam');
    // a, c: uncertain auto photo; b: sure photo; d: no photo.
    for (const [kitId, uncertain] of [[a, true], [b, false], [c, true]]) {
      savePhoto({ db: app.db, dataDir: tmp.dir, kitId, bytes: PNG, kind: 'auto', uncertain });
    }
    const get = async (p) => (await fetch(app.base + p)).text();
    const badge = /<span class="tag">À vérifier<\/span><button type="button" class="lk" data-act="verify">Photo vérifiée<span class="vh"> : /g;

    const all = await get('/');
    assert.equal(all.match(badge), null, 'no badge on catalogue cards');
    assert.equal(all.match(/class="ok"/g).length, 1, 'check only on the sure photo');
    assert.match(await get(`/kit/${a}`), /Photo vérifiée<span class="vh"> : [^<]*Aerial/); // the kit page holds it, name carries the title
    assert.match(all, /name="uncertain" value="1"/);
    assert.ok(!/name="uncertain" value="1" checked/.test(all));

    const only = await get('/?uncertain=1');
    assert.match(only, /name="uncertain" value="1" checked/);
    assert.match(only, /id="count"[^>]*>2\skits/);
    assert.match(only, /Filtres<span id="nfilt"> \(1\)<\/span>/);
    assert.ok(!only.includes('Zaku'));

    const composed = await get('/?uncertain=1&franchise=Gundam');
    assert.match(composed, /id="count"[^>]*>1\skit\b/);
    assert.ok(!composed.includes('Evangelion Unit-01</a></h2>'));
    assert.match(composed, /Filtres<span id="nfilt"> \(2\)<\/span>/);

    assert.ok(!/value="1" checked/.test(await get('/?uncertain=0')), 'only uncertain=1 is honoured');
    assert.match(await get('/?uncertain=1&franchise=Evangelion&grade=PG'), /Aucun kit PG Evangelion aux photos à vérifier\./);

    // After "Photo vérifiée" the badge is gone.
    assert.equal((await app.api('POST', `/api/kits/${a}/photo/verified`)).status, 200);
    assert.equal((await get('/')).match(/class="ok"/g).length, 2);

    // Collection: badge only on rows whose photo is uncertain (c); none for b, d.
    for (const k of [a, b, c, d]) await app.api('POST', '/api/copies', { kitId: k, status: 'possede' });
    const col = await get('/collection');
    assert.equal(col.match(badge).length, 1);
    assert.match(col, /id="cunc" aria-pressed="false"/);
  } finally {
    await app.close();
    tmp.cleanup();
  }
});

test('uncertain() : rien sans photo ni quand la marque est à 0', () => {
  assert.equal(uncertain({ title: 'X', photo_file: null, photo_uncertain: 1 }, 'span'), '');
  assert.equal(uncertain({ title: 'X', photo_file: 'a.png', photo_uncertain: 0 }, 'span'), '');
  assert.match(uncertain({ title: 'X<', photo_file: 'a.png', photo_uncertain: 1 }, 'span'), /À vérifier.*X&#60;/);
});

test('focusOrder : soi-même, les suivants, puis les précédents', async () => {
  const { focusOrder } = await import('../../public/render.js');
  assert.deepEqual(focusOrder([1, 2, 3, 4], 1), [2, 3, 4, 1]);
  assert.deepEqual(focusOrder([1, 2, 3, 4], 3), [4, 3, 2, 1]);
  assert.deepEqual(focusOrder([7], 0), [7]);
  assert.deepEqual(focusOrder([], -1), []);
});
