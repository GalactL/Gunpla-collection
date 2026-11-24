import * as cheerio from 'cheerio';

export const DEFAULT_DELAY_MS = 1000;
export const UNAVAILABLE_TEXT = 'Indisponible dans cette librairie';
const MAX_CENTS = 100000 * 100; // above 100 000 EUR: not a plausible kit price
const HOST = 'www.canalbd.net';

const shape = (msg) => Object.assign(new Error(`unexpected offers fragment: ${msg}`), { code: 'shape' });

// "12.90", "12,90 €", "1 234,50 EUR" -> 1290 ... ; anything else (NaN, 0, negative, absurd) -> shape.
function toCents(raw) {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?(?:€|eur)?$/i.exec(String(raw ?? '').replace(/[\s  ]+/g, ''));
  const cents = m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0) : NaN;
  if (!(cents > 0 && cents <= MAX_CENTS)) throw shape('price not parseable');
  return cents;
}

// The only forms we accept (anything else throws code 'shape', never "unavailable"):
//  - main offer price (.product-offer-price: schema.org meta, else the displayed value) => canalbd
//  - else the lowest seller card price (.offer-card__price) => vendeur
//  - else the exact text "Indisponible dans cette librairie" in .product-unavailable => unavailable
export function parseOffers(html) {
  const $ = cheerio.load(String(html ?? ''));
  const main = $('.product-offers .product-offer-price').first();
  if (main.length) {
    // Both forms present must agree; one alone is used as is.
    const forms = [main.find('meta[itemprop="price"]').attr('content'), main.find('.product-offer-price-value').text()]
      .filter((v) => v != null && v.trim() !== '')
      .map(toCents);
    if (!forms.length) throw shape('main price block without a price');
    if (forms.some((c) => c !== forms[0])) throw shape('main price forms disagree');
    return { state: 'priced', cents: forms[0], source: 'canalbd' };
  }
  const cards = $('.offer-card .offer-card__price')
    .map((_, el) => toCents($(el).text()))
    .get();
  if (cards.length) return { state: 'priced', cents: Math.min(...cards), source: 'vendeur' };
  // Any seller card we could not price (renamed class...) must never degrade into "unavailable".
  if ($('.offer-card').length) throw shape('seller card without a recognised price');
  if ($('.product-offers .product-unavailable').filter((_, el) => $(el).text().trim() === UNAVAILABLE_TEXT).length) {
    return { state: 'unavailable' };
  }
  throw shape('no known offer marker');
}

// One plain GET of the htmx offers fragment. Returns { status, html }. Network errors propagate (transient).
// redirect: 'manual' => a redirect is returned as a 3xx, never followed (so never to another host).
export async function fetchOffers({ fetch = globalThis.fetch, sourceId, releaseDate, referer, timeoutMs = 15000 }) {
  if (!/^\d{1,15}$/.test(String(sourceId ?? ''))) throw Object.assign(new Error('invalid source id'), { code: 'input' });
  const url = new URL(`https://${HOST}/manga-dokaze/articles/view/${sourceId}/offers/`);
  url.searchParams.set('availability', '2');
  if (/^\d{4}-\d{2}-\d{2}$/.test(releaseDate ?? '')) url.searchParams.set('release_date', releaseDate);
  if (url.protocol !== 'https:' || url.host !== HOST) throw Object.assign(new Error('bad host'), { code: 'input' });
  const headers = { 'HX-Request': 'true', Accept: 'text/html', 'User-Agent': 'gunpla-personal-importer/1.0' };
  if (/^https:\/\/(www\.)?canalbd\.net\//.test(referer ?? '')) headers.Referer = referer;
  const res = await fetch(url.href, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, html };
}

// Pages that mean "we are being turned away" rather than "markup changed".
const CHALLENGE = /captcha|cf-chl|challenge-platform|just a moment|attention required|verify you are (a )?human/i;
export const isChallenge = (html) => CHALLENGE.test(html);
