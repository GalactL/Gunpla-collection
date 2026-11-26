// Box photo from a Shopify store's public search suggestions (no key): Gundam Planet, USA Gundam Store.
// Same provider shape and same rules as hljProvider (see rate in provider.js): the grade must agree, every word of the kit
// name must be present for a sure hit, weaker matches are "uncertain", a tie between two pages is refused, and a search that
// returns nothing is retried once with the relaxed name. A miss beats a photo of another kit.
// shortcut: only the 10 suggestions are read and the image is the product's first visual (often, not always, a box).
import { GRADE, REASONS, USER_AGENT, bestDoubt, doubtCost, gradeOf, kitWords, pageWords, politeGate, rate, relaxName, relaxedResult, words } from './provider.js';

const SKIP = /decal|delpi|g-rework|robot spirits|metal build|option/i; // accessories and other lines share the grade words
const CDN = 'cdn.shopify.com';

// Reseller titles ("[PREORDER] Bandai MG 1/100 Gyan Model Kit", "Zeta Gundam Ver. Ka MG 1/100 Model Kit - Bandai"): tag, vendor and
// "Model Kit" dropped, the grade written anywhere moved first (once), so the shared rules (grade = first word) apply. Only for `tidy` shops.
const tidyTitle = (t) => {
  const s = t.replace(/^\[[^\]]*\]\s*/, '').replace(/\s+-\s+Bandai$/i, '').replace(/^Bandai\s+/i, '').replace(/\bModel Kit\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const m = GRADE.exec(s);
  return m ? `${m[0]} ${s.replace(new RegExp(String.raw`\b${m[0]}\b`, 'gi'), ' ')}`.replace(/\s+/g, ' ').trim() : s; // the grade written twice ("MG ... MG 1/100") counts once
};

// The query is the kit name without catalogue noise: leading number, "(...)" groups and "&" are not in shop titles.
const queryName = (name) => name.replace(/\([^)]*\)/g, ' ').replace(/&/g, ' ').replace(/^\d+\s+/, '').replace(/\s+/g, ' ').trim();

// What suggest.json would answer, from the catalogue: ALL products whose title has every query word (the last one may be a prefix, as Shopify does).
// No cut at 10 (suggest's): any cut by title length let reseller decoration ("[PREORDER] Bandai ... Model Kit - Bandai") push the real kit out and
// a variant win. `judge` handles ties and ambiguity; more candidates only means more "ambiguous" refusals, a miss rather than a wrong photo.
const titleTokens = (s) => words(s).flatMap((w) => w.split('-')).filter(Boolean);
function fromCatalogue(cat, query) {
  const q = titleTokens(query);
  if (!q.length) return [];
  const prefix = q.pop();
  return cat.filter(({ t }) => q.every((w) => t.includes(w)) && t.some((x) => x.startsWith(prefix)));
}

