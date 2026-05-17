import { projectsEl, collapseBtn } from './dom.js';
import { state } from './state.js';
import { renderRow } from './render-row.js';
import { renderFolderHeader } from './render-folder.js';
import { updateBatchButtons } from './actions.js';

export function renderProjects() {
  document.querySelectorAll('.branch-dropdown, .move-dropdown, .color-palette-dropdown').forEach((d) => d.remove());
  projectsEl.innerHTML = '';

  if (state.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="empty-title">Nothing here yet</div><div class="empty-sub">Hit "+ Add project" to get started</div>';
    projectsEl.appendChild(empty);
    updateBatchButtons();
    return;
  }

  for (const item of state.items) {
    if (item.type === 'folder') {
      projectsEl.appendChild(renderFolderHeader(item));
      const hideChildren = item.collapsed && !state.organizeMode;
      for (const child of item.items) {
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
}
