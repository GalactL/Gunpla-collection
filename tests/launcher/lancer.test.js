import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVersions, satisfiesMinimum, portFrom, siteUrl, openCommand, lancer, isOurSite, probe } from '../../scripts/lancer.mjs';

test('satisfiesMinimum : 24.0.0 et 24.0.1 acceptés, 23.99.99 refusé, préfixe v toléré', () => {
  for (const v of ['24.0.0', 'v24.0.0', '24.0.1', 'v24.1.3', 'v25.0.0', 'v24.19.0\n']) assert.equal(satisfiesMinimum(v), true, v);
  for (const v of ['23.99.99', 'v23.11.0', 'v22.4.1', 'v18.20.0']) assert.equal(satisfiesMinimum(v), false, v);
});

test('chaînes invalides refusées sans plantage', () => {
  for (const v of ['', 'abc', 'v24', '24.0', 'v24.x.1', '24.0.0.1', '--help', null, undefined, 24, {}]) assert.equal(satisfiesMinimum(v), false, String(v));
});

test('compareVersions compare major.minor.patch en entier', () => {
  assert.equal(compareVersions('24.0.0', 'v24.0.0'), 0);
  assert.equal(compareVersions('24.0.1', '24.0.0'), 1);
  assert.equal(compareVersions('24.9.0', '24.10.0'), -1);
  assert.equal(compareVersions('v23.99.99', '24.0.0'), -1);
  assert.equal(compareVersions('nope', '24.0.0'), null);
});

test('port et URL : PORT respecté, 3000 par défaut (absent ou vide), invalide refusé', () => {
  for (const env of [{}, { PORT: '' }, { PORT: '  ' }]) assert.equal(portFrom(env), 3000);
  assert.equal(portFrom({ PORT: '4321' }), 4321);
  assert.equal(portFrom({ PORT: '1' }), 1);
  assert.equal(portFrom({ PORT: '65535' }), 65535);
  for (const v of ['99999', '-1', '1.5', 'abc', '0', '65536', '1e3', '80 80']) assert.equal(portFrom({ PORT: v }), null, v);
  assert.equal(siteUrl(4321), 'http://localhost:4321');
});

test('PORT invalide : message en français, sortie 1, sans trace (vrai processus)', () => {
  for (const PORT of ['99999', '-1', '1.5', 'abc']) {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/lancer.mjs', import.meta.url))], { env: { ...process.env, PORT }, encoding: 'utf8' });
    assert.equal(r.status, 1, PORT);
    assert.equal(r.stderr.trim(), `Le port « ${PORT} » n'est pas valide : indiquez un nombre entre 1 et 65535.`);
  }
});

test("commande d'ouverture : start sous Windows, xdg-open sous Linux", () => {
  assert.deepEqual(openCommand('win32', 'http://localhost:3000'), { cmd: 'cmd', args: ['/c', 'start', '', 'http://localhost:3000'] });
  assert.deepEqual(openCommand('linux', 'http://localhost:3000'), { cmd: 'xdg-open', args: ['http://localhost:3000'] });
});

// lancer() : orchestration avec dépendances simulées. `child` : le faux serveur, qui s'arrête de lui-même avec `exitCode`.
function deps({ exitCode = 0, ...over } = {}) {
  const calls = [];
  const d = {
    calls,
    port: 3000,
    log: () => {},
    sleep: async () => {},
    hasModules: () => true,
    probe: async () => 'free',
    install: async () => (calls.push('install'), 0),
    start: () => {
      calls.push('start');
      const child = new EventEmitter();
      setTimeout(() => child.emit('exit', exitCode), 10);
      return child;
    },
    open: (url) => calls.push(`open ${url}`),
    ...over,
  };
  return d;
}
const upAfter = (n) => {
  let i = 0;
  return async () => (++i > n ? 'ours' : 'free');
};

test('serveur déjà présent : pas de second serveur, le navigateur s’ouvre quand même', async () => {
  const d = deps({ probe: async () => 'ours', hasModules: () => false });
  assert.equal(await lancer(d), 0);
  assert.deepEqual(d.calls, ['open http://localhost:3000']);
});

test('node_modules absent : npm install, puis démarrage, puis ouverture une fois le serveur prêt', async () => {
  const d = deps({ hasModules: () => false, probe: upAfter(2) });
  assert.equal(await lancer(d), 0);
  assert.deepEqual(d.calls, ['install', 'start', 'open http://localhost:3000']);
});

test('node_modules présent : pas de npm install', async () => {
  const d = deps({ probe: upAfter(1) });
  await lancer(d);
  assert.deepEqual(d.calls, ['start', 'open http://localhost:3000']);
});

test('échec de npm install : code non nul, serveur non démarré', async () => {
  const d = deps({ hasModules: () => false, install: async () => 7 });
  assert.equal(await lancer(d), 7);
  assert.deepEqual(d.calls, []);
});

test('serveur qui s’arrête avant de répondre : son code est renvoyé, rien n’est ouvert', async () => {
  const d = deps({ exitCode: 3 });
  assert.equal(await lancer(d), 3);
  assert.deepEqual(d.calls, ['start']);
});

test('port pris par un autre programme : message clair, sortie non nulle, ni serveur ni navigateur', async () => {
  const logs = [];
  const d = deps({ probe: async () => 'other', log: (m) => logs.push(m), hasModules: () => false });
  assert.equal(await lancer(d), 1);
  assert.deepEqual(d.calls, []);
  assert.deepEqual(logs, ['Le port 3000 est déjà utilisé par un autre programme. Fermez-le ou relancez avec un autre port (PORT=...).']);
});

test('isOurSite : seul un 200 avec un objet JSON { running: booléen } est notre site', () => {
  assert.equal(isOurSite(200, '{"running":false}'), true);
  assert.equal(isOurSite(200, '{"running":true,"step":"prix"}'), true);
  for (const [status, body] of [[200, '<html></html>'], [200, '{"running":"oui"}'], [200, 'null'], [200, '[]'], [404, '{"running":false}'], [200, '']]) assert.equal(isOurSite(status, body), false, `${status} ${body}`);
});

test('probe sur un vrai socket : ours / other / free', async () => {
  const serve = (status, body) =>
    new Promise((ok) => {
      const srv = createServer((req, res) => (res.writeHead(status), res.end(body))).listen(0, '127.0.0.1', () => ok(srv));
    });
  const ours = await serve(200, '{"running":false}');
  const other = await serve(200, '<html>autre</html>');
  const [po, pa] = [ours.address().port, other.address().port];
  assert.equal(await probe(po), 'ours');
  assert.equal(await probe(pa), 'other');
  ours.close();
  other.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await probe(po), 'free');
});

test('arrêt demandé par l’utilisateur (signal) : sortie 0 ; vrai plantage : code du serveur, ou 1 si null', async () => {
  assert.equal(await lancer(deps({ exitCode: 1, stopped: () => true })), 0);
  assert.equal(await lancer(deps({ exitCode: 3, stopped: () => false })), 3);
  assert.equal(await lancer(deps({ exitCode: null })), 1);
});

test('.gitignore ignore .node/', () => {
  const lines = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('.node/'));
});
