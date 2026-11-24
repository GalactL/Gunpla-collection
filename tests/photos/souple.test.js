import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { REASONS, hljProvider } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';
import { fetchPhotoForKit } from '../../src/photos/fetch.js';
import { getPhoto, savePhoto } from '../../src/photos/store.js';

// Correspondance souple : un mot manquant, grade absent, requête assouplie boutique. Vraies lignes kits (cleanTitle), web simulé.
const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
const hljPage = (items) =>
  `<div>${items.map(([name, slug]) => `<div class="search-widget-block"><a href="/${slug}"><img src="/productthumbs/ban/${slug}_0_1.jpg"></a><p class="product-item-name"><a href="/${slug}">${name}</a></p></div>`).join('')}</div>`;
const shop = (title, slug) => ({ title, url: `/products/${slug}`, image: `${CDN}${slug}.jpg` });

// hlj / gp : (query) -> [[title, slug]] / [products]; queries are recorded per site.
function web({ hlj = () => [], gp = () => [], queries = { hlj: [], gp: [] } } = {}) {
  const f = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'www.hlj.com' && u.pathname === '/search/') return queries.hlj.push(u.searchParams.get('q')), new Response(hljPage(hlj(queries.hlj.at(-1))), { status: 200 });
    if (u.hostname === 'www.gundamplanet.com' && u.pathname === '/search/suggest.json') {
      queries.gp.push(u.searchParams.get('q'));
      return Response.json({ resources: { results: { products: gp(queries.gp.at(-1)) } } });
    }
    return new Response(PNG, { status: 200 });
  };
  f.queries = queries;
  return f;
}
const providers = (fetch) => [
  hljProvider({ fetch, minIntervalMs: 0 }),
  shopifyProvider({ name: 'gundamplanet', host: 'gundamplanet.com', fetch, minIntervalMs: 0, retryMs: 1 }),
];

async function withDb(fn) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const logs = [];
  const orig = console.error;
  console.error = (m) => logs.push(String(m));
  try {
    await fn({ db, dir: tmp.dir, logs });
  } finally {
    console.error = orig;
    db.close();
    tmp.cleanup();
  }
}
let n = 0;
const kit = (t, raw) => addRealKit(t.db, ++n, raw);
const job = (t, kitId, fetch, extra = {}) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId, providers: providers(fetch), fetch, ...extra });
const row = (t, id) => getPhoto(t.db, id);

test('assouplissement (i) un mot du kit manquant, kit de 3 mots, grade concordant : à vérifier (HLJ et boutique), ligne de journal', async () => {
  await withDb(async (t) => {
    const a = kit(t, '1/144 HG GUNDAM AERIAL REBUILD');
    const stats = {};
    assert.deepEqual(await job(t, a, web({ hlj: () => [['1/144 HG Gundam Aerial', 'hg-aerial-ban1']] }), { stats }), { found: true });
    assert.deepEqual([row(t, a).uncertain, row(t, a).source_url], [1, 'https://www.hlj.com/hg-aerial-ban1']);
    assert.equal(stats['hlj-box'].uncertain, 1);
    assert.ok(t.logs.some((l) => l.includes(`kit ${a} hlj-box: uncertain`) && l.includes('mot manquant : rebuild')), t.logs.join('\n'));

    const b = kit(t, '1/144 HG GUNDAM AERIAL REBUILD');
    assert.deepEqual(await job(t, b, web({ gp: () => [shop('HG Gundam Aerial', 'gp-aerial')] })), { found: true });
    assert.deepEqual([row(t, b).uncertain, row(t, b).source_url], [1, 'https://www.gundamplanet.com/products/gp-aerial']);
  });
});

test('assouplissement (ii) kit de 2 mots avec un mot manquant : refus (HLJ et boutique) ; (x) V Gundam, Ingressa Milita, Zaku I restent refusés', async () => {
  await withDb(async (t) => {
    const cases = [
      ['1/144 HG REBUILD AERIAL', 'HG Aerial'],
      ['1/144 HG 188 V GUNDAM', 'HG 1.5 Gundam'],
      ['1/144 HG INGRESSA MILITA', 'HG Nightingale'],
      ['1/144 HG 044 ZAKU I BLACK TRISTARS', 'HG Zaku II Black Tristars'], // "I" manque : numéral romain jamais toléré
    ];
    for (const [raw, title] of cases) {
      const id = kit(t, raw);
      const fetch = web({ hlj: () => [[`1/144 ${title}`, 'x-ban1']], gp: () => [shop(title, 'x')] });
      assert.deepEqual(await job(t, id, fetch), { found: false }, raw);
      assert.equal(row(t, id), undefined, raw);
    }
  });
});

