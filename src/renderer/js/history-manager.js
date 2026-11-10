import { state } from './state.js';
import { basename } from './util.js';
import { iconElement } from './icons.js';
import { openHistoryPreview, releaseHistoryPreview } from './history-preview.js';
import { historyManagerGroups, trimHistoryViews } from './history-manager-model.mjs';

let managerSequence = 0;
let lastSelectedPath = '';

function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function tab(label, icon, className) {
  const button = element('button', `git-manager-tab ${className}`);
  button.type = 'button';
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;
  const text = element('span', 'git-manager-tab-label');
  text.textContent = label;
  button.append(iconElement(icon, { size: 13 }), text);
  return button;
}

function revealTab(button, row) {
  const tabRect = button.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (tabRect.left < rowRect.left) row.scrollLeft += tabRect.left - rowRect.left;
  else if (tabRect.right > rowRect.right) row.scrollLeft += tabRect.right - rowRect.right;
}

function setupTabKeys(row) {
  row.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...row.querySelectorAll('[role="tab"]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click();
    buttons[next].focus({ preventScroll: true });
    revealTab(buttons[next], row);
  });
}

export function openHistoryManager(trigger) {
  const groups = historyManagerGroups(state.items);
  if (!groups.length) return null;
  const id = `git-manager-${++managerSequence}`;
  const navigation = element('nav', 'git-manager-navigation');
  navigation.setAttribute('aria-label', 'Repository navigation');
  const folderTabs = element('div', 'git-manager-tab-row git-manager-folder-tabs');
  folderTabs.setAttribute('role', 'tablist');
  folderTabs.setAttribute('aria-label', 'Repository folders');
  const repoPanel = element('div', 'git-manager-repositories');
  repoPanel.id = `${id}-repositories`;
  repoPanel.setAttribute('role', 'tabpanel');
  const repoTabs = element('div', 'git-manager-tab-row git-manager-repo-tabs');
  repoTabs.setAttribute('role', 'tablist');
  repoTabs.setAttribute('aria-label', 'Repositories in selected folder');
  repoPanel.appendChild(repoTabs);
  navigation.append(folderTabs, repoPanel);
  setupTabKeys(folderTabs);
  setupTabKeys(repoTabs);

  const views = new Map();
  const savedStates = new Map();
  const folderButtons = new Map();
  const rememberedRepos = new Map();
  const repoScrollPositions = new Map();
  let activeGroup = null;
  let activeView = null;
  let activePath = null;
  let overlay = null;
  let closed = false;

  const syncTabControls = (busy) => {
    navigation.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
  };
  const close = () => {
    if (closed) return true;
    if ([...views.values()].some((view) => view.isBusy())) return false;
    closed = true;
    releaseHistoryPreview(close);
    for (const view of views.values()) view.close({ restoreFocus: false, keepWindow: true });
    views.clear();
    savedStates.clear();
    folderButtons.clear();
    rememberedRepos.clear();
    repoScrollPositions.clear();
    activeView = null;
    activePath = null;
    activeGroup = null;
    navigation.replaceChildren();
    navigation.remove();
    overlay?.removeEventListener('click', onOverlayClick);
    overlay?.remove();
    overlay = null;
    if (trigger?.isConnected) trigger.focus();
    return true;
  };
  const onOverlayClick = (event) => { if (event.target === overlay) close(); };

  function selectRepository(group, project) {
    if (closed || activeView?.isBusy()) return false;
    const folderScrollLeft = folderTabs.scrollLeft;
    if (activeGroup) repoScrollPositions.set(activeGroup.id, repoTabs.scrollLeft);
    const repoScrollLeft = repoScrollPositions.get(group.id) || 0;
    let next = views.get(project.path);
    if (next !== activeView) {
      if (activeView && activePath) savedStates.set(activePath, activeView.getState());
      activeView?.setActive(false);
      if (!next) {
        next = openHistoryPreview(project, trigger, {
          container: overlay,
          navigation,
          onRequestClose: close,
          onBusyChange: syncTabControls,
          autofocus: false,
          initialState: savedStates.get(project.path),
        });
        if (!next) return false;
        views.set(project.path, next);
        savedStates.delete(project.path);
        if (!overlay) {
          overlay = next.overlay;
          overlay.addEventListener('click', onOverlayClick);
        }
        overlay.classList.add('git-manager-overlay');
      }
      activeView = next;
      activePath = project.path;
      activeView.setActive(true);
    }
    views.delete(project.path);
    views.set(project.path, next);
    if (activeGroup !== group) {
      repoTabs.replaceChildren();
      for (const [index, repo] of group.projects.entries()) {
        const button = tab(basename(repo.path), 'gitBranchPlus', 'git-manager-repo-tab');
        button.id = `${id}-repo-${groups.indexOf(group)}-${index}`;
        button.dataset.path = repo.path;
        button.title = repo.path;
        button.addEventListener('click', () => selectRepository(group, repo));
        repoTabs.appendChild(button);
      }
      activeGroup = group;
    }
    rememberedRepos.set(group.id, project.path);
    lastSelectedPath = project.path;
    for (const [key, button] of folderButtons) {
      const selected = key === group.id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const button of repoTabs.children) {
      const selected = button.dataset.path === project.path;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) {
        button.setAttribute('aria-controls', activeView.element.id);
        activeView.element.setAttribute('aria-labelledby', button.id);
        button.focus({ preventScroll: true });
      }
    }
    folderTabs.scrollLeft = folderScrollLeft;
    repoTabs.scrollLeft = repoScrollLeft;
    repoPanel.setAttribute('aria-labelledby', folderButtons.get(group.id).id);
    trimHistoryViews(views, savedStates, project.path);
    return true;
  }

  for (const [index, group] of groups.entries()) {
    const button = tab(group.name, 'folder', 'git-manager-folder-tab');
    button.id = `${id}-folder-${index}`;
    button.dataset.group = group.id;
    button.title = group.name;
    button.setAttribute('aria-controls', repoPanel.id);
    if (group.color) button.querySelector('svg').style.color = group.color;
    button.addEventListener('click', () => {
      const project = group.projects.find((repo) => repo.path === rememberedRepos.get(group.id)) || group.projects[0];
      if (selectRepository(group, project)) button.focus({ preventScroll: true });
    });
    folderButtons.set(group.id, button);
    folderTabs.appendChild(button);
  }
  const group = groups.find((entry) => entry.projects.some((repo) => repo.path === lastSelectedPath)) || groups[0];
  const project = group.projects.find((repo) => repo.path === lastSelectedPath) || group.projects[0];
  if (!selectRepository(group, project)) return null;
  revealTab(folderButtons.get(group.id), folderTabs);
  revealTab(repoTabs.querySelector('[aria-selected="true"]'), repoTabs);
  return { close, element: overlay };
}
