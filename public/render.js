// Shared by the server (first render) and the browser (updates): one template per element.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const PAGE = 48;
export const SORTS = [['recent', 'récents'], ['az', 'titre A → Z'], ['za', 'titre Z → A'], ['price_asc', 'prix croissant'], ['price_desc', 'prix décroissant']];
// « HG,RG » -> ['HG','RG']: trimmed, no empty items, no duplicates, capped.
export const gradeList = (s) => [...new Set(String(s ?? '').split(',').map((g) => g.trim()).filter(Boolean))].slice(0, 10);
export const STATUS = { souhaite: ['Souhaité', 1], possede: ['Possédé', 2], monte: ['Monté', 3] };
const GRADES = ['SD', 'EG', 'HG', 'RG', 'MG', 'MGEX', 'PG'];
const NB = ' ';

export const ICON = {
  refresh: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3v4H9M3 13V9h4M3.5 7A5 5 0 0 1 13 7M12.5 9A5 5 0 0 1 3 9"/></svg>',
  heart: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13S2 9.5 2 5.5A3 3 0 0 1 8 4a3 3 0 0 1 6 1.5C14 9.5 8 13 8 13z"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
};

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const money = (cents) => (cents == null ? null : euro.format(cents / 100));
export const frDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
// « 23/11 » from an ISO timestamp; null if missing or invalid.
export const shortDate = (iso) => {
  const d = new Date(iso ?? NaN);
  return Number.isNaN(d.getTime()) ? null : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
// Catalogue price line (never the price paid): text, or null when nothing was read.
export function priceLabel(cents, source, state, checkedAt) {
  const when = shortDate(checkedAt);
  const at = when ? ` · relevé le ${when}` : '';
  if (state === 'unavailable') return `Indisponible${at}`;
  if (state !== 'priced' || !Number.isInteger(cents) || cents < 0) return null;
  return `${money(cents)}${source === 'vendeur' ? ' · chez un vendeur' : ''}${at}`;
}
// Only an https URL on canalbd.net / www.canalbd.net, no userinfo, default port; else null.
export function canalLink(u) {
  let x;
  try {
    x = new URL(u);
  } catch {
    return null;
  }
  const ok = x.protocol === 'https:' && ['canalbd.net', 'www.canalbd.net'].includes(x.hostname) && !x.username && !x.password && !x.port;
  return ok ? x.href : null;
}
const canalAnchor = (k, href) =>
  `<a class="lk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Voir sur Canal BD<span class="vh"> : ${esc(k.title)} (nouvel onglet)</span></a>`;
// Card / row fragment. `cents` is the CATALOGUE price (price_cents on a card, catalogue_price_cents on a collection row).
export function priceBlock(k, cents) {
  const label = priceLabel(cents, k.price_source, k.price_state, k.price_checked_at);
  const href = canalLink(k.source_url);
  if (!label && !href) return '';
  return `<span class="pline">${label ? `<span class="pr">${esc(label)}</span>` : ''}${href ? ` ${canalAnchor(k, href)}` : ''}</span>`;
}
// End-of-run message of the price job (last = { priced, unavailable, errors, stopped }).
export function priceDone(last) {
  const l = last ?? {};
  const n = (x, w) => `${x ?? 0} ${w}${x > 1 ? 's' : ''}`;
  const counts = `${n(l.priced, 'prix relevé')}, ${n(l.unavailable, 'indisponible')}.`;
  if (l.stopped === 'blocked') return `Canal BD a bloqué ou limité les requêtes. ${counts}`;
  if (l.stopped === 'shape') return `Format de réponse inattendu : relevé interrompu. ${counts}`;
  return counts;
}
export const kitsLabel = (n) => `${n.toLocaleString('fr-FR')}${NB}kit${n > 1 ? 's' : ''}`;

// '' -> null, '42,90' / '42.9' / '1 234,5 €' -> cents, anything else -> undefined (invalid).
// At most 9 integer digits, so the cents stay a safe integer.
export function parsePrice(s) {
  const t = String(s ?? '').replace(/[\s  €]/g, '');
  if (!t) return null;
  if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(t)) return undefined;
  const [units, dec = ''] = t.split(/[.,]/);
  return Number(units) * 100 + Number(dec.padEnd(2, '0'));
}

const dash = `<span class="mut"><span aria-hidden="true">—</span><span class="vh">non renseigné</span></span>`;

