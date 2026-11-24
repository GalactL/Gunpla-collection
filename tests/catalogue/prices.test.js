import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import priceRoutes from '../../src/catalogue/prices-routes.js';
import { DEFAULT_DELAY_MS, fetchOffers, parseOffers } from '../../src/catalogue/prices.js';
import { politeGate } from '../../src/photos/provider.js';

const fx = (name) => readFileSync(new URL(`../fixtures/canalbd/${name}`, import.meta.url), 'utf8');
const MAIN = fx('offers-main.html'); // main offer 12,90 EUR
const MAIN_SELLER = fx('offers-main-and-seller.html'); // main 12,90 + cheaper seller card 11,50
const SELLER_ONLY = fx('offers-seller-only.html'); // "Indisponible" + one seller card 69,90
const SELLER_MULTI = fx('offers-seller-multi.html'); // three seller cards: 79,90 / 69,90 / 72,50
const UNAVAILABLE = fx('offers-unavailable.html'); // no price at all

const shapeErr = { code: 'shape' };

test('parseOffers: prix principal => canalbd, centimes entiers', () => {
  assert.deepEqual(parseOffers(MAIN), { state: 'priced', cents: 1290, source: 'canalbd' });
});

test('parseOffers: prix principal ET carte vendeur moins chere => le principal gagne', () => {
  assert.ok(MAIN_SELLER.includes('11,50'));
  assert.deepEqual(parseOffers(MAIN_SELLER), { state: 'priced', cents: 1290, source: 'canalbd' });
});

test('parseOffers: vendeur seul (meme avec "Indisponible") => vendeur, le plus bas des cartes', () => {
  assert.ok(SELLER_ONLY.includes('Indisponible dans cette librairie'));
  assert.deepEqual(parseOffers(SELLER_ONLY), { state: 'priced', cents: 6990, source: 'vendeur' });
  assert.deepEqual(parseOffers(SELLER_MULTI), { state: 'priced', cents: 6990, source: 'vendeur' });
});

test('parseOffers: texte exact "Indisponible dans cette librairie" sans vendeur => unavailable', () => {
  assert.deepEqual(parseOffers(UNAVAILABLE), { state: 'unavailable' });
});

test('parseOffers: repli sur le texte affiche, formats de prix', () => {
  const html = (v) => `<div class="product-offers"><div class="product-offer"><div class="product-offer-price"><span class="product-offer-price-value">${v}</span></div></div></div>`;
  assert.equal(parseOffers(html('12,90 €')).cents, 1290);
  assert.equal(parseOffers(html('1 234,5 €')).cents, 123450);
  assert.equal(parseOffers(html('9 €')).cents, 900);
  for (const bad of ['', 'abc', '0,00 €', '-5,00 €', '12,345 €', '100 001 €', 'NaN'])
    assert.throws(() => parseOffers(html(bad)), shapeErr, bad);
});

test('parseOffers: toute autre forme => shape (jamais unavailable)', () => {
  const bad = [
    '',
    undefined,
    '{}',
    '[]',
    '<html><body><h1>Erreur 500</h1></body></html>',
    '<div class="product-offers"></div>',
    '<div class="product-offers"><div class="product-offer"><span class="product-unavailable">Autre texte</span></div></div>',
    '<p>Indisponible dans cette librairie</p>', // exact text but not in the known marker
    '<div class="product-offers"><div class="product-offer-price">Neuf : </div></div>', // price block, no price
    '<div class="offer-card"><div class="offer-card__price">gratuit</div></div>',
  ];
  for (const html of bad) assert.throws(() => parseOffers(html), shapeErr, String(html));
});

