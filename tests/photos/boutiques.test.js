import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { REASONS, hljProvider } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';
import { fetchPhotoForKit, providersToTry } from '../../src/photos/fetch.js';
import { getPhoto, savePhoto } from '../../src/photos/store.js';

// Sources 4 et 5 : A-Z Toy Hobby (nom seul puis grade + nom) et Las Cale Model (l'inverse). Kits réels (cleanTitle),
// titres relevés par le sondage des boutiques, web simulé.
const CDN = 'https://cdn.shopify.com/s/files/1/0552/1804/5102/files/';
const item = (title, slug, image = `${CDN}${slug}.jpg?v=1`) => ({ title, url: `/products/${slug}?_pos=1&_psq=x`, image });
const GYAN = [
  item('Bandai MG YMS-15 Gyan 1/100 Model Kit', 'bandai-mg-yms-15-gyan-1-100-model-kit'),
  item("Bandai HGGQX 07 Xavier's Gyan Hakuji-Packs 1/144 Model Kit", 'hggqx-gyan'),
  item('HGCE 249 Gyan Strom (Agnes Giebenrath Custom) 1/144 Model Kit', 'gyan-strom'),
  item("Delpi Water Decal For HGGQX Xavier's Gyan Hakuji", 'delpi-gyan'),
  item("G-Rework Water Decal For HGGQX Xavier's Gyan Hakuji Packs", 'grework-gyan'),
];
const BANSHEE = [
  item('MG Banshee Ver. Ka 1/100 Model Kit', 'mg-banshee-ka'),
  item('MG Banshee 1/100 Model Kit', 'mg-banshee'),
  item('Delpi Gold Holo Water Decal For MG Banshee', 'delpi-banshee'),
  item('Bandai Unicorn Gundam 02 Banshee Norn PG 1/60 Model Kit', 'pg-banshee-norn'),
];
const NARRATIVE_LAS = [
  item('Bandai HGUC #218 1/144 RX-9/A Narrative Gundam A-Packs Model Kit', 'hg-a-packs'),
  item('Bandai MG 1/100 RX-9/C Narrative Gundam C-Packs (Ver.Ka) Model Kit', 'mg-1-100-rx-9-c-narrative-gundam-c-packs-ver-ka'),
  item('Bandai HGUC #222 1/144 RX-9/C Narrative Gundam (C-Packs) Model Kit', 'hg-c-packs'),
];

const HOSTS = ['gundamplanet', 'usagundamstore', 'aztoyhobby', 'lascalemodel'];
// shops: { aztoyhobby: (q) => products | status } ; queries / calls are recorded per shop.
function web(shops = {}) {
  const queries = Object.fromEntries(HOSTS.map((h) => [h, []]));
  const calls = [];
  const f = async (url) => {
    const u = new URL(url);
    calls.push(u.hostname);
    if (u.hostname === 'www.hlj.com') return new Response('<div></div>', { status: 200 });
    const h = u.hostname.replace(/^www\.|\.com$/g, '');
    if (HOSTS.includes(h)) {
      queries[h].push(u.searchParams.get('q'));
      const r = shops[h]?.(u.searchParams.get('q')) ?? [];
      return typeof r === 'number' ? new Response('', { status: r }) : Response.json({ resources: { results: { products: r } } });
    }
    return new Response(PNG, { status: 200 }); // image download
  };
  return Object.assign(f, { queries, calls });
}
const shop = (name, host, fetch, extra) => shopifyProvider({ name, host, fetch, minIntervalMs: 0, retryMs: 1, ...extra });
const chain = (fetch) => [
  hljProvider({ fetch, minIntervalMs: 0 }),
  shop('gundamplanet', 'gundamplanet.com', fetch),
  shop('usagundamstore', 'usagundamstore.com', fetch),
  shop('aztoyhobby', 'aztoyhobby.com', fetch, { forms: [false, true], tidy: true }),
  shop('lascalemodel', 'lascalemodel.com', fetch, { forms: [true, false], tidy: true }),
];
const az = (fetch) => chain(fetch)[3];
const las = (fetch) => chain(fetch)[4];

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
const run = (t, kitId, fetch, providers = chain(fetch)) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId, providers, fetch });
const refusal = async (p, name, grade) => {
  const reasons = [];
  assert.equal(await p.find(name, grade, (r) => reasons.push(r)), null);
  return reasons;
};

