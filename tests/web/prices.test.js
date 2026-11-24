import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addRealKit, startApp, tmpDataDir } from '../helpers/index.js';
import { canalLink, priceBlock, priceDone, priceLabel, shortDate, editorHtml, money } from '../../public/render.js';

let tmp, app;
const get = async (path) => (await fetch(app.base + path)).text();
const set = (id, f) => app.db.prepare('UPDATE kits SET price_cents=?, price_source=?, price_state=?, price_checked_at=?, source_url=? WHERE id=?').run(...f, id);
const AT = '2026-11-23T12:00:00Z';
const ids = {};
const cardOf = (html, id) => html.split('<article').find((a) => a.includes(`data-kit="${id}"`));

before(async () => {
  tmp = tmpDataDir();
  app = await startApp(tmp.dir);
  ids.a = addRealKit(app.db, 1, 'Gundam Aerial MG 1/100', 'Gundam');
  ids.b = addRealKit(app.db, 2, 'Gundam Banshee HG 1/144', 'Gundam');
  ids.c = addRealKit(app.db, 3, 'Gundam Epyon RG 1/144', 'Gundam');
  ids.d = addRealKit(app.db, 4, 'Gundam Zeta PG 1/60', 'Gundam');
  ids.h = addRealKit(app.db, 5, '<img src=x onerror=alert(1)> HG 1/144', 'Gundam');
  set(ids.a, [1290, 'canalbd', 'priced', AT, 'https://www.canalbd.net/maquette/a']);
  set(ids.b, [1150, 'vendeur', 'priced', AT, 'http://www.canalbd.net/maquette/b']);
  set(ids.c, [null, null, 'unavailable', AT, 'https://evil.net/x']);
  set(ids.h, [500, 'canalbd', 'priced', AT, 'https://canalbd.net/"><script>alert(1)</script>']);
  app.db.prepare('UPDATE kits SET hidden = 1 WHERE id = ?').run(ids.d);
});
after(async () => {
  await app.close();
  tmp.cleanup();
});

test('helpers : centimes, date, libellés', () => {
  assert.match(money(0), /^0,00\s€$/);
  assert.match(money(5), /^0,05\s€$/);
  assert.match(money(1290), /^12,90\s€$/);
  assert.match(money(100000), /^1\s000,00\s€$/);
  assert.equal(shortDate(AT), '23/11');
  for (const bad of [null, undefined, '', 'nope', '2026-13-45']) assert.equal(shortDate(bad), null);
  assert.match(priceLabel(1290, 'canalbd', 'priced', AT), /^12,90\s€ · relevé le 23\/11$/);
  assert.match(priceLabel(1150, 'vendeur', 'priced', AT), /^11,50\s€ · chez un vendeur · relevé le 23\/11$/);
  assert.equal(priceLabel(null, null, 'unavailable', AT), 'Indisponible · relevé le 23/11');
  assert.equal(priceLabel(null, null, 'unavailable', 'bad'), 'Indisponible');
  assert.equal(priceLabel(1290, null, null, AT), null);
  assert.equal(priceLabel(null, 'canalbd', 'priced', AT), null);
});

test('helpers : validateur du lien Canal BD', () => {
  assert.equal(canalLink('https://www.canalbd.net/a?b=1'), 'https://www.canalbd.net/a?b=1');
  assert.ok(canalLink('https://canalbd.net/a'));
  for (const bad of ['http://www.canalbd.net/a', 'https://evil.net/a', 'javascript:alert(1)', 'https://www.canalbd.net@evil.net/', 'https://user:pw@canalbd.net/', 'https://canalbd.net.evil.com/', 'https://evilcanalbd.net/', 'https://canalbd.net:8443/', '', null, undefined])
    assert.equal(canalLink(bad), null, String(bad));
});

test('helpers : message de fin du relevé', () => {
  assert.equal(priceDone({ priced: 3, unavailable: 1, stopped: null }), '3 prix relevés, 1 indisponible.');
  assert.match(priceDone({ priced: 0, unavailable: 0, stopped: 'blocked' }), /^Canal BD a bloqué ou limité les requêtes\./);
  assert.match(priceDone({ priced: 1, unavailable: 0, stopped: 'shape' }), /^Format de réponse inattendu : relevé interrompu\./);
});

test('carte du catalogue : prix, vendeur, indisponible, absent', async () => {
  const html = await get('/');
  assert.match(cardOf(html, ids.a), /<b>12,90<i>€<\/i><\/b>/);
  assert.match(cardOf(html, ids.b), /<b>11,50<i>€<\/i><\/b><span>chez un vendeur<\/span>/);
  assert.match(cardOf(html, ids.c), /<b class="off">Indisponible<\/b>/);
  assert.ok(!cardOf(html, ids.a).includes('Indisponible'));
  assert.ok(!cardOf(html, ids.a).includes('relevé'), 'no reading date on the card');
  const kp = await get(`/kit/${ids.a}`); // the kit page keeps the date
  assert.match(kp, /<b>12,90\s€<\/b>/);
  assert.match(kp, /Relevé le 23\/11/);
  set(ids.b, [null, null, null, null, null]);
  assert.ok(!/<b>\d/.test(cardOf(await get('/'), ids.b)));
  set(ids.b, [1150, 'vendeur', 'priced', AT, 'http://www.canalbd.net/maquette/b']);
});

test('lien : valide, http et hôte étranger absents, URL hostile échappée', async () => {
  // The Canal BD link lives on the kit page, not on the card.
  const page = (id) => get(`/kit/${id}`);
  assert.match(await page(ids.a), /<a class="lk" href="https:\/\/www\.canalbd\.net\/maquette\/a" target="_blank" rel="noopener noreferrer">Voir sur Canal BD<span class="vh"> : Gundam Aerial/);
  assert.ok(!(await page(ids.b)).includes('Voir sur Canal BD'), 'http');
  assert.ok(!(await page(ids.c)).includes('Voir sur Canal BD'), 'other host');
  const h = await page(ids.h);
  assert.ok(!h.includes('<script>alert') && !h.includes('<img src=x'), 'escaped');
  assert.ok(!priceBlock({ title: '<b>', source_url: 'https://canalbd.net/"><script>', price_state: null }, null).includes('<script>'));
});

test('ligne de collection : prix catalogue séparé du prix payé', async () => {
  const r = await app.api('POST', '/api/copies', { kitId: ids.a, status: 'possede', price_cents: 4290 });
  assert.equal(r.status, 201);
  const col = await get('/collection');
  assert.match(col, /12,90\s€ · relevé le 23\/11/);
  assert.match(col, /<td role="cell" class="num">42,90\s€<\/td>/);
  assert.match(col, /Voir sur Canal BD/);
  const copy = (await app.api('GET', '/api/copies')).body.find((c) => c.kit_id === ids.a);
  assert.equal(copy.price_cents, 4290);
  assert.equal(copy.catalogue_price_cents, 1290);
  assert.match(editorHtml('edit', copy), /name="price"[^>]*value="42,90"/);
  // adding from the catalogue never pre-fills the price paid with the catalogue price
  assert.match(editorHtml('add', { id: ids.a, title: 'x', price_cents: 1290 }), /name="price"[^>]*value=""/);
});

test('compteurs : kits masqués non comptés, bouton prix présent', async () => {
  const html = await get('/');
  assert.match(html, /<small id="n-kits">4<\/small>/);
  assert.match(html, /4\skits/);
  assert.match(html, /<button type="button" class="sb" id="act-prices" aria-label="Actualiser les prix">/);
});
