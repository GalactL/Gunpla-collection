// Box photo from a Shopify store's public search suggestions (no key): Gundam Planet, USA Gundam Store.
// Same provider shape and same rules as hljProvider (see rate in provider.js): the grade must agree, every word of the kit
// name must be present for a sure hit, weaker matches are "uncertain", a tie between two pages is refused, and a search that
// returns nothing is retried once with the relaxed name. A miss beats a photo of another kit.
// shortcut: only the 10 suggestions are read and the image is the product's first visual (often, not always, a box).
import { GRADE, REASONS, USER_AGENT, bestDoubt, doubtCost, gradeOf, kitWords, markRelaxed, pageWords, politeGate, rate, relaxName } from './provider.js';

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

// `forms`: the query shapes tried in order, true = grade + name, false = name alone (default: one, graded). A kit without grade uses the first only
// (both shapes would be the same query). A sure page stops the loop; an "a verifier" page is kept (fewest missing, then fewest extra words) and
// returned only if no later shape gives a sure one. No extra request.
// `tidy`: reseller title style, see tidyTitle. Images stay on cdn.shopify.com (measured on every shop so far).
export function shopifyProvider({ name, host, fetch = globalThis.fetch, minIntervalMs = 300, retryMs = 1000, forms = [true], tidy = false }) {
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
  async function suggest(query) {
    const url = new URL('/search/suggest.json', origin);
    url.searchParams.set('q', query);
    url.searchParams.set('resources[type]', 'product');
    url.searchParams.set('resources[limit]', '10');
    for (let attempt = 1; ; attempt++) {
      await turn();
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 && attempt <= 2) {
        await new Promise((r) => setTimeout(r, retryMs * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const products = (await res.json())?.resources?.results?.products;
      if (!Array.isArray(products)) throw new Error('unexpected response shape');
      return products.slice(0, 10);
    }
  }
  return {
    name,
    host,
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
      const ask = (q, graded = true) => suggest(`${!grade || !graded ? '' : grade === 'eg' ? 'Entry Grade ' : `${kitGrade.trim()} `}${q}`);
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
          r = judge(await ask(rx.query, forms.at(-1)), rx.query, true);
          if (r.hit) r.hit = markRelaxed(r.hit, rx);
        }
        if (r.hit) return r.hit;
        refuse(r.reason);
        return null;
      } catch (err) {
        console.error(`[photos] ${name}: ${err.message}`);
        refuse(REASONS.source);
        return null;
      }
    },
  };
}
