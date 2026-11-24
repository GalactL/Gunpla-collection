import { PAGE, card, photoMedia, focusOrder, missTray, nextImage, shown, catalogueMain, editorHtml, emptyCollection, esc, gradeList, kitsLabel, ledger, parsePrice, priceDone, results, seriesOptions } from './render.js';
import { chunks, fromCatalogue, keyOf, parseSaved } from './position.js';

const $ = (s, r = document) => r.querySelector(s);
const on = (type, sel, fn) =>
  document.addEventListener(type, (e) => {
    const t = e.target.closest?.(sel);
    if (t) fn(t, e);
  });

const boot = JSON.parse($('#boot').textContent);
const view = document.body.dataset.view;
const kits = new Map((boot.kits || []).map((k) => [k.id, k]));
const owned = boot.owned || {};
const places = new Set(boot.places);
let copies = boot.copies || [];
let copyTotal = boot.copyTotal;

async function api(method, url, body) {
  // A network failure rejects with an English TypeError: say it in French instead.
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) }).catch(() => {
    throw Object.assign(new Error('serveur injoignable'), { status: 0 });
  });
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.error || `erreur ${r.status}`), { status: r.status });
  return data;
}

/* Toast: polite live region, one optional action.
   A toast with an action (Annuler) never times out: the toast sits after <main> in tab order, so a keyboard
   user could not reach it in a few seconds. It goes away on the action, on « Fermer », on Escape or on the next toast. */
const toastEl = $('#toast');
let toastTimer;
let sticky = false;
const clearToast = () => toastEl.replaceChildren();
function toast(msg, action) {
  clearTimeout(toastTimer);
  sticky = !!action;
  toastEl.replaceChildren(Object.assign(document.createElement('span'), { textContent: msg }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: action.label });
    b.onclick = () => {
      clearToast();
      action.run();
    };
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: 'Fermer' });
    x.onclick = clearToast;
    toastEl.append(b, x);
  } else toastTimer = setTimeout(clearToast, 5000);
}
toastEl.addEventListener('focusin', () => clearTimeout(toastTimer));
toastEl.addEventListener('focusout', () => {
  if (!sticky && toastEl.firstChild) toastTimer = setTimeout(clearToast, 4000);
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('#editor').open && toastEl.firstChild && clearToast());

function bumpOwned(kitId, d) {
  owned[kitId] = (owned[kitId] || 0) + d;
  copyTotal += d;
  $('#n-copies').textContent = copyTotal.toLocaleString('fr-FR');
  const m = $(`.card[data-kit="${kitId}"] .mark`);
  if (m) m.textContent = owned[kitId] ? `Dans ma collection · ${owned[kitId]}` : '';
}

/* Actualiser / Actualiser les photos: one run each, only on click, browsing stays possible */
const sync = $('#sync-status');
const running = new Set();
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const JOBS = {
  'act-import': {
    url: '/api/import',
    running: 'Import en cours depuis Canal BD… La navigation reste possible.',
    done: (r) => `Import terminé : ${kitsLabel(r.total)} (${r.imported} nouveau${r.imported > 1 ? 'x' : ''}).`,
    // 409 (already running) is worth reading as is; network errors and 502 carry technical detail.
    fail: async (e) => {
      if (e.status === 409) return `${e.message}.`;
      const n = await api('GET', '/api/kits?limit=1').then((r) => r.total, () => 0);
      return `Import interrompu : Canal BD ne répond pas.${n ? ` Les ${kitsLabel(n)} déjà importés restent disponibles.` : ''}`;
    },
  },
  'act-photos': {
    url: '/api/photos/refresh',
    running: 'Recherche des photos manquantes… (environ une seconde par kit)',
    status: '/api/photos/status', // POST returns at once (202); poll until running is false
    progress: (p) => `Recherche des photos manquantes… ${p.tried} sur ${p.total} kits traités, ${plural(p.found, 'trouvée')}.`,
    done: (r) => (r.tried ? `Photos : ${plural(r.found, 'trouvée')} sur ${plural(r.tried, 'kit')} sans photo.` : 'Tous les kits ont déjà une photo.'),
    lost: 'Le serveur a redémarré pendant la recherche. Relancez « Actualiser les photos ».',
    fail: async (e) => (e.message === JOBS['act-photos'].lost ? e.message : `Recherche de photos interrompue : ${e.message}`),
  },
  'act-prices': {
    url: '/api/prices/refresh',
    running: 'Relevé des prix en cours… (une requête toutes les deux secondes environ)',
    already: 'Un relevé des prix est déjà en cours : suivi de son avancement…',
    status: '/api/prices/status',
    progress: (p) => `Relevé des prix en cours… ${p.done ?? p.tried ?? 0} sur ${p.total ?? '?'} kits traités.`,
    done: priceDone,
    fail: async (e) => `Relevé des prix interrompu : ${e.message}`,
  },
};
async function job(id) {
  if (running.has(id)) return; // duplicate clicks are ignored
  const btn = $(`#${id}`);
  const j = JOBS[id];
  running.add(id);
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-disabled', 'true');
  $('#stripe').hidden = false;
  sync.textContent = j.running;
  try {
    let result = await api('POST', j.url).catch((e) => {
      if (!(j.status && e.status === 409)) throw e; // a run is already going (e.g. page reloaded): follow it
      if (j.already) sync.textContent = j.already;
    });
    while (j.status) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await api('GET', j.status).catch((e) => {
        if (j.lost && (e.status === 0 || e.status === 404)) throw new Error(j.lost); // server restarted: the run is gone
        throw e;
      });
      if (st.running) {
        if (st.progress) sync.textContent = j.progress(st.progress);
        continue;
      }
      if (st.last?.error) throw new Error(st.last.error);
      if (!st.last && j.lost) throw new Error(j.lost);
      result = st.last;
      break;
    }
    sync.textContent = j.done(result);
  } catch (e) {
    sync.textContent = `${await j.fail(e)} `;
    const retry = Object.assign(document.createElement('button'), { type: 'button', className: 'lk', textContent: 'Réessayer' });
    retry.onclick = () => job(id);
    sync.append(retry);
  } finally {
    running.delete(id);
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-disabled');
    $('#stripe').hidden = !running.size;
  }
  await reloadData().catch(() => {});
}
on('click', '#act-import, #act-photos, #act-prices', (b) => job(b.id));
on('click', '[data-act=import]', () => job('act-import'));

