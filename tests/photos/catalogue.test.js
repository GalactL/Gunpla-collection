import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { REASONS } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';
import { BREAKER, fetchPhotos } from '../../src/photos/fetch.js';
import { getPhoto } from '../../src/photos/store.js';

const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
const prod = (title, handle = title.toLowerCase().replace(/\W+/g, '-'), src = `${CDN}${handle}.jpg?v=1`) => ({
  title, handle, images: src ? [{ src }] : [], vendor: 'Bandai', product_type: 'Model', tags: [],
});

// Simulated shop: products.json pages of 250 and a suggest.json that answers like Shopify (all words in the title, 10 at most).
function shop(products, { calls = [], catalogue = null } = {}) {
  const f = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.pathname === '/products.json') {
      const page = Number(u.searchParams.get('page'));
      if (catalogue) return catalogue(page);
      assert.equal(u.searchParams.get('limit'), '250');
      return Response.json({ products: products.slice((page - 1) * 250, page * 250) });
    }
    if (u.pathname === '/search/suggest.json') {
      const q = u.searchParams.get('q').toLowerCase().split(/\s+/);
      const found = products.filter((p) => q.every((w) => p.title.toLowerCase().includes(w))).slice(0, 10);
      return Response.json({ resources: { results: { products: found.map((p) => ({ title: p.title, url: `/products/${p.handle}?_pos=1`, image: p.images[0]?.src })) } } });
    }
    return new Response(PNG, { status: 200 }); // image download
  };
  f.calls = calls;
  return f;
}
const provider = (fetch, opts = {}) =>
  shopifyProvider({ name: 'aztoyhobby', host: 'aztoyhobby.com', fetch, minIntervalMs: 0, retryMs: 1, forms: [false, true], tidy: true, catalogue: { minKits: 1 }, ...opts });
const outcome = async (p, name, grade, scale) => {
  let reason;
  const hit = await p.find(name, grade, (r) => (reason = r), scale);
  return hit ? { ...hit } : { reason };
};
const quiet = async (fn) => {
  const log = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try {
    return await fn(lines);
  } finally {
    console.error = log;
  }
};

const FIXED = [
  prod('HG 1/144 Gundam Aerial'),
  prod('Bandai HG 1/144 Gundam Aerial Permet Score Six Model Kit'), // extra words: a verifier
  prod('[PREORDER] Bandai MG 1/100 Zaku II Model Kit - Bandai'), // tidy style
  prod('MG 1/100 Zaku II Ver 2.0'),
  prod('RG 1/144 Strike Freedom Gundam', 'sf-1'),
  prod('RG 1/144 Strike Freedom Gundam', 'sf-2'), // same words twice: ambiguous
  prod('HG 1/144 Barbatos Decal'), // accessory: skipped
  prod('MG 1/100 Barbatos'), // another grade
  prod('HG 1/144 Exia', 'exia', 'https://evil.example.com/exia.jpg'), // image outside cdn.shopify.com
  prod('HG 1/144 Dynames', 'dynames', null), // no image
  prod('PG Unicorn Gundam'),
];
const KITS = [
  ['Gundam Aerial', 'HG', '144'], ['Gundam Aerial Permet', 'HG'], ['Zaku II', 'MG', '100'], ['Zaku', 'MG'], ['Strike Freedom', 'RG'],
  ['Barbatos', 'HG'], ['Exia', 'HG'], ['Dynames', 'HG'], ['Unicorn', 'PG'], ['Unicorn Gundam', null], ['Wing Zero', 'HG'], ['Aerial', 'MG', '144'],
];

test('catalogue : mêmes résultats que la recherche par kit (sûr, à vérifier, refus, ambigu, tidy, deux formes)', async () => {
  await quiet(async () => {
    const byKit = provider(shop(FIXED), { catalogue: undefined });
    const cat = provider(shop(FIXED));
    cat.plan(true);
    const all = [];
    for (const [n, g, s] of KITS) {
      const expected = await outcome(byKit, n, g, s);
      all.push(expected);
      assert.deepEqual(await outcome(cat, n, g, s), expected, `${n} ${g}`);
    }
    assert.ok(all.some((r) => r.imageUrl && !r.uncertain), 'au moins un sûr');
    assert.ok(all.some((r) => r.uncertain), 'au moins un à vérifier');
    assert.ok(all.some((r) => r.reason?.startsWith('ambiguous')), 'au moins un ambigu');
    assert.ok(all.filter((r) => r.reason).length >= 4, 'des refus');
  });
});

