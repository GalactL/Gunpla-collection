import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { addKit, startApp, tmpDataDir } from '../helpers/index.js';

// Raw request: fetch() may not let tests choose Host/Origin freely.
const raw = (app, method, path, headers = {}, body) =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: app.server.address().port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });

const count = (app) => app.db.prepare('SELECT COUNT(*) n FROM copies').get().n;

test('API locale : Origin étranger, content-type détourné et Host étranger sont refusés ; usage normal OK', async () => {
  const tmp = tmpDataDir();
  const app = await startApp(tmp.dir);
  try {
    const kitId = addKit(app.db);
    const port = app.server.address().port;
    const host = `127.0.0.1:${port}`;
    const body = JSON.stringify({ kitId, status: 'possede' });
    const json = { host, 'content-type': 'application/json' };

    assert.equal((await raw(app, 'POST', '/api/copies', { ...json, origin: 'http://evil.example' }, body)).status, 403);
    assert.equal((await raw(app, 'POST', '/api/copies', { ...json, origin: 'null' }, body)).status, 403);
    assert.equal(count(app), 0);

    // CSRF "simple request": text/plain dont un paramètre contient application/json
    const sneaky = await raw(app, 'POST', '/api/copies', { host, 'content-type': 'text/plain;x=application/json' }, body);
    assert.ok([400, 415].includes(sneaky.status), String(sneaky.status));
    assert.equal(count(app), 0);

    // DNS rebinding : mauvais nom d'hôte, ou bon nom avec un autre port
    assert.equal((await raw(app, 'GET', '/api/kits', { host: 'evil.example' })).status, 403);
    assert.equal((await raw(app, 'GET', '/api/kits', { host: `localhost:${port + 1}` })).status, 403);

    // même origine (navigateur) : accepté, y compris charset et casse
    for (const [h, ct] of [
      [host, 'application/json'],
      [`localhost:${port}`, 'Application/JSON; charset=utf-8'],
    ]) {
      const ok = await raw(app, 'POST', '/api/copies', { host: h, origin: `http://${h}`, 'content-type': ct }, body);
      assert.equal(ok.status, 201);
    }
    assert.equal(count(app), 2);
    // GET avec Origin étranger : lecture, pas bloquée par la règle Origin
    assert.equal((await raw(app, 'GET', '/api/kits', { host, origin: 'http://evil.example' })).status, 200);
    assert.equal((await app.api('POST', '/api/copies', { kitId, status: 'possede' })).status, 201);
  } finally {
    await app.close();
    tmp.cleanup();
  }
});
