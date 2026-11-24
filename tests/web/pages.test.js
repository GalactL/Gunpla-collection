import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addKit, startApp, tmpDataDir } from '../helpers/index.js';
import { catalogueMain, editorHtml, parsePrice } from '../../public/render.js';

let tmp, app, kitA, kitB;
const get = async (path) => {
  const res = await fetch(app.base + path);
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
};

before(async () => {
  tmp = tmpDataDir();
  app = await startApp(tmp.dir);
});
after(async () => {
  await app.close();
  tmp.cleanup();
});

test('catalogue vide puis collection vide : pages FR, deux onglets, états titre', async () => {
  const cat = await get('/');
  assert.equal(cat.status, 200);
  assert.match(cat.type, /^text\/html/);
  assert.match(cat.text, /<html lang="fr">/);
  assert.match(cat.text, /<a href="\/" aria-current="page">Catalogue Maquettes/);
  assert.match(cat.text, /<a href="\/collection">Ma collection/);
  assert.match(cat.text, /Le catalogue est vide\./);
  const col = await get('/collection');
  assert.equal(col.status, 200);
  assert.match(col.text, /<a href="\/collection" aria-current="page">Ma collection/);
  assert.match(col.text, /Aucun exemplaire pour l’instant\./);
});

test('première page rendue côté serveur avec les kits de la base, filtres depuis l’URL', async () => {
  kitA = addKit(app.db, 1, 'Fazz Ver.Ka');
  kitB = addKit(app.db, 2, '<script>alert(1)</script>');
  app.db.prepare("UPDATE kits SET grade = 'HG', scale = '1/144', imported_at = '2026-11-22T10:00:00Z' WHERE id = ?").run(kitB);
  const cat = await get('/');
  assert.match(cat.text, /<h2 class="ttl" id="k\d+"><a href="\/kit\/\d+">Fazz Ver\.Ka<\/a><\/h2>/);
  assert.ok(!cat.text.includes('<script>alert(1)'), 'titles are escaped');
  assert.match(cat.text, /&#60;script&#62;alert\(1\)/);
  assert.match(cat.text, /Importé le 22\/11\/2026 · 2 kits/);
  assert.match(cat.text, /Introuvable/); // no photo yet
  const hg = await get('/?grade=HG&sort=hack');
  assert.ok(!hg.text.includes('Fazz Ver.Ka'));
  assert.match(hg.text, /data-facet="grade" data-value="HG" aria-pressed="true"/);
  assert.match((await get('/?grade=PG&q=banshee')).text, /Aucun kit PG pour « banshee »\./);
});

test('collection : ligne du registre avec prix, date FR, jauge et numéro d’exemplaire', async () => {
  const mk = (b) => app.api('POST', '/api/copies', { kitId: kitA, ...b });
  await mk({ status: 'possede', price_cents: 4290, purchased_on: '2026-03-12', purchased_at: 'Nantes', notes: 'Notice complète' });
  await mk({ status: 'souhaite' });
  const col = await get('/collection');
  assert.match(col.text, /42,90\s€/);
  assert.match(col.text, /12 mars 2026/);
  assert.match(col.text, /class="gauge g2"[^]*?Possédé/);
  assert.match(col.text, /Exemplaire 2/);
  assert.match(col.text, /Tous <span class="n">2<\/span>/);
  assert.match((await get('/')).text, /Dans ma collection · 2/);
});

test('fichiers statiques : types corrects, traversée de chemin refusée', async () => {
  assert.match((await get('/assets/app.css')).type, /^text\/css/);
  assert.match((await get('/assets/app.js')).type, /^text\/javascript/);
  assert.match((await get('/assets/render.js')).type, /^text\/javascript/);
  assert.match((await get('/assets/favicon.svg')).type, /^image\/svg\+xml/);
  for (const p of ['/assets/..%2Fpackage.json', '/assets/..%2F..%2Fsrc%2Fserver.js', '/assets/%2e%2e%2fpackage.json', '/assets/nope.css', '/assets/..%5Cpackage.json', '/assets/APP.CSS']) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await get('/assets/../package.json')).status, 404); // URL-normalised to /package.json
});

test('éditeur « Ajouter à ma collection » : aucun statut présélectionné, Enregistrer désactivé', () => {
  const html = editorHtml('add', { id: 7, title: 'Exia', grade: 'MG', scale: '1/100' });
  const radios = html.match(/<input type="radio"[^>]*>/g);
  assert.deepEqual(radios.map((r) => r.match(/value="(\w+)"/)[1]), ['possede', 'monte']);
  assert.ok(radios.every((r) => !/checked/.test(r)));
  assert.match(html, /<button type="submit" class="btn pri" id="ed-save" disabled/);
  assert.doesNotMatch(html, /Supprimer/);
  const edit = editorHtml('edit', { id: 3, kit_id: 7, title: 'Exia', status: 'souhaite', notes: 'garder', price_cents: 1890 });
  assert.match(edit, /value="souhaite" checked/);
  assert.match(edit, /value="18,90"/);
  assert.match(edit, />\ngarder<\/textarea>/);
  assert.doesNotMatch(edit, /id="ed-save" disabled/);
  assert.match(edit, /Supprimer l’exemplaire/);
});