test('A-Z : kit refusé par HLJ, Gundam Planet et USA Gundam Store trouvé en première forme (nom seul), decals ignorés', async () => {
  await withDb(async (t) => {
    const id = addRealKit(t.db, 1, 'MG 1/100 GYAN');
    const before = web();
    assert.deepEqual(await run(t, id, before, chain(before).slice(0, 3)), { found: false }); // 3 refus mémorisés
    const fetch = web({ aztoyhobby: (q) => (q === 'Gyan' ? GYAN : BANSHEE) });
    const providers = chain(fetch);
    assert.deepEqual(providersToTry({ db: t.db, kitId: id, providers }).map((p) => p.name), providers.map((p) => p.name)); // refus par source : les 2 nouvelles sont proposées
    assert.deepEqual(await run(t, id, fetch, providers), { found: true });
    assert.deepEqual(fetch.calls.filter((h) => /gundamplanet|usagundamstore|hlj/.test(h)), []); // refus mémorisés : pas redemandés
    assert.deepEqual(fetch.queries.aztoyhobby, ['Gyan']);
    assert.deepEqual(fetch.queries.lascalemodel, []);
    const row = getPhoto(t.db, id);
    assert.equal(row.source_url, 'https://www.aztoyhobby.com/products/bandai-mg-yms-15-gyan-1-100-model-kit');
    assert.equal(row.uncertain, 0);
  });
});

test('A-Z : « Gyan » trouvé seulement avec la requête courte ; « MG Gyan » ne donne que des Banshee refusés (2 requêtes, pas de 3e)', async () => {
  await withDb(async (t) => {
    const fetch = web({ aztoyhobby: (q) => (q === 'Gyan' ? [item('Delpi Water Decal For MG Gyan', 'd')] : BANSHEE) });
    assert.deepEqual(await refusal(az(fetch), 'Gyan', 'MG'), [REASONS.noCandidate]);
    assert.deepEqual(fetch.queries.aztoyhobby, ['Gyan', 'MG Gyan']);
    // seconde forme gagnante : « MG Gyan » donne la bonne fiche
    const second = web({ aztoyhobby: (q) => (q === 'MG Gyan' ? GYAN : BANSHEE) });
    const hit = await az(second).find('Gyan', 'MG');
    assert.equal(hit.pageUrl, 'https://www.aztoyhobby.com/products/bandai-mg-yms-15-gyan-1-100-model-kit');
    assert.deepEqual(second.queries.aztoyhobby, ['Gyan', 'MG Gyan']);
  });
});

test('Las Cale Model : prend le relais quand A-Z échoue, grade + nom en premier', async () => {
  await withDb(async (t) => {
    const id = addRealKit(t.db, 1, 'MG 1/100 NARRATIVE GUNDAM C-PACKS');
    const fetch = web({
      aztoyhobby: () => [item('Delpi Water Decal For MG Narrative C-Packs Ver. Ka', 'd'), item('HGUC 222 Narrative Gundam C-Packs 1/144 Model Kit', 'h')],
      lascalemodel: () => NARRATIVE_LAS,
    });
    assert.deepEqual(await run(t, id, fetch), { found: true });
    assert.deepEqual(fetch.queries.aztoyhobby, ['Narrative Gundam C-Packs', 'MG Narrative Gundam C-Packs']);
    assert.deepEqual(fetch.queries.lascalemodel, ['MG Narrative Gundam C-Packs']);
    const row = getPhoto(t.db, id);
    assert.equal(row.source_url, 'https://www.lascalemodel.com/products/mg-1-100-rx-9-c-narrative-gundam-c-packs-ver-ka');
    assert.equal(row.uncertain, 0);
  });
});

