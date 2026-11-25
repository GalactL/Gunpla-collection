import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addKit, startApp, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import photoRoutes from '../../src/photos/routes.js';
import { REASONS, hljProvider, relaxName, titleMatches } from '../../src/photos/provider.js';
import { fetchPhotoForKit, providersToTry, searchName, stripCatalogueNumbers } from '../../src/photos/fetch.js';
import { savePhoto } from '../../src/photos/store.js';
import { cleanTitle } from '../../src/catalogue/title.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);

// App with the photo routes only, so providers/delay can be injected.
async function photoApp(extra = {}) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const router = createRouter();
  photoRoutes(router, { db, dataDir: tmp.dir, delayMs: 0, ...extra });
  const server = createServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, dir: tmp.dir, base,
    req: (method, path, body, headers) => fetch(base + path, { method, body, headers }),
    close: async () => (server.closeAllConnections(), server.close(), db.close(), tmp.cleanup()),
  };
}

const okFetch = (bytes) => async () => new Response(bytes, { status: 200 });
const provider = (hit) => ({ name: 'fake', find: async () => hit });
const photoRow = (db, id) => db.prepare('SELECT * FROM photos WHERE kit_id = ?').get(id);

test('provider miss -> null, aucune ligne photo', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db, 1, 'Exia');
    const r = await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: [provider(null)], fetch: okFetch(PNG) });
    assert.deepEqual(r, { found: false });
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.equal(existsSync(join(app.dir, 'photos')), false);
  } finally {
    await app.close();
  }
});

test('titleMatches : zéros de tête, ν, "Gundam" seul et chiffres romains', async () => {
  // zéros de tête et graphie ν normalisés ; "Gundam" seul ne suffit pas
  assert.ok(titleMatches('RX-78-2 Gundam', 'RX-78-02 Gundam'));
  assert.ok(titleMatches('Hi-Nu Gundam Ver.Ka', 'RX-93-ν2 Hi-ν Gundam'));
  assert.ok(!titleMatches('Gundam Aerial', 'Gundam Epyon'));
  // chiffres romains / jetons courts ne suffisent pas à identifier un kit
  assert.ok(!titleMatches('Zaku II', 'Gouf II'));
  assert.ok(titleMatches('Zaku II', 'MS-06 Zaku II'));
  // "wing" seul (kit "Gundam Wing") ne suffit pas : la page doit dire Gundam
  assert.ok(!titleMatches('Gundam Wing', 'Zero Wing'));
  assert.ok(titleMatches('Gundam Wing', 'XXXG-01W Wing Gundam'));
  assert.ok(titleMatches('Gundam Wing', 'Wing-Gundam'));
});

test('searchName retire grade et échelle', () => {
  assert.equal(searchName('MG 1/100 FAZZ Ver.Ka'), 'FAZZ Ver.Ka');
  assert.equal(searchName('Exia'), 'Exia');
});

test('auto ne remplace jamais une photo user ; user remplace auto (ext différente, ancien fichier supprimé)', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db);
    const base = { db: app.db, dataDir: app.dir, kitId };
    assert.equal(savePhoto({ ...base, bytes: JPG, kind: 'auto' }).file, `${kitId}.jpg`);
    assert.equal(savePhoto({ ...base, bytes: PNG, kind: 'user' }).file, `${kitId}.png`);
    assert.deepEqual(readdirSync(join(app.dir, 'photos')), [`${kitId}.png`]);
    assert.equal(savePhoto({ ...base, bytes: WEBP, kind: 'auto' }), null);
    const row = photoRow(app.db, kitId);
    assert.equal(row.kind, 'user');
    assert.equal(row.file, `${kitId}.png`);
    assert.deepEqual(readFileSync(join(app.dir, 'photos', row.file)), PNG);
  } finally {
    await app.close();
  }
});

test('fetchPhotoForKit enregistre kind auto, saute les kits ayant déjà une photo, ignore un téléchargement invalide', async () => {
  const app = await photoApp();
  try {
    const a = addKit(app.db, 1, 'MG 1/100 Exia');
    const b = addKit(app.db, 2, 'Zaku');
    let asked;
    const p = { name: 'fake', find: async (n) => ((asked = n), { imageUrl: 'https://i/x.png', pageUrl: 'https://w/x' }) };
    const base = { db: app.db, dataDir: app.dir, providers: [p] };
    assert.deepEqual(await fetchPhotoForKit({ ...base, kitId: a, fetch: okFetch(PNG) }), { found: true });
    assert.equal(asked, 'Exia');
    assert.equal(photoRow(app.db, a).kind, 'auto');
    assert.equal(photoRow(app.db, a).source_url, 'https://w/x');
    asked = undefined;
    assert.deepEqual(await fetchPhotoForKit({ ...base, kitId: a, fetch: okFetch(PNG) }), { found: false });
    assert.equal(asked, undefined, 'provider non appelé pour un kit déjà photographié');
    // HTML renvoyé à la place d'une image -> rejeté par magic bytes
    assert.deepEqual(await fetchPhotoForKit({ ...base, kitId: b, fetch: okFetch('<html>') }), { found: false });
    assert.equal(photoRow(app.db, b), undefined);
  } finally {
    await app.close();
  }
});

test('PUT photo : validation magic bytes (400), taille (413), kit inconnu (404), id invalide', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db);
    const put = (id, body) => app.req('PUT', `/api/kits/${id}/photo`, body, { 'content-type': 'image/png' });
    assert.equal((await put(kitId, 'pas une image')).status, 400);
    assert.equal((await put(kitId, Buffer.concat([JPG, Buffer.alloc(8 * 1024 * 1024)]))).status, 413);
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.equal((await put(999, PNG)).status, 404);
    assert.equal((await put('abc', PNG)).status, 404);
    assert.equal((await put('1.2', PNG)).status, 404);
    const ok = await put(kitId, JPG);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { file: `${kitId}.jpg`, kind: 'user' });
  } finally {
    await app.close();
  }
});

