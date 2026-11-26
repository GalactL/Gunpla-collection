// Journal de chaque relance : démarrage, 409, erreurs de source, disjoncteur, refus mémorisés ignorés, récapitulatif final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PNG, addRealKit, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';
import { createRouter } from '../../src/routes/index.js';
import photoRoutes from '../../src/photos/routes.js';
import { REASONS } from '../../src/photos/provider.js';
import { BREAKER, RULES_VERSION } from '../../src/photos/fetch.js';
import { gundamWikiProvider } from '../../src/photos/gundamwiki.js';
import { hljProvider } from '../../src/photos/provider.js';
import { shopifyProvider } from '../../src/photos/shopify.js';

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const okFetch = async () => new Response(PNG, { status: 200 });
const src = (name, answer) => ({ name, host: `${name}.test`, find: async (n, g, refuse) => answer(refuse) });
const refuses = (reason) => (refuse) => (refuse(reason), null);

// Photo routes alone; `lines` captures console.log + console.error (the journal); `refresh(query)` runs a job to its end.
async function withJobs(providers, fn, fetch = okFetch) {
  const tmp = tmpDataDir();
  const db = openDb(tmp.dir);
  const router = createRouter();
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.error = console.log = (m) => lines.push(String(m));
  photoRoutes(router, { db, dataDir: tmp.dir, providers, fetch });
  const server = createServer((req, res) => router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (query = '') => globalThis.fetch(`${base}/api/photos/refresh${query}`, { method: 'POST' });
  const refresh = async (query) => {
    assert.equal((await post(query)).status, 202);
    let st;
    do {
      await nap(5);
      st = await (await globalThis.fetch(`${base}/api/photos/status`)).json();
    } while (st.running);
    return st.last;
  };
  try {
    await fn({ db, lines, refresh, post });
  } finally {
    Object.assign(console, orig);
    server.closeAllConnections();
    server.close();
    db.close();
    tmp.cleanup();
  }
}

test('journal : démarrage (kits, force, version des règles, sources dans l\'ordre) et récapitulatif final avec durée', async () => {
  const a = src('a', refuses(REASONS.noCandidate));
  const b = src('b', () => ({ imageUrl: 'https://b.test/i.png', pageUrl: 'https://b.test/p', uncertain: true, extra: ['x'] }));
  await withJobs([a, b], async (t) => {
    addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    await t.refresh('?force=1');
    const out = t.lines.join('\n');
    assert.match(out, new RegExp(`job start: 1 kits, force yes, rules v${RULES_VERSION}, sources: a > b`));
    assert.match(out, /kit 1 a: refused \(.*\) "Gundam Aerial" HG/);
    assert.match(out, /job done in \d+\.\ds: 1 kits tried, 1 found/);
    assert.ok(out.includes(`  a: found 0, uncertain 0, relaxed 0, errors 0, skipped 0, refused ${REASONS.noCandidate}: 1`));
    assert.match(out, /  b: found 1, uncertain 1, relaxed 0, errors 0, skipped 0, refused none/);
  });
});

test('journal : relance refusée (409) pendant qu\'une autre tourne, une ligne dédiée', async () => {
  let release;
  const held = src('a', () => new Promise((r) => (release = () => r(null))));
  await withJobs([held], async (t) => {
    addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    assert.equal((await t.post()).status, 202);
    assert.equal((await t.post()).status, 409);
    assert.equal(t.lines.filter((l) => /refresh refused \(409\): a job is already running/.test(l)).length, 1);
    while (!release) await nap(1);
    release();
    while (!t.lines.some((l) => /job done/.test(l))) await nap(1);
  });
});

test('journal : erreurs de source HTTP 403 et timeout visibles, comptées en errors', async () => {
  for (const [fetch, expected] of [
    [async () => new Response('no', { status: 403 }), /gundamwiki: HTTP 403/],
    [async () => { throw new Error('The operation was aborted due to timeout'); }, /gundamwiki: .*timeout/],
  ]) {
    await withJobs([gundamWikiProvider({ fetch, minIntervalMs: 0 })], async (t) => {
      addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
      const last = await t.refresh();
      assert.equal(last.sources.gundamwiki.errors, 1);
      const out = t.lines.join('\n');
      assert.match(out, expected);
      assert.match(out, /gundamwiki: found 0.*errors 1/);
    }, fetch);
  }
});

test('journal : ouverture du disjoncteur après BREAKER échecs, source sautée pour la suite du job', async () => {
  const a = src('a', refuses(REASONS.source));
  await withJobs([a], async (t) => {
    for (let i = 1; i <= BREAKER + 2; i++) addRealKit(t.db, i, `HG 1/144 GUNDAM AERIAL ${i}`);
    const last = await t.refresh();
    assert.ok(last.sources.a.errors >= BREAKER && last.sources.a.errors < BREAKER + 2); // 2 kits in flight when it opens
    assert.equal(t.lines.filter((l) => new RegExp(`a: circuit open after ${BREAKER} source errors in a row, skipped for the rest of the job`).test(l)).length, 1);
  });
});

test('journal : refus mémorisé ignoré (skipped), une ligne par kit, ?force=1 interroge de nouveau', async () => {
  const a = src('a', refuses(REASONS.noCandidate));
  await withJobs([a], async (t) => {
    addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    await t.refresh();
    t.lines.length = 0;
    await t.refresh();
    assert.equal(t.lines.filter((l) => /kit 1 a: skipped \(refusal remembered; "Gundam Aerial"\)/.test(l)).length, 1);
    assert.ok(t.lines.some((l) => /a: found 0.*skipped 1/.test(l)));
    t.lines.length = 0;
    await t.refresh('?force=1');
    assert.equal(t.lines.some((l) => /skipped \(refusal/.test(l)), false);
  });
});

test('journal : la ligne de refus porte la requête (texte seul, sans URL) pour HLJ, Shopify et le wiki', async () => {
  const fetch = async (url) =>
    new Response(new URL(url).hostname.endsWith('hlj.com') ? '<div></div>' : JSON.stringify({ resources: { results: { products: [] } }, query: { pages: {} } }), { status: 200 });
  const providers = [hljProvider({ fetch, minIntervalMs: 0 }), shopifyProvider({ name: 'shop', host: 'shop.test', fetch, minIntervalMs: 0 }), gundamWikiProvider({ fetch, minIntervalMs: 0 })];
  await withJobs(providers, async (t) => {
    addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    await t.refresh();
    for (const n of ['hlj-box', 'shop', 'gundamwiki']) assert.ok(t.lines.some((l) => l.includes(`kit 1 ${n}: refused (`) && l.endsWith('query="Gundam Aerial"')), n);
    assert.equal(t.lines.some((l) => l.includes('kit 1') && /https?:|\?/.test(l.replace(/\(.*?\)/g, ''))), false);
  }, fetch);
});

test('journal : démarrage du serveur, aucun job repris (état en mémoire)', async () => {
  await withJobs([], async (t) => {
    assert.ok(t.lines.includes('[photos] server start: no photo job resumed (job state is in memory)'));
  });
});

test('journal : durée, requêtes, attente de politesse et téléchargements par source, rien pour une source sans activité', async () => {
  const wiki = gundamWikiProvider({ fetch: async () => new Response('no', { status: 403 }), minIntervalMs: 40 });
  const idle = src('idle', refuses(REASONS.noCandidate));
  const hit = src('hit', () => ({ imageUrl: 'https://hit.test/i.png', pageUrl: 'https://hit.test/p' }));
  await withJobs([wiki, idle, hit], async (t) => {
    addRealKit(t.db, 1, 'HG 1/144 GUNDAM AERIAL');
    addRealKit(t.db, 2, 'HG 1/144 GUNDAM BARBATOS');
    await t.refresh();
    const line = (n) => t.lines.join("\n").split("\n").find((l) => l.startsWith(`[photos]   ${n}:`));
    assert.match(line('gundamwiki'), /, time \d+\.\ds, requests 2, polite wait \d+\.\ds$/);
    assert.ok(!/downloads/.test(line('gundamwiki')));
    assert.match(line('idle'), /: 2, time \d+\.\ds$/); // no gate, no download: no requests/wait/downloads fields
    assert.match(line('hit'), /, time \d+\.\ds, downloads 2 \(\d+\.\ds\)$/);
  });
});
