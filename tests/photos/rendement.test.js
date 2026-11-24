// Vers 80 % de kits avec photo : titres normalisés (R1), nom nettoyé (R2), code absent toléré (R3), sûre remplace à vérifier (P1),
// échelle (P2). Kits réels (cleanTitle) et réponses réelles des boutiques (tests/fixtures/photos-reponses.json, relevées sur les
// 77 kits sans photo interrogés) rejouées sans réseau : la boutique répond la même chose quelle que soit la requête.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG, addKit, addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import photoRoutes from '../../src/photos/routes.js';
import { GRADE, REASONS, gradeOf, hljProvider, kitWords, scaleOf } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';
import { RULES_VERSION, fetchPhotoForKit, fetchPhotos, providersToTry, searchName } from '../../src/photos/fetch.js';
import { getPhoto, savePhoto } from '../../src/photos/store.js';

const REAL = JSON.parse(readFileSync(new URL('../fixtures/photos-reponses.json', import.meta.url), 'utf8'));
const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
const SHOPS = { 'www.gundamplanet.com': 'gp', 'www.aztoyhobby.com': 'az', 'www.lascalemodel.com': 'lc' };
const SOURCE = { 'gundamplanet.com': 'gp', 'aztoyhobby.com': 'az', 'lascalemodel.com': 'lc' };
const productsOf = (list) => list.map(([title, slug]) => ({ title, url: `/products/${slug}`, image: `${CDN}${slug}.jpg` }));
const shopAnswer = (products) => Response.json({ resources: { results: { products } } });

// Les cinq sources dans l'ordre de routes.js ; HLJ et USA Gundam Store ne trouvent rien.
function sources(fetch) {
  return [
    hljProvider({ fetch, minIntervalMs: 0 }),
    shopifyProvider({ name: 'gundamplanet', host: 'gundamplanet.com', fetch, minIntervalMs: 0, retryMs: 1 }),
    shopifyProvider({ name: 'usagundamstore', host: 'usagundamstore.com', fetch, minIntervalMs: 0, retryMs: 1 }),
    shopifyProvider({ name: 'aztoyhobby', host: 'aztoyhobby.com', fetch, minIntervalMs: 0, forms: [false, true], tidy: true }),
    shopifyProvider({ name: 'lascalemodel', host: 'lascalemodel.com', fetch, minIntervalMs: 0, forms: [true, false], tidy: true }),
  ];
}
const web = ({ gp = [], az = [], lc = [], calls = [] } = {}) => {
  const f = async (url) => {
    const u = new URL(url);
    calls.push(u.hostname);
    if (u.hostname === 'www.hlj.com') return new Response('<div></div>', { status: 200 });
    if (u.hostname === 'www.usagundamstore.com') return shopAnswer([]);
    if (SHOPS[u.hostname]) return shopAnswer(productsOf({ gp, az, lc }[SHOPS[u.hostname]]));
    return new Response(PNG, { status: 200 });
  };
  f.calls = calls;
  return f;
};

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
// Où la photo du kit est allée : null (rien), ou 'gp:sure' / 'az:doubt'...
const where = (t, id) => {
  const p = getPhoto(t.db, id);
  return p ? `${SOURCE[new URL(p.source_url).hostname.replace(/^www\./, '')]}:${p.uncertain ? 'doubt' : 'sure'}` : null;
};
let n = 0;
// Kit réel (titre brut) devant une seule fiche GP : 'sure' | 'doubt' | null.
async function verdict(t, raw, page) {
  const id = addRealKit(t.db, ++n, raw);
  const fetch = web({ gp: [[page, 'p-1']] });
  await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: sources(fetch), fetch });
  return where(t, id)?.split(':')[1] ?? null;
}

// --- Les kits réels débloqués : [source de la photo, sûre ou à vérifier] -----------------------------------------------------------
const R1 = { // titres normalisés : apostrophe, OO/00, Version/Ver., G-3/G3, Ver. coupé, "/", mots collés, Endless Waltz, tiret
  12: 'az:sure', 63: 'az:sure', 73: 'gp:sure', 94: 'az:sure', 133: 'gp:sure', 142: 'az:sure', 152: 'lc:doubt', 187: 'gp:sure', 201: 'gp:sure',
  261: 'az:doubt', 320: 'gp:sure', 321: 'az:sure', 322: 'gp:sure', 364: 'gp:doubt', 380: 'lc:sure', 395: 'gp:sure', 404: 'gp:sure', 547: 'gp:doubt',
};
const R2 = { 67: 'gp:sure', 84: 'lc:sure', 87: 'lc:sure', 120: 'gp:doubt', 125: 'az:doubt', 161: 'gp:sure', 162: 'gp:sure', 275: 'gp:doubt' }; // nom nettoyé, grade déduit, HGBC ; 125 : la fiche HG « 00 Qan[T] », pas « Command Qan[T] »
const R3 = { 70: 'az:doubt', 280: 'gp:doubt', 389: 'gp:doubt', 553: 'gp:doubt' }; // code absent de la fiche : jamais sûr
const P1 = { 359: 'az:sure' }; // Gundam Planet « BB Senshi » douteux d'abord, A-Z sûr ensuite
const P2 = { 56: 'gp:sure', 259: 'gp:doubt' }; // fiche en 1/100 écartée : l'égalité (56) ou la mauvaise fiche (259) disparaît
const REFUSED = [153, 95, 383, 318, 316]; // « Gundam - X » ambigu, Ka/Kai, Seed/Red Frame Revise, Seed Aegis, variante Screen Image

