// Serves the exported PC (web) version from ./dist on http://127.0.0.1:8081
// with the headers SQLite needs in the browser. No dependencies.
import { exec } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const HOST = '127.0.0.1'; // Spotify accepts http redirects only on loopback IPs, not "localhost"
const PORT = Number(process.env.PORT ?? 8081);
const ROOT = resolve(import.meta.dirname, '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('Manca dist/: esegui prima "npx expo export --platform web".');
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  // Single-page app: unknown paths (e.g. /callback, /tracks) get index.html.
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(ROOT, 'index.html');
  }
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log(`Spotify Stats per PC: ${address}  (Ctrl+C per chiudere)`);
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  if (!process.env.NO_OPEN) exec(`${opener} ${address}`);
});
