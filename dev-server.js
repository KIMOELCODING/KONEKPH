// Tiny static dev server with SPA fallback for /admin/*.
// Run: node dev-server.js   (defaults to port 8000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8000;
const ADMIN_INDEX = path.join(ROOT, 'admin', 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname.includes('..')) return send(res, 400, 'Bad path');

  // Default doc
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return serveFile(res, filePath);

    // SPA fallback: ONLY for /admin/* paths that look like routes, not assets.
    // A "route" has no file extension in its last segment. Asset 404s must stay
    // 404s so the browser reports them cleanly instead of getting HTML back.
    const lastSeg = pathname.split('/').pop() || '';
    const looksLikeAsset = lastSeg.includes('.');
    if (pathname.startsWith('/admin/') && !looksLikeAsset) return serveFile(res, ADMIN_INDEX);

    send(res, 404, 'Not found');
  });
});

server.listen(PORT, () => {
  console.log(`[dev-server] serving ${ROOT} on http://localhost:${PORT}/`);
  console.log(`[dev-server] SPA fallback enabled for /admin/*`);
});