test('assouplissement (iii) grade absent du titre de la fiche, tous les mots présents : à vérifier (boutique et HLJ) ; grade écrit ailleurs : refus', async () => {
  await withDb(async (t) => {
    const a = kit(t, '1/144 HG GUNDAM AERIAL');
    assert.deepEqual(await job(t, a, web({ gp: () => [shop('Gundam Aerial Model Kit', 'gp-bare')] })), { found: true });
    assert.deepEqual([row(t, a).uncertain, row(t, a).source_url], [1, 'https://www.gundamplanet.com/products/gp-bare']);
    assert.ok(t.logs.some((l) => l.includes('grade absent')), t.logs.join('\n'));

    const b = kit(t, '1/144 HG GUNDAM AERIAL');
    assert.deepEqual(await job(t, b, web({ hlj: () => [['Gundam Aerial Model Kit', 'bare-ban1']] })), { found: true });
    assert.equal(row(t, b).uncertain, 1);

    const c = kit(t, '1/144 HG GUNDAM AERIAL');
    assert.deepEqual(await job(t, c, web({ hlj: () => [['Gundam Decal MG Gundam Aerial', 'decal-ban2']], gp: () => [shop('Gundam Aerial MG', 'mg-end')] })), { found: false });
  });
});

test('assouplissement (iv) grade explicite différent : refus même avec tous les mots (HLJ et boutique)', async () => {
  await withDb(async (t) => {
    const id = kit(t, '1/144 HG GUNDAM AERIAL');
    assert.deepEqual(await job(t, id, web({ hlj: () => [['1/100 MG Gundam Aerial', 'mg-ban1']], gp: () => [shop('MG Gundam Aerial', 'mg')] })), { found: false });
    assert.equal(row(t, id), undefined);
  });
});

test('assouplissement (v) kit sans grade : tous les mots présents et 2 mots ou plus = à vérifier (HLJ et boutique) ; un seul mot = aucune requête', async () => {
  await withDb(async (t) => {
    const a = kit(t, 'GUNDAM AERIAL');
    const f = web({ hlj: () => [['1/144 HG Gundam Aerial', 'hg-aerial-ban1']] });
    assert.deepEqual(await job(t, a, f), { found: true });
    assert.deepEqual([row(t, a).uncertain, f.queries.hlj], [1, ['Gundam Aerial']]);
    assert.ok(t.logs.some((l) => l.includes('grade absent')));

    const b = kit(t, 'GUNDAM AERIAL');
    const g = web({ gp: (q) => (q === 'Gundam Aerial' ? [shop('HG Gundam Aerial', 'gp-aerial')] : []) }); // pas de préfixe de grade
    assert.deepEqual(await job(t, b, g), { found: true });
    assert.equal(row(t, b).uncertain, 1);

    const one = kit(t, 'SINANJU');
    const h = web({ hlj: () => [['1/100 MG Sinanju', 'mg-sinanju-ban1']], gp: () => [shop('MG Sinanju', 'sin')] });
    const reasons = [];
    assert.equal(await providers(h)[1].find('Sinanju', null, (r) => reasons.push(r)), null);
    assert.deepEqual(reasons, [REASONS.grade]);
    assert.deepEqual(await job(t, one, h), { found: false });
    assert.deepEqual([h.queries.hlj, h.queries.gp], [[], []]);

    // un grade explicite sur la fiche n'est pas un conflit quand le kit n'en a pas, mais les mots doivent tous y être
    const c = kit(t, 'GUNDAM AERIAL REBUILD');
    assert.deepEqual(await job(t, c, web({ hlj: () => [['1/144 HG Gundam Aerial', 'hg-aerial-ban1']] })), { found: false });
  });
});

test('assouplissement (vi) boutique : zéro produit puis requête assouplie, à vérifier relaxed/dropped ; une seule requête de plus', async () => {
  await withDb(async (t) => {
    const id = kit(t, '1/100 MG AMX-004-3 QUBELEY MK-II');
    const f = web({ gp: (q) => (q === 'MG Qubeley Mk-Ii' ? [shop("MG AMX-004-3 Qubeley Mk-II", 'gp-qubeley')] : []) });
    const stats = {};
    assert.deepEqual(await job(t, id, f, { stats }), { found: true });
    assert.deepEqual(f.queries.gp, ['MG AMX-004-3 Qubeley Mk-Ii', 'MG Qubeley Mk-Ii']);
    assert.deepEqual([row(t, id).uncertain, row(t, id).source_url], [1, 'https://www.gundamplanet.com/products/gp-qubeley']);
    assert.deepEqual([stats.gundamplanet.relaxed, stats.gundamplanet.uncertain], [1, 1]);
    assert.ok(t.logs.some((l) => l.includes('gundamplanet: uncertain (relaxed query; dropped: AMX-004-3')), t.logs.join('\n'));

    // la requête assouplie ne renvoie rien non plus : pas de troisième requête ; produits non vides : pas de requête assouplie
    const none = kit(t, '1/100 MG AMX-004-3 QUBELEY MK-II');
    const g = web();
    assert.deepEqual(await job(t, none, g), { found: false });
    assert.equal(g.queries.gp.length, 2);
    const some = kit(t, '1/100 MG AMX-004-3 QUBELEY MK-II');
    const h = web({ gp: () => [shop('MG Zaku II', 'zaku')] });
    assert.deepEqual(await job(t, some, h), { found: false });
    assert.equal(h.queries.gp.length, 1);
    // rien à assouplir : une seule requête
    const plain = kit(t, '1/144 HG SANDROCK CUSTOM EW');
    const p = web();
    await job(t, plain, p);
    assert.equal(p.queries.gp.length, 1);
    // mauvais grade au passage assoupli : refusé
    const wrong = kit(t, '1/100 MG AMX-004-3 QUBELEY MK-II');
    assert.deepEqual(await job(t, wrong, web({ gp: (q) => (q === 'MG Qubeley Mk-Ii' ? [shop('HG Qubeley Mk-II', 'hg')] : []) })), { found: false });
  });
});