// 400 kits that all ARRIVE; the first minKits - 1 use the kit search, the others the catalogue (thresholds of routes.js).
// `perKit` = requests of one kit search under the stated hypothesis: 1 when the first form is sure, 2 when it is not (here: a twin page makes it ambiguous, so the second form is asked).
// The ratio is asserted >= 10 only where the hypothesis holds it; aztoyhobby at 1 request per kit is MEASURED, not asserted (6.8x): see routes.js.
test('catalogue : ~400 kits qui arrivent tous, requêtes avec catalogue contre recherche par kit (ratio >= 10 sous l hypothèse nommée, mesuré sinon)', async () => {
  await quiet(async () => {
    const cases = [
      { shop: 'lascalemodel', total: 1424, minKits: 4, perKit: 1, min: 10 },
      { shop: 'gundamplanet', total: 1910, minKits: 5, perKit: 1, min: 10 },
      { shop: 'japanfigure', total: 2427, minKits: 6, perKit: 1, min: 10 },
      { shop: 'aztoyhobby, 2 requêtes par recherche', total: 9936, minKits: 20, perKit: 2, min: 10 },
      { shop: 'aztoyhobby, 1 requête par recherche', total: 9936, minKits: 20, perKit: 1, min: 0, ratio: 400 / 59 },
    ];
    for (const { shop: label, total, minKits, perKit, min, ratio } of cases) {
      const products = Array.from({ length: total }, (_, i) => prod(`HG 1/144 Zeta${i}`));
      if (perKit === 2) for (let i = 399; i >= 0; i--) products.splice(i + 1, 0, prod(`HG 1/144 Zeta${i}`, `twin-${i}`)); // the twin right after its page: also inside the first 10 of the simulated suggest
      const kits = Array.from({ length: 400 }, (_, i) => `Zeta${i}`);
      const byKit = provider(shop(products), { catalogue: undefined });
      const cat = provider(shop(products), { catalogue: { minKits } });
      cat.plan(true);
      for (const k of kits) assert.deepEqual(await outcome(cat, k, 'HG', '144'), await outcome(byKit, k, 'HG', '144'), `${label} ${k}`);
      assert.equal(byKit.metrics.requests, 400 * perKit, label);
      assert.equal(cat.metrics.requests, (minKits - 1) * perKit + Math.ceil(products.length / 250), label);
      const got = byKit.metrics.requests / cat.metrics.requests;
      if (ratio) assert.ok(Math.abs(got - ratio) < 0.01 && got < 10, `${label}: ${got}`);
      else assert.ok(got >= min, `${label}: ${got}`);
    }
  });
});

test('catalogue : avant le minKits-ième kit arrivé, ou hors job, recherche par kit ; ensuite le catalogue, téléchargé une fois', async () => {
  await quiet(async () => {
    const calls = [];
    const p = provider(shop(FIXED, { calls }), { catalogue: { minKits: 3 } });
    p.plan(true);
    for (let i = 0; i < 2; i++) assert.ok((await outcome(p, 'Gundam Aerial', 'HG')).imageUrl);
    assert.ok(calls.length && calls.every((c) => c === '/search/suggest.json'));
    for (let i = 0; i < 3; i++) assert.ok((await outcome(p, 'Gundam Aerial', 'HG')).imageUrl);
    assert.equal(calls.filter((c) => c === '/products.json').length, 1);
    assert.equal(calls.filter((c) => c === '/search/suggest.json').length, 2); // the 3rd kit and the next ones: no more search
    calls.length = 0;
    const alone = provider(shop(FIXED, { calls }), { catalogue: { minKits: 1 } }); // never planned: one kit refreshed alone
    await outcome(alone, 'Gundam Aerial', 'HG');
    assert.ok(calls.length && calls.every((c) => c === '/search/suggest.json'));
  });
});