test('la photo uploadée remplace l\'auto et survit à un redémarrage ; /photos/:id sert le bon Content-Type', async () => {
  const tmp = tmpDataDir();
  try {
    let app = await startApp(tmp.dir);
    const kitId = addKit(app.db);
    savePhoto({ db: app.db, dataDir: tmp.dir, kitId, bytes: JPG, kind: 'auto' });
    const put = await fetch(`${app.base}/api/kits/${kitId}/photo`, { method: 'PUT', body: PNG, headers: { 'content-type': 'image/png' } });
    assert.equal(put.status, 200);
    await app.close();

    app = await startApp(tmp.dir);
    const res = await fetch(`${app.base}/photos/${kitId}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    assert.equal(photoRow(app.db, kitId).kind, 'user');
    const v = await fetch(`${app.base}/photos/${kitId}?v=1`);
    assert.match(v.headers.get('cache-control'), /max-age=31536000/);
    const cached = await fetch(`${app.base}/photos/${kitId}`, { headers: { 'if-none-match': res.headers.get('etag') } });
    assert.equal(cached.status, 304);
    await app.close();
  } finally {
    tmp.cleanup();
  }
});

test('/photos/:kitId : ids invalides -> 404, nom de fichier pris dans la DB uniquement', async () => {
  const app = await photoApp();
  try {
    for (const bad of ['abc', '1.2', '0', '01', '-1', '1e3', '..%2F..%2Fgunpla.db']) {
      assert.equal((await app.req('GET', `/photos/${bad}`)).status, 404, bad);
    }
    // un fichier hors du dossier photos ne peut pas être servi, même s'il porte un nom d'id
    writeFileSync(join(app.dir, '7.png'), PNG);
    assert.equal((await app.req('GET', '/photos/7')).status, 404);
    // une ligne DB piégée ne sort pas du dossier photos (basename)
    const kitId = addKit(app.db);
    app.db.prepare('INSERT INTO photos (kit_id, kind, file, updated_at) VALUES (?, ?, ?, ?)').run(kitId, 'user', '../gunpla.db', 'x');
    assert.equal((await app.req('GET', `/photos/${kitId}`)).status, 404);
    assert.equal((await app.req('GET', '/photos/99')).status, 404);
  } finally {
    await app.close();
  }
});

test('refresh : ignore les kits avec photo, renvoie tried/found/missing, garde 409', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const calls = [];
  const p = {
    name: 'fake',
    find: async (n) => {
      calls.push(n);
      await gate;
      return n === 'Zaku' ? null : { imageUrl: 'https://i/x.png', pageUrl: 'https://w/x' };
    },
  };
  const app = await photoApp({ providers: [p], fetch: okFetch(PNG) });
  try {
    const has = addKit(app.db, 1, 'Deja');
    const exia = addKit(app.db, 2, 'Exia');
    const zaku = addKit(app.db, 3, 'Zaku');
    savePhoto({ db: app.db, dataDir: app.dir, kitId: has, bytes: JPG, kind: 'user' });

    const first = await app.req('POST', '/api/photos/refresh');
    assert.equal(first.status, 202); // rendu aussitôt, le travail continue en tâche de fond
    assert.deepEqual(await first.json(), { running: true });
    while (!calls.length) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(await (await app.req('GET', '/api/photos/status')).json(), { running: true, last: null, progress: { tried: 0, found: 0, total: 2 } });
    assert.equal((await app.req('POST', '/api/photos/refresh')).status, 409);
    release();
    let st;
    do {
      await new Promise((r) => setTimeout(r, 5));
      st = await (await app.req('GET', '/api/photos/status')).json();
    } while (st.running);
    const out = st.last;
    assert.deepEqual([out.tried, out.found, out.missing], [2, 1, 1]);
    assert.equal(st.progress, null);
    assert.deepEqual(calls, ['Exia', 'Zaku']);
    assert.equal(photoRow(app.db, exia).kind, 'auto');
    assert.equal(photoRow(app.db, zaku), undefined);
    assert.equal(photoRow(app.db, has).kind, 'user');
    // la garde est libérée
    assert.equal((await app.req('POST', '/api/photos/refresh')).status, 202);
  } finally {
    await app.close();
  }
});

test('téléchargement : corps en flux dépassant la limite sans content-length -> aucune photo', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db, 1, 'Exia');
    const chunk = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    let sent = 0;
    const body = new ReadableStream({
      pull(c) {
        if (sent++ > 100) return c.close(); // sinon sans fin : doit être coupé par la limite
        c.enqueue(chunk);
      },
    });
    const big = async () => new Response(body, { status: 200 });
    const r = await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: [provider({ imageUrl: 'https://i/x.png' })], fetch: big });
    assert.deepEqual(r, { found: false });
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.ok(sent < 30, `flux interrompu tôt (${sent} morceaux lus)`);
  } finally {
    await app.close();
  }
});

// --- Box photos (HobbyLink Japan) before the wiki ---
const hljPage = (items) =>
  `<div class="search-widget-blocks">${items.map(([name, slug]) => `<div class="search-widget-block">
    <a class="item-img-wrapper" href="/${slug}"><img src="//www.hlj.com/productthumbs/ban/${slug}_0_1.jpg?v=1"></a>
    <p class="product-item-name "><a href="/${slug}">${name}</a></p></div>`).join('')}</div>`;
const hljWith = (items) => hljProvider({ minIntervalMs: 0, fetch: async () => new Response(hljPage(items), { status: 200 }) });

test('hlj : accepte la boîte du bon grade/nom, refuse mauvais grade, variante, autre kit, non-Bandai', async () => {
  const items = [
    ['Gundam Decal RG Wing Gundam', 'decal-banx1'],
    ['1/100 MG Sinanju Stein (Narrative Ver.)', 'mg-sinanju-stein-bans55709'],
    ['1/144 RG MSN-06S Sinanju', 'rg-sinanju-bann07590'],
    ['Robot Damashii Sinanju', 'rd-sinanju-ban960609'],
    ['1/100 MG Sinanju T-Shirt', 'mg-sinanju-tee-cspr1'], // pas un code Bandai
    ['1/100 MG Sinanju', 'mg-sinanju-ban981597'],
  ];
  const hit = await hljWith(items).find('Sinanju', 'MG');
  assert.equal(hit.pageUrl, 'https://www.hlj.com/mg-sinanju-ban981597');
  assert.equal(hit.imageUrl, 'https://www.hlj.com/productthumbs/ban/mg-sinanju-ban981597_0_1.jpg?v=1');
  // sans le bon grade, ni variante (Stein), ni accessoire : rien plutôt qu'une mauvaise boîte
  assert.equal(await hljWith(items).find('Sinanju', 'HG'), null);
  // #12 : la fiche "Stein (Narrative Ver.)" a des mots en trop hors liste : plus refusée, mais seulement douteuse
  const stein = await hljWith(items.slice(0, 2)).find('Sinanju', 'MG');
  assert.equal(stein.pageUrl, 'https://www.hlj.com/mg-sinanju-stein-bans55709');
  assert.deepEqual([stein.uncertain, stein.extra], [true, ['stein', 'narrative']]);
  assert.equal((await hljWith(items).find('MSN-06S Sinanju', 'RG')).pageUrl, 'https://www.hlj.com/rg-sinanju-bann07590');
  // "Nu" != "Hi-Nu" (titleMatches), tout mot du kit doit être présent
  assert.equal(await hljWith([['1/100 MG Hi-Nu Gundam', 'hinu-ban1']]).find('Nu Gundam', 'MG'), null);
  assert.equal(await hljWith([['1/144 HG Gundam Aerial', 'a-banh1-up']]).find('Rebuild Aerial', 'HG'), null); // kit de 2 mots : un mot manquant reste refusé
  // un seul mot manquant sur un kit de 3 mots = douteux
  const rebuild = await hljWith([['1/144 HG Gundam Aerial', 'a-banh1-up']]).find('Gundam Aerial Rebuild', 'HG');
  assert.deepEqual([rebuild.uncertain, rebuild.missing], [true, ['rebuild']]);
});

test('hlj : 403, 503, réseau, HTML sans résultat -> null sans exception', async () => {
  for (const f of [
    async () => new Response('denied', { status: 403 }),
    async () => new Response('x', { status: 503 }),
    async () => { throw new Error('timeout'); },
    async () => new Response('<html></html>', { status: 200 }),
  ]) assert.equal(await hljProvider({ minIntervalMs: 0, fetch: f }).find('Exia', 'MG'), null);
});

test('hlj : intervalle minimal entre deux requêtes', async () => {
  const times = [];
  const p = hljProvider({ minIntervalMs: 60, fetch: async () => (times.push(Date.now()), new Response('', { status: 200 })) });
  await p.find('A', 'MG');
  await p.find('B', 'MG');
  assert.ok(times[1] - times[0] >= 55, `${times[1] - times[0]} ms`);
});

test('chaîne : 403 sur la source boîte -> repli sur la source suivante ; tout échoue -> found:false sans exception', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db, 1, 'MG 1/100 Exia');
    const blocked = { name: 'box', host: 'hlj.com', find: async () => { throw new Error('HTTP 403'); } };
    const wiki = { name: 'wiki', host: 'gundam.fandom.com', find: async () => ({ imageUrl: 'https://i/x.png', pageUrl: 'https://gundam.fandom.com/wiki/X' }) };
    assert.deepEqual(await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: [blocked, wiki], fetch: okFetch(PNG) }), { found: true });
    assert.equal(photoRow(app.db, kitId).source_url, 'https://gundam.fandom.com/wiki/X');
    // image 403 à son tour (CDN) : rien enregistré, sans exception
    const k2 = addKit(app.db, 2, 'HG Zaku');
    const deny = async () => new Response('no', { status: 403 });
    assert.deepEqual(await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId: k2, providers: [blocked, wiki], fetch: deny }), { found: false });
    assert.equal(photoRow(app.db, k2), undefined);
  } finally {
    await app.close();
  }
});

test('photo auto remplacée par une source mieux classée ; jamais l\'inverse ; jamais un upload', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db, 1, 'MG 1/100 Exia');
    let calls = [];
    const mk = (name, host) => ({ name, host, find: async (n, g) => (calls.push([name, g]), { imageUrl: 'https://i/x.png', pageUrl: `https://www.${host}/p` }) });
    const box = mk('box', 'hlj.com'), wiki = mk('wiki', 'gundam.fandom.com');
    const base = { db: app.db, dataDir: app.dir, kitId, providers: [box, wiki], fetch: okFetch(PNG) };
    savePhoto({ db: app.db, dataDir: app.dir, kitId, bytes: JPG, kind: 'auto', sourceUrl: 'https://gundam.fandom.com/wiki/Exia' });
    assert.deepEqual(providersToTry(base).map((p) => p.name), ['box']);
    assert.deepEqual(await fetchPhotoForKit(base), { found: true });
    assert.deepEqual(calls, [['box', 'MG']]); // le wiki n'est pas rappelé
    assert.equal(photoRow(app.db, kitId).source_url, 'https://www.hlj.com/p');
    // déjà la meilleure source : plus aucun appel
    calls = [];
    assert.deepEqual(await fetchPhotoForKit(base), { found: false });
    assert.deepEqual(calls, []);
    // upload : jamais écrasé, aucun provider appelé
    savePhoto({ db: app.db, dataDir: app.dir, kitId, bytes: JPG, kind: 'user' });
    assert.deepEqual(providersToTry(base), []);
    assert.deepEqual(await fetchPhotoForKit({ ...base, providers: [wiki, box] }), { found: false });
    assert.deepEqual(calls, []);
    assert.equal(photoRow(app.db, kitId).kind, 'user');
  } finally {
    await app.close();
  }
});

test('hlj : URL d\'image ou de fiche http, hors hlj.com ou avec port -> refusée (SSRF)', async () => {
  const page = (img, href = '/mg-sinanju-ban981597') =>
    `<div class="search-widget-block"><a href="${href}"><img src="${img}"></a><p class="product-item-name"><a href="${href}">1/100 MG Sinanju</a></p></div>`;
  const find = (html) => hljProvider({ minIntervalMs: 0, fetch: async () => new Response(html, { status: 200 }) }).find('Sinanju', 'MG Sinanju');
  assert.equal((await find(page('https://www.hlj.com/a.jpg'))).imageUrl, 'https://www.hlj.com/a.jpg');
  assert.equal((await find(page('https://cdn.hlj.com/a.jpg'))).imageUrl, 'https://cdn.hlj.com/a.jpg');
  for (const bad of ['http://www.hlj.com/a.jpg', 'http://internal-host/a.jpg', 'https://evilhlj.com/a.jpg', 'https://hlj.com.evil.net/a.jpg', 'https://www.hlj.com:8443/a.jpg', 'https://169.254.169.254/a.jpg']) {
    assert.equal(await find(page(bad)), null, bad);
  }
  assert.equal(await find(page('https://www.hlj.com/a.jpg', 'https://evil.example/mg-sinanju-ban981597')), null);
});

test('rang : evilhlj.com n\'est pas hlj ; source_url mal formée -> inconnue, sans exception ni refresh bloqué', async () => {
  const app = await photoApp({ providers: [{ name: 'box', host: 'hlj.com', find: async () => null }, { name: 'wiki', host: 'gundam.fandom.com', find: async () => null }] });
  try {
    const kitId = addKit(app.db, 1, 'MG 1/100 Exia');
    const rows = (url) => app.db.prepare('INSERT OR REPLACE INTO photos (kit_id, kind, file, source_url, updated_at) VALUES (?, ?, ?, ?, ?)').run(kitId, 'auto', 'x.png', url, 'x');
    const names = () => providersToTry({ db: app.db, kitId, providers: app.providers ?? [{ name: 'box', host: 'hlj.com' }, { name: 'wiki', host: 'gundam.fandom.com' }] }).map((p) => p.name);
    rows('https://evilhlj.com/p');
    assert.deepEqual(names(), []); // inconnue : jamais remplacée
    rows('https://www.hlj.com/p');
    assert.deepEqual(names(), []); // déjà la meilleure
    rows('https://gundam.fandom.com/wiki/X');
    assert.deepEqual(names(), ['box']);
    rows('pas une url');
    assert.deepEqual(names(), []);
    rows(null);
    assert.deepEqual(names(), []);
    rows('pas une url');
    assert.equal((await app.req('POST', '/api/photos/refresh')).status, 202);
    let st;
    do {
      await new Promise((r) => setTimeout(r, 5));
      st = await (await app.req('GET', '/api/photos/status')).json();
    } while (st.running);
    assert.equal(st.last.error, undefined);
    assert.equal((await app.req('POST', '/api/photos/refresh')).status, 202); // pas de 409 bloqué
  } finally {
    await app.close();
  }
});

// Kit created like the real pipeline: cleanTitle splits the raw title into title + grade columns.
const addCleanKit = (db, n, raw) => {
  const c = cleanTitle(raw);
  return Number(
    db
      .prepare('INSERT INTO kits (source_id, raw_title, title, grade, scale, series) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`CLEAN${n}`, raw, c.title, c.grade, c.scale, c.series).lastInsertRowid,
  );
};

test('chaîne réelle : kit passé par cleanTitle (titre sans grade, grade en colonne) -> boîte HLJ du bon grade, sinon rien', async () => {
  const app = await photoApp();
  try {
    const page = hljPage([['1/100 MG Sinanju', 'mg-sinanju-ban981597']]);
    const fetchStub = async (url) => (String(url).includes('/search/') ? new Response(page, { status: 200 }) : new Response(PNG, { status: 200 }));
    const run = (kitId) => fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: [hljProvider({ minIntervalMs: 0, fetch: fetchStub })], fetch: fetchStub });

    const mg = addCleanKit(app.db, 1, '1/100 MG SINANJU');
    assert.deepEqual({ ...app.db.prepare('SELECT title, grade FROM kits WHERE id = ?').get(mg) }, { title: 'Sinanju', grade: 'MG' });
    assert.deepEqual(await run(mg), { found: true });
    assert.equal(photoRow(app.db, mg).source_url, 'https://www.hlj.com/mg-sinanju-ban981597');

    const rg = addCleanKit(app.db, 2, '1/144 RG SINANJU'); // le grade de la fiche doit être celui du kit
    assert.deepEqual(await run(rg), { found: false });
    assert.equal(photoRow(app.db, rg), undefined);

    const pg = addCleanKit(app.db, 3, '1/60 PG SINANJU'); // grade sans fiche correspondante
    assert.deepEqual(await run(pg), { found: false });

    // grade inconnu (null) : on ne devine pas, aucune requête vers HLJ
    const none = addCleanKit(app.db, 4, 'SINANJU');
    assert.equal(app.db.prepare('SELECT grade FROM kits WHERE id = ?').get(none).grade, null);
    let asked = 0;
    const counting = async (u) => (asked++, fetchStub(u));
    assert.deepEqual(await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId: none, providers: [hljProvider({ minIntervalMs: 0, fetch: counting })], fetch: counting }), { found: false });
    assert.equal(asked, 0);
  } finally {
    await app.close();
  }
});

