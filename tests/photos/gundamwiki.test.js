import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addKit, PNG, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { gundamWikiProvider } from '../../src/photos/gundamwiki.js';
import { BREAKER, fetchPhotoForKit, providersToTry, tryProvider } from '../../src/photos/fetch.js';
import { REASONS } from '../../src/photos/provider.js';
import { savePhoto } from '../../src/photos/store.js';

const IMG = 'https://static.wikia.nocookie.net/gundam/images/a/ab/Exia.png';
const page = (title, source = IMG) => ({ title, original: { source } });
const api = (...pages) => Response.json({ query: { pages: Object.fromEntries(pages.map((p, i) => [i + 1, p])) } });
// Simulated network: the wiki API answers `pages`, the image CDN answers `img`, nothing else exists.
const net = (pages, img = () => new Response(PNG, { status: 200 })) => async (url) => (String(url).includes('/api.php') ? api(...pages) : img());
const shop = { name: 'shop', host: 'hlj.com', find: async () => null };
const photo = (db, id) => db.prepare('SELECT * FROM photos WHERE kit_id = ?').get(id);

async function withDb(fn) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  try {
    await fn({ db, dir: tmp.dir });
  } finally {
    db.close();
    tmp.cleanup();
  }
}

test('wiki : kit sans photo, boutiques refusent -> photo du wiki enregistrée, uncertain = 1', async () => {
  await withDb(async ({ db, dir }) => {
    const kitId = addKit(db, 1, 'Gundam Exia');
    const fetch = net([page('Gundam Exia')]);
    const wiki = gundamWikiProvider({ fetch, minIntervalMs: 0 });
    assert.deepEqual(await fetchPhotoForKit({ db, dataDir: dir, kitId, providers: [shop, wiki], fetch }), { found: true });
    const row = photo(db, kitId);
    assert.equal(row.uncertain, 1);
    assert.equal(row.kind, 'auto');
    assert.equal(row.source_url, 'https://gundam.fandom.com/wiki/Gundam_Exia');
  });
});

test('wiki : photo de boutique jamais remplacée ; envoi manuel intact ; photo wiki remplaçable par une boutique', async () => {
  await withDb(async ({ db, dir }) => {
    const wiki = { name: 'gundamwiki', host: 'gundam.fandom.com', find: async () => assert.fail('le wiki ne doit pas être appelé') };
    const providers = [shop, wiki];
    const boxKit = addKit(db, 1, 'Gundam Exia');
    savePhoto({ db, dataDir: dir, kitId: boxKit, bytes: PNG, kind: 'auto', sourceUrl: 'https://www.hlj.com/exia' });
    const userKit = addKit(db, 2, 'Gundam Dynames');
    savePhoto({ db, dataDir: dir, kitId: userKit, bytes: PNG, kind: 'user' });
    assert.deepEqual(providersToTry({ db, kitId: boxKit, providers }), []);
    assert.deepEqual(providersToTry({ db, kitId: userKit, providers }), []);
    assert.deepEqual(await fetchPhotoForKit({ db, dataDir: dir, kitId: boxKit, providers, fetch: net([]) }), { found: false });
    assert.deepEqual(await fetchPhotoForKit({ db, dataDir: dir, kitId: userKit, providers, fetch: net([]) }), { found: false });
    assert.equal(photo(db, boxKit).source_url, 'https://www.hlj.com/exia');
    assert.equal(photo(db, userKit).kind, 'user');
    // ancienne photo du wiki : la boutique (mieux classée) la remplace, sans rappeler le wiki
    const wikiKit = addKit(db, 3, 'Gundam Virtue');
    savePhoto({ db, dataDir: dir, kitId: wikiKit, bytes: PNG, kind: 'auto', sourceUrl: 'https://gundam.fandom.com/wiki/Gundam_Virtue', uncertain: true });
    const hlj = { ...shop, find: async () => ({ imageUrl: 'https://www.hlj.com/v.jpg', pageUrl: 'https://www.hlj.com/virtue' }) };
    assert.deepEqual(await fetchPhotoForKit({ db, dataDir: dir, kitId: wikiKit, providers: [hlj, wiki], fetch: net([]) }), { found: true });
    assert.deepEqual([photo(db, wikiKit).source_url, photo(db, wikiKit).uncertain], ['https://www.hlj.com/virtue', 0]);
  });
});

