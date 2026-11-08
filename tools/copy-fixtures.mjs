// Build removes dist/, so the manual-test fixtures have to be copied back after
// every build. This is only for local testing: a deploy never includes testdata/.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

if (!existsSync('web/dist/index.html')) {
  console.error('No dist/. Run `npm run build` first.');
  process.exit(1);
}
if (!existsSync('testdata')) {
  console.error('No testdata/. Run `npm run fixtures` and `node tools/make-hostile.mjs` first.');
  process.exit(1);
}
mkdirSync('web/dist/testdata', { recursive: true });
cpSync('testdata', 'web/dist/testdata', { recursive: true });
console.log(`copied ${readdirSync('testdata').length} fixtures into web/dist/testdata/ (local testing only)`);