async function real(t, id) {
  const e = REAL[id];
  const kit = addRealKit(t.db, id, e.raw);
  const fetch = web(e);
  await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: kit, providers: sources(fetch), fetch });
  return where(t, kit);
}
for (const [rule, kits] of Object.entries({ R1, R2, R3, P1, P2 })) {
  test(`${rule} : kits réels débloqués avec les réponses réelles des boutiques (${Object.keys(kits).length})`, async () => {
    await withDb(async (t) => {
      for (const [id, want] of Object.entries(kits)) assert.equal(await real(t, id), want, `kit ${id} ${REAL[id].raw}`);
    });
  });
}

test('kits réels refusés malgré les fiches proches : « Gundam - X » ambigu, Ka/Kai, Seed/Revise, Seed Aegis, variante Screen Image', async () => {
  await withDb(async (t) => {
    for (const id of REFUSED) assert.equal(await real(t, id), null, `kit ${id} ${REAL[id].raw}`);
  });
});

test('bilan : 33 kits sur 38 de la liste, 21 sûrs et 12 à vérifier ; R3 jamais sûr', async () => {
  await withDb(async (t) => {
    const got = [];
    for (const id of Object.keys(REAL)) got.push([id, await real(t, id)]);
    const found = got.filter(([, w]) => w);
    assert.equal(found.length, 33);
    assert.equal(found.filter(([, w]) => w.endsWith(':sure')).length, 21);
    for (const id of Object.keys(R3)) assert.equal(got.find(([i]) => i === id)[1].split(':')[1], 'doubt', `R3 kit ${id}`);
  });
});

// --- R1 : chaque égalité de titre, un cas réel chacune, et ce qui doit rester différent ---------------------------------------------
test('R1 : apostrophe, OO/00, Version/Ver., G-3/G3, Ver. coupé, "/", mots collés, Endless Waltz, tiret du kit', async () => {
  await withDb(async (t) => {
    const CASES = [
      ['1/144 HGGQ (14) CHALLIA S RICK DOM GQ', "HGGQX 14 Challia's Rick Dom (GQ)", 'sure'], // « Challia S » = « Challia's »
      ['1/144 HG CHAR ZAKU', "HG Char's Zaku", null], // « Char » n'est pas « Char's »
      ['GUNDAM GUNPLA PG 1/60 OO GUNDAM SEVEN SWORD/G', 'PG GN-0000/7S 00 Gundam Seven Sword/G', 'sure'],
      ['GUNDAM GUNPLA MG 1/100 RX-78-3 G3 GUNDAM VERSION 2.0', 'MG RX-78-3 G-3 Gundam Ver. 2.0', 'sure'],
      ['1/144 HGUC () DOVEN WOLF UNICORN VE', 'HGUC Doven Wolf Unicorn Ver.', 'sure'],
      ['1/144 HG V GUNDAM', 'HG 1.5 Gundam', null], // le « V » d'un nom de deux mots reste exigé
      ['1/144 HG CHERUDIM GUNDAM GNHW R', 'HG00 Cherudim Gundam GNHW/R', 'sure'],
      ['1/144 HGUC MSZ-008 Z II', 'HGUC MSZ-008 ZII', 'sure'],
      ['1/144 HGUC ZAKU I', 'HGUC MS-05 Zaku II', null], // « Zaku I » n'est pas « Zaku II »
      ['GUNDAM GUNPLA MG 1/100 SHENLONG GUNDAM ENDLESS WALTZ VERSION', 'MG XXXG-01S Shenlong Gundam EW Ver.', 'sure'],
      ['GUNDAM GUNPLA PG 1/60 OO-RAISER', 'PG GNR-010 00 Gundam 00 Raiser', 'sure'], // tiret du kit : toutes ses parties sont dans la fiche
      ['1/144 HG NU GUNDAM', 'HGUC Hi-Nu Gundam', null], // tiret de la fiche : « Nu » n'est pas « Hi-Nu »
      ['1/144 HG HI-NU GUNDAM', 'HGUC Nu Gundam', null], // tiret du kit : « Hi » manque à la fiche
    ];
    for (const [raw, page, want] of CASES) assert.equal(await verdict(t, raw, page), want, `${raw} <- ${page}`);
  });
});

