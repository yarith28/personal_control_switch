import { state } from './state.js';
import { normalizeAppRemotes } from './app-remotes.mjs';

function serializeProject(p) {
  const out = { type: 'project', path: p.path };
  if (p.pinned) out.pinned = true;
  if (p.branches) out.branches = p.branches;
  if (p.current) out.current = p.current;
  if (typeof p.hasUpstream === 'boolean') out.hasUpstream = p.hasUpstream;
  if (p.upstream) out.upstream = p.upstream;
  if (typeof p.ahead === 'number')  out.ahead  = p.ahead;
  if (typeof p.behind === 'number') out.behind = p.behind;
  if (typeof p.uncommitted === 'number') out.uncommitted = p.uncommitted;
  const appRemotes = normalizeAppRemotes(p.appRemotes);
  if (appRemotes.length) out.appRemotes = appRemotes;
  if (typeof p.selectedRemoteName === 'string' && p.selectedRemoteName.trim()) {
    out.selectedRemoteName = p.selectedRemoteName.trim();
  }
  return out;
}

export async function persist() {
  const outputWrap = document.getElementById('output-wrap');
  await window.api.saveConfig({
    theme: state.currentTheme.id,
    font: state.currentFont?.id || 'system',
    compact: !!state.compactMode,
    burst: !!state.burstMode,
    logCollapsed: outputWrap?.classList.contains('collapsed') ?? false,
    items: state.items.map((i) =>
      i.type === 'folder'
        ? {
            type: 'folder',
            id: i.id,
            name: i.name,
            pinned: !!i.pinned,
            collapsed: i.collapsed,
            color: i.color || null,
            items: i.items.map(serializeProject),
          }
        : serializeProject(i)
    ),
  });
}
