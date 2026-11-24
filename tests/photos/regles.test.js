import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { hljProvider, pageWords, titleMatches } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';
import { RULES_VERSION, fetchPhotoForKit } from '../../src/photos/fetch.js';
import { getPhoto } from '../../src/photos/store.js';

// R1 "Entry Grade" = EG, R2 code à tiret scindé quand toutes ses parties sont des mots du kit, R3 mot du kit = début d'un code de page.
// Lignes kits réelles (cleanTitle) et titres de boutique relevés par le sondage des kits sans photo ; web simulé.
const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
const hljPage = (title, slug) =>
  `<div><div class="search-widget-block"><a href="/${slug}"><img src="/productthumbs/ban/${slug}_0_1.jpg"></a><p class="product-item-name"><a href="/${slug}">${title}</a></p></div></div>`;
const shop = (title) => ({ title, url: '/products/gp-x', image: `${CDN}gp-x.jpg` });
const web = ({ hlj, gp }) => async (url) => {
  const u = new URL(url);
  if (u.hostname === 'www.hlj.com' && u.pathname === '/search/') return new Response(hlj ? hljPage(hlj, 'x-ban1') : '<div></div>', { status: 200 });
  if (u.hostname === 'www.gundamplanet.com') return Response.json({ resources: { results: { products: gp ? [shop(gp)] : [] } } });
  return new Response(PNG, { status: 200 });
};
const providers = (fetch) => [
  hljProvider({ fetch, minIntervalMs: 0 }),
  shopifyProvider({ name: 'gundamplanet', host: 'gundamplanet.com', fetch, minIntervalMs: 0, retryMs: 1 }),
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
let n = 0;
const job = (t, id, fetch) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: providers(fetch), fetch });
// Verdict of one source on one kit: 'sure' | 'doubt' (à vérifier) | null.
async function verdict(t, raw, source, title) {
  const id = addRealKit(t.db, ++n, raw);
  const r = await job(t, id, web({ [source]: title }));
  return r.found ? (getPhoto(t.db, id).uncertain ? 'doubt' : 'sure') : null;
}

// [kit brut, titre de la fiche, verdict]
const CASES = [
  // R1 : "Entry Grade" en tête (sondage : kits 75, 65, 15, 74) ; "EG" écrit tel quel marchait déjà
  ['EG 1/144 NU', 'Entry Grade Nu Gundam', 'sure'],
  ['EG 1/144 RX-78-2', 'Entry Grade RX-78-2 Gundam', 'sure'],
  ['EG 1/144 RX-78F00/E', 'Entry Grade RX-78F00/E Gundam', 'sure'],
  ['EG 1/144 STRIKE', 'Entry Grade Strike Gundam (Ecopla)', 'doubt'],
  ['EG 1/144 NU', 'EG Nu Gundam', 'sure'],
  ['HG 1/144 NU', 'Entry Grade Nu Gundam', null], // grade explicite différent
  ['EG 1/144 NU', 'HG Nu Gundam', null],
  // R2 : tiret scindé, titleMatches compris (kits 37 et 70)
  ['HG 1/144 BEGUIR BEU', 'HG Beguir-Beu', 'sure'],
  ['HG 1/144 BEGUIR BEU', 'HG Gundam Beguir-Beu', 'sure'],
  ['RG 1/144 GUNDAM GAT X105 STRIKE', 'RG GAT-X105 Strike Gundam', 'sure'],
  ['RG 1/144 GUNDAM GAT X105 STRIKE', 'RG GAT-X105 Aile Strike Gundam', 'doubt'], // "Aile" en trop
  ['HG 1/144 BEGUIR BEU', 'MG Beguir-Beu', null],
  // R3 : début de code (kit 39), toujours à vérifier
  ['RG 1/144 JUSTICE ZGMF', 'RG ZGMF-X09A Justice Gundam', 'doubt'],
  ['HG 1/144 JUSTICE ZGM', 'HG ZGMF-X09A Justice Gundam', null], // 3 lettres : pas un début de code
  ['RG 1/144 JUSTICE ZGMF', 'HG ZGMF-X09A Justice Gundam', null],
  // paires fausses historiques : refusées, règles actives
  ['HG 1/144 V GUNDAM', 'HG 1.5 Gundam', null],
  ['HG 1/144 INGRESSA MILITA', 'HGUC MSN-04 II Nightingale', null],
  ['HG 1/144 ZAKU I', 'HGUC MS-05 Zaku II', null],
  ['HG 1/144 ZAKU II', 'HGUC MS-05B Zaku I', null],
  ['HG 1/144 RX-178 GUNDAM MK-II', 'HGUC RX-178 Gundam Mk-III', null],
  ['HG 1/144 NU GUNDAM', 'HGUC Hi-Nu Gundam', null],
  ['EG 1/144 NU', 'Entry Grade Hi-Nu Gundam', null],
];

test('règles R1/R2/R3 : cas réels du sondage, boutique et HLJ, paires fausses refusées', async () => {
  await withDb(async (t) => {
    for (const source of ['gp', 'hlj']) {
      for (const [raw, title, want] of CASES) {
        assert.equal(await verdict(t, raw, source, source === 'hlj' ? `1/144 ${title}` : title), want, `${source}: ${raw} <- ${title}`);
      }
    }
  });
});

test('pageWords et titleMatches : Entry Grade = 2 mots consommés, EG = 1 ; tiret scindé seulement si le kit a toutes les parties', () => {
  assert.deepEqual(pageWords(['entry', 'grade', 'nu', 'gundam']), { g: 'eg', rest: ['nu', 'gundam'] });
  assert.deepEqual(pageWords(['eg', 'nu', 'gundam']), { g: 'eg', rest: ['nu', 'gundam'] });
  assert.deepEqual(pageWords(['entry', 'nu']), { g: null, rest: ['entry', 'nu'] });
  assert.equal(titleMatches('Beguir Beu', 'HG Beguir-Beu'), true);
  assert.equal(titleMatches('Nu', 'HG Hi-Nu Gundam'), false);
});

test('RULES_VERSION : un refus mémorisé avec l\'ancienne version est redemandé et débloqué (Nu EG), pas celui de la version courante', async () => {
  assert.ok(RULES_VERSION >= 2);
  await withDb(async (t) => {
    const fetch = web({ gp: 'Entry Grade Nu Gundam' });
    const id = addRealKit(t.db, ++n, 'EG 1/144 NU');
    const refuse = (v) => t.db.prepare("INSERT OR REPLACE INTO photo_refusals (kit_id, provider, reason, rules_version, title_key, refused_at) VALUES (?, 'gundamplanet', 'x', ?, 'Nu|EG', ?)").run(id, v, new Date().toISOString());
    refuse(RULES_VERSION);
    assert.deepEqual(await job(t, id, fetch), { found: false }); // mémorisé : pas redemandé
    refuse(1);
    assert.deepEqual(await job(t, id, fetch), { found: true }); // règles de la version 1 : redemandé
  });
});
