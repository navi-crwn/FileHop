// Build small real test files: a PNG, a JPEG, a PDF with 3 pages, CSV, JSON, YAML, MD, and a ZIP.
// Run with: node tools/make-fixtures.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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

/* --- HEIC: a real 320x220 file written by libheif (via pillow-heif) from the sample JPEG --- */
copyFileSync('tools/fixtures-sample.heic', `${dir}/sample.heic`);

/* --- JPEG XL: encoded here with libjxl, a 240x160 gradient --- */
{
  // the encoder's own loader fetches its .wasm over HTTP; in Node hand it the bytes instead
  const { default: factory } = await import('@jsquash/jxl/codec/enc/jxl_enc.js');
  const { defaultOptions } = await import('@jsquash/jxl/meta.js');
  const wasmBinary = readFileSync('node_modules/@jsquash/jxl/codec/enc/jxl_enc.wasm');
  const jxl = await factory({ noInitialRun: true, wasmBinary });
  const w = 240, h = 160;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = Math.round((x / w) * 245); rgba[i + 1] = Math.round((y / h) * 180);
    rgba[i + 2] = 90 + Math.round(((x + y) / (w + h)) * 120); rgba[i + 3] = 255;
  }
  const out = jxl.encode(rgba, w, h, { ...defaultOptions, quality: 80 });
  writeFileSync(`${dir}/sample.jxl`, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
}

/* --- Camera RAW, synthetic: a little-endian TIFF header whose IFD0 says
   "Orientation = 6" (rotate 90° clockwise), then a thumbnail JPEG, a block that
   starts like a JPEG but is lossless (SOF3, as real CR2/DNG sensor data is) and
   the full-size JPEG preview. Real camera files are not committed; this one
   exercises the same preview search without any. --- */
{
  const preview = readFileSync(`${dir}/sample.jpg`);
  const thumb = Buffer.from('C:/Program Files/Git/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP/CAAsIAAEAAQEBEQD/xAAUAAEAAAAAAAAAAAAAAAAAAAAJ/9oACAEBAAA/ANLPIP/Z', 'base64'); // a 129-byte JPEG standing in for the camera's thumbnail
  const head = Buffer.alloc(8 + 2 + 12 + 4);
  head.write('II', 0, 'ascii'); head.writeUInt16LE(42, 2); head.writeUInt32LE(8, 4);
  head.writeUInt16LE(1, 8);                       // one IFD entry
  head.writeUInt16LE(0x0112, 10); head.writeUInt16LE(3, 12); head.writeUInt32LE(1, 14);
  head.writeUInt16LE(6, 18);                      // Orientation = 6
  head.writeUInt32LE(0, 22);                      // no next IFD
  const lossless = Buffer.from([0xff, 0xd8, 0xff, 0xc3, 0x00, 0x0b, 0x08, 0x10, 0x00, 0x10, 0x00, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
  writeFileSync(`${dir}/sample.nef`, Buffer.concat([head, thumb, lossless, preview]));
}

/* --- TIFF: 32x16 RGB, uncompressed, little endian, written by hand (Chrome and Firefox cannot open TIFF themselves) --- */
{
  const w = 32, h = 16, entries = 9, pix = w * h * 3;
  const ifdAt = 8, dataAt = ifdAt + 2 + entries * 12 + 4;   // pixel data follows the IFD
  const bpsAt = dataAt + pix;                               // BitsPerSample: 3 shorts
  const buf = Buffer.alloc(bpsAt + 6);
  buf.write('II', 0, 'ascii'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdAt, 4);
  buf.writeUInt16LE(entries, ifdAt);
  const tags = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, bpsAt], [259, 3, 1, 1], [262, 3, 1, 2],
    [273, 4, 1, dataAt], [277, 3, 1, 3], [278, 3, 1, h], [279, 4, 1, pix]];
  tags.forEach(([tag, type, count, value], i) => {
    const o = ifdAt + 2 + i * 12;
    buf.writeUInt16LE(tag, o); buf.writeUInt16LE(type, o + 2); buf.writeUInt32LE(count, o + 4);
    if (type === 3 && count === 1) buf.writeUInt16LE(value, o + 8); else buf.writeUInt32LE(value, o + 8);
  });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = dataAt + (y * w + x) * 3;
    buf[o] = Math.round((x / (w - 1)) * 255); buf[o + 1] = Math.round((y / (h - 1)) * 255); buf[o + 2] = 128;
  }
  buf.writeUInt16LE(8, bpsAt); buf.writeUInt16LE(8, bpsAt + 2); buf.writeUInt16LE(8, bpsAt + 4);
  writeFileSync(`${dir}/sample.tiff`, buf);
}

console.log('fixtures written to', dir);
