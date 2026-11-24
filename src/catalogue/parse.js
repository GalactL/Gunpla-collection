import * as cheerio from 'cheerio';

export const BASE_URL = 'https://www.canalbd.net';

const text = (s) => s.replace(/Â/g, '').replace(/\s+/g, ' ').trim();

// "09/05/26" -> "2026-05-09" (two-digit years are 20yy); anything else -> null.
export function parseFrenchDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s.trim());
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
}

// Listing page (server-rendered cards) -> { kits, nextPage }.
// Cards without a title (the site has a few) are skipped: nothing to show or search.
export function parseListing(html) {
  const $ = cheerio.load(html);
  const kits = [];
  $('article.card-book').each((_, el) => {
    const card = $(el);
    const link = card.find('h3 a').first().attr('href') ?? '';
    const href = link.trim();
    const id = /-(\d+)\/?$/.exec(href)?.[1];
    // h3 holds a series line (span.title) and/or the item name (span.subtitle).
    const raw_title = card
      .find('h3 > span')
      .map((_, s) => text($(s).text()))
      .get()
      .filter(Boolean)
      .join(' - ');
    if (!id || !raw_title) return;
    kits.push({
      source_id: id,
      raw_title,
      release_date: parseFrenchDate(card.find('.on-sale strong').first().text()),
      source_url: BASE_URL + href,
    });
  });
  const next = Number($('nav.pagination a.icon-right').first().attr('data-value'));
  return { kits, nextPage: Number.isInteger(next) && next > 0 ? next : null };
}

// Home page -> Maquettes shelves [{id, label}] from the site menu (empty if the block is missing).
export function parseMaquettesShelves(html) {
  const $ = cheerio.load(html);
  const item = $('li.submenu-lvl1-item')
    .filter((_, li) => text($(li).children('button.has-submenu').text()) === 'Maquettes')
    .first();
  return item
    .find('a[href*="shelf="]')
    .map((_, a) => {
      const id = /[?&]shelf=(\d+)/.exec($(a).attr('href'))?.[1];
      return id ? { id, label: text($(a).text()) } : null;
    })
    .get();
}
