import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrenchDate, parseListing, parseMaquettesShelves } from '../../src/catalogue/parse.js';
import { fixture } from './fake-site.js';

test('parseListing page 1 : cartes, date ISO, page suivante', () => {
  const { kits, nextPage } = parseListing(fixture('shelf-13221-page1.html'));
  assert.equal(nextPage, 2);
  assert.equal(kits.length, 3);
  const [first, second] = kits;
  assert.deepEqual(first, {
    source_id: '1317371',
    raw_title: 'HG GQUUUUUUX ENDYMION UNIT AWAKENED',
    release_date: '2025-12-06',
    source_url: 'https://www.canalbd.net/manga-dokaze/articles/hg-gquuuuuux-endymion-unit-awakened-1317371/',
  });
  // series line + item name are joined
  assert.equal(second.raw_title, 'Mobile Suit Gundam - LEGEND GUNDAM');
  assert.equal(second.release_date, '2026-05-09');
});

test('parseListing dernière page : pas de page suivante, carte sans titre ignorée', () => {
  const { kits, nextPage } = parseListing(fixture('shelf-13221-last.html'));
  assert.equal(nextPage, null);
  assert.deepEqual(kits.map((k) => k.source_id), ['1113663']); // the untitled card (id 541965) is skipped
});

test('parseListing sans cartes', () => {
  assert.deepEqual(parseListing('<html></html>'), { kits: [], nextPage: null });
});

test('parseFrenchDate', () => {
  assert.equal(parseFrenchDate('06/12/25'), '2025-12-06');
  assert.equal(parseFrenchDate(' bientôt '), null);
});

test('parseMaquettesShelves ne lit que le bloc Maquettes du menu', () => {
  const shelves = parseMaquettesShelves(fixture('home-menu.html'));
  assert.deepEqual(shelves.slice(0, 4), [
    { id: '13221', label: 'Gunpla 1/144' },
    { id: '13222', label: 'Gunpla 1/100' },
    { id: '13223', label: 'Gunpla 1/60 1/48' },
    { id: '13233', label: 'Maquettes diverses' },
  ]);
  assert.equal(shelves.length, 14);
  assert.ok(!shelves.some((s) => /réservée|factice/i.test(s.label))); // the restricted links live in another menu block
});
