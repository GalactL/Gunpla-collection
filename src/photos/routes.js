import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HttpError, sendJson } from '../routes/index.js';
import { fetchPhotos, providersToTry } from './fetch.js';
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

// ctx extras (tests): providers, fetch, now. Providers are ranked best first: HLJ, then the four Shopify stores (no key), then the Gundam wiki (last resort).
// The two last ones: name alone first (A-Z) or grade + name first (Las Cale), 500 ms apart.
export default function routes(router, { db, dataDir, providers, fetch, now, jobs = {} }) {
  providers ??= [
    hljProvider({ fetch }),
    shopifyProvider({ name: 'gundamplanet', host: 'gundamplanet.com', fetch }),
    shopifyProvider({ name: 'usagundamstore', host: 'usagundamstore.com', fetch }),
    shopifyProvider({ name: 'aztoyhobby', host: 'aztoyhobby.com', fetch, minIntervalMs: 500, forms: [false, true], tidy: true }),
    shopifyProvider({ name: 'lascalemodel', host: 'lascalemodel.com', fetch, minIntervalMs: 500, forms: [true, false], tidy: true }),
    gundamWikiProvider({ fetch }), // last resort: illustrations, always "a verifier"
  ];
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
    if (running) throw new HttpError(409, 'Une récupération de photos est déjà en cours');
    running = true;
    // Kits with no photo, plus auto photos a better-ranked source could improve; uploads are never touched.
    const todo = db
      .prepare('SELECT id FROM kits WHERE hidden = 0 ORDER BY id')
      .all()
      .map((r) => ({ kitId: r.id, wanted: providersToTry({ db, kitId: r.id, providers }) }))
      .filter((k) => k.wanted.length);
    const stats = {};
    progress = { tried: 0, found: 0, total: todo.length };
    const breaker = new Map(); // consecutive errors per source, for this job only
    return (async () => {
      try {
        // One stage per source, all at once (see fetchPhotos); a kit counts as tried when its last stage is done.
        await fetchPhotos({ db, dataDir, todo, providers, fetch, stats, breaker, force, now, onKit: (found) => (found && progress.found++, progress.tried++) });
        const { tried, found } = progress;
        console.log(`[photos] job done: ${JSON.stringify(stats)}`);
        last = { tried, found, missing: tried - found, sources: stats, at: new Date().toISOString() };
      } catch (err) {
        console.error(`[photos] refresh: ${err.message}`);
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
