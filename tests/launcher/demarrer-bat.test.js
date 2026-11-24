// Exécute le vrai demarrer.bat dans un dossier temporaire, avec de faux node / powershell en tête du PATH
// (certutil, findstr et cmd sont les vrais : la somme SHA-256 est réellement calculée). Aucun téléchargement réel. Windows seulement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bat = readFileSync(new URL('../../demarrer.bat', import.meta.url), 'latin1').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
const sh = readFileSync(new URL('../../demarrer.sh', import.meta.url), 'utf8');
const ARCHIVE = 'fake-archive-bytes';
const GOOD = createHash('sha256').update(ARCHIVE).digest('hex');
const VERSION = bat.match(/^set "NODE_VERSION=(v24\.\d+\.\d+)"/m)[1];
const opts = { skip: process.platform !== 'win32' && 'Windows seulement' };

// Faux PowerShell : Invoke-WebRequest écrit l'archive ou un SHASUMS256.txt ; Expand-Archive « extrait » un vrai node.exe.
const psStub = `import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const { URL: url, OUT: out, ZIP: zip, DEST: dest, FAKE_HASH, FAKE_CURL_FAIL } = process.env;
if (process.argv.join(' ').includes('Expand-Archive')) {
  appendFileSync('log.txt', 'expand\\n');
  const dir = join(dest, basename(zip, '.zip'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(process.env.NODE_REAL, join(dir, 'node.exe'));
} else {
  appendFileSync('log.txt', 'curl ' + url + '\\n');
  if (FAKE_CURL_FAIL) process.exit(1);
  if (url.endsWith('SHASUMS256.txt')) writeFileSync(out, '0000  node-x-win-x86.zip\\n' + FAKE_HASH + '  ' + readFileSync('nom.txt', 'utf8') + '\\n');
  else (writeFileSync('nom.txt', basename(url)), writeFileSync(out, '${ARCHIVE}'));
}
`;

function lancerBat({ input = '', env = {}, twice = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'demarrer-bat-'));
  try {
    writeFileSync(join(dir, 'demarrer.bat'), bat, 'latin1');
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts', 'lancer.mjs'), "console.log('LANCEUR REEL OK');\n");
    mkdirSync(join(dir, 'stubs'));
    writeFileSync(join(dir, 'stubs', 'ps.mjs'), psStub);
    writeFileSync(join(dir, 'stubs', 'powershell.cmd'), '@"%NODE_REAL%" "%~dp0ps.mjs" %*\r\n');
    writeFileSync(join(dir, 'stubs', 'node.cmd'), '@if "%~1"=="--version" (echo %NODE_STUB_VERSION%) else echo LANCEUR OK %*\r\n');
    const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    const run = () =>
      spawnSync('cmd.exe', ['/d', '/c', '.\\demarrer.bat'], {
        cwd: dir,
        input,
        encoding: 'latin1', // demarrer.bat est en Windows-1252
        env: { ...process.env, NODE_TEST_CONTEXT: '', PATH: `${join(dir, 'stubs')};${system32}`, NODE_REAL: process.execPath, NODE_STUB_VERSION: 'v18.0.0', FAKE_HASH: GOOD, ...env },
      });
    const log = () => (existsSync(join(dir, 'log.txt')) ? readFileSync(join(dir, 'log.txt'), 'utf8') : '');
    const first = run();
    const firstLog = log();
    const last = twice ? run() : first;
    return { ...last, log: log(), firstLog, hasNodeDir: existsSync(join(dir, '.node')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Node système >= 24 : lancé directement, aucun téléchargement', opts, () => {
  const r = lancerBat({ env: { NODE_STUB_VERSION: 'v24.1.0' } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /LANCEUR OK scripts\\lancer\.mjs/);
  assert.equal(r.log, '');
});

test('Node trop ancien ou version illisible, refus du consentement : message, sortie non nulle, aucun téléchargement', opts, () => {
  for (const [version, input] of [['v23.99.99', 'n\r\n'], ['v18.0.0', ''], ['abc', 'non\r\n'], ['v24', '\r\n'], ['', 'n\r\n']]) {
    const r = lancerBat({ input, env: { NODE_STUB_VERSION: version } });
    assert.notEqual(r.status, 0, version);
    assert.match(r.stdout, /Node\.js 24 est nécessaire\. Le télécharger dans le dossier du site \(environ 30 Mo, aucun droit administrateur\) \? \[o\/N\]/);
    assert.match(r.stdout, /https:\/\/nodejs\.org/);
    assert.equal(r.log, '', 'aucun téléchargement');
    assert.equal(r.hasNodeDir, false);
  }
});

test('somme de contrôle fausse : arrêt, rien d’extrait, sortie non nulle', opts, () => {
  for (const FAKE_HASH of ['0'.repeat(64), '']) {
    const r = lancerBat({ input: 'o\r\n', env: { FAKE_HASH } });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /SHA-256 incorrecte/);
    assert.doesNotMatch(r.log, /expand/);
    assert.equal(r.hasNodeDir, false);
    assert.doesNotMatch(r.stdout, /LANCEUR/);
  }
});

test('consentement + bonne somme : téléchargement épinglé, extraction dans .node, lancement, réutilisation', opts, () => {
  const r = lancerBat({ input: 'o\r\n', twice: true });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /LANCEUR REEL OK/);
  assert.match(r.log, new RegExp(`curl https://nodejs\\.org/dist/${VERSION}/node-${VERSION}-win-x64\\.zip\n`));
  assert.match(r.log, new RegExp(`curl https://nodejs\\.org/dist/${VERSION}/SHASUMS256\\.txt\n`));
  assert.match(r.firstLog, /expand/);
  assert.equal(r.log, r.firstLog, 'le second lancement ne retélécharge rien');
});

test('échec réseau : message avec lien nodejs.org, sortie non nulle, rien d’extrait', opts, () => {
  const r = lancerBat({ input: 'o\r\n', env: { FAKE_CURL_FAIL: '1' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /téléchargement a échoué/);
  assert.match(r.stdout, /https:\/\/nodejs\.org/);
  assert.equal(r.hasNodeDir, false);
});

test('la version épinglée est la même dans les deux lanceurs et n’apparaît qu’une fois dans chacun', () => {
  assert.equal(bat.match(/v24\.\d+\.\d+/g).length, 1);
  assert.equal(sh.match(/v24\.\d+\.\d+/g).length, 1);
  assert.equal(sh.match(/^NODE_VERSION="(v24\.\d+\.\d+)"$/m)[1], VERSION);
});
