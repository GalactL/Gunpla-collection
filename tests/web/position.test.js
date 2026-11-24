import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_KEPT, chunks, fromCatalogue, keyOf, parseSaved } from '../../public/position.js';
import { kitMain } from '../../public/render.js';

test('keyOf : chemin + query', () => assert.equal(keyOf('/', '?grade=HG'), 'pos:/?grade=HG'));

test('parseSaved : valide, ignore le périmé / corrompu sans lever', () => {
  assert.deepEqual(parseSaved('{"loaded":96,"scrollY":1234.6}'), { loaded: 96, scrollY: 1235 });
  for (const bad of [null, '', '{', 'null', '[]', '{"loaded":"9","scrollY":0}', '{"loaded":-1,"scrollY":0}', '{"loaded":0,"scrollY":0}', '{"loaded":5,"scrollY":-3}', '{"loaded":5}', '{"loaded":1e999,"scrollY":0}', undefined, 42])
    assert.equal(parseSaved(bad), null, String(bad));
  assert.equal(parseSaved(`{"loaded":${MAX_KEPT + 50},"scrollY":0}`).loaded, MAX_KEPT);
});

test('chunks : requêtes de 100 max, de ce qui est déjà affiché jusqu’au nombre voulu', () => {
  assert.deepEqual(chunks(48, 48), []);
  assert.deepEqual(chunks(250, 48), [
    { offset: 48, limit: 100 },
    { offset: 148, limit: 100 },
    { offset: 248, limit: 2 },
  ]);
  assert.equal(chunks(9999, 0).reduce((n, c) => n + c.limit, 0), MAX_KEPT);
});

test('fromCatalogue : seulement un référent du catalogue de même origine', () => {
  const o = 'http://localhost:3000';
  assert.equal(fromCatalogue(`${o}/`, o), true);
  assert.equal(fromCatalogue(`${o}/?grade=HG&sort=price`, o), true);
  for (const r of ['', undefined, 'http://evil.test/', `${o}/collection`, `${o}/kit/3`, 'pas une url']) assert.equal(fromCatalogue(r, o), false, String(r));
});

test('fiche kit : le fil d’Ariane garde un vrai href', () => {
  const html = kitMain({ id: 1, title: 'RX-78-2', price_state: 'unknown' }, []);
  assert.match(html, /<nav class="crumb"[^>]*><a href="\/">← Catalogue Maquettes<\/a>/);
});
