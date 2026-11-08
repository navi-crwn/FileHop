// A tiny static server for the built app, with the headers FileHop will ship
// behind nginx. No dependency, no framework: the app is files on disk.
//
//   npm run build && npm start          → http://localhost:4180
//   PORT=8080 npm start                 → another port
//
// The headers are the ones in the plan: cross-origin isolation (so Safari also
// gets SharedArrayBuffer-capable contexts), a CSP with no CDN and no inline
// script beyond the theme boot, and immutable caching for hashed assets.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createBrotliCompress, createGzip } from 'node:zlib';

const root = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 4180);

if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

/* The CSP is written out here rather than in a meta tag so the same string can
   move to nginx unchanged. 'wasm-unsafe-eval' is required by hash-wasm and
   pdf.js; no other inline execution is allowed. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  // never let a request climb out of dist/
  path = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    // single-page app: unknown paths get the shell, but only when they look like routes
    if (!extname(path)) {
      file = join(root, 'index.html');
    } else {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin'
      });
      res.end('not found');
      return;
    }
  }

  const ext = extname(file).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const hashed = /\/assets\//.test(path.replace(/\\/g, '/'));
  const stat = statSync(file);

  const headers = {
    'content-type': type,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'content-security-policy': CSP,
    'last-modified': stat.mtime.toUTCString(),
    // engine bytes never change under a hashed name; the shell must not be cached hard
    'cache-control': hashed || path.includes('/hop-fonts/') || path.includes('/vendor/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
  };

  const accepts = String(req.headers['accept-encoding'] ?? '');
  const compressible = /text|javascript|json|svg|font/.test(type) && stat.size > 1024;

  if (compressible && accepts.includes('br')) {
    headers['content-encoding'] = 'br';
    headers['vary'] = 'accept-encoding';
    res.writeHead(200, headers);
    createReadStream(file).pipe(createBrotliCompress()).pipe(res);
    return;
  }
  if (compressible && accepts.includes('gzip')) {
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'accept-encoding';
    res.writeHead(200, headers);
    createReadStream(file).pipe(createGzip()).pipe(res);
    return;
  }

  headers['content-length'] = String(stat.size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  const bytes = Buffer.byteLength(index);
  console.log(`FileHop on http://localhost:${port}  (dist/, shell ${bytes} B, brotli + gzip on)`);
});