test('catalogue : des kits en même temps ne le téléchargent qu une fois, une ligne de journal', async () => {
  await quiet(async (lines) => {
    const calls = [];
    const products = Array.from({ length: 600 }, (_, i) => prod(`HG 1/144 Zeta${i}`));
    const p = provider(shop(products, { calls }));
    p.plan(true);
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => outcome(p, `Zeta${i}`, 'HG', '144')));
    assert.ok(r.every((x) => x.imageUrl));
    assert.equal(calls.filter((c) => c === '/products.json').length, 3); // 250 + 250 + 100
    assert.equal(calls.length, 3);
    assert.equal(lines.filter((l) => /catalogue chargé : 600 produits, 3 requêtes, /.test(l)).length, 1);
    p.plan(false); // fin du job : un autre job retélécharge
    p.plan(true);
    await outcome(p, 'Zeta1', 'HG');
    assert.equal(calls.length, 6);
  });
});

test('catalogue : repli sur la recherche par kit (HTTP 500, JSON invalide, vide, page 100 pleine, 400), une seule ligne', async () => {
  const full = (page) => Response.json({ products: Array.from({ length: 250 }, (_, i) => prod(`Filler ${page}-${i}`)) });
  const cases = {
    'HTTP 500': () => new Response('', { status: 500 }),
    'JSON invalide': () => new Response('<html>', { status: 200 }),
    vide: () => Response.json({ products: [] }),
    'HTTP 400': (page) => (page === 1 ? full(1) : new Response('Page * Limit exceeds', { status: 400 })),
    tronqué: full,
  };
  for (const [reason, catalogue] of Object.entries(cases)) {
    await quiet(async (lines) => {
      const calls = [];
      const p = provider(shop(FIXED, { calls, catalogue }));
      p.plan(true);
      for (let i = 0; i < 3; i++) assert.ok((await outcome(p, 'Gundam Aerial', 'HG')).imageUrl, reason);
      const l = lines.filter((x) => /catalogue indisponible/.test(x));
      assert.equal(l.length, 1, reason);
      assert.match(l[0], new RegExp(`^\\[photos\\] aztoyhobby: catalogue indisponible \\(.*${reason}.*\\), repli sur la recherche par kit$`));
      assert.ok(calls.includes('/search/suggest.json'));
    });
  }
});

test('catalogue : image hors cdn.shopify.com refusée, comme par la recherche par kit', async () => {
  await quiet(async () => {
    const p = provider(shop(FIXED));
    p.plan(true);
    assert.equal((await outcome(p, 'Exia', 'HG')).imageUrl, undefined);
    assert.equal((await outcome(p, 'Dynames', 'HG')).imageUrl, undefined);
  });
});

const letters = (n) => String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + (Math.floor(n / 26) % 26)) + String.fromCharCode(97 + Math.floor(n / 676)); // unique name per kit
async function withDb(fn) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  try {
    await quiet((lines) => fn({ db, dir: tmp.dir }, lines));
  } finally {
    db.close();
    tmp.cleanup();
  }
}
const job = (t, ids, providers, f, extra = {}) => fetchPhotos({ db: t.db, dataDir: t.dir, todo: ids.map((kitId) => ({ kitId, wanted: providers })), providers, fetch: f, ...extra });

