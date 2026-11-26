// A provider: { name, host, find(cleanedName, kitGrade, refuse?, scale?) -> Promise<{imageUrl, pageUrl, uncertain?, extra?, relaxed?, dropped?} | null> }.
// `uncertain: true` (+ `extra`, the page's extra words) marks a weaker match: fetch.js saves it as "a verifier".
// `relaxed: true` (+ `dropped`, the words removed from the query) marks a hit of the second, relaxed HLJ query (always uncertain).
// On a miss, `refuse(reason)` (optional) is told why, one of REASONS; matching itself is unaffected.
// `scale` (optional, digits: "144" for 1/144) is the kit's: a page that writes another scale is not this kit.
// Providers are tried in order = rank, best first (see fetch.js); `host` identifies the source of a stored photo.
import * as cheerio from 'cheerio';

export const REASONS = {
  noResult: 'no search result',
  grade: 'grade missing/unsupported',
  noCandidate: 'no candidate matches (extra or missing word)',
  ambiguous: 'ambiguous (two different pages with the same extra words)',
  badPage: 'page without valid product code/image',
  kept: 'only a doubtful page, and the kit already has a photo',
  source: 'source error (403/timeout/HTTP)',
};
export const USER_AGENT = 'gunpla-personal-photos/1.0';

// Kit and page title are written the same way before comparing: RX-78-02 == RX-78-2, Graham'S == Grahams,
// "OO Raiser" == "00 Raiser", "G-3" == "G3", "GNHW/R" == "GNHW R", "Endless Waltz" == "EW".
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/ν/g, 'nu')
    .replace(/['’]/g, '')
    .replace(/\bendless waltz\b/g, 'ew')
    .replace(/\b0{2}\b/g, 'oo')
    .replace(/([a-z])\/(?=[a-z])/g, '$1 ')
    .replace(/\b([a-z])-(?=\d)/g, '$1')
    .replace(/\b0+(?=\d)/g, '');
const NOISE = new Set(['ver', 'version', 'gunpla']);

// A hit is accepted only if one significant token of the kit name is a whole word of the page title.
// Strict on purpose: "Nu" does NOT match "Hi-Nu" (hyphen counts as part of the word); a miss beats a wrong photo.
export function titleMatches(name, title) {
  const want = kitWords(name);
  const toks = norm(name).split(/[\s.,]+/).filter((t) => t.length >= 2 && !/^[\d/]+$/.test(t) && !NOISE.has(t));
  // The same equalities as rate: "NJ II" = "NJII" (joined words), "Oo-Raiser" = "00 ... Raiser" (hyphenated word, parts of 3+ letters).
  const joined = [...toks.slice(1).map((x, i) => toks[i] + x), ...toks.flatMap((x) => (x.includes('-') ? x.split('-').filter((p) => p.length >= 3) : []))];
  const named = toks.length > 1 ? toks.filter((t) => t !== 'gundam') : toks; // "gundam" alone is too generic
  // Roman numerals / 2-letter tokens ("II", "Nu") match too many kits: only used when nothing else is left.
  // The joined tokens come after, so they never hide the kit's own words ("Hi Nu" still matches the page "Hi-Nu").
  const strong = named.filter((t) => t.length >= 3 && !/^[ivx]+$/.test(t));
  const sig = [...(strong.length ? strong : named), ...joined];
  const t = norm(title ?? '').replace(/\w+(?:-\w+)+/g, (m) => splitCode(m, want).join(' ')); // "Beguir-Beu" -> "beguir beu" when the kit has both words
  if (named.length === 1 && named[0] === 'wing' && toks.includes('gundam') && !/(?<![\w-])gundam(?![\w-])/.test(t)) return false; // bare "wing" is the series, not a name
  return sig.some((tok) => new RegExp(`(?<![\\w-])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(t));
}

export const GRADE = /\b(HG[A-Z0-9]{0,6}|RE\/100|RG|MG|PG|SD|EG|FM)\b/i;
// HGUC/HGBC/HG00... == HG family; RE/100 == RE (the kit's own grade is just "RE").
export const gradeOf = (s) => (/^\s*re\s*$/i.test(s) ? 're' : GRADE.exec(s)?.[1].toLowerCase().replace(/^hg\w*$/, 'hg').replace(/^re\/100$/, 're') ?? null);
// Scale as the digits after "1/" or "1:" ("1/144", "1:144" -> "144"), undefined when absent.
export const scaleOf = (s) => /\b1[/:](\d{2,3})\b/.exec(s ?? '')?.[1];
// A lone "S" belongs to the word before it ("Challia S" == "Challia's").
export const words = (s) =>
  norm(s)
    .split(/[\s.,()[\]:&]+/)
    .filter((w) => w && !/^\d+\/\d+$/.test(w)) // scale ("1/100") dropped
    .reduce((a, w) => (w === 's' && /^[a-z]{3,}$/.test(a.at(-1) ?? '') ? a.with(-1, `${a.at(-1)}s`) : a.concat(w)), []);
// A hyphenated page code ("Beguir-Beu", "GAT-X105") is split only when ALL its parts are words of the kit, so "Hi-Nu" stays whole for "Nu".
const splitCode = (x, want) => (!want.includes(x) && x.includes('-') && x.split('-').every((p) => want.includes(p)) ? x.split('-') : [x]);
// Adjacent kit words that are ONE page word ("Z Eus" = "Zeus", "NJ II" = "NJII", "Plug Suit" = "Plugsuit") count as that word.
function fuse(want, rest) {
  const out = [];
  for (let i = 0; i < want.length; i++) {
    const both = want[i] + (want[i + 1] ?? '');
    if (i + 1 < want.length && rest.includes(both) && !want.includes(both)) out.push(both), i++;
    else out.push(want[i]);
  }
  return out;
}
// A page title's words -> its grade (first word "HG", or the two words "Entry Grade" = EG, else null) and its other words.
export function pageWords(w) {
  const eg = w[0] === 'entry' && w[1] === 'grade';
  const g = eg ? 'eg' : gradeOf(w[0] ?? '');
  return { g, rest: w.slice(eg ? 2 : g ? 1 : 0) };
}
export const EXTRA_OK = new Set(['gundam', 'ver', 'version', 'ka', 'the']); // harmless extra words in a retailer name

// Reserves the next slot synchronously, so parallel callers still leave `minIntervalMs` between two requests to a site.
// Each call precedes exactly one HTTP request: `turn.metrics` counts them and the waiting time (read by fetchPhotos for the journal).
export function politeGate(minIntervalMs) {
  let next = 0;
  const turn = async () => {
    const at = Math.max(next, Date.now());
    next = at + minIntervalMs;
    turn.metrics.requests++;
    if (at > Date.now()) {
      turn.metrics.waitMs += at - Date.now();
      await new Promise((r) => setTimeout(r, at - Date.now()));
    }
  };
  turn.metrics = { requests: 0, waitMs: 0 };
  return turn;
}

// Words of the kit name every page must contain. One-letter words ("V" of "V Gundam", "Z") are required too:
// dropping them let "V Gundam" take the page "1.5 Gundam". Digits-only words stay ignored.
export const kitWords = (name) => words(name).filter((w) => (w.length >= 2 || /^[a-z]$/.test(w)) && !NOISE.has(w) && !/^[\d/]+$/.test(w));

// Rates one retailer page against the kit: null = not this kit, else { sure, missing, extra, noGrade }.
// `g` / `rest` = the page's grade (first word) and its other words. sure = grade agrees, every kit word present, no extra word.
// Accepted as "a verifier" (never sure): extra words; ONE kit word missing (kit of 3+ words, grade agrees, word of 3+ letters
// that is not a roman numeral: "Zaku I" must not take "Zaku II"; with no grade on one side the kit needs 4+ words); no grade on one side (kit or page), then ALL words and 2+ words.
// An explicit different grade, or a grade written elsewhere in the title, is never guessed around; neither is another scale:
// `scale` (digits, see scaleOf) of the kit against the one written in the page title, only when both are known.
// Page codes help the match: a hyphenated code whose parts are ALL kit words is split (sure still possible if exact), and the
// other way round (kit "Oo-Raiser", page "00 ... Raiser"); adjacent kit words that are one page word are fused (see fuse);
// a kit word of 4+ letters that is only the start of a page code with a hyphen or digit ("Zgmf" in "ZGMF-X09A") is
// not counted missing, but stays in `missing`, so such a page is never sure. A model code of the kit that the page lacks
// ("RX-73" for "RX-93-2") is tolerated the same way when the grade agrees and the kit has 4+ words (3 besides the code); that
// code is then the only thing it may lack (a further missing word passes only as the start of a page word: "Eva" = "Evangelion").
// A kit name cut in "Ver." ("Doven Wolf Unicorn Ve") loses its last word when it is "V" or "Ve"; never sure without "Ver." on the page.
export function rate({ name, title, grade, g, rest: page, scale }) {
  const named = kitWords(name);
  const base = named.length >= 3 && /^ve?$/.test(named.at(-1)) ? named.slice(0, -1) : named;
  const rest = page.flatMap((x) => splitCode(x, base));
  const want = fuse(base.flatMap((x) => splitCode(x, rest)), rest);
  const missing = want.filter((x) => !rest.includes(x));
  const noGrade = !(grade && g);
  const isCode = (x) => /\d/.test(x) && /[a-z]/.test(x);
  const codeless = !noGrade && base.length >= 4; // the code may go only when the kit has 3+ other words
  const tolerated = (x) => (/^[a-z]{4,}$/.test(x) && rest.some((c) => c.length > x.length && c.startsWith(x) && /[-\d]/.test(c))) || (codeless && isCode(x));
  const gone = missing.filter((x) => !tolerated(x));
  const extra = rest.filter((x) => !want.includes(x) && !/\d/.test(x) && !EXTRA_OK.has(x));
  if (grade && g && g !== grade) return null;
  if (grade && !g && rest.some((x) => GRADE.test(x))) return null;
  if (scale && scaleOf(title) && scale !== scaleOf(title)) return null;
  // A tolerated code is what the kit may lack: a further missing word then only passes as an abbreviation of a page word ("Eva" = "Evangelion").
  const codeGone = missing.some((x) => codeless && isCode(x));
  const slack = base.length >= (noGrade ? 4 : 3) && gone.length === 1 && /^[a-z]{3,}$/.test(gone[0]) && !/^[ivx]+$/.test(gone[0]) && (!codeGone || rest.some((c) => c.startsWith(gone[0])));
  if ((gone.length && !slack) || (noGrade && base.length < 2) || !titleMatches(name, title)) return null;
  const cutV = base !== named && !/\bver(sion)?\b/i.test(title); // "V"/"Ve" ignored with no "Ver." on the page: a guess
  return { sure: !noGrade && !missing.length && !extra.length && !cutV, missing, extra, noGrade };
}

// A page accepted as "a verifier", in the provider hit shape (extra: the page's extra words; missing/noGrade only when set).
export const doubtHit = (h) => ({ imageUrl: h.img, pageUrl: h.href, uncertain: true, extra: h.extra, ...(h.missing.length && { missing: h.missing }), ...(h.noGrade && { noGrade: true }) });

// What a doubtful page costs: fewest missing kit words first, then fewest extra words. A missing "Gundam" is free, like an extra one
// (EXTRA_OK): the retailer's "HG 00 Qan[T]" beats "HG Gundam 00 Command Qan[T]" for the kit "Gundam OO Qan(T)".
// shortcut: missing * 100 + extra as the sort key, fine below 100 extra words.
export const doubtCost = (h) => (h.missing ?? []).filter((x) => x !== 'gundam').length * 100 + h.extra.length;

// Best "a verifier" page; two different pages tied = ambiguous. -> { hit } | { reason } | null (no page).
export function bestDoubt(hits) {
  const least = Math.min(...hits.map(doubtCost));
  const tied = hits.filter((h) => doubtCost(h) === least);
  if (new Set(tied.map((h) => h.href)).size > 1) return { reason: REASONS.ambiguous, extra: tied[0].extra, missing: tied[0].missing ?? [] };
  return tied.length ? { hit: doubtHit(tied[0]) } : null;
}

// A hit of the second, relaxed query: always "a verifier".
export const markRelaxed = (hit, rx) => ({ ...hit, uncertain: true, extra: hit.extra ?? [], relaxed: true, dropped: rx.dropped });

// Judges the result of the relaxed query. A page found WITHOUT the last word (rx.against) may not also have extra words: a missing
// distinctive word plus a foreign one is another kit ("Mobile Suit Gundam Zaku II" for "... GQuuuuuuX"), a miss beats a wrong photo.
export const relaxedResult = (r, rx) => (!r.hit ? r : rx.against && r.hit.extra?.length ? { reason: REASONS.noCandidate, extra: r.hit.extra, missing: r.hit.missing } : { hit: markRelaxed(r.hit, rx) });

// Scraped URLs are untrusted: only https on hlj.com itself (measured: images are on www.hlj.com), else null.
function hljUrl(raw) {
  try {
    const u = new URL(raw, 'https://www.hlj.com/');
    return u.protocol === 'https:' && !u.port && (u.hostname === 'hlj.com' || u.hostname.endsWith('.hlj.com')) ? u.href : null;
  } catch {
    return null;
  }
}

// HLJ needs EVERY query word to match, so model codes ("XXXG-01W"), versions ("Ver. 2.0"), apostrophe-S and
// leftovers like "( )" turn real results into 0. Relaxed query = cleaned name without them; null when nothing was
// dropped (the same query again is pointless) or fewer than 2 comparable words remain.
// shortcut: model code = a token with a digit AND a hyphen ("Mk-2" goes too; "V2", "F91" stay), no letters+digits rule.
export function relaxName(name) {
  const dropped = [];
  const tokens = name
    .replace(/\([^)]*\)/g, (m) => (dropped.push(...m.slice(1, -1).split(/\s+/).filter(Boolean)), ' '))
    .replace(/\s*['’]\s*s\b/gi, (m) => (dropped.push(m.trim()), ' '))
    .replace(/\//g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const isDrop = (t) => /^ver\.?(v?\d+(\.\d+)*)?$/i.test(t) || /^v?\d+(\.\d+)+$/.test(t) || (/\d/.test(t) && t.includes('-'));
  let against;
  const plain = name.replace(/\s+/g, ' ').trim();
  let query = tokens.filter((t) => !isDrop(t) || (dropped.push(t), false)).join(' ');
  // Nothing to drop and a long name: HLJ's every-word search found nothing, so the last word (a retailer suffix: "Mobile Suit",
  // "Special"...) goes; letters only, never a roman numeral ("Zaku Type II"). The hit is "a verifier" like any relaxed one,
  // and is judged against the ORIGINAL name (`against`): that word counts as the ONE missing word of rate, never a second loss.
  const last = tokens.at(-1) ?? '';
  if (!dropped.length && query === plain && kitWords(name).length >= 4 && /^[a-z]{3,}$/i.test(last) && !/^[ivx]+$/i.test(last) && !/^\W+$/.test(tokens.at(-2) ?? '')) { // not after a dangling "-"
    query = tokens.slice(0, -1).join(' ');
    dropped.push(last);
    against = name;
  }
  return query === plain || kitWords(query).length < 2 ? null : { query, dropped, ...(against && { against }) };
}

// Bandai box photo from HobbyLink Japan's search page (public, no key; box shots are 1200x900).
// Retailer names look like "MG Gundam Exia" / "HGUC MSN-06S Sinanju": the grade must agree, every word of the
// kit name must be present, and extra words must be model codes. A miss beats a photo of another kit.
// shortcut: one search page parsed with cheerio (selectors may drift), no variant detection (Ver.Ka, Clear...).
export function hljProvider({ fetch = globalThis.fetch, minIntervalMs = 1500 } = {}) {
  const turn = politeGate(minIntervalMs);
  // One HLJ search page -> its product blocks (an empty list = HLJ matched none of the query words together).
  async function search(query) {
    await turn();
    const url = new URL('https://www.hlj.com/search/');
    url.searchParams.set('q', query);
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const $ = cheerio.load(await res.text());
    return $('.search-widget-block').toArray().map((el) => {
      const a = $(el).find('.product-item-name a').first();
      return { href: hljUrl(a.attr('href')) ?? '', img: hljUrl($(el).find('img').first().attr('src')) ?? '', title: a.text().trim() };
    });
  }
  // Compares the products with the words of `name`: { hit } or { reason }. `relaxed`: the page's "'s" is ignored too.
  function judge(items, name, grade, relaxed, scale) {
    const blocks = items.map(({ href, img, title }) => {
      const { g, rest } = pageWords(words(relaxed ? title.replace(/['’]s\b/gi, '') : title));
      // near = acceptable (see rate); sure = near with grade and every word, uncertain = the other near pages.
      const r = rate({ name, title, grade, g, rest, scale });
      const valid = /-ban[a-z]?\d+(-\w+)?$/i.test(href) && /\.(jpe?g|png|webp)(\?|$)/i.test(img);
      return { ...r, near: !!r, ok: !!r && valid, rest: rest.length, href, img };
    });
    const hits = blocks.filter((h) => h.ok);
    const sure = hits.filter((h) => h.sure).sort((a, b) => a.rest - b.rest)[0]; // fewest words = closest to the kit name
    // Relaxed pass only: the dropped model code is often all that separates variants, so two different sure pages tied
    // at the fewest words are refused (the strict pass keeps its behaviour).
    if (sure && relaxed && new Set(hits.filter((h) => h.sure && h.rest === sure.rest).map((h) => h.href)).size > 1) return { reason: REASONS.ambiguous };
    if (sure) return { hit: { imageUrl: sure.img, pageUrl: sure.href } };
    const doubt = bestDoubt(hits);
    if (doubt) return doubt;
    return { reason: !blocks.length ? REASONS.noResult : blocks.some((h) => h.near && !h.extra.length) ? REASONS.badPage : REASONS.noCandidate };
  }
  return {
    name: 'hlj-box',
    host: 'hlj.com',
    metrics: turn.metrics,
    concurrency: 1, // the shared gate serialises its requests anyway
    async find(name, kitGrade, refuse = () => {}, scale) {
      // An unknown/unsupported kit grade is never guessed: without one, only a kit of 2+ words is searched (always "a verifier").
      const grade = gradeOf(kitGrade ?? '');
      if (!grade && kitWords(name).length < 2) return refuse(REASONS.grade), null;
      try {
        const items = await search(name);
        let r = judge(items, name, grade, false, scale);
        // Only when HLJ returned zero products (not "products that do not match"): one more request, relaxed, never sure.
        const rx = items.length ? null : relaxName(name);
        if (rx) {
          r = relaxedResult(judge(await search(rx.query), rx.against ?? rx.query, grade, true, scale), rx);
        }
        if (r.hit) return r.hit;
        refuse(r.reason, { query: rx?.query ?? name, extra: r.extra, missing: r.missing });
        return null;
      } catch (err) {
        console.error(`[photos] ${this.name}: ${err.message}`);
        refuse(REASONS.source);
        return null;
      }
    },
  };
}