// --- R2 : nom envoyé et comparé, grade déduit du titre, familles HGBC / HG00 / RE/100 ------------------------------------------------
test('R2 searchName : retire High/Real Grade, Maquette, Scale, 1:144, série en préfixe, code BANMK, mojibake ; recolle « Msk 008 »', () => {
  const T = [
    ['Gundam: The Witch From Mercury - High Grade - Gundam Pharact 1:144 Scale Model Kit', 'Gundam - Gundam Pharact'],
    ['Gundam: High Grade - Gundam Barbatos Lupus Rex 1:144 Scale Model Kit', 'Gundam - Gundam Barbatos Lupus Rex'],
    ['Gundam Real Grade Maquette GN-0000 GNR-010 OO Raiser', 'Gundam GN-0000 GNR-010 OO Raiser'],
    ['BANMK65111GUNDAM Witch From Mercury 20 Zowort Heavy', 'Zowort Heavy'],
    ['Witch From Mercury 014 Zowort', 'Zowort'],
    ['Msk 008 Dijeh', 'Msk-008 Dijeh'],
    ['Throne Eins Gnw 001', 'Throne Eins Gnw-001'],
    ['á áOO Gundam Seven Sword/G', 'OO Gundam Seven Sword/G'],
    ['Gundam Maquette OO Qan(T)', 'Gundam OO Qan(T)'],
    // inchangés : hors périmètre ou ambigu, un grade collé à des chiffres n'est pas un code coupé
    ['Witch From Mercury New Item A', 'Witch From Mercury New Item A'],
    ['Gundam - MSM-07S Z\'Gok', 'Gundam - MSM-07S Z\'Gok'],
    ['MS Option Set 9', 'MS Option Set 9'],
    ['Decal (104) Iron-Blooded Orphans Multiuse', 'Decal Iron-Blooded Orphans Multiuse'],
    ['Strike Freedom MG 100', 'Strike Freedom 100'], // le grade collé aux chiffres n'est pas un code coupé (« MG-100 »)
  ];
  for (const [title, want] of T) assert.equal(searchName(title), want, title);
});

test('R2 : grade lu dans le titre quand le kit n\'en a pas (requête et comparaison seulement, kits.grade intact)', async () => {
  await withDb(async (t) => {
    const queries = [];
    const fetch = async (url) => {
      const u = new URL(url);
      if (u.hostname === 'www.gundamplanet.com') return queries.push(u.searchParams.get('q')), shopAnswer(productsOf([['HG Gundam Pharact', 'hg-pharact']]));
      return new Response(u.hostname === 'www.hlj.com' ? '<div></div>' : PNG, { status: 200 });
    };
    const hg = addRealKit(t.db, 1, 'GUNDAM: THE WITCH FROM MERCURY - HIGH GRADE - GUNDAM PHARACT 1:144 SCALE MODEL KIT');
    const rg = addRealKit(t.db, 2, 'GUNDAM REAL GRADE MAQUETTE GN-0000 GNR-010 OO RAISER');
    assert.equal(t.db.prepare('SELECT grade FROM kits WHERE id = ?').get(hg).grade, null);
    await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: hg, providers: sources(fetch), fetch });
    assert.deepEqual(queries, ['HG Gundam - Gundam Pharact']);
    assert.equal(where(t, hg), 'gp:sure');
    // « Real Grade » = RG : une fiche HG du même nom est un autre kit
    assert.equal(await verdict(t, 'GUNDAM REAL GRADE MAQUETTE GN-0000 GNR-010 OO RAISER', 'HG GN-0000 GNR-010 00 Raiser'), null);
    assert.equal(await verdict(t, 'GUNDAM REAL GRADE MAQUETTE GN-0000 GNR-010 OO RAISER', 'RG GN-0000 GNR-010 00 Raiser'), 'doubt'); // « Gundam » manque à la fiche
    assert.equal(await verdict(t, 'GUNDAM REAL GRADE MAQUETTE GN-0000 GNR-010 OO RAISER', 'RG Gundam GN-0000 GNR-010 00 Raiser'), 'sure');
    assert.equal(t.db.prepare('SELECT grade FROM kits WHERE id = ?').get(rg).grade, null);
    assert.equal(t.db.prepare('SELECT title FROM kits WHERE id = ?').get(hg).title, 'Gundam: The Witch From Mercury - High Grade - Gundam Pharact 1:144 Scale Model Kit');
  });
});

test('R2 : HGBC, HG00, HGGQX = famille HG, RE/100 = RE ; les autres grades et les mots proches restent comme avant', async () => {
  for (const [s, want] of [['HGUC', 'hg'], ['HGBC', 'hg'], ['HG00', 'hg'], ['HGGQX', 'hg'], ['HG', 'hg'], ['RE/100', 're'], ['RE', 're'], ['RG', 'rg'], ['MG', 'mg'], ['PG', 'pg'], ['SD', 'sd'], ['EG', 'eg'], ['FM', 'fm'], ['Re-GZ', null], ['Hello', null], ['', null]]) {
    assert.equal(gradeOf(s), want, s);
  }
  assert.equal(GRADE.test('hgbc'), true);
  assert.equal(GRADE.test('re-gz'), false); // « Re-GZ » n'est pas un grade
  await withDb(async (t) => {
    assert.equal(await verdict(t, '1/144 HGBC (027) THE NORTHERN POD (SUPPORT UNIT)', 'HGBC Northern Pod'), 'doubt'); // « The » manque
    assert.equal(await verdict(t, '1/144 HGBC (027) THE NORTHERN POD (SUPPORT UNIT)', 'MG Northern Pod'), null);
    assert.equal(await verdict(t, '1/144 HG (014) CHERUDIM GUNDAM', 'HG00 Cherudim Gundam'), 'sure');
    assert.equal(await verdict(t, '1/100 RE/100 (009) VIGNA-GHINA', 'RE/100 009 Vigna-Ghina 1/100'), 'sure');
    assert.equal(await verdict(t, '1/100 RE/100 (009) VIGNA-GHINA', 'HG Vigna-Ghina'), null);
    assert.equal(await verdict(t, '1/144 HG VIGNA-GHINA', 'RE/100 Vigna-Ghina'), null);
  });
});

