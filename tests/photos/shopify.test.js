import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import photoRoutes from '../../src/photos/routes.js';
import { REASONS, hljProvider, politeGate } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';
import { BREAKER, fetchPhotoForKit, providersToTry } from '../../src/photos/fetch.js';
import { getPhoto, savePhoto } from '../../src/photos/store.js';

const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
const product = (title, slug, image = `${CDN}${slug}-gp.jpg?v=1`) => ({ title, url: `/products/${slug}?_pos=1&_sid=x`, image });
const suggestion = (...products) => Response.json({ resources: { results: { products } } });

// Simulated web: HLJ finds nothing unless `hlj` is given; each shop answers `shops[host]` (a function of the query).
function web({ hlj, gp = () => [], usa = () => [], calls = [] } = {}) {
  const shop = (fn) => (u) => {
    const r = fn(u.searchParams.get('q'));
    return typeof r === 'number' ? new Response('', { status: r }) : suggestion(...r);
  };
  const shops = { 'www.gundamplanet.com': shop(gp), 'www.usagundamstore.com': shop(usa) };
  const f = async (url) => {
    const u = new URL(url);
    calls.push(u.hostname);
    if (u.hostname === 'www.hlj.com') return new Response(hlj ?? '<div></div>', { status: 200 });
    if (shops[u.hostname]) return shops[u.hostname](u);
    return new Response(PNG, { status: 200 }); // image download
  };
  f.calls = calls;
  return f;
}
const chain = (fetch, opts = {}) => [
  hljProvider({ fetch, minIntervalMs: 0 }),
  shopifyProvider({ name: 'gundamplanet', host: 'gundamplanet.com', fetch, minIntervalMs: 0, retryMs: 1, ...opts }),
  shopifyProvider({ name: 'usagundamstore', host: 'usagundamstore.com', fetch, minIntervalMs: 0, retryMs: 1, ...opts }),
];

async function withDb(fn) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const log = console.error;
  console.error = () => {};
  try {
    await fn({ db, dir: tmp.dir });
  } finally {
    console.error = log;
    db.close();
    tmp.cleanup();
  }
}
const run = (t, kitId, fetch, extra = {}) =>
  fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId, providers: chain(fetch), fetch, ...extra });

test('Shopify : kit refusé par HLJ trouvé via Gundam Planet, photo stockée avec la fiche de la boutique', async () => {
  await withDb(async (t) => {
    const queries = [];
    const fetch = web({ gp: (q) => (queries.push(q), [product('HG 1/144 Gundam Aerial Decal', 'decal'), product('HG 1/144 Gundam Aerial', 'hg-aerial')]) });
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const stats = {};
    assert.deepEqual(await run(t, id, fetch, { stats }), { found: true });
    const row = getPhoto(t.db, id);
    assert.equal(row.kind, 'auto');
    assert.equal(row.source_url, 'https://www.gundamplanet.com/products/hg-aerial'); // sans paramètres
    assert.equal(row.uncertain, 0);
    assert.deepEqual(queries, ['HG Gundam Aerial']);
    assert.equal(stats.gundamplanet.found, 1);
    assert.equal(fetch.calls.includes('www.usagundamstore.com'), false); // première correspondance sûre retenue
  });
});

test('Shopify : requête nettoyée (numéro, parenthèses, &) et EG -> Entry Grade', async () => {
  await withDb(async (t) => {
    const queries = [];
    const fetch = web({ gp: (q) => (queries.push(q), []) });
    await run(t, addRealKit(t.db, 1, 'EG 1/144 STRIKE GUNDAM'), fetch);
    await run(t, addRealKit(t.db, 2, '201 HGCE 1/144 STRIKE FREEDOM GUNDAM (13)'), fetch);
    await run(t, addRealKit(t.db, 3, 'MG 1/100 SAZABI (Revive) & Friends'), fetch);
    assert.deepEqual(queries, ['Entry Grade Strike Gundam', 'HG Strike Freedom Gundam', 'MG Sazabi Friends']);
  });
});

test('Shopify : mauvais grade et accessoires refusés', async () => {
  await withDb(async (t) => {
    const fetch = web({
      gp: () => [product('MG 1/100 Gundam Aerial', 'mg-aerial'), product('HG Gundam Aerial Option Parts', 'opt'), product('RG Gundam Aerial Metal Build', 'mb')],
    });
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const reasons = [];
    const p = chain(fetch)[1];
    assert.equal(await p.find('Gundam Aerial', 'HG', (r) => reasons.push(r)), null);
    assert.deepEqual(reasons, [REASONS.noCandidate]);
    assert.deepEqual(await run(t, id, fetch), { found: false });
    assert.equal(getPhoto(t.db, id), undefined);
    assert.equal(await p.find('Aerial', 'XX', (r) => reasons.push(r)), null); // grade inconnu et un seul mot : jamais deviné
    assert.equal(reasons.at(-1), REASONS.grade);
  });
});

