import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { addKit, startApp, tmpDataDir } from '../helpers/index.js';
import { openDb } from '../../src/db/index.js';

test('démarrage sur un dossier neuf (inexistant) puis données persistantes après réouverture', async () => {
  const tmp = tmpDataDir();
  const dataDir = join(tmp.dir, 'nouveau', 'data');
  try {
    let app = await startApp(dataDir);
    assert.ok(existsSync(join(dataDir, 'gunpla.db')));
    assert.deepEqual((await app.api('GET', '/api/copies')).body, []);
    const kitId = addKit(app.db);
    const c = (await app.api('POST', '/api/copies', { kitId, status: 'monte', notes: 'ok', price_cents: 1234 })).body;
    await app.close();

    // Reopen via the app (migrations must be idempotent), then via raw openDb.
    app = await startApp(dataDir);
    const rows = (await app.api('GET', '/api/copies')).body;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, c.id);
    assert.equal(rows[0].notes, 'ok');
    assert.equal(rows[0].price_cents, 1234);
    await app.close();

    const db = openDb(dataDir);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM copies').get().n, 1);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.close();
  } finally {
    tmp.cleanup();
  }
});