test('fetchOffers: URL, en-tetes exacts, GET seul, sans cookie ni redirection', async () => {
  const calls = [];
  const fetch = async (url, init) => (calls.push({ url, init }), new Response(MAIN, { status: 200 }));
  const referer = 'https://www.canalbd.net/manga-dokaze/articles/x-1316718/';
  const r = await fetchOffers({ fetch, sourceId: '1316718', releaseDate: '2027-01-31', referer });
  assert.deepEqual(r, { status: 200, html: MAIN });
  assert.equal(calls[0].url, 'https://www.canalbd.net/manga-dokaze/articles/view/1316718/offers/?availability=2&release_date=2027-01-31');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(calls[0].init.headers, {
    'HX-Request': 'true',
    Accept: 'text/html',
    'User-Agent': 'gunpla-personal-importer/1.0',
    Referer: referer,
  });
  // empty / null release date => parameter omitted
  for (const releaseDate of ['', null, undefined, 'not-a-date']) {
    await fetchOffers({ fetch, sourceId: '5', releaseDate });
    assert.equal(calls.at(-1).url, 'https://www.canalbd.net/manga-dokaze/articles/view/5/offers/?availability=2');
  }
  // a foreign referer is never sent; a non digit id is refused before any request
  await fetchOffers({ fetch, sourceId: '5', referer: 'https://evil.example/x' });
  assert.equal(calls.at(-1).init.headers.Referer, undefined);
  const n = calls.length;
  for (const sourceId of ['', 'abc', '12/../x', '1?x=2', '12 3', null]) await assert.rejects(fetchOffers({ fetch, sourceId }), { code: 'input' });
  assert.equal(calls.length, n);
});

// App with the price routes only, so fetch and delay can be injected. Default 20 ms: an instant fake answers before the next slot, so counts match one lane.
async function priceApp(fetch, delayMs = 20) {
  const tmp = tmpDataDir();
  let db = openDb(tmp.dir);
  const router = createRouter();
  priceRoutes(router, { db, fetch, delayMs });
  const server = createServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = {
    dir: tmp.dir,
    get db() {
      return db;
    },
    start: () => fetch_(base + '/api/prices/refresh', { method: 'POST' }),
    status: async () => (await fetch_(base + '/api/prices/status')).json(),
    // POST then wait for the job to end; returns the final status
    run: async () => {
      const r = await app.start();
      assert.equal(r.status, 202);
      for (;;) {
        const st = await app.status();
        if (!st.running) return st;
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    close: async () => (server.closeAllConnections(), server.close(), db.close(), tmp.cleanup()),
  };
  return app;
}
const fetch_ = globalThis.fetch; // real fetch to the local test server; the injected one never leaves the process

// Real kit rows built with cleanTitle; numeric source ids like Canal BD.
function kit(db, n, { release = '2025-01-02', hidden = 0, price } = {}) {
  const id = addRealKit(db, n, `BANDAI MG 1/100 Kit ${n}`);
  db.prepare('UPDATE kits SET source_id = ?, release_date = ?, source_url = ?, hidden = ? WHERE id = ?').run(
    String(9000 + n),
    release,
    `https://www.canalbd.net/manga-dokaze/articles/kit-${9000 + n}/`,
    hidden,
    id,
  );
  if (price) db.prepare("UPDATE kits SET price_cents = ?, price_source = 'canalbd', price_state = 'priced', price_checked_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(price, id);
  return id;
}
const row = (db, id) => ({ ...db.prepare('SELECT price_cents, price_source, price_state, price_checked_at FROM kits WHERE id = ?').get(id) });
const sourceIdOf = (url) => /view\/(\d+)\//.exec(url)[1];
// Fetch answering by source id: map value is html, a status number, or a function.
function fake(map, requests = []) {
  const f = async (url, init) => {
    requests.push({ url, init });
    const v = map[sourceIdOf(url)] ?? map.default;
    if (typeof v === 'function') return v();
    return typeof v === 'number' ? new Response('', { status: v }) : new Response(v, { status: 200 });
  };
  f.requests = requests;
  return f;
}

test('job: les quatre formes reelles sont memorisees, hidden jamais interroge', async () => {
  const requests = [];
  const app = await priceApp(fake({ 9001: MAIN, 9002: MAIN_SELLER, 9003: SELLER_ONLY, 9004: UNAVAILABLE, 9005: MAIN }, requests));
  try {
    const ids = [1, 2, 3, 4].map((n) => kit(app.db, n));
    const hidden = kit(app.db, 5, { hidden: 1 });
    const st = await app.run();
    assert.deepEqual(requests.map((r) => sourceIdOf(r.url)), ['9001', '9002', '9003', '9004']); // ordered by id, hidden skipped
    assert.equal(st.running, false);
    assert.deepEqual({ ...st.last, at: undefined }, { priced: 3, unavailable: 1, errors: 0, skipped: 0, stopped: null, at: undefined });
    assert.ok(Date.parse(st.last.at));
    const [a, b, c, d] = ids.map((id) => row(app.db, id));
    assert.deepEqual([a.price_cents, a.price_source, a.price_state], [1290, 'canalbd', 'priced']);
    assert.deepEqual([b.price_cents, b.price_source, b.price_state], [1290, 'canalbd', 'priced']);
    assert.deepEqual([c.price_cents, c.price_source, c.price_state], [6990, 'vendeur', 'priced']);
    assert.deepEqual([d.price_cents, d.price_source, d.price_state], [null, null, 'unavailable']);
    assert.ok([a, b, c, d].every((r) => Date.parse(r.price_checked_at)));
    assert.deepEqual(row(app.db, hidden), { price_cents: null, price_source: null, price_state: null, price_checked_at: null });
  } finally {
    await app.close();
  }
});

test('job: requetes = GET seul, en-tetes exacts, release_date vide => parametre omis', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: MAIN }, requests));
  try {
    const withDate = kit(app.db, 1, { release: '2025-03-04' });
    const noDate = kit(app.db, 2, { release: '' });
    const nullDate = kit(app.db, 3);
    app.db.prepare('UPDATE kits SET release_date = NULL WHERE id = ?').run(nullDate);
    await app.run();
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, 'https://www.canalbd.net/manga-dokaze/articles/view/9001/offers/?availability=2&release_date=2025-03-04');
    assert.equal(requests[1].url, 'https://www.canalbd.net/manga-dokaze/articles/view/9002/offers/?availability=2');
    assert.equal(requests[2].url, 'https://www.canalbd.net/manga-dokaze/articles/view/9003/offers/?availability=2');
    for (const [i, r] of requests.entries()) {
      assert.equal(r.init.method, 'GET');
      assert.equal(r.init.redirect, 'manual');
      assert.equal(r.init.body, undefined);
      assert.deepEqual(r.init.headers, {
        'HX-Request': 'true',
        Accept: 'text/html',
        'User-Agent': 'gunpla-personal-importer/1.0',
        Referer: `https://www.canalbd.net/manga-dokaze/articles/kit-${9001 + i}/`,
      });
      assert.equal(r.init.headers.Cookie ?? r.init.credentials, undefined);
    }
    assert.ok(withDate && noDate);
  } finally {
    await app.close();
  }
});

