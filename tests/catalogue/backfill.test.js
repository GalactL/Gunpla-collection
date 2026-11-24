import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { tmpDataDir } from '../helpers/index.js';

// A database created before franchises existed: no franchise column, licences stored as "series".
const OLD = [
  ['A', 'BANMK58880 GUNDAM GUNPLA MG 1/100 FAZZ VER.KA', 'UC'],
  ['B', 'ONE PIECE MAQUETTE GRAND SHIP COLLECTION GOING MERRY', 'One Piece'],
  ['C', 'PKP68850 POKEMON POKEPLA 59 SELECT MIRAIDON', 'Pokemon'],
  ['D', '1/24 TOYOTA COROLLA LEVIN AE85 (85)', null],
];

test('les kits déjà importés reçoivent leur franchise au démarrage, rejouer ne change rien', () => {
  const { dir, cleanup } = tmpDataDir();
  try {
    const old = new DatabaseSync(join(dir, 'gunpla.db'));
    old.exec('CREATE TABLE kits (id INTEGER PRIMARY KEY, source_id TEXT UNIQUE NOT NULL, raw_title TEXT NOT NULL, title TEXT NOT NULL, grade TEXT, scale TEXT, series TEXT, shelf TEXT, release_date TEXT, source_url TEXT, cover_url TEXT, imported_at TEXT)');
    const ins = old.prepare('INSERT INTO kits (source_id, raw_title, title, series) VALUES (?, ?, ?, ?)');
    for (const [id, raw, series] of OLD) ins.run(id, raw, raw, series);
    old.close();

    const read = (db) => db.prepare('SELECT source_id, franchise, series FROM kits ORDER BY id').all().map((r) => ({ ...r }));
    const db1 = openDb(dir);
    const first = read(db1);
    assert.deepEqual(first, [
      { source_id: 'A', franchise: 'Gundam', series: 'UC' },
      { source_id: 'B', franchise: 'One Piece', series: null },
      { source_id: 'C', franchise: 'Pokémon', series: null },
      { source_id: 'D', franchise: 'Autre', series: null },
    ]);
    db1.close();

    const db2 = openDb(dir); // second start: nothing recomputed, nothing duplicated
    assert.deepEqual(read(db2), first);
    db2.close();
  } finally {
    cleanup();
  }
});
