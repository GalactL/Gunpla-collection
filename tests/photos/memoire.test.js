// Mémoire des refus (7 jours, version des règles, nom + grade) et sources en parallèle (un étage par source).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import photoRoutes from '../../src/photos/routes.js';
import { REASONS } from '../../src/photos/provider.js';
import { RULES_VERSION, fetchPhotoForKit } from '../../src/photos/fetch.js';
import { getPhoto, savePhoto } from '../../src/photos/store.js';

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 1);
const okFetch = async () => new Response(PNG, { status: 200 });
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const refusals = (db, kitId) => db.prepare('SELECT * FROM photo_refusals WHERE kit_id = ? ORDER BY provider').all(kitId);

// Fake source: `answer(name, refuse)` -> hit | null (default: refuses with `no candidate`); calls are logged in `calls`.
function source(name, answer, extra = {}) {
  const p = {
    name,
    host: `${name}.test`,
    calls: [],
    async find(kitName, grade, refuse) {
      p.calls.push(kitName);
      return answer ? answer(kitName, refuse) : (refuse(REASONS.noCandidate), null);
    },
    ...extra,
  };
  return p;
}
const hit = (name, n = 1) => ({ imageUrl: `https://${name}.test/i${n}.png`, pageUrl: `https://${name}.test/p${n}` });

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

// The photo routes alone, with injected sources; `refresh(query)` runs the job and returns its summary.
async function withJobs(providers, fn) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const router = createRouter();
  const jobs = {};
  const orig = { log: console.log, error: console.error };
  console.error = console.log = () => {};
  photoRoutes(router, { db, dataDir: tmp.dir, providers, fetch: okFetch, jobs });
  const server = createServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = async () => (await globalThis.fetch(`${base}/api/photos/status`)).json();
  const refresh = async (query = '') => {
    assert.equal((await globalThis.fetch(`${base}/api/photos/refresh${query}`, { method: 'POST' })).status, 202);
    let st;
    do {
      await nap(5);
      st = await status();
    } while (st.running);
    return st.last;
  };
  try {
    await fn({ db, dir: tmp.dir, refresh, status });
  } finally {
    Object.assign(console, orig);
    server.closeAllConnections();
    server.close();
    db.close();
    tmp.cleanup();
  }
}

test('refus mémorisé : pas de nouvelle requête pendant 7 jours, de nouveau après ; compté en skipped', async () => {
  await withDb(async (t) => {
    const a = source('a');
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const run = (now, stats = {}) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: [a], fetch: okFetch, now: () => now, stats }).then((r) => [r, stats]);
    assert.deepEqual((await run(T0))[0], { found: false });
    assert.equal(a.calls.length, 1);
    const [, s] = await run(T0 + 6 * DAY);
    assert.equal(a.calls.length, 1); // mémorisé
    assert.equal(s.a.skipped, 1);
    assert.deepEqual(refusals(t.db, id).map((r) => [r.provider, r.reason, r.rules_version]), [['a', REASONS.noCandidate, RULES_VERSION]]);
    await run(T0 + 8 * DAY);
    assert.equal(a.calls.length, 2); // 7 jours passés
  });
});

test('refus mémorisé : réessayé si la version des règles change, si le titre ou le grade du kit change', async () => {
  await withDb(async (t) => {
    const a = source('a');
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const run = () => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: [a], fetch: okFetch, now: () => T0 });
    await run();
    await run();
    assert.equal(a.calls.length, 1);
    assert.ok(RULES_VERSION >= 2); // R1/R2/R3 : les refus de la version 1 sont périmés
    t.db.prepare('UPDATE photo_refusals SET rules_version = ?').run(RULES_VERSION - 1); // règles changées depuis
    await run();
    assert.equal(a.calls.length, 2);
    await run();
    assert.equal(a.calls.length, 2); // refus réécrit avec la version courante
    t.db.prepare("UPDATE kits SET title = 'Gundam Aerial Permet' WHERE id = ?").run(id);
    await run();
    assert.equal(a.calls.length, 3);
    t.db.prepare("UPDATE kits SET grade = 'MG' WHERE id = ?").run(id);
    await run();
    assert.equal(a.calls.length, 4);
    await run();
    assert.equal(a.calls.length, 4);
    // un changement de numéro de catalogue (retiré par searchName) ne change rien à la question posée
    t.db.prepare("UPDATE kits SET title = '(012) Gundam Aerial Permet' WHERE id = ?").run(id);
    await run();
    assert.equal(a.calls.length, 4);
  });
});