// Unexpected forms stop the job after ONE request and write nothing, an earlier stored price survives.
const SHAPES = {
  'corps vide': '',
  '{}': '{}',
  'page erreur HTML': '<html><body><h1>Une erreur est survenue</h1></body></html>',
  'markup inconnu': '<div class="new-offers"><p>Tarif : 12,90 EUR</p></div>',
};
for (const [name, body] of Object.entries(SHAPES)) {
  test(`job: shape (${name}) => arret apres une requete, rien d'ecrit, prix precedent intact`, async () => {
    const requests = [];
    const app = await priceApp(fake({ default: body }, requests));
    try {
      const first = kit(app.db, 1, { price: 4200 });
      const second = kit(app.db, 2);
      const before = [row(app.db, first), row(app.db, second)];
      const logs = [];
      const orig = console.error;
      console.error = (m) => logs.push(m);
      let st;
      try {
        st = await app.run();
      } finally {
        console.error = orig;
      }
      assert.equal(requests.length, 1);
      assert.equal(st.last.stopped, 'shape');
      assert.equal(st.last.priced + st.last.unavailable, 0);
      assert.deepEqual([row(app.db, first), row(app.db, second)], before);
      assert.equal(st.running, false);
      assert.equal(logs.length, 1);
      assert.ok(!logs[0].includes('<') && !logs[0].includes('http'), logs[0]);
      // running was reset: a new run is accepted
      assert.equal((await app.start()).status, 202);
    } finally {
      await app.close();
    }
  });
}