export function plate(k, cls = '') {
  const parts = [k.grade, k.scale].filter(Boolean);
  return parts.length ? `<span class="plate ${cls}">${parts.map((p) => `<i>${esc(p)}</i>`).join(' ')}</span>` : '';
}

export const gauge = (status) =>
  `<span class="gauge g${STATUS[status][1]}" aria-hidden="true"><s></s><s></s><s></s></span><span class="glabel">${STATUS[status][0]}</span>`;

// A stored link is data, not HTML, and may be hostile: render it only if https, and always through esc().
const https = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
export const linkOf = (k) => (k.photo_file ? null : https(k.photo_link));
// Something to show: a local photo, else a usable link.
export const shown = (k) => Boolean(k.photo_file || linkOf(k));
// Next URL to try after `failed` could not load (link, then thumbnail), or null: show the « Introuvable » placeholder.
export const nextImage = (k, failed) => {
  const link = linkOf(k);
  const thumb = https(k.photo_thumb);
  return link && failed === link && thumb && thumb !== link ? thumb : null;
};
// Image search in a new tab: a plain link, no API, no key.
export const searchUrl = (k) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${k.title ?? ''} ${k.grade ?? ''} gunpla`.replace(/\s+/g, ' ').trim())}`;
export const missTray = (k, mini = false) =>
  mini
    ? '<div class="tray mini miss" aria-hidden="true"></div>'
    : `<div class="tray miss"><div class="box"><b>Introuvable</b><a class="lk" href="${esc(searchUrl(k))}" target="_blank" rel="noopener noreferrer">Chercher une photo<span class="vh"> : ${esc(k.title)} (nouvel onglet)</span></a></div><span class="dim dh" aria-hidden="true">? mm</span><span class="dim dw" aria-hidden="true">? mm</span></div>`;

// k.v (set by the browser after an upload) versions the URL; without it the server revalidates by ETag.
export function tray(k, kitId, mini = false) {
  const link = linkOf(k);
  if (link) {
    const alt = mini ? '' : `Image liée depuis le web : ${k.title}`;
    return `<div class="tray${mini ? ' mini' : ''}"><img src="${esc(link)}" data-thumb="${esc(https(k.photo_thumb) ?? '')}" alt="${esc(alt)}" referrerpolicy="no-referrer" loading="lazy" decoding="async"></div>`;
  }
  if (!k.photo_file) return missTray(k, mini);
  // Auto photos come from a wiki and are mecha artwork, not box photos: the alt text must not claim otherwise.
  const alt = mini ? '' : `${k.photo_kind === 'user' ? 'Photo personnelle' : 'Illustration trouvée automatiquement'} : ${k.title}`;
  return `<div class="tray${mini ? ' mini' : ''}"><img src="/photos/${kitId}${k.v ? `?v=${k.v}` : ''}" alt="${esc(alt)}" loading="lazy" decoding="async"></div>`;
}

// Ids to try for keyboard focus once ids[i] is gone or re-rendered: itself, the following ones, then the previous ones.
export const focusOrder = (ids, i) => [...ids.slice(i), ...ids.slice(0, Math.max(i, 0)).reverse()];

// « À vérifier » badge (text, not colour alone) + the button that clears it; only for an auto photo or a link that exists.
export const uncertain = (k, tag) =>
  shown(k) && k.photo_uncertain
    ? `<${tag} class="vrow"><span class="tag">À vérifier</span><button type="button" class="lk" data-act="verify">Photo vérifiée<span class="vh"> : ${esc(k.title)}</span></button></${tag}>`
    : '';

// Text badges (never colour alone): Supprimé (kit gone from Canal BD) and Nouveau (released < 30 days, not read).
export const goneTag = '<span class="tag gone">Supprimé</span>';
export const newTag = '<span class="tag hot">Nouveau</span>';
// Kit page: « Nouveau » + the button that marks it read (the browser removes the whole row in place).
export const readRow = (k) =>
  k.is_new ? `<p class="vrow rd">${newTag}<button type="button" class="lk" data-act="read">Marquer comme lu<span class="vh"> : ${esc(k.title)}</span></button></p>` : '';

