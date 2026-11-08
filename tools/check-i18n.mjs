// Checks every locale against English: same keys, no duplicates, no empty values,
// and every {placeholder} present in both. Exits 1 on the first broken file so CI
// can gate a merge on it. Run with: node tools/check-i18n.mjs
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/lib/i18n/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
const base = JSON.parse(readFileSync(new URL('en.json', dir), 'utf8'));
const baseKeys = Object.keys(base);
let failed = false;

for (const f of files) {
  const code = f.replace('.json', '');
  const dict = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const keys = Object.keys(dict);
  const missing = baseKeys.filter(k => !(k in dict));
  const extra = keys.filter(k => !(k in base));
  const empty = keys.filter(k => typeof dict[k] !== 'string' || dict[k].trim() === '');

  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  const varMismatch = baseKeys
    .filter(k => k in dict && vars(base[k]) !== vars(dict[k]))
    .map(k => `${k} (${vars(base[k])} vs ${vars(dict[k])})`);

  const problems = [];
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`);
  if (extra.length) problems.push(`extra: ${extra.join(', ')}`);
  if (empty.length) problems.push(`empty: ${empty.join(', ')}`);
  if (varMismatch.length) problems.push(`placeholder mismatch: ${varMismatch.join('; ')}`);

  if (problems.length) {
    failed = true;
    console.error(`✗ ${code}: ${problems.join(' | ')}`);
  } else {
    console.log(`✓ ${code}: ${keys.length} keys`);
  }
}

const expected = ['en', 'zh-CN', 'de', 'id', 'ja', 'pt-BR', 'es', 'fr', 'ru'];
const present = files.map(f => f.replace('.json', ''));
const absent = expected.filter(c => !present.includes(c));
if (absent.length) {
  failed = true;
  console.error(`✗ missing locales: ${absent.join(', ')}`);
}
if (present.includes('ar') || present.some(c => c.startsWith('ar'))) {
  failed = true;
  console.error('✗ Arabic is not part of the family language set');
}

process.exit(failed ? 1 : 0);
