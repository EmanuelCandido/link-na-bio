import { createHash } from 'node:crypto';
import { createContentStore, sanitizeContent } from './content.mjs';
import { createEventStore } from './events.mjs';
import { createAuth } from './auth.mjs';
import { renderPage } from './render.mjs';
import { buildEvent, computeStats, eventsToCsv, statsWindow, validTimezone } from './analytics.mjs';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN'
};
const respond = (body, status = 200, headers = {}) => new Response(body, { status, headers: { ...securityHeaders, ...headers } });
const json = (value, status = 200, headers = {}) => respond(JSON.stringify(value), status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
const fail = (status, message) => Object.assign(new Error(message), { status });

async function readBody(request, limit) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { reader.cancel().catch(() => {}); throw fail(413, 'Arquivo grande demais.'); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
const readJson = async (request, limit = 200 * 1024) => {
  const text = new TextDecoder().decode(await readBody(request, limit));
  try { return JSON.parse(text || '{}'); } catch (_) { throw fail(400, 'JSON inválido.'); }
};

const imageType = (bytes) => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['jpg', 'image/jpeg'];
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return ['png', 'image/png'];
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return ['webp', 'image/webp'];
  return null;
};

const parseRange = (url) => {
  const now = Date.now();
  const to = Math.min(Number(url.searchParams.get('to')) || now, now + 864e5);
  const from = Math.min(Math.max(Number(url.searchParams.get('from')) || to - 7 * 864e5, to - 400 * 864e5), to - 3600 * 1000);
  // shift: distância até o período de comparação (padrão: o período imediatamente anterior).
  const shift = Math.min(Math.max(Number(url.searchParams.get('shift')) || to - from, 3600 * 1000), 400 * 864e5);
  const tz = url.searchParams.get('tz');
  return { from, to, shift, tz: tz && validTimezone(tz) ? tz : 'America/Fortaleza' };
};

/**
 * Núcleo HTTP do site (página pública, fotos enviadas e API do painel), igual no servidor local e no Netlify.
 * options.kv: armazenamento chave-valor · options.template: HTML da página · options.pageHeaders: cache da página
 * options.onPublish: chamado após publicar (ex.: limpar o cache da CDN) · options.uploadLimit: bytes por foto
 */
export function createApp({ kv, template, pageHeaders = { 'Cache-Control': 'no-cache' }, onPublish = async () => {}, uploadLimit = 6 * 1024 * 1024 }) {
  const content = createContentStore(kv);
  const events = createEventStore(kv);
  const auth = createAuth(kv);
  const rate = new Map();

  async function api(request, url, { ip, loopback, secure, geo }) {
    const route = `${request.method} ${url.pathname}`;
    const cookie = request.headers.get('cookie');
    if (request.method !== 'GET' && request.headers.get('origin')) {
      let sameOrigin = false;
      try { sameOrigin = new URL(request.headers.get('origin')).host === url.host; } catch (_) {}
      if (!sameOrigin) return json({ error: 'Origem não permitida.' }, 403);
    }

    if (route === 'POST /api/track') {
      // Visitas do próprio administrador logado não entram nas métricas.
      if (!cookie || !(await auth.isAuthenticated(cookie))) {
        let payload = null;
        try { payload = JSON.parse(new TextDecoder().decode(await readBody(request, 4096))); } catch (_) {}
        const event = buildEvent(payload, { ua: request.headers.get('user-agent') || '', host: url.host, header: (name) => request.headers.get(name), geo });
        // Limite por visita (atrás de um proxy todos os visitantes podem compartilhar o mesmo IP).
        const hits = event ? (rate.get(event.sid) || 0) + 1 : 0;
        if (event && hits <= 120) {
          if (rate.size > 5000) rate.clear();
          rate.set(event.sid, hits);
          await events.append(event);
        }
      }
      return respond(null, 204);
    }

    if (route === 'GET /api/auth/status') {
      const configured = await auth.configured();
      return json({ authenticated: await auth.isAuthenticated(cookie), configured, setupAllowed: !configured && loopback, passwordFromEnv: auth.passwordFromEnv });
    }
    if (route === 'POST /api/auth/setup') {
      if ((await auth.configured()) || !loopback) return json({ error: 'Crie a senha pelo próprio computador ou defina ADMIN_PASSWORD.' }, 403);
      const { password } = await readJson(request);
      if (typeof password !== 'string' || password.length < 8) return json({ error: 'Use pelo menos 8 caracteres.' }, 400);
      const token = await auth.setup(password);
      return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieHeader(token, secure) });
    }
    if (route === 'POST /api/auth/login') {
      const { password } = await readJson(request);
      const result = await auth.login(typeof password === 'string' ? password : '', ip);
      if (result.error) return json({ error: result.error }, result.status);
      return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieHeader(result.token, secure) });
    }
    if (route === 'POST /api/auth/logout') return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieHeader('', secure) });

    if (!(await auth.isAuthenticated(cookie))) return json({ error: 'Faça login novamente.' }, 401);

    if (route === 'POST /api/auth/password') {
      const { current, next } = await readJson(request);
      if (typeof next !== 'string' || next.length < 8) return json({ error: 'A nova senha precisa de pelo menos 8 caracteres.' }, 400);
      const result = await auth.changePassword(String(current || ''), next);
      if (result.error) return json({ error: result.error }, 400);
      return json({ ok: true }, 200, { 'Set-Cookie': auth.cookieHeader(result.token, secure) });
    }
    if (route === 'GET /api/content') return json(await content.load());
    if (route === 'PUT /api/content') {
      const saved = await content.save(await readJson(request));
      await onPublish();
      return json(saved);
    }
    if (route === 'GET /api/content/history') return json(await content.history());
    if (request.method === 'GET' && url.pathname.startsWith('/api/content/history/')) {
      const version = await content.version(decodeURIComponent(url.pathname.split('/').pop()));
      return version ? json(version) : json({ error: 'Versão não encontrada.' }, 404);
    }
    if (route === 'POST /api/preview') {
      const draft = sanitizeContent(await readJson(request));
      return respond(renderPage(draft, { preview: true, theme: url.searchParams.get('theme'), template }), 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (route === 'POST /api/upload') {
      const body = await readBody(request, uploadLimit);
      const type = imageType(body);
      if (!type) return json({ error: 'Envie uma imagem JPG, PNG ou WebP.' }, 400);
      const name = `${createHash('sha256').update(body).digest('hex').slice(0, 20)}.${type[0]}`;
      await kv.setBytes(`uploads/${name}`, body, type[1]);
      return json({ src: `uploads/${name}` });
    }
    if (route === 'GET /api/stats') {
      const range = parseRange(url);
      const window = statsWindow(range);
      const [list, current] = await Promise.all([events.range(window.from, window.to), content.load()]);
      return json(computeStats(list, { ...range, content: current }));
    }
    if (route === 'GET /api/export.csv') {
      const range = parseRange(url);
      const [list, current] = await Promise.all([events.range(range.from, range.to), content.load()]);
      return respond(eventsToCsv(list, { ...range, content: current }), 200, {
        'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="metricas-${new Date().toISOString().slice(0, 10)}.csv"`
      });
    }
    if (route === 'DELETE /api/events') { await events.clear(); return json({ ok: true }); }
    return json({ error: 'Rota não encontrada.' }, 404);
  }

  return {
    events,
    // Retorna null quando a rota não é deste núcleo (arquivos estáticos ficam com a hospedagem).
    async handle(request, info = {}) {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);
      try {
        if (pathname.startsWith('/api/')) return await api(request, url, info);
        if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
          return respond(renderPage(await content.load(), { template }), 200, { 'Content-Type': 'text/html; charset=utf-8', ...pageHeaders });
        }
        if (request.method === 'GET' && /^\/uploads\/[a-f0-9]{20}\.(jpg|png|webp)$/.test(pathname)) {
          const file = await kv.getBytes(pathname.slice(1));
          if (!file) return respond('Não encontrado', 404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return respond(file.data, 200, { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
        }
        if (pathname === '/robots.txt') return respond('User-agent: *\nAllow: /\nDisallow: /admin/\n', 200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return null;
      } catch (error) {
        if (!error.status) console.error(error);
        return json({ error: error.status ? error.message : 'Erro interno.' }, error.status || 500);
      }
    }
  };
}
