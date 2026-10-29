import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { createFileKV } from './kv-file.mjs';

// Servidor local (e de hospedagens Node). No Netlify o mesmo núcleo roda em netlify/functions/site.mjs.
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const distMode = process.argv.includes('--dist');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectRoot, 'data'));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const trustProxy = process.env.TRUST_PROXY === '1';

await mkdir(dataDir, { recursive: true });
const app = createApp({ kv: createFileKV(dataDir) });
// Junta os eventos avulsos em arquivos diários (no Netlify isso é uma função agendada).
const compact = () => app.events.compact().catch((error) => console.error('Falha ao compactar métricas:', error.message));
if (!distMode) { await compact(); setInterval(compact, 60 * 1000).unref(); }

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
// Só estes caminhos são públicos; data/, server/ e o resto do projeto nunca são servidos.
const PUBLIC_FILES = new Set(['styles.css', 'app.js', 'track.js']);
const PUBLIC_DIRS = ['assets/', 'admin/'];

async function serveFile(response, file, cache) {
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(file));
  } catch (_) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Não encontrado'); }
}

const toRequest = (request) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  return new Request(new URL(request.url, `http://${request.headers.host || 'localhost'}`), {
    method: request.method, headers, body: hasBody ? Readable.toWeb(request) : undefined, duplex: hasBody ? 'half' : undefined
  });
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part === '..' || part.startsWith('.'))) {
      response.writeHead(403); response.end('Proibido'); return;
    }
    const relative = pathname.replace(/^\/+/, '');
    if (distMode) return serveFile(response, path.join(projectRoot, 'dist', relative || 'index.html'), 'no-store');
    if (pathname === '/admin') { response.writeHead(301, { Location: '/admin/' }); response.end(); return; }
    if (relative === 'admin/') return serveFile(response, path.join(projectRoot, 'admin', 'index.html'), 'no-store');
    if (PUBLIC_FILES.has(relative) || PUBLIC_DIRS.some((dir) => relative.startsWith(dir))) return serveFile(response, path.join(projectRoot, relative), 'no-cache');

    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) && !request.headers['x-forwarded-for'];
    const result = await app.handle(toRequest(request), {
      ip: (trustProxy && String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()) || request.socket.remoteAddress || '',
      loopback,
      secure: Boolean(request.socket.encrypted || (trustProxy && request.headers['x-forwarded-proto'] === 'https'))
    });
    if (!result) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Não encontrado'); return; }
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    if (!response.headersSent) { response.writeHead(500); response.end('Erro interno'); }
  }
});

server.listen(port, host, () => {
  console.log(`Site:   http://${host}:${port}`);
  if (!distMode) console.log(`Painel: http://${host}:${port}/admin/`);
});
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