// --- Issue #8: HLJ seule + diagnostic des refus ---
test('hlj : une raison de refus par cas, sans changer la correspondance', async () => {
  const why = async (fetch, name = 'Sinanju', grade = 'MG') => {
    let r;
    const hit = await hljProvider({ minIntervalMs: 0, fetch }).find(name, grade, (x) => (r = x));
    return [hit, r];
  };
  const page = (html) => async () => new Response(html, { status: 200 });
  assert.deepEqual(await why(page('<html></html>')), [null, REASONS.noResult]);
  assert.deepEqual(await why(page(hljPage([['1/100 MG Sinanju', 'mg-sinanju-ban981597']])), 'Sinanju', 'XX'), [null, REASONS.grade]);
  // #12 : un mot en trop hors liste = fiche douteuse (plus un refus) ; un mot du kit manquant reste refusé (ligne suivante)
  assert.equal((await why(page(hljPage([['1/100 MG Sinanju Stein', 'mg-sinanju-stein-ban1']]))))[0].uncertain, true);
  assert.deepEqual(await why(page(hljPage([['1/100 MG Exia', 'mg-exia-ban1']]))), [null, REASONS.noCandidate]);
  assert.deepEqual(await why(page(hljPage([['1/100 MG Sinanju', 'mg-sinanju-tee-cspr1']]))), [null, REASONS.badPage]);
  assert.deepEqual(await why(page('<div class="search-widget-block"><p class="product-item-name"><a href="/mg-s-ban1">1/100 MG Sinanju</a></p></div>')), [null, REASONS.badPage]);
  for (const f of [async () => new Response('x', { status: 403 }), async () => { throw new Error('timeout'); }]) {
    assert.deepEqual(await why(f), [null, REASONS.source]);
  }
  assert.ok((await why(page(hljPage([['1/100 MG Sinanju', 'mg-sinanju-ban981597']]))))[0]); // hit : pas de raison
});

