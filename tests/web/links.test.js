import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG, addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { markSearched, savePhoto } from '../../src/photos/store.js';
import { nextImage, tray, uncertain } from '../../public/render.js';

const LINK = 'https://img.example.com/a.jpg';
const THUMB = 'https://img.example.com/t.jpg';
const HOSTILE = 'https://a.com/"><svg/onload=1>';
const setLink = (db, kitId, url, thumb = null, unc = 1) =>
  db.prepare('INSERT INTO image_links (kit_id, url, thumb_url, uncertain, searched_at) VALUES (?, ?, ?, ?, ?)').run(kitId, url, thumb, unc, 'now');

test('photo par lien : carte, ligne, badge, filtre, absence, échappement', async () => {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    const a = addRealKit(app.db, 1, 'HG 1/144 Gundam Aerial', 'Gundam');
    const b = addRealKit(app.db, 2, 'HG 1/144 Zaku II', 'Gundam');
    const c = addRealKit(app.db, 3, 'HG 1/144 Evangelion Unit-01', 'Evangelion');
    const d = addRealKit(app.db, 4, 'HG 1/144 Sans rien', 'Gundam');
    const e = addRealKit(app.db, 5, 'HG 1/144 Hostile "<b>x</b>"', 'Gundam');
    setLink(app.db, a, LINK, THUMB);
    setLink(app.db, c, 'https://img.example.com/c.jpg');
    savePhoto({ db: app.db, dataDir: tmp.dir, kitId: b, bytes: PNG, kind: 'user' });
    markSearched(app.db, d);
    setLink(app.db, e, HOSTILE, HOSTILE);
    const get = async (p) => (await fetch(app.base + p)).text();

    const home = await get('/');
    assert.ok(home.includes(`<img src="${LINK}" data-thumb="${THUMB}" alt="Image liée depuis le web : `));
    assert.match(home, new RegExp(`src="${LINK}"[^>]*referrerpolicy="no-referrer" loading="lazy"`));
    assert.match(home, /alt="Image liée depuis le web : [^"]*Aerial"/);
    assert.equal((home.match(/referrerpolicy="no-referrer"/g) || []).length, 3, 'a, c, e only: not the local photo, not the empty search');
    assert.equal((home.match(/class="tray miss"/g) || []).length, 1, 'searched-empty kit keeps the placeholder');
    assert.ok(home.includes(`<img src="/photos/${b}`));
    // Hostile URL and title: nothing raw leaks out of the attributes or the text.
    assert.ok(!home.includes('<svg/onload'));
    assert.ok(!home.includes('a.com/"'));
    assert.ok(home.includes('src="https://a.com/&#34;&#62;&#60;svg/onload=1&#62;"'));
    assert.ok(!home.includes('<b>x</b>'));

    // Cards carry no « À vérifier » badge any more: only a discreet check on photos that are fine (b); the kit page holds the badge.
    assert.equal((home.match(/data-act="verify"/g) || []).length, 0);
    const okBefore = (home.match(/class="ok"/g) || []).length;
    assert.equal((await get(`/kit/${a}`)).match(/data-act="verify"/g).length, 1);
    assert.match(await get('/?uncertain=1'), /id="count"[^>]*>3\skits/);
    assert.match(await get('/?uncertain=1&franchise=Evangelion'), /id="count"[^>]*>1\skit\b/);

    // Verify a link: badge gone, link kept.
    assert.equal((await app.api('POST', `/api/kits/${a}/photo/verified`)).status, 200);
    const after = await get('/');
    assert.equal((after.match(/data-act="verify"/g) || []).length, 0);
    assert.equal((after.match(/class="ok"/g) || []).length, okBefore + 1);
    assert.ok(after.includes(`src="${LINK}"`));

    // Collection rows (mini tray: empty alt): badge for the uncertain link only.
    for (const k of [a, b, c, d]) await app.api('POST', '/api/copies', { kitId: k, status: 'possede' });
    const col = await get('/collection');
    assert.equal((col.match(/referrerpolicy="no-referrer"/g) || []).length, 2);
    assert.match(col, /alt="" referrerpolicy="no-referrer" loading="lazy"/);
    assert.equal((col.match(/data-act="verify"/g) || []).length, 1);
    assert.equal((col.match(/tray mini miss/g) || []).length, 1);
  } finally {
    await app.close();
    tmp.cleanup();
  }
});

test('tray / uncertain : https seulement, photo locale prioritaire', () => {
  const base = { id: 1, title: 'T"<i>', photo_uncertain: 1 };
  assert.ok(!tray({ ...base, photo_link: 'http://x.com/a.jpg' }, 1).includes('<img'));
  assert.ok(!tray({ ...base, photo_link: 'javascript:alert(1)' }, 1).includes('<img'));
  assert.ok(tray({ ...base, photo_file: 'a.png', photo_link: LINK }, 1).includes('src="/photos/1"'));
  assert.ok(!tray({ ...base, photo_file: 'a.png', photo_link: LINK }, 1).includes('example.com'));
  assert.ok(!tray({ ...base, photo_link: LINK }, 1).includes('<i>'));
  assert.equal(uncertain({ ...base, photo_link: 'http://x.com/a' }, 'div'), '');
  assert.match(uncertain({ ...base, photo_link: LINK }, 'div'), /À vérifier/);
});

test('nextImage : lien, puis miniature différente, puis rien', () => {
  const k = { photo_link: LINK, photo_thumb: THUMB };
  assert.equal(nextImage(k, LINK), THUMB);
  assert.equal(nextImage(k, THUMB), null);
  assert.equal(nextImage({ photo_link: LINK, photo_thumb: LINK }, LINK), null);
  assert.equal(nextImage({ photo_link: LINK, photo_thumb: null }, LINK), null);
  assert.equal(nextImage({ photo_link: LINK, photo_thumb: 'http://t/x' }, LINK), null);
  assert.equal(nextImage({ photo_file: 'a.png', photo_link: LINK, photo_thumb: THUMB }, LINK), null);
});
