import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { catalogueMain } from '../../public/render.js';

async function withApp(fn) {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    // 25 €, 60 €, 120 €, and one without price.
    for (const [n, name, cents] of [[1, 'HG 1/144 Aerial', 2500], [2, 'MG 1/100 Zaku II', 6000], [3, 'HG 1/144 Gundam', 12000], [4, 'HG 1/144 Sans prix', null]]) {
      const id = addRealKit(app.db, n, name, 'Gundam');
      app.db.prepare('UPDATE kits SET price_cents = ? WHERE id = ?').run(cents, id);
    }
    await fn(app);
  } finally {
    await app.close?.();
    tmp.cleanup?.();
  }
}
const get = (app, q) => fetch(`${app.base}/api/kits?limit=50${q ? `&${q}` : ''}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const prices = (r) => r.body.kits.map((k) => k.price_cents).sort((a, b) => (a ?? -1) - (b ?? -1));

test('API : bornes inclusives, NULL exclu seulement avec une borne, combinaison avec grade', async () => {
  await withApp(async (app) => {
    assert.deepEqual(prices(await get(app, '')), [null, 2500, 6000, 12000]);
    assert.deepEqual(prices(await get(app, 'price_min=3000')), [6000, 12000]);
    assert.deepEqual(prices(await get(app, 'price_max=6000')), [2500, 6000]);
    assert.deepEqual(prices(await get(app, 'price_min=3000&price_max=10000')), [6000]);
    assert.deepEqual(prices(await get(app, 'price_min=0')), [2500, 6000, 12000]);
    assert.equal((await get(app, 'price_min=3000&grade=MG')).body.total, 1);
    assert.equal((await get(app, 'price_min=3000&grade=HG')).body.total, 1);
    const p = await get(app, 'price_min=3000&limit=1&offset=1');
    assert.equal(p.body.total, 2);
    assert.equal(p.body.kits.length, 1);
  });
});

test('API : 400 sur valeur invalide ou min > max', async () => {
  await withApp(async (app) => {
    for (const q of ['price_min=-1', 'price_max=1.5', 'price_min=abc', 'price_min=5000&price_max=4000']) {
      const r = await get(app, q);
      assert.equal(r.status, 400, q);
      assert.match(JSON.stringify(r.body), /Paramètre « price_m(in|ax) » invalide/, q);
    }
    assert.equal((await get(app, 'price_min=5000&price_max=5000')).status, 200);
  });
});

test('web : une URL avec price_min/price_max applique le filtre, remplit les champs et le badge', async () => {
  await withApp(async (app) => {
    const html = await (await fetch(`${app.base}/?price_min=3000&price_max=10000`)).text();
    assert.match(html, /id="count"[^>]*>1\skit\b/);
    assert.match(html, /name="price_min"[^>]*value="30"/);
    assert.match(html, /name="price_max"[^>]*value="100"/);
    assert.match(html, /Filtres<span id="nfilt"> \(1\)<\/span>/);
    const plain = await (await fetch(`${app.base}/`)).text();
    assert.match(plain, /Prix min \(€\)/);
    assert.match(plain, /Prix max \(€\)/);
    assert.match(plain, /id="price-err" role="alert"/);
    assert.match(plain, /Filtres<span id="nfilt"><\/span>/);
  });
});

test('web : prix invalide ou min > max dans l’URL = page sans filtre, pas de 400', async () => {
  await withApp(async (app) => {
    for (const q of ['price_min=abc', 'price_min=5000&price_max=1']) {
      const r = await fetch(`${app.base}/?${q}`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /html/);
      assert.match(await r.text(), /Filtres<span id="nfilt"><\/span>/);
    }
  });
});

test('rendu : message de liste vide avec la fourchette, saisie en virgule', () => {
  const base = { facets: { scales: [], grades: [], franchises: [], series: [] }, dbTotal: 5, kits: [], total: 0 };
  const both = catalogueMain({ ...base, filters: { price_min: '2000', price_max: '8050' } });
  assert.match(both, /Aucun kit entre 20 et 80,50\s€/);
  assert.match(both, /name="price_max"[^>]*value="80,50"/);
  assert.match(catalogueMain({ ...base, filters: { price_min: '2000' } }), /Aucun kit à partir de 20\s€/);
  assert.match(catalogueMain({ ...base, filters: { price_max: '8000' } }), /Aucun kit jusqu’à 80\s€/);
});