test('Shopify : produit voisin faux (Ingressa Milita / Nightingale) refusé par les mots du kit', async () => {
  await withDb(async (t) => {
    const fetch = web({ gp: () => [product('HG 1/144 Nightingale', 'night')], usa: () => [product('HG 1/144 Nightingale', 'night')] });
    const id = addRealKit(t.db, 1, 'HG 1/144 INGRESSA MILITA');
    assert.deepEqual(await run(t, id, fetch), { found: false });
    assert.equal(getPhoto(t.db, id), undefined);
  });
});

test('Shopify : USA Gundam Store en repli quand HLJ et Gundam Planet échouent', async () => {
  await withDb(async (t) => {
    const fetch = web({ usa: () => [product('HGCE 1/144 #201 Strike Freedom Gundam', 'usa-sf')] });
    const id = addRealKit(t.db, 1, '201 HGCE 1/144 STRIKE FREEDOM GUNDAM (13)');
    const stats = {};
    assert.deepEqual(await run(t, id, fetch, { stats }), { found: true });
    assert.equal(getPhoto(t.db, id).source_url, 'https://www.usagundamstore.com/products/usa-sf');
    assert.deepEqual([stats['hlj-box'].found, stats.gundamplanet.found, stats.usagundamstore.found], [0, 0, 1]);
  });
});

test('Shopify : mots en trop = à vérifier ; égalité ambiguë = refus ; un doute ne remplace pas une photo', async () => {
  await withDb(async (t) => {
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const doubt = web({ gp: () => [product('HG Gundam Aerial Permet Score Six', 'pss')] });
    assert.deepEqual(await run(t, id, doubt), { found: true });
    assert.equal(getPhoto(t.db, id).uncertain, 1);

    const other = addRealKit(t.db, 2, 'HG 1/144 GUNDAM AERIAL');
    const tie = web({ gp: () => [product('HG Gundam Aerial A', 'a'), product('HG Gundam Aerial B', 'b')] });
    const reasons = [];
    assert.equal(await chain(tie)[1].find('Gundam Aerial', 'HG', (r) => reasons.push(r)), null);
    assert.deepEqual(reasons, [REASONS.ambiguous]);
    assert.deepEqual(await run(t, other, tie), { found: false });

    // une photo déjà là (HLJ) n'est jamais remplacée par une source moins bien classée ni par un doute
    const kept = addRealKit(t.db, 3, 'HG 1/144 GUNDAM AERIAL');
    savePhoto({ db: t.db, dataDir: t.dir, kitId: kept, bytes: PNG, kind: 'auto', sourceUrl: 'https://www.hlj.com/x-ban1' });
    assert.deepEqual(await run(t, kept, doubt), { found: false });
    assert.equal(getPhoto(t.db, kept).source_url, 'https://www.hlj.com/x-ban1');
  });
});

test('Shopify : image hors cdn.shopify.com, http, port ou fiche d une autre boutique rejetées', async () => {
  await withDb(async (t) => {
    for (const image of ['http://cdn.shopify.com/a.jpg', 'https://evil.example.com/a.jpg', 'https://cdn.shopify.com.evil.example/a.jpg', 'https://cdn.shopify.com:8443/a.jpg', 'https://cdn.shopify.com/a.html', null]) {
      const fetch = web({ gp: () => [product('HG Gundam Aerial', 'x', image)] });
      const reasons = [];
      assert.equal(await chain(fetch)[1].find('Gundam Aerial', 'HG', (r) => reasons.push(r)), null, String(image));
      assert.deepEqual(reasons, [REASONS.badPage], String(image));
    }
    const elsewhere = web({ gp: () => [{ ...product('HG Gundam Aerial', 'x'), url: 'https://evil.example.com/products/x' }] });
    assert.equal(await chain(elsewhere)[1].find('Gundam Aerial', 'HG'), null);
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    assert.deepEqual(await run(t, id, web({ gp: () => [product('HG Gundam Aerial', 'x', 'http://cdn.shopify.com/a.jpg')] })), { found: false });
    assert.equal(getPhoto(t.db, id), undefined);
  });
});

test('Shopify : 429 -> nouvel essai (2 fois), puis erreur de source sans exception', async () => {
  const p = (statuses) => {
    let n = 0;
    const fetch = async () => (statuses[n++] === 429 ? new Response('', { status: 429 }) : suggestion(product('HG Gundam Aerial', 'ok')));
    return { find: shopifyProvider({ name: 'gp', host: 'gundamplanet.com', fetch, minIntervalMs: 0, retryMs: 1 }).find, count: () => n };
  };
  const once = p([429, 200]);
  assert.ok(await once.find('Gundam Aerial', 'HG'));
  assert.equal(once.count(), 2);
  const never = p([429, 429, 429, 429]);
  const reasons = [];
  const log = console.error;
  console.error = () => {};
  try {
    assert.equal(await never.find('Gundam Aerial', 'HG', (r) => reasons.push(r)), null);
  } finally {
    console.error = log;
  }
  assert.deepEqual(reasons, [REASONS.source]);
  assert.equal(never.count(), 3); // 1 essai + 2 nouveaux essais
});