test('catalogue : fetchPhotos encadre le job, les requêtes de catalogue sont comptées dans les métriques', async () => {
  await withDb(async (t) => {
    const calls = [];
    const p = provider(shop(FIXED, { calls }), { catalogue: { minKits: 2 } });
    const ids = [addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL'), addRealKit(t.db, 2, 'PG UNICORN GUNDAM'), addRealKit(t.db, 3, 'MG 1/100 BARBATOS')];
    const stats = {};
    await job(t, ids, [p], shop(FIXED, { calls }), { stats });
    assert.ok(ids.slice(0, 2).every((id) => getPhoto(t.db, id)));
    assert.equal(calls.filter((c) => c === '/products.json').length, 1);
    assert.equal(stats.aztoyhobby.requests, calls.filter((c) => /json$/.test(c)).length); // suggest + catalogue pages, not the image downloads
    assert.ok(calls.includes('/products.json'));
    // job over: the catalogue is dropped, a kit searched alone uses the kit search
    calls.length = 0;
    await outcome(p, 'Gundam Aerial', 'HG');
    assert.deepEqual(calls, ['/search/suggest.json']);
  });
});

// (i) the typical run: 170 kits skipped (remembered refusal), 1 new kit. Only arrivals count: no catalogue.
test('catalogue : 1 kit neuf et 170 refus mémorisés = aucun catalogue, recherche par kit pour le kit neuf', async () => {
  await withDb(async (t) => {
    const calls = [];
    const f = shop([], { calls });
    const old = Array.from({ length: 170 }, (_, i) => addRealKit(t.db, i, `HG 1/144 ${letters(i)} QQ`));
    await job(t, old, [provider(f, { catalogue: undefined })], f); // first run: the shop has nothing, 170 refusals remembered
    calls.length = 0;
    const fresh = addRealKit(t.db, 999, 'HG 1/144 ZZZ NEW');
    const p = provider(f, { catalogue: { minKits: 5 } });
    const stats = {};
    await job(t, [...old, fresh], [p], f, { stats });
    assert.equal(stats.aztoyhobby.skipped, 170);
    assert.ok(!calls.includes('/products.json'));
    assert.ok(calls.includes('/search/suggest.json')); // the new kit
  });
});

// (ii) enough kits arrive: one download, the following kits use it
test('catalogue : assez de kits qui arrivent = un seul téléchargement, les suivants l utilisent', async () => {
  await withDb(async (t, lines) => {
    const calls = [];
    const products = Array.from({ length: 30 }, (_, i) => prod(`HG 1/144 Zeta${i}`));
    const f = shop(products, { calls });
    const ids = products.map((_, i) => addRealKit(t.db, i, `HG 1/144 ZETA${i}`));
    const p = provider(f, { catalogue: { minKits: 5 } });
    await job(t, ids, [p], f);
    assert.equal(calls.filter((c) => c === '/products.json').length, 1);
    assert.equal(calls.filter((c) => c === '/search/suggest.json').length, 4); // the 4 kits before the 5th (the 5th loads it)
    assert.equal(lines.filter((l) => /catalogue chargé : 30 produits/.test(l)).length, 1);
    assert.ok(ids.every((id) => getPhoto(t.db, id)));
  });
});

// (iii) kits found by a better-ranked source never arrive
test('catalogue : les kits trouvés par une source mieux classée n incrémentent pas le compteur', async () => {
  await withDb(async (t) => {
    const calls = [];
    const f = shop(FIXED, { calls });
    const better = { name: 'better', host: 'better.test', find: async (n) => (/zzz/i.test(n) ? null : { imageUrl: 'https://better.test/x.jpg', pageUrl: 'https://better.test/x' }) };
    const ids = [...Array.from({ length: 6 }, (_, i) => addRealKit(t.db, i, `HG 1/144 ${letters(i)} KK`)), addRealKit(t.db, 50, 'HG 1/144 ZZZ GUNDAM AERIAL')];
    const p = provider(f, { catalogue: { minKits: 3 } });
    await job(t, ids, [better, p], f);
    assert.ok(!calls.includes('/products.json')); // 6 found by `better`, 1 arrived here: under 3
    assert.equal(calls.filter((c) => c === '/search/suggest.json').length >= 1, true);
  });
});

// (v) catalogue unavailable, then the kit search fails in a row: the breaker opens and the source is skipped
test('catalogue : repli puis recherche par kit en erreur de suite = disjoncteur ouvert, source sautée', async () => {
  await withDb(async (t, lines) => {
    const calls = [];
    const f = async (url) => {
      calls.push(new URL(url).pathname);
      return new Response('', { status: 500 });
    };
    const p = provider(f, { catalogue: { minKits: 1 } });
    const ids = Array.from({ length: 8 }, (_, i) => addRealKit(t.db, i, `HG 1/144 ${letters(i)} KK`));
    await job(t, ids, [p], f, { stats: {}, force: true });
    assert.equal(calls.filter((c) => c === '/products.json').length, 1); // tried once, then the kit search
    const searches = calls.filter((c) => c === '/search/suggest.json').length;
    assert.ok(searches >= BREAKER && searches < ids.length, `${searches} searches`); // 2 kits at a time: a kit may start before the 5th error lands
    assert.ok(lines.some((l) => /catalogue indisponible \(HTTP 500\)/.test(l)));
    assert.ok(lines.some((l) => /circuit open after 5 source errors/.test(l)));
  });
});

// Regression of the review: more than 10 candidates and a real kit page decorated by the reseller ("[PREORDER] Bandai ... Model Kit - Bandai").
// A cut by raw title length dropped it and a variant ("Ver Ka") came out sure: a wrong photo. The target comes first, as suggest would rank it.
test('catalogue : plus de 10 candidats, la page du kit décorée n est pas écartée (tidy ou non)', async () => {
  const variants = ['Kai', 'Ground Type', 'Mass Production Type', 'Desert Type', 'Zeon Remnants', 'Ver Ka', 'Revive', 'Origin', 'Black Tri Stars', 'Gaw Attack'];
  const shops = {
    tidy: { opts: { tidy: true }, target: '[PREORDER] Bandai HG 1/144 Zaku II Model Kit - Bandai' },
    'non tidy': { opts: { tidy: false }, target: 'Bandai HG 1/144 Zaku II Model Kit' },
  };
  for (const [label, { opts, target }] of Object.entries(shops)) {
    await quiet(async () => {
      const products = [prod(target, 'target'), ...variants.map((v) => prod(`HG 1/144 Zaku II ${v}`))];
      const byKit = provider(shop(products), { ...opts, catalogue: undefined });
      const cat = provider(shop(products), opts);
      cat.plan(true);
      const expected = await outcome(byKit, 'Zaku II', 'HG', '144');
      const got = await outcome(cat, 'Zaku II', 'HG', '144');
      if (opts.tidy) {
        assert.deepEqual(got, expected);
        assert.match(got.pageUrl, /\/products\/target$/); // the kit itself, sure
      } else assert.deepEqual(got, expected, label); // untidied: whatever the rules do on the kit search (a "Ver Ka" page is already sure there), the catalogue does the same
    });
  }
});

test('catalogue : le dernier mot de la requête peut n être que le début d un mot du titre (comme Shopify)', async () => {
  await quiet(async () => {
    const products = [prod('HG 1/144 Gundam Aerial')];
    const byKit = provider(shop(products), { catalogue: undefined });
    const cat = provider(shop(products));
    cat.plan(true);
    const expected = await outcome(byKit, 'Gundam Aeri', 'HG');
    assert.notEqual(expected.reason, REASONS.noResult); // suggest finds the page, the rules then judge it
    assert.deepEqual(await outcome(cat, 'Gundam Aeri', 'HG'), expected);
    // but only the last word: a prefix in the middle does not match
    assert.deepEqual(await outcome(cat, 'Gund Aerial', 'HG'), await outcome(provider(shop([]), { catalogue: undefined }), 'Gund Aerial', 'HG'));
  });
});

test('catalogue : fin de job (plan false) libère le catalogue, le job suivant le retélécharge', async () => {
  await quiet(async () => {
    const calls = [];
    const p = provider(shop(FIXED, { calls }));
    p.plan(true);
    await outcome(p, 'Gundam Aerial', 'HG');
    await outcome(p, 'Gundam Aerial', 'HG');
    assert.equal(calls.filter((c) => c === '/products.json').length, 1);
    p.plan(false);
    await outcome(p, 'Gundam Aerial', 'HG'); // hors job : recherche par kit
    assert.equal(calls.filter((c) => c === '/products.json').length, 1);
    p.plan(true);
    await outcome(p, 'Gundam Aerial', 'HG');
    assert.equal(calls.filter((c) => c === '/products.json').length, 2);
  });
});

test('catalogue : un produit répété d une page à l autre (catalogue qui bouge) n est gardé qu une fois', async () => {
  await quiet(async (lines) => {
    const products = Array.from({ length: 300 }, (_, i) => prod(`HG 1/144 Zeta${i}`));
    const pages = [products.slice(0, 250), [products[249], ...products.slice(250)]]; // the last of page 1 comes again
    const p = provider(shop(products, { catalogue: (page) => Response.json({ products: pages[page - 1] ?? [] }) }));
    p.plan(true);
    await outcome(p, 'Zeta1', 'HG');
    assert.ok(lines.some((l) => /catalogue chargé : 300 produits, 2 requêtes/.test(l)));
    assert.ok((await outcome(p, 'Zeta249', 'HG', '144')).imageUrl); // not ambiguous with its own copy
  });
});