// --- R3 : code absent de la fiche, toujours « à vérifier » ---------------------------------------------------------------------------
test('R3 : le code du kit manque à la fiche -> à vérifier, jamais sûr ; sans grade concordant ou avec un seul autre mot -> refusé', async () => {
  await withDb(async (t) => {
    const raw = '1/100 MG GUNDAM HI-NU RX-73 VER.KA';
    assert.equal(await verdict(t, raw, 'MG RX-93-2 Hi-Nu Gundam Ver.Ka'), 'doubt'); // kit 389 : RX-73 pour RX-93-2
    assert.equal(await verdict(t, raw, 'MG Hi-Nu Gundam Ver.Ka'), 'doubt'); // pas de code du tout sur la fiche
    assert.equal(await verdict(t, raw, 'Hi-Nu Gundam Ver.Ka'), null); // fiche sans grade : le code manquant n'est pas pardonné
    assert.equal(await verdict(t, raw, 'HG Hi-Nu Gundam Ver.Ka'), null); // autre grade
    assert.equal(await verdict(t, '1/100 MG RX-73 EXIA', 'MG Gundam Exia'), null); // un seul mot sans chiffre : trop peu pour pardonner le code
    assert.equal(await verdict(t, '1/100 MG GUNDAM HI-NU RX-93-2 VER.KA', 'MG RX-93-2 Hi-Nu Gundam Ver.Ka'), 'sure'); // code présent : sûre comme avant
    assert.equal(await verdict(t, '1/100 MG HI-NU RX-73 VER.KA', 'MG RX-93-2 Hi-Nu Gundam Ver.Ka'), null); // il faut 3 autres mots que le code : « MS-06S Zaku II » n'est pas « MS-06F Zaku II »
  });
});

// --- P2 : l'échelle du kit contre celle de la fiche -----------------------------------------------------------------------------------
test('P2 : une fiche d\'une autre échelle est refusée ; échelle absente d\'un côté ou 1:144 = 1/144 : pas de rejet', async () => {
  assert.deepEqual(['1/144', '1:100', 'HG 1/60 X', 'no'].map(scaleOf), ['144', '100', '60', undefined]);
  await withDb(async (t) => {
    const kit = '1/144 HGIBO (003) SCHWALBE GRAZE';
    assert.equal(await verdict(t, kit, 'HG 1/144 Schwalbe Graze'), 'sure');
    assert.equal(await verdict(t, kit, 'HG 1:144 Schwalbe Graze'), 'sure');
    assert.equal(await verdict(t, kit, 'HG Schwalbe Graze'), 'sure'); // fiche sans échelle
    assert.equal(await verdict(t, kit, 'HG 1/100 Schwalbe Graze'), null);
    assert.equal(await verdict(t, kit, 'HG 1/60 Schwalbe Graze'), null);
    assert.equal(await verdict(t, 'HG SCHWALBE GRAZE', 'HG 1/100 Schwalbe Graze'), 'sure'); // kit sans échelle (kits.scale vide)
    // échelle écrite dans le titre du kit ("1:144", kits.scale vide) : elle compte aussi
    const noScale = 'GUNDAM: HIGH GRADE - GUNDAM PHARACT 1:144 SCALE MODEL KIT';
    assert.equal(await verdict(t, noScale, 'HG 1/100 Gundam Pharact'), null);
    assert.equal(await verdict(t, noScale, 'HG 1/144 Gundam Pharact'), 'sure');
    // une fiche à l'échelle différente ne devient pas « à vérifier » non plus (variante avec mot en trop comprise)
    assert.equal(await verdict(t, kit, 'HG 1/100 Schwalbe Graze McGillis Custom'), null);
  });
});

test('P2 HLJ : même règle sur les fiches HLJ', async () => {
  await withDb(async (t) => {
    const hljPage = (title) => `<div><div class="search-widget-block"><a href="/x-ban1"><img src="/productthumbs/ban/x-ban1_0_1.jpg"></a><p class="product-item-name"><a href="/x-ban1">${title}</a></p></div></div>`;
    for (const [title, want] of [['1/144 HG Gundam Aerial', 'hlj-box'], ['1/100 HG Gundam Aerial', null], ['HG Gundam Aerial', 'hlj-box']]) {
      const fetch = async (url) => (new URL(url).pathname === '/search/' ? new Response(hljPage(title), { status: 200 }) : new Response(PNG, { status: 200 }));
      const id = addRealKit(t.db, ++n, '1/144 HG GUNDAM AERIAL');
      await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: [hljProvider({ fetch, minIntervalMs: 0 })], fetch });
      assert.equal(getPhoto(t.db, id) ? 'hlj-box' : null, want, title);
    }
  });
});

