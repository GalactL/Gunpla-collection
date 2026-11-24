import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle } from '../../src/catalogue/title.js';

// Raw titles are typical kit names from the Maquettes shelves (fixtures are synthetic, see tests/fixtures/canalbd/FACTS.md).
// [raw, title, grade, scale, series, franchise]
const CASES = [
  ['BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA', 'Fazz Ver.Ka', 'MG', '1/100', 'UC', 'Gundam'],
  ['1/100 MG RX-0 UNICORN GUNDAM 02 BANSHEE', 'RX-0 Unicorn Gundam 02 Banshee', 'MG', '1/100', 'UC', 'Gundam'],
  ['GUNDAM - GUNPLA MG 1/100 EXIA', 'Exia', 'MG', '1/100', '00', 'Gundam'],
  ['BANMK61580 GUNDAM GUNPLA MG 1/100 ZAKU II VER. 2.0', 'Zaku II Ver. 2.0', 'MG', '1/100', 'UC', 'Gundam'],
  ['1/100 MG V-DASH GUNDAM VER. KA', 'V-Dash Gundam Ver.Ka', 'MG', '1/100', 'Victory', 'Gundam'],
  ['BANMK68707 GUNDAM GUNPLA MG 1/100 GUNDAM BARBATOS LUPUS', 'Gundam Barbatos Lupus', 'MG', '1/100', 'Iron-Blooded Orphans', 'Gundam'],
  ['1/144 HGGQUX (06) LIGHT-TYPE GUNCANNON', 'Light-Type Guncannon (06)', 'HG', '1/144', 'GQuuuuuuX', 'Gundam'],
  ['GUNDAM GUNPLA PG 1/60 RX-0[N] UNICORN GUNDAM 02 BANSHEE NORN', 'RX-0[N] Unicorn Gundam 02 Banshee Norn', 'PG', '1/60', 'UC', 'Gundam'],
  ['GUNDAM GUNPLA MEGA SIZE MODEL 1/48 MS-06S ZAKU IIÂ ', 'Mega Size Model MS-06S Zaku II', null, '1/48', 'UC', 'Gundam'],
  ['1/100 RE/100 (009) VIGNA-GHINA MS XM-07', 'Vigna-Ghina MS XM-07 (009)', 'RE', '1/100', 'UC', 'Gundam'],
  ['BANMK67432 GUNDAM GUNPLA MGSD WING GUNDAM ZERO EW', 'Wing Gundam Zero EW', 'SD', null, 'Wing', 'Gundam'],
  ['GUNDAM - GUNPLA SD  RX-0  UNICORN 02 BANSHEE NORM', 'RX-0 Unicorn 02 Banshee Norm', 'SD', null, 'UC', 'Gundam'],
  ['Gundam Gunpla MG 1/100 Force Impulse', 'Force Impulse', 'MG', '1/100', 'SEED', 'Gundam'],
  ['RG NGE EVA UNIT 02 1/144', 'NGE Eva Unit 02', 'RG', '1/144', null, 'Evangelion'],
  ['1/144 HGBC (027) THE NORTHERN POD (SUPPORT UNIT)', 'The Northern Pod (Support Unit) (027)', 'HG', '1/144', null, 'Autre'],
  // Non-Gunpla maquettes: no grade, scale only when written; no Gundam series either
  ['ONE PIECE MAQUETTE GRAND SHIP COLLECTION GOING MERRY NETFLIX VER', 'One Piece Maquette Grand Ship Collection Going Merry Netflix Ver', null, null, null, 'One Piece'],
  ['PKP68850 POKEMON POKEPLA 59 SELECT MIRAIDON', 'Pokemon Pokepla 59 Select Miraidon', null, null, null, 'Pokémon'],
  ['175 UNICORN GUNDAM 02 BANSHEE NORN DESTROY MODE', 'Unicorn Gundam 02 Banshee Norn Destroy Mode', null, null, 'UC', 'Gundam'],
  ['1/100 MG 00 RAISER', '00 Raiser', 'MG', '1/100', '00', 'Gundam'],
  ['POKEMON - POKEPLA AMPHINOBI', 'Pokepla Amphinobi', null, null, null, 'Pokémon'],
  ['ONE PIECE - GOING MERRY', 'Going Merry', null, null, null, 'One Piece'],
  ['DIGIMON - AGUMON', 'Agumon', null, null, null, 'Digimon'],
  ['POKEMON - PIKACHU', 'Pikachu', null, null, null, 'Pokémon'],
  ['1/24 TOYOTA COROLLA LEVIN AE85 (85)', 'Toyota Corolla Levin AE85 (85)', null, '1/24', null, 'Autre'],
];

for (const [raw, title, grade, scale, series, franchise] of CASES) {
  test(`cleanTitle ${raw}`, () => {
    assert.deepEqual(cleanTitle(raw), { title, grade, scale, series, franchise });
  });
}

test('cleanTitle sans rien à nettoyer ni titre vide', () => {
  assert.equal(cleanTitle('').title, '');
  assert.deepEqual(cleanTitle('BANMK1234'), { title: 'BANMK1234', grade: null, scale: null, series: null, franchise: 'Autre' });
});

test('franchise : mot-clé externe, Gundam seulement par mot ou série, sinon Autre', () => {
  const f = (raw) => cleanTitle(raw).franchise;
  assert.equal(f('DRAGON BALL Z GOKU MODEL KIT'), 'Dragon Ball');
  assert.equal(f('DIGIMON GREYMON'), 'Digimon');
  assert.equal(f('1/72 VF-1S MACROSS VALKYRIE'), 'Macross');
  assert.equal(f('POKÉMON PLAMO PIKACHU'), 'Pokémon');
  assert.equal(f('GUNDAM GUNPLA HG 1/144 MYSTERY SUIT'), 'Gundam'); // mot « Gundam » sans série reconnue
  assert.equal(f('1/144 HG ZAKU II'), 'Gundam'); // série reconnue sans le mot
  assert.equal(f('PEINTURE ACRYLIQUE GRIS'), 'Autre');
  // une licence externe ne laisse jamais de « série » Gundam (ex. \bWING\b)
  const mac = cleanTitle('1/72 MACROSS VF-25 WING SET');
  assert.deepEqual([mac.franchise, mac.series], ['Macross', null]);
});
