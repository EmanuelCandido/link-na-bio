import { randomBytes } from 'node:crypto';
import { RETENTION_DAYS } from './analytics.mjs';

const day = (t) => new Date(t).toISOString().slice(0, 10);

// Executa fn em lotes para não abrir centenas de leituras ao mesmo tempo.
async function mapLimit(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) results.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  return results;
}

/**
 * Eventos de métricas sobre o armazenamento chave-valor.
 * Cada evento entra como uma chave própria (events/raw/<dia>/<id>), sem disputa entre gravações simultâneas;
 * a compactação junta tudo em um arquivo por dia (events/day/<dia>).
 */
export function createEventStore(kv) {
  return {
    async append(event) {
      const id = `${event.t}-${randomBytes(4).toString('hex')}`;
      await kv.setJSON(`events/raw/${day(event.t)}/${id}`, { ...event, k: id });
    },

    async range(from, to) {
      const days = [];
      for (let t = Date.parse(`${day(from)}T00:00:00Z`); t < to; t += 864e5) days.push(day(t));
      const [daily, rawKeys] = await Promise.all([
        mapLimit(days, 24, (name) => kv.getJSON(`events/day/${name}`)),
        kv.list('events/raw/')
      ]);
      const wanted = rawKeys.filter((key) => { const name = key.split('/')[2]; return name >= days[0] && name <= days[days.length - 1]; });
      const raw = await mapLimit(wanted, 32, (key) => kv.getJSON(key));
      const seen = new Set();
      return [...daily.flat(), ...raw]
        .filter((event) => event && event.t >= from && event.t < to && !(event.k && seen.has(event.k)) && (event.k ? seen.add(event.k) : true))
        .sort((a, b) => a.t - b.t);
    },

    // Junta os eventos avulsos no arquivo do dia e aplica a retenção.
    async compact() {
      const keys = await kv.list('events/raw/');
      const byDay = new Map();
      for (const key of keys) {
        const name = key.split('/')[2];
        byDay.set(name, [...(byDay.get(name) || []), key]);
      }
      for (const [name, dayKeys] of byDay) {
        const existing = (await kv.getJSON(`events/day/${name}`)) || [];
        const seen = new Set(existing.map((event) => event.k).filter(Boolean));
        const fresh = (await mapLimit(dayKeys, 32, (key) => kv.getJSON(key))).filter((event) => event && !seen.has(event.k));
        await kv.setJSON(`events/day/${name}`, [...existing, ...fresh].sort((a, b) => a.t - b.t));
        await mapLimit(dayKeys, 32, (key) => kv.delete(key));
      }
      const cutoff = day(Date.now() - RETENTION_DAYS * 864e5);
      const old = (await kv.list('events/day/')).filter((key) => key.split('/')[2] < cutoff);
      await mapLimit(old, 32, (key) => kv.delete(key));
      return keys.length;
    },

    async clear() {
      await mapLimit(await kv.list('events/'), 32, (key) => kv.delete(key));
    }
  };
}