test('requêtes : au plus 2 de base + 1 assouplie par boutique et par kit ; les 3 sources existantes gardent une seule forme', async () => {
  await withDb(async (t) => {
    const empty = web();
    const id = addRealKit(t.db, 1, 'MG 1/100 XXXG-01W WING GUNDAM');
    assert.deepEqual(await run(t, id, empty), { found: false });
    assert.equal(empty.queries.aztoyhobby.length, 3);
    assert.equal(empty.queries.lascalemodel.length, 3);
    assert.equal(empty.queries.aztoyhobby[0].startsWith('MG'), false);
    assert.equal(empty.queries.lascalemodel[0].startsWith('MG'), true);
    assert.equal(empty.queries.aztoyhobby[2], 'MG Wing Gundam'); // assouplie : zéro produit aux deux formes
    assert.equal(empty.queries.gundamplanet.length, 2); // 1 base + 1 assouplie, comme avant
    assert.equal(empty.queries.usagundamstore.length, 2);
    // des produits qui ne conviennent pas : pas d'assouplie, 2 requêtes pour les nouvelles, 1 pour les anciennes
    const other = web(Object.fromEntries(HOSTS.map((h) => [h, () => BANSHEE])));
    await run(t, addRealKit(t.db, 2, 'MG 1/100 XXXG-01W WING GUNDAM'), other);
    assert.deepEqual(HOSTS.map((h) => other.queries[h].length), [1, 1, 2, 2]);
  });
});

test('image hors cdn.shopify.com, http, port ou fiche d une autre boutique rejetées par les nouvelles boutiques', async () => {
  for (const image of ['https://evil.example.com/a.jpg', 'http://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com:8443/a.jpg', 'https://cdn.shopify.com.evil.example/a.jpg', 'https://cdn.shopify.com/a.html']) {
    const fetch = web({ aztoyhobby: () => [item('Bandai MG YMS-15 Gyan 1/100 Model Kit', 'x', image)], lascalemodel: () => [item('Bandai MG 1/100 YMS-15 Gyan Model Kit', 'x', image)] });
    for (const p of [az(fetch), las(fetch)]) assert.deepEqual(await refusal(p, 'Gyan', 'MG'), [REASONS.badPage], image);
  }
  const elsewhere = web({ aztoyhobby: () => [{ ...GYAN[0], url: 'https://evil.example.com/products/x' }] });
  assert.equal(await az(elsewhere).find('Gyan', 'MG'), null);
});

test('rang : une photo d A-Z ou de Las Cale n est améliorée que par une source mieux classée, sans réinterroger les autres', async () => {
  await withDb(async (t) => {
    const fetch = web({ aztoyhobby: () => GYAN, lascalemodel: () => [item('Bandai MG 1/100 YMS-15 Gyan Model Kit', 'las-gyan')] });
    const providers = chain(fetch);
    const names = (id) => providersToTry({ db: t.db, kitId: id, providers }).map((p) => p.name);
    const at = (n, url, extra = {}) => {
      const id = addRealKit(t.db, n, 'MG 1/100 GYAN');
      savePhoto({ db: t.db, dataDir: t.dir, kitId: id, bytes: PNG, kind: 'auto', sourceUrl: url, ...extra });
      return id;
    };
    assert.deepEqual(names(at(1, 'https://www.usagundamstore.com/products/x')), ['hlj-box', 'gundamplanet']);
    assert.deepEqual(names(at(2, 'https://www.aztoyhobby.com/products/x')), ['hlj-box', 'gundamplanet', 'usagundamstore']);
    assert.deepEqual(names(at(3, 'https://www.lascalemodel.com/products/x')), ['hlj-box', 'gundamplanet', 'usagundamstore', 'aztoyhobby']);
    assert.deepEqual(names(at(4, 'https://www.lascalemodel.com/products/x', { uncertain: true })), providers.map((p) => p.name)); // à vérifier : sa propre source aussi
    // photo d A-Z : Las Cale n'est pas interrogée, la photo reste
    const kept = at(5, 'https://www.aztoyhobby.com/products/old');
    assert.deepEqual(await run(t, kept, fetch), { found: false });
    assert.deepEqual(fetch.queries.lascalemodel, []);
    assert.equal(getPhoto(t.db, kept).source_url, 'https://www.aztoyhobby.com/products/old');
    // pas de photo : A-Z passe avant Las Cale et garde le kit
    const fresh = addRealKit(t.db, 6, 'MG 1/100 GYAN');
    assert.deepEqual(await run(t, fresh, fetch), { found: true });
    assert.match(getPhoto(t.db, fresh).source_url, /aztoyhobby/);
    assert.deepEqual(fetch.queries.lascalemodel, []);
  });
});