test('éditeur : des notes qui commencent par un saut de ligne le gardent', () => {
  const notes = '\nPremière ligne vide & <b>gras</b>';
  const html = editorHtml('edit', { id: 1, kit_id: 1, title: 'Exia', status: 'possede', notes });
  // HTML parser rule: one newline right after <textarea> is dropped, then character references are decoded.
  const raw = html.match(/<textarea[^>]*>([^]*?)<\/textarea>/)[1];
  const value = raw.replace(/^\n/, '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
  assert.equal(value, notes);
});

test('parsePrice : virgule ou point, espaces et €, sinon invalide', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('42,90'), 4290);
  assert.equal(parsePrice('42.9'), 4290);
  assert.equal(parsePrice('1 234,5 €'), 123450);
  assert.equal(parsePrice('7'), 700);
  assert.equal(parsePrice('999 999 999,99'), 99999999999);
  for (const bad of ['4,999', 'abc', '-3', '1,2,3', '1234567890', '9'.repeat(400)]) assert.equal(parsePrice(bad), undefined, bad);
});

test('catalogueMain : facettes reconstruites en gardant les filtres courants', () => {
  const facets = { scales: [{ value: '1/144' }, { value: '1/100' }], grades: [{ value: 'HG' }], series: [{ value: 'Zeta' }], franchises: [{ value: 'Gundam' }, { value: 'Autre' }] };
  const html = catalogueMain({ facets, filters: { scale: '1/100', franchise: 'Gundam', series: 'Zeta', q: 'fazz' }, dbTotal: 2, kits: [], total: 0, owned: {} });
  assert.match(html, /data-value="1\/100" aria-pressed="true"/);
  assert.match(html, /data-value="1\/144" aria-pressed="false"/);
  assert.match(html, /<option value="Zeta" selected>/);
  assert.match(html, /<option value="Gundam" selected>/);
  assert.match(html, /<option value="Autre">/);
  assert.match(html, /\(3\)/); // échelle + franchise + série
  assert.match(html, /name="q" value="fazz"/);
});

test('pourcentage mal formé dans l’URL : 400 JSON, pas 500', async () => {
  const res = await get('/photos/%E0%A4%A');
  assert.equal(res.status, 400);
  assert.match(res.type, /json/);
});

test('badge franchise sur chaque kit du catalogue et de la collection, filtre franchise depuis l’URL', async () => {
  const k = addKit(app.db, 3, 'Going Merry');
  app.db.prepare("UPDATE kits SET franchise = 'One Piece', series = NULL WHERE id = ?").run(k);
  await app.api('POST', '/api/copies', { kitId: k, status: 'souhaite' });
  const cat = await get('/');
  assert.match(cat.text, /<span class="tag">One Piece<\/span><\/p>/); // pas de « Série · — »
  assert.match(cat.text, /<span class="tag">Gundam<\/span> Série · <b>Gundam<\/b>/);
  const only = await get('/?franchise=One%20Piece');
  assert.match(only.text, /Going Merry/);
  assert.ok(!only.text.includes('Fazz Ver.Ka'));
  assert.match(only.text, /<option value="One Piece" selected>/);
  assert.match((await get('/?franchise=Pokémon')).text, /Aucun kit Pokémon\./);
  assert.match((await get('/collection')).text, /<span class="sub">One Piece(?: · Exemplaire \d+)?<\/span>/);
});

test('fiche kit : page dédiée échappée, 404 si inconnu, sélecteur de cartes par ligne', async () => {
  const ok = await get(`/kit/${kitB}`);
  assert.equal(ok.status, 200);
  assert.match(ok.text, /<h1 class="kt" id="k\d+">&#60;script&#62;alert\(1\)/);
  assert.match(ok.text, /<a href="\/" aria-current="page">Catalogue Maquettes/);
  assert.equal((await get('/kit/999999')).status, 404);
  assert.equal((await get('/kit/abc')).status, 404);
  assert.match((await get('/')).text, /role="group" aria-label="Cartes par ligne"/);
});

test('shell : la phrase d\'état précède les boutons Catalogue, Photos, Prix', async () => {
  const { text } = await get('/');
  const at = (re) => text.search(re);
  const st = at(/<p id="sync-status" role="status">/);
  assert.equal(text.split('id="sync-status"').length, 2, 'un seul #sync-status');
  assert.ok(st > at(/<div class="sync">/) && st < at(/<div class="sbar"/));
  assert.ok(at(/id="act-import"/) < at(/id="act-photos"/) && at(/id="act-photos"/) < at(/id="act-prices"/));
});
