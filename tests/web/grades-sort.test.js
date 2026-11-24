import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { SORTS, catalogueMain } from '../../public/render.js';

async function withApp(fn) {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    // HG 30 €, RG 30 € (tie), MG 10 €, HG no price, RG no price, PG 50 €.
    for (const [n, name, cents] of [[1, 'HG 1/144 Aerial', 3000], [2, 'RG 1/144 Zaku', 3000], [3, 'MG 1/100 Sazabi', 1000], [4, 'HG 1/144 Sans prix', null], [5, 'RG 1/144 Sans prix', null], [6, 'PG 1/60 Unicorn', 5000]]) {
      const id = addRealKit(app.db, n, name, 'Gundam');
      app.db.prepare('UPDATE kits SET price_cents = ? WHERE id = ?').run(cents, id);
    }
    await fn(app);
  } finally {
    await app.close?.();
    tmp.cleanup?.();
  }
}
const get = (app, q) => fetch(`${app.base}/api/kits?${q?.includes('limit') ? '' : 'limit=50&'}${q ?? ''}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const grades = (r) => [...new Set(r.body.kits.map((k) => k.grade))].sort();

test('API : grade=HG,RG est un OU, grade=HG seul inchangé, valeurs vides/doublons ignorés', async () => {
  await withApp(async (app) => {
    const both = await get(app, 'grade=HG,RG');
    assert.equal(both.body.total, 4);
    assert.deepEqual(grades(both), ['HG', 'RG']);
    assert.equal((await get(app, 'grade=HG')).body.total, 2);
    assert.equal((await get(app, 'grade=%20HG%20,,RG,HG,')).body.total, 4);
    assert.equal((await get(app, 'grade=HG,RG&price_min=2000')).body.total, 2); // ET avec les autres filtres
    assert.equal((await get(app, 'grade=HG,ZZ')).body.total, 2);
    assert.equal((await get(app, "grade=HG,'%20OR%201=1--")).body.total, 2); // placeholders
  });
});

test('API : price_asc / price_desc, sans prix toujours en dernier, égalités par id', async () => {
  await withApp(async (app) => {
    const asc = (await get(app, 'sort=price_asc')).body.kits;
    assert.deepEqual(asc.map((k) => k.price_cents), [1000, 3000, 3000, 5000, null, null]);
    assert.ok(asc[1].id < asc[2].id && asc[4].id < asc[5].id);
    const desc = (await get(app, 'sort=price_desc')).body.kits;
    assert.deepEqual(desc.map((k) => k.price_cents), [5000, 3000, 3000, 1000, null, null]);
    assert.ok(desc[1].id > desc[2].id && desc[4].id > desc[5].id);
    for (const s of ['price_asc', 'price_desc']) {
      const all = (await get(app, `sort=${s}`)).body.kits.map((k) => k.id);
      const paged = [];
      for (let o = 0; o < 6; o += 2) paged.push(...(await get(app, `sort=${s}&limit=2&offset=${o}`)).body.kits.map((k) => k.id));
      assert.deepEqual(paged, all, s);
    }
    assert.equal((await get(app, 'sort=price_up')).status, 400);
  });
});

test('web : /?grade=HG,RG montre deux plaques pressées, badge 2, tri dans le menu', async () => {
  await withApp(async (app) => {
    const html = await (await fetch(`${app.base}/?grade=HG,RG`)).text();
    assert.match(html, /data-facet="grade" data-value="HG" aria-pressed="true"/);
    assert.match(html, /data-facet="grade" data-value="RG" aria-pressed="true"/);
    assert.match(html, /data-facet="grade" data-value="MG" aria-pressed="false"/);
    assert.match(html, /name="grade" value="HG,RG"/);
    assert.match(html, /id="count"[^>]*>4\skits\b/);
    assert.match(html, /Filtres<span id="nfilt"> \(2\)<\/span>/);
    assert.match(html, /Tri : prix croissant/);
    assert.match(html, /Tri : prix décroissant/);
    const s = await (await fetch(`${app.base}/?sort=price_desc`)).text();
    assert.match(s, /<option value="price_desc" selected>/);
  });
});

test('rendu : badge = un par grade + autres filtres, message vide cite tous les grades', () => {
  const facets = { grades: [{ value: 'HG' }, { value: 'RG' }], scales: [], series: [], franchises: [] };
  const html = catalogueMain({ facets, filters: { grade: 'HG,RG', scale: '1/144', uncertain: '1' }, dbTotal: 5, kits: [], total: 0 });
  assert.match(html, /<span id="nfilt"> \(4\)<\/span>/);
  assert.match(html, /Aucun kit HG, RG en 1\/144 aux photos à vérifier\./);
  assert.match(catalogueMain({ facets, filters: { grade: ',', scale: '1/144' }, dbTotal: 5, kits: [], total: 0 }), /Aucun kit en 1\/144\./);
  assert.deepEqual(SORTS.slice(3), [['price_asc', 'prix croissant'], ['price_desc', 'prix décroissant']]);
});
