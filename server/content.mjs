// Conteúdo original da página; usado na primeira execução e como base para campos ausentes.
export const defaultContent = {
  seo: {
    title: 'Rafael Moura | Personal Trainer',
    description: 'Transforme seu treino com Rafael Moura. Consultoria online, treino presencial e avaliação física com acompanhamento profissional. CREF verificado.'
  },
  profile: {
    name: 'Rafael Moura',
    role: 'Personal Trainer',
    cref: 'CREF verificado',
    photo: 'assets/personal-hero.jpg',
    photoWebp: 'assets/personal-hero.webp'
  },
  hero: { kicker: 'Transforme seu', word: 'treino', subtitle: 'com acompanhamento profissional!' },
  contact: {
    whatsapp: '5500000000000',
    message: 'Olá, Rafael! Quero conhecer seus serviços e saber qual opção combina com meu objetivo.',
    instagram: 'https://www.instagram.com/',
    tiktok: ''
  },
  menu: { label: 'Como posso te ajudar?', cta: 'Vamos conversar?' },
  services: [
    {
      id: 'online', style: 'online', visible: true,
      title: 'Consultoria Online',
      description: 'Treine de onde estiver\n**com um plano personalizado.**\nAcompanhamento online\npara sua evolução.',
      cta: 'Saiba Mais', menuSubtitle: 'Treine de onde estiver',
      message: 'Olá, Rafael! Tenho interesse na Consultoria Online. Gostaria de saber como funciona o plano personalizado e o acompanhamento.',
      image: 'assets/consultoria-online.jpg', imageWebp: 'assets/consultoria-online.webp'
    },
    {
      id: 'presencial', style: 'presencial', visible: true,
      title: 'Treino Presencial',
      description: 'Treino personalizado para você\n**com orientação profissional.**\nEvolua no seu ritmo\ne alcance seus objetivos.',
      cta: 'Saiba Mais', menuSubtitle: 'Evolua no seu ritmo',
      message: 'Olá, Rafael! Tenho interesse no Treino Presencial. Gostaria de saber sobre os horários e o treino com orientação profissional.',
      image: 'assets/treino-presencial.jpg', imageWebp: 'assets/treino-presencial.webp'
    },
    {
      id: 'avaliacao', style: 'avaliacao', visible: true,
      title: 'Avaliação Física',
      description: 'Descubra como está seu corpo hoje\n**e onde você pode chegar.**\nAvalie seus resultados\ne treine com mais estratégia.',
      cta: 'Saiba Mais', menuSubtitle: 'Saiba onde pode chegar',
      message: 'Olá, Rafael! Quero agendar uma Avaliação Física para entender meus resultados e treinar com mais estratégia. Como funciona?',
      image: 'assets/avaliacao-fisica.jpg', imageWebp: 'assets/avaliacao-fisica.webp'
    }
  ],
  footer: 'Todos os Direitos Reservados © Rafael Moura'
};

export const serviceStyles = ['online', 'presencial', 'avaliacao'];
const MAX_SERVICES = 8;
const HISTORY_LIMIT = 30;

const text = (value, max, fallback = '') => {
  const clean = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim() : '';
  return (clean || fallback).slice(0, max);
};
const httpsUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href.slice(0, 300) : '';
  } catch (_) { return ''; }
};
// Só aceita imagens servidas pelo próprio site.
export const isLocalImage = (value) => typeof value === 'string' && /^(assets|uploads)\/[\w.-]+\.(jpe?g|png|webp)$/i.test(value);
const image = (value, fallback) => (isLocalImage(value) ? value : fallback);
const slug = (value) => text(value, 40).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function sanitizeContent(input) {
  const source = input && typeof input === 'object' ? input : {};
  const d = defaultContent;
  const seo = source.seo || {};
  const profile = source.profile || {};
  const hero = source.hero || {};
  const contact = source.contact || {};
  const menu = source.menu || {};
  const photo = image(profile.photo, d.profile.photo);
  const ids = new Set();
  const services = (Array.isArray(source.services) ? source.services : d.services).slice(0, MAX_SERVICES).map((service, index) => {
    const item = service && typeof service === 'object' ? service : {};
    let id = slug(item.id) || slug(item.title) || `servico-${index + 1}`;
    while (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    const img = image(item.image, 'assets/consultoria-online.jpg');
    return {
      id,
      style: serviceStyles.includes(item.style) ? item.style : 'online',
      visible: item.visible !== false,
      title: text(item.title, 40, 'Novo serviço'),
      description: text(item.description, 240),
      cta: text(item.cta, 24, 'Saiba Mais'),
      menuSubtitle: text(item.menuSubtitle, 50),
      message: text(item.message, 600),
      image: img,
      imageWebp: isLocalImage(item.imageWebp) && item.imageWebp.replace(/\.webp$/i, '') === img.replace(/\.\w+$/, '') ? item.imageWebp : ''
    };
  });
  return {
    seo: { title: text(seo.title, 80, d.seo.title), description: text(seo.description, 300) },
    profile: {
      name: text(profile.name, 40, d.profile.name),
      role: text(profile.role, 40),
      cref: text(profile.cref, 40),
      photo,
      photoWebp: isLocalImage(profile.photoWebp) && profile.photoWebp.replace(/\.webp$/i, '') === photo.replace(/\.\w+$/, '') ? profile.photoWebp : ''
    },
    hero: { kicker: text(hero.kicker, 30), word: text(hero.word, 14), subtitle: text(hero.subtitle, 60) },
    contact: {
      whatsapp: String(contact.whatsapp ?? '').replace(/\D/g, '').slice(0, 15),
      message: text(contact.message, 600),
      instagram: httpsUrl(contact.instagram),
      tiktok: httpsUrl(contact.tiktok)
    },
    menu: { label: text(menu.label, 50), cta: text(menu.cta, 40, 'Vamos conversar?') },
    services,
    footer: text(source.footer, 120)
  };
}

// Conteúdo publicado e histórico de versões sobre o armazenamento chave-valor (arquivos ou Netlify Blobs).
export function createContentStore(kv) {
  const versionId = (time) => new Date(time).toISOString().replace(/[:.]/g, '-');
  const listHistory = async () => (await kv.list('history/')).map((key) => key.slice('history/'.length)).sort().reverse();
  const load = async () => sanitizeContent((await kv.getJSON('content')) || defaultContent);

  return {
    load,
    async save(input) {
      const content = sanitizeContent(input);
      // Na primeira publicação, guarda também a versão original para poder voltar a ela.
      if (!(await listHistory()).length) await kv.setJSON(`history/${versionId(Date.now() - 1000)}`, await load());
      await kv.setJSON('content', content);
      await kv.setJSON(`history/${versionId(Date.now())}`, content);
      const ids = await listHistory();
      await Promise.all(ids.slice(HISTORY_LIMIT).map((id) => kv.delete(`history/${id}`).catch(() => {})));
      return content;
    },
    async history() {
      const ids = await listHistory();
      return Promise.all(ids.map(async (id) => {
        const content = await kv.getJSON(`history/${id}`);
        const summary = content ? `${content.services.length} serviços · ${content.hero.kicker} ${content.hero.word}` : '';
        const [date, time] = id.split('T');
        return { id, savedAt: `${date}T${time.slice(0, 8).replace(/-/g, ':')}.${time.slice(9, 12)}Z`, summary };
      }));
    },
    async version(id) {
      if (!/^[\dT-]+Z$/.test(id)) return null;
      const content = await kv.getJSON(`history/${id}`);
      return content ? sanitizeContent(content) : null;
    }
  };
}