// Two labelled keys: the heart is always paired with the word « Wishlist ». Visible text is contained in the accessible name.
const actions = (t) =>
  `<button type="button" class="key wish" data-act="wish" aria-label="Ajouter à ma wishlist" title="Ajouter à ma wishlist" aria-describedby="${t}">${ICON.heart}<span class="lbl">Wishlist</span></button><button type="button" class="key add" data-act="add" aria-label="Ajouter à ma collection" title="Ajouter à ma collection" aria-describedby="${t}">${ICON.plus}<span class="lbl">Collection</span></button>`;
// Price as shown on a card: big, without the reading date (the kit page keeps the full line and the Canal BD link).
export function cardPrice(k) {
  const c = k.price_cents;
  let inner = '';
  if (k.price_state === 'unavailable') inner = '<b class="off">Indisponible</b>';
  else if (k.price_state === 'priced' && Number.isInteger(c) && c >= 0) inner = `<b>${money(c).replace(/\s?€$/, '')}<i>€</i></b>${k.price_source === 'vendeur' ? '<span>chez un vendeur</span>' : ''}`;
  return `<p class="cprice">${inner}</p>`;
}
// Discreet « all good » mark: only for a photo that exists and is not waiting for a check.
export const okDot = (k) =>
  shown(k) && !k.photo_uncertain ? '<span class="ok" role="img" aria-label="Photo vérifiée" title="Photo vérifiée"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg></span>' : '';

// Fixed-height rows (grade + price, title, marker, spec, caption) keep the buttons aligned across a grid row.
export function card(k, owned = 0) {
  const t = `k${k.id}`;
  return `<article class="card" data-kit="${k.id}">${tray(k, k.id).replace(/<\/div>$/, `${okDot(k)}</div>`)}
<div class="prow">${plate(k, 'lg')}${cardPrice(k)}</div>
<h2 class="ttl" id="${t}"><a href="/kit/${k.id}">${esc(k.title)}</a></h2>
<p class="spec">${k.removed ? goneTag : ''}${k.is_new ? newTag : ''}<span class="tag">${esc(k.franchise ?? 'Autre')}</span>${k.series ? ` Série · <b>${esc(k.series)}</b>` : ''}</p>
<p class="mark">${owned ? `Dans ma collection · ${owned}` : ''}</p>
<div class="acts">${actions(t)}</div>
</article>`;
}

export const more = (shown, total) =>
  `<p class="more"${shown < total ? '' : ' hidden'}><button type="button" class="btn" data-act="more">Afficher plus</button> <span>${shown} sur ${total}</span></p>`;

// Cents -> the text typed in a price field: 8050 -> '80,50', 2000 -> '20'.
const eur = (c) => (c % 100 ? `${Math.floor(c / 100)},${String(c % 100).padStart(2, '0')}` : String(c / 100));
const priceRange = (f) => {
  const [a, b] = [f.price_min, f.price_max].map((v) => (v ? eur(Number(v)) : ''));
  return a && b ? ` entre ${a} et ${b}${NB}€` : a ? ` à partir de ${a}${NB}€` : b ? ` jusqu’à ${b}${NB}€` : '';
};

function noResults(f) {
  const what = `Aucun kit${f.new ? ' nouveau' : ''}${f.removed ? ' supprimé' : ''}${gradeList(f.grade).length ? ` ${gradeList(f.grade).join(', ')}` : ''}${f.scale ? ` en ${f.scale}` : ''}${f.franchise ? ` ${f.franchise}` : ''}${f.series ? ` de la série ${f.series}` : ''}${f.uncertain ? ' aux photos à vérifier' : ''}${priceRange(f)}${f.q ? ` pour «${NB}${f.q}${NB}»` : ''}.`;
  return `<div class="nores"><p>${esc(what)}</p><button type="button" class="btn" data-act="clear">Effacer les filtres</button></div>`;
}

export function results({ kits, total, owned = {} }, f = {}) {
  if (!kits.length) return noResults(f);
  // The endpoint marks every new kit: only offer it when the view is exactly Nouveautés (the count is then what gets marked).
  const only = f.new && Object.keys(f).every((k) => k === 'new' || k === 'sort');
  const all = only ? `<p class="readall"><button type="button" class="btn" data-act="readall">Tout marquer comme lu (${total})</button></p>` : '';
  return `${all}<div class="grid">${kits.map((k) => card(k, owned[k.id])).join('')}</div>${more(kits.length, total)}`;
}

const titleCard = (h, p, action) =>
  `<section class="titlecard" aria-labelledby="tc-h"><h2 id="tc-h">${h}</h2><p>${p}</p>${action}</section>`;

