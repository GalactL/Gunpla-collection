import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, tmpDataDir } from '../helpers/index.js';

let tmp, app;
before(async () => {
  tmp = tmpDataDir();
  app = await startApp(tmp.dir);
});
after(async () => {
  await app.close();
  tmp.cleanup();
});

test('polices auto-hébergées : aucune référence Google, woff2 servis avec le bon type', async () => {
  const html = await (await fetch(app.base + '/')).text();
  const css = await (await fetch(app.base + '/assets/app.css')).text();
  assert.doesNotMatch(html + css, /fonts\.(googleapis|gstatic)\.com/);
  const files = [...css.matchAll(/url\(\/assets\/fonts\/([a-z0-9-]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 4);
  for (const f of files) {
    const res = await fetch(`${app.base}/assets/fonts/${f}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), 'wOF2');
  }
  assert.equal((await fetch(app.base + '/assets/fonts/..%2Fapp.css')).status, 404);
  assert.equal((await fetch(app.base + '/assets/fonts/inconnue.woff2')).status, 404);
});

test('suivi des photos : message français si le serveur a redémarré', () => {
  const js = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /Le serveur a redémarré pendant la recherche\. Relancez « Actualiser les photos »\./);
});