// --- Garde-fous : les 6 paires fausses historiques et les 16 paires ajoutées par l'analyse ----------------------------------------------
test('les 22 paires fausses restent refusées avec toutes les règles (boutique brute et revendeur) ; les variantes avec mot en plus restent « à vérifier »', async () => {
  const PAIRS = [
    ['V Gundam', 'HG', ['HGUC 1.5 Gundam']],
    ['V Gundam', 'HG', ['HG V2 Gundam']],
    ['Ingressa Milita Mobile Suit', 'HG', ['HGUC MSN-04 II Nightingale']],
    ['Zaku I', 'HG', ['HGUC MS-05 Zaku II']],
    ['Zaku II', 'HG', ['HGUC MS-05B Zaku I']],
    ['RX-178 Gundam Mk-II', 'HG', ['HGUC RX-178 Gundam Mk-III']],
    ['Gundam Mk-II', 'MG', ['MG RX-178 Gundam Mk-III']],
    ['Nu Gundam', 'HG', ['HGUC Hi-Nu Gundam']],
    ['Nu', 'EG', ['HG Hi-Nu Gundam', 'Entry Grade RX-78-2 Gundam']],
    ['Hi-Nu Gundam', 'HG', ['HGUC Nu Gundam']],
    ['Gundam Mk-II', 'MG', ['HGUC Gundam Mk-II']],
    ['Strike', 'EG', ['HG Strike Gundam', 'Entry Grade RX-78-2 Gundam']],
    ['RX-78-2', 'EG', ['MG RX-78-2 Gundam Ver 3.0', 'RG RX-78-2 Gundam']],
    ['Unicorn Gundam Screen Image Special', 'MG', ['MG RX-0 Unicorn Gundam']],
    ['Zaku II Char Custom', 'HG', ['HGUC MS-06S Zaku II']],
    ['Doven Wolf', 'HG', ['HGUC Doven Wolf (Unicorn Ver.)']],
    ['Gundam Barbatos', 'HG', ['HG IBO Gundam Barbatos Lupus Rex']],
    ['Rick Dom', 'HG', ['HGUC Rick Dom II']],
    ['Zeta Gundam', 'HG', ['HGUC ZZ Gundam']],
    ['00 Raiser', 'HG', ['HG00 00 Raiser Sword']],
    ['Age 1 Normal', 'HG', ['HG Gundam AGE-1 Titus']],
    ['Gelgoog', 'HG', ['HGUC Gelgoog Marine']],
  ];
  const VARIANTS = new Set(['Doven Wolf', 'Gundam Barbatos', 'Rick Dom', '00 Raiser', 'Gelgoog']); // mots en plus seulement : à vérifier, comme avant
  for (const [name, grade, titles] of PAIRS) {
    for (const tidy of [false, true]) {
      const fetch = async () => shopAnswer(productsOf(titles.map((t, i) => [t, `p${i}`])));
      const hit = await shopifyProvider({ name: 'x', host: 'x.com', fetch, minIntervalMs: 0, tidy }).find(name, grade, () => {}, '144');
      const label = `${tidy ? 'revendeur ' : ''}${name} [${grade}] <- ${titles.join(' | ')}`;
      if (VARIANTS.has(name)) assert.equal(hit?.uncertain, true, label);
      else assert.equal(hit, null, label);
    }
  }
});

test('hors périmètre : decals, option sets, armes, « New Item A » restent sans photo avec les nouvelles règles', async () => {
  await withDb(async (t) => {
    for (const [raw, page] of [
      ['DECAL (104) IRON-BLOODED ORPHANS MULTIUSE', 'G-REWORK Decal Iron-Blooded Orphans Multiuse'],
      ['1/144 HGIBO MS OPTION SET 9', 'HG IBO MS Option Set 9'],
      ['Gundam Gunpla Witch From Mercury New Item A', 'HG Witch From Mercury Gundam Aerial'],
      ['30MM (01) ARMORED-CORE VI WEAPON SET 01', '30MM Option Parts Set 1'],
    ]) assert.equal(await verdict(t, raw, page), null, `${raw} <- ${page}`);
  });
});