const den = (s) => Number(String(s).split('/')[1]) || 0;
const gradeRank = (g) => (GRADES.includes(g) ? GRADES.indexOf(g) : GRADES.length);
const plateBtn = (facet, value, on) =>
  `<button type="button" class="pbtn" data-facet="${facet}" data-value="${esc(value)}" aria-pressed="${on}"><span class="plate"><i>${esc(value)}</i></span></button>`;

const options = (list, selected, all) =>
  `<option value="">${all}</option>${list.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.value)}</option>`).join('')}`;
// The series list only holds the series of the chosen franchise (the server scopes it).
export const seriesOptions = (series, selected) => options(series, selected, 'Toutes les séries');

// Cards per row: − / + step from the current count (3 to 10), « Auto » fits the width; the browser remembers the choice.
export const densityPicker = () =>
  `<div class="dens" role="group" aria-label="Cartes par ligne"><span class="lab" aria-hidden="true">Zoom</span><button type="button" class="zoom" data-zoom="-1" aria-label="Moins de cartes par ligne">−</button><button type="button" class="zoom" data-zoom="1" aria-label="Plus de cartes par ligne">+</button><button type="button" data-cols="" aria-pressed="true">Auto<span class="vh"> : nombre de cartes adapté à la largeur</span></button></div>`;

export function catalogueMain({ facets, filters: f = {}, dbTotal, ...page }) {
  if (!dbTotal) {
    return `<h1 class="vh">Catalogue Maquettes</h1>${titleCard(
      'Le catalogue est vide.',
      'Importez les maquettes de Canal BD. La navigation reste possible pendant l’import.',
      `<button type="button" class="btn" data-act="import">${ICON.refresh}Actualiser</button>`,
    )}`;
  }
  const scales = [...facets.scales].sort((a, b) => den(b.value) - den(a.value));
  const grades = [...facets.grades].sort((a, b) => gradeRank(a.value) - gradeRank(b.value) || a.value.localeCompare(b.value));
  const active = ['scale', 'franchise', 'series', 'uncertain', 'new', 'removed'].filter((k) => f[k]).length + gradeList(f.grade).length + (f.price_min || f.price_max ? 1 : 0);
  const sort = f.sort || 'recent';
  return `<h1 class="vh">Catalogue Maquettes</h1>
<form class="strip" id="filters" action="/" method="get" role="search" aria-label="Filtrer le catalogue">
<input class="fld q" type="search" name="q" value="${esc(f.q)}" placeholder="Rechercher un kit ou une série" aria-label="Rechercher un kit ou une série">
<div class="count"><span id="count" aria-live="polite">${kitsLabel(page.total)}</span>${densityPicker()}</div>
<label class="sort"><span class="vh">Tri</span><select class="fld" name="sort">${SORTS.map(
    ([v, l]) => `<option value="${v}"${v === sort ? ' selected' : ''}>Tri : ${l}</option>`,
  ).join('')}</select></label>
<button type="button" class="btn filt-toggle" aria-expanded="false" aria-controls="facets">Filtres<span id="nfilt">${active ? ` (${active})` : ''}</span></button>
<div class="facets" id="facets">
<input type="hidden" name="scale" value="${esc(f.scale)}"><input type="hidden" name="grade" value="${esc(gradeList(f.grade).join(','))}">
<div class="band">
<div class="grp" role="group" aria-labelledby="l-grade"><span class="lab" id="l-grade">Grade</span>${grades.map((g) => plateBtn('grade', g.value, gradeList(f.grade).includes(g.value))).join('')}</div>
<div class="grp" role="group" aria-labelledby="l-scale"><span class="lab" id="l-scale">Échelle</span>${scales.map((s) => plateBtn('scale', s.value, s.value === f.scale)).join('')}</div>
</div>
<div class="band">
<label class="grp"><span class="lab">Franchise</span><select class="fld" name="franchise">${options(facets.franchises ?? [], f.franchise, 'Toutes les franchises')}</select></label>
<label class="grp"><span class="lab">Série</span><select class="fld" name="series">${seriesOptions(facets.series, f.series)}</select></label>
<div class="grp price" role="group" aria-labelledby="l-price"><span class="lab" id="l-price">Prix</span><label><span class="vh">Prix min (€)</span><input class="fld" name="price_min" inputmode="decimal" autocomplete="off" placeholder="Prix min (€)" value="${f.price_min ? eur(Number(f.price_min)) : ''}" aria-describedby="price-err"></label><span aria-hidden="true">–</span><label><span class="vh">Prix max (€)</span><input class="fld" name="price_max" inputmode="decimal" autocomplete="off" placeholder="Prix max (€)" value="${f.price_max ? eur(Number(f.price_max)) : ''}" aria-describedby="price-err"></label></div>
<div class="grp flags">
<label class="chk"><input type="checkbox" name="uncertain" value="1"${f.uncertain ? ' checked' : ''}> Photos à vérifier</label>
<label class="chk"><input type="checkbox" name="new" value="1"${f.new ? ' checked' : ''}> Nouveautés (<span id="nnew">${facets.news ?? 0}</span>)</label>
<label class="chk"><input type="checkbox" name="removed" value="1"${f.removed ? ' checked' : ''}> Supprimés (<span id="nrem">${facets.removed ?? 0}</span>)</label>
</div>
</div>
<p class="err" id="price-err" role="alert"></p>
</div>
</form>
<div id="results">${results(page, f)}</div>`;
}

export function row(c, nth) {
  // Explicit roles: below 640px the CSS turns rows and cells into grid/block boxes, which makes some
  // browsers drop the table semantics from the accessibility tree.
  return `<tr role="row" data-copy="${c.id}">
