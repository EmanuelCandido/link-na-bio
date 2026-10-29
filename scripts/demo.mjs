import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sobe o servidor com 45 dias de visitas fictícias em demo-data/ (os dados reais em data/ não são tocados).
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = path.join(projectRoot, 'demo-data');
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });

let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (weighted) => {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) { roll -= weight; if (roll <= 0) return value; }
  return weighted[0][0];
};
const id = () => Array.from({ length: 12 }, () => Math.floor(random() * 36).toString(36)).join('');

// Posições aproximadas dos elementos na coluna de 390 px (x: fração da largura, y: px a partir do topo).
const targets = {
  'whatsapp-hero': [0.46, 480], instagram: [0.54, 480], 'menu-open': [0.1, 37], 'theme-toggle': [0.9, 37],
  'scroll-cue': [0.5, 528], 'service:online': [0.3, 680], 'service:presencial': [0.3, 872], 'service:avaliacao': [0.3, 1064]
};
const sources = [
  [{ src: 'Instagram', browser: 'App do Instagram' }, 58], [{ src: 'Direto', browser: 'Chrome' }, 14],
  [{ src: 'WhatsApp', browser: 'Chrome', campaign: '' }, 12], [{ src: 'Google', browser: 'Chrome' }, 9],
  [{ src: 'Instagram', browser: 'App do Instagram', campaign: 'promo-verao' }, 5], [{ src: 'TikTok', browser: 'App do TikTok' }, 2]
];
const places = [
  ['Teresina - PI', 52], ['Timon - MA', 10], ['Parnaíba - PI', 6], ['Fortaleza - CE', 6], ['São Luís - MA', 4],
  ['Picos - PI', 4], ['São Paulo - SP', 3], ['Brasília - DF', 2]
];
const devices = [[{ device: 'Celular', os: 'Android' }, 52], [{ device: 'Celular', os: 'iOS' }, 38], [{ device: 'Computador', os: 'Windows' }, 8], [{ device: 'Tablet', os: 'iOS' }, 2]];
const hourWeights = [1, .5, .3, .2, .2, .5, 2, 4, 5, 5, 6, 7, 9, 8, 6, 5, 6, 8, 11, 13, 14, 12, 8, 3];

const events = [];
const visitors = [];
const now = Date.now();
for (let day = 44; day >= 0; day -= 1) {
  const growth = 0.7 + (44 - day) / 44 * 0.6;
  const weekday = new Date(now - day * 864e5).getDay();
  const count = Math.round((10 + random() * 14) * growth * (weekday === 0 ? 0.6 : weekday === 1 ? 1.25 : 1));
  for (let i = 0; i < count; i += 1) {
    const hour = pick(hourWeights.map((weight, h) => [h, weight]));
    const midnight = new Date(now - day * 864e5); midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime() + hour * 3600e3 + Math.floor(random() * 3600e3);
    if (start > now) continue;
    const returning = visitors.length > 20 && random() < 0.22;
    const vid = returning ? visitors[Math.floor(random() * visitors.length)] : id();
    if (!returning) visitors.push(vid);
    const sid = id();
    const source = pick(sources);
    const place = pick(places);
    const device = pick(devices);
    events.push({
      t: start, type: 'view', sid, vid, nv: !returning, src: source.src, campaign: source.campaign || '', medium: '',
      country: 'Brasil', location: place, approx: false, tz: 'America/Fortaleza', lang: 'pt-BR',
      device: device.device, os: device.os, browser: device.os === 'iOS' && source.browser === 'Chrome' ? 'Safari' : source.browser, sw: device.device === 'Computador' ? 1920 : 390
    });
    let t = start;
    const clicks = pick([[0, 34], [1, 36], [2, 20], [3, 10]]);
    for (let c = 0; c < clicks; c += 1) {
      t += 3000 + Math.floor(random() * 25000);
      const target = pick([['service:online', 26], ['service:presencial', 18], ['service:avaliacao', 14], ['whatsapp-hero', 12], ['instagram', 9], ['menu-open', 8], ['scroll-cue', 7], ['theme-toggle', 4], ['', 6]]);
      const [x, y] = target ? targets[target] : [random(), 200 + random() * 900];
      events.push({ t, type: 'click', sid, vid, id: target, x: Math.min(1, Math.max(0, x + (random() - .5) * 0.25)), y: Math.round(y + (random() - .5) * 60) });
      if (target === 'menu-open' && random() < .7) {
        t += 2000 + Math.floor(random() * 6000);
        events.push({ t, type: 'click', sid, vid, id: pick([['menu-service:online', 3], ['whatsapp-menu', 4], ['menu-service:avaliacao', 2], ['share', 1]]), x: .5, y: 0, menu: true });
      }
    }
    const active = Math.max(t - start + 4000, Math.floor(6000 + random() * 70000));
    events.push({ t: start + active, type: 'ping', sid, vid, active, scroll: Math.min(100, Math.round(25 + random() * 80)) });
  }
}
events.sort((a, b) => a.t - b.t);
// Mesmo formato do servidor: um arquivo JSON por dia em events/day/.
await mkdir(path.join(dir, 'events', 'day'), { recursive: true });
const byDay = Map.groupBy(events, (event) => new Date(event.t).toISOString().slice(0, 10));
for (const [day, list] of byDay) await writeFile(path.join(dir, 'events', 'day', day), JSON.stringify(list));

process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD ||= 'demo1234';
console.log(`Demonstração: ${events.length} eventos fictícios em demo-data/. Senha do painel: ${process.env.ADMIN_PASSWORD}`);
await import('../server/index.mjs');