// --- P1 : une fiche sûre d'une source moins bien classée remplace une photo à vérifier --------------------------------------------------
// Sources factices a > b > c (rang = ordre) ; `answer` : 'sure' | 'doubt' | null.
function ranked(answers) {
  const hit = (name, extra) => ({ imageUrl: `https://${name}.test/i.png`, pageUrl: `https://${name}.test/p`, ...extra });
  return Object.entries(answers).map(([name, answer]) => {
    const p = {
      name,
      host: `${name}.test`,
      calls: 0,
      async find(_kit, _grade, refuse) {
        p.calls++;
        if (answer === 'sure') return hit(name);
        if (answer === 'doubt') return hit(name, { uncertain: true, extra: ['x'] });
        return refuse(REASONS.noCandidate), null;
      },
    };
    return p;
  });
}
const okFetch = async () => new Response(PNG, { status: 200 });
const seed = (t, kitN, source, opts = {}) => {
  const id = addRealKit(t.db, ++n, `HG 1/144 GUNDAM AERIAL ${kitN}`);
  if (source) savePhoto({ db: t.db, dataDir: t.dir, kitId: id, bytes: PNG, kind: 'auto', sourceUrl: `https://${source}.test/old`, ...opts });
  return id;
};
const run = (t, id, providers, extra = {}) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers, fetch: okFetch, ...extra });
const names = (t, id, providers) => providersToTry({ db: t.db, kitId: id, providers }).map((p) => p.name);
const host = (t, id) => new URL(getPhoto(t.db, id).source_url).hostname;

test('P1 : une photo à vérifier est proposée à toutes les sources ; une fiche sûre d\'un rang moins bon la remplace, une douteuse jamais', async () => {
  await withDb(async (t) => {
    const P = (a, b, c) => ranked({ a, b, c });
    // a (rang 0) à vérifier ; b douteuse ne remplace pas ; c sûre remplace
    let id = seed(t, 1, 'a', { uncertain: true });
    let p = P('doubt', 'doubt', 'sure');
    assert.deepEqual(names(t, id, p), ['a', 'b', 'c']);
    assert.deepEqual(await run(t, id, p), { found: true });
    assert.equal(host(t, id), 'c.test');
    assert.equal(getPhoto(t.db, id).uncertain, 0);
    // la première sûre gagne : c n'est pas interrogée
    id = seed(t, 2, 'a', { uncertain: true });
    p = P(null, 'sure', 'sure');
    await run(t, id, p);
    assert.equal(host(t, id), 'b.test');
    assert.equal(p[2].calls, 0);
    // que des douteuses : la photo reste, rien n'est trouvé
    id = seed(t, 3, 'b', { uncertain: true });
    p = P('doubt', 'doubt', 'doubt');
    assert.deepEqual(await run(t, id, p), { found: false });
    assert.equal(getPhoto(t.db, id).source_url, 'https://b.test/old');
    assert.equal(getPhoto(t.db, id).uncertain, 1);
  });
});

test('P1 : photo sûre ou vérifiée = jamais proposée à une source moins bien classée ; upload jamais touché', async () => {
  await withDb(async (t) => {
    const p = ranked({ a: 'sure', b: 'sure', c: 'sure' });
    const sure = seed(t, 1, 'b'); // uncertain = 0 : sûre, ou « Photo vérifiée »
    assert.deepEqual(names(t, sure, p), ['a']); // seulement mieux classées
    const best = seed(t, 2, 'a');
    assert.deepEqual(names(t, best, p), []);
    const upload = seed(t, 3, null);
    savePhoto({ db: t.db, dataDir: t.dir, kitId: upload, bytes: PNG, kind: 'user' });
    assert.deepEqual(names(t, upload, p), []);
    assert.deepEqual(await run(t, upload, p), { found: false });
    assert.equal(getPhoto(t.db, upload).kind, 'user');
    assert.deepEqual(p.map((x) => x.calls), [0, 0, 0]);
    const unknown = seed(t, 4, 'zzz', { uncertain: true }); // source qui n'est plus configurée : jamais remplacée
    assert.deepEqual(names(t, unknown, p), []);
    // la photo sûre de b n'est interrogée qu'auprès de a
    await run(t, sure, p);
    assert.deepEqual(p.map((x) => x.calls), [1, 0, 0]);
    assert.equal(host(t, sure), 'a.test');
  });
});

test('P1 : « Photo vérifiée » (route) ramène la photo à vérifier au rang des sûres : plus proposée aux sources moins bien classées', async () => {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    const id = addKit(app.db, 1, 'HG Gundam Aerial');
    savePhoto({ db: app.db, dataDir: tmp.dir, kitId: id, bytes: PNG, kind: 'auto', sourceUrl: 'https://a.test/old', uncertain: true });
    const p = ranked({ a: null, b: 'sure' });
    assert.deepEqual(names({ db: app.db }, id, p), ['a', 'b']);
    assert.equal((await app.api('POST', `/api/kits/${id}/photo/verified`)).status, 200);
    assert.deepEqual(names({ db: app.db }, id, p), []); // vérifiée depuis la meilleure source : plus réinterrogée
    const second = seed({ db: app.db, dir: tmp.dir }, 9, 'b', { uncertain: true });
    await app.api('POST', `/api/kits/${second}/photo/verified`);
    assert.deepEqual(names({ db: app.db }, second, p), ['a']);
  } finally {
    await app.close();
    tmp.cleanup();
  }
});

