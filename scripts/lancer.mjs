// Logique commune de demarrer.bat / demarrer.sh : dépendances, serveur, navigateur. Node >= 24, aucune dépendance.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_NODE = '24.0.0'; // le même minimum que `engines.node` dans package.json

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m && m.slice(1).map(Number);
};

// -1 / 0 / 1, ou null si l'une des deux versions est invalide.
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const satisfiesMinimum = (v, min = MIN_NODE) => {
  const c = compareVersions(v, min);
  return c !== null && c >= 0;
};

// PORT absent ou vide : 3000. Sinon un entier de 1 à 65535, ou null (invalide).
export function portFrom(env) {
  const v = String(env.PORT ?? '').trim();
  if (v === '') return 3000;
  return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535 ? Number(v) : null;
}
export const siteUrl = (port) => `http://localhost:${port}`;

export const openCommand = (platform, url) =>
  platform === 'win32' ? { cmd: 'cmd', args: ['/c', 'start', '', url] } : { cmd: 'xdg-open', args: [url] };

// Notre site répond sur /api/update/status par un objet JSON avec un booléen `running`.
export const isOurSite = (status, body) => {
  if (status !== 200) return false;
  try {
    return typeof JSON.parse(body)?.running === 'boolean';
  } catch {
    return false;
  }
};

// 'ours' (notre site tourne déjà), 'other' (un autre programme répond sur ce port) ou 'free' (rien ne répond).
export const probe = (port) =>
  new Promise((done) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/update/status', timeout: 1000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => body.length < 65536 && (body += c)); // shortcut: lecture bornée, un autre programme peut renvoyer n'importe quoi
      res.on('end', () => done(isOurSite(res.statusCode, body) ? 'ours' : 'other'));
      res.on('error', () => done('other'));
    });
    req.on('error', () => done('free')).on('timeout', () => (req.destroy(), done('free')));
    req.end();
  });

// Retourne le code de sortie. `start()` renvoie le processus serveur (événement 'exit') ; `stopped()` dit si l'utilisateur a demandé l'arrêt (signal) : sortie normale, code 0.
export async function lancer({ port, stopped = () => false, hasModules, probe, install, start, open, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 30000 }) {
  const url = siteUrl(port);
  const present = await probe(port);
  if (present === 'other') {
    log(`Le port ${port} est déjà utilisé par un autre programme. Fermez-le ou relancez avec un autre port (PORT=...).`);
    return 1;
  }
  if (present === 'ours') {
    log(`Le site tourne déjà : ${url}`);
    open(url);
    return 0;
  }
  if (!hasModules()) {
    log('Installation des dépendances (une seule fois)…');
    const code = await install();
    if (code) {
      log("npm install a échoué : vérifiez la connexion internet, puis relancez.");
      return code;
    }
  }
  const server = start();
  let exited = null;
  const done = new Promise((r) => server.once('exit', (c) => r((exited = c ?? 1))));
  let opened = false;
  for (let t = 0; exited === null && !opened && t < timeoutMs; t += 250) {
    if ((await probe(port)) === 'ours') (open(url), (opened = true));
    else await sleep(250);
  }
  if (!opened && exited === null) log(`Le serveur ne répond pas encore ; ouvrez ${url} à la main quand il est prêt.`);
  return done.then((code) => (stopped() ? 0 : code));
}

async function main() {
  if (!satisfiesMinimum(process.version)) {
    console.error(`Node.js ${MIN_NODE} ou plus récent est nécessaire (version trouvée : ${process.version}). https://nodejs.org`);
    return 1;
  }
  const port = portFrom(process.env);
  if (port === null) {
    console.error(`Le port « ${process.env.PORT} » n'est pas valide : indiquez un nombre entre 1 et 65535.`);
    return 1;
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const run = (cmd, args, opts) => spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  let server;
  let stopped = false;
  // Ctrl+C, fermeture du terminal, kill : arrêter le serveur (lancer() sort alors avec son code) ; sans serveur encore démarré, sortir.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => ((stopped = true), server ? server.kill() : process.exit(1)));
  return lancer({
    port,
    stopped: () => stopped,
    log: console.log,
    hasModules: () => existsSync(new URL('../node_modules', import.meta.url)),
    probe,
    install: () => new Promise((r) => run('npm install', [], { shell: true }).on('error', () => r(1)).on('exit', (c) => r(c ?? 1))),
    start: () => (server = run(process.execPath, ['src/server.js'])),
    open: (url) => {
      const { cmd, args } = openCommand(process.platform, url);
      spawn(cmd, args, { stdio: 'ignore', detached: true })
        .on('error', () => console.log(`Ouvrez ${url} dans votre navigateur.`))
        .unref();
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