test('decals Delpi / G-Rework / stickers exclus ; les 6 paires fausses historiques refusées par A-Z et Las Cale', async () => {
  const decals = web({ aztoyhobby: () => [item('Delpi Gold Metal Sticker For MG Unicorn & Banshee', 'a'), item('G-Rework Water Decal For MG Banshee', 'b'), item('Delpi Water Decal For MG Banshee', 'c')] });
  assert.equal(await az(decals).find('Banshee', 'MG'), null);
  // [kit brut, titre de la fiche]
  const PAIRS = [
    ['HG 1/144 V GUNDAM', '1.5 Gundam'],
    ['HG 1/144 INGRESSA MILITA', 'MSN-04 II Nightingale'],
    ['HG 1/144 ZAKU I', 'MS-05 Zaku II'],
    ['HG 1/144 ZAKU II', 'MS-05B Zaku I'],
    ['HG 1/144 RX-178 GUNDAM MK-II', 'RX-178 Gundam Mk-III'],
    ['HG 1/144 NU GUNDAM', 'Hi-Nu Gundam'],
  ];
  await withDb(async (t) => {
    let n = 0;
    for (const [raw, title] of PAIRS) {
      for (const page of [`HGUC ${title}`, `Bandai HGUC ${title} 1/144 Model Kit`, `Bandai HGUC #12 1/144 ${title} Model Kit`]) {
        const fetch = web({ aztoyhobby: () => [item(page, 'x')], lascalemodel: () => [item(page, 'x')] });
        const id = addRealKit(t.db, ++n, raw);
        assert.deepEqual(await run(t, id, fetch, chain(fetch).slice(3)), { found: false }, `${raw} <- ${page}`);
        assert.equal(getPhoto(t.db, id), undefined);
      }
    }
  });
});

test('titres de revendeur : fournisseur et « Model Kit » ignorés, grade en fin de titre ramené en tête ; mauvais grade refusé', async () => {
  const fetch = web({ aztoyhobby: () => [item('Bandai Zeta Gundam PG 1/60 Model Kit', 'pg'), item('Bandai Zeta Gundam Ver. Ka MG 1/100 Model Kit', 'mg-ka')] });
  const hit = await az(fetch).find('Zeta Gundam', 'MG');
  assert.equal(hit.pageUrl, 'https://www.aztoyhobby.com/products/mg-ka');
  assert.equal(hit.uncertain, undefined); // « Ver. Ka » = mots sans effet
  const twice = web({ aztoyhobby: () => [item('MG Narrative Gundam C-Packs Ver. Ka MG 1/100 Model Kit - Bandai', 'nar')] });
  assert.equal((await az(twice).find('Narrative Gundam C-Packs', 'MG')).uncertain, undefined); // grade écrit deux fois : compté une fois
  assert.deepEqual(await refusal(az(web({ aztoyhobby: () => [item('Bandai Zeta Gundam PG 1/60 Model Kit', 'pg')] })), 'Zeta Gundam', 'MG'), [REASONS.noCandidate]);
});

