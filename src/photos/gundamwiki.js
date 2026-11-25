// Last-resort source: main image of a Gundam Fandom wiki page (MediaWiki API, no key). Illustrations, not box photos:
// every hit is "a verifier", the grade is not required (the wiki has none). Same word rules as the shops (rate: all kit words
// in the page title, none missing). A miss beats a photo of another kit.
// shortcut: only the 5 best search results are read; one request per kit.
import { REASONS, USER_AGENT, bestDoubt, kitWords, pageWords, politeGate, rate } from './provider.js';

const HOST = 'gundam.fandom.com';

// Scraped URLs are untrusted: image https on a wikia/fandom CDN only.
const imageOf = (raw) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.port && /(^|\.)nocookie\.net$/.test(u.hostname) && /\.(jpe?g|png|webp|gif)$/i.test(u.pathname) ? u.href : null;
  } catch {
    return null;
  }
};

export function gundamWikiProvider({ fetch = globalThis.fetch, minIntervalMs = 500 } = {}) {
  const turn = politeGate(minIntervalMs);
  return {
    name: 'gundamwiki',
    host: HOST,
    async find(kitName, kitGrade, refuse = () => {}) {
      const clean = kitName.replace(/\([^)]*\)/g, ' ').replace(/&/g, ' ').replace(/\s+/g, ' ').trim();
      if (kitWords(clean).length < 2) return refuse(REASONS.noResult), null; // one word is too generic: "Wing" is not "Gundam Wing"
      try {
        const url = new URL(`https://${HOST}/api.php`);
        const query = { action: 'query', format: 'json', generator: 'search', gsrsearch: clean, gsrlimit: '5', prop: 'pageimages', piprop: 'original' };
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
        await turn();
        const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pages = Object.values((await res.json())?.query?.pages ?? {});
        const hits = pages.map((p) => {
          const title = String(p.title ?? '');
          const { g, rest } = pageWords(kitWords(title));
          const r = rate({ name: clean, title, grade: null, g, rest });
          const img = imageOf(p.original?.source);
          return r && !r.missing.length && img && { ...r, img, href: `https://${HOST}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
        }).filter(Boolean);
        const r = hits.length ? bestDoubt(hits) : { reason: pages.length ? REASONS.noCandidate : REASONS.noResult };
        if (r.hit) return r.hit;
        refuse(r.reason);
        return null;
      } catch (err) {
        console.error(`[photos] gundamwiki: ${err.message}`);
        refuse(REASONS.source);
        return null;
      }
    },
  };
}
