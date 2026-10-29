import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/**
 * Armazenamento chave-valor em arquivos (servidor local). Mesma interface do Netlify Blobs em netlify/kv-blobs.mjs.
 * Chaves como "history/2026-10-27T..." viram subpastas de dataDir.
 */
export function createFileKV(dir) {
  const file = (key) => {
    if (!/^[\w.-]+(\/[\w.-]+)*$/.test(key) || key.split('/').some((part) => part.startsWith('.'))) throw new Error(`Chave inválida: ${key}`);
    return path.join(dir, ...key.split('/'));
  };
  const write = async (key, data) => {
    const target = file(key);
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temp, data);
    await rename(temp, target);
  };
  const walk = async (folder, prefix) => {
    let entries = [];
    try { entries = await readdir(folder, { withFileTypes: true }); } catch (_) { return []; }
    const keys = await Promise.all(entries.map((entry) => {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(path.join(folder, entry.name), key);
      return entry.name.endsWith('.tmp') ? [] : [key];
    }));
    return keys.flat();
  };

  return {
    async getJSON(key) {
      try { return JSON.parse(await readFile(file(key), 'utf8')); } catch (_) { return null; }
    },
    setJSON: (key, value) => write(key, JSON.stringify(value)),
    async getBytes(key) {
      try { return { data: await readFile(file(key)), type: TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream' }; } catch (_) { return null; }
    },
    setBytes: (key, data) => write(key, data),
    async list(prefix) {
      const folder = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      const keys = await walk(folder ? file(folder) : dir, folder);
      return keys.filter((key) => key.startsWith(prefix));
    },
    delete: (key) => rm(file(key), { force: true })
  };
}
