const WEEK_MS = 7 * 24 * 3600 * 1000;

// Last update = newest imported_at (every successful import touches it). Pure, for tests.
export const updateNeeded = (lastAt, now = Date.now()) => {
  const t = Date.parse(lastAt);
  return Number.isNaN(t) || now - t > WEEK_MS;
};

// Catalogue, then prices, then photos, one at a time, in the background. A step that fails (network) or is
// already running (a manual click, 409) is logged and skipped: it never blocks the next step or the server.
export function startAutoUpdate({ db, jobs, state, log = console.log, now = Date.now() }) {
  const { at } = db.prepare('SELECT MAX(imported_at) AS at FROM kits').get();
  if (state.running || !updateNeeded(at, now)) return Promise.resolve(false);
  state.running = true;
  return (async () => {
    for (const step of ['import', 'prices', 'photos']) {
      try {
        await jobs[step]();
        log(`[update] ${step} ok`);
      } catch (err) {
        log(`[update] ${step} skipped: ${err.message}`);
      }
    }
    state.running = false;
    return true;
  })();
}
