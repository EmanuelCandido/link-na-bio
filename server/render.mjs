import { readFileSync } from 'node:fs';

// Lido sob demanda: no Netlify o template chega embutido (netlify/generated/page-template.mjs).
let fileTemplate;
const defaultTemplate = () => (fileTemplate ??= readFileSync(new URL('./page.html', import.meta.url), 'utf8'));

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// Texto dos cartões: **trecho** vira negrito e cada quebra de linha vira <br>.
const richText = (value) => escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
export const whatsappUrl = (phone, message) => `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(message || '')}`;

// <picture> com WebP quando houver; sem WebP, a imagem vai direto no contêiner.
const picture = (src, webp, imgAttrs, wrapClass = '') => {
  const img = `<img src="${escapeHtml(src)}" ${imgAttrs}>`;
  const cls = wrapClass ? ` class="${wrapClass}"` : '';
  if (webp) return `<picture${cls}>\n            <source srcset="${escapeHtml(webp)}" type="image/webp">\n            ${img}\n          </picture>`;
  return wrapClass ? `<span${cls}>${img}</span>` : img;
};

/**
 * Monta o HTML público a partir do conteúdo.
 * options.tracking: inclui o coletor de métricas.
 * options.preview: prévia do painel (base absoluta, tema forçado e sem métricas).
 */
export function renderPage(content, { tracking = true, preview = false, theme = null, template = defaultTemplate() } = {}) {
  const { profile, hero, contact, menu, seo } = content;
  const services = content.services.filter((service) => service.visible);
  const values = {
    'seo.title': seo.title,
    'seo.description': seo.description,
    'profile.name': profile.name,
    'profile.role': profile.role,
    'profile.photo': profile.photo,
    'hero.kicker': hero.kicker,
    'hero.word': hero.word,
    'hero.subtitle': hero.subtitle,
    'menu.label': menu.label,
    'menu.cta': menu.cta,
    footer: content.footer,
    year: new Date().getFullYear(),
    whatsappUrl: whatsappUrl(contact.whatsapp, contact.message),
    heroPreload: profile.photoWebp || profile.photo
  };
  const heroImg = `class="hero-photo" alt="${escapeHtml([profile.name, profile.role].filter(Boolean).join(', '))}" width="760" height="1018" fetchpriority="high"`;
  const socialLinks = [['instagram', 'Instagram'], ['tiktok', 'TikTok']]
    .filter(([key]) => contact[key])
    .map(([key, label]) => `<a class="social-link" href="${escapeHtml(contact[key])}" data-track="${key}" target="_blank" rel="noopener noreferrer" aria-label="${label} de ${escapeHtml(profile.name)}"><svg class="icon${key === 'tiktok' ? ' icon-tiktok' : ''}"><use href="#i-${key}"/></svg></a>`)
    .join('\n              ');
  const serviceCards = services.map((service) => {
    const media = picture(service.image, service.imageWebp, 'alt="" width="840" height="473" loading="lazy" decoding="async"', 'service-media');
    return `        <a class="service-card ${service.style}" href="${escapeHtml(whatsappUrl(contact.whatsapp, service.message))}" data-track="service:${service.id}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${service.cta} sobre ${service.title} no WhatsApp`)}">
          ${media}
          <div class="service-content">
            <h2>${escapeHtml(service.title)}</h2>
            <p>${richText(service.description)}</p>
            <span class="card-cta">${escapeHtml(service.cta)}<span class="arrow-badge"><svg class="icon"><use href="#i-arrow"/></svg></span></span>
          </div>
        </a>`;
  }).join('\n');
  const menuServices = services.map((service) => `      <a href="${escapeHtml(whatsappUrl(contact.whatsapp, service.message))}" data-track="menu-service:${service.id}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(service.image)}" alt="" width="52" height="52" loading="lazy">
        <span><strong>${escapeHtml(service.title)}</strong><small>${escapeHtml(service.menuSubtitle)}</small></span>
        <span class="arrow-badge"><svg class="icon"><use href="#i-arrow"/></svg></span>
      </a>`).join('\n');
  const raw = {
    htmlAttrs: preview ? ' data-preview' : '',
    baseTag: preview ? '<base href="/">\n  ' : '',
    forcedTheme: preview && (theme === 'dark' || theme === 'light') ? `'${theme}'` : 'null',
    trackScript: tracking && !preview ? '<script src="track.js" defer></script>' : '',
    heroPicture: picture(profile.photo, profile.photoWebp, heroImg),
    socialLinks,
    serviceCards,
    menuServices,
    crefBadge: profile.cref ? `<p class="cref"><svg class="icon"><use href="#i-check"/></svg>${escapeHtml(profile.cref)}</p>` : ''
  };
  const html = template
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => raw[key] ?? '')
    .replace(/\{\{([\w.]+)\}\}/g, (_, key) => escapeHtml(values[key]));
  // A prévia roda em srcdoc dentro de /admin/: caminhos absolutos evitam que o pré-carregamento busque em /admin/.
  return preview ? html.replace(/(\s(?:src|href|srcset)=")(?=(?:assets|uploads)\/|styles\.css|app\.js)/g, '$1/') : html;
}