<td role="cell" class="c-th">${tray(c, c.kit_id, true)}</td>
<td role="cell" class="c-kit">${plate(c)}<button type="button" class="ttl" data-act="edit"><span class="vh">Modifier : </span>${esc(c.title)}</button>${uncertain(c, 'span')}${c.removed ? `<span class="vrow">${goneTag}</span>` : ''}<span class="sub">${esc(c.franchise ?? 'Autre')}${c.series ? ` · Série · ${esc(c.series)}` : ''}${nth ? ` · Exemplaire ${nth}` : ''}</span>${priceBlock(c, c.catalogue_price_cents)}<span class="fold">${[c.purchased_at, c.notes].filter(Boolean).map(esc).join(' · ')}</span></td>
<td role="cell" class="c-st">${gauge(c.status)}</td>
<td role="cell" class="num">${money(c.price_cents) ?? dash}</td>
<td role="cell" class="c-date">${frDate(c.purchased_on) ?? dash}</td>
<td role="cell" class="c-lieu">${c.purchased_at ? esc(c.purchased_at) : dash}</td>
<td role="cell" class="c-notes">${c.notes ? `<span class="note" title="${esc(c.notes)}">${esc(c.notes)}</span>` : dash}</td>
</tr>`;
}

// list = rows to show; all = every copy (numbers "Exemplaire N" among copies of the same kit).
export function ledger(list, all) {
  const totals = {};
  const nth = new Map();
  for (const c of [...all].sort((a, b) => a.id - b.id)) nth.set(c.id, (totals[c.kit_id] = (totals[c.kit_id] || 0) + 1));
  const th = (label, cls = '') => `<th role="columnheader" scope="col"${cls ? ` class="${cls}"` : ''}>${label}</th>`;
  return `<table class="ledger" role="table"><caption class="vh">Exemplaires de ma collection</caption><thead role="rowgroup"><tr role="row">${th('<span class="vh">Photo</span>')}${th('Kit')}${th('Statut')}${th('Prix payé', 'num')}${th("Date d'achat", 'c-date')}${th('Lieu', 'c-lieu')}${th('Notes', 'c-notes')}</tr></thead>
<tbody role="rowgroup">${list.map((c) => row(c, totals[c.kit_id] > 1 ? nth.get(c.id) : 0)).join('')}</tbody></table>`;
}

export const emptyCollection = () =>
  titleCard('Aucun exemplaire pour l’instant.', 'Ajoutez un kit depuis le catalogue, à votre wishlist ou à votre collection.', '<a class="btn" href="/">Parcourir le catalogue</a>');

const FILTERS_C = [['', 'Tous'], ['souhaite', 'Souhaités'], ['possede', 'Possédés'], ['monte', 'Montés']];
export const CSORTS = [['recent', 'ajout récent'], ['title', 'titre'], ['date', 'date d’achat'], ['price', 'prix payé']];

export function collectionMain(copies) {
  const n = (s) => copies.filter((c) => !s || c.status === s).length;
  const bar = `<div class="cbar"><div class="sfilter" role="group" aria-label="Filtrer par statut">${FILTERS_C.map(
    ([s, l]) => `<button type="button" data-status="${s}" aria-pressed="${!s}">${l} <span class="n">${n(s)}</span></button>`,
  ).join('')}</div>
