// Copies the data files pdf.js loads at run time into public/vendor/pdfjs/,
// from the installed pdfjs-dist, so they always match the library version:
//   standard_fonts/  the standard PDF fonts for files that name a font without
//                    embedding it. Only the Foxit set (BSD-3-Clause, PDFium):
//                    pdf.js also ships LiberationSans, which is GPL-2.0 with
//                    a font exception, and FileHop carries no GPL code or data.
//                    Without it a non-embedded Helvetica/Arial is not drawn.
//   cmaps/           character maps for CJK text
// Runs before `vite dev` and `vite build`; the folder is not committed.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = dirname(require.resolve('pdfjs-dist/package.json'));
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor', 'pdfjs');

rmSync(dest, { recursive: true, force: true });
for (const dir of ['standard_fonts', 'cmaps']) {
  const from = join(src, dir);
  if (!existsSync(from)) {
    console.error(`pdfjs-dist has no ${dir}/ (looked in ${src})`);
    process.exit(1);
  }
  cpSync(from, join(dest, dir), {
    recursive: true,
    filter: p => !/Liberation/i.test(p.slice(from.length))
  });
}
console.log(`pdf.js data copied to ${dest}`);