test('photos : chaîne par défaut = HLJ puis boutiques Shopify ; décompte par source dans le statut ; upload intact ; photo wiki remplacée par HLJ', async () => {
  const hlj = (items) => async (url) => String(url).includes('hlj.com/search')
    ? new Response(hljPage(items), { status: 200 })
    : String(url).includes('suggest.json') || String(url).includes('api.php')
      ? Response.json({ resources: { results: { products: [] } } }) // les quatre boutiques Shopify (sans résultat)
      : new Response(PNG, { status: 200 });
  const app = await photoApp({ fetch: hlj([['1/100 MG Exia', 'mg-exia-ban1']]) });
  try {
    const exia = addCleanKit(app.db, 1, 'MG 1/100 Exia');
    const zaku = addCleanKit(app.db, 2, 'MG 1/100 Zaku');
    const up = addCleanKit(app.db, 3, 'MG 1/100 Sazabi');
    const wiki = addCleanKit(app.db, 4, 'MG 1/100 Exia');
    savePhoto({ db: app.db, dataDir: app.dir, kitId: up, bytes: JPG, kind: 'user' });
    savePhoto({ db: app.db, dataDir: app.dir, kitId: wiki, bytes: JPG, kind: 'auto', sourceUrl: 'https://gundam.fandom.com/wiki/Exia' });
    assert.equal((await app.req('POST', '/api/photos/refresh')).status, 202);
    let st;
    do {
      await new Promise((r) => setTimeout(r, 5));
      st = await (await app.req('GET', '/api/photos/status')).json();
    } while (st.running);
    assert.deepEqual(Object.keys(st.last.sources).sort(), ['aztoyhobby', 'gundamplanet', 'gundamwiki', 'hlj-box', 'lascalemodel', 'usagundamstore']);
    assert.deepEqual(st.last.sources['hlj-box'], { found: 2, uncertain: 0, errors: 0, refused: { [REASONS.noCandidate]: 1 } }); // #12 : champ uncertain ajouté
    assert.equal(photoRow(app.db, exia).source_url, 'https://www.hlj.com/mg-exia-ban1');
    assert.equal(photoRow(app.db, wiki).source_url, 'https://www.hlj.com/mg-exia-ban1'); // wiki remplacée
    assert.equal(photoRow(app.db, up).kind, 'user'); // upload intact
    assert.equal(photoRow(app.db, zaku), undefined);
  } finally {
    await app.close();
  }
});

test('photos : une photo wiki déjà stockée reste si HLJ ne trouve rien', async () => {
  const app = await photoApp();
  try {
    const kitId = addKit(app.db, 1, 'MG 1/100 Exia');
    savePhoto({ db: app.db, dataDir: app.dir, kitId, bytes: JPG, kind: 'auto', sourceUrl: 'https://gundam.fandom.com/wiki/Exia' });
    const miss = { name: 'hlj-box', host: 'hlj.com', find: async () => null }, wiki = { name: 'wiki', host: 'gundam.fandom.com', find: async () => null };
    const stats = {};
    assert.deepEqual(await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: [miss, wiki], fetch: okFetch(PNG), stats }), { found: false });
    assert.equal(photoRow(app.db, kitId).source_url, 'https://gundam.fandom.com/wiki/Exia');
    assert.deepEqual(stats['hlj-box'].refused, { [REASONS.noResult]: 1 });
  } finally {
    await app.close();
  }
});

// --- Issue #10 : numéros de catalogue retirés de la recherche HLJ ---
test('stripCatalogueNumbers : retire (nnnn) et le numéro de tête, jamais un nombre faisant partie du nom', () => {
  const cases = [
    ['Qubeley Papillon (011)', 'Qubeley Papillon'],
    ['Hambrabi (15)', 'Hambrabi'],
    ['Gustav Karl Type 00 (264)', 'Gustav Karl Type 00'],
    ['Zaku Gq (010)', 'Zaku Gq'],
    ['013 Exia Dark Matter', 'Exia Dark Matter'],
    ['157 Messala', 'Messala'],
    ['004 Graze Custom', 'Graze Custom'],
    ['010 Amida Hyakuren', 'Amida Hyakuren'],
    ['051 Seravee Gundam Gnhw/B', 'Seravee Gundam Gnhw/B'],
    ['50 Arios Gundam Gnhw/M', 'Arios Gundam Gnhw/M'],
    ['01 Exia', 'Exia'],
    ['Light-Type (06)', 'Light-Type'],
    // le nombre fait partie du nom
    ['00 Raiser', '00 Raiser'],
    ['0 Gundam', '0 Gundam'],
    ['000 Gundam', '000 Gundam'],
    ['Gundam 00', 'Gundam 00'],
    ['Gustav Karl Type 00', 'Gustav Karl Type 00'],
    ['Zaku II (Re-Cover)', 'Zaku II (Re-Cover)'], // groupe avec du texte
    ['Exia (12345)', 'Exia (12345)'], // plus de 4 chiffres
    ['1000 Exia', '1000 Exia'], // plus de 3 chiffres en tête
    ['RX-78-2', 'RX-78-2'],
    // lignes 30MM / 30MF / 30MS : « 30 » fait partie du nom (titres du vrai catalogue)
    ['30 Mm CC-2000 Orbiter Nightfall', '30 Mm CC-2000 Orbiter Nightfall'],
    ['30 Minutes Mission 30MM XEXM-000 Xenovalt', '30 Minutes Mission 30MM XEXM-000 Xenovalt'],
    ['30 Minutes Sisters Mano Sakuragi', '30 Minutes Sisters Mano Sakuragi'],
    ['30 Minutes Sisters () Option Body Parts Beyond The Blue Sky 1 Color B', '30 Minutes Sisters () Option Body Parts Beyond The Blue Sky 1 Color B'],
    ['30 Minutes Sisters (14) Rishetta (Freesia Wear)', '30 Minutes Sisters Rishetta (Freesia Wear)'], // seul le (14) part
    ['30 Minutes Fantasy 30MF Rosan Wizard', '30 Minutes Fantasy 30MF Rosan Wizard'],
    ['30MM (07) Open Faith Armored Core VI', '30MM Open Faith Armored Core VI'],
    ['21 00 Qan(T)', '00 Qan(T)'], // le numéro part, « 00 » (nom de série) reste
    ['30 Gundam', 'Gundam'], // seule la ligne « 30 Minutes/Mm » est protégée
    // titre uniquement numérique ou qui deviendrait vide : nom d'origine
    ['013', '013'],
    ['(011)', '(011)'],
    ['013 (011)', '013'], // le numéro de tête n'a plus de mot derrière lui : conservé
  ];
  for (const [raw, want] of cases) assert.equal(stripCatalogueNumbers(raw), want, raw);
  assert.equal(searchName('013 Exia Dark Matter'), 'Exia Dark Matter');
  assert.equal(searchName('Hambrabi (15)'), 'Hambrabi');
});

