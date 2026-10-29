// Métricas: funções puras (sem armazenamento), usadas pelo servidor local e pelo Netlify.
export const RETENTION_DAYS = 400;
const LIVE_WINDOW = 5 * 60 * 1000;
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|pingdom/i;
const ID = /^[a-z0-9]{8,32}$/;
const TRACK_ID = /^[\w:-]{1,60}$/;
const WHATSAPP_ID = /^(whatsapp-hero|whatsapp-menu|service:|menu-service:)/;

// Fusos horários do Brasil → estados que usam cada um (localização aproximada quando a hospedagem não informa a cidade).
const BR_TIMEZONES = {
  'America/Sao_Paulo': 'SP, RJ, MG, ES, PR, SC, RS, GO, DF', 'America/Fortaleza': 'CE, PI, MA, RN, PB',
  'America/Recife': 'PE', 'America/Bahia': 'BA', 'America/Maceio': 'AL, SE', 'America/Belem': 'PA, AP',
  'America/Santarem': 'PA', 'America/Araguaina': 'TO', 'America/Manaus': 'AM', 'America/Cuiaba': 'MT',
  'America/Campo_Grande': 'MS', 'America/Porto_Velho': 'RO', 'America/Boa_Vista': 'RR',
  'America/Rio_Branco': 'AC', 'America/Eirunepe': 'AM', 'America/Noronha': 'Fernando de Noronha'
};
const regionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
const countryName = (code) => { try { return regionNames.of(code.toUpperCase()); } catch (_) { return code; } };

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const header = (get, ...names) => {
  for (const name of names) {
    const value = get(name);
    if (value && value !== 'XX' && value !== 'unknown') {
      try { return clip(decodeURIComponent(String(value)), 60); } catch (_) { return clip(String(value), 60); }
    }
  }
  return '';
};

function parseAgent(ua) {
  const app = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /musical_ly|TikTok|BytedanceWebview/i.test(ua) ? 'TikTok' : '';
  const device = /iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobi/.test(ua)) ? 'Tablet' : /Mobi|iPhone|iPod|Android/.test(ua) ? 'Celular' : 'Computador';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const browser = app ? `App do ${app}` : /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari' : 'Outro';
  return { app, device, os, browser };
}

