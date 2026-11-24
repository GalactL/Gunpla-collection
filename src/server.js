import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb } from './db/index.js';
import { LOCAL_HOSTS, createRouter, hostWarning } from './routes/index.js';
import collection from './collection/routes.js';
import catalogue from './catalogue/routes.js';
import photos from './photos/routes.js';
import prices from './catalogue/prices-routes.js';
import web from './web/routes.js';
import { startAutoUpdate } from './update.js';

// Returns { server, db, dataDir, close() }; caller does server.listen(port).
export function createServer({ dataDir, allowedHosts }) {
  const db = openDb(dataDir);
  const router = createRouter({ allowedHosts });
  const jobs = {}; // start functions of the three background jobs, filled by their routes (each keeps its own `running` guard)
  const auto = { running: false };
  const ctx = { db, dataDir, jobs, auto };
  for (const register of [collection, catalogue, photos, prices, web]) register(router, ctx);
  router.add('GET', '/api/update/status', () => auto);
  const server = createHttpServer((req, res) => router.handle(req, res));
  return {
    server,
    db,
    dataDir,
    auto,
    startAutoUpdate: () => startAutoUpdate({ db, jobs, state: auto }), // explicit: tests never start it
    close: () =>
      new Promise((done) => {
        const finish = () => (db.close(), done());
        if (server.listening) server.close(finish);
        else finish();
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = resolve(process.env.DATA_DIR || './data');
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1'; // unauthenticated API: local only by default
  const warning = hostWarning(host);
  if (warning) console.error(warning);
  const app = createServer({ dataDir, allowedHosts: [...LOCAL_HOSTS, host.toLowerCase()] });
  app.server.listen(port, host, () => console.log(`Gunpla : http://${host === '127.0.0.1' ? 'localhost' : host}:${port} (données : ${dataDir})`));
  if (process.env.NODE_ENV !== 'test') app.startAutoUpdate();
}