test('job: un shape au milieu garde les kits deja releves, rien apres', async () => {
  const requests = [];
  const app = await priceApp(fake({ 9001: MAIN, 9002: '{}', 9003: MAIN }, requests));
  try {
    const ids = [1, 2, 3].map((n) => kit(app.db, n));
    const st = await app.run();
    assert.equal(requests.length, 2);
    assert.equal(st.last.stopped, 'shape');
    assert.equal(st.last.priced, 1);
    assert.equal(row(app.db, ids[0]).price_cents, 1290);
    assert.equal(row(app.db, ids[1]).price_state, null);
    assert.equal(row(app.db, ids[2]).price_state, null);
  } finally {
    await app.close();
  }
});

for (const status of [403, 429]) {
  test(`job: HTTP ${status} => arret net, rien d'ecrit pour ce kit`, async () => {
    const requests = [];
    const app = await priceApp(fake({ 9001: MAIN, 9002: status, 9003: MAIN }, requests));
    try {
      const ids = [1, 2, 3].map((n) => kit(app.db, n, { price: n === 2 ? 5000 : undefined }));
      const st = await app.run();
      assert.equal(requests.length, 2);
      assert.equal(st.last.stopped, 'blocked');
      assert.equal(row(app.db, ids[0]).price_cents, 1290);
      assert.equal(row(app.db, ids[1]).price_cents, 5000); // previous price survives
      assert.equal(row(app.db, ids[2]).price_state, null);
    } finally {
      await app.close();
    }
  });
}

test('job: page de defi/captcha en 200 => blocked', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: '<html><title>Just a moment...</title><div id="cf-chl-widget"></div></html>' }, requests));
  try {
    const id = kit(app.db, 1);
    kit(app.db, 2);
    const st = await app.run();
    assert.equal(requests.length, 1);
    assert.equal(st.last.stopped, 'blocked');
    assert.equal(row(app.db, id).price_state, null);
  } finally {
    await app.close();
  }
});

test('job: erreur passagere (reseau, 5xx) => rien memorise, on continue, prix precedent intact', async () => {
  const requests = [];
  const boom = () => Promise.reject(new TypeError('fetch failed'));
  const app = await priceApp(fake({ 9001: boom, 9002: 503, 9003: MAIN, 9004: 'x' }, requests));
  try {
    const ids = [1, 2, 3].map((n) => kit(app.db, n, { price: n === 1 ? 3000 : undefined }));
    const st = await app.run();
    assert.equal(requests.length, 3);
    assert.equal(st.last.stopped, null);
    assert.deepEqual({ p: st.last.priced, e: st.last.errors }, { p: 1, e: 2 });
    assert.equal(row(app.db, ids[0]).price_cents, 3000);
    assert.equal(row(app.db, ids[1]).price_state, null);
    assert.equal(row(app.db, ids[2]).price_cents, 1290);
  } finally {
    await app.close();
  }
});

test('job: source_id invalide => ignore sans requete (skipped)', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: MAIN }, requests));
  try {
    const bad = kit(app.db, 1);
    app.db.prepare("UPDATE kits SET source_id = 'abc/../x' WHERE id = ?").run(bad);
    const ok = kit(app.db, 2);
    const st = await app.run();
    assert.equal(requests.length, 1);
    assert.equal(st.last.skipped, 1);
    assert.equal(row(app.db, bad).price_state, null);
    assert.equal(row(app.db, ok).price_cents, 1290);
  } finally {
    await app.close();
  }
});

test('job: delai entre requetes respecte (pas avant la premiere), defaut 1000 ms', async () => {
  assert.equal(DEFAULT_DELAY_MS, 1000);
  const times = [];
  const app = await priceApp(async () => (times.push(Date.now()), new Response(MAIN, { status: 200 })), 200);
  try {
    [1, 2, 3].forEach((n) => kit(app.db, n));
    const t0 = Date.now();
    await app.run();
    assert.equal(times.length, 3);
    assert.ok(times[0] - t0 < 150, 'no wait before the first request'); // a full delay (200) would show; the rest is load margin
    // Slots are reserved from the clock, not from the real send time: a request can leave a few ms late, so the measured gap
    // can be a few ms under the delay. 150 of 200 still fails when the gate is missing (gaps ~0) or halved.
    assert.ok(times[1] - times[0] >= 150 && times[2] - times[1] >= 150, `gaps ${times[1] - times[0]} ${times[2] - times[1]}`);
  } finally {
    await app.close();
  }
});

