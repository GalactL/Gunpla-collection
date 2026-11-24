// Exécute le vrai demarrer.sh dans un dossier temporaire, avec des faux node / curl / tar / uname en tête du PATH.
// Aucun téléchargement réel. Ignoré si bash est absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const script = readFileSync(new URL('../../demarrer.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const ARCHIVE = 'fake-archive-bytes';
const GOOD = createHash('sha256').update(ARCHIVE).digest('hex');
const VERSION = script.match(/^NODE_VERSION="(v24\.\d+\.\d+)"$/m)[1];

const stubs = {
  // Faux node : « --version » renvoie NODE_STUB_VERSION, sinon il annonce qu'il lance le script.
  node: '[ "$1" = --version ] && echo "${NODE_STUB_VERSION:-v18.0.0}" || echo "LANCEUR OK $*"',
  uname: 'echo "${FAKE_UNAME:-x86_64}"',
  // Faux curl : journalise l'URL, écrit l'archive ou un SHASUMS256.txt (avec une ligne leurre).
  curl: `for a; do url=$a; done
while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
echo "curl $url" >> log.txt
[ -n "$FAKE_CURL_FAIL" ] && exit 22
case $url in
  */SHASUMS256.txt)
    printf '%s  node-x-linux-ppc64le.tar.xz\\n%s  %s\\n' 0000 "$FAKE_HASH" "$(cat nom.txt)" > "$out" ;;
  *) basename "$url" > nom.txt; printf '%s' '${ARCHIVE}' > "$out" ;;
esac`,
  // Faux wget (utilisé seulement si curl est absent) : journalise ses options, écrit comme le faux curl.
  wget: `echo "wget $*" >> log.txt
while [ $# -gt 0 ]; do [ "$1" = -O ] && out=$2; shift; done
printf '%s' x > "$out"`,
  // Faux tar : crée .node/bin/node (un faux node 24) dans le dossier donné par -C.
  tar: `while [ $# -gt 0 ]; do [ "$1" = -C ] && d=$2; shift; done
echo "tar $d" >> log.txt
mkdir -p "$d/bin"
printf '#!/bin/sh\\n[ "$1" = --version ] && echo v24.19.0 || echo "LANCEUR OK $*"\\n' > "$d/bin/node"
chmod +x "$d/bin/node"`,
};