/* Automatic update started by the server on opening (7 days): follow it, the site stays usable meanwhile. */
if (!$('#stripe').hidden)
  (async () => {
    while ((await api('GET', '/api/update/status').catch(() => ({ running: false }))).running) await new Promise((r) => setTimeout(r, 2000));
    if (!running.size) {
      $('#stripe').hidden = true;
      sync.textContent = 'Mise à jour terminée.';
    }
    await reloadData().catch(() => {});
  })();

// Facets with the series list scoped to the franchise (if any).
const facetsFor = (franchise) => api('GET', `/api/kits/facets${franchise ? `?${new URLSearchParams({ franchise })}` : ''}`);

async function reloadData() {
  const all = await api('GET', '/api/kits?limit=1');
  $('#n-kits').textContent = all.total.toLocaleString('fr-FR');
  if (view === 'collection') {
    copies = await api('GET', '/api/copies');
    return renderLedger();
  }
  if (!all.total || view === 'kit') return;
  // Rebuild the whole block (facets included), keeping the current filter state.
  const f = $('#filters') ? filters() : {};
  const [facets, page] = await Promise.all([facetsFor(f.franchise), api('GET', `/api/kits?${new URLSearchParams({ ...f, limit: PAGE })}`)]);
  page.kits.forEach((k) => kits.set(k.id, k));
  $('#main').innerHTML = catalogueMain({ facets, filters: f, dbTotal: all.total, ...page, owned });
  syncDensity();
}

/* Catalogue: the form holds the filter state; the URL mirrors it */
const form = () => $('#filters');
// Price fields are typed in euros; the API takes cents (an invalid entry is dropped here, load() reports it).
const filters = () =>
  Object.fromEntries(
    [...new FormData(form())]
      .map(([k, v]) => (k.startsWith('price_') ? [k, parsePrice(v) ?? ''] : [k, v]))
      .filter(([k, v]) => v !== '' && !(k === 'sort' && v === 'recent')),
  );