test('assouplissement (vii)(viii) égalité entre deux pages douteuses = refus ; une sûre l\'emporte ; moins de mots manquants avant moins de mots en trop', async () => {
  await withDb(async (t) => {
    const tie = [['1/144 HG Gundam Aerial A', 'a-ban1'], ['1/144 HG Gundam Aerial B', 'b-ban2']];
    const a = kit(t, '1/144 HG GUNDAM AERIAL REBUILD');
    const tieMissing = web({ hlj: () => [['1/144 HG Gundam Aerial', 'x-ban1'], ['1/144 HG Gundam Rebuild', 'y-ban2']] }); // chacune un mot manquant, aucun en trop
    assert.deepEqual(await job(t, a, tieMissing), { found: false });
    assert.ok(t.logs.some((l) => l.includes(`kit ${a} hlj-box: refused (${REASONS.ambiguous})`)));
    const b = kit(t, '1/144 HG GUNDAM AERIAL');
    assert.deepEqual(await job(t, b, web({ gp: () => tie.map(([ti, s]) => shop(ti.replace('1/144 ', ''), s)) })), { found: false });

    // une sûre l'emporte sur une douteuse (un mot manquant), non marquée
    const c = kit(t, '1/144 HG GUNDAM AERIAL REBUILD');
    assert.deepEqual(await job(t, c, web({ hlj: () => [['1/144 HG Gundam Aerial', 'doubt-ban1'], ['1/144 HG Gundam Aerial Rebuild', 'sure-ban2']] })), { found: true });
    assert.deepEqual([row(t, c).uncertain, row(t, c).source_url], [0, 'https://www.hlj.com/sure-ban2']);

    // trois mots en trop (aucun manquant) battent un mot manquant (aucun en trop)
    const d = kit(t, '1/144 HG GUNDAM AERIAL REBUILD');
    const f = web({ hlj: () => [['1/144 HG Gundam Aerial', 'missing-ban1'], ['1/144 HG Gundam Aerial Rebuild Permet Score Six', 'extra-ban2']] });
    assert.deepEqual(await job(t, d, f), { found: true });
    assert.equal(row(t, d).source_url, 'https://www.hlj.com/extra-ban2');
  });
});

test('assouplissement (ix) une fiche douteuse (mot manquant, grade absent) ne remplace jamais une photo existante ; une sûre remplace une à vérifier', async () => {
  await withDb(async (t) => {
    const hlj = (title) => web({ hlj: () => [[title, 'new-ban1']], gp: () => [shop('Gundam Aerial', 'gp-bare')] });
    const seed = (raw, opts) => {
      const id = kit(t, raw);
      savePhoto({ db: t.db, dataDir: t.dir, kitId: id, bytes: PNG, kind: 'auto', ...opts });
      return id;
    };
    const wiki = seed('1/144 HG GUNDAM AERIAL REBUILD', { sourceUrl: 'https://gundam.fandom.com/wiki/Aerial' });
    assert.deepEqual(await job(t, wiki, hlj('1/144 HG Gundam Aerial')), { found: false });
    assert.equal(row(t, wiki).source_url, 'https://gundam.fandom.com/wiki/Aerial');
    const shopPhoto = seed('1/144 HG GUNDAM AERIAL', { sourceUrl: 'https://www.hlj.com/old-ban0' });
    assert.deepEqual(await job(t, shopPhoto, hlj('Gundam Aerial')), { found: false });
    const user = seed('1/144 HG GUNDAM AERIAL', { kind: 'user' });
    assert.deepEqual(await job(t, user, hlj('1/144 HG Gundam Aerial')), { found: false });
    assert.equal(row(t, user).kind, 'user');
    // une sûre remplace une photo "à vérifier"
    const unsure = seed('1/144 HG GUNDAM AERIAL', { sourceUrl: 'https://www.hlj.com/old-ban0', uncertain: true });
    assert.deepEqual(await job(t, unsure, hlj('1/144 HG Gundam Aerial')), { found: true });
    assert.deepEqual([row(t, unsure).uncertain, row(t, unsure).source_url], [0, 'https://www.hlj.com/new-ban1']);
  });
});