test('wiki : "Gundam Wing" ne reçoit pas la page "Zero Wing"', async () => {
  const find = (pages) => gundamWikiProvider({ fetch: net(pages), minIntervalMs: 0 }).find('Gundam Wing', null);
  assert.equal(await find([page('Zero Wing')]), null);
  const hit = await find([page('Zero Wing'), page('Gundam Wing')]);
  assert.equal(hit.pageUrl, 'https://gundam.fandom.com/wiki/Gundam_Wing');
  assert.equal(hit.uncertain, true);
});

test('wiki : 403 au téléchargement -> aucune exception, kit sans photo, source coupée après 5 échecs de suite', async () => {
  await withDb(async ({ db, dir }) => {
    const wiki = gundamWikiProvider({ fetch: net([page('Gundam Exia')]), minIntervalMs: 0 });
    const fetch = net([page('Gundam Exia')], () => new Response('no', { status: 403 }));
    const breaker = new Map();
    let calls = 0;
    const counted = { ...wiki, find: (...a) => (calls++, wiki.find(...a)) };
    for (let i = 1; i <= BREAKER + 1; i++) {
      const kitId = addKit(db, i, 'Gundam Exia');
      assert.deepEqual(await tryProvider({ db, dataDir: dir, kitId, p: counted, fetch, breaker }), { found: false });
      assert.equal(photo(db, kitId), undefined);
    }
    assert.equal(calls, BREAKER); // le 6e kit n'a pas interrogé la source
  });
});

test('wiki : API en 403 -> refus "source", jamais d\'exception', async () => {
  const wiki = gundamWikiProvider({ fetch: async () => new Response('no', { status: 403 }), minIntervalMs: 0 });
  let why;
  assert.equal(await wiki.find('Gundam Exia', null, (r) => (why = r)), null);
  assert.match(why, /source error/);
});

test('disjoncteur : un hit "kept" entre deux erreurs remet le compteur à zéro', async () => {
  await withDb(async ({ db, dir }) => {
    const breaker = new Map();
    const err = { name: 'flaky', host: 'x', find: async (n, g, on) => (on(REASONS.source), null) };
    const keptHit = { name: 'flaky', host: 'x', find: async () => ({ imageUrl: IMG, pageUrl: 'https://x/p', uncertain: true }) };
    for (let i = 1; i <= BREAKER - 1; i++) await tryProvider({ db, dataDir: dir, kitId: addKit(db, i, 'Gundam Exia'), p: err, breaker });
    const had = addKit(db, 50, 'Gundam Exia');
    savePhoto({ db, dataDir: dir, kitId: had, bytes: PNG, kind: 'auto', sourceUrl: 'https://www.hlj.com/exia' });
    await tryProvider({ db, dataDir: dir, kitId: had, p: keptHit, breaker });
    await tryProvider({ db, dataDir: dir, kitId: addKit(db, 51, 'Gundam Exia'), p: err, breaker });
    assert.equal(breaker.get('flaky'), 1);
  });
});

test('wiki : photo de boutique "à vérifier" intacte, refus "kept" mémorisé, aucune image téléchargée', async () => {
  await withDb(async ({ db, dir }) => {
    const kitId = addKit(db, 1, 'Gundam Exia');
    savePhoto({ db, dataDir: dir, kitId, bytes: PNG, kind: 'auto', sourceUrl: 'https://www.hlj.com/exia', uncertain: true });
    const before = photo(db, kitId);
    const downloads = [];
    const inner = net([page('Gundam Exia')]);
    const fetch = async (url) => (String(url).includes('/api.php') ? inner(url) : (downloads.push(url), inner(url)));
    const wiki = gundamWikiProvider({ fetch, minIntervalMs: 0 });
    await tryProvider({ db, dataDir: dir, kitId, p: wiki, fetch });
    const after = photo(db, kitId);
    assert.deepEqual([after.file, after.source_url, after.uncertain], [before.file, before.source_url, 1]);
    assert.equal(db.prepare('SELECT reason FROM photo_refusals WHERE kit_id = ?').get(kitId).reason, REASONS.kept);
    assert.deepEqual(downloads, []);
  });
});
