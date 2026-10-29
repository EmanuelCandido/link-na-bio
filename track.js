// Métricas anônimas: sem cookies, sem IP e sem serviços de terceiros. Os dados vão só para o servidor do próprio site.
(() => {
  'use strict';
  // Ignora a prévia do painel, a página aberta dentro de iframes (mapa de calor) e navegadores automatizados.
  if ('preview' in document.documentElement.dataset || window.top !== window || navigator.webdriver) return;
  const endpoint = '/api/track';
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => (byte % 36).toString(36)).join('');
  const storage = (store, key) => {
    try {
      const existing = store.getItem(key);
      if (existing) return { id: existing, isNew: false };
      const id = randomId();
      store.setItem(key, id);
      return { id, isNew: true };
    } catch (_) { return { id: randomId(), isNew: true }; }
  };
  const visitor = storage(localStorage, 'linkbio-vid');
  const session = storage(sessionStorage, 'linkbio-sid');
  const send = (data) => {
    const body = JSON.stringify({ ...data, sid: session.id, vid: visitor.id });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return;
    } catch (_) {}
    fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  };

  const params = new URLSearchParams(location.search);
  const utm = {};
  ['source', 'medium', 'campaign'].forEach((key) => { const value = params.get(`utm_${key}`); if (value) utm[key] = value; });
  if (!utm.source && params.get('ref')) utm.source = params.get('ref');
  // Robôs (verificadores de links, scanners de sites novos) abrem a página e rodam o JavaScript, mas não
  // interagem e saem em poucos segundos. A visita só conta com um sinal de pessoa real ou 8 s com a página visível.
  const HUMAN_EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel', 'scroll'];
  const HUMAN_DELAY = 8000;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    HUMAN_EVENTS.forEach((name) => removeEventListener(name, onHuman, true));
    send({
      type: 'view',
      nv: visitor.isNew,
      ref: document.referrer,
      utm,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      sw: screen.width
    });
  };
  const onHuman = (event) => { if (event.isTrusted) start(); };
  HUMAN_EVENTS.forEach((name) => addEventListener(name, onHuman, { capture: true, passive: true }));

  // Cliques: elemento rastreado (data-track) e posição relativa à coluna da página, para o mapa de calor.
  const page = document.querySelector('.page');
  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    start();
    const target = event.target instanceof Element ? event.target.closest('[data-track]') : null;
    const inDialog = event.target instanceof Element && event.target.closest('dialog');
    const bounds = page.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = event.clientY - bounds.top;
    // Cliques dentro do menu não têm posição na página; só contam como elemento.
    if (inDialog && !target) return;
    send({
      type: 'click',
      id: target ? target.dataset.track : '',
      x: inDialog ? 0.5 : Math.min(Math.max(x, 0), 1),
      y: inDialog ? 0 : Math.max(y, 0),
      ...(inDialog ? { menu: true } : {})
    });
  }, { capture: true, passive: true });

  // Tempo ativo (aba visível) e rolagem máxima.
  let active = 0;
  let visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
  let maxScroll = 0;
  const measureScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - innerHeight;
    const percent = max > 0 ? (scrollY / max) * 100 : 100;
    maxScroll = Math.max(maxScroll, Math.round(Math.min(percent, 100)));
  };
  const activeTime = () => active + (visibleSince === null ? 0 : performance.now() - visibleSince);
  const ping = () => { if (started) send({ type: 'ping', active: Math.round(activeTime()), scroll: maxScroll }); };
  const waitHuman = setInterval(() => {
    if (started) clearInterval(waitHuman);
    else if (activeTime() >= HUMAN_DELAY) { start(); clearInterval(waitHuman); }
  }, 1000);
  addEventListener('scroll', measureScroll, { passive: true });
  measureScroll();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (visibleSince !== null) active += performance.now() - visibleSince;
      visibleSince = null;
      ping();
    } else visibleSince = performance.now();
  });
  addEventListener('pagehide', ping);
  setInterval(() => { if (document.visibilityState === 'visible') ping(); }, 30000);
})();