test('une erreur de source n\'est jamais mémorisée (source, exception, téléchargement)', async () => {
  await withDb(async (t) => {
    const down = source('down', (n, refuse) => (refuse(REASONS.source), null));
    const boom = source('boom', () => {
      throw new Error('boom');
    });
    const bad = source('bad', () => hit('bad'));
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const run = (p, fetch = okFetch) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: [p], fetch, now: () => T0 });
    for (const p of [down, boom]) {
      await run(p);
      await run(p);
      assert.equal(p.calls.length, 2);
    }
    await run(bad, async () => new Response('', { status: 503 }));
    await run(bad, async () => new Response('', { status: 503 }));
    assert.equal(bad.calls.length, 2);
    assert.deepEqual(refusals(t.db, id), []);
  });
});

test('un succès efface le refus de la source qui trouve ; un upload ne change rien', async () => {
  await withDb(async (t) => {
    let found = false;
    const a = source('a', (n, refuse) => (found ? hit('a') : (refuse(REASONS.noResult), null)));
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    const other = addRealKit(t.db, 2, 'MG 1/100 SAZABI');
    const run = (kitId, extra = {}) => fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId, providers: [a], fetch: okFetch, now: () => T0, ...extra });
    await run(id);
    await run(other);
    assert.equal(refusals(t.db, id).length, 1);
    savePhoto({ db: t.db, dataDir: t.dir, kitId: other, bytes: PNG, kind: 'user' });
    assert.equal(refusals(t.db, other).length, 1); // l'upload ne touche pas la mémoire
    found = true;
    assert.deepEqual(await run(id), { found: false }); // mémorisé : même une source qui trouverait maintenant n'est pas interrogée
    assert.deepEqual(await run(id, { force: true }), { found: true });
    assert.deepEqual(refusals(t.db, id), []);
    assert.equal(getPhoto(t.db, id).kind, 'auto');
  });
});

test('la mémoire est par source : refusé par la meilleure, trouvé par la suivante, le refus de la meilleure reste', async () => {
  await withDb(async (t) => {
    const a = source('a');
    const b = source('b', () => hit('b'));
    const id = addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: [a, b], fetch: okFetch });
    assert.equal(getPhoto(t.db, id).source_url, 'https://b.test/p1');
    assert.deepEqual(refusals(t.db, id).map((r) => r.provider), ['a']);
    await fetchPhotoForKit({ db: t.db, dataDir: t.dir, kitId: id, providers: [a, b], fetch: okFetch }); // a est encore mieux classée que b
    assert.equal(a.calls.length, 1);
  });
});