// Fake clock: checks the slot spacing at tick granularity (starts read after each 1000 ms tick). The real-time job test above covers the end-to-end case, with a 0.75x tolerance for send-time jitter.
test('politeGate: creneaux espaces d\'au moins le delai configure (horloge simulee)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const turn = politeGate(1000);
  const starts = [];
  const queued = [1, 2, 3].map(() => turn().then(() => starts.push(Date.now())));
  await Promise.resolve();
  const t0 = Date.now();
  for (let i = 0; i < 3 && starts.length < 3; i++) {
    t.mock.timers.tick(1000);
    await Promise.resolve();
    await Promise.resolve();
  }
  await Promise.all(queued);
  assert.deepEqual(starts.map((s) => s - t0), [0, 1000, 2000]);
});

test('job: double lancement => 409, status running puis termine', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const app = await priceApp(async () => (await gate, new Response(MAIN, { status: 200 })));
  try {
    const id = kit(app.db, 1);
    assert.equal((await app.start()).status, 202);
    assert.equal((await app.start()).status, 409);
    const st = await app.status();
    assert.equal(st.running, true);
    assert.deepEqual(st.progress, { done: 0, total: 1 });
    release();
    let end;
    while ((end = await app.status()).running) await new Promise((r) => setTimeout(r, 5));
    assert.equal(end.last.priced, 1);
    assert.equal((await app.start()).status, 202); // legal again once finished
    assert.equal(row(app.db, id).price_cents, 1290);
  } finally {
    release();
    await app.close();
  }
});

test('job: les prix persistent apres reouverture de la base, relancer met a jour la date', async () => {
  const app = await priceApp(fake({ default: MAIN }));
  try {
    const id = kit(app.db, 1);
    await app.run();
    const fresh = openDb(app.dir); // a second connection = what a restart would see
    const first = row(fresh, id);
    fresh.close();
    assert.deepEqual([first.price_cents, first.price_source, first.price_state], [1290, 'canalbd', 'priced']);
    await new Promise((r) => setTimeout(r, 15));
    await app.run();
    const second = row(app.db, id);
    assert.equal(second.price_cents, 1290);
    assert.ok(second.price_checked_at > first.price_checked_at);
  } finally {
    await app.close();
  }
});

test('job: un prix devenu indisponible remplace le prix precedent (etat explicite)', async () => {
  const app = await priceApp(fake({ default: UNAVAILABLE }));
  try {
    const id = kit(app.db, 1, { price: 1500 });
    await app.run();
    const r = row(app.db, id);
    assert.deepEqual([r.price_cents, r.price_source, r.price_state], [null, null, 'unavailable']);
  } finally {
    await app.close();
  }
});

test('job: une redirection n est jamais suivie (3xx = forme inattendue, arret)', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: () => new Response('', { status: 302, headers: { location: 'https://evil.example/' } }) }, requests));
  try {
    const id = kit(app.db, 1);
    kit(app.db, 2);
    const st = await app.run();
    assert.equal(requests.length, 1);
    assert.equal(st.last.stopped, 'shape');
    assert.equal(row(app.db, id).price_state, null);
  } finally {
    await app.close();
  }
});

test('parseOffers: "Indisponible" + carte vendeur non reconnue => shape (jamais unavailable)', () => {
  const U = '<span class="product-unavailable">Indisponible dans cette librairie</span>';
  const wrap = (inner) => `<div class="product-offers"><div class="product-offer">${U}</div></div>${inner}`;
  const probes = [
    wrap('<div class="offer-card"><div class="offer-card__price--new">9,90 €</div></div>'), // renamed price class
    wrap('<div class="offer-card"><div class="seller-name">x</div></div>'), // card without price element
    `<div class="product-offers"><div class="offer-card"><div class="product-offer">${U}</div></div></div>`, // span inside a card
  ];
  for (const html of probes) assert.throws(() => parseOffers(html), shapeErr, html);
});

