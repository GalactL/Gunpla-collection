import { HttpError, sendJson } from '../routes/index.js';
import { politeGate } from '../photos/provider.js';
import { DEFAULT_DELAY_MS, fetchOffers, isChallenge, parseOffers } from './prices.js';

const MAX_STREAK = 5;

// ctx extras (tests): fetch, delayMs. The job only ever sends plain GETs, never cookies, never follows redirects.
export default function routes(router, { db, fetch = globalThis.fetch, delayMs = DEFAULT_DELAY_MS, jobs = {} }) {
  let running = false;
  let last = null;
  let progress = null; // { done, total } while running

  const write = db.prepare(
    'UPDATE kits SET price_cents = ?, price_source = ?, price_state = ?, price_checked_at = ? WHERE id = ?',
  );

  async function job() {
    const kits = db.prepare('SELECT id, source_id, release_date, source_url FROM kits WHERE hidden = 0 ORDER BY id').all();
    const s = { priced: 0, unavailable: 0, errors: 0, skipped: 0, stopped: null };
    progress = { done: 0, total: kits.length };
    try {
      let streak = 0; // consecutive per-kit errors in response order; MAX_STREAK in a row = the site is failing or turning us away
      let stop = false; // shared by both lanes: once set, nobody starts a new request
      const halt = new Error('halt');
      // One start slot per delayMs for the whole job (both lanes). Input errors throw in fetchOffers before reaching it.
      const turn = politeGate(delayMs);
      const gated = async (url, init) => {
        await turn();
        if (stop) throw halt;
        return fetch(url, init);
      };
      const stopWith = (why) => ((s.stopped ??= why), (stop = true));
      // Per-kit error (nothing stored); the breaker trips on the MAX_STREAK-th in a row (one log line, stopped 'blocked').
      const failed = (kit, why) => {
        s.errors++;
        progress.done++;
        if (++streak < MAX_STREAK) return console.error(`[prices] kit ${kit.id}: ${why}`);
        stopWith('blocked');
        console.error(`[prices] stopped at kit ${kit.id}: ${MAX_STREAK} consecutive errors (${why})`);
      };
      let next = 0;
      const lane = async () => {
        while (!stop && next < kits.length) {
          const kit = kits[next++];
          let res;
          try {
            res = await fetchOffers({ fetch: gated, sourceId: kit.source_id, releaseDate: kit.release_date, referer: kit.source_url });
          } catch (err) {
            if (err === halt) return;
            if (err?.code !== 'input') {
              failed(kit, 'request failed'); // transient: nothing stored
              continue;
            }
            s.skipped++; // no request was sent for this kit
            progress.done++;
            continue;
          }
          if (res.status === 403 || res.status === 429 || (res.status === 200 && isChallenge(res.html) && !/product-offers/.test(res.html))) {
            stopWith('blocked');
            console.error(`[prices] stopped at kit ${kit.id}: blocked (HTTP ${res.status})`);
            return;
          }
          if (res.status >= 500 || res.status === 404 || res.status === 410) {
            failed(kit, `HTTP ${res.status}`);
            continue;
          }
          let offer;
          try {
            if (res.status !== 200) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'shape' }); // 3xx, 401...: not the fragment
            offer = parseOffers(res.html);
          } catch (err) {
            if (err?.code !== 'shape') throw err;
            stopWith('shape');
            console.error(`[prices] stopped at kit ${kit.id}: unexpected response shape (HTTP ${res.status}), nothing stored`);
            return;
          }
          const priced = offer.state === 'priced';
          write.run(priced ? offer.cents : null, priced ? offer.source : null, offer.state, new Date().toISOString(), kit.id);
          s[offer.state]++;
          streak = 0;
          progress.done++;
        }
      };
      let crash;
      const run = () => lane().catch((e) => ((crash ??= e), (stop = true)));
      await Promise.all([run(), run()]); // two lanes
      if (crash) throw crash;
      return s;
    } finally {
      last = { ...s, at: new Date().toISOString() };
    }
  }

  router.add('GET', '/api/prices/status', () => ({ running, last, progress }));

  // Starts the job; resolves when it ends (never rejects).
  jobs.prices = () => {
    if (running) throw new HttpError(409, 'Un relevé de prix est déjà en cours');
    running = true;
    return job()
      .then((s) => console.log(`[prices] job done: ${JSON.stringify(s)}`))
      .catch((err) => {
        console.error(`[prices] refresh: ${err.message}`);
        last = { priced: 0, unavailable: 0, errors: 1, skipped: 0, stopped: null, error: err.message, at: new Date().toISOString() };
      })
      .finally(() => {
        running = false;
        progress = null;
      });
  };
  router.add('POST', '/api/prices/refresh', (req, res) => {
    jobs.prices();
    sendJson(res, 202, { running: true });
  });
}