test('disjoncteur : après des erreurs de source consécutives la source est sautée, une ligne de journal, aucune exception', async () => {
  await withDb(async (t) => {
    const lines = [];
    console.error = (m) => lines.push(String(m));
    const fetch = web({ gp: () => 503, usa: () => [product('HG Gundam Aerial', 'ok')] });
    const breaker = new Map();
    const providers = chain(fetch);
    const ids = Array.from({ length: BREAKER + 2 }, (_, i) => addRealKit(t.db, i + 1, 'HG 1/144 GUNDAM AERIAL'));
    const stats = {};
    for (const kitId of ids.slice(0, -1)) await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId, providers, fetch, stats, breaker });
    // chaque kit a été trouvé par USA (repli) ; Gundam Planet n'est interrogé que BREAKER fois
    assert.equal(stats.gundamplanet.errors, BREAKER);
    assert.equal(stats.usagundamstore.found, ids.length - 1);
    assert.equal(lines.filter((l) => /gundamplanet.*skipped for the rest of the job/.test(l)).length, 1);
    // une source qui répond de nouveau remet le compteur à zéro
    const ok = new Map([['usagundamstore', 3]]);
    await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: ids.at(-1), providers: [providers[2]], fetch, breaker: ok });
    assert.equal(ok.has('usagundamstore'), false);
  });
});

test('politeGate : intervalle minimal respecté même en parallèle', async () => {
  const gate = politeGate(40);
  const times = [];
  await Promise.all([1, 2, 3].map(() => gate().then(() => times.push(Date.now()))));
  assert.ok(times[1] - times[0] >= 30 && times[2] - times[1] >= 30, times.join());
});

test('rang : une photo d une boutique Shopify n est améliorée que par une source mieux classée ; upload et « Photo vérifiée » jamais touchés', async () => {
  await withDb(async (t) => {
    const providers = chain(web());
    const names = (kitId) => providersToTry({ db: t.db, kitId, providers }).map((p) => p.name);
    const at = (n, sourceUrl, extra = {}) => {
      const id = addRealKit(t.db, n, 'HG 1/144 GUNDAM AERIAL');
      savePhoto({ db: t.db, dataDir: t.dir, kitId: id, bytes: PNG, ...extra, sourceUrl, kind: extra.kind ?? 'auto' });
      return id;
    };
    assert.deepEqual(names(at(1, 'https://www.gundamplanet.com/products/x')), ['hlj-box']);
    assert.deepEqual(names(at(2, 'https://www.usagundamstore.com/products/x')), ['hlj-box', 'gundamplanet']);
    assert.deepEqual(names(at(3, 'https://www.gundamplanet.com/products/x', { uncertain: true })), ['hlj-box', 'gundamplanet', 'usagundamstore']); // P1 : à vérifier = toutes les sources, une sûre moins bien classée peut la remplacer
    assert.deepEqual(names(at(4, 'https://www.hlj.com/x-ban1')), []); // « vérifiée » = sûre depuis la meilleure source
    const upload = at(5, null, { kind: 'user' });
    assert.deepEqual(names(upload), []);
    // même si une source trouvait quelque chose, l'upload reste
    const hit = web({ gp: () => [product('HG Gundam Aerial', 'x')] });
    assert.deepEqual(await run(t, upload, hit), { found: false });
    assert.equal(getPhoto(t.db, upload).kind, 'user');
  });
});

test('tâche de rafraîchissement : kits en parallèle, décomptes par source, source en panne tolérée', async () => {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const router = createRouter();
  const fetch = web({
    gp: (q) => (/Aerial/.test(q) ? [product('HG Gundam Aerial', 'aerial')] : /Sazabi/.test(q) ? 500 : []),
    usa: (q) => (/Sazabi/.test(q) ? [product('MG Sazabi', 'sazabi')] : []),
  });
  const orig = { log: console.log, error: console.error };
  console.error = console.log = () => {};
  photoRoutes(router, { db, dataDir: tmp.dir, fetch });
  const server = createServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    addRealKit(db, 1, 'HG 1/144 GUNDAM AERIAL');
    addRealKit(db, 2, 'MG 1/100 SAZABI');
    addRealKit(db, 3, 'HG 1/144 INGRESSA MILITA');
    assert.equal((await globalThis.fetch(`${base}/api/photos/refresh`, { method: 'POST' })).status, 202);
    let st;
    do {
      await new Promise((r) => setTimeout(r, 20));
      st = await (await globalThis.fetch(`${base}/api/photos/status`)).json();
    } while (st.running);
    assert.deepEqual([st.last.tried, st.last.found, st.last.missing], [3, 2, 1]);
    assert.equal(st.last.sources.gundamplanet.found, 1);
    assert.equal(st.last.sources.gundamplanet.errors, 1); // Sazabi : 500 chez Gundam Planet, repli USA
    assert.equal(st.last.sources.usagundamstore.found, 1);
  } finally {
    Object.assign(console, orig);
    server.closeAllConnections();
    server.close();
    db.close();
    tmp.cleanup();
  }
});