// Inline error for the price range; true when the range can be sent.
function priceOk() {
  const els = [form().elements.price_min, form().elements.price_max];
  const [a, b] = els.map((e) => parsePrice(e.value));
  const msg = a === undefined || b === undefined ? 'Prix invalide : écrivez par exemple 42,90.' : a != null && b != null && a > b ? 'Le prix min dépasse le prix max.' : '';
  for (const e of els) msg ? e.setAttribute('aria-invalid', 'true') : e.removeAttribute('aria-invalid');
  $('#price-err').textContent = msg;
  return !msg;
}
// Cards of a page added after the ones shown; the « n sur total » line and the more button follow.
function appendCards(box, r) {
  const grid = $('.grid', box);
  grid.insertAdjacentHTML('beforeend', r.kits.map((k) => card(k, owned[k.id])).join(''));
  const m = $('.more', box);
  m.hidden = grid.children.length >= r.total;
  $('span', m).textContent = `${grid.children.length} sur ${r.total}`;
}
let seq = 0;
async function load(append = false) {
  if (!priceOk()) return;
  const f = filters();
  const p = new URLSearchParams(f);
  if (!append) {
    const left = posKey();
    history.replaceState(null, '', p.size ? `/?${p}` : '/');
    store((s) => (s.removeItem(left), s.removeItem(posKey()))); // a manual change discards the position of the list it leaves
    scrollTo(0, 0);
  }
  const box = $('#results');
  const grid = $('.grid', box);
  const shown = append ? grid.children.length : 0;
  p.set('limit', PAGE);
  p.set('offset', shown);
  const my = ++seq;
  box.setAttribute('aria-busy', 'true');
  try {
    const r = await api('GET', `/api/kits?${p}`);
    if (my !== seq) return;
    r.kits.forEach((k) => kits.set(k.id, k));
    $('#count').textContent = kitsLabel(r.total);
    if (!append) return void (box.innerHTML = results({ ...r, owned }, f));
    appendCards(box, r);
    if ($('.more', box).hidden) $('button', grid.children[shown])?.focus();
  } catch (e) {
    if (my !== seq) return;
    // "Afficher plus" keeps the cards already loaded.
    if (append) toast(`Chargement impossible : ${e.message}`);
    else box.innerHTML = `<p class="nores err" role="alert">Chargement impossible : ${esc(e.message)}</p>`;
  } finally {
    if (my === seq) box.removeAttribute('aria-busy');
    syncDensity();
  }
}
function syncPlates() {
  const f = form();
  const grades = gradeList(f.elements.grade.value);
  for (const b of f.querySelectorAll('.pbtn')) b.setAttribute('aria-pressed', b.dataset.facet === 'grade' ? grades.includes(b.dataset.value) : f.elements[b.dataset.facet].value === b.dataset.value);
  const n = grades.length + ['scale', 'franchise', 'series'].filter((k) => f.elements[k].value).length + f.elements.uncertain.checked + f.elements.new.checked + f.elements.removed.checked + !!(f.elements.price_min.value.trim() || f.elements.price_max.value.trim());
  $('#nfilt').textContent = n ? ` (${n})` : '';
}
on('click', '.pbtn', (b) => {
  const input = form().elements[b.dataset.facet];
  if (b.dataset.facet === 'grade') {
    const g = gradeList(input.value);
    input.value = (g.includes(b.dataset.value) ? g.filter((x) => x !== b.dataset.value) : [...g, b.dataset.value]).join(',');
  } else input.value = input.value === b.dataset.value ? '' : b.dataset.value;
  syncPlates();
  load();
});
// The series list follows the franchise: reload it (scoped by the server) and drop a series that no longer applies.
on('change', '#filters [name=franchise]', async (sel) => {
  const series = form().elements.series;
  series.value = '';
  syncPlates();
  load();
  try {
    const facets = await facetsFor(sel.value);
    series.innerHTML = seriesOptions(facets.series, '');
  } catch {} // the filter itself already applied; the old list stays until the next reload
});
// Nouveautés and Supprimés exclude each other: ticking one unticks the other.
on('change', '#filters select:not([name=franchise]), #filters [name=uncertain], #filters [name=new], #filters [name=removed]', (c) => {
  if (c.checked && (c.name === 'new' || c.name === 'removed')) form().elements[c.name === 'new' ? 'removed' : 'new'].checked = false;
  syncPlates();
  load();
});
on('change', '#filters [name^=price_]', () => (syncPlates(), load()));
on('submit', '#filters', (f, e) => (e.preventDefault(), load()));
let debounce;
on('input', '#filters [name=q]', () => (clearTimeout(debounce), (debounce = setTimeout(load, 250))));
on('click', '.filt-toggle', (b) => b.setAttribute('aria-expanded', form().classList.toggle('open')));
on('click', '[data-act=clear]', () => {
  for (const k of ['q', 'grade', 'scale', 'franchise', 'series', 'price_min', 'price_max']) form().elements[k].value = '';
  for (const k of ['uncertain', 'new', 'removed']) form().elements[k].checked = false;
  facetsFor().then((fc) => (form().elements.series.innerHTML = seriesOptions(fc.series, ''))).catch(() => {});
  syncPlates();
  load();
  form().elements.q.focus();
});
/* Cards per row: remembered by this browser; the head script of the page applies it before first paint */
function setCols(n) {
  const root = document.documentElement.style;
  if (n) for (const [k, v] of [['--cols', n], ['--min', '0px'], ['--mc', Math.min(n, 3)], ['--tc', Math.min(n, 5)]]) root.setProperty(k, v);
  else for (const k of ['--cols', '--min', '--mc', '--tc']) root.removeProperty(k);
  try {
    n ? localStorage.setItem('cols', n) : localStorage.removeItem('cols');
  } catch {}
}
// Zoom +/- steps from the number of columns actually shown (also right after « Auto »).
// Columns that make sense for the window: phone 2-3, tablet 3-5, desktop 3-10 (the CSS caps the same way).
const colLimits = () => (matchMedia('(max-width:639px)').matches ? [2, 3] : matchMedia('(max-width:1023px)').matches ? [3, 5] : [3, 10]);
const shownCols = () => {
  const grid = $('.grid');
  return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
};
on('click', '.dens .zoom', (b) => {
  if (b.getAttribute('aria-disabled') === 'true') return;
  const [lo, hi] = colLimits();
  setCols(Math.min(hi, Math.max(lo, shownCols() + Number(b.dataset.zoom))));
  syncDensity();
});
on('click', '.dens button[data-cols]', (b) => {
  setCols(Number(b.dataset.cols));
  syncDensity();
});
const syncDensity = () => {
  const cur = document.documentElement.style.getPropertyValue('--cols') || '';
  for (const b of document.querySelectorAll('.dens button[data-cols]')) b.setAttribute('aria-pressed', b.dataset.cols === cur);
  // A key at its limit is disabled (aria-disabled keeps it focusable), never a silent no-op.
  const n = shownCols();
  const [lo, hi] = colLimits();
  for (const b of document.querySelectorAll('.dens .zoom')) b.setAttribute('aria-disabled', n ? String(Number(b.dataset.zoom) < 0 ? n <= lo : n >= hi) : 'false');
};
addEventListener('resize', () => syncDensity());
syncDensity();
let restoring = false; // « Afficher plus » waits for the position to be restored
on('click', '[data-act=more]', () => restoring || load(true));

