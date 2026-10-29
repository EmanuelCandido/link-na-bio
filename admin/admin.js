(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const store = {
    get: (key) => { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} }
  };
  const state = {
    view: null,
    saved: null,
    draft: null,
    period: ['today', '7', '30', '90'].includes(store.get('linkbio-admin-period')) ? store.get('linkbio-admin-period') : '7',
    stats: null,
    refreshTimer: null,
    previewTheme: 'light',
    previewTimer: null
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  /* ---------- Utilidades ---------- */
  async function api(path, { method = 'GET', body, rawType } = {}) {
    const headers = rawType ? { 'Content-Type': rawType } : body !== undefined ? { 'Content-Type': 'application/json' } : {};
    const response = await fetch(path, { method, headers, credentials: 'same-origin', body: rawType ? body : body !== undefined ? JSON.stringify(body) : undefined });
    if (response.status === 401 && !path.startsWith('/api/auth')) {
      showAuth();
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
    const data = (response.headers.get('content-type') || '').includes('json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error((data && data.error) || 'Algo deu errado. Tente de novo.');
    return data;
  }
  let toastTimer;
  function toast(message, error = false) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 3200);
  }
  const numberFormat = new Intl.NumberFormat('pt-BR');
  const compactFormat = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const fmtNum = (value) => (value >= 10000 ? compactFormat.format(value) : numberFormat.format(Math.round(value)));
  const fmtPct = (ratio) => `${(ratio * 100).toLocaleString('pt-BR', { maximumFractionDigits: ratio < .1 ? 1 : 0 })}%`;
  const fmtDur = (ms) => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  };
  const fmtTime = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (t) => {
    const date = new Date(t);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(date).setHours(0, 0, 0, 0)) / 864e5);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  };

  async function confirmAction({ title, text, ok = 'Confirmar', typeWord = '' }) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = ok;
    const typeField = $('#confirm-type-field');
    const typeInput = $('#confirm-type');
    typeField.hidden = !typeWord;
    typeInput.value = '';
    $('#confirm-type-label').textContent = `Digite ${typeWord} para confirmar`;
    $('#confirm-ok').disabled = Boolean(typeWord);
    typeInput.oninput = () => { $('#confirm-ok').disabled = typeInput.value.trim().toUpperCase() !== typeWord; };
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
  }

  /* ---------- Tema ---------- */
  $$('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    store.set('linkbio-admin-theme', theme);
    if (state.stats) renderStats();
  }));

  /* ---------- Acesso ---------- */
  let authMode = 'login';
  async function showAuth(knownStatus) {
    clearInterval(state.refreshTimer);
    $('#shell').hidden = true;
    $('#auth-view').hidden = false;
    let status = knownStatus;
    try { status ??= await api('/api/auth/status'); } catch (_) { status = { configured: true }; }
    authMode = status.configured ? 'login' : 'setup';
    const setup = authMode === 'setup';
    $('#auth-title').textContent = setup ? 'Crie a senha do painel' : 'Entrar no painel';
    $('#auth-text').textContent = setup
      ? (status.setupAllowed ? 'Primeiro acesso: escolha uma senha com pelo menos 8 caracteres.' : 'Ainda não há senha. Defina a variável ADMIN_PASSWORD no servidor ou crie a senha acessando o painel pelo próprio computador onde o site roda.')
      : 'Digite a senha para editar a página e ver as métricas.';
    $('#auth-confirm-field').hidden = !setup;
    $('#auth-password').autocomplete = setup ? 'new-password' : 'current-password';
    $('#auth-submit').textContent = setup ? 'Criar senha e entrar' : 'Entrar';
    $('#auth-submit').disabled = setup && !status.setupAllowed;
    $('#auth-error').hidden = true;
    $('#auth-password').focus();
  }
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#auth-password').value;
    const error = $('#auth-error');
    error.hidden = true;
    const fail = (message) => { error.textContent = message; error.hidden = false; };
    if (password.length < 8) return fail('A senha precisa de pelo menos 8 caracteres.');
    if (authMode === 'setup' && password !== $('#auth-confirm').value) return fail('As senhas não são iguais.');
    $('#auth-submit').disabled = true;
    try {
      await api(authMode === 'setup' ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: { password } });
      $('#auth-password').value = '';
      $('#auth-confirm').value = '';
      await enter();
    } catch (failure) { fail(failure.message); }
    $('#auth-submit').disabled = false;
  });
  $('#logout').addEventListener('click', async () => {
    if (isDirty() && !(await confirmAction({ title: 'Sair sem publicar?', text: 'Há alterações no conteúdo que ainda não foram publicadas. Elas serão perdidas.', ok: 'Sair' }))) return;
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    state.saved = state.draft = null;
    showAuth();
  });

  async function enter() {
    api('/api/auth/status').then((status) => {
      $('#password-env').hidden = !status.passwordFromEnv;
      $('#password-form').hidden = Boolean(status.passwordFromEnv);
    }).catch(() => {});
    $('#auth-view').hidden = true;
    $('#shell').hidden = false;
    if (!state.saved) {
      state.saved = await api('/api/content');
      state.draft = clone(state.saved);
      renderEditor();
    }
    route();
  }

  /* ---------- Navegação ---------- */
  const VIEWS = ['metricas', 'conteudo', 'configuracoes'];
  function route() {
    if ($('#shell').hidden) return;
    const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'metricas';
    state.view = view;
    $$('[data-view]').forEach((section) => { section.hidden = section.dataset.view !== view; });
    $$('[data-nav]').forEach((link) => {
      if (link.dataset.nav === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    clearInterval(state.refreshTimer);
    if (view === 'metricas') {
      loadStats();
      state.refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') loadStats(true); }, 30000);
    }
    if (view === 'conteudo') schedulePreview(0);
    if (view === 'configuracoes') updateUtm();
    $('#savebar').hidden = !(view === 'conteudo' && isDirty());
    window.scrollTo({ top: 0 });
  }
  addEventListener('hashchange', route);

  /* ---------- Métricas ---------- */
  function periodRange() {
    const now = Date.now();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    if (state.period === 'today') return { from: midnight.getTime(), to: now, shift: 864e5 };
    const days = Number(state.period);
    const from = midnight.getTime() - (days - 1) * 864e5;
    return { from, to: now, shift: days * 864e5 };
  }
  $$('#period button').forEach((button) => button.addEventListener('click', () => {
    state.period = button.dataset.period;
    store.set('linkbio-admin-period', state.period);
    loadStats();
  }));
  $('#refresh').addEventListener('click', () => loadStats());

  async function loadStats(silent = false) {
    $$('#period button').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.period === state.period)));
    const { from, to, shift } = periodRange();
    $('#export').href = `/api/export.csv?from=${from}&to=${to}`;
    if (!silent && !state.stats) $('#kpis').innerHTML = Array.from({ length: 5 }, (_, index) => `<div class="kpi skeleton${index ? '' : ' hero'}" style="min-height:112px"></div>`).join('');
    try {
      state.stats = await api(`/api/stats?from=${from}&to=${to}&shift=${shift}&tz=${encodeURIComponent(tz)}`);
      renderStats();
    } catch (error) { if (!silent) toast(error.message, true); }
  }

  function renderStats() {
    const stats = state.stats;
    const live = $('#live');
    $('#live-count').textContent = stats.live;
    live.classList.toggle('on', stats.live > 0);
    renderKpis(stats);
    renderTimeline(stats);
    renderBars($('#sources'), stats.sources, { total: stats.kpis.sessions, empty: 'Nenhuma visita no período.' });
    $('#campaigns-wrap').hidden = !stats.campaigns.length;
    renderBars($('#campaigns'), stats.campaigns, { total: stats.kpis.sessions });
    renderLinks(stats.links);
    $('#location-sub').hidden = !stats.locationsApprox;
    $('#location-sub').textContent = 'Aproximada pelo fuso horário do aparelho';
    renderBars($('#locations'), stats.locations, { total: stats.kpis.sessions, empty: 'Sem dados de localização.' });
    renderDevices(stats.devices);
    renderHours(stats.hours);
    renderHeatmap(stats.points);
    renderJourneys(stats.recent);
  }

  // Minilinha das visitas no período (mesma série da linha do tempo).
  function sparkline(series) {
    if (series.length < 2) return '';
    const max = Math.max(1, ...series.map((point) => point.sessions));
    const points = series.map((point, index) => `${((index / (series.length - 1)) * 100).toFixed(2)},${(38 - (point.sessions / max) * 34).toFixed(2)}`);
    return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path class="spark-area" d="M0,40L${points.join('L')}L100,40Z"/>
      <path class="spark-line" d="M${points.join('L')}"/>
    </svg>`;
  }

  function renderKpis({ kpis, previous, series }) {
    const days = Number(state.period);
    $('#compare-note').textContent = state.period === 'today' ? 'Hoje até agora, comparado com ontem no mesmo horário' : `Últimos ${days} dias, comparados com os ${days} anteriores`;
    const items = [
      { key: 'sessions', label: 'Visitas' },
      { key: 'visitors', label: 'Visitantes únicos', extra: `${fmtNum(kpis.newVisitors)} novos` },
      { key: 'whatsapp', label: 'Cliques no WhatsApp' },
      { key: 'conversion', label: 'Conversão', format: fmtPct, points: true, title: 'Visitas que clicaram em algum botão de WhatsApp' },
      { key: 'avgTime', label: 'Tempo médio', format: fmtDur, title: 'Tempo com a página aberta e visível' }
    ];
    $('#kpis').innerHTML = items.map((item) => {
      const value = kpis[item.key];
      const before = previous[item.key];
      let delta = '<span class="delta">—</span>';
      if (before > 0 || value > 0) {
        let change;
        let text;
        if (item.points) { change = value - before; text = `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`; }
        else if (before === 0) { change = 1; text = 'novo'; }
        else { change = (value - before) / before; text = `${change >= 0 ? '+' : '−'}${Math.abs(Math.round(change * 100))}%`; }
        const direction = Math.abs(change) < .005 ? '' : change > 0 ? 'up' : 'down';
        const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '';
        delta = `<span class="delta ${direction}">${arrow} ${text}</span>`;
      }
      const shown = item.format ? item.format(value) : fmtNum(value);
      const hero = item.key === 'sessions';
      return `<div class="kpi${hero ? ' hero' : ''}"${item.title ? ` title="${escapeHtml(item.title)}"` : ''}>
        <div class="label">${item.label}</div>
        <div class="value">${shown}${item.extra ? ` <small>· ${item.extra}</small>` : ''}</div>
        ${delta}
        ${hero ? sparkline(series) : ''}
      </div>`;
    }).join('');
  }

  const niceMax = (value) => {
    if (value <= 4) return 4;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude * 4 >= value) * magnitude;
    return step * 4;
  };
  const tooltip = $('#tooltip');
  function showTooltip(html, x, y) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(Math.max(8, x + 14), innerWidth - width - 8)}px`;
    tooltip.style.top = `${Math.max(8, y - height - 12)}px`;
  }
  const hideTooltip = () => { tooltip.hidden = true; };

  function renderTimeline({ series, bucket, kpis }) {
    const container = $('#timeline');
    const width = Math.max(container.clientWidth, 280);
    const height = container.clientHeight || 260;
    const pad = { top: 12, right: 12, bottom: 26, left: 34 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(...series.map((point) => Math.max(point.sessions, point.whatsapp)), 0));
    const n = series.length;
    const x = (index) => pad.left + (n <= 1 ? innerW / 2 : (index / (n - 1)) * innerW);
    const y = (value) => pad.top + innerH - (value / max) * innerH;
    const label = (point, long = false) => {
      const date = new Date(point.t);
      if (bucket === 'hour') return long ? `${fmtDay(point.t)}, ${String(date.getHours()).padStart(2, '0')}h–${String((date.getHours() + 1) % 24).padStart(2, '0')}h` : `${String(date.getHours()).padStart(2, '0')}h`;
      return long ? date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    };
    const ticks = [0, .25, .5, .75, 1].map((ratio) => ratio * max);
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 64))));
    const line = (key) => series.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join('');
    const area = n ? `${line('sessions')}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de visitas e cliques no WhatsApp ao longo do tempo">
      ${ticks.map((tick) => `<line class="gridline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="axis-label" x="${pad.left - 8}" y="${y(tick) + 4}" text-anchor="end">${fmtNum(tick)}</text>`).join('')}
      ${series.map((point, index) => (index % step === 0 ? `<text class="axis-label" x="${x(index)}" y="${height - 6}" text-anchor="middle">${label(point)}</text>` : '')).join('')}
      <path class="area" d="${area}"/>
      <path class="line-1" d="${line('sessions')}"/>
      <path class="line-2" d="${line('whatsapp')}"/>
      <g class="hover" visibility="hidden">
        <line class="crosshair" y1="${pad.top}" y2="${pad.top + innerH}"/>
        <circle class="dot dot-1" r="4.5"/><circle class="dot dot-2" r="4.5"/>
      </g>
      <rect x="${pad.left}" y="0" width="${innerW}" height="${height}" fill="transparent" class="hit"/>
    </svg>${kpis.sessions ? '' : '<p class="empty" style="position:absolute;inset:30% 0 auto">Ainda sem visitas neste período.</p>'}`;
    const svg = $('svg', container);
    const hover = $('.hover', svg);
    const move = (event) => {
      const bounds = svg.getBoundingClientRect();
      const px = ((event.clientX - bounds.left) / bounds.width) * width;
      const index = Math.min(n - 1, Math.max(0, Math.round(((px - pad.left) / innerW) * (n - 1))));
      const point = series[index];
      if (!point) return;
      hover.setAttribute('visibility', 'visible');
      $('.crosshair', hover).setAttribute('x1', x(index)); $('.crosshair', hover).setAttribute('x2', x(index));
      $('.dot-1', hover).setAttribute('cx', x(index)); $('.dot-1', hover).setAttribute('cy', y(point.sessions));
      $('.dot-2', hover).setAttribute('cx', x(index)); $('.dot-2', hover).setAttribute('cy', y(point.whatsapp));
      showTooltip(`<strong>${label(point, true)}</strong>
        <div><i style="background:var(--series-1)"></i>Visitas<b>${fmtNum(point.sessions)}</b></div>
        <div><i style="background:var(--series-2)"></i>Cliques no WhatsApp<b>${fmtNum(point.whatsapp)}</b></div>`, event.clientX, bounds.top + (y(Math.max(point.sessions, point.whatsapp)) / height) * bounds.height);
    };
    const hit = $('.hit', svg);
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); hideTooltip(); });
  }

  function renderBars(element, list, { total = 0, empty = 'Sem dados.' } = {}) {
    if (!list.length) { element.innerHTML = `<p class="empty">${empty}</p>`; return; }
    const max = Math.max(...list.map((item) => item.count));
    element.innerHTML = list.map((item) => `<div class="bar-row">
      <span class="name" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
      <span class="num">${fmtNum(item.count)}${total ? `<small>${fmtPct(item.count / total)}</small>` : ''}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.count / max) * 100}%"></div></div>
    </div>`).join('');
  }

  function renderLinks(links) {
    const element = $('#links');
    if (!links.length) { element.innerHTML = '<p class="empty">Nenhum clique no período.</p>'; return; }
    const max = links[0].count;
    element.innerHTML = links.slice(0, 12).map((link) => `<div class="bar-row ${link.kind}">
      <span class="name" title="${escapeHtml(link.label)}"><span class="label-text">${escapeHtml(link.label)}</span></span>
      <span class="num">${fmtNum(link.count)}<small>${fmtNum(link.unique)} ${link.unique === 1 ? 'pessoa' : 'pessoas'}</small></span>
      <div class="bar-track"><div class="bar-fill" style="width:${(link.count / max) * 100}%"></div></div>
    </div>`).join('');
  }

  function renderDevices(devices) {
    const element = $('#devices');
    const total = devices.reduce((sum, item) => sum + item.count, 0);
    if (!total) { element.innerHTML = '<p class="empty">—</p>'; return; }
    // A cor acompanha o tipo de aparelho, não a posição no ranking; vermelho fica reservado ao WhatsApp.
    const colors = { Celular: 'var(--series-1)', Computador: 'var(--series-3)', Tablet: 'var(--muted)' };
    element.innerHTML = `<div class="stack-bar" role="img" aria-label="${devices.map((item) => `${item.label}: ${fmtPct(item.count / total)}`).join(', ')}">
      ${devices.map((item) => `<span style="width:${(item.count / total) * 100}%;background:${colors[item.label] || 'var(--muted)'}" title="${escapeHtml(item.label)}: ${fmtNum(item.count)}"></span>`).join('')}
    </div>
    <div class="stack-legend">${devices.map((item) => `<span><i style="background:${colors[item.label] || 'var(--muted)'}"></i>${escapeHtml(item.label)} <b>${fmtPct(item.count / total)}</b></span>`).join('')}</div>`;
  }

  // Horários de pico: o maior valor em destaque (cor da série) e o resto em cinza, para a resposta saltar aos olhos.
  const WEEKDAYS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']];
  const hourRange = (hour) => `${hour}h às ${(hour + 1) % 24}h`;
  const visitsText = (count) => `${fmtNum(count)} ${count === 1 ? 'visita' : 'visitas'}`;
  let hourTotals = [];
  let hourPeak = 0;
  let hourGeometry = null;
  let selectedHour = null;
  const canHover = matchMedia('(hover: hover)');
  function renderHours(hours) {
    hourTotals = Array.from({ length: 24 }, (_, hour) => hours.reduce((sum, day) => sum + day[hour], 0));
    const days = WEEKDAYS.map(([index, label]) => ({ label, count: hours[index].reduce((sum, value) => sum + value, 0) }));
    const total = hourTotals.reduce((sum, value) => sum + value, 0);
    if (!total) {
      $('#peak-tiles').innerHTML = '';
      $('#hour-readout').textContent = '';
      $('#hour-chart').innerHTML = '<p class="empty">Ainda sem visitas no período.</p>';
      $('#weekday-bars').innerHTML = '<p class="empty">Ainda sem visitas no período.</p>';
      hourGeometry = null;
      return;
    }
    hourPeak = hourTotals.indexOf(Math.max(...hourTotals));
    const peakDay = days.reduce((best, day) => (day.count > best.count ? day : best));
    const tile = (label, value, count) => `<div class="peak-tile"><span class="label">${label}</span><strong>${value}</strong><small>${visitsText(count)} · ${fmtPct(count / total)} do total</small></div>`;
    $('#peak-tiles').innerHTML = tile('Horário de mais movimento', hourRange(hourPeak), hourTotals[hourPeak]) + tile('Dia de mais movimento', peakDay.label, peakDay.count);

    // Colunas por hora (SVG próprio, mesmo estilo da linha do tempo).
    const container = $('#hour-chart');
    const width = Math.max(container.clientWidth, 260);
    const height = container.clientHeight || 190;
    const pad = { top: 22, bottom: 22 };
    const innerH = height - pad.top - pad.bottom;
    const slot = width / 24;
    const barW = Math.min(24, Math.max(3, slot - 3));
    const max = hourTotals[hourPeak];
    hourGeometry = { slot, base: pad.top + innerH, innerH, max };
    const column = (value, hour) => {
      if (!value) return '';
      const h = Math.max(2, (value / max) * innerH);
      const x = hour * slot + (slot - barW) / 2;
      const y = pad.top + innerH - h;
      const r = Math.min(4, barW / 2, h);
      // Ponta arredondada só em cima; base reta no eixo.
      return `<path class="col${hour === hourPeak ? ' peak' : ''}" data-hour="${hour}" d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + h}Z"/>`;
    };
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Visitas por hora do dia. Pico: ${hourRange(hourPeak)}, ${visitsText(max)}.">
      <line class="baseline" x1="0" x2="${width}" y1="${pad.top + innerH + .5}" y2="${pad.top + innerH + .5}"/>
      ${hourTotals.map(column).join('')}
      <g class="value-labels"></g>
      ${hourTotals.map((_, hour) => (hour % 3 === 0 ? `<text class="axis-label" x="${hour * slot + slot / 2}" y="${height - 5}" text-anchor="middle">${hour}h</text>` : '')).join('')}
    </svg>`;
    updateHourSelection();

    const dayMax = peakDay.count;
    $('#weekday-bars').innerHTML = days.map((day) => `<div class="bar-row${day === peakDay ? '' : ' dim'}">
      <span class="name">${day.label}</span>
      <span class="num">${fmtNum(day.count)}<small>${fmtPct(day.count / total)}</small></span>
      <div class="bar-track"><div class="bar-fill" style="width:${dayMax ? (day.count / dayMax) * 100 : 0}%"></div></div>
    </div>`).join('');
  }

  // Leitura de uma coluna numa linha fixa acima do gráfico: no celular tocando ou arrastando o dedo,
  // no computador passando o mouse, no teclado com as setas. Sem dica flutuante, que o dedo cobriria.
  function updateHourSelection() {
    const svg = $('#hour-chart svg');
    if (!svg || !hourGeometry) return;
    const { slot, base, innerH, max } = hourGeometry;
    $$('.col', svg).forEach((col) => col.classList.toggle('selected', Number(col.dataset.hour) === selectedHour && selectedHour !== hourPeak));
    const label = (hour, cls) => `<text class="${cls}" x="${hour * slot + slot / 2}" y="${base - (hourTotals[hour] / max) * innerH - 7}" text-anchor="middle">${fmtNum(hourTotals[hour])}</text>`;
    $('.value-labels', svg).innerHTML = label(hourPeak, 'peak-label') + (selectedHour !== null && selectedHour !== hourPeak ? label(selectedHour, 'selected-label') : '');
    $('#hour-readout').innerHTML = selectedHour === null
      ? (canHover.matches ? '' : 'Toque nas colunas para ver cada hora.')
      : `<b>${hourRange(selectedHour)}</b>: ${visitsText(hourTotals[selectedHour])}${selectedHour === hourPeak ? ' · horário de pico' : ''}`;
  }
  const hourAt = (event) => {
    const bounds = $('#hour-chart svg').getBoundingClientRect();
    return Math.min(23, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * 24)));
  };
  const selectHourAt = (event) => {
    if (!$('#hour-chart svg')) return;
    const hour = hourAt(event);
    if (hour === selectedHour) return;
    selectedHour = hour;
    updateHourSelection();
  };
  $('#hour-chart').addEventListener('pointerdown', selectHourAt);
  $('#hour-chart').addEventListener('pointermove', (event) => { if (event.pointerType === 'mouse' || event.buttons) selectHourAt(event); });
  $('#hour-chart').addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    selectedHour = null;
    updateHourSelection();
  });
  $('#hour-chart').addEventListener('keydown', (event) => {
    if (!hourGeometry || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    selectedHour = ((selectedHour ?? hourPeak) + (event.key === 'ArrowRight' ? 1 : 23)) % 24;
    updateHourSelection();
  });

  // Mapa de calor: a própria página num iframe, com os cliques desenhados por cima.
  let heatReady = null;
  function loadHeatFrame() {
    if (heatReady) return heatReady;
    const iframe = $('#heat-iframe');
    heatReady = new Promise((resolve) => {
      iframe.addEventListener('load', () => {
        const doc = iframe.contentDocument;
        const page = doc.querySelector('.page');
        const fit = () => {
          const height = page.offsetTop + page.offsetHeight;
          iframe.style.height = `${height}px`;
          // Mesma referência do coletor: a caixa inteira de .page.
          return { left: page.offsetLeft, top: page.offsetTop, width: page.offsetWidth, height };
        };
        resolve(fit);
      }, { once: true });
      iframe.src = '/?mapa-de-calor';
    });
    return heatReady;
  }
  async function renderHeatmap(points) {
    $('#heat-sub').textContent = points.length ? `${fmtNum(points.length)} cliques` : 'Nenhum clique no período.';
    const fit = await loadHeatFrame();
    const geometry = fit();
    // Com a aba de métricas escondida (ex.: troca de tema no editor) a página não tem altura para medir.
    if (!geometry.height) return;
    const scale = Math.min(1, $('#heat-frame').clientWidth / 390);
    $('#heat-stage').style.setProperty('--heat-scale', scale);
    $('#heat-spacer').style.height = `${geometry.height * scale}px`;
    const canvas = $('#heat-canvas');
    const ratio = devicePixelRatio || 1;
    canvas.style.height = `${geometry.height}px`;
    canvas.width = 390 * ratio;
    canvas.height = geometry.height * ratio;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!points.length) return;
    // 1) acumula intensidade em tons de alfa; 2) pinta em uma rampa de um só tom (vermelho da marca).
    const radius = 22 * ratio;
    const strength = Math.min(.45, Math.max(.08, 6 / Math.sqrt(points.length)));
    for (const [px, py] of points) {
      const cx = (geometry.left + px * geometry.width) * ratio;
      const cy = (geometry.top + py) * ratio;
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (!alpha) continue;
      const level = Math.min(1, alpha * 1.4);
      data[i] = Math.round(255 - level * 75);
      data[i + 1] = Math.round(140 * (1 - level));
      data[i + 2] = Math.round(140 * (1 - level));
      data[i + 3] = Math.round((0.25 + level * 0.65) * 255);
    }
    context.putImageData(image, 0, 0);
  }

  function renderJourneys(recent) {
    const element = $('#journeys');
    if (!recent.length) {
      element.innerHTML = '<li class="empty">Quando alguém abrir a página, a visita aparece aqui. Dica: divulgue os links da aba Configurações para saber de onde cada pessoa veio.</li>';
      return;
    }
    element.innerHTML = recent.map((visit) => {
      const converted = visit.events.some((event) => event.kind === 'whatsapp');
      const source = visit.campaign ? `${visit.source} · ${visit.campaign}` : visit.source;
      const steps = [
        `<li class="start"><time>${fmtTime(visit.start)}</time> Entrou pela origem <b>${escapeHtml(source)}</b></li>`,
        ...visit.events.map((event) => `<li class="${event.kind}"><time>+${fmtDur(Math.max(0, event.t - visit.start))}</time> ${event.kind === 'whatsapp' ? 'Abriu o WhatsApp em ' : event.kind === 'social' ? 'Foi para o ' : 'Clicou em '}<b>${escapeHtml(event.label)}</b></li>`),
        `<li class="end"><time>${fmtTime(visit.start + visit.duration)}</time> Saiu. Ficou ${fmtDur(visit.duration)} na página e rolou ${visit.scroll}%</li>`
      ];
      return `<li class="journey"><details>
        <summary>
          <span class="when">${fmtTime(visit.start)}<small>${fmtDay(visit.start)}</small></span>
          <span class="chips">
            <span class="chip source">${escapeHtml(source)}</span>
            ${converted ? '<span class="chip converted">Chamou no WhatsApp</span>' : ''}
            <span class="chip" title="${visit.approx ? 'Aproximado pelo fuso horário' : ''}">${escapeHtml(visit.location)}</span>
            <span class="chip">${escapeHtml(visit.device)}</span>
            ${visit.returning ? '<span class="chip">Voltou</span>' : ''}
          </span>
          <span class="stay">${fmtDur(visit.duration)}<small>${visit.events.length} ${visit.events.length === 1 ? 'clique' : 'cliques'}</small></span>
        </summary>
        <ol class="steps">${steps.join('')}</ol>
      </details></li>`;
    }).join('');
  }
  $('#open-visits').addEventListener('click', () => $('#visits-dialog').showModal());
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view !== 'metricas' || !state.stats) return;
      renderTimeline(state.stats);
      renderHours(state.stats.hours);
      renderHeatmap(state.stats.points);
    }, 150);
  });

  /* ---------- Conteúdo ---------- */
  const isDirty = () => Boolean(state.saved && JSON.stringify(state.draft) !== JSON.stringify(state.saved));
  const getPath = (object, path) => path.split('.').reduce((value, key) => (value == null ? value : value[key]), object);
  const setPath = (object, path, value) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((value, key) => value[key], object)[last] = value;
  };
  const randomId = () => `servico-${Math.random().toString(36).slice(2, 7)}`;
  const STYLE_LABELS = { online: 'Escuro', presencial: 'Vermelho', avaliacao: 'Claro' };

  function serviceItem(service, index, total) {
    const p = `services.${index}`;
    return `<li class="service-item${service.visible ? '' : ' hidden-service'}" data-index="${index}">
      <details${service.__open ? ' open' : ''}>
        <summary>
          <img class="thumb" src="/${escapeHtml(service.image)}" alt="">
          <span class="title"><strong>${escapeHtml(service.title)}</strong><small>${service.visible ? STYLE_LABELS[service.style] : 'Oculto na página'}</small></span>
          <span class="tools">
            <button type="button" class="tool" data-action="toggle" aria-label="${service.visible ? 'Ocultar' : 'Mostrar'} ${escapeHtml(service.title)}" title="${service.visible ? 'Ocultar da página' : 'Mostrar na página'}"><svg class="icon"><use href="#i-${service.visible ? 'eye' : 'eye-off'}"/></svg></button>
            <button type="button" class="tool" data-action="up" aria-label="Mover para cima" title="Mover para cima"${index === 0 ? ' disabled' : ''}><svg class="icon"><use href="#i-up"/></svg></button>
            <button type="button" class="tool" data-action="down" aria-label="Mover para baixo" title="Mover para baixo"${index === total - 1 ? ' disabled' : ''}><svg class="icon"><use href="#i-down"/></svg></button>
            <button type="button" class="tool delete" data-action="delete" aria-label="Excluir ${escapeHtml(service.title)}" title="Excluir"><svg class="icon"><use href="#i-trash"/></svg></button>
          </span>
        </summary>
        <div class="service-body">
          <div class="fields two">
            <label class="field"><span>Título</span><input data-path="${p}.title" maxlength="40" value="${escapeHtml(service.title)}"></label>
            <label class="field"><span>Texto do botão</span><input data-path="${p}.cta" maxlength="24" value="${escapeHtml(service.cta)}"></label>
          </div>
          <label class="field"><span>Texto do cartão</span><textarea data-path="${p}.description" rows="4" maxlength="240">${escapeHtml(service.description)}</textarea>
            <small class="hint">Cada linha aparece como uma linha no cartão. Coloque entre **asteriscos duplos** o trecho em destaque.</small></label>
          <label class="field"><span>Mensagem que chega no WhatsApp</span><textarea data-path="${p}.message" rows="3" maxlength="600">${escapeHtml(service.message)}</textarea></label>
          <label class="field"><span>Subtítulo no menu</span><input data-path="${p}.menuSubtitle" maxlength="50" value="${escapeHtml(service.menuSubtitle)}"></label>
          <div class="field"><span>Estilo do cartão</span>
            <div class="style-options">${Object.entries(STYLE_LABELS).map(([value, label]) => `<label class="style-option"><input type="radio" name="style-${index}" data-path="${p}.style" value="${value}"${service.style === value ? ' checked' : ''}><span class="swatch ${value}"></span>${label}</label>`).join('')}</div>
          </div>
          <div class="field"><span>Foto</span>
            <div class="photo-field">
              <img src="/${escapeHtml(service.image)}" alt="" width="72" height="72">
              <div><label class="btn"><svg class="icon"><use href="#i-image"/></svg><span>Trocar foto</span><input type="file" accept="image/jpeg,image/png,image/webp" data-upload="${index}" hidden></label>
              <p class="hint">Formato horizontal; o lado esquerdo fica atrás do texto.</p></div>
            </div>
          </div>
        </div>
      </details>
    </li>`;
  }

  function renderServices() {
    const list = $('#services');
    const open = new Set($$('.service-item > details[open]', list).map((details) => details.parentElement.dataset.index));
    state.draft.services.forEach((service, index) => { if (open.has(String(index))) service.__open = true; });
    list.innerHTML = state.draft.services.map((service, index, all) => serviceItem(service, index, all.length)).join('');
    state.draft.services.forEach((service) => { delete service.__open; });
    const visible = state.draft.services.filter((service) => service.visible).length;
    $('#services-count').textContent = `${state.draft.services.length} ${state.draft.services.length === 1 ? 'cartão' : 'cartões'} · ${visible} ${visible === 1 ? 'visível' : 'visíveis'}`;
    $('#add-service').disabled = state.draft.services.length >= 8;
  }

  function renderEditor() {
    $$('#editor [data-path]').forEach((input) => {
      if (input.closest('#services')) return;
      input.value = getPath(state.draft, input.dataset.path) ?? '';
    });
    $('#profile-photo').src = `/${state.draft.profile.photo}`;
    renderServices();
    updateCounters();
    updateDirty();
  }
  function updateCounters() {
    $$('[data-count]').forEach((element) => {
      const length = (getPath(state.draft, element.dataset.count) || '').length;
      element.textContent = `${length}/300 caracteres · o Google costuma mostrar até 160.`;
    });
  }
  function updateDirty() {
    $('#savebar').hidden = !(state.view === 'conteudo' && isDirty());
  }
  function changed({ rerenderServices = false } = {}) {
    if (rerenderServices) renderServices();
    updateCounters();
    updateDirty();
    schedulePreview();
  }

  $('#editor').addEventListener('input', (event) => {
    const input = event.target;
    if (!input.dataset.path) return;
    setPath(state.draft, input.dataset.path, input.value);
    if (/^services\.\d+\.title$/.test(input.dataset.path)) {
      const strong = input.closest('.service-item').querySelector('.title strong');
      strong.textContent = input.value;
    }
    if (/^services\.\d+\.style$/.test(input.dataset.path)) {
      input.closest('.service-item').querySelector('.title small').textContent = STYLE_LABELS[input.value];
    }
    changed();
  });
  $('#editor').addEventListener('submit', (event) => event.preventDefault());
  $('#services').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    event.preventDefault();
    const index = Number(button.closest('.service-item').dataset.index);
    const services = state.draft.services;
    const action = button.dataset.action;
    if (action === 'toggle') services[index].visible = !services[index].visible;
    if (action === 'up' && index > 0) [services[index - 1], services[index]] = [services[index], services[index - 1]];
    if (action === 'down' && index < services.length - 1) [services[index + 1], services[index]] = [services[index], services[index + 1]];
    if (action === 'delete') {
      const ok = await confirmAction({ title: 'Excluir serviço?', text: `"${services[index].title}" sai da página quando você publicar. Dá para recuperar pelo histórico.`, ok: 'Excluir' });
      if (!ok) return;
      services.splice(index, 1);
    }
    changed({ rerenderServices: true });
  });
  $('#add-service').addEventListener('click', () => {
    state.draft.services.push({
      id: randomId(), style: 'online', visible: true, title: 'Novo serviço',
      description: 'Descreva o serviço aqui\n**com o trecho em destaque.**', cta: 'Saiba Mais', menuSubtitle: '',
      message: `Olá! Tenho interesse em saber mais sobre seus serviços.`,
      image: 'assets/consultoria-online.jpg', imageWebp: 'assets/consultoria-online.webp', __open: true
    });
    renderServices();
    changed();
    const last = $('#services .service-item:last-child');
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('input', last.querySelector('.service-body')).select();
  });

  $('#editor').addEventListener('change', async (event) => {
    const input = event.target;
    if (!input.dataset.upload || !input.files.length) return;
    const file = input.files[0];
    input.value = '';
    if (file.size > 4 * 1024 * 1024) return toast('A imagem precisa ter até 4 MB. Reduza o tamanho e tente de novo.', true);
    toast('Enviando foto…');
    try {
      const { src } = await api('/api/upload', { method: 'POST', body: file, rawType: file.type || 'application/octet-stream' });
      if (input.dataset.upload === 'profile') {
        state.draft.profile.photo = src;
        state.draft.profile.photoWebp = '';
        $('#profile-photo').src = `/${src}`;
      } else {
        const service = state.draft.services[Number(input.dataset.upload)];
        service.image = src;
        service.imageWebp = '';
        service.__open = true;
        renderServices();
      }
      changed();
      toast('Foto enviada. Publique para aplicar.');
    } catch (error) { toast(error.message, true); }
  });

  $('#publish').addEventListener('click', async () => {
    const button = $('#publish');
    button.disabled = true;
    try {
      state.saved = await api('/api/content', { method: 'PUT', body: state.draft });
      state.draft = clone(state.saved);
      renderEditor();
      schedulePreview(0);
      toast('Publicado! A página já está atualizada.');
    } catch (error) { toast(error.message, true); }
    button.disabled = false;
  });
  $('#discard').addEventListener('click', async () => {
    if (!(await confirmAction({ title: 'Descartar alterações?', text: 'O editor volta para a versão que está no ar.', ok: 'Descartar' }))) return;
    state.draft = clone(state.saved);
    renderEditor();
    schedulePreview(0);
  });
  addEventListener('beforeunload', (event) => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });

  // Prévia ao vivo
  function schedulePreview(delay = 350) {
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderPreview, delay);
  }
  async function renderPreview() {
    if (state.view !== 'conteudo' || !state.draft) return;
    const frame = $('#preview-frame');
    let scroll = 0;
    try { scroll = frame.contentWindow.scrollY; } catch (_) {}
    try {
      const html = await api(`/api/preview?theme=${state.previewTheme}`, { method: 'POST', body: state.draft });
      frame.addEventListener('load', () => { try { frame.contentWindow.scrollTo(0, scroll); } catch (_) {} }, { once: true });
      frame.srcdoc = html;
    } catch (error) { toast(error.message, true); }
  }
  $$('#preview-theme button').forEach((button) => button.addEventListener('click', () => {
    state.previewTheme = button.dataset.themeOption;
    $$('#preview-theme button').forEach((other) => other.setAttribute('aria-checked', String(other === button)));
    schedulePreview(0);
  }));
  $('#open-preview').addEventListener('click', () => { $('#preview').classList.add('open'); schedulePreview(0); });
  $('#close-preview').addEventListener('click', () => $('#preview').classList.remove('open'));

  // Histórico
  $('#open-history').addEventListener('click', async () => {
    const dialog = $('#history-dialog');
    const list = $('#history');
    list.innerHTML = '<li class="skeleton" style="height:56px"></li>';
    dialog.showModal();
    try {
      const versions = await api('/api/content/history');
      list.innerHTML = versions.length ? versions.map((version, index) => `<li>
        <span><strong>${new Date(version.savedAt).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}${index === 0 ? ' · no ar' : ''}</strong><small>${escapeHtml(version.summary)}</small></span>
        <button class="btn" type="button" data-version="${escapeHtml(version.id)}"${index === 0 ? ' disabled' : ''}>Restaurar</button>
      </li>`).join('') : '<li class="empty">Nenhuma versão publicada ainda. Cada publicação aparece aqui.</li>';
    } catch (error) { list.innerHTML = `<li class="empty">${escapeHtml(error.message)}</li>`; }
  });
  $('#history').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-version]');
    if (!button) return;
    try {
      state.draft = await api(`/api/content/history/${encodeURIComponent(button.dataset.version)}`);
      renderEditor();
      schedulePreview(0);
      $('#history-dialog').close();
      toast('Versão carregada no editor. Publique para colocá-la no ar.');
    } catch (error) { toast(error.message, true); }
  });
  $$('dialog [data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $$('dialog.modal').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

  /* ---------- Configurações ---------- */
  const slugify = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function updateUtm() {
    const [source, medium] = $('#utm-preset').value.split('|');
    const url = new URL('/', location.origin);
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', medium);
    const campaign = slugify($('#utm-campaign').value);
    if (campaign) url.searchParams.set('utm_campaign', campaign);
    $('#utm-output').textContent = url.href;
  }
  $('#utm-preset').addEventListener('change', updateUtm);
  $('#utm-campaign').addEventListener('input', updateUtm);
  $('#utm-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#utm-output').textContent); toast('Link copiado!'); }
    catch (_) { toast('Não foi possível copiar. Selecione o link e copie manualmente.', true); }
  });

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#pw-error');
    error.hidden = true;
    const next = $('#pw-next').value;
    const fail = (message) => { error.textContent = message; error.hidden = false; };
    if (next.length < 8) return fail('A nova senha precisa de pelo menos 8 caracteres.');
    if (next !== $('#pw-confirm').value) return fail('As novas senhas não são iguais.');
    try {
      await api('/api/auth/password', { method: 'POST', body: { current: $('#pw-current').value, next } });
      event.target.reset();
      toast('Senha alterada. Outros aparelhos conectados foram desconectados.');
    } catch (failure) { fail(failure.message); }
  });

  $('#clear-events').addEventListener('click', async () => {
    const ok = await confirmAction({ title: 'Apagar todas as métricas?', text: 'Visitas, cliques e tempos de permanência serão apagados para sempre. Exporte o CSV antes se quiser guardar.', ok: 'Apagar tudo', typeWord: 'APAGAR' });
    if (!ok) return;
    try {
      await api('/api/events', { method: 'DELETE' });
      state.stats = null;
      toast('Métricas apagadas.');
    } catch (error) { toast(error.message, true); }
  });

  /* ---------- Início ---------- */
  (async () => {
    try {
      const status = await api('/api/auth/status');
      if (status.authenticated) await enter(); else showAuth(status);
    } catch (_) { showAuth({ configured: true }); }
  })();
})();