// `forms`: the query shapes tried in order, true = grade + name, false = name alone (default: one, graded). A kit without grade uses the first only
// (both shapes would be the same query). A sure page stops the loop; an "a verifier" page is kept (fewest missing, then fewest extra words) and
// returned only if no later shape gives a sure one. No extra request.
// `tidy`: reseller title style, see tidyTitle. Images stay on cdn.shopify.com (measured on every shop so far).
// `catalogue: { minKits }`: for a shop whose products.json is open AND complete (not cut by Shopify's page * limit <= 25000), the whole catalogue
// is downloaded once per job (in memory) and `suggest` is answered from it, from the `minKits`-th kit that actually ARRIVES at `find` during the job
// (fetchPhotos brackets a job with `plan`; kits skipped by a remembered refusal, found by a better source or blocked by the breaker never arrive).
// The kits before it use the kit search, so a job with few new kits never pays for a catalogue. Any problem (HTTP, JSON, empty, truncated) = one log line, then the kit search for the whole job.
// `catalogue.path`: download a collection (`/collections/<handle>/products.json`) instead of the whole `/products.json`; same pages, same fallback.
// Only that shape is accepted (never an absolute URL, `..`, query or other characters): the path is joined to the shop origin.
const COLLECTION_PATH = /^\/collections\/[a-z0-9][a-z0-9_-]*\/products\.json$/i;
export function shopifyProvider({ name, host, fetch = globalThis.fetch, minIntervalMs = 300, retryMs = 1000, forms = [true], tidy = false, catalogue }) {
  if (catalogue?.path !== undefined && !COLLECTION_PATH.test(catalogue.path)) throw new Error(`${name}: invalid catalogue path ${JSON.stringify(catalogue.path)}`);
  const origin = `https://www.${host}`;
  const turn = politeGate(minIntervalMs);
  // Scraped URLs are untrusted: image https on cdn.shopify.com only, page on the shop itself (query string dropped).
  const imageOf = (raw) => {
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && !u.port && u.hostname === CDN && /\.(jpe?g|png|webp)$/i.test(u.pathname) ? u.href : null;
    } catch {
      return null;
    }
  };
  const pageOf = (raw) => {
    try {
      const u = new URL(raw, origin);
      return u.protocol === 'https:' && !u.port && u.hostname.replace(/^www\./, '') === host ? u.origin + u.pathname : null;
    } catch {
      return null;
    }
  };
  // One polite GET (counted by the gate); 429 is retried twice.
  async function get(url, timeoutMs) {
    for (let attempt = 1; ; attempt++) {
      await turn();
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 && attempt <= 2) {
        await new Promise((r) => setTimeout(r, retryMs * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    }
  }
  // Catalogue of the current job: `on` = inside a job (fetchPhotos), `arrived` = kits that reached `find` and searched, `loading` = the one shared
  // download (a promise of the products, or null = kit search). Outside a job (one kit refreshed alone) the catalogue is never used.
  let job = { on: false, arrived: 0, loading: null };
  const PAGE = 250;
  const MAX_PAGE = 100; // Shopify refuses page * limit > 25000: a page 100 still full means the catalogue is cut
  async function loadCatalogue() {
    const t0 = Date.now();
    const r0 = turn.metrics.requests;
    const items = [];
    const seen = new Set(); // a catalogue that moves while it downloads repeats products across pages
    for (let page = 1; ; page++) {
      const url = new URL(catalogue.path ?? '/products.json', origin);
      url.searchParams.set('limit', String(PAGE));
      url.searchParams.set('page', String(page));
      const list = (await (await get(url, 30000)).json().catch(() => { throw new Error('JSON invalide'); }))?.products;
      if (!Array.isArray(list)) throw new Error('forme inattendue');
      for (const p of list) {
        if (p?.title && p.handle && !seen.has(p.handle) && seen.add(p.handle)) items.push({ title: String(p.title), url: `/products/${encodeURIComponent(p.handle)}`, image: imageOf(p.images?.[0]?.src), t: titleTokens(String(p.title)) });
      }
      if (list.length < PAGE) break;
      if (page === MAX_PAGE) throw new Error('tronqué (page 100 encore pleine)');
    }
    if (!items.length) throw new Error('vide');
    console.error(`[photos] ${name}: catalogue chargé : ${items.length} produits, ${turn.metrics.requests - r0} requêtes, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return items;
  }
  // The catalogue if this job uses it and it is sound, else null (the one fallback line is logged here, once per job).
  const catalogueOf = () =>
    (job.loading ??= loadCatalogue().catch((err) => (console.error(`[photos] ${name}: catalogue indisponible (${err.message}), repli sur la recherche par kit`), null)));
  async function suggest(query, viaCatalogue) {
    const cat = viaCatalogue ? await catalogueOf() : null;
    if (cat) return fromCatalogue(cat, query);
    const url = new URL('/search/suggest.json', origin);
    url.searchParams.set('q', query);
    url.searchParams.set('resources[type]', 'product');
    url.searchParams.set('resources[limit]', '10');
    const products = (await (await get(url, 15000)).json())?.resources?.results?.products;
    if (!Array.isArray(products)) throw new Error('unexpected response shape');
    return products.slice(0, 10);
  }
  return {
    name,
    host,
    metrics: turn.metrics,
    plan: (on) => (job = { on, arrived: 0, loading: null }), // true at the start of a job, false at its end (drops the catalogue from memory)
    async find(kitName, kitGrade, refuse = () => {}, scale) {
      const grade = gradeOf(kitGrade ?? '');
      const clean = queryName(kitName);
      const wantN = kitWords(clean).length;
      if (!grade && wantN < 2) return refuse(REASONS.grade), null; // no grade: only a kit of 2+ words, always "a verifier"
      if (!wantN) return refuse(REASONS.noResult), null;
      // Products vs the kit words of `name`: { hit } or { reason }. `relaxed`: the shop title's "'s" is ignored too.
      const judge = (products, name, relaxed) => {
        const near = products.filter((p) => !SKIP.test(p.title ?? '')).map((p) => {
          const title = tidy ? tidyTitle(p.title ?? '') : p.title ?? '';
          const { g, rest } = pageWords(kitWords(relaxed ? title.replace(/['’]s\b/gi, '') : title));
          const r = rate({ name, title, grade, g, rest, scale });
          return r && { ...r, rest: rest.length, img: imageOf(p.image), href: pageOf(p.url) };
        }).filter(Boolean);
        const hits = near.filter((c) => c.img && c.href);
        const sure = hits.filter((h) => h.sure).sort((a, b) => a.rest - b.rest); // fewest words = closest to the kit name
        if (sure.length) {
          return new Set(sure.filter((h) => h.rest === sure[0].rest).map((h) => h.href)).size > 1
            ? { reason: REASONS.ambiguous }
            : { hit: { imageUrl: sure[0].img, pageUrl: sure[0].href } };
        }
        return bestDoubt(hits) ?? { reason: !products.length ? REASONS.noResult : near.some((c) => !c.extra.length) ? REASONS.badPage : REASONS.noCandidate };
      };
      const viaCatalogue = !!catalogue && job.on && ++job.arrived >= catalogue.minKits; // decided once per kit: its forms all use the same source
      const ask = (q, graded = true) => suggest(`${!grade || !graded ? '' : grade === 'eg' ? 'Entry Grade ' : `${kitGrade.trim()} `}${q}`, viaCatalogue);
      try {
        let r;
        let found = 0;
        let doubt;
        for (const graded of grade ? forms : forms.slice(0, 1)) {
          const products = await ask(clean, graded);
          found += products.length;
          r = judge(products, clean, false);
          if (r.hit && !r.hit.uncertain) break;
          if (r.hit && (!doubt || doubtCost(r.hit) < doubtCost(doubt))) doubt = r.hit;
        }
        if (doubt && !(r.hit && !r.hit.uncertain)) r = { hit: doubt };
        // Only when the shop returned zero products: one more request, relaxed (model codes, versions, "(...)" dropped), never sure.
        const rx = found ? null : relaxName(clean);
        if (rx) {
          r = relaxedResult(judge(await ask(rx.query, forms.at(-1)), rx.against ?? rx.query, true), rx);
        }
        if (r.hit) return r.hit;
        refuse(r.reason, { query: rx?.query ?? clean, extra: r.extra, missing: r.missing });
        return null;
      } catch (err) {
        console.error(`[photos] ${name}: ${err.message}`);
        refuse(REASONS.source);
        return null;
      }
    },
  };
}