/* Position: leaving the catalogue for a kit saves how many kits are shown and the scroll; coming back restores both.
   sessionStorage may be missing or throw (private mode): then nothing is remembered. */
const store = (fn) => {
  try {
    return fn(sessionStorage);
  } catch {}
};
const posKey = () => keyOf(location.pathname, location.search);
if (view === 'catalogue') {
  on('click', '.card a[href^="/kit/"]', () => {
    const loaded = $('.grid')?.children.length;
    if (loaded && !restoring) store((s) => s.setItem(posKey(), JSON.stringify({ loaded, scrollY: Math.round(scrollY) })));
  });
  // Back/forward only: a fresh visit of « / » (link, new tab) always starts at the top. A bfcache restore keeps the page as it was.
  const saved = form() && performance.getEntriesByType?.('navigation')[0]?.type === 'back_forward' ? parseSaved(store((s) => s.getItem(posKey()))) : null;
  const have = $('.grid')?.children.length || 0;
  if (saved) {
    history.scrollRestoration = 'manual';
    (async () => {
      const my = ++seq; // a filter change meanwhile (load() bumps seq) cancels the restore
      restoring = true;
      const box = $('#results');
      box.setAttribute('aria-busy', 'true');
      try {
        const p = new URLSearchParams(filters());
        const pages = await Promise.all(chunks(saved.loaded, have).map((c) => api('GET', `/api/kits?${new URLSearchParams({ ...Object.fromEntries(p), limit: c.limit, offset: c.offset })}`)));
        if (my !== seq) return;
        for (const r of pages) {
          r.kits.forEach((k) => kits.set(k.id, k));
          appendCards(box, r);
        }
      } catch {
        if (my !== seq) return;
      } // the first page is already there: just scroll
      finally {
        restoring = false;
        if (my === seq) box.removeAttribute('aria-busy');
      }
      syncDensity();
      scrollTo(0, saved.scrollY);
    })();
  }
}
// Kit page: « ← Catalogue Maquettes » goes back when we came from the catalogue (restores filters and position); otherwise it follows its href.
on('click', 'nav.crumb a', (a, e) => {
  if (view !== 'kit' || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || history.length < 2) return;
  if (fromCatalogue(document.referrer, location.origin)) (e.preventDefault(), history.back());
});

