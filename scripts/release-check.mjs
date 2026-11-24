// Vérifie que le tag de release (v1.2.3) égale « v » + version de package.json. Usage : TAG=v1.0.0 node scripts/release-check.mjs
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkTag(tag, version) {
  return tag === `v${version}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.env.TAG ?? '';
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (!checkTag(tag, version)) {
    console.error(`Le tag « ${tag} » ne correspond pas à la version de package.json (v${version}). Release annulée.`);
    process.exit(1);
  }
  console.log(`Tag ${tag} conforme à package.json.`);
}