<button type="button" class="btn" id="cunc" aria-pressed="false">Photos à vérifier</button>
<input class="fld q" type="search" id="cq" placeholder="Rechercher dans ma collection" aria-label="Rechercher dans ma collection">
<label class="csort"><span class="vh">Tri</span><select class="fld" id="csort">${CSORTS.map(([v, l]) => `<option value="${v}">Tri : ${l}</option>`).join('')}</select></label></div>`;
  const recent = [...copies].sort((a, b) => b.id - a.id);
  return `<h1 class="vh">Ma collection</h1>${copies.length ? bar : ''}<div id="ledger">${copies.length ? ledger(recent, copies) : emptyCollection()}</div>`;
}

// mode 'add' (from the catalogue: Possédé / Monté, nothing pre-selected) or 'edit' (any status).
export function editorHtml(mode, c, places = []) {
  const add = mode === 'add';
  const cur = add ? null : c.status;
  // In add mode c is a catalogue kit: its price_cents is the catalogue price, never the price paid.
  const price = add || c.price_cents == null ? '' : (c.price_cents / 100).toFixed(2).replace('.', ',');
  const opts = (add ? ['possede', 'monte'] : Object.keys(STATUS))
    .map((s) => `<label class="opt"><input type="radio" name="status" value="${s}"${s === cur ? ' checked' : ''}>${gauge(s)}</label>`)
    .join('');
  return `<div class="ed-head"><h2 id="ed-h" tabindex="-1">${add ? 'Ajouter à ma collection' : 'Modifier l’exemplaire'}</h2><button type="button" class="x" data-act="close" aria-label="Fermer">×</button></div>
