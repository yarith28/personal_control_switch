import { state } from './state.js';
import { persist } from './persist.js';
import { THEMES, themeVariables } from './theme-palettes.mjs';

export { THEMES } from './theme-palettes.mjs';

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(themeVariables(theme, state.darkMode))) {
    root.style.setProperty(property, value);
  }
  root.dataset.colorMode = state.darkMode ? 'dark' : 'light';
  root.style.colorScheme = root.dataset.colorMode;
  state.currentTheme = theme;
  const toggle = document.getElementById('dark-mode-toggle');
  toggle?.classList.toggle('active', state.darkMode);
  toggle?.setAttribute('aria-pressed', String(state.darkMode));
  document.querySelectorAll('.swatch').forEach((element) => {
    const active = element.dataset.id === theme.id;
    element.classList.toggle('active', active);
    element.setAttribute('aria-pressed', String(active));
  });
}

export function buildSwatches() {
  const container = document.getElementById('theme-swatches');
  container.replaceChildren();
  for (const theme of THEMES) {
    const dot = document.createElement('button');
    dot.className = 'swatch' + (theme.id === state.currentTheme.id ? ' active' : '');
    dot.style.background = theme.swatch;
    dot.dataset.id = theme.id;
    dot.title = theme.label;
    dot.type = 'button';
    dot.setAttribute('aria-label', `Use ${theme.label} theme`);
    dot.setAttribute('aria-pressed', String(theme.id === state.currentTheme.id));
    dot.addEventListener('click', async (event) => {
      event.stopPropagation();
      applyTheme(theme);
      await persist();
    });
    container.appendChild(dot);
  }
}
