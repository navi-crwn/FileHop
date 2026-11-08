// Build small real test files: a PNG, a JPEG, a PDF with 3 pages, CSV, JSON, YAML, MD, and a ZIP.
// Run with: node tools/make-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { zipSync } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const dir = 'testdata';
mkdirSync(dir, { recursive: true });

/* --- PNG: 240x160 gradient, hand-rolled so we add no dependency --- */
function crc32buf(buf) {
  return crc32(Buffer.from(buf)) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32buf(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const i = off + 1 + x * 3;
      raw[i] = Math.round((x / w) * 245);
      raw[i + 1] = Math.round((y / h) * 180);
      raw[i + 2] = 90 + Math.round(((x + y) / (w + h)) * 120);
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
writeFileSync(`${dir}/sample.png`, makePng(240, 160));

/* --- JPEG: copied from tools/fixtures-sample.jpg, a real 320x220 file produced
   by the browser (a hand-written minimal JPEG is easy to get subtly wrong: an
   invalid JFIF decodes to nothing, which looks like a converter bug). --- */
import { copyFileSync } from 'node:fs';
copyFileSync('tools/fixtures-sample.jpg', `${dir}/sample.jpg`);

/* --- PDF: three pages with text, so merge/split/rotate/pick have something real --- */
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 3; n++) {
  const page = pdf.addPage([420, 595]);
  page.drawText(`FileHop test page ${n}`, { x: 48, y: 520, size: 22, font, color: rgb(0.1, 0.1, 0.12) });
  page.drawText(`id: page-${n}`, { x: 48, y: 490, size: 11, font, color: rgb(0.4, 0.4, 0.45) });
  page.drawRectangle({ x: 48, y: 440, width: 120 * n, height: 8, color: rgb(0.96, 0.62, 0.04) });
}
pdf.setTitle('FileHop test');
writeFileSync(`${dir}/sample.pdf`, await pdf.save());

/* --- CSV / TSV / JSON / YAML / MD / HTML --- */
writeFileSync(`${dir}/people.csv`, 'name,city,languages\nAda,London,3\nBudi,Jakarta,2\nChen,Shanghai,4\n');
writeFileSync(`${dir}/people.tsv`, 'name\tcity\tlanguages\nAda\tLondon\t3\nBudi\tJakarta\t2\n');
writeFileSync(`${dir}/people.json`, JSON.stringify([
  { name: 'Ada', city: 'London', languages: 3 },
  { name: 'Budi', city: 'Jakarta', languages: 2 },
  { name: 'Chen', city: 'Shanghai', languages: 4, tags: ['a', 'b'] }
], null, 2));
writeFileSync(`${dir}/people.yaml`, 'people:\n  - name: Ada\n    city: London\n');
writeFileSync(`${dir}/readme.md`, '# FileHop\n\nA **local** converter.\n\n- no uploads\n- no queue\n\n```js\nconst x = 1;\n```\n');
writeFileSync(`${dir}/page.html`, '<h1>Hello</h1><p>Some <em>text</em> and a <a href="https://hel.ink">link</a>.</p><script>alert(1)</script>');

/* --- archives --- */
writeFileSync(`${dir}/bundle.zip`, zipSync({
  'notes/a.txt': new TextEncoder().encode('alpha\n'),
  'notes/b.txt': new TextEncoder().encode('beta\n'),
  'data.csv': new TextEncoder().encode('x,y\n1,2\n')
}));

console.log('fixtures written to', dir);
