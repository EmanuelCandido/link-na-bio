(() => {
  'use strict';
  const root = document.documentElement;
  const themeButton = document.querySelector('.theme-toggle');
  const themeColor = document.querySelector('#theme-color');
  const menu = document.querySelector('#profile-menu');
  const menuButton = document.querySelector('.menu-toggle');
  const shareDialog = document.querySelector('#share-dialog');
  const toast = document.querySelector('.toast');
  let toastTimer;
  let preferredTheme;
  try { preferredTheme = localStorage.getItem('linkbio-theme'); } catch (_) {}

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    const dark = theme === 'dark';
    themeButton.setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
    themeButton.setAttribute('aria-pressed', String(dark));
    themeColor.content = dark ? '#181818' : '#f8f8f8';
  };
  applyTheme(root.dataset.theme);
  themeButton.addEventListener('click', () => {
    preferredTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(preferredTheme);
    try { localStorage.setItem('linkbio-theme', preferredTheme); } catch (_) {}
  });
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', (event) => {
    if (preferredTheme !== 'light' && preferredTheme !== 'dark') applyTheme(event.matches ? 'dark' : 'light');
  });

  // Links de WhatsApp e redes já chegam prontos no HTML (gerados pelo servidor a partir do painel).
  document.querySelectorAll('[data-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  menuButton.addEventListener('click', () => {
    menu.showModal();
    menuButton.setAttribute('aria-expanded', 'true');
  });
  document.querySelector('.menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('close', () => {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.focus({ preventScroll: true });
  });
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => menu.close()));
  [menu, shareDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
  });
  document.querySelector('.share-close').addEventListener('click', () => shareDialog.close());

  const copyPageLink = async () => {
    const url = new URL(location.href);
    url.hash = '';
    try {
      await navigator.clipboard.writeText(url.href);
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
    } catch (_) {
      if (menu.open) menu.close();
      shareDialog.showModal();
      const field = document.querySelector('#share-url');
      field.value = url.href;
      field.focus();
      field.select();
    }
  };
  document.querySelectorAll('[data-share]').forEach((button) => button.addEventListener('click', copyPageLink));
})();