const kitOf = (el) => kits.get(Number(el.closest('.card').dataset.kit));
const wishing = new Set(); // one POST in flight per kit: a double click must not create two copies
on('click', '[data-act=wish]', async (b) => {
  const kit = kitOf(b);
  if (wishing.has(kit.id)) return;
  wishing.add(kit.id);
  b.setAttribute('aria-disabled', 'true');
  try {
    const c = await api('POST', '/api/copies', { kitId: kit.id, status: 'souhaite' });
    bumpOwned(kit.id, 1);
    toast('Ajouté à ma wishlist', {
      label: 'Annuler',
      run: async () => {
        $(`.card[data-kit="${kit.id}"] [data-act=wish]`)?.focus();
        try {
          await api('DELETE', `/api/copies/${c.id}`);
          bumpOwned(kit.id, -1);
          toast('Ajout à la wishlist annulé');
        } catch (e) {
          toast(`Annulation impossible : ${e.message}`);
        }
      },
    });
  } catch (e) {
    toast(`Ajout impossible : ${e.message}`);
  } finally {
    wishing.delete(kit.id);
    b.removeAttribute('aria-disabled');
  }
});
on('click', '[data-act=add]', (b) => openEditor('add', kitOf(b), `.card[data-kit="${kitOf(b).id}"] [data-act=add]`));

// Kit page: redraw the photo block in place, put the focus back on its main button, say what happened.
function rerenderKit(k, focus, msg) {
  $('.kmedia').innerHTML = photoMedia(k);
  ($(`.kmedia ${focus}`) || $('#main')).focus();
  toast(msg);
}

/* « Marquer comme lu » (kit page): the badge and the button go away in place, focus moves to the next key on the page */
on('click', '[data-act=read]', async (b) => {
  if (b.getAttribute('aria-disabled') === 'true') return;
  const id = Number(b.closest('.card').dataset.kit);
  b.setAttribute('aria-disabled', 'true');
  try {
    await api('POST', `/api/kits/${id}/read`);
  } catch (e) {
    b.removeAttribute('aria-disabled');
    return toast(`Marquage impossible : ${e.message}`);
  }
  kits.get(id).is_new = 0;
  b.closest('.rd').remove();
  $('.card.kit [data-act=wish]')?.focus();
  toast('Marqué comme lu');
});
/* « Tout marquer comme lu » (Nouveautés view): every new kit, then the list is reloaded (empty) */
on('click', '[data-act=readall]', async (b) => {
  if (b.getAttribute('aria-disabled') === 'true') return;
  b.setAttribute('aria-disabled', 'true');
  try {
    const { marked } = await api('POST', '/api/kits/read');
    $('#nnew').textContent = '0';
    await load();
    ($('[data-act=clear]') || $('#main')).focus();
    toast(`${plural(marked, 'kit')} marqué${marked > 1 ? 's' : ''} comme lu${marked > 1 ? 's' : ''}`);
  } catch (e) {
    b.removeAttribute('aria-disabled');
    toast(`Marquage impossible : ${e.message}`);
  }
});

