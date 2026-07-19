import { projectsEl, collapseBtn, filterSummary } from './dom.js';
import { state, pinnedFirst, getProjects } from './state.js';
import { searchProjectTree } from './project-search.mjs';
import { renderRow } from './render-row.js';
import { renderFolderHeader } from './render-folder.js';
import { updateBatchButtons } from './actions.js';

export function renderProjects() {
  document.querySelectorAll('.branch-dropdown[data-picker-scope="git"], .move-dropdown:not([data-menu-scope]), .move-dropdown[data-menu-scope="git"], .color-palette-dropdown').forEach((d) => d.remove());
  projectsEl.innerHTML = '';

  const allProjectCount = getProjects().length;
  if (state.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="empty-title">Nothing here yet</div><div class="empty-sub">Hit "+ Add project" to get started</div>';
    projectsEl.appendChild(empty);
    if (filterSummary) filterSummary.textContent = '';
    updateBatchButtons();
    return;
  }

  const visibleTree = searchProjectTree(state.items, state.searchQuery);
  const visibleProjectCount = visibleTree.reduce((count, entry) => (
    count + (entry.item.type === 'folder' ? entry.children.length : 1)
  ), 0);
  if (filterSummary) {
    filterSummary.textContent = state.searchQuery
      ? `${visibleProjectCount} of ${allProjectCount} project${allProjectCount === 1 ? '' : 's'}`
      : `${allProjectCount} project${allProjectCount === 1 ? '' : 's'}`;
  }
  if (visibleTree.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="empty-title">No matching projects</div><div class="empty-sub">Try a different search.</div>';
    projectsEl.appendChild(empty);
    updateBatchButtons();
    syncCollapseBtn();
    return;
  }

  const visibleByItem = new Map(visibleTree.map((entry) => [entry.item, entry]));
  const sortedTop = pinnedFirst(visibleTree.map((entry) => entry.item));
  let hadPinned = false;
  let dividerAdded = false;
  for (const item of sortedTop) {
    if (item.pinned) {
      hadPinned = true;
    } else if (hadPinned && !dividerAdded) {
      const divider = document.createElement('div');
      divider.className = 'pinned-divider';
      projectsEl.appendChild(divider);
      dividerAdded = true;
    }
    if (item.type === 'folder') {
      const visibleEntry = visibleByItem.get(item);
      projectsEl.appendChild(renderFolderHeader(item));
      const hideChildren = item.collapsed && !state.searchQuery;
      for (const child of pinnedFirst(visibleEntry.children)) {
        const rowEl = renderRow(child, item);
        rowEl.classList.add('group-member');
        if (item.color) rowEl.style.setProperty('--folder-color', item.color);
        if (hideChildren) rowEl.hidden = true;
        projectsEl.appendChild(rowEl);
      }
    } else if (item.type === 'project') {
      projectsEl.appendChild(renderRow(item, null));
    }
  }

  updateBatchButtons();
  syncCollapseBtn();
}

export function syncCollapseBtn() {
  const folders = state.items.filter((i) => i.type === 'folder');
  const allCollapsed = folders.length > 0 && folders.every((f) => f.collapsed);
  collapseBtn.disabled = folders.length === 0;
  collapseBtn.classList.toggle('all-collapsed', allCollapsed);
  collapseBtn.title = allCollapsed ? 'Expand all folders' : 'Collapse all folders';
  collapseBtn.setAttribute('aria-label', collapseBtn.title);
}