test('migration idempotente : deux ouvertures, données et refus intacts', () => {
  const tmp = tmpDataDir();
  try {
    let db = openDb(tmp.dir);
    const id = addRealKit(db, 1, 'HG 1/144 GUNDAM AERIAL');
    db.prepare("INSERT INTO photo_refusals (kit_id, provider, reason, rules_version, title_key, refused_at) VALUES (?, 'a', 'r', 1, 'k', 'd')").run(id);
    db.close();
    db = openDb(tmp.dir);
    db.close();
    db = openDb(tmp.dir);
    assert.equal(refusals(db, id).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kits').get().n, 1);
    db.prepare('DELETE FROM kits WHERE id = ?').run(id); // le refus part avec son kit
    assert.equal(refusals(db, id).length, 0);
    db.close();
  } finally {
    tmp.cleanup();
  }
});

test('actualisation : refus respecté d\'une fois sur l\'autre, ?force=1 l\'ignore, skipped dans le décompte', async () => {
  const a = source('a');
  await withJobs([a], async (t) => {
    addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    addRealKit(t.db, 2, 'MG 1/100 SAZABI');
    let last = await t.refresh();
    assert.equal(a.calls.length, 2);
    assert.equal(last.sources.a.skipped, undefined);
    last = await t.refresh();
    assert.equal(a.calls.length, 2);
    assert.deepEqual([last.tried, last.found, last.sources.a.skipped], [2, 0, 2]);
    last = await t.refresh('?force=1');
    assert.equal(a.calls.length, 4);
    assert.equal(last.sources.a.skipped, undefined);
  });
});

test('pipeline : les étages tournent en parallèle (la boutique traite un kit avant la fin de la file HLJ)', async () => {
  const events = [];
  const slow = source(
    'slow',
    async (n, refuse) => {
      events.push(`slow:${n}`);
      await nap(30);
      refuse(REASONS.noCandidate);
      return null;
    },
    { concurrency: 1 },
  );
  const shop = source('shop', (n) => (events.push(`shop:${n}`), hit('shop', events.length)));
  await withJobs([slow, shop], async (t) => {
    for (let i = 1; i <= 5; i++) addRealKit(t.db, i, `HG 1/144 KIT NUMBER${'X'.repeat(i)}`);
    const last = await t.refresh();
    const firstShop = events.findIndex((e) => e.startsWith('shop:'));
    const lastSlow = events.findLastIndex((e) => e.startsWith('slow:'));
    assert.ok(firstShop > 0 && firstShop < lastSlow, events.join(' | '));
    assert.deepEqual([last.tried, last.found, last.missing], [5, 5, 0]);
    assert.deepEqual([last.sources.slow.refused[REASONS.noCandidate], last.sources.shop.found], [5, 5]);
  });
});

test('pipeline : rang respecté, aucun double traitement, concurrence par étage, tried/found cohérents', async () => {
  const inKit = new Map(); // kit -> source en cours : jamais deux à la fois
  const peak = { a: 0, b: 0, c: 0 };
  const live = { a: 0, b: 0, c: 0 };
  let overlap = 0;
  const wrap = (name, decide) =>
    source(name, async (n, refuse) => {
      overlap += inKit.has(n) ? 1 : 0;
      inKit.set(n, name);
      peak[name] = Math.max(peak[name], ++live[name]);
      await nap(5);
      live[name]--;
      inKit.delete(n);
      const r = decide(n);
      if (r) return hit(name, n.length);
      refuse(REASONS.noResult);
      return null;
    });
  // a trouve les kits "ALPHA", b trouve "ALPHA" et "BETA", c trouve tout : a > b > c
  const a = wrap('a', (n) => /alpha/i.test(n));
  const b = wrap('b', (n) => /alpha|beta/i.test(n));
  const c = wrap('c', () => true);
  await withJobs([a, b, c], async (t) => {
    const ids = [];
    for (const [i, w] of ['ALPHA', 'BETA', 'GAMMA', 'ALPHA TWO', 'BETA TWO', 'GAMMA TWO'].entries()) ids.push(addRealKit(t.db, i + 1, `HG 1/144 ${w}`));
    const last = await t.refresh();
    assert.equal(overlap, 0);
    const by = (kit) => getPhoto(t.db, kit).source_url.split('/')[2];
    assert.deepEqual(ids.map(by), ['a.test', 'b.test', 'c.test', 'a.test', 'b.test', 'c.test']);
    assert.equal(a.calls.length, 6);
    assert.equal(b.calls.length, 4); // les kits trouvés par a n'arrivent jamais à b
    assert.equal(c.calls.length, 2);
    for (const p of [a, b, c]) assert.equal(new Set(p.calls).size, p.calls.length); // un kit n'est traité qu'une fois par source
    assert.deepEqual([last.tried, last.found, last.missing], [6, 6, 0]);
    assert.deepEqual([last.sources.a.found, last.sources.b.found, last.sources.c.found], [2, 2, 2]);
    assert.equal(peak.a, 2); // 2 par défaut pour une source sans `concurrency`
    const st = await t.status();
    assert.equal(st.running, false);
    assert.equal(st.progress, null);
  });
});

test('pipeline : un étage en échec ne bloque ni les autres ni la fin du job', async () => {
  const down = source('down', () => {
    throw new Error('panne');
  });
  const flaky = source('flaky', (n, refuse) => (refuse(REASONS.source), null));
  const ok = source('ok', (n) => (/miss/i.test(n) ? null : hit('ok', n.length)));
  await withJobs([down, flaky, ok], async (t) => {
    for (let i = 1; i <= 8; i++) addRealKit(t.db, i, `HG 1/144 KIT ${'Z'.repeat(i)}`);
    addRealKit(t.db, 9, 'HG 1/144 MISS');
    const last = await t.refresh();
    assert.deepEqual([last.tried, last.found, last.missing], [9, 8, 1]);
    assert.equal(last.sources.ok.found, 8);
    assert.ok(last.sources.down.errors > 0 && last.sources.flaky.errors > 0);
    // les erreurs ne sont jamais mémorisées ; le vrai refus de la dernière source l'est
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM photo_refusals').get().n, 1);
    assert.equal(t.db.prepare('SELECT provider FROM photo_refusals').get().provider, 'ok');
    assert.equal((await t.status()).running, false);
  });
});
