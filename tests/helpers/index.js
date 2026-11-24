import { cleanTitle } from '../../src/catalogue/title.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';

export function tmpDataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gunpla-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Starts the app on port 0. api(method, path, body) -> { status, body }.
export async function startApp(dataDir) {
  const app = await createServer({ dataDir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { ...app, base, api };
}

export function addKit(db, n = 1, title = `Kit ${n}`) {
  return Number(
    db
      .prepare('INSERT INTO kits (source_id, raw_title, title, grade, scale, series, franchise) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`SRC${n}`, `RAW ${title}`, title, 'MG', '1/100', 'Gundam', 'Gundam').lastInsertRowid,
  );
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

// Kit row built the way the importer does (cleanTitle), not a hand-made title.
export function addRealKit(db, n, raw, franchise) {
  const c = cleanTitle(raw);
  return Number(
    db
      .prepare('INSERT INTO kits (source_id, raw_title, title, grade, scale, series, franchise) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`R${n}`, raw, c.title, c.grade, c.scale, c.series, franchise ?? c.franchise).lastInsertRowid,
  );
}
