// Build removes dist/, so the manual-test fixtures have to be copied back after
// every build. This is only for local testing: a deploy never includes testdata/.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

if (!existsSync('dist/index.html')) {
  console.error('No dist/. Run `npm run build` first.');
  process.exit(1);
}
if (!existsSync('testdata')) {
  console.error('No testdata/. Run `npm run fixtures` and `node tools/make-hostile.mjs` first.');
  process.exit(1);
}
mkdirSync('dist/testdata', { recursive: true });
cpSync('testdata', 'dist/testdata', { recursive: true });
console.log(`copied ${readdirSync('testdata').length} fixtures into dist/testdata/ (local testing only)`);
