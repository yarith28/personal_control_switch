import { projectsEl } from './dom.js';
import { state } from './state.js';
import { renderRow } from './render-row.js';
import { renderFolderHeader } from './render-folder.js';
import { updateBatchButtons } from './actions.js';

export function renderProjects() {
  document.querySelectorAll('.branch-dropdown').forEach((d) => d.remove());
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
        if (hideChildren) rowEl.hidden = true;
        projectsEl.appendChild(rowEl);
      }
    } else if (item.type === 'project') {
      projectsEl.appendChild(renderRow(item, null));
    }
  }

  updateBatchButtons();
}