test('chaîne réelle #10 : kits avec numéro (cleanTitle -> fetchPhotoForKit -> hljProvider) trouvés ; garde-fous de faux positif', async () => {
  const app = await photoApp();
  try {
    // HLJ simulé : ne répond au mot-clé exact que si la requête n'a plus de numéro de catalogue.
    const pages = {
      'Qubeley Papillon': [['1/144 HGUC Qubeley Papillon', 'hguc-qubeley-papillon-ban1']],
      'Exia Dark Matter': [['1/144 HG Gundam Exia Dark Matter', 'hg-exia-dm-ban2']],
      Hambrabi: [['1/144 HG Hambrabi', 'hg-hambrabi-ban3']],
      Exia: [['1/144 HG Gundam Exia', 'hg-exia-ban4'], ['1/100 MG Gundam Exia', 'mg-exia-ban5']],
      'Gustav Karl Type 00': [['1/100 MG Gustav Karl Type 00', 'mg-gk-ban6']],
      'Seravee Gundam Gnhw/B': [['1/144 HG Seravee Gundam Gnhw/B', 'hg-seravee-ban7']],
      '00 Raiser': [['1/144 HG 00 Raiser', 'hg-00raiser-ban8']],
      'Zaku Gq': [['1/144 HG Zaku Gq', 'hg-zaku-gq-ban11']],
      Messala: [['1/144 HG Messala', 'hg-messala-ban12']],
      'Graze Custom': [['1/144 HG Graze Custom', 'hg-graze-custom-ban13']],
      'Amida Hyakuren': [['1/144 HG Amida Hyakuren', 'hg-amida-ban14']],
    };
    const asked = [];
    const fetchStub = async (url) => {
      if (!String(url).includes('/search/')) return new Response(PNG, { status: 200 });
      const q = new URL(url).searchParams.get('q');
      asked.push(q);
      return new Response(pages[q] ? hljPage(pages[q]) : '<div class="search-widget-blocks"></div>', { status: 200 });
    };
    const run = (id) => fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId: id, providers: [hljProvider({ minIntervalMs: 0, fetch: fetchStub })], fetch: fetchStub });
    const kit = (n, raw) => addCleanKit(app.db, 100 + n, raw);
    const found = async (n, raw, page) => {
      const id = kit(n, raw);
      assert.deepEqual(await run(id), { found: true }, raw);
      assert.equal(photoRow(app.db, id).source_url, `https://www.hlj.com/${page}`, raw);
      return id;
    };

    const q = await found(1, '1/144 HGUC QUBELEY PAPILLON (011)', 'hguc-qubeley-papillon-ban1'); // entre parenthèses
    await found(2, '1/144 HG 013 EXIA DARK MATTER', 'hg-exia-dm-ban2'); // numéro de tête
    await found(3, '1/144 HG HAMBRABI (15)', 'hg-hambrabi-ban3');
    await found(4, '1/144 HG 01 EXIA', 'hg-exia-ban4'); // déjà trouvé avant : doit le rester
    await found(5, '1/100 MG GUSTAV KARL TYPE 00 (264)', 'mg-gk-ban6'); // "Type 00" conservé
    await found(6, '1/144 HG 051 SERAVEE GUNDAM GNHW/B', 'hg-seravee-ban7');
    await found(7, '1/144 HG 00 RAISER', 'hg-00raiser-ban8'); // zéro = nom, pas un numéro
    await found(8, '1/144 HG ZAKU GQ (010)', 'hg-zaku-gq-ban11');
    await found(9, '1/144 HG 157 MESSALA', 'hg-messala-ban12');
    await found(10, '1/144 HG 004 GRAZE CUSTOM', 'hg-graze-custom-ban13');
    await found(11, '1/144 HG 010 AMIDA HYAKUREN', 'hg-amida-ban14');
    assert.deepEqual(asked, ['Qubeley Papillon', 'Exia Dark Matter', 'Hambrabi', 'Exia', 'Gustav Karl Type 00', 'Seravee Gundam Gnhw/B', '00 Raiser', 'Zaku Gq', 'Messala', 'Graze Custom', 'Amida Hyakuren']);
    // kits.title n'est pas modifié
    assert.equal(app.db.prepare('SELECT title FROM kits WHERE id = ?').get(q).title, 'Qubeley Papillon (011)');

    // faux positifs : mauvais grade (RG alors que la fiche est HG), mauvais kit, mot en trop
    const rg = kit(20, '1/144 RG HAMBRABI (15)');
    assert.deepEqual(await run(rg), { found: false });
    assert.equal(photoRow(app.db, rg), undefined);
    // #12 : la variante (mots en trop) est enregistrée comme douteuse ; l'autre kit (Zaku II) reste refusé
    pages.Hambrabi = [['1/144 HG Hambrabi Custom Variant', 'hg-hambrabi-cv-ban9'], ['1/144 HG Zaku II', 'hg-zaku-ban10']];
    const other = kit(21, '1/144 HG HAMBRABI (16)');
    assert.deepEqual(await run(other), { found: true });
    assert.deepEqual([photoRow(app.db, other).source_url, photoRow(app.db, other).uncertain], ['https://www.hlj.com/hg-hambrabi-cv-ban9', 1]);
    pages.Hambrabi = [['1/144 HG Zaku II', 'hg-zaku-ban10']];
    const wrong = kit(22, '1/144 HG HAMBRABI (17)');
    assert.deepEqual(await run(wrong), { found: false });
    assert.equal(photoRow(app.db, wrong), undefined);
  } finally {
    await app.close();
  }
});

// --- Issue #12: correspondance sûre / douteuse, mots d'une lettre ---
// Real kit rows (cleanTitle) + simulated HLJ search page + fetchPhotoForKit; logs captured.
async function hljJob(app, pages, kits, { providers, stats = {} } = {}) {
  const fetchStub = async (url) => (String(url).includes('/search/') ? new Response(hljPage(pages), { status: 200 }) : new Response(PNG, { status: 200 }));
  const prov = providers ?? [hljProvider({ minIntervalMs: 0, fetch: fetchStub })];
  const logs = [];
  const orig = console.error;
  console.error = (m) => logs.push(String(m));
  try {
    const out = [];
    for (const kitId of kits) out.push(await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: prov, fetch: fetchStub, stats, force: true }));
    return { out, logs, stats };
  } finally {
    console.error = orig;
  }
}
const AERIAL = [['1/144 HG Gundam Aerial Permet Score Six', 'hg-aerial-pss-ban1']];

