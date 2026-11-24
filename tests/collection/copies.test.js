import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addKit, startApp, tmpDataDir } from '../helpers/index.js';

let tmp, app, kitId;
const count = () => app.db.prepare('SELECT COUNT(*) AS n FROM copies').get().n;

before(async () => {
  tmp = tmpDataDir();
  app = await startApp(tmp.dir);
  kitId = addKit(app.db);
});
after(async () => {
  await app.close();
  tmp.cleanup();
});

test('POST sans status -> 400 et rien de créé', async () => {
  const r = await app.api('POST', '/api/copies', { kitId });
  assert.equal(r.status, 400);
  assert.equal(count(), 0);
});

test('POST status invalide -> 400 et rien de créé', async () => {
  for (const status of ['', 'owned', 'souhaité', null, 1]) {
    assert.equal((await app.api('POST', '/api/copies', { kitId, status })).status, 400);
  }
  assert.equal(count(), 0);
});

test('POST JSON invalide -> 400 ; kit inconnu -> 404', async () => {
  assert.equal((await app.api('POST', '/api/copies', '{oops')).status, 400);
  assert.equal((await app.api('POST', '/api/copies', { kitId: 99999, status: 'souhaite' })).status, 404);
  assert.equal(count(), 0);
});

test('création wishlist', async () => {
  const r = await app.api('POST', '/api/copies', { kitId, status: 'souhaite' });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'souhaite');
  assert.equal(r.body.kit_id, kitId);
  const list = await app.api('GET', '/api/copies');
  const row = list.body.find((c) => c.id === r.body.id);
  assert.equal(row.title, 'Kit 1');
  assert.equal(row.grade, 'MG');
  assert.equal(row.scale, '1/100');
  assert.equal(row.series, 'Gundam');
  assert.equal(row.franchise, 'Gundam');
  await app.api('DELETE', `/api/copies/${r.body.id}`);
});

test('deux exemplaires du même kit sont indépendants', async () => {
  const a = (await app.api('POST', '/api/copies', { kitId, status: 'possede', price_cents: 3000, purchased_on: '2026-01-02' })).body;
  const b = (await app.api('POST', '/api/copies', { kitId, status: 'possede', price_cents: 4500, purchased_on: '2026-03-04' })).body;
  assert.notEqual(a.id, b.id);
  await app.api('PATCH', `/api/copies/${a.id}`, { price_cents: 3500 });
  const list = (await app.api('GET', '/api/copies')).body;
  const ra = list.find((c) => c.id === a.id);
  const rb = list.find((c) => c.id === b.id);
  assert.equal(ra.price_cents, 3500);
  assert.equal(rb.price_cents, 4500);
  assert.equal(ra.purchased_on, '2026-01-02');
  assert.equal(rb.purchased_on, '2026-03-04');
  await app.api('DELETE', `/api/copies/${a.id}`);
  await app.api('DELETE', `/api/copies/${b.id}`);
});

test('changer le statut conserve les notes', async () => {
  const c = (await app.api('POST', '/api/copies', { kitId, status: 'souhaite', notes: 'Superbe kit' })).body;
  const r = await app.api('PATCH', `/api/copies/${c.id}`, { status: 'possede' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'possede');
  assert.equal(r.body.notes, 'Superbe kit');
  await app.api('PATCH', `/api/copies/${c.id}`, { status: 'monte' });
  assert.equal((await app.api('GET', '/api/copies')).body.find((x) => x.id === c.id).notes, 'Superbe kit');
  await app.api('DELETE', `/api/copies/${c.id}`);
});

test('PATCH validation', async () => {
  const c = (await app.api('POST', '/api/copies', { kitId, status: 'souhaite' })).body;
  const url = `/api/copies/${c.id}`;
  for (const bad of [
    { price_cents: -1 },
    { price_cents: 1.5 },
    { price_cents: '12' },
    { purchased_on: '2026-13-01' },
    { purchased_on: '2026-02-30' },
    { purchased_on: '01/02/2026' },
    { purchased_at: 5 },
    { notes: null },
    { status: 'nope' },
    { kit_id: 2 },
    {},
  ]) {
    assert.equal((await app.api('PATCH', url, bad)).status, 400, JSON.stringify(bad));
  }
  const ok = await app.api('PATCH', url, { price_cents: null, purchased_on: '2026-02-28', purchased_at: 'Canal BD' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.purchased_at, 'Canal BD');
  assert.equal((await app.api('PATCH', '/api/copies/99999', { notes: 'x' })).status, 404);
  await app.api('DELETE', url);
});

test('DELETE retire uniquement cet exemplaire', async () => {
  const a = (await app.api('POST', '/api/copies', { kitId, status: 'souhaite' })).body;
  const b = (await app.api('POST', '/api/copies', { kitId, status: 'souhaite' })).body;
  assert.equal((await app.api('DELETE', `/api/copies/${a.id}`)).status, 204);
  const ids = (await app.api('GET', '/api/copies')).body.map((c) => c.id);
  assert.ok(!ids.includes(a.id));
  assert.ok(ids.includes(b.id));
  assert.equal((await app.api('DELETE', `/api/copies/${a.id}`)).status, 404);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM kits').get().n, 1);
  await app.api('DELETE', `/api/copies/${b.id}`);
});

test('route inconnue -> 404 JSON', async () => {
  assert.equal((await app.api('GET', '/api/nope')).status, 404);
});
