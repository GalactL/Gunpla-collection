// Cleans a raw retailer title ("BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA")
// into { title, grade, scale, series, franchise }. Best effort: grade/scale/series are null when unknown;
// franchise is never empty ("Autre" when nothing is recognised) and series only holds Gundam series.

// Ordered: first match wins. Keywords are matched on the upper-cased title.
const SERIES = [
  ['GQuuuuuuX', /GQU+X|\bGQUX\b/],
  ['Iron-Blooded Orphans', /IRON-?BLOODED|BARBATOS|GUSION|KIMARIS|GRIMGERDE|\bIBO\b/],
  ['Mercure', /MERCUR|AERIAL|CALIBARN|SCHWARZETTE|DILANZA|LFRITH/],
  ['Wing', /\bWING\b|TALLGEESE|EPYON|DEATHSCYTHE|HEAVYARMS|SANDROCK|SHENLONG/],
  ['Zeta', /\bZETA\b|HYAKU|QUBELEY|HAMBRABI|\bMK-?II\b|\bMARK II\b/],
  ['00', /\bEXIA\b|DYNAMES|KYRIOS|VIRTUE|\b(?:00|OO)\b|OO-RAISER|SEVEN SWORD|QAN\[T\]/],
  ['SEED', /\bSEED\b|\bSTRIKE\b|FREEDOM|JUSTICE|IMPULSE|DESTINY|ASTRAY|PROVIDENCE|\bAEGIS\b|\bLEGEND GUNDAM\b/],
  ['Turn A', /TURN A/],
  ['Victory', /V-DASH|VICTORY|\bV2\b/],
  ['G Gundam', /GF13|GOD GUNDAM|MASTER GUNDAM|SHINING GUNDAM/],
  [
    'UC',
    /UNICORN|BANSHEE|SINANJU|ZAKU|GELGOOG|FAZZ|SAZABI|\bNU GUNDAM|HI-?NU|\bRX-\d|\bMSN?-\d|REZEL|RE-ZEL|RGZ-|\bGM\b|RICK DOM|PERFECT GUNDAM|FULL ARMOR|VIGNA|GUNCANNON|\bZZ\b|\bTHE 0\b|G ARMOR|GEARA|\bDOGA\b|\bF91\b/,
  ],
];

// Non-Gundam licences, by keyword on the upper-cased title.
const LICENCES = [
  ['Evangelion', /EVANGELION|\bEVA\b/],
  ['Macross', /MACROSS|\b[VY]F-\d/],
  ['One Piece', /ONE PIECE|CHOPPER/],
  ['Pokémon', /POK[EÉ]MON|POKEPLA/],
  ['Dragon Ball', /DRAGON BALL|\bDBZ\b/],
  ['Digimon', /DIGIMON/],
];
export const FRANCHISES = ['Gundam', ...LICENCES.map(([f]) => f), 'Autre'];

const GRADES = [
  [/\bMGSD\b|\bSD(?:W|CS)?\b/, 'SD'],
  [/\bHG[A-Z]{0,5}\b/, 'HG'],
  [/\bRG\b/, 'RG'],
  [/\bMG\b/, 'MG'],
  [/\bPG\b/, 'PG'],
  [/\bEG\b|\bENTRY GRADE\b/, 'EG'],
  [/\bFM\b|\bFULL MECHANICS\b/, 'FM'],
  [/\bRE\/100\b/, 'RE'],
];

const KEEP_UPPER = new Set(['II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'ZZ', 'GM', 'EW', 'MS', 'OO', 'MK', 'DX', 'EX', 'SD', 'UC', 'TV', 'NGE']);
const CASE_OVERRIDE = { GQUUUUUUX: 'GQuuuuuuX' };

const caseWord = (w) => {
  if (/[a-z]/.test(w)) return w; // already mixed case: trust the source
  if (CASE_OVERRIDE[w]) return CASE_OVERRIDE[w];
  if (/\d/.test(w) || KEEP_UPPER.has(w)) return w;
  return w.replace(/[A-Z]+/g, (p) => p[0] + p.slice(1).toLowerCase());
};

export function cleanTitle(raw) {
  const original = String(raw ?? '');
  let t = original
    .replace(/Â/g, '') // site mojibake (stray "Â" next to nbsp)
    .replace(/[ \s]+/g, ' ')
    .trim();
  t = t.replace(/^[A-Z]{2,5}\d{3,}\s+/, ''); // retailer code: BANMK58880, PKP68850...
  t = t.replace(/^\d{3,}\s+(?=[A-Za-z])/, ''); // catalogue number: "175 Unicorn..." (1-2 digits kept: "00 Raiser")
  t = t.replace(/\bGUNDAM\s*(?:-\s*)?GUNPLA\b/gi, ' ').replace(/\bGUNPLA\b/gi, ' ');

  let scale = null;
  const sm = /\b1\/(\d{1,3})\b/.exec(t);
  if (sm) {
    scale = `1/${sm[1]}`;
    t = t.replace(sm[0], ' ');
  }

  // Gundam word wins, then an external licence, then a recognised Gundam series, else "Autre".
  const up = t.toUpperCase();
  const gundamSeries = SERIES.find(([, re]) => re.test(up))?.[0] ?? null;
  const licence = LICENCES.find(([, re]) => re.test(up))?.[0];
  const franchise = /GUNDAM/.test(original.toUpperCase()) ? 'Gundam' : (licence ?? (gundamSeries ? 'Gundam' : 'Autre'));
  const series = franchise === 'Gundam' ? gundamSeries : null;

  let grade = null;
  for (const [re, g] of GRADES) {
    const m = re.exec(t.toUpperCase());
    if (!m) continue;
    grade = g;
    t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
    break;
  }
  if (grade === 'RE' && !scale) scale = '1/100';

  t = t.replace(/\s+/g, ' ').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '');
  t = t.replace(/^(?:POK[EÉ]MON|DIGIMON|DRAGON BALL|ONE PIECE)\s*[-–:]\s+/i, ''); // licence prefix "Pokemon - X", stripped after the franchise is detected
  t = t.replace(/^(\([^)]{1,6}\))\s+(.+)$/, '$2 $1'); // "(06) LIGHT-TYPE" -> "LIGHT-TYPE (06)"
  t = t.replace(/[A-Za-z0-9][A-Za-z0-9'’\[\]-]*/g, caseWord);
  t = t.replace(/\bVer\.?\s*Ka\b/gi, 'Ver.Ka').replace(/\bVer\b(?=\s*\d)/g, 'Ver.');

  return { title: t || original.trim(), grade, scale, series, franchise };
}