test('P1 : kit sans photo, une douteuse d\'abord puis une sûre moins bien classée : la sûre garde la place, dans le même passage (et dans le job)', async () => {
  await withDb(async (t) => {
    let id = seed(t, 1, null);
    let p = ranked({ a: 'doubt', b: null, c: 'sure' });
    assert.deepEqual(await run(t, id, p), { found: true });
    assert.equal(host(t, id), 'c.test');
    assert.equal(getPhoto(t.db, id).uncertain, 0);
    // douteuse seule : gardée, trouvée
    id = seed(t, 2, null);
    p = ranked({ a: 'doubt', b: 'doubt', c: null });
    assert.deepEqual(await run(t, id, p), { found: true });
    assert.deepEqual([host(t, id), getPhoto(t.db, id).uncertain], ['a.test', 1]);
    // le job (une étape par source) fait pareil et compte le kit une fois
    const jobs = [seed(t, 3, null), seed(t, 4, null)];
    p = ranked({ a: 'doubt', b: 'doubt', c: 'sure' });
    const out = [];
    await fetchPhotos({ db: t.db, dataDir: t.dir, todo: jobs.map((kitId) => ({ kitId, wanted: p })), providers: p, fetch: okFetch, onKit: (f) => out.push(f) });
    assert.deepEqual(out, [true, true]);
    assert.deepEqual(jobs.map((id) => [host(t, id), getPhoto(t.db, id).uncertain]), [['c.test', 0], ['c.test', 0]]);
    const none = [seed(t, 5, null)];
    p = ranked({ a: null, b: null, c: null });
    const miss = [];
    await fetchPhotos({ db: t.db, dataDir: t.dir, todo: none.map((kitId) => ({ kitId, wanted: p })), providers: p, fetch: okFetch, onKit: (f) => miss.push(f) });
    assert.deepEqual(miss, [false]);
  });
});

test('P1 : une douteuse écartée parce que le kit a déjà une photo est mémorisée 7 jours (pas de requête en plus), sauf force', async () => {
  await withDb(async (t) => {
    const id = seed(t, 1, 'a', { uncertain: true });
    const p = ranked({ a: null, b: 'doubt' });
    const T0 = Date.UTC(2026, 10, 1);
    await run(t, id, p, { now: () => T0 });
    assert.equal(p[1].calls, 1);
    assert.equal(t.db.prepare('SELECT reason FROM photo_refusals WHERE kit_id = ? AND provider = ?').get(id, 'b').reason, REASONS.kept);
    await run(t, id, p, { now: () => T0 + 1000 });
    assert.equal(p[1].calls, 1); // mémorisé
    await run(t, id, p, { now: () => T0 + 1000, force: true });
    assert.equal(p[1].calls, 2);
    assert.equal(getPhoto(t.db, id).source_url, 'https://a.test/old'); // jamais remplacée par une douteuse
  });
});

test('P1 : le job de rafraîchissement (étapes en parallèle) propose les photos à vérifier à toutes les sources, pas les sûres', async () => {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const jobs = {};
  const log = console.error;
  console.error = console.log = () => {};
  try {
    const t = { db, dir: tmp.dir };
    const doubtful = seed(t, 1, 'a', { uncertain: true });
    const sureOne = seed(t, 2, 'b'); // sûre, ou vérifiée : seule la source a (mieux classée) est redemandée
    const fresh = seed(t, 3, null);
    const p = ranked({ a: null, b: 'sure', c: 'sure' });
    photoRoutes(createRouter(), { db, dataDir: tmp.dir, providers: p, fetch: okFetch, jobs });
    await jobs.photos();
    assert.deepEqual([doubtful, sureOne, fresh].map((id) => host(t, id)), ['b.test', 'b.test', 'b.test']);
    assert.deepEqual([doubtful, sureOne, fresh].map((id) => getPhoto(db, id).uncertain), [0, 0, 0]);
    assert.deepEqual(p.map((x) => x.calls), [3, 2, 0]); // a : les 3 kits ; b : la douteuse et le sans-photo ; c : personne
  } finally {
    console.error = log;
    db.close();
    tmp.cleanup();
  }
});

test('fiches à vérifier : un « Gundam » manquant ne coûte rien (« 00 Qan[T] » avant « Command Qan[T] »), un autre mot manquant coûte', async () => {
  const pick = async (raw, pages) => {
    const fetch = async () => shopAnswer(productsOf(pages.map((title, i) => [title, `p${i}`])));
    const hit = await shopifyProvider({ name: 'x', host: 'x.com', fetch, minIntervalMs: 0 }).find(searchName(raw), 'HG', () => {});
    return [hit.uncertain, hit.pageUrl.split('/').pop()];
  };
  assert.deepEqual(await pick('Gundam OO Qan(T)', ['HG 05 Gundam 00 Command Qan[T] GBB', 'HG 66 00 Qan[T]']), [true, 'p1']);
  assert.deepEqual(await pick('Gundam Aerial Rebuild', ['HG Gundam Aerial Permet Set', 'HG Gundam Aerial Rebuild Set']), [true, 'p1']);
});