test('#12 douteuse : mots en trop hors liste -> photo enregistrée uncertain = 1, journal et décompte', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/144 HG GUNDAM AERIAL');
    const { out, logs, stats } = await hljJob(app, AERIAL, [kitId]);
    assert.deepEqual(out, [{ found: true }]);
    const row = photoRow(app.db, kitId);
    assert.deepEqual([row.kind, row.uncertain, row.source_url], ['auto', 1, 'https://www.hlj.com/hg-aerial-pss-ban1']);
    assert.equal(stats['hlj-box'].found, 1);
    assert.equal(stats['hlj-box'].uncertain, 1);
    assert.deepEqual(logs, [`[photos] kit ${kitId} hlj-box: uncertain (hg-aerial-pss-ban1; extra words: permet score six)`]);
  } finally {
    await app.close();
  }
});

test('#12 grade obligatoire : mauvais grade, grade absent ou mot du kit manquant -> refusé même avec les autres mots', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/144 RG GUNDAM AERIAL');
    const { out, stats } = await hljJob(app, AERIAL, [kitId]);
    assert.deepEqual(out, [{ found: false }]);
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.equal(stats['hlj-box'].uncertain, 0);
    const none = addCleanKit(app.db, 2, 'AERIAL'); // sans grade et un seul mot : aucune requête (2 mots et plus acceptés, à vérifier)
    assert.deepEqual((await hljJob(app, AERIAL, [none])).out, [{ found: false }]);
    const missing = addCleanKit(app.db, 3, '1/144 HG REBUILD AERIAL'); // mot du kit absent de la fiche, kit de 2 mots (3 mots = douteux)
    assert.deepEqual((await hljJob(app, AERIAL, [missing])).out, [{ found: false }]);
  } finally {
    await app.close();
  }
});

test('#12 égalité entre deux fiches douteuses différentes -> refus avec ligne refused ; moins de mots en trop gagne', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/144 HG GUNDAM AERIAL');
    const tie = [...AERIAL, ['1/144 HG Gundam Aerial Rebuild Edition Six', 'hg-aerial-re-ban2']]; // 3 mots en trop chacune
    const { out, logs, stats } = await hljJob(app, tie, [kitId]);
    assert.deepEqual(out, [{ found: false }]);
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.deepEqual(stats['hlj-box'].refused, { [REASONS.ambiguous]: 1 });
    assert.deepEqual(logs, [`[photos] kit ${kitId} hlj-box: refused (${REASONS.ambiguous})`]);
    // même fiche listée deux fois : pas une égalité
    assert.deepEqual((await hljJob(app, [...AERIAL, ...AERIAL], [kitId])).out, [{ found: true }]);
    app.db.prepare('DELETE FROM photos').run();
    // une fiche avec moins de mots en trop l'emporte
    const closer = [...tie, ['1/144 HG Gundam Aerial Rebuild', 'hg-aerial-rb-ban3']];
    assert.deepEqual((await hljJob(app, closer, [kitId])).out, [{ found: true }]);
    assert.equal(photoRow(app.db, kitId).source_url, 'https://www.hlj.com/hg-aerial-rb-ban3');
  } finally {
    await app.close();
  }
});

test('#12 la sûre l\'emporte sur la douteuse dans la même liste, non marquée', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/144 HG GUNDAM AERIAL');
    const { stats } = await hljJob(app, [...AERIAL, ['1/144 HG Gundam Aerial', 'hg-aerial-ban4']], [kitId]);
    const row = photoRow(app.db, kitId);
    assert.deepEqual([row.source_url, row.uncertain], ['https://www.hlj.com/hg-aerial-ban4', 0]);
    assert.equal(stats['hlj-box'].uncertain, 0);
  } finally {
    await app.close();
  }
});

test('#12 mots d\'une lettre obligatoires : "V Gundam" refuse "1.5 Gundam", trouve une vraie fiche ; V2 et lettres de code intacts', async () => {
  const app = await photoApp();
  try {
    const v = addCleanKit(app.db, 1, '1/144 HG 188 V GUNDAM');
    assert.equal(searchName(app.db.prepare('SELECT title FROM kits WHERE id = ?').get(v).title), 'V Gundam');
    const wrong = [['1/144 HG 1.5 Gundam', 'hg-15-gundam-ban1']];
    assert.deepEqual((await hljJob(app, wrong, [v])).out, [{ found: false }]); // ni sûre ni douteuse : "V" manque
    assert.equal(photoRow(app.db, v), undefined);
    assert.deepEqual((await hljJob(app, [...wrong, ['1/144 HG V Gundam', 'hg-v-gundam-ban2']], [v])).out, [{ found: true }]);
    assert.deepEqual([photoRow(app.db, v).source_url, photoRow(app.db, v).uncertain], ['https://www.hlj.com/hg-v-gundam-ban2', 0]);
    // noms et codes avec lettres seules, comme dans le vrai catalogue
    let n = 10;
    for (const [raw, page, slug] of [
      ['1/144 HG V2 ASSAULT BUSTER GUNDAM', '1/144 HG V2 Assault Buster Gundam', 'hg-v2-ban3'],
      ['1/144 HG 044 ZAKU I BLACK TRISTARS', '1/144 HG Zaku I Black Tristars', 'hg-zaku1-ban4'],
      ['1/100 MG RGM-79(G) GM', '1/100 MG RGM-79(G) GM', 'mg-gm-ban5'],
    ]) {
      const id = addCleanKit(app.db, n++, raw);
      assert.deepEqual((await hljJob(app, [[page, slug]], [id])).out, [{ found: true }], raw);
      assert.equal(photoRow(app.db, id).uncertain, 0, raw);
    }
    const z = addCleanKit(app.db, n++, '1/144 HG 044 ZAKU I BLACK TRISTARS');
    assert.deepEqual((await hljJob(app, [['1/144 HG Zaku II Black Tristars', 'hg-zaku2-ban6']], [z])).out, [{ found: false }]); // "I" != "II"
  } finally {
    await app.close();
  }
});

