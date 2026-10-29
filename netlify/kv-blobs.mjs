import { getStore } from '@netlify/blobs';

// Armazenamento chave-valor no Netlify Blobs (mesma interface de server/kv-file.mjs).
export function createBlobKV(name = 'linktree') {
  const store = getStore({ name, consistency: 'strong' });
  return {
    getJSON: (key) => store.get(key, { type: 'json' }),
    setJSON: (key, value) => store.setJSON(key, value),
    async getBytes(key) {
      const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });
      return result ? { data: new Uint8Array(result.data), type: result.metadata.type || 'application/octet-stream' } : null;
    },
    setBytes: (key, data, type) => store.set(key, data, { metadata: { type } }),
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((blob) => blob.key);
    },
    delete: (key) => store.delete(key)
  };
}
