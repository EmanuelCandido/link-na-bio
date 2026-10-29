import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentStore } from '../server/content.mjs';
import { createFileKV } from '../server/kv-file.mjs';
import { renderPage } from '../server/render.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(projectRoot, 'dist');
const netlify = process.argv.includes('--netlify');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['styles.css', 'app.js']) await cp(path.join(projectRoot, file), path.join(output, file));
await cp(path.join(projectRoot, 'assets'), path.join(output, 'assets'), { recursive: true });

if (netlify) {
  // Netlify: arquivos estáticos + painel; a página, a API e as fotos enviadas vêm de netlify/functions/site.mjs.
  await cp(path.join(projectRoot, 'track.js'), path.join(output, 'track.js'));
  await cp(path.join(projectRoot, 'admin'), path.join(output, 'admin'), { recursive: true });
  const template = await readFile(path.join(projectRoot, 'server', 'page.html'), 'utf8');
  await mkdir(path.join(projectRoot, 'netlify', 'generated'), { recursive: true });
  await writeFile(path.join(projectRoot, 'netlify', 'generated', 'page-template.mjs'), `// Gerado por scripts/build.mjs a partir de server/page.html. Não edite.\nexport default ${JSON.stringify(template)};\n`);
  await writeFile(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /admin/\n');
  console.log('Build Netlify concluído: dist/ (estáticos e painel) + template da página para as funções.');
} else {
  // Retrato estático da página com o conteúdo salvo no painel (sem métricas nem painel).
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectRoot, 'data'));
  const content = await createContentStore(createFileKV(dataDir)).load();
  const html = renderPage(content, { tracking: false });
  await writeFile(path.join(output, 'index.html'), html);
  const imagePaths = new Set([...html.matchAll(/(?:src|srcset|href)="((?:assets|uploads)\/[^"]+)"/g)].map((match) => match[1]));
  for (const file of imagePaths) {
    if (file.startsWith('uploads/')) {
      await mkdir(path.join(output, 'uploads'), { recursive: true });
      await cp(path.join(dataDir, file), path.join(output, file));
    }
    await stat(path.join(output, file));
  }
  await writeFile(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  console.log('Build concluído: dist/ (HTML, CSS, JavaScript e assets locais).');
}