const SOURCE_ALIASES = [
  [/^(ig|insta|instagram)/i, 'Instagram'], [/^(wa|whats|zap)/i, 'WhatsApp'], [/^(fb|face)/i, 'Facebook'],
  [/^(tt|tiktok)/i, 'TikTok'], [/^google/i, 'Google'], [/^(yt|youtube)/i, 'YouTube'], [/^(x|twitter)$/i, 'X (Twitter)']
];
const REFERRER_HOSTS = [
  [/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'],
  [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X (Twitter)'],
  [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'], [/(^|\.)linktr\.ee$/, 'Linktree']
];
function classifySource({ utmSource, referrer, app, host }) {
  if (utmSource) {
    const alias = SOURCE_ALIASES.find(([pattern]) => pattern.test(utmSource));
    return alias ? alias[1] : utmSource.charAt(0).toUpperCase() + utmSource.slice(1);
  }
  if (app) return app;
  try {
    const refHost = new URL(referrer).hostname.replace(/^www\./, '');
    if (refHost && refHost !== host) {
      const known = REFERRER_HOSTS.find(([pattern]) => pattern.test(refHost));
      return known ? known[1] : refHost;
    }
  } catch (_) {}
  return 'Direto';
}

function locate(get, geo, tz) {
  // Netlify informa cidade, estado e país de cada acesso.
  if (geo && (geo.city || geo.country?.code)) {
    const region = geo.subdivision?.code || geo.subdivision?.name || '';
    // Sem cidade, mostra o nome do estado ("Piauí") em vez de só a sigla.
    const location = geo.city ? [geo.city, region].filter(Boolean).join(' - ') : geo.subdivision?.name || region || countryName(geo.country.code);
    return { country: geo.country?.code ? countryName(geo.country.code) : '', location, approx: false };
  }
  const code = header(get, 'cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-appengine-country', 'x-country-code');
  const region = header(get, 'cf-region-code', 'x-vercel-ip-country-region', 'cloudfront-viewer-country-region', 'cf-region', 'x-appengine-region');
  const city = header(get, 'cf-ipcity', 'x-vercel-ip-city', 'cloudfront-viewer-city', 'x-appengine-city');
  if (city || code) {
    return { country: code ? countryName(code) : '', location: [city, region].filter(Boolean).join(' - ') || countryName(code), approx: false };
  }
  if (BR_TIMEZONES[tz]) return { country: 'Brasil', location: `Fuso ${tz.split('/')[1].replace(/_/g, ' ')} (${BR_TIMEZONES[tz]})`, approx: true };
  if (tz) return { country: '', location: `Fuso ${tz.replace(/_/g, ' ')}`, approx: true };
  return { country: '', location: 'Desconhecido', approx: true };
}

export function labelFor(id, content) {
  const services = new Map(content.services.map((service) => [service.id, service.title]));
  const fixed = {
    'whatsapp-hero': ['WhatsApp do topo', 'whatsapp'], 'whatsapp-menu': ['Menu · Vamos conversar?', 'whatsapp'],
    instagram: ['Instagram', 'social'], tiktok: ['TikTok', 'social'], 'menu-open': ['Abrir menu', 'interface'],
    'menu-close': ['Fechar menu', 'interface'], 'theme-toggle': ['Trocar tema', 'interface'], share: ['Copiar link da página', 'interface'],
    'scroll-cue': ['Seta "ver serviços"', 'interface'], logo: ['Logo', 'interface']
  };
  if (fixed[id]) return { label: fixed[id][0], kind: fixed[id][1] };
  const [prefix, serviceId] = id.split(':');
  const title = services.get(serviceId) || serviceId;
  if (prefix === 'service') return { label: `Cartão · ${title}`, kind: 'whatsapp' };
  if (prefix === 'menu-service') return { label: `Menu · ${title}`, kind: 'whatsapp' };
  return { label: id, kind: 'interface' };
}

const partsFormatter = new Map();
function zonedParts(t, tz) {
  if (!partsFormatter.has(tz)) {
    partsFormatter.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' }));
  }
  const parts = Object.fromEntries(partsFormatter.get(tz).formatToParts(t).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}
// Diferença entre o fuso e UTC neste momento, em minutos (America/Fortaleza → -180).
const utcOffset = (tz, t) => {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(t).find((part) => part.type === 'timeZoneName').value;
    const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 0;
  } catch (_) { return null; }
};
export const validTimezone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (_) { return false; } };

const countBy = (items, key, limit = 8) => {
  const map = new Map();
  for (const item of items) { const value = key(item) || 'Desconhecido'; map.set(value, (map.get(value) || 0) + 1); }
  const sorted = [...map].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit - 1).reduce((sum, item) => sum + item.count, 0);
  return [...sorted.slice(0, limit - 1), { label: 'Outros', count: rest }];
};

/**
 * Valida e enriquece um evento do coletor público. Retorna null quando deve ser ignorado.
 * req: { ua, host, header(name), geo }
 */
export function buildEvent(payload, { ua = '', host = '', header: get = () => '', geo = null }) {
  if (!payload || typeof payload !== 'object' || !ua || BOT_UA.test(ua)) return null;
  const { type, sid, vid } = payload;
  if (!ID.test(sid) || !ID.test(vid)) return null;
  const base = { t: Date.now(), type, sid, vid };
  if (type === 'view') {
    const agent = parseAgent(ua);
    const tz = validTimezone(payload.tz) ? clip(payload.tz, 40) : '';
    // Robôs em datacenters mandam o fuso do servidor (UTC, Los Angeles...), que não bate com o horário do lugar
    // de onde a conexão vem. Pessoas reais têm o relógio do aparelho no horário local (Fortaleza = São Paulo = -3h).
    if (tz && geo?.timezone && validTimezone(geo.timezone) && utcOffset(tz, base.t) !== utcOffset(geo.timezone, base.t)) return null;
    // Fuso de servidor (UTC/Etc) e acesso de fora do Brasil com o navegador em outro idioma são robôs de
    // datacenter (verificadores de links, scanners); o público das páginas é local.
    if (/^(UTC|Etc\/)/.test(tz)) return null;
    const place = locate(get, geo, tz);
    const lang = clip(payload.lang, 12);
    if (place.country && place.country !== 'Brasil' && !/^pt\b/i.test(lang)) return null;
    const utm = payload.utm && typeof payload.utm === 'object' ? payload.utm : {};
    return {
      ...base, nv: payload.nv === true,
      src: classifySource({ utmSource: clip(utm.source, 40).trim(), referrer: clip(payload.ref, 300), app: agent.app, host: host.split(':')[0].replace(/^www\./, '') }),
      campaign: clip(utm.campaign, 60), medium: clip(utm.medium, 40),
      ...place, tz, lang,
      device: agent.device, os: agent.os, browser: agent.browser, sw: Math.min(Math.max(Number(payload.sw) || 0, 0), 10000)
    };
  }
  if (type === 'click') {
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 6000)) return null;
    return { ...base, id: TRACK_ID.test(payload.id) ? payload.id : '', x: Math.round(x * 1000) / 1000, y: Math.round(y), ...(payload.menu === true ? { menu: true } : {}) };
  }
  if (type === 'ping') {
    return { ...base, active: Math.min(Math.max(Math.round(Number(payload.active) || 0), 0), 6 * 3600 * 1000), scroll: Math.min(Math.max(Math.round(Number(payload.scroll) || 0), 0), 100) };
  }
  return null;
}