function lancerSh({ input = '', env = {}, prepare, twice = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'demarrer-sh-'));
  try {
    writeFileSync(join(dir, 'demarrer.sh'), script);
    mkdirSync(join(dir, 'stubs'));
    for (const [nom, corps] of Object.entries(stubs)) {
      writeFileSync(join(dir, 'stubs', nom), `#!/bin/sh\n${corps}\n`);
      chmodSync(join(dir, 'stubs', nom), 0o755);
    }
    prepare?.(dir);
    const run = () => spawnSync('bash', ['-c', 'PATH="$PWD/stubs:/usr/bin:/bin" exec bash demarrer.sh'], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, FAKE_HASH: GOOD, ...env } });
    const log = () => (existsSync(join(dir, 'log.txt')) ? readFileSync(join(dir, 'log.txt'), 'utf8') : '');
    const result = run();
    const firstLog = log();
    const last = twice ? run() : result; // deuxième lancement : .node/ est réutilisé
    return { ...last, log: log(), firstLog, hasNodeDir: existsSync(join(dir, '.node')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const opts = { skip: !hasBash && 'bash absent' };

test('Node système >= 24 : lancé directement, aucun téléchargement', opts, () => {
  const r = lancerSh({ env: { NODE_STUB_VERSION: 'v24.1.0' } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /LANCEUR OK scripts\/lancer\.mjs/);
  assert.equal(r.log, '');
});

test('Node trop ancien ou version illisible, refus du consentement : message, sortie non nulle, aucun téléchargement', opts, () => {
  for (const [version, input] of [['v23.99.99', 'n\n'], ['v18.0.0', ''], ['n’importe quoi', 'non\n'], ['', '\n']]) {
    const r = lancerSh({ input, env: { NODE_STUB_VERSION: version } });
    assert.notEqual(r.status, 0, version);
    assert.match(r.stdout, /Node\.js 24 est nécessaire\. Le télécharger dans le dossier du site \(environ 30 Mo, aucun droit administrateur\) \? \[o\/N\]/);
    assert.match(r.stderr, /https:\/\/nodejs\.org/);
    assert.equal(r.log, '', 'aucun appel curl');
    assert.equal(r.hasNodeDir, false);
  }
});

test('somme de contrôle fausse : arrêt, rien d’extrait, sortie non nulle', opts, () => {
  const r = lancerSh({ input: 'o\n', env: { FAKE_HASH: GOOD.replace(/^./, (c) => (c === '0' ? '1' : '0')) } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SHA-256 incorrecte/);
  assert.doesNotMatch(r.log, /^tar /m);
  assert.equal(r.hasNodeDir, false);
  assert.doesNotMatch(r.stdout, /LANCEUR OK/);
});

test('somme absente du SHASUMS256.txt : même refus', opts, () => {
  const r = lancerSh({ input: 'o\n', env: { FAKE_HASH: '' } });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.log, /^tar /m);
});

test('consentement + bonne somme : téléchargement épinglé, extraction dans .node, lancement, réutilisation', opts, () => {
  const r = lancerSh({ input: 'o\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LANCEUR OK scripts\/lancer\.mjs/);
  assert.match(r.log, new RegExp(`curl https://nodejs\\.org/dist/${VERSION}/node-${VERSION}-linux-x64\\.tar\\.xz\n`));
  assert.match(r.log, new RegExp(`curl https://nodejs\\.org/dist/${VERSION}/SHASUMS256\\.txt\n`));
  assert.match(r.log, /tar \.node/);
});

test('wget (sans curl) : --https-only ; curl : protocole https imposé', opts, () => {
  assert.match(script, /curl -fsSL --proto '=https' --tlsv1\.2/);
  // On extrait la fonction telecharger() du vrai script et on la lance en faisant croire que curl est absent.
  const fonction = script.match(/^telecharger\(\) \{\n[\s\S]*?\n\}\n/m)[0];
  const dir = mkdtempSync(join(tmpdir(), 'demarrer-wget-'));
  try {
    mkdirSync(join(dir, 'stubs'));
    writeFileSync(join(dir, 'stubs', 'wget'), `#!/bin/sh\n${stubs.wget}\n`);
    chmodSync(join(dir, 'stubs', 'wget'), 0o755);
    const code = `command() { [ "$2" = curl ] && return 1; builtin command "$@"; }\n${fonction}\ntelecharger https://nodejs.org/dist/x out.bin`;
    const r = spawnSync('bash', ['-c', `PATH="$PWD/stubs:/usr/bin:/bin"; ${code}`], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(dir, 'log.txt'), 'utf8'), /^wget -q --https-only .* -O out\.bin https:\/\/nodejs\.org\/dist\/x$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('arm64 : archive linux-arm64 ; architecture inconnue : refus avant toute question', opts, () => {
  const arm = lancerSh({ input: 'o\n', env: { FAKE_UNAME: 'aarch64' } });
  assert.equal(arm.status, 0, arm.stderr);
  assert.match(arm.log, new RegExp(`node-${VERSION}-linux-arm64\\.tar\\.xz`));
  const autre = lancerSh({ input: 'o\n', env: { FAKE_UNAME: 'riscv64' } });
  assert.notEqual(autre.status, 0);
  assert.match(autre.stderr, /Architecture non gérée/);
  assert.doesNotMatch(autre.stdout, /Node\.js 24 est nécessaire/);
  assert.equal(autre.log, '');
});

test('échec réseau : message avec lien nodejs.org, sortie non nulle, rien d’extrait', opts, () => {
  const r = lancerSh({ input: 'o\n', env: { FAKE_CURL_FAIL: '1' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /téléchargement a échoué/);
  assert.match(r.stderr, /https:\/\/nodejs\.org/);
  assert.equal(r.hasNodeDir, false);
});

test('copie .node/ trop ancienne : le consentement est redemandé', opts, () => {
  const r = lancerSh({
    input: 'n\n',
    prepare: (dir) => {
      mkdirSync(join(dir, '.node', 'bin'), { recursive: true });
      writeFileSync(join(dir, '.node', 'bin', 'node'), '#!/bin/sh\necho v22.4.1\n');
      chmodSync(join(dir, '.node', 'bin', 'node'), 0o755);
    },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Node\.js 24 est nécessaire/);
});

test('copie .node/ valide réutilisée sans téléchargement', opts, () => {
  const r = lancerSh({
    prepare: (dir) => {
      mkdirSync(join(dir, '.node', 'bin'), { recursive: true });
      writeFileSync(join(dir, '.node', 'bin', 'node'), '#!/bin/sh\n[ "$1" = --version ] && echo v24.0.0 || echo "LANCEUR OK $*"\n');
      chmodSync(join(dir, '.node', 'bin', 'node'), 0o755);
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LANCEUR OK/);
  assert.equal(r.log, '');
});

test('la version de Node n’est épinglée qu’à un seul endroit', () => {
  assert.equal(script.match(/v24\.\d+\.\d+/g).length, 1);
});
