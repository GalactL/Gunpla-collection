import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from '../helpers/index.js';
import { shopifyProvider } from '../../src/photos/shopify.js';

const CDN = 'https://cdn.shopify.com/s/files/1/0001/files/';
const PATH = '/collections/gundam-gunpla-kit/products.json';
const prod = (title) => {
  const handle = title.toLowerCase().replace(/\W+/g, '-');
  return { title, handle, images: [{ src: `${CDN}${handle}.jpg?v=1` }] };
};

// Simulated shop: the collection (paged by 250), /products.json (other products, must stay untouched) and the kit search.
function shop(products, { collection = null } = {}) {
  const f = async (url) => {
    const u = new URL(url);
    f.urls.push(u);
    if (u.pathname === PATH || u.pathname === '/products.json') {
      const page = Number(u.searchParams.get('page'));
      if (u.pathname === PATH && collection) return collection(page);
      return Response.json({ products: u.pathname === PATH ? products.slice((page - 1) * 250, page * 250) : [] });
    }
    if (u.pathname === '/search/suggest.json') {
      const q = u.searchParams.get('q').toLowerCase().split(/\s+/);
      const found = products.filter((p) => q.every((w) => p.title.toLowerCase().includes(w))).slice(0, 10);
      return Response.json({ resources: { results: { products: found.map((p) => ({ title: p.title, url: `/products/${p.handle}?_pos=1`, image: p.images[0].src })) } } });
    }
    return new Response(PNG);
  };
  f.urls = [];
  return f;
}
const provider = (fetch, catalogue = { path: PATH, minKits: 1 }) =>
  shopifyProvider({ name: 'japanfigure', host: 'japan-figure.com', fetch, minIntervalMs: 0, retryMs: 1, tidy: true, catalogue });
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

test('collection : URL = chemin de la collection + limit=250&page=N, jamais /products.json ; mêmes résultats que par kit ; métriques', async () => {
  await quiet(async () => {
    const products = [...Array.from({ length: 300 }, (_, i) => prod(`HG 1/144 Zeta${i}`)), prod('MG 1/100 Zaku II'), prod('MG 1/100 Zaku II Ver 2.0')];
    const kits = [['Zeta1', 'HG', '144'], ['Zeta299', 'HG'], ['Zaku II', 'MG', '100'], ['Zaku', 'MG'], ['Absent', 'HG']];
    const f = shop(products);
    const cat = provider(f);
    cat.plan(true);
    const byKit = provider(shop(products), undefined);
    for (const [n, g, s] of kits) assert.deepEqual(await outcome(cat, n, g, s), await outcome(byKit, n, g, s), n);
    assert.deepEqual(
      f.urls.map((u) => `${u.origin}${u.pathname}?${u.searchParams}`),
      [`https://www.japan-figure.com${PATH}?limit=250&page=1`, `https://www.japan-figure.com${PATH}?limit=250&page=2`],
    );
    assert.equal(cat.metrics.requests, 2);
  });
});

test('collection : ~2 400 et ~1 900 produits = 10 et 8 requêtes, contre au moins 400 par kit', async () => {
  await quiet(async () => {
    for (const [total, pages] of [[2427, 10], [1910, 8]]) {
      const products = Array.from({ length: total }, (_, i) => prod(`HG 1/144 Zeta${i}`));
      const kits = Array.from({ length: 400 }, (_, i) => `Zeta${i}`);
      const cat = provider(shop(products));
      const byKit = provider(shop(products), undefined);
      cat.plan(true);
      for (const k of kits) assert.deepEqual(await outcome(cat, k, 'HG', '144'), await outcome(byKit, k, 'HG', '144'));
      assert.equal(cat.metrics.requests, pages);
      assert.ok(byKit.metrics.requests >= 400);
    }
  });
});

test('collection : 404, vide, JSON invalide = une ligne de journal, puis recherche par kit', async () => {
  const cases = {
    'HTTP 404': () => new Response('', { status: 404 }),
    vide: () => Response.json({ products: [] }),
    'JSON invalide': () => new Response('<html>', { status: 200 }),
  };
  for (const [reason, collection] of Object.entries(cases)) {
    await quiet(async (lines) => {
      const f = shop([prod('HG 1/144 Zeta1'), prod('HG 1/144 Zeta2'), prod('HG 1/144 Zeta3')], { collection });
      const p = provider(f);
      p.plan(true);
      for (const k of ['Zeta1', 'Zeta2', 'Zeta3']) assert.ok((await outcome(p, k, 'HG', '144')).imageUrl, `${reason} ${k}`);
      const warn = lines.filter((l) => /catalogue indisponible/.test(l));
      assert.equal(warn.length, 1, reason);
      assert.ok(warn[0].includes(reason), warn[0]);
      assert.equal(f.urls.filter((u) => u.pathname === PATH).length, 1, 'catalogue tenté une seule fois');
      assert.equal(f.urls.filter((u) => u.pathname === '/search/suggest.json').length, 3);
    });
  }
});

test('collection : chemin invalide refusé à la création du provider', () => {
  const bad = ['https://evil.example.com/collections/x/products.json', '//evil.example.com/collections/x/products.json', '/products.json', '/collections/x/products.json?a=1', '/collections/../products.json', '/collections//products.json', '/collections/a b/products.json', '/collections/x/y/products.json', '', 42];
  for (const path of bad) assert.throws(() => provider(shop([]), { path, minKits: 3 }), /invalid catalogue path/, String(path));
  assert.doesNotThrow(() => provider(shop([]), { path: '/collections/gunpla/products.json', minKits: 3 }));
});

test('collection : sans path, /products.json comme avant', async () => {
  await quiet(async () => {
    const f = shop([prod('HG 1/144 Zeta1')]);
    const p = provider(f, { minKits: 1 });
    p.plan(true);
    await outcome(p, 'Zeta1', 'HG', '144');
    assert.equal(f.urls[0].pathname, '/products.json');
  });
});