test('#12 remplacement : douteuse ne remplace jamais ; sûre remplace "à vérifier" ; vérifiée et upload intactes', async () => {
  const app = await photoApp();
  try {
    const SURE = [['1/144 HG Gundam Aerial', 'hg-aerial-ban4']];
    const fetchStub = async (url) => (String(url).includes('/search/') ? new Response(hljPage(SURE), { status: 200 }) : new Response(PNG, { status: 200 }));
    const hlj = hljProvider({ minIntervalMs: 0, fetch: async () => new Response('', { status: 200 }) });
    const wiki = { name: 'wiki', host: 'gundam.fandom.com', find: async () => null };
    const seed = (n, { kind = 'auto', url = 'https://www.hlj.com/old-ban0', uncertain = false } = {}) => {
      const id = addCleanKit(app.db, n, '1/144 HG GUNDAM AERIAL');
      savePhoto({ db: app.db, dataDir: app.dir, kitId: id, bytes: JPG, kind, sourceUrl: url, uncertain });
      return id;
    };
    const run = (id, pages, providers) => hljJob(app, pages, [id], { providers });

    // photo "à vérifier" : réinterrogée ; une autre douteuse ne la remplace pas (ni ne compte) ; une sûre la remplace
    const u = seed(1, { uncertain: true });
    assert.deepEqual(providersToTry({ db: app.db, kitId: u, providers: [hlj, wiki] }).map((p) => p.name), ['hlj-box', 'wiki']); // P1 : une photo à vérifier est proposée à toutes les sources, aussi les moins bien classées
    const again = await run(u, AERIAL);
    assert.deepEqual(again.out, [{ found: false }]);
    assert.deepEqual([photoRow(app.db, u).source_url, photoRow(app.db, u).uncertain], ['https://www.hlj.com/old-ban0', 1]);
    assert.equal(again.stats['hlj-box'].uncertain, 0);
    assert.deepEqual((await run(u, SURE)).out, [{ found: true }]);
    assert.deepEqual([photoRow(app.db, u).source_url, photoRow(app.db, u).uncertain], ['https://www.hlj.com/hg-aerial-ban4', 0]);

    // photo vérifiée (uncertain = 0, meilleure source) : plus réinterrogée
    const verified = seed(2);
    assert.deepEqual(providersToTry({ db: app.db, kitId: verified, providers: [hlj, wiki] }), []);
    assert.deepEqual((await run(verified, SURE)).out, [{ found: false }]);
    assert.equal(photoRow(app.db, verified).source_url, 'https://www.hlj.com/old-ban0');

    // photo wiki non marquée : une douteuse HLJ ne la remplace pas, une sûre oui (règle de rang inchangée)
    const wikiPhoto = seed(3, { url: 'https://gundam.fandom.com/wiki/Aerial' });
    const douteuse = hljProvider({ minIntervalMs: 0, fetch: async (url) => (String(url).includes('/search/') ? new Response(hljPage(AERIAL), { status: 200 }) : new Response(PNG, { status: 200 })) });
    assert.deepEqual((await run(wikiPhoto, AERIAL, [douteuse, wiki])).out, [{ found: false }]);
    assert.equal(photoRow(app.db, wikiPhoto).source_url, 'https://gundam.fandom.com/wiki/Aerial');
    assert.deepEqual((await run(wikiPhoto, SURE, [hljProvider({ minIntervalMs: 0, fetch: fetchStub }), wiki])).out, [{ found: true }]);
    assert.equal(photoRow(app.db, wikiPhoto).source_url, 'https://www.hlj.com/hg-aerial-ban4');

    // upload : jamais touché, aucun provider appelé
    const user = seed(4, { kind: 'user' });
    assert.deepEqual(providersToTry({ db: app.db, kitId: user, providers: [hlj, wiki] }), []);
    assert.deepEqual((await run(user, SURE)).out, [{ found: false }]);
    assert.equal(photoRow(app.db, user).kind, 'user');
  } finally {
    await app.close();
  }
});

test('#12 décompte : stats.uncertain = photos douteuses enregistrées (pas les refus)', async () => {
  const app = await photoApp();
  try {
    const stats = {};
    const kits = [addCleanKit(app.db, 1, '1/144 HG GUNDAM AERIAL'), addCleanKit(app.db, 2, '1/144 HG GUNDAM AERIAL (2)'), addCleanKit(app.db, 3, '1/144 RG GUNDAM AERIAL')];
    await hljJob(app, AERIAL, kits, { stats });
    assert.equal(stats['hlj-box'].found, 2);
    assert.equal(stats['hlj-box'].uncertain, 2);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM photos WHERE uncertain = 1').get().n, 2);
  } finally {
    await app.close();
  }
});

// --- Issue #14: requête HLJ assouplie (seulement quand la requête stricte renvoie zéro produit) ---
// Real kit rows (cleanTitle) + HLJ simulé qui répond selon la requête ; les requêtes envoyées sont relevées.
async function relaxJob(app, answer, kits, { stats = {}, minIntervalMs = 0 } = {}) {
  const queries = [];
  const times = [];
  const fetchStub = async (url) => {
    if (!String(url).includes('/search/')) return new Response(PNG, { status: 200 });
    queries.push(new URL(url).searchParams.get('q'));
    times.push(Date.now());
    return new Response(hljPage(answer(queries.at(-1))), { status: 200 });
  };
  const logs = [];
  const orig = console.error;
  console.error = (m) => logs.push(String(m));
  try {
    const out = [];
    for (const kitId of kits) out.push(await fetchPhotoForKit({ db: app.db, dataDir: app.dir, kitId, providers: [hljProvider({ minIntervalMs, fetch: fetchStub })], fetch: fetchStub, stats, force: true }));
    return { out, logs, stats, queries, times };
  } finally {
    console.error = orig;
  }
}
// HLJ simulé : zéro produit pour toute requête sauf la requête assouplie `relaxed`.
const onlyFor = (relaxed, pages) => (q) => (q === relaxed ? pages : []);
const WING_RG = 'BANMK63053 GUNDAM GUNPLA RG 1/144 20 XXXG-01W WING GUNDAM EW';

test('#14 relaxName : retire codes, versions, apostrophe-S, parenthèses, barres ; rien à retirer ou < 2 mots = pas de requête', () => {
  assert.deepEqual(relaxName('XXXG-01W Wing Gundam EW'), { query: 'Wing Gundam EW', dropped: ['XXXG-01W'] });
  assert.deepEqual(relaxName('AMX-004-3 Qubeley Mk-Ii'), { query: 'Qubeley Mk-Ii', dropped: ['AMX-004-3'] });
  assert.deepEqual(relaxName("Graham'S Union Flag Custom"), { query: 'Graham Union Flag Custom', dropped: ["'S"] });
  assert.deepEqual(relaxName('Altron Gundam XXXG-01S2 ( )'), { query: 'Altron Gundam', dropped: ['XXXG-01S2'] });
  assert.deepEqual(relaxName('Gundam Aerial (Gq) Ver. 2.0'), { query: 'Gundam Aerial', dropped: ['Gq', 'Ver.', '2.0'] });
  assert.deepEqual(relaxName('Gundam Ver.2.0 MS-09R/Rick Dom'), { query: 'Gundam Rick Dom', dropped: ['Ver.2.0', 'MS-09R'] });
  assert.equal(relaxName('Sandrock Custom EW'), null); // rien retiré : la même requête ne sert à rien
  assert.equal(relaxName('XXXG-01W Wing'), null); // un seul mot restant
  assert.equal(relaxName('V2 Gundam'), null); // "V2" n'est pas un code (pas de tiret) : conservé
  assert.equal(relaxName('00 Raiser Ver.Ka'), null); // "Ver.Ka" garde son "Ka" (variante)
});

test('#14 zéro produit puis produit : AMX-004-3 Qubeley Mk-Ii (MG) -> uncertain = 1, journal "requête assouplie", stats.relaxed', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/100 MG AMX-004-3 QUBELEY MK-II');
    const { out, logs, stats, queries } = await relaxJob(app, onlyFor('Qubeley Mk-Ii', [['MG AMX-004-3 Qubeley Mk-II', 'mg-qubeley-ban1']]), [kitId]);
    assert.deepEqual(out, [{ found: true }]);
    assert.deepEqual(queries, ['AMX-004-3 Qubeley Mk-Ii', 'Qubeley Mk-Ii']);
    const row = photoRow(app.db, kitId);
    assert.deepEqual([row.kind, row.uncertain, row.source_url], ['auto', 1, 'https://www.hlj.com/mg-qubeley-ban1']);
    assert.equal(stats['hlj-box'].relaxed, 1);
    assert.equal(stats['hlj-box'].uncertain, 1);
    assert.deepEqual(logs, [`[photos] kit ${kitId} hlj-box: uncertain (relaxed query; dropped: AMX-004-3; mg-qubeley-ban1; extra: )`]);
  } finally {
    await app.close();
  }
});

test('#14 mauvais grade au passage assoupli : refusé (grade obligatoire)', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/100 MG AMX-004-3 QUBELEY MK-II');
    const { out, queries, stats } = await relaxJob(app, onlyFor('Qubeley Mk-Ii', [['HG Qubeley Mk-II', 'hg-qubeley-ban2']]), [kitId]);
    assert.deepEqual(out, [{ found: false }]);
    assert.equal(queries.length, 2);
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.equal(stats['hlj-box'].relaxed, undefined);
    assert.deepEqual(stats['hlj-box'].refused, { [REASONS.noCandidate]: 1 });
  } finally {
    await app.close();
  }
});