<div class="ed-kit">${tray(c, add ? c.id : c.kit_id, true)}<div>${plate(c)}<p class="ed-title">${esc(c.title)}</p></div></div>
<fieldset class="status"><legend>Statut</legend>${opts}</fieldset>
<div class="fields">
<label>Prix payé (€)<input name="price" inputmode="decimal" autocomplete="off" placeholder="42,90" value="${price}" aria-describedby="ed-price-err"></label>
<p class="err" id="ed-price-err"></p>
<label>Date d'achat<input type="date" name="purchased_on" value="${esc(c.purchased_on)}"></label>
<label>Lieu d'achat<input name="purchased_at" list="ed-places" autocomplete="off" maxlength="200" value="${esc(c.purchased_at)}"></label>
<datalist id="ed-places">${places.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
<label>Notes<textarea name="notes" rows="4" maxlength="5000">\n${esc(c.notes)}</textarea></label>
</div>
<p class="err" id="ed-err" role="alert"></p>
<div class="ed-acts"><button type="submit" class="btn pri" id="ed-save"${cur ? '' : ' disabled'} aria-describedby="ed-hint">Enregistrer</button><button type="button" class="btn" data-act="close">Annuler</button></div>
<p class="hint" id="ed-hint">${cur ? '' : 'Choisissez Possédé ou Monté pour enregistrer.'}</p>
${add ? '' : '<div class="ed-del"><button type="button" class="btn warn" data-act="del">Supprimer l’exemplaire</button></div>'}
<div class="confirm" id="ed-confirm" role="group" aria-labelledby="cf-h" hidden></div>`;
}

// Photo status panel of the kit page: colour + icon + words say whether the photo was checked (never colour alone).
function photoPanel(k, t) {
  const replace = (cls) => `<button type="button" class="${cls}" data-act="photo" aria-describedby="${t}">Remplacer par ma photo</button>`;
  if (!shown(k))
    return `<div class="kph none" role="group" aria-labelledby="kph-h"><p class="kph-h" id="kph-h"><b>Aucune photo</b></p><p class="kpn">Ajoutez la vôtre pour reconnaître ce kit d’un coup d’œil.</p><div class="kph-acts">${`<button type="button" class="btn sm" data-act="photo" aria-describedby="${t}">Ajouter ma photo</button>`}</div></div>`;
  if (k.photo_kind === 'user')
    return `<div class="kph mine" role="group" aria-labelledby="kph-h"><p class="kph-h" id="kph-h">${okDot(k)}<b>Ma photo</b></p><div class="kph-acts">${replace('btn sm')}</div></div>`;
  const from = linkOf(k) ? 'Image liée depuis le web' : 'Illustration trouvée automatiquement';
  if (k.photo_uncertain)
    return `<div class="kph warn" role="group" aria-labelledby="kph-h"><p class="kph-h" id="kph-h"><span class="ic" aria-hidden="true">!</span><b>Photo non vérifiée</b><span class="tag">À vérifier</span></p><p class="kpn">${from} : elle peut ne pas correspondre à ce kit. Comparez-la, puis confirmez-la ou remplacez-la par la vôtre.</p><div class="kph-acts"><button type="button" class="btn sm blue" data-act="verify">Photo vérifiée<span class="vh"> : ${esc(k.title)}</span></button>${replace('btn sm')}</div></div>`;
  return `<div class="kph ok-s" role="group" aria-labelledby="kph-h"><p class="kph-h" id="kph-h">${okDot(k)}<b>Photo vérifiée</b></p><p class="kpn">${from}, confirmée.</p><div class="kph-acts">${replace('btn sm')}</div></div>`;
}
// Photo + status panel of the kit page, re-rendered in place after an upload or a check (no page reload).
export const photoMedia = (k, t = `k${k.id}`) => `${tray(k, k.id)}${photoPanel(k, t)}`;
// Dedicated page of one kit. `copies` = the copies of this kit (list rows from the service).
// Reading order: where it is (breadcrumb) > what it is (grade, title) > what it costs > what to do > details > my copies.
export function kitMain(k, copies = []) {
  const t = `k${k.id}`;
  const facts = [
    ['Franchise', k.franchise ?? 'Autre'],
    ['Série', k.series],
    ['Grade', k.grade],
    ['Échelle', k.scale],
    ['Sortie', frDate(k.release_date)],
    ['Rayon Canal BD', k.shelf],
  ].filter(([, v]) => v);
  const c = k.price_cents;
  const href = canalLink(k.source_url);
  const when = shortDate(k.price_checked_at);
  const priced = k.price_state === 'priced' && Number.isInteger(c) && c >= 0;
  const off = k.price_state === 'unavailable';
  const note = [priced && k.price_source === 'vendeur' ? 'chez un vendeur' : null, (priced || off) && when ? `relevé le ${when}` : null].filter(Boolean).join(' · ');
  const price =
    priced || off || href
      ? `<section class="kprice" aria-labelledby="kp-h"><h2 class="sec" id="kp-h">Prix catalogue</h2>${
          priced ? `<p class="kp"><b>${money(c)}</b></p>` : off ? '<p class="kp off"><b>Indisponible</b></p>' : ''
        }${note ? `<p class="kpn">${esc(note.charAt(0).toUpperCase() + note.slice(1))}</p>` : ''}${href ? `<p class="kpl">${canalAnchor(k, href)}</p>` : ''}</section>`
      : '';
  const mine = copies.length
    ? `<section class="kcopies" aria-labelledby="kc-h"><h2 class="sec" id="kc-h">Dans ma collection · ${copies.length}</h2><ul>${copies
        .map((x) => `<li>${gauge(x.status)}<span>${[money(x.price_cents), frDate(x.purchased_on), x.purchased_at].filter(Boolean).map(esc).join(' · ')}</span></li>`)
        .join('')}</ul><a class="lk" href="/collection">Ouvrir ma collection</a></section>`
    : '';
  return `<nav class="crumb" aria-label="Fil d’Ariane"><a href="/">← Catalogue Maquettes</a></nav>
<article class="card kit" data-kit="${k.id}">
<div class="kmedia">${photoMedia(k, t)}</div>
<div class="kinfo">${k.removed ? `<p class="kban" role="note">${goneTag} Ce kit n'est plus au catalogue Canal BD.</p>` : ''}<header class="khead">${plate(k)}<h1 class="kt" id="${t}">${esc(k.title)}</h1><p class="mark">${copies.length ? `Dans ma collection · ${copies.length}` : ''}</p></header>
${readRow(k)}${price}
<div class="acts">${actions(t)}</div>
<section class="kfacts" aria-labelledby="kf-h"><h2 class="sec" id="kf-h">Fiche</h2><dl class="facts">${facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl></section>
${mine}</div>
</article>`;
}