// Agrupa eventos em visitas iniciadas dentro do intervalo.
export function sessionsOf(events, from, to) {
  const map = new Map();
  for (const event of events) {
    if (event.t < from - 6 * 3600 * 1000 || event.t >= to + 6 * 3600 * 1000) continue;
    let session = map.get(event.sid);
    if (!session) { session = { sid: event.sid, vid: event.vid, start: event.t, last: event.t, view: null, views: 0, clicks: [], active: 0, scroll: 0 }; map.set(event.sid, session); }
    session.last = Math.max(session.last, event.t);
    if (event.type === 'view') { session.views += 1; if (!session.view) { session.view = event; session.start = event.t; } }
    else if (event.type === 'click') session.clicks.push(event);
    else if (event.type === 'ping') { session.active = Math.max(session.active, event.active); session.scroll = Math.max(session.scroll, event.scroll); }
  }
  return [...map.values()].filter((session) => session.view && session.start >= from && session.start < to)
    .map((session) => ({ ...session, duration: session.active || Math.min(session.last - session.start, 30 * 60 * 1000) }));
}

// Intervalo de eventos que precisa ser lido para montar as estatísticas (inclui o período de comparação e o "agora").
export const statsWindow = ({ from, to, shift }) => ({ from: from - shift - 6 * 3600 * 1000, to: Math.max(to, Date.now()) + 60 * 1000 });

