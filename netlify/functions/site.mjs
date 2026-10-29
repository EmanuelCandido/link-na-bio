import { purgeCache } from '@netlify/functions';
import template from '../generated/page-template.mjs';
import { createApp } from '../../server/app.mjs';
import { createBlobKV } from '../kv-blobs.mjs';

// Página pública, fotos enviadas e API do painel no Netlify.
export default async (request, context) => {
  const app = createApp({
    kv: createBlobKV(),
    template,
    // A página fica no cache da CDN até a próxima publicação no painel.
    pageHeaders: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, stale-while-revalidate=60',
      'Netlify-Cache-Tag': 'page'
    },
    onPublish: () => purgeCache({ tags: ['page'] }),
    // Corpo de função no Netlify: até 6 MB já codificado; 4 MB de imagem cabem com folga.
    uploadLimit: 4 * 1024 * 1024
  });
  const response = await app.handle(request, { ip: context.ip, loopback: false, secure: true, geo: context.geo });
  return response ?? new Response('Não encontrado', { status: 404 });
};

export const config = {
  path: ['/', '/index.html', '/api/*', '/uploads/*']
};
