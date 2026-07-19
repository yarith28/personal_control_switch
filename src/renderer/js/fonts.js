import { state } from './state.js';
import { persist } from './persist.js';

export const FONTS = [
  {
    id: 'system',
    label: 'System',
    family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  {
    id: 'serif',
    label: 'Serif',
    family: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'mono',
    label: 'Mono',
    family: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
];

export function applyFont(font) {
  document.body.style.fontFamily = font.family;
  state.currentFont = font;
  document.querySelectorAll('.font-option').forEach((el) =>
    {
      const active = el.dataset.id === font.id;
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', String(active));
    }
  );
}

export function buildFontPicker() {
  const container = document.getElementById('font-picker');
  if (!container) return;
  container.innerHTML = '';
  for (const font of FONTS) {
    const btn = document.createElement('button');
    btn.className = 'font-option' + (font.id === state.currentFont?.id ? ' active' : '');
    btn.dataset.id = font.id;
    btn.type = 'button';
    btn.style.fontFamily = font.family;
    btn.textContent = font.label;
    btn.title = font.label;
    btn.setAttribute('aria-pressed', String(font.id === state.currentFont?.id));
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      applyFont(font);
      await persist();
    });
    container.appendChild(btn);
  }
}
