import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { checkTag } from '../../scripts/release-check.mjs';

const root = new URL('../../', import.meta.url);
// Fins de ligne normalisées : un checkout Windows (autocrlf) peut rendre les workflows en CRLF.
const workflow = (f) => readFileSync(new URL(`.github/workflows/${f}`, root), 'utf8').replaceAll('\r\n', '\n');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('checkTag : le tag doit être « v » + la version', () => {
  assert.equal(checkTag('v1.0.0', '1.0.0'), true);
  assert.equal(checkTag('v1.0.1', '1.0.0'), false);
  assert.equal(checkTag('1.0.0', '1.0.0'), false, '« v » manquant');
  assert.equal(checkTag('v1.0.0-rc.1', '1.0.0'), false, 'préversion != version finale');
  assert.equal(checkTag('v1.0.0-rc.1', '1.0.0-rc.1'), true);
  assert.equal(checkTag('', '1.0.0'), false);
});

test('le script sort en erreur si le tag diffère de package.json, en succès sinon', () => {
  const run = (TAG) => spawnSync(process.execPath, ['scripts/release-check.mjs'], { cwd: root, env: { ...process.env, TAG }, encoding: 'utf8' });
  assert.equal(run(`v${pkg.version}`).status, 0);
  const bad = run('v0.0.0');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /v0\.0\.0/);
  assert.equal(run('').status, 1);
});

test('package-lock.json suit la version de package.json', () => {
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

// Lit le zip produit : entrées, mode unix (attributs externes) et contenu.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16;
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    entries.set(name, { mode, data: () => (method === 8 ? inflateRawSync(raw) : raw) });
    p += 46 + nameLen + skip;
  }
  return entries;
}

const WHITELIST = ['src', 'public', 'scripts', 'demarrer.bat', 'demarrer.sh', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.gitattributes'];
const git = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root });

test('le zip de release contient exactement la liste blanche et garde modes et fins de ligne', { skip: git.status !== 0 && 'git ou dépôt indisponible' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  try {
    const out = join(dir, 'test.zip');
    // Même commande que .github/workflows/release.yml, avec HEAD à la place du tag.
    const r = spawnSync('git', ['archive', '--format=zip', '--prefix=gunpla-collection/', '-o', out, 'HEAD', '--', ...WHITELIST], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    // Le workflow et ce test ne doivent pas diverger : même préfixe, mêmes entrées.
    const cmd = workflow('release.yml').match(/git archive[\s\S]*?(?=\n\s*- |\s*$)/)[0].split(/\s+/).filter(Boolean);
    assert.ok(cmd.includes('--prefix=gunpla-collection/'), 'préfixe absent du workflow');
    assert.deepEqual(cmd.slice(cmd.indexOf('--') + 1), WHITELIST);
    const entries = readZip(readFileSync(out));
    const names = [...entries.keys()];
    const tops = new Set(names.map((n) => n.split('/')[1]).filter(Boolean));
    assert.ok(names.every((n) => n.startsWith('gunpla-collection/')));
    for (const w of WHITELIST) assert.ok(tops.has(w), `${w} manquant`);
    for (const t of tops) assert.ok(WHITELIST.includes(t), `${t} ne devrait pas être dans le zip`);
    assert.equal(entries.get('gunpla-collection/demarrer.sh').mode & 0o777, 0o755);
    const sh = entries.get('gunpla-collection/demarrer.sh').data();
    assert.ok(!sh.includes(13), 'demarrer.sh doit rester en LF');
    const bat = entries.get('gunpla-collection/demarrer.bat').data().toString('latin1');
    assert.ok(bat.includes('\r\n') && !/[^\r]\n/.test(bat), 'demarrer.bat doit rester en CRLF');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('les workflows : actions épinglées par SHA, aucune expression ${{ }} injectée dans un run:', () => {
  for (const f of ['release.yml', 'ci.yml']) {
    const y = workflow(f);
    for (const m of y.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${f} : ${m[1]} non épinglée`);
    for (const m of y.matchAll(/^\s*run:\s*(.*)$/gm)) assert.ok(!m[1].includes('${{'), `${f} : expression dans run: ${m[1]}`);
  }
  const rel = workflow('release.yml');
  assert.match(rel, /permissions:\s*\n\s+contents: write/);
});