export function computeStats(events, { from, to, shift, tz, content }) {
  const current = sessionsOf(events, from, to);
  const previous = sessionsOf(events, from - shift, to - shift);
  const kpis = (list) => {
    const n = list.length;
    const clicks = list.flatMap((session) => session.clicks.filter((click) => click.id));
    const whatsapp = clicks.filter((click) => WHATSAPP_ID.test(click.id));
    const converted = list.filter((session) => session.clicks.some((click) => WHATSAPP_ID.test(click.id))).length;
    return {
      sessions: n,
      visitors: new Set(list.map((session) => session.vid)).size,
      newVisitors: new Set(list.filter((session) => session.view.nv).map((session) => session.vid)).size,
      views: list.reduce((sum, session) => sum + session.views, 0),
      clicks: clicks.length,
      whatsapp: whatsapp.length,
      conversion: n ? converted / n : 0,
      avgTime: n ? list.reduce((sum, session) => sum + session.duration, 0) / n : 0,
      avgScroll: n ? list.reduce((sum, session) => sum + session.scroll, 0) / n : 0,
      bounce: n ? list.filter((session) => !session.clicks.some((click) => click.id)).length / n : 0
    };
  };

  const hourly = to - from <= 2 * 864e5;
  const bucketKey = (parts) => (hourly ? `${parts.day} ${String(parts.hour).padStart(2, '0')}` : parts.day);
  const buckets = new Map();
  for (let t = from; t < to; t += 3600 * 1000) {
    const key = bucketKey(zonedParts(t, tz));
    if (!buckets.has(key)) buckets.set(key, { key, t, sessions: 0, whatsapp: 0 });
  }
  const hours = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const session of current) {
    const parts = zonedParts(session.start, tz);
    const bucket = buckets.get(bucketKey(parts));
    if (bucket) {
      bucket.sessions += 1;
      bucket.whatsapp += session.clicks.filter((click) => WHATSAPP_ID.test(click.id)).length;
    }
    hours[parts.weekday][parts.hour] += 1;
  }

  const linkMap = new Map();
  for (const session of current) {
    for (const click of session.clicks) {
      if (!click.id) continue;
      const entry = linkMap.get(click.id) || { id: click.id, ...labelFor(click.id, content), count: 0, sessions: new Set() };
      entry.count += 1;
      entry.sessions.add(session.sid);
      linkMap.set(click.id, entry);
    }
  }
  const links = [...linkMap.values()].map(({ sessions, ...entry }) => ({ ...entry, unique: sessions.size })).sort((a, b) => b.count - a.count);
  const points = current.flatMap((session) => session.clicks.filter((click) => !click.menu).map((click) => [click.x, click.y])).slice(-5000);
  const live = new Set(events.filter((event) => event.t > Date.now() - LIVE_WINDOW).map((event) => event.sid)).size;

  const recent = [...current].sort((a, b) => b.start - a.start).slice(0, 40).map((session) => ({
    start: session.start,
    duration: session.duration,
    scroll: session.scroll,
    source: session.view.src,
    campaign: session.view.campaign,
    location: session.view.location,
    approx: session.view.approx,
    device: session.view.device,
    os: session.view.os,
    browser: session.view.browser,
    returning: !session.view.nv,
    events: session.clicks.map((click) => ({ t: click.t, id: click.id, ...(click.id ? labelFor(click.id, content) : { label: 'Clique fora de botões', kind: 'vazio' }) }))
  }));

  return {
    bucket: hourly ? 'hour' : 'day',
    kpis: kpis(current),
    previous: kpis(previous),
    series: [...buckets.values()],
    sources: countBy(current, (session) => session.view.src),
    campaigns: countBy(current.filter((session) => session.view.campaign), (session) => session.view.campaign, 6),
    locations: countBy(current, (session) => session.view.location),
    locationsApprox: current.length > 0 && current.every((session) => session.view.approx),
    devices: countBy(current, (session) => session.view.device, 3),
    systems: countBy(current, (session) => session.view.os, 5),
    browsers: countBy(current, (session) => session.view.browser, 5),
    links,
    points,
    hours,
    live,
    recent
  };
}

export function eventsToCsv(events, { from, to, content }) {
  // Prefixa valores que o Excel interpretaria como fórmula (ex.: campanha vinda da URL).
  const quote = (value) => `"${String(value ?? '').replace(/^([=+@-])/, "'$1").replace(/"/g, '""')}"`;
  const views = new Map();
  const rows = [['data_hora_utc', 'tipo', 'visita', 'visitante', 'origem', 'campanha', 'local', 'dispositivo', 'sistema', 'navegador', 'elemento', 'tempo_ativo_s', 'rolagem_%']];
  for (const event of events) {
    if (event.type === 'view') views.set(event.sid, event);
    if (event.t < from || event.t >= to) continue;
    const view = views.get(event.sid) || {};
    rows.push([
      new Date(event.t).toISOString(), { view: 'visualização', click: 'clique', ping: 'permanência' }[event.type], event.sid, event.vid,
      view.src, view.campaign, view.location, view.device, view.os, view.browser,
      event.type === 'click' ? (event.id ? labelFor(event.id, content).label : 'fora de botões') : '',
      event.type === 'ping' ? Math.round(event.active / 1000) : '', event.type === 'ping' ? event.scroll : ''
    ]);
  }
  return '﻿' + rows.map((row) => row.map(quote).join(';')).join('\r\n');
}

