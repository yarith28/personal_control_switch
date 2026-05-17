import './js/log.js'; // registers error/unhandledrejection handlers
import {
  addBtn, selectAll, pullSelectedBtn, pushSelectedBtn,
  multiSelectBtn, organizeBtn, addFolderBtn, refreshBtn,
} from './js/dom.js';
import { state, getProjects } from './js/state.js';
import { THEMES, applyTheme, buildSwatches } from './js/themes.js';
import { persist } from './js/persist.js';
import { refreshAll, refreshBranches, fetchAndRefreshAll } from './js/branches.js';
import { addProject, batchOp } from './js/actions.js';
import { addFolder } from './js/render-folder.js';
import { renderProjects } from './js/render-list.js';
import { setMultiSelect, setOrganizeMode } from './js/modes.js';

// ── Top-level event listeners ───────────────────────────────────────────────
addBtn.addEventListener('click', addProject);
pullSelectedBtn.addEventListener('click', () =>
  batchOp('Pulling', (p) => window.api.pull(p))
);
pushSelectedBtn.addEventListener('click', () =>
  batchOp('Pushing', (p) => window.api.push(p))
);
selectAll.addEventListener('change', () => {
  const checked = selectAll.checked;
  for (const p of getProjects()) {
    if (p.branches) p.selected = checked;
  }
  renderProjects();
});
multiSelectBtn.addEventListener('click', () => setMultiSelect(!state.multiSelect));
organizeBtn.addEventListener('click', () => setOrganizeMode(!state.organizeMode));
addFolderBtn.addEventListener('click', addFolder);
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  refreshBtn.disabled = true;
  await fetchAndRefreshAll();
  refreshBtn.classList.remove('spinning');
  refreshBtn.disabled = false;
});

// ── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  const platform = await window.api.getPlatform();
  document.body.classList.add('platform-' + platform);

  document
    .getElementById('win-min')
    ?.addEventListener('click', () => window.api.windowMinimize());
  document
    .getElementById('win-max')
    ?.addEventListener('click', () => window.api.windowMaximize());
  document
    .getElementById('win-close')
    ?.addEventListener('click', () => window.api.windowClose());

  const outputWrap = document.getElementById('output-wrap');
  document.getElementById('output-toggle')?.addEventListener('click', () => {
    outputWrap.classList.toggle('collapsed');
    persist();
  });

  const themeSwatches = document.getElementById('theme-swatches');
  document.getElementById('theme-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    themeSwatches.classList.toggle('open');
  });
  const closeAllDropdowns = () => {
    document.querySelectorAll('.branch-dropdown.open').forEach((d) => d.classList.remove('open'));
    document.querySelectorAll('.branch-wrap.open').forEach((w) => w.classList.remove('open'));
  };

  document.addEventListener('click', () => {
    themeSwatches.classList.remove('open');
    closeAllDropdowns();
  });

  document.getElementById('projects')?.addEventListener('scroll', closeAllDropdowns);

  window.addEventListener('focus', () => refreshAll());

  const config = await window.api.loadConfig();

  state.currentTheme = THEMES.find((t) => t.id === config.theme) || THEMES[0];
  applyTheme(state.currentTheme);
  buildSwatches();

  if (config.logCollapsed) outputWrap.classList.add('collapsed');

  // Load + migrate items into the nested tree model.
  //   v1 (oldest): config.projects = [{ path }]
  //   v2 (interleaved): config.items = [{type:'project'}, {type:'group'}, ...]   (position = membership)
  //   v3 (current):  config.items = [{type:'project'}, {type:'folder', items:[...]}]
  const rawItems = config.items
    ?? (config.projects || []).map((p) => ({ type: 'project', path: p.path }));

  // Detect v3 (already nested) vs v2 (interleaved)
  const isAlreadyNested =
    rawItems.some((i) => i.type === 'folder') ||
    rawItems.every((i) => i.type !== 'group');

  const tree = [];
  if (isAlreadyNested) {
    for (const entry of rawItems) {
      if (entry.type === 'folder') {
        tree.push({
          type: 'folder',
          id: entry.id,
          name: entry.name,
          collapsed: !!entry.collapsed,
          items: (entry.items || []).map((p) => ({ type: 'project', path: p.path })),
        });
      } else if (entry.type === 'project') {
        tree.push({ type: 'project', path: entry.path });
      }
    }
  } else {
    // v2 → v3: walk interleaved list, fold projects under the most recent group header
    let currentFolder = null;
    for (const entry of rawItems) {
      if (entry.type === 'group') {
        currentFolder = {
          type: 'folder',
          id: entry.id,
          name: entry.name,
          collapsed: !!entry.collapsed,
          items: [],
        };
        tree.push(currentFolder);
      } else if (entry.type === 'project') {
        const proj = { type: 'project', path: entry.path };
        if (currentFolder) currentFolder.items.push(proj);
        else tree.push(proj);
      }
    }
  }

  // Hydrate projects with branches
  for (const item of tree) {
    if (item.type === 'folder') {
      const hydrated = [];
      for (const child of item.items) {
        const proj = { type: 'project', path: child.path, selected: false };
        await refreshBranches(proj);
        hydrated.push(proj);
      }
      state.items.push({ ...item, items: hydrated });
    } else {
      const proj = { type: 'project', path: item.path, selected: false };
      await refreshBranches(proj);
      state.items.push(proj);
    }
  }

  // Always rewrite in the new nested format
  await persist();

  renderProjects();
})();