test('#14 cas réels : XXXG-01W Wing Gundam EW (RG), Altron Gundam XXXG-01S2 ( ), Graham\'S Union Flag Custom trouvés par la requête assouplie', async () => {
  const app = await photoApp();
  try {
    const wing = addCleanKit(app.db, 1, WING_RG);
    const altron = addCleanKit(app.db, 2, '1/144 HGAF ( ) ALTRON GUNDAM XXXG-01S2');
    const graham = addCleanKit(app.db, 3, "1/144 HGOO (07) GRAHAM'S UNION FLAG CUSTOM");
    const answer = (q) => ({
      'Wing Gundam EW': [['RG XXXG-01W Wing Gundam EW', 'rg-wing-ban3']],
      'Altron Gundam': [['HG XXXG-01S2 Altron Gundam', 'hg-altron-ban4']],
      'Graham Union Flag Custom': [["HG Graham's Union Flag Custom", 'hg-graham-ban5']],
    })[q] ?? [];
    const { out, queries, stats, logs } = await relaxJob(app, answer, [wing, altron, graham]);
    assert.deepEqual(out, [{ found: true }, { found: true }, { found: true }]);
    assert.deepEqual(queries, [
      'XXXG-01W Wing Gundam EW', 'Wing Gundam EW',
      'Altron Gundam XXXG-01S2 ( )', 'Altron Gundam',
      "Graham'S Union Flag Custom", 'Graham Union Flag Custom',
    ]);
    assert.deepEqual([wing, altron, graham].map((id) => photoRow(app.db, id).uncertain), [1, 1, 1]);
    assert.equal(stats['hlj-box'].relaxed, 3);
    assert.ok(logs[2].includes("dropped: 'S;") && !logs.some((l) => l.includes('http')));
  } finally {
    await app.close();
  }
});

test('#14 Sandrock Custom EW : rien à retirer -> pas de seconde requête ; produits non correspondants -> pas de seconde requête', async () => {
  const app = await photoApp();
  try {
    const sandrock = addCleanKit(app.db, 1, '1/144 HG SANDROCK CUSTOM EW');
    let r = await relaxJob(app, () => [], [sandrock]);
    assert.deepEqual(r.out, [{ found: false }]);
    assert.deepEqual(r.queries, ['Sandrock Custom EW']);
    // des produits reviennent mais aucun ne correspond : jamais de requête assouplie
    const wing = addCleanKit(app.db, 2, WING_RG);
    r = await relaxJob(app, () => [['RG Gundam Exia', 'rg-exia-ban6']], [wing]);
    assert.deepEqual(r.out, [{ found: false }]);
    assert.deepEqual(r.queries, ['XXXG-01W Wing Gundam EW']);
    assert.deepEqual(r.stats['hlj-box'].refused, { [REASONS.noCandidate]: 1 });
  } finally {
    await app.close();
  }
});

test('#14 moins de 2 mots après nettoyage -> pas de seconde requête', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/144 HG XXXG-01W WING');
    const r = await relaxJob(app, () => [], [kitId]);
    assert.deepEqual(r.out, [{ found: false }]);
    assert.deepEqual(r.queries, ['XXXG-01W Wing']);
  } finally {
    await app.close();
  }
});

test('#14 égalité entre deux fiches différentes au passage assoupli : refus ; la sûre est préférée mais reste "à vérifier"', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, WING_RG);
    const tie = [['RG Wing Gundam EW Zero', 'rg-wing-a-ban8'], ['RG Wing Gundam EW Custom', 'rg-wing-b-ban9']];
    let r = await relaxJob(app, onlyFor('Wing Gundam EW', tie), [kitId]);
    assert.deepEqual(r.out, [{ found: false }]);
    assert.deepEqual(r.stats['hlj-box'].refused, { [REASONS.ambiguous]: 1 });
    r = await relaxJob(app, onlyFor('Wing Gundam EW', [...tie, ['RG Wing Gundam EW', 'rg-wing-c-ban10']]), [kitId]);
    assert.deepEqual(r.out, [{ found: true }]);
    assert.deepEqual([photoRow(app.db, kitId).source_url, photoRow(app.db, kitId).uncertain], ['https://www.hlj.com/rg-wing-c-ban10', 1]);
  } finally {
    await app.close();
  }
});

test('#14 un résultat assoupli ne remplace jamais une photo existante ; l\'intervalle est respecté entre les deux requêtes', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, WING_RG);
    savePhoto({ db: app.db, dataDir: app.dir, kitId, bytes: JPG, kind: 'auto', sourceUrl: 'https://www.hlj.com/old-ban0', uncertain: true });
    const pages = onlyFor('Wing Gundam EW', [['RG XXXG-01W Wing Gundam EW', 'rg-wing-ban3']]);
    const r = await relaxJob(app, pages, [kitId], { minIntervalMs: 60 });
    assert.deepEqual(r.out, [{ found: false }]);
    assert.equal(photoRow(app.db, kitId).source_url, 'https://www.hlj.com/old-ban0');
    assert.equal(r.stats['hlj-box'].relaxed, undefined);
    assert.equal(r.queries.length, 2);
    assert.ok(r.times[1] - r.times[0] >= 55, `intervalle ${r.times[1] - r.times[0]} ms`);
  } finally {
    await app.close();
  }
});

test('#14 passage assoupli : deux fiches sûres différentes au même nombre de mots = refus ; même fiche deux fois ou moins de mots = gagne', async () => {
  const app = await photoApp();
  try {
    const kitId = addCleanKit(app.db, 1, '1/144 HG MS-06S ZAKU II');
    const f = ['HG MS-06F Zaku II', 'hg-zaku-f-ban11'];
    const j = ['HG MS-06J Zaku II', 'hg-zaku-j-ban12'];
    let r = await relaxJob(app, onlyFor('Zaku II', [f, j]), [kitId]);
    assert.deepEqual(r.queries, ['MS-06S Zaku II', 'Zaku II']);
    assert.deepEqual(r.out, [{ found: false }]);
    assert.equal(photoRow(app.db, kitId), undefined);
    assert.deepEqual(r.stats['hlj-box'].refused, { [REASONS.ambiguous]: 1 });
    assert.deepEqual(r.logs, [`[photos] kit ${kitId} hlj-box: refused (${REASONS.ambiguous})`]);
    // la même fiche listée deux fois n'est pas une égalité
    r = await relaxJob(app, onlyFor('Zaku II', [f, f]), [kitId]);
    assert.deepEqual(r.out, [{ found: true }]);
    assert.deepEqual([photoRow(app.db, kitId).source_url, photoRow(app.db, kitId).uncertain], ['https://www.hlj.com/hg-zaku-f-ban11', 1]);
    assert.equal(r.stats['hlj-box'].relaxed, 1);
    // deux fiches sûres de longueurs différentes : celle qui a le moins de mots gagne (toujours "à vérifier")
    app.db.prepare('DELETE FROM photos').run();
    r = await relaxJob(app, onlyFor('Zaku II', [['HG MS-06J Zaku II Gundam The', 'hg-zaku-k-ban13'], j]), [kitId]);
    assert.deepEqual(r.out, [{ found: true }]);
    assert.deepEqual([photoRow(app.db, kitId).source_url, photoRow(app.db, kitId).uncertain], ['https://www.hlj.com/hg-zaku-j-ban12', 1]);
  } finally {
    await app.close();
  }
});