/* Photo upload: raw file body, PUT, one in flight per kit */
const fileInput = $('#file');
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_ERR = { 400: 'format accepté JPEG, PNG ou WebP.', 413: 'image trop volumineuse (8 Mo maximum).', 404: 'kit introuvable.' };
let pickFor = null;
on('click', '[data-act=photo]', (b) => {
  if (b.getAttribute('aria-disabled') === 'true') return; // upload in flight (aria-disabled keeps keyboard focus)
  pickFor = b.closest('.card');
  fileInput.value = '';
  fileInput.click();
});
fileInput.addEventListener('change', () => fileInput.files[0] && pickFor && upload(pickFor, fileInput.files[0]));
function upload(cardEl, file) {
  const id = Number(cardEl.dataset.kit);
  const trayEl = $('.tray', cardEl);
  const btn = $('[data-act=photo]', cardEl);
  $('.up', trayEl)?.remove();
  const fail = (why) => {
    $('.up', trayEl)?.remove();
    trayEl.insertAdjacentHTML('beforeend', `<p class="up err" role="alert">Photo non enregistrée : ${esc(why)}</p>`);
    btn.removeAttribute('aria-disabled');
  };
  if (!TYPES.includes(file.type)) return fail(UPLOAD_ERR[400]);
  if (file.size > 8 * 1024 * 1024) return fail(UPLOAD_ERR[413]);
  btn.setAttribute('aria-disabled', 'true');
  trayEl.insertAdjacentHTML('beforeend', '<div class="up"><progress max="100" value="0" aria-label="Envoi de la photo"></progress><span>0 %</span></div>');
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', `/api/kits/${id}/photo`);
  xhr.setRequestHeader('content-type', file.type);
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((100 * e.loaded) / e.total);
    $('.up progress', trayEl).value = pct;
    $('.up span', trayEl).textContent = `${pct} %`;
  };
  xhr.onerror = () => fail('serveur injoignable.');
  xhr.onload = () => {
    if (xhr.status !== 200) return fail(UPLOAD_ERR[xhr.status] || `erreur ${xhr.status}.`);
    const k = kits.get(id);
    // A fresh ?v= per upload: the versioned URL is cached forever, so it must never be reused.
    Object.assign(k, { photo_file: JSON.parse(xhr.responseText).file, photo_kind: 'user', photo_uncertain: 0, photo_link: null, photo_thumb: null, v: Date.now() });
    if (view === 'kit') return rerenderKit(k, '[data-act=photo]', 'Photo enregistrée');
    const live = $(`.card[data-kit="${id}"]`); // the grid may have been re-rendered meanwhile
    if (live) live.outerHTML = card(k, owned[id]);
    $(`.card[data-kit="${id}"] [data-act=photo]`)?.focus();
    toast('Photo enregistrée');
  };
  xhr.send(file);
}

/* Linked image: thumbnail on failure, then the « Introuvable » placeholder. `error` does not bubble, hence capture. */
function imageFailed(img) {
  const tray = img.closest('.tray');
  const kitId = Number(img.closest('.card')?.dataset.kit);
  const row = img.closest('tr[data-copy]');
  const k = (row ? copies.find((c) => c.id === Number(row.dataset.copy)) : kits.get(kitId)) ?? {};
  const next = nextImage(k, img.getAttribute('src'));
  if (next) img.src = next; // DOM property, never string-built HTML
  else if (tray && img.hasAttribute('data-thumb')) tray.outerHTML = missTray(k, tray.classList.contains('mini'));
}
document.addEventListener('error', (e) => e.target.tagName === 'IMG' && imageFailed(e.target), true);
// Images that failed before this script ran (server-rendered page) fire no event for us.
for (const img of document.querySelectorAll('img[data-thumb]')) if (img.complete && !img.naturalWidth) imageFailed(img);