test('parseOffers: meta et texte affiche en desaccord => shape, un seul present => utilise', () => {
  const html = (inner) => `<div class="product-offers"><div class="product-offer-price">${inner}</div></div>`;
  const meta = (v) => `<meta itemprop="price" content="${v}"/>`;
  const text = (v) => `<span class="product-offer-price-value">${v}</span>`;
  assert.throws(() => parseOffers(html(meta('12.90') + text('21,90 €'))), shapeErr);
  assert.equal(parseOffers(html(meta('12.90') + text('12,90 €'))).cents, 1290);
  assert.equal(parseOffers(html(meta('12.90'))).cents, 1290);
  assert.equal(parseOffers(html(text('12,90 €'))).cents, 1290);
});

test('job: 5 erreurs consecutives (503) => arret blocked apres exactement 5 requetes, rien d ecrit', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: 503 }, requests));
  try {
    const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => kit(app.db, n, { price: n === 1 ? 2500 : undefined }));
    const logs = [];
    const orig = console.error;
    console.error = (m) => logs.push(m);
    let st;
    try {
      st = await app.run();
    } finally {
      console.error = orig;
    }
    assert.equal(requests.length, 5);
    assert.equal(st.last.stopped, 'blocked');
    assert.equal(st.last.errors, 5);
    assert.equal(row(app.db, ids[0]).price_cents, 2500);
    assert.ok(ids.slice(1).every((id) => row(app.db, id).price_state === null));
    assert.equal(logs.filter((l) => /stopped/.test(l)).length, 1);
  } finally {
    await app.close();
  }
});

test('job: 4 erreurs puis un kit correct => on continue, le compteur repart de zero', async () => {
  const requests = [];
  // kits 1-4 fail, 5 ok, 6-9 fail again (4 in a row, still below 5), 10 ok
  const map = { 9001: 503, 9002: 503, 9003: 503, 9004: 503, 9005: MAIN, 9006: 503, 9007: 503, 9008: 503, 9009: 503, 9010: MAIN };
  const app = await priceApp(fake(map, requests));
  try {
    const ids = Array.from({ length: 10 }, (_, i) => kit(app.db, i + 1));
    const st = await app.run();
    assert.equal(requests.length, 10);
    assert.equal(st.last.stopped, null);
    assert.deepEqual({ p: st.last.priced, e: st.last.errors }, { p: 2, e: 8 });
    assert.equal(row(app.db, ids[4]).price_cents, 1290);
    assert.equal(row(app.db, ids[9]).price_cents, 1290);
  } finally {
    await app.close();
  }
});

for (const status of [404, 410]) {
  test(`job: un ${status} au milieu est une erreur par kit, le releve continue`, async () => {
    const requests = [];
    const app = await priceApp(fake({ 9001: MAIN, 9002: status, 9003: MAIN }, requests));
    try {
      const ids = [1, 2, 3].map((n) => kit(app.db, n, { price: n === 2 ? 700 : undefined }));
      const st = await app.run();
      assert.equal(requests.length, 3);
      assert.equal(st.last.stopped, null);
      assert.deepEqual({ p: st.last.priced, e: st.last.errors }, { p: 2, e: 1 });
      assert.equal(row(app.db, ids[1]).price_cents, 700); // untouched
      assert.equal(row(app.db, ids[2]).price_cents, 1290);
    } finally {
      await app.close();
    }
  });
}

test('job: 5 x 404 consecutifs => arret blocked', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: 404 }, requests));
  try {
    [1, 2, 3, 4, 5, 6].forEach((n) => kit(app.db, n));
    const st = await app.run();
    assert.equal(requests.length, 5);
    assert.equal(st.last.stopped, 'blocked');
  } finally {
    await app.close();
  }
});

test('job: 401 reste un arret shape', async () => {
  const requests = [];
  const app = await priceApp(fake({ default: 401 }, requests));
  try {
    kit(app.db, 1);
    kit(app.db, 2);
    const st = await app.run();
    assert.equal(requests.length, 1);
    assert.equal(st.last.stopped, 'shape');
  } finally {
    await app.close();
  }
});

