import { state } from './state.js';

export async function persist() {
  const outputWrap = document.getElementById('output-wrap');
  await window.api.saveConfig({
    theme: state.currentTheme.id,
    logCollapsed: outputWrap?.classList.contains('collapsed') ?? false,
    items: state.items.map((i) =>
      i.type === 'folder'
        ? {
            type: 'folder',
            id: i.id,
            name: i.name,
            collapsed: i.collapsed,
            items: i.items.map((p) => ({ type: 'project', path: p.path })),
          }
        : { type: 'project', path: i.path }
    ),
  });
}
