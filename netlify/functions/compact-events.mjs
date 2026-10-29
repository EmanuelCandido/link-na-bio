import { createEventStore } from '../../server/events.mjs';
import { createBlobKV } from '../kv-blobs.mjs';

// A cada 10 minutos junta os eventos avulsos das métricas em um arquivo por dia.
export default async () => {
  const compacted = await createEventStore(createBlobKV()).compact();
  console.log(`Métricas compactadas: ${compacted} eventos.`);
};

export const config = { schedule: '*/10 * * * *' };
