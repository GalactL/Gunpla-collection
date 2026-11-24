import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../routes/index.js';
import catalogueRoutes from '../catalogue/routes.js';
import { listCopies } from '../collection/service.js';
import { ICON, PAGE, SORTS, catalogueMain, collectionMain, esc, kitMain, kitsLabel } from '../../public/render.js';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', woff2: 'font/woff2' };
const FILTERS = ['q', 'grade', 'scale', 'franchise', 'series', 'uncertain', 'new', 'removed', 'sort', 'price_min', 'price_max'];

const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function shell({ view, title, h, main, boot, updating }) {
  const tab = (v, href, label, n, id) =>
    `<a href="${href}"${v === view || (v === 'catalogue' && view === 'kit') ? ' aria-current="page"' : ''}>${label} <small id="${id}">${n.toLocaleString('fr-FR')}</small></a>`;
  const status = h.at ? `Importé le ${new Date(h.at).toLocaleDateString('fr-FR')} · ${kitsLabel(h.kits)}` : 'Catalogue jamais importé';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} · Archive maquettes</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css">
<script>document.documentElement.classList.add('js');try{const n=+localStorage.getItem('cols');if(n>=3&&n<=10){const s=document.documentElement.style;s.setProperty('--cols',n);s.setProperty('--min','0px');s.setProperty('--mc',Math.min(n,3));s.setProperty('--tc',Math.min(n,5))}}catch{}</script>
<script type="module" src="/assets/app.js"></script>
</head>
<body data-view="${view}">
<a class="skip" href="#main">Aller au contenu</a>
<header class="tb">
<nav class="tabs" aria-label="Vues">${tab('catalogue', '/', 'Catalogue Maquettes', h.kits, 'n-kits')}${tab('collection', '/collection', 'Ma collection', h.copies, 'n-copies')}</nav>
<div class="sync">
<p id="sync-status" role="status">${updating ? "Mise à jour en cours… La navigation reste possible." : status}</p>
<div class="sbar" role="group" aria-label="Actualiser">
<button type="button" class="sb" id="act-import" aria-label="Actualiser le catalogue">${ICON.refresh}Catalogue</button>
<button type="button" class="sb" id="act-photos" aria-label="Actualiser les photos">${ICON.refresh}Photos</button>
<button type="button" class="sb" id="act-prices" aria-label="Actualiser les prix">${ICON.refresh}Prix</button>
</div>
</div>
</header>
<div class="stripe" id="stripe"${updating ? "" : " hidden"}></div>
<main id="main" tabindex="-1">${main}</main>
<div id="toast" class="toast" role="status"></div>
<dialog id="editor" class="panel" aria-labelledby="ed-h"><div class="frame"><form id="ed-form" class="inner" novalidate></form></div></dialog>
<input type="file" id="file" accept="image/jpeg,image/png,image/webp" hidden>
<script type="application/json" id="boot">${json(boot)}</script>
</body>
</html>`;
}

function send(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

export default function routes(router, { db, auto = {} }) {
  // The catalogue API handlers, called in-process, so the first page is exactly what /api/kits returns.
  const api = {};
  catalogueRoutes({ add: (method, path, fn) => (api[`${method} ${path}`] = fn) }, { db });

  const header = () => {
    const k = db.prepare('SELECT COUNT(*) AS n, MAX(imported_at) AS at FROM kits WHERE hidden = 0 AND removed = 0').get();
    return { kits: k.n, at: k.at, copies: db.prepare('SELECT COUNT(*) AS n FROM copies').get().n };
  };
  const places = () =>
    db.prepare("SELECT DISTINCT purchased_at AS p FROM copies WHERE purchased_at <> '' ORDER BY p COLLATE NOCASE").all().map((r) => r.p);

  router.add('GET', '/', (req, res, { query }) => {
    const filters = {};
    for (const k of FILTERS) if (query.get(k)?.trim()) filters[k] = query.get(k).trim();
    for (const k of ['uncertain', 'new', 'removed']) if (filters[k] !== '1') delete filters[k];
    if (filters.new) delete filters.removed; // mutually exclusive: Nouveautés wins in a hand-typed URL
    for (const k of ['price_min', 'price_max']) if (filters[k] && !/^\d+$/.test(filters[k])) delete filters[k];
    if (Number(filters.price_min) > Number(filters.price_max)) delete filters.price_min, delete filters.price_max;
    if (filters.sort && !SORTS.some(([s]) => s === filters.sort)) delete filters.sort;
    const page = api['GET /api/kits'](req, res, { query: new URLSearchParams({ ...filters, limit: PAGE }) });
    const owned = Object.fromEntries(db.prepare('SELECT kit_id, COUNT(*) AS n FROM copies GROUP BY kit_id').all().map((r) => [r.kit_id, r.n]));
    const h = header();
    const main = catalogueMain({ facets: api['GET /api/kits/facets'](req, res, { query: new URLSearchParams(filters) }), filters, dbTotal: h.kits, ...page, owned });
    send(res, shell({ view: 'catalogue', updating: auto.running, title: 'Catalogue Maquettes', h, main, boot: { kits: page.kits, owned, places: places(), copyTotal: h.copies } }));
  });

  router.add('GET', '/kit/:id', (req, res, { params }) => {
    const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : 0;
    const kit = id && api['GET /api/kits'](req, res, { query: new URLSearchParams({ id, limit: 1 }) }).kits[0];
    if (!kit) throw new HttpError(404, 'Kit introuvable');
    const copies = listCopies(db).filter((c) => c.kit_id === id);
    const h = header();
    const owned = { [id]: copies.length };
    send(res, shell({ view: 'kit', updating: auto.running, title: kit.title, h, main: kitMain(kit, copies), boot: { kits: [kit], owned, places: places(), copyTotal: h.copies } }));
  });

  router.add('GET', '/collection', (req, res) => {
    const copies = listCopies(db);
    const h = header();
    send(res, shell({ view: 'collection', updating: auto.running, title: 'Ma collection', h, main: collectionMain(copies), boot: { copies, places: places(), copyTotal: h.copies } }));
  });

  // public/ and public/fonts/ only: the name is whitelisted before it touches the filesystem.
  const asset = (dir, re, cache) => (req, res, { params }) => {
    const m = re.exec(params.file);
    if (!m) throw new HttpError(404, 'Introuvable');
    let body;
    try {
      body = readFileSync(join(PUBLIC, dir, params.file));
    } catch {
      throw new HttpError(404, 'Introuvable');
    }
    res.writeHead(200, { 'content-type': TYPES[m[1]], 'cache-control': cache, 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  router.add('GET', '/assets/:file', asset('', /^[a-z0-9-]+\.(css|js|svg)$/, 'no-cache'));
  router.add('GET', '/assets/fonts/:file', asset('fonts', /^[a-z0-9-]+\.(woff2)$/, 'public, max-age=86400'));
}
