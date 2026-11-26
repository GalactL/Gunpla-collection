import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HttpError, sendJson } from '../routes/index.js';
import { RULES_VERSION, fetchPhotos, providersToTry, summarize } from './fetch.js';
import { gundamWikiProvider } from './gundamwiki.js';
import { hljProvider } from './provider.js';
import { shopifyProvider } from './shopify.js';
import { MAX_BYTES, MIME, getLink, getPhoto, photosDir, savePhoto } from './store.js';

// Strict positive integer BEFORE the id is used anywhere (path traversal guard).
function kitIdOf(raw) {
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new HttpError(404, 'Introuvable');
  return Number(raw);
}

// Raw request body, capped. Keeps draining (without storing) past the cap so the
// client gets the 413 instead of a connection reset.
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BYTES) chunks.push(c);
      else if (size > 4 * MAX_BYTES) req.destroy();
    });
    req.on('end', () =>
      size > MAX_BYTES ? reject(new HttpError(413, 'Image trop volumineuse (8 Mo max)')) : resolve(Buffer.concat(chunks)),
    );
    req.on('error', reject);
  });
}

// ctx extras (tests): providers, fetch, now. Providers are ranked best first: HLJ, then the five Shopify stores (no key), then the Gundam wiki (last resort).
// Catalogue (whole products.json, once per job) for the two complete shops, from the `minKits`-th kit that ARRIVES at the shop (kits skipped by a remembered
// refusal or found by a better source never arrive): the kits before it use the kit search, so a run with few new kits pays no catalogue, and one with many
// pays at most about (minKits - 1) kit searches more than the catalogue alone. minKits = about pages / 2 + 1 (ski rental: ~1 request per kit search, so
// the searches made before switching cost less than the catalogue itself). The kits that reach a late shop are those the better sources did not find,
// and a kit absent from a shop costs 2-3 requests (two forms, relaxed query), so the threshold is not raised above that.
// Honest figures for "divided by at least 10" (400 arriving kits, tests/photos/catalogue.test.js): held for lascalemodel (9 vs 400 requests), gundamplanet (12 requests) and
// japanfigure (15 requests). NOT held for aztoyhobby on the real base: at most ~171 kits arrive there, so about 3 to 4x after the threshold (19 kit searches + 40 pages),
// ~8.5x with the catalogue alone at 2 requests per search; 10x only in the synthetic case of 400 kits all arriving at ~2 requests per search (1 request per search: 6.8x, measured).
// The two last ones: name alone first (A-Z) or grade + name first (Las Cale), 500 ms apart.
export default function routes(router, { db, dataDir, providers, fetch, now, jobs = {} }) {
  providers ??= [
    hljProvider({ fetch }),
    // Collection catalogues (#49), minKits (arrivals, see above) = pages / 2 + 1: gundamplanet 1910 kits = 8 requests -> 5; japanfigure 2427 kits = 10 requests -> 6.
    // Known risk: a kit absent from the collection is a miss (no fallback to the kit search, or the gain disappears); coverage measured on a small sample
    // (63 to 86 kits, not the 413 real ones): 95.8 % gundamplanet (the 3 misses are third-party brands, not Bandai), 100 % japanfigure; collection handles
    // are not checked over time (collection gone -> HTTP 404 -> kit search + one log line, already handled).
    shopifyProvider({ name: 'gundamplanet', host: 'gundamplanet.com', fetch, catalogue: { path: '/collections/gunpla/products.json', minKits: 5 } }),
    // No catalogue for usagundamstore: no single collection holds the Gunpla; the union of 9 collections covers 95.2 %, judged too fragile.
    shopifyProvider({ name: 'usagundamstore', host: 'usagundamstore.com', fetch }),
    shopifyProvider({ name: 'aztoyhobby', host: 'aztoyhobby.com', fetch, minIntervalMs: 500, forms: [false, true], tidy: true, catalogue: { minKits: 20 } }),
    shopifyProvider({ name: 'lascalemodel', host: 'lascalemodel.com', fetch, minIntervalMs: 500, forms: [true, false], tidy: true, catalogue: { minKits: 4 } }),
    shopifyProvider({ name: 'japanfigure', host: 'japan-figure.com', fetch, minIntervalMs: 500, tidy: true, catalogue: { path: '/collections/gundam-gunpla-kit/products.json', minKits: 6 } }), // same known risk as gundamplanet above
    gundamWikiProvider({ fetch }), // last resort: illustrations, always "a verifier"
  ];
  console.error('[photos] server start: no photo job resumed (job state is in memory)');
  let running = false;
  let last = null;
  let progress = null; // { tried, found, total } while running

  router.add('PUT', '/api/kits/:id/photo', async (req, res, { params }) => {
    const kitId = kitIdOf(params.id);
    return savePhoto({ db, dataDir, kitId, bytes: await readRaw(req), kind: 'user' });
  });

  // Confirms an auto photo or a link: clears the 'a verifier' mark only (kind, file and updated_at stay as they are).
  router.add('POST', '/api/kits/:id/photo/verified', (req, res, { params }) => {
    const kitId = kitIdOf(params.id);
    if (!getPhoto(db, kitId)) {
      if (!getLink(db, kitId)?.url) throw new HttpError(404, 'Photo introuvable');
      db.prepare('UPDATE image_links SET uncertain = 0 WHERE kit_id = ?').run(kitId);
      return { link: true, uncertain: 0 };
    }
    db.prepare('UPDATE photos SET uncertain = 0 WHERE kit_id = ?').run(kitId);
    const { file, kind } = getPhoto(db, kitId);
    return { file, kind, uncertain: 0 };
  });

  router.add('GET', '/api/photos/status', () => ({ running, last, progress }));

  // Starts the job; resolves when it ends (never rejects). The page polls /status, the auto update awaits it.
  jobs.photos = ({ force = false } = {}) => {
    if (running) {
      console.error(`[photos] refresh refused (409): a job is already running (${progress?.tried}/${progress?.total} kits done)`);
      throw new HttpError(409, 'Une récupération de photos est déjà en cours');
    }
    running = true;
    const started = Date.now();
    // Kits with no photo, plus auto photos a better-ranked source could improve; uploads are never touched.
    const todo = db
      .prepare('SELECT id FROM kits WHERE hidden = 0 ORDER BY id')
      .all()
      .map((r) => ({ kitId: r.id, wanted: providersToTry({ db, kitId: r.id, providers }) }))
      .filter((k) => k.wanted.length);
    const stats = {};
    console.error(`[photos] job start: ${todo.length} kits, force ${force ? 'yes' : 'no'}, rules v${RULES_VERSION}, sources: ${providers.map((p) => p.name).join(' > ')}`);
    progress = { tried: 0, found: 0, total: todo.length };
    const breaker = new Map(); // consecutive errors per source, for this job only
    return (async () => {
      try {
        // One stage per source, all at once (see fetchPhotos); a kit counts as tried when its last stage is done.
        await fetchPhotos({ db, dataDir, todo, providers, fetch, stats, breaker, force, now, onKit: (found) => (found && progress.found++, progress.tried++) });
        const { tried, found } = progress;
        console.error([`[photos] job done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${tried} kits tried, ${found} found`, ...summarize(stats)].join('\n'));
        last = { tried, found, missing: tried - found, sources: stats, at: new Date().toISOString() };
      } catch (err) {
        console.error(`[photos] refresh failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${err.message}`);
        last = { error: err.message, at: new Date().toISOString() };
      } finally {
        running = false;
        progress = null;
      }
    })();
  };
  // ?force=1 asks again the sources that refused a kit in the last 7 days.
  router.add('POST', '/api/photos/refresh', (req, res, { query }) => {
    jobs.photos({ force: query.get('force') === '1' });
    sendJson(res, 202, { running: true });
  });

  router.add('GET', '/photos/:kitId', (req, res, { params, query }) => {
    const row = getPhoto(db, kitIdOf(params.kitId));
    if (!row) throw new HttpError(404, 'Photo introuvable');
    const etag = `"${row.updated_at}"`;
    // Same URL after a replacement: long cache only when the caller versions it (?v=...).
    const headers = { etag, 'cache-control': query.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (req.headers['if-none-match'] === etag) return void (res.writeHead(304, headers), res.end());
    // The file name comes from the DB row only; basename is belt and braces.
    const ext = row.file.split('.').pop();
    let body;
    try {
      body = readFileSync(join(photosDir(dataDir), basename(row.file)));
    } catch {
      throw new HttpError(404, 'Photo introuvable');
    }
    res.writeHead(200, { ...headers, 'content-type': MIME[ext] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  });
}