// --- RULES_VERSION --------------------------------------------------------------------------------------------------------------------
test('RULES_VERSION 3 : les refus de la version 2 sont redemandés (OO Raiser débloqué), pas ceux de la version 3', async () => {
  assert.equal(RULES_VERSION, 3);
  await withDb(async (t) => {
    const fetch = web({ gp: [['PG GN-0000/GNR-010 00 Gundam 00 Raiser', 'pg-raiser']] });
    const id = addRealKit(t.db, ++n, 'GUNDAM GUNPLA PG 1/60 OO-RAISER');
    const refuse = (v) => t.db.prepare("INSERT OR REPLACE INTO photo_refusals (kit_id, provider, reason, rules_version, title_key, refused_at) VALUES (?, 'gundamplanet', 'x', ?, 'Oo-Raiser|PG', ?)").run(id, v, new Date().toISOString());
    const go = () => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: sources(fetch), fetch });
    refuse(RULES_VERSION);
    assert.deepEqual(await go(), { found: false }); // version courante : pas redemandé
    refuse(2);
    assert.deepEqual(await go(), { found: true }); // version 2 : redemandé, et trouvé avec les règles de la version 3
    assert.equal(where(t, id), 'gp:sure');
  });
});

test('kitWords : « Version » et « Ver. » ne sont pas des mots du kit ; apostrophe collée au mot', () => {
  assert.deepEqual(kitWords('RX-78-3 G3 Gundam Version 2.0'), ['rx-78-3', 'g3', 'gundam']);
  assert.deepEqual(kitWords("Challia S Rick Dom"), ['challias', 'rick', 'dom']);
  assert.deepEqual(kitWords("Challia's Rick Dom"), ['challias', 'rick', 'dom']);
  assert.deepEqual(kitWords('OO Qan[T]'), ['oo', 'qan', 't']);
  assert.deepEqual(kitWords('Shenlong Gundam Endless Waltz Version'), ['shenlong', 'gundam', 'ew']);
});

// --- Réparation du cycle 1 : R3 ne tolère que le code (plus un mot en plus), jetons fusionnés, « V » final jamais sûr ---------------------
test('R3 : un code toléré ne s\'ajoute pas à un mot manquant ; kits distincts MS-06S / MS-06F refusés ; les 5 kits R3 réels restent acceptés', async () => {
  const PAIRS = [ // [kit, grade, fiche] : toutes refusées (l'ancien code les refusait)
    ['V2 Assault Buster', 'HG', 'HG Lightning Buster Gundam'],
    ['GP01FB Full Burnen', 'RG', 'RG Full Armor Unicorn Psycho-Frame'],
    ['RX-0 Unicorn Gundam', 'HG', 'HG Dreissen Unicorn Ver'],
    ['MSM-08 Zogok Unicorn Ver.', 'HG', 'HG Dreissen Unicorn Ver'],
    ['AMX-004-3 Qubeley Mk-II', 'MG', 'MG Musha Gundam Mk-II'],
    ['MS-06S Zaku II', 'PG', 'PG MS-06F Zaku II'], // kit 394
    ['MS-06F Zaku II', 'PG', 'PG MS-06S Zaku II'], // kit 396
    ['MS-06 Zaku II', 'HG', 'HG Gundam Zaku II'],
  ];
  for (const [name, grade, title] of PAIRS) {
    for (const tidy of [false, true]) {
      const fetch = async () => shopAnswer(productsOf([[title, 'p0']]));
      assert.equal(await shopifyProvider({ name: 'x', host: 'x.com', fetch, minIntervalMs: 0, tidy }).find(name, grade, () => {}, '144'), null, `${name} [${grade}] <- ${title}`);
    }
  }
  await withDb(async (t) => {
    for (const id of [389, 56, 280, 70, 553]) {
      const w = await real(t, id);
      assert.ok(w, `kit ${id} ${REAL[id].raw}`);
      if (id !== 56) assert.equal(w.split(':')[1], 'doubt', `R3 kit ${id}`); // 56 : sûr (fiche exacte, échelle)
    }
  });
});

test('jetons fusionnés : « Hi Nu » = « Hi-Nu » (sûr) et « Mk II » = « Mk-II » (à vérifier), « Nu » seul reste refusé', async () => {
  await withDb(async (t) => {
    assert.equal(await verdict(t, '1/144 HG HI NU GUNDAM', 'HG Hi-Nu Gundam'), 'sure');
    assert.equal(await verdict(t, '1/144 HG GUNDAM MK II', 'HG Gundam Mk-II Titans'), 'doubt');
    assert.equal(await verdict(t, '1/144 HG NU GUNDAM', 'HG Hi-Nu Gundam'), null);
  });
});

test('« V » / « Ve » final ignoré : jamais sûr sans « Ver. » sur la fiche (« Unicorn Gundam V » n\'est pas « Unicorn Gundam »)', async () => {
  await withDb(async (t) => {
    assert.equal(await verdict(t, '1/144 HG UNICORN GUNDAM V', 'HG Unicorn Gundam'), 'doubt');
    assert.equal(await verdict(t, '1/144 HG GUNDAM ZETA V', 'HG Zeta Gundam'), 'doubt');
    assert.equal(await verdict(t, '1/144 HGUC () DOVEN WOLF UNICORN VE', 'HGUC Doven Wolf Unicorn Ver.'), 'sure'); // « Ver. » coupé en « Ve »
  });
});
