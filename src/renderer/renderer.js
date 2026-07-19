import { log } from './js/log.js'; // registers error/unhandledrejection handlers
import {
  addBtn, fetchAllBtn, selectAll, pullSelectedBtn, pushSelectedBtn, fetchSelectedBtn,
  multiSelectBtn, organizeBtn, addFolderBtn, collapseBtn, helpToggleBtn,
  projectSearchToggle, projectFilters, projectSearchInput,
} from './js/dom.js';
import { state, getProjects } from './js/state.js';
import { THEMES, applyTheme, buildSwatches } from './js/themes.js';
import { FONTS, applyFont, buildFontPicker } from './js/fonts.js';
import { persist } from './js/persist.js';
import { refreshAll } from './js/branches.js';
import { addProject, batchOp, fetchAllProjects, pushWithUpstreamPrompt } from './js/actions.js';
import { addFolder } from './js/render-folder.js';
import { renderProjects } from './js/render-list.js';
import { setMultiSelect, setOrganizeMode } from './js/modes.js';
import { setupTabs } from './js/tabs.js';
import { setupCrossSync } from './js/cross-sync.js';
import { setupCommitTool } from './js/commit-tool.js';
import { setupIdentityTool } from './js/identity-tool.js';
import { setupProjectDrop } from './js/project-drop.js';
import { hydrateStaticIcons } from './js/icons.js';
import { basename, withButtonLoading } from './js/util.js';
import { showToast } from './js/notify.js';

let autoRefreshInitialized = false;
let startupRefreshTriggered = false;
let gitProgressSubscribed = false;

hydrateStaticIcons();
setupTabs();
setupProjectDrop();

// The frameless window makes <body> a drag region, so right-clicking anywhere
// pops the OS window menu. Suppress the context menu to stop that.
document.addEventListener('contextmenu', (e) => e.preventDefault());

function setupAutoRefresh() {
  if (autoRefreshInitialized) return;
  autoRefreshInitialized = true;

  window.addEventListener('focus', () => refreshAll({ force: true, source: 'focus' }));
  setInterval(() => {
    if (document.hasFocus()) refreshAll({ force: true, source: 'interval' });
  }, 60 * 1000);
}

function triggerStartupRefresh() {
  if (startupRefreshTriggered) return;
  startupRefreshTriggered = true;
  refreshAll({ force: true, source: 'startup' });
}

function subscribeGitProgress() {
  if (gitProgressSubscribed || typeof window.api.onGitProgress !== 'function') return;
  gitProgressSubscribed = true;

  window.api.onGitProgress(({ repoPath, text }) => {
    const repo = basename(repoPath);
    const lines = text
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      log(`[${repo}] ${line}`, true);
    }
  });
}

// ── Top-level event listeners ───────────────────────────────────────────────
addBtn.addEventListener('click', addProject);
fetchAllBtn.addEventListener('click', () =>
  withButtonLoading(fetchAllBtn, fetchAllProjects)
);
pullSelectedBtn.addEventListener('click', () =>
  withButtonLoading(pullSelectedBtn, () => batchOp('Pulling', (p) => window.api.pull(p)))
);
pushSelectedBtn.addEventListener('click', () =>
  withButtonLoading(pushSelectedBtn, () => batchOp('Pushing', pushWithUpstreamPrompt))
);
fetchSelectedBtn.addEventListener('click', () =>
  withButtonLoading(fetchSelectedBtn, () => batchOp('Fetching', (p) => window.api.fetch(p)))
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
collapseBtn.addEventListener('click', async () => {
  const folders = state.items.filter((i) => i.type === 'folder');
  const allCollapsed = folders.every((f) => f.collapsed);
  folders.forEach((f) => { f.collapsed = !allCollapsed; });
  renderProjects();
  persist();
});

function setProjectSearchOpen(open) {
  projectFilters?.toggleAttribute('hidden', !open);
  projectSearchToggle?.classList.toggle('active', open);
  projectSearchToggle?.setAttribute('aria-expanded', String(open));

  if (open) {
    requestAnimationFrame(() => projectSearchInput?.focus({ preventScroll: true }));
    return;
  }

  if (projectSearchInput?.value || state.searchQuery) {
    projectSearchInput.value = '';
    state.searchQuery = '';
    renderProjects();
  }
}

projectSearchToggle?.addEventListener('click', () => {
  setProjectSearchOpen(projectFilters?.hasAttribute('hidden') ?? true);
});
projectSearchInput?.addEventListener('input', () => {
  state.searchQuery = projectSearchInput.value.trim();
  renderProjects();
});
projectSearchInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  setProjectSearchOpen(false);
  projectSearchToggle?.focus({ preventScroll: true });
});

// ── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  const platform = await window.api.getPlatform();
  document.body.classList.add('platform-' + platform);
  state.homedir = await window.api.getHomedir();

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
  const outputToggleBtn = document.getElementById('output-toggle');
  outputToggleBtn?.addEventListener('click', () => {
    outputWrap.classList.toggle('collapsed');
    outputToggleBtn.classList.toggle('active', !outputWrap.classList.contains('collapsed'));
    outputToggleBtn.setAttribute('aria-pressed', String(!outputWrap.classList.contains('collapsed')));
    persist();
  });

  const settingsPanel = document.getElementById('settings-panel');
  const helperOverlay = document.getElementById('helper-overlay');
  const helperCard = document.querySelector('.helper-card');
  const helperCloseBtn = document.getElementById('helper-close');
  const helperConfirmBtn = document.getElementById('helper-confirm');

  const setHelperOpen = async (open) => {
    helperOverlay?.toggleAttribute('hidden', !open);
    helpToggleBtn?.classList.toggle('active', open);
    document.body.classList.toggle('helper-open', open);
    if (!open && !state.helperSeen) {
      state.helperSeen = true;
      await window.api.saveConfig({ helperSeen: true });
    }
  };

  helpToggleBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    settingsPanel?.classList.remove('open');
    await setHelperOpen(helperOverlay?.hasAttribute('hidden') ?? true);
  });
  helperCard?.addEventListener('click', (e) => e.stopPropagation());
  helperOverlay?.addEventListener('click', async () => {
    await setHelperOpen(false);
  });
  helperCloseBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await setHelperOpen(false);
  });
  helperConfirmBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await setHelperOpen(false);
  });
  document.getElementById('settings-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setHelperOpen(false);
    settingsPanel.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(settingsPanel.classList.contains('open')));
  });
  settingsPanel?.addEventListener('click', (e) => e.stopPropagation());
  const closeAllDropdowns = () => {
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open, .color-palette-dropdown.open').forEach((d) => d.classList.remove('open'));
    document.querySelectorAll('.branch-wrap.open').forEach((w) => w.classList.remove('open'));
    document.querySelectorAll('[aria-expanded="true"].name-branch, [aria-expanded="true"].project-open-trigger')
      .forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
  };
  const isDropdownInteractionTarget = (target) => (
    target instanceof Element
    && !!target.closest('.branch-dropdown, .move-dropdown, .color-palette-dropdown, .project-open-trigger, .name-branch, .btn-move, .folder-color-btn')
  );

  document.addEventListener('pointerdown', (e) => {
    if (isDropdownInteractionTarget(e.target)) return;
    closeAllDropdowns();
  }, true);

  document.addEventListener('click', () => {
    settingsPanel?.classList.remove('open');
    document.getElementById('settings-toggle')?.setAttribute('aria-expanded', 'false');
    closeAllDropdowns();
  });

  document.getElementById('projects')?.addEventListener('scroll', () => {
    closeAllDropdowns();
  });
  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && !(helperOverlay?.hasAttribute('hidden') ?? true)) {
      await setHelperOpen(false);
    }
  });

  // Auto-refresh: re-read local git state on focus and on a 60s interval
  // while the window is active. No network — to fetch from origin, use the
  // batch Fetch button (or pull, which fetches as part of its operation).
  subscribeGitProgress();
  setupAutoRefresh();

  const config = await window.api.loadConfig();
  if (config.configRecovery) {
    showToast(
      config.configRecovery.title,
      config.configRecovery.message,
      { tone: config.configRecovery.tone || 'warning', duration: 12000 }
    );
  }

  state.currentTheme = THEMES.find((t) => t.id === config.theme) || THEMES[0];
  applyTheme(state.currentTheme);
  buildSwatches();

  state.currentFont = FONTS.find((f) => f.id === config.font) || FONTS[0];
  applyFont(state.currentFont);
  buildFontPicker();

  // Compact mode: load saved value, mirror to body class + toggle UI
  const compactToggle = document.getElementById('compact-toggle');
  const applyCompactMode = (on) => {
    state.compactMode = on;
    document.body.classList.toggle('compact-mode', on);
    compactToggle?.classList.toggle('active', on);
    compactToggle?.setAttribute('aria-pressed', String(on));
  };
  applyCompactMode(!!config.compact);
  compactToggle?.addEventListener('click', async (e) => {
    e.stopPropagation();
    applyCompactMode(!state.compactMode);
    await persist();
  });

  // Burst mode: when on, batch ops run in parallel instead of sequentially
  const burstToggle = document.getElementById('burst-toggle');
  const applyBurstMode = (on) => {
    state.burstMode = on;
    burstToggle?.classList.toggle('active', on);
    burstToggle?.setAttribute('aria-pressed', String(on));
  };
  applyBurstMode(!!config.burst);
  burstToggle?.addEventListener('click', async (e) => {
    e.stopPropagation();
    applyBurstMode(!state.burstMode);
    await persist();
  });

  state.helperSeen = !!config.helperSeen;

  const logCollapsed = config.logCollapsed ?? true;
  outputWrap.classList.toggle('collapsed', logCollapsed);
  outputToggleBtn?.classList.toggle('active', !logCollapsed);
  outputToggleBtn?.setAttribute('aria-pressed', String(!logCollapsed));

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

  const hydrateProject = (p) => ({
    type: 'project',
    path: p.path,
    pinned: !!p.pinned,
    selected: false,
    branches: p.branches || null,
    current:  p.current  || null,
    ahead:    typeof p.ahead  === 'number' ? p.ahead  : null,
    behind:   typeof p.behind === 'number' ? p.behind : null,
    uncommitted: typeof p.uncommitted === 'number' ? p.uncommitted : 0,
    error:    null,
  });

  if (isAlreadyNested) {
    for (const entry of rawItems) {
      if (entry.type === 'folder') {
        state.items.push({
          type: 'folder',
          id: entry.id,
          name: entry.name,
          pinned: !!entry.pinned,
          collapsed: !!entry.collapsed,
          color: entry.color || null,
          items: (entry.items || []).map(hydrateProject),
        });
      } else if (entry.type === 'project') {
        state.items.push(hydrateProject(entry));
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
          pinned: false,
          collapsed: !!entry.collapsed,
          color: null,
          items: [],
        };
        state.items.push(currentFolder);
      } else if (entry.type === 'project') {
        const proj = hydrateProject(entry);
        if (currentFolder) currentFolder.items.push(proj);
        else state.items.push(proj);
      }
    }
  }

  // Render immediately from cache, then fetch from origin in the background
  // so ahead/behind counts are accurate the first time the user looks.
  renderProjects();
  persist();

  // Cross Sync tab — build its page from the saved links now that projects exist.
  setupCrossSync(config.links || []);
  setupCommitTool(config.commitTool || {});
  setupIdentityTool(config.identityTool || {});

  requestAnimationFrame(() => {
    document.body.classList.remove('app-loading');
  });

  triggerStartupRefresh();
})();