/* « Photo vérifiée »: clears the mark, then updates the card / the rows in place (no reload) */
on('click', '[data-act=verify]', async (b) => {
  if (b.getAttribute('aria-disabled') === 'true') return;
  const tr = b.closest('tr[data-copy]');
  const id = tr ? copies.find((c) => c.id === Number(tr.dataset.copy))?.kit_id : Number(b.closest('.card')?.dataset.kit);
  b.setAttribute('aria-disabled', 'true');
  try {
    await api('POST', `/api/kits/${id}/photo/verified`);
  } catch (e) {
    b.removeAttribute('aria-disabled');
    return toast(`Photo non vérifiée : ${e.message}`);
  }
  for (const c of copies) if (c.kit_id === id) c.photo_uncertain = 0;
  const k = kits.get(id);
  if (k) k.photo_uncertain = 0;
  if (view === 'kit') return k && rerenderKit(k, '[data-act=photo]', 'Photo marquée comme vérifiée');
  const live = $(`.card[data-kit="${id}"]`);
  if (live && k && form()?.elements.uncertain?.checked) {
    // The server list no longer holds this kit: drop the card so the grid length stays the "Afficher plus" offset.
    const ids = [...$('.grid').children].map((c) => Number(c.dataset.kit));
    live.remove();
    const box = $('#results');
    const left = $('.grid', box).children.length;
    const total = Number($('.more span', box).textContent.split('sur')[1].replace(/\D/g, '')) - 1;
    $('#count').textContent = kitsLabel(total);
    if (!total) box.innerHTML = results({ kits: [], total: 0 }, filters());
    else {
      $('.more span', box).textContent = `${left} sur ${total}`;
      $('.more', box).hidden = left >= total;
      const next = focusOrder(ids, ids.indexOf(id)).map((i) => $(`.card[data-kit="${i}"] [data-act=photo]`)).find(Boolean);
      (next || $('#main')).focus();
    }
  } else if (live && k) {
    live.outerHTML = card(k, owned[id]);
    $(`.card[data-kit="${id}"] [data-act=photo]`)?.focus();
  }
  if (view === 'collection') {
    const rows = [...document.querySelectorAll('tr[data-copy]')].map((r) => Number(r.dataset.copy));
    const mine = Number(tr.dataset.copy);
    renderLedger();
    (focusOrder(rows, rows.indexOf(mine)).map((i) => $(`tr[data-copy="${i}"] .ttl`)).find(Boolean) || $('#cunc'))?.focus();
  }
  toast('Photo marquée comme vérifiée');
});

/* Copy editor (native modal dialog: inert background, Esc, focus return) */
const dlg = $('#editor');
const edForm = $('#ed-form');
let ed = null;
const snapshot = () => JSON.stringify([...new FormData(edForm)]);
const dirty = () => ed && snapshot() !== ed.initial;
// back: selector of the origin control, re-queried on close because the ledger may have been re-rendered.
function openEditor(mode, data, back) {
  edForm.innerHTML = editorHtml(mode, data, [...places]);
  ed = { mode, data, back, initial: snapshot() };
  dlg.showModal();
  $('#ed-h').focus();
}
function requestClose() {
  if (dirty()) confirmBox('dirty');
  else dlg.close();
}
dlg.addEventListener('cancel', (e) => dirty() && (e.preventDefault(), confirmBox('dirty')));
dlg.addEventListener('click', (e) => e.target === dlg && requestClose());
dlg.addEventListener('close', () => {
  const back = ed?.back;
  ed = null;
  edForm.replaceChildren();
  ((back && $(back)) || $('#main')).focus();
});
on('click', '#ed-form [data-act=close]', requestClose);
edForm.addEventListener('change', (e) => {
  if (e.target.name !== 'status') return;
  $('#ed-save').disabled = false;
  $('#ed-hint').textContent = '';
});

function confirmBox(kind) {
  const box = $('#ed-confirm');
  box.innerHTML =
    kind === 'del'
      ? `<div class="stripe"></div><p id="cf-h">Supprimer cet exemplaire de « ${esc(ed.data.title)} » ? Cette action est définitive.</p><div><button type="button" class="btn pri" data-act="del-yes">Supprimer</button><button type="button" class="btn" data-act="cf-no">Annuler</button></div>`
      : `<p id="cf-h">Modifications non enregistrées</p><div><button type="button" class="btn pri" data-act="cf-save"${$('#ed-save').disabled ? ' disabled' : ''}>Enregistrer</button><button type="button" class="btn" data-act="cf-drop">Abandonner</button></div>`;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
  $(kind === 'del' ? '[data-act=cf-no]' : 'button:not(:disabled)', box).focus();
}
on('click', '#ed-form [data-act=del]', () => confirmBox('del'));
on('click', '#ed-form [data-act=cf-no]', () => (($('#ed-confirm').hidden = true), $('#ed-form [data-act=del]').focus()));
on('click', '#ed-form [data-act=cf-drop]', () => dlg.close());
on('click', '#ed-form [data-act=cf-save]', () => edForm.requestSubmit());
// The editor may be closed (or reopened on another copy) while a request is in flight:
// capture it before awaiting and only touch the dialog if it is still the same one.
const edError = (msg) => {
  const el = $('#ed-err');
  if (el) el.textContent = msg;
};
on('click', '#ed-form [data-act=del-yes]', async (b) => {
  const cur = ed;
  const id = cur.data.id;
  b.disabled = true; // no second DELETE (it would 404)
  try {
    await api('DELETE', `/api/copies/${id}`);
    copies = copies.filter((c) => c.id !== id);
    copyTotal--;
    $('#n-copies').textContent = copyTotal.toLocaleString('fr-FR');
    if (ed === cur) {
      ed.initial = snapshot();
      ed.back = '#cq';
      dlg.close();
    }
    renderLedger();
    toast('Exemplaire supprimé');
  } catch (e) {
    if (ed === cur) edError(`Suppression impossible : ${e.message}`);
    b.disabled = false;
  }
});

edForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(edForm);
  if (!fd.get('status')) return;
  const priceEl = edForm.elements.price;
  const price = parsePrice(fd.get('price'));
  priceEl.toggleAttribute('aria-invalid', price === undefined);
  $('#ed-price-err').textContent = price === undefined ? 'Prix invalide : écrivez par exemple 42,90.' : '';
  if (price === undefined) return priceEl.focus();
  const body = {
    status: fd.get('status'),
    notes: fd.get('notes'),
    price_cents: price,
    purchased_on: fd.get('purchased_on') || null,
    purchased_at: fd.get('purchased_at').trim() || null,
  };
  const save = $('#ed-save');
  const cur = ed;
  const { data, mode } = cur;
  save.disabled = true;
  try {
    if (mode === 'add') {
      await api('POST', '/api/copies', { kitId: data.id, ...body });
      bumpOwned(data.id, 1);
      toast(`Ajouté à ma collection : ${data.title}`);
    } else {
      const c = await api('PATCH', `/api/copies/${data.id}`, body);
      copies = copies.map((x) => (x.id === c.id ? c : x));
      renderLedger();
      toast('Exemplaire enregistré');
    }
    if (body.purchased_at) places.add(body.purchased_at);
    if (ed === cur) {
      ed.initial = snapshot();
      dlg.close();
    }
  } catch (err) {
    if (ed === cur) edError(`Enregistrement impossible : ${err.message}`);
    save.disabled = false;
  }
});

/* Ma collection: status filter, search and sort are client-side over every copy */
const col = { status: '', q: '', sort: 'recent', unc: false };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const CSORT = {
  recent: (a, b) => b.id - a.id,
  title: (a, b) => a.title.localeCompare(b.title, 'fr') || a.id - b.id,
  date: (a, b) => (b.purchased_on || '').localeCompare(a.purchased_on || '') || b.id - a.id,
  price: (a, b) => (b.price_cents ?? -1) - (a.price_cents ?? -1) || b.id - a.id,
};
function renderLedger() {
  if (view !== 'collection') return;
  for (const b of document.querySelectorAll('.sfilter button')) {
    b.setAttribute('aria-pressed', b.dataset.status === col.status);
    $('.n', b).textContent = copies.filter((c) => !b.dataset.status || c.status === b.dataset.status).length;
  }
  $('#cunc')?.setAttribute('aria-pressed', col.unc);
  const q = norm(col.q);
  const list = copies
    .filter((c) => (!col.status || c.status === col.status) && (!col.unc || (shown(c) && c.photo_uncertain)) && (!q || norm([c.title, c.franchise, c.series, c.grade, c.scale, c.notes, c.purchased_at].join(' ')).includes(q)))
    .sort(CSORT[col.sort]);
  $('#ledger').innerHTML = !copies.length
    ? emptyCollection()
    : list.length
      ? ledger(list, copies)
      : '<div class="nores"><p>Aucun exemplaire ne correspond à ces filtres.</p><button type="button" class="btn" data-act="cclear">Effacer les filtres</button></div>';
}
on('click', '.sfilter button', (b) => ((col.status = b.dataset.status), renderLedger()));
on('click', '#cunc', () => ((col.unc = !col.unc), renderLedger()));
on('input', '#cq', (i) => ((col.q = i.value), renderLedger()));
on('change', '#csort', (s) => ((col.sort = s.value), renderLedger()));
on('click', '[data-act=cclear]', () => {
  Object.assign(col, { status: '', q: '', unc: false });
  $('#cq').value = '';
  renderLedger();
  $('#cq').focus();
});
on('click', 'tr[data-copy]', (tr, e) => {
  if (e.target.closest('[data-act=verify]')) return;
  const c = copies.find((x) => x.id === Number(tr.dataset.copy));
  if (c) openEditor('edit', c, `tr[data-copy="${c.id}"] .ttl`);
});
