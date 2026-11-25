import { REASONS, USER_AGENT, scaleOf } from './provider.js';
import { MAX_BYTES, getPhoto, savePhoto } from './store.js';

// Drops catalogue numbers HLJ does not know: "(011)" (1-4 digits only) and a leading 1-3 digit token followed
// by a word ("013 Exia"). Zero values are names ("00 Raiser", "0 Gundam"); "Type 00" is never leading.
// "30 Minutes ..." / "30 Mm ..." is the Bandai 30MM/30MF/30MS line name, not a number (measured on the real catalogue).
// A title that would end up empty keeps its original text.
export function stripCatalogueNumbers(title) {
  const t = title
    .replace(/\(\s*\d{1,4}\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(\d{1,3})\s+(?=(\S+))/, (m, n, next) => (Number(n) === 0 || (n === '30' && /^(minutes|mm)$/i.test(next)) ? m : ''));
  return t || title;
}

// Drops catalogue numbers, grade/scale/reseller noise so HLJ sees just the kit name. The comparator reads this
// cleaned name (fetchPhotoForKit passes it to find), so removed numbers are not required on the product page.
// Retailer leftovers go too: mojibake of a non-breaking space ("á"), a "BANMK65111GUNDAM" code, "High Grade", "Real Grade",
// "Maquette", "Scale", "1:144", the series when it is only a prefix ("Witch From Mercury 20 ..." or "... Mercury - High Grade -")
// and the separators they leave. A cut code "Msk 008" is glued back to "Msk-008". The stored title is never changed.
export function searchName(title) {
  const name = title
    .replace(/[áâ–€▀]+/g, ' ')
    .replace(/^BANMK\d+\s*GUNDAM\s*/i, '')
    .replace(/\b(?:The )?Witch From Mercury(?=\s+-|\s+\d)/gi, ' ')
    .replace(/\b(?:High Grade|Real Grade|Maquette|Scale)\b/gi, ' ')
    .replace(/\b([A-Za-z]{2,4}) (\d{3})\b/g, (m, a, n) => (/^(?:HG|RG|MG|PG|SD|EG|FM|RE)$/i.test(a) ? m : `${a}-${n}`));
  return stripCatalogueNumbers(name)
    .replace(/\b1[/:]\d+\b/g, ' ')
    .replace(/\b(?:HGUC|HGAC|HGBF|HGBD|HGCE|HGGTO|HGIBO|HG|RG|MG|PG|SD|EG|FM|Gunpla|Model Kit)\b/gi, ' ')
    .replace(/(?:\s*[-:]\s*){2,}/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A kit the importer gave no grade ("Gundam: High Grade - ...") may still write it in its title: read there, for the search only.
const gradeFromTitle = (title) => ({ high: 'HG', real: 'RG' })[/\b(high|real) grade\b/i.exec(title)?.[1].toLowerCase()] ?? null;

async function download(url, fetch) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('image trop volumineuse');
  // Content-Length may be absent or lie: cap while streaming.
  const chunks = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error('image trop volumineuse'); // leaving the loop cancels the stream
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// Providers are ranked by position (best first); a stored photo's rank is the provider owning its source_url.
// Unknown source (a provider that is no longer configured, or has no `host`) is never replaced.
function rankOf(providers, url) {
  try {
    const h = new URL(url).hostname;
    return providers.findIndex((p) => p.host && (h === p.host || h.endsWith(`.${p.host}`)));
  } catch {
    return -1; // malformed or missing source_url: unknown source
  }
}

// The providers worth trying for this kit: all if no photo, none if the photo is an upload (kind != 'auto') or from an
// unknown source, else only those ranked above the current source. An auto photo marked "a verifier" (uncertain) is asked
// to ALL sources, its own and the worse-ranked ones too: a sure match may replace it, a doubtful one never does.
// "Verified" and "sure" photos both have uncertain = 0 and are not told apart: neither is ever offered to a worse source.
export function providersToTry({ db, kitId, providers }) {
  const photo = getPhoto(db, kitId);
  if (!photo) return providers;
  if (photo.kind !== 'auto') return [];
  const rank = rankOf(providers, photo.source_url);
  return rank < 0 ? [] : photo.uncertain ? providers : providers.slice(0, rank);
}

// Per-source tally for one photo job: { [provider]: { found, uncertain, relaxed?, errors, refused: { [reason]: n } } }.
const tally = (stats, name) => (stats[name] ??= { found: 0, uncertain: 0, errors: 0, refused: {} });

// Circuit breaker: a source that failed this many times in a row is skipped for the rest of the job.
export const BREAKER = 5;

// Bump when the matching rules change (provider.js, shopify.js, searchName): remembered refusals then go stale.
export const RULES_VERSION = 3; // 3: titles normalised, cleaned name, missing code tolerated, scale checked (refusals of version 2 may now match)
const REFUSAL_TTL_MS = 7 * 24 * 3600 * 1000;

// Tries ONE source for one kit; never throws for provider/download problems: {found:false}.
// `stats` collects the per-source count; one log line per refused kit. `breaker` (a Map shared by one job) holds each
// source's consecutive errors. A match refusal is remembered for 7 days (same rules, same cleaned name + grade) and
// not asked again unless `force`; a source error is never remembered. `now` is the clock (tests).
// An auto photo is replaced only by a better-ranked source, or by a sure match (from any source) when it is marked
// uncertain; an uncertain hit is saved only when the kit has no photo yet, else it is remembered like a refusal (REASONS.kept).
// savePhoto itself refuses to touch uploads. Returns { found, uncertain } (uncertain: the saved photo is "a verifier").
export async function tryProvider({ db, dataDir, kitId, p, fetch = globalThis.fetch, stats = {}, breaker = new Map(), force = false, now = Date.now }) {
  const kit = db.prepare('SELECT title, grade, scale FROM kits WHERE id = ?').get(kitId);
  const name = kit && searchName(kit.title);
  if (!name) return { found: false };
  if ((breaker.get(p.name) ?? 0) >= BREAKER) return { found: false };
  const t = tally(stats, p.name);
  const grade = kit.grade ?? gradeFromTitle(kit.title);
  const key = `${name}|${grade ?? ''}`; // what decides the match: a renamed kit or a new grade is asked again
  if (!force) {
    const since = new Date(now() - REFUSAL_TTL_MS).toISOString();
    const known = db.prepare('SELECT 1 FROM photo_refusals WHERE kit_id = ? AND provider = ? AND rules_version = ? AND title_key = ? AND refused_at > ?');
    if (known.get(kitId, p.name, RULES_VERSION, key, since)) {
      t.skipped = (t.skipped ?? 0) + 1; // absent until used: earlier stats shapes stay as they were
      return { found: false };
    }
  }
  const hadPhoto = !!getPhoto(db, kitId);
  const fail = () => {
    const n = (breaker.get(p.name) ?? 0) + 1;
    breaker.set(p.name, n);
    if (n === BREAKER) console.error(`[photos] ${p.name}: ${n} source errors in a row, skipped for the rest of the job`);
  };
  try {
    let reason;
    const hit = await p.find(name, grade, (r) => (reason = r), scaleOf(kit.scale ?? kit.title));
    const kept = !!hit?.uncertain && hadPhoto; // a doubtful page never replaces a photo: remembered like a refusal
    if (reason === REASONS.source) fail();
    else if (!hit || kept) breaker.delete(p.name); // a hit is only healthy once its image downloaded (a CDN 403 counts as an error)
    if (kept) reason = REASONS.kept;
    if (!hit || kept) {
      if (reason === REASONS.source) t.errors++;
      else {
        t.refused[reason ??= REASONS.noResult] = (t.refused[reason] ?? 0) + 1;
        db.prepare('INSERT OR REPLACE INTO photo_refusals (kit_id, provider, reason, rules_version, title_key, refused_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          kitId, p.name, reason, RULES_VERSION, key, new Date(now()).toISOString(),
        );
      }
      console.error(`[photos] kit ${kitId} ${p.name}: refused (${reason})`);
      return { found: false };
    }
    const bytes = await download(hit.imageUrl, fetch);
    breaker.delete(p.name);
    const sourceUrl = hit.pageUrl ?? hit.imageUrl;
    if (savePhoto({ db, dataDir, kitId, bytes, kind: 'auto', sourceUrl, uncertain: !!hit.uncertain })) {
      db.prepare('DELETE FROM photo_refusals WHERE kit_id = ? AND provider = ?').run(kitId, p.name); // this source no longer refuses the kit (better-ranked refusals stay)
      t.found++;
      if (hit.uncertain) {
        t.uncertain++;
        const slug = new URL(sourceUrl).pathname.replace(/^\//, ''); // path only: no query, no host
        const extra = (hit.extra ?? []).join(' ');
        const why = (hit.missing?.length ? `; mot manquant : ${hit.missing.join(' ')}` : '') + (hit.noGrade ? '; grade absent' : '');
        if (hit.relaxed) {
          t.relaxed = (t.relaxed ?? 0) + 1; // absent until used: earlier stats shapes stay as they were
          console.error(`[photos] kit ${kitId} ${p.name}: uncertain (relaxed query; dropped: ${(hit.dropped ?? []).join(' ')}; ${slug}; extra: ${extra}${why})`);
        } else console.error(`[photos] kit ${kitId} ${p.name}: uncertain (${slug}; extra words: ${extra}${why})`);
      }
      return { found: true, uncertain: !!hit.uncertain };
    }
  } catch (err) {
    t.errors++;
    fail();
    console.error(`[photos] kit ${kitId} via ${p.name}: ${err.message}`);
  }
  return { found: false };
}

// One kit through its sources in rank order, one after the other. The first sure match wins; a doubtful one is kept
// but the next sources are still asked, since only a sure match may replace it.
export async function fetchPhotoForKit({ db, kitId, providers, ...rest }) {
  let found = false;
  for (const p of providersToTry({ db, kitId, providers })) {
    const r = await tryProvider({ db, kitId, p, ...rest });
    found ||= r.found;
    if (r.found && !r.uncertain) break;
  }
  return { found };
}

// Pipeline: one stage per source, all running at once, each with its own pacing (the provider's gate), concurrency
// (`p.concurrency`, default 2) and breaker. A kit enters the best source's stage and moves to the next only when that
// source did not find it, so its sources are still tried in rank order, one at a time. `todo`: [{ kitId, wanted: [providers] }].
// Calls onKit(found) once per kit when all its stages are done; resolves when every kit is.
export function fetchPhotos({ db, dataDir, todo, providers, fetch, stats = {}, breaker = new Map(), force, now, onKit = () => {} }) {
  return new Promise((resolve) => {
    let left = todo.length;
    if (!left) return resolve();
    const stages = providers.map((p) => ({ p, queue: [], active: 0 }));
    const doubtful = new Set(); // kits holding a doubtful photo found in this job: the next sources may still improve it
    const finish = (found) => (onKit(found), --left || resolve());
    const advance = (k, i) => {
      while (i < stages.length && !k.wanted.includes(stages[i].p)) i++;
      if (i === stages.length) return finish(doubtful.has(k));
      stages[i].queue.push(k);
      pump(i);
    };
    const pump = (i) => {
      const s = stages[i];
      while (s.active < (s.p.concurrency ?? 2) && s.queue.length) {
        const k = s.queue.shift();
        s.active++;
        tryProvider({ db, dataDir, kitId: k.kitId, p: s.p, fetch, stats, breaker, force, now })
          .catch((err) => (console.error(`[photos] kit ${k.kitId} via ${s.p.name}: ${err.message}`), { found: false }))
          .then((r) => {
            s.active--;
            if (r.found && r.uncertain) doubtful.add(k);
            r.found && !r.uncertain ? finish(true) : advance(k, i + 1);
            pump(i);
          });
      }
    };
    todo.forEach((k) => advance(k, 0));
  });
}
