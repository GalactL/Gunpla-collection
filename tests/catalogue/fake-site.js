import { readFileSync } from 'node:fs';

const FIX = new URL('../fixtures/canalbd/', import.meta.url);
const read = (name) => readFileSync(new URL(name, FIX), 'utf8');
export const fixture = read;

// 13233 and 13230 are outside the scope: the importer must never ask for them (it still serves them if it does).
const SHELF_FILES = { 13222: 'shelf-13222.html', 13223: 'shelf-13223.html', 13233: 'shelf-13233.html', 13230: 'shelf-13222.html' };

// Evangelion shelf (no fixture file): an Evangelion kit, a kit with no franchise keyword, and a kit already
// listed on 13222 (Siegfried VF-31C), so one kit appears on two shelves.
const card = (id, title, date) => `<article class="card-book"><h3><span class="subtitle"><a href="/manga-dokaze/articles/${id}-x-${id}/">${title}</a></span></h3><div class="on-sale"><strong>${date}</strong></div></article>`;
const EVANGELION = `<html><body><section class="six-landscape-grid">${[
  card(1400001, 'BAN0001 EVANGELION GUNPLA EVA-01 TEST TYPE', '01/02/26'),
  card(1400002, 'BAN0002 NEO TOKYO PROTOTYPE', '02/02/26'),
  card(1272841, 'HG VF-31C SIEGFRIED', '03/02/26'),
].join('')}</section></body></html>`;
const EMPTY = '<html><body><section class="six-landscape-grid"></section></body></html>';

// fetch() stand-in serving the fixtures; `requested` records every URL asked for.
export function fakeSite({ failOn } = {}) {
  const requested = [];
  const fetch = async (url) => {
    requested.push(url);
    const u = new URL(url);
    const shelf = u.searchParams.get('shelf');
    if (failOn?.(u)) throw new TypeError('fetch failed');
    let body;
    if (u.pathname === '/manga-dokaze/') body = read('home-menu.html');
    else if (shelf === '13224') body = EVANGELION;
    else if (shelf === '13221') body = read(u.searchParams.get('page') === '2' ? 'shelf-13221-last.html' : 'shelf-13221-page1.html');
    else body = SHELF_FILES[shelf] ? read(SHELF_FILES[shelf]) : EMPTY;
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, requested };
}

export const EXPECTED_KITS = 14; // 4 (13221) + 5 (13222) + 3 (13223) + 2 (13224); the third 13224 card repeats 13222
