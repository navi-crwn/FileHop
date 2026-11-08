// A PDF that tries to run JavaScript on open. FileHop must read it without
// executing anything: pdf.js is opened with isEvalSupported:false.
// Run with: node tools/make-hostile.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray } from 'pdf-lib';
import { zipSync } from 'fflate';

const dir = 'testdata';
mkdirSync(dir, { recursive: true });

const pdf = await PDFDocument.create();
const page = pdf.addPage([300, 200]);
page.drawText('nothing to see', { x: 24, y: 100, size: 14 });
// a real /OpenAction javascript, correctly referenced so the file is valid
pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.register(
  pdf.context.obj({
    Type: 'Action',
    S: 'JavaScript',
    JS: PDFString.of('app.alert("pwned"); window.__pdfRan = 1;')
  })
));
writeFileSync(`${dir}/hostile-openaction.pdf`, await pdf.save());

// a ZIP whose entry escapes the archive root
writeFileSync(`${dir}/hostile-slipslip.zip`, zipSync({
  '../../../../tmp/pwned.txt': new TextEncoder().encode('escaped\n'),
  'safe/readme.txt': new TextEncoder().encode('this one is fine\n')
}));

// a ZIP that expands far beyond its size (ratio guard)
const big = new Uint8Array(48 * 1024 * 1024); // 48 MB of zeros compresses to a few KB
for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
writeFileSync(`${dir}/hostile-ratio.zip`, zipSync({ 'bomb.bin': big }, { level: 9 }));

// an SVG carrying a script: must render, never run
writeFileSync(`${dir}/hostile-script.svg`,
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">' +
  '<script>window.__svgRan=1</script>' +
  '<rect width="200" height="120" fill="#f59e0b"/>' +
  '<circle cx="100" cy="60" r="40" fill="#8b5cf6"/>' +
  '</svg>');

console.log('hostile fixtures written to', dir);
void PDFArray; void PDFDict;