test('GET /api/prices/status avant tout lancement', async () => {
  const app = await priceApp(fake({ default: MAIN }));
  try {
    assert.deepEqual(await app.status(), { running: false, last: null, progress: null });
  } finally {
    await app.close();
  }
});

// --- two lanes sharing one start gate ---
const slow = (ms, v, log) => async (url) => {
  log.starts.push(Date.now());
  log.open++;
  log.maxOpen = Math.max(log.maxOpen, log.open);
  await new Promise((r) => setTimeout(r, ms));
  log.open--;
  log.ids.push(sourceIdOf(url));
  const x = typeof v === 'function' ? v(sourceIdOf(url), log.ids.length) : v;
  return typeof x === 'number' ? new Response('', { status: x }) : new Response(x, { status: 200 });
};
const newLog = () => ({ starts: [], ids: [], open: 0, maxOpen: 0 });
const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

test('job: deux requetes en vol, ecart global >= delai, tous les kits une seule fois', async () => {
  const log = newLog();
  const app = await priceApp(slow(200, MAIN, log), 100);
  try {
    [1, 2, 3, 4, 5, 6].forEach((n) => kit(app.db, n));
    const st = await app.run();
    assert.equal(log.maxOpen, 2);
    assert.equal(st.last.priced, 6);
    assert.deepEqual([...log.ids].sort(), ['9001', '9002', '9003', '9004', '9005', '9006']);
    for (let i = 1; i < log.starts.length; i++) assert.ok(log.starts[i] - log.starts[i - 1] >= 85, `gap ${log.starts[i] - log.starts[i - 1]}`);
  } finally {
    await app.close();
  }
});

test('job: 403 sur une voie => l autre ne lance plus rien, fin sans exception', async () => {
  const log = newLog();
  const app = await priceApp(slow(150, (id) => (id === '9001' ? 403 : MAIN), log), 50);
  try {
    [1, 2, 3, 4, 5].forEach((n) => kit(app.db, n));
    const st = await quiet(() => app.run());
    assert.equal(st.last.stopped, 'blocked');
    assert.ok(log.starts.length <= 3, `${log.starts.length} requests`);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(log.starts.length <= 3);
  } finally {
    await app.close();
  }
});

test('job: 5 erreurs consecutives arretent (deux voies)', async () => {
  const log = newLog();
  const app = await priceApp(slow(30, 503, log), 10);
  try {
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => kit(app.db, n));
    const st = await quiet(() => app.run());
    assert.equal(st.last.stopped, 'blocked');
    assert.ok(st.last.errors >= 5 && st.last.errors <= 6, `errors ${st.last.errors}`); // one request may already be in flight
  } finally {
    await app.close();
  }
});

test('job: un succes remet le compteur a zero (4 erreurs, 1 succes, 4 erreurs => pas d arret)', async () => {
  const log = newLog();
  const app = await priceApp(slow(30, (id, n) => (n === 5 ? MAIN : 503), log), 10);
  try {
    for (let n = 1; n <= 9; n++) kit(app.db, n);
    const st = await quiet(() => app.run());
    assert.equal(st.last.stopped, null);
    assert.equal(st.last.errors, 8);
    assert.equal(st.last.priced, 1);
  } finally {
    await app.close();
  }
});

test('job: shape sur une voie => stop, rien d ecrit pour ce kit; source_id invalide sans requete', async () => {
  const log = newLog();
  const app = await priceApp(slow(60, (id) => (id === '9002' ? '{}' : MAIN), log), 20);
  try {
    const ids = [1, 2, 3, 4, 5].map((n) => kit(app.db, n));
    app.db.prepare("UPDATE kits SET source_id = 'x' WHERE id = ?").run(ids[2]);
    const st = await quiet(() => app.run());
    assert.equal(st.last.stopped, 'shape');
    assert.equal(st.last.skipped, 1);
    assert.equal(row(app.db, ids[1]).price_state, null);
    assert.ok(!log.ids.includes('x'));
  } finally {
    await app.close();
  }
});
