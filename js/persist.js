import { state } from './state.js';

function serializeProject(p) {
  const out = { type: 'project', path: p.path };
  if (p.branches) out.branches = p.branches;
  if (p.current) out.current = p.current;
  if (typeof p.ahead === 'number')  out.ahead  = p.ahead;
  if (typeof p.behind === 'number') out.behind = p.behind;
  return out;
}

export async function persist() {
  const outputWrap = document.getElementById('output-wrap');
  await window.api.saveConfig({
    theme: state.currentTheme.id,
    font: state.currentFont?.id || 'system',
    compact: !!state.compactMode,
    logCollapsed: outputWrap?.classList.contains('collapsed') ?? false,
    items: state.items.map((i) =>
      i.type === 'folder'
        ? {
            type: 'folder',
            id: i.id,
            name: i.name,
            collapsed: i.collapsed,
            color: i.color || null,
            items: i.items.map(serializeProject),
          }
        : serializeProject(i)
    ),
  });
}