const LUPUS = [item('Bandai HG Gundam Barbatos Lupus 1/144 Model Kit', 'hg-barbatos-lupus')];
const BARBATOS = [item('Bandai HG Gundam Barbatos 1/144 Model Kit', 'hg-barbatos')];

test('kit sans grade : une seule requête par boutique pour A-Z et Las Cale', async () => {
  const fetch = web();
  await az(fetch).find('Wing Gundam Zero', null);
  await las(fetch).find('Wing Gundam Zero', 'inconnu');
  assert.equal(fetch.queries.aztoyhobby.filter((q) => q === 'Wing Gundam Zero').length, 1);
  assert.equal(fetch.queries.lascalemodel.filter((q) => q === 'Wing Gundam Zero').length, 1);
});

test('forme 1 douteuse (Lupus), forme 2 exacte : résultat sûr, 2 requêtes de base', async () => {
  const fetch = web({ aztoyhobby: (q) => (q === 'HG Gundam Barbatos' ? BARBATOS : LUPUS) });
  const hit = await az(fetch).find('Gundam Barbatos', 'HG');
  assert.equal(hit.pageUrl, 'https://www.aztoyhobby.com/products/hg-barbatos');
  assert.ok(!hit.uncertain);
  assert.equal(fetch.queries.aztoyhobby.length, 2);
});

test('forme 1 douteuse et forme 2 sans fiche acceptée : la fiche douteuse est retournée', async () => {
  const fetch = web({ aztoyhobby: (q) => (q === 'Gundam Barbatos' ? LUPUS : BANSHEE) });
  const hit = await az(fetch).find('Gundam Barbatos', 'HG');
  assert.equal(hit.pageUrl, 'https://www.aztoyhobby.com/products/hg-barbatos-lupus');
  assert.equal(hit.uncertain, true);
  assert.equal(fetch.queries.aztoyhobby.length, 2);
});

test('hit sûr en forme 1 : pas de forme 2 ; sources existantes : 1 requête de base', async () => {
  const fetch = web({ aztoyhobby: () => BARBATOS, gundamplanet: () => BARBATOS });
  assert.ok((await az(fetch).find('Gundam Barbatos', 'HG')).pageUrl);
  assert.equal(fetch.queries.aztoyhobby.length, 1);
  await chain(fetch)[1].find('Gundam Barbatos', 'HG');
  assert.equal(fetch.queries.gundamplanet.length, 1);
});

// Japan Figure (japan-figure.com) : titres « Bandai Gundam Barbatos HG 1/144 Gunpla Model Kit », relevés sur la boutique réelle ; web simulé.
test('Japan Figure : titre de revendeur (fournisseur, « Model Kit ») ramené au grade en tête, mauvais grade refusé', async () => {
  const jf = (products) => shopifyProvider({ name: 'japanfigure', host: 'japan-figure.com', fetch: async () => Response.json({ resources: { results: { products } } }), minIntervalMs: 0, tidy: true });
  const hit = await jf([item('Bandai Gundam Barbatos Hg 1/144 Gunpla Model Kit', 'bandai-gundam-barbatos-hg-1-144-gunpla-model-kit-bandai')]).find('Gundam Barbatos', 'HG');
  assert.equal(hit.pageUrl, 'https://www.japan-figure.com/products/bandai-gundam-barbatos-hg-1-144-gunpla-model-kit-bandai');
  assert.equal(hit.uncertain, undefined);
  assert.deepEqual(await refusal(jf([item('Bandai Gundam Barbatos Pg 1/60 Gunpla Model Kit', 'pg')]), 'Gundam Barbatos', 'HG'), [REASONS.noCandidate]);
});
