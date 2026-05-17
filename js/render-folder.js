import { state, findFolderById, findProjectByPath, findLocation, removeItem } from './state.js';
import { projectsEl } from './dom.js';
import { persist } from './persist.js';
import { renderProjects } from './render-list.js';

export async function addFolder() {
  const id = 'f' + Date.now();
  state.items.unshift({ type: 'folder', id, name: 'New Folder', collapsed: false, items: [] });
  await persist();
  renderProjects();
  const nameEl = projectsEl.querySelector(`.group-header[data-id="${id}"] .group-name`);
  if (nameEl) startRename(nameEl);
}

export function startRename(nameEl) {
  nameEl.dataset.original = nameEl.textContent;
  nameEl.contentEditable = 'true';
  nameEl.focus();
  // select all text
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async () => {
    nameEl.contentEditable = 'false';
    const folderId = nameEl.closest('.group-header').dataset.id;
    const folder = findFolderById(folderId);
    if (folder) {
      folder.name = nameEl.textContent.trim() || 'New Folder';
      nameEl.textContent = folder.name;
      await persist();
    }
  };
  nameEl.addEventListener('blur', finish, { once: true });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') {
      nameEl.textContent = nameEl.dataset.original || 'New Folder';
      nameEl.removeEventListener('blur', finish);
      nameEl.contentEditable = 'false';
    }
  });
}

export function renderFolderHeader(folder) {
  const el = document.createElement('div');
  el.className = 'group-header' + (folder.collapsed && !state.organizeMode ? ' collapsed' : '');
  el.dataset.id = folder.id;

  // drag handle
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;
  handle.addEventListener('mousedown', () => { if (state.organizeMode) el.draggable = true; });

  // folder icon
  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.innerHTML = `<svg width="15" height="13" viewBox="0 0 15 13" fill="none"><path d="M1 2.5C1 1.67157 1.67157 1 2.5 1H5.5L7 2.5H12.5C13.3284 2.5 14 3.17157 14 4V10.5C14 11.3284 13.3284 12 12.5 12H2.5C1.67157 12 1 11.3284 1 10.5V2.5Z" stroke="currentColor" stroke-width="1.2" fill="currentColor" fill-opacity="0.15" stroke-linejoin="round"/></svg>`;

  const chevron = document.createElement('span');
  chevron.className = 'group-chevron';
  chevron.textContent = '›';

  const nameEl = document.createElement('span');
  nameEl.className = 'group-name';
  nameEl.textContent = folder.name;
  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename(nameEl);
  });

  // item count
  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = folder.items.length > 0 ? folder.items.length : '';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'group-delete';
  deleteBtn.title = 'Remove folder (projects move to top level)';
  deleteBtn.innerHTML = '×';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    // Promote children to top-level at the folder's position
    const idx = state.items.indexOf(folder);
    if (idx !== -1) state.items.splice(idx, 1, ...folder.items);
    await persist();
    renderProjects();
  });

  el.appendChild(handle);
  el.appendChild(chevron);
  el.appendChild(icon);
  el.appendChild(nameEl);
  el.appendChild(count);
  el.appendChild(deleteBtn);

  // collapse toggle (normal mode only) — update in-place so the chevron transition fires
  el.addEventListener('click', async (e) => {
    if (state.organizeMode) return;
    if (nameEl.contentEditable === 'true') return;
    if (e.target === deleteBtn) return;
    folder.collapsed = !folder.collapsed;
    el.classList.toggle('collapsed', folder.collapsed);
    let sibling = el.nextElementSibling;
    while (sibling && sibling.classList.contains('group-member')) {
      sibling.hidden = folder.collapsed;
      sibling = sibling.nextElementSibling;
    }
    await persist();
  });

  // ── Folder drag-and-drop ─────────────────────────────────────────────────
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'FOLDER:' + folder.id);
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false;
    el.classList.remove('dragging');
    document.querySelectorAll('.project-row, .group-header').forEach((r) => r.classList.remove('drag-over'));
  });
  el.addEventListener('dragover', (e) => {
    if (!state.organizeMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.project-row, .group-header').forEach((r) => r.classList.remove('drag-over'));
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', async (e) => {
    if (!state.organizeMode) return;
    e.preventDefault();
    el.classList.remove('drag-over');
    const data = e.dataTransfer.getData('text/plain');

    if (data.startsWith('PROJECT:')) {
      // Drop project INTO folder (append to its items)
      const srcPath = data.slice('PROJECT:'.length);
      const src = findProjectByPath(srcPath);
      if (!src) return;
      removeItem(src);
      folder.items.push(src);
      // Auto-expand the folder so the user sees the project landed
      folder.collapsed = false;
      await persist();
      renderProjects();
    } else if (data.startsWith('FOLDER:')) {
      // Reorder folders at top level: insert source folder before this folder
      const srcId = data.slice('FOLDER:'.length);
      if (srcId === folder.id) return;
      const src = findFolderById(srcId);
      if (!src) return;
      removeItem(src);
      const targetIdx = state.items.indexOf(folder);
      if (targetIdx === -1) state.items.push(src);
      else state.items.splice(targetIdx, 0, src);
      await persist();
      renderProjects();
    }
  });

  return el;
}
