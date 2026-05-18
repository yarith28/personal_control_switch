import { state, findFolderById, findProjectByPath, findLocation, removeItem } from './state.js';
import { projectsEl } from './dom.js';
import { persist } from './persist.js';
import { renderProjects, syncCollapseBtn } from './render-list.js';
import { fetchFolderProjects, updateBatchButtons } from './actions.js';
import { checkboxIconMarkup, dragHandleIconMarkup, iconHtml } from './icons.js';
import { confirmDialog } from './modal.js';
import { positionDropdown } from './util.js';

export async function addFolder() {
  const id = 'f' + Date.now();
  state.items.unshift({ type: 'folder', id, name: 'New Folder', pinned: false, collapsed: false, items: [] });
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
  if (folder.color) el.style.setProperty('--folder-color', folder.color);
  el.draggable = state.organizeMode;

  // drag handle (visual affordance only — drag works from anywhere on the folder header in organize mode)
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = dragHandleIconMarkup();

  // batch-select checkbox (visible only in multi-select mode)
  const checkboxLabel = document.createElement('label');
  checkboxLabel.className = 'checkbox-wrap';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'select';
  checkboxLabel.appendChild(checkbox);
  checkboxLabel.insertAdjacentHTML('beforeend',
    `<span class="checkbox-box">${checkboxIconMarkup()}</span>`
  );
  const selectable = folder.items.filter((p) => p.branches);
  checkbox.disabled = selectable.length === 0;
  checkbox.checked = selectable.length > 0 && selectable.every((p) => p.selected);
  checkbox.indeterminate = !checkbox.checked && selectable.some((p) => p.selected);
  checkboxLabel.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', () => {
    const checked = checkbox.checked;
    for (const p of folder.items) {
      if (p.branches) p.selected = checked;
    }
    let sib = el.nextElementSibling;
    while (sib && sib.classList.contains('group-member')) {
      const child = folder.items.find((p) => p.path === sib.dataset.path);
      if (child) {
        const cb = sib.querySelector('.select');
        if (cb && !cb.disabled) cb.checked = child.selected;
      }
      sib = sib.nextElementSibling;
    }
    updateBatchButtons();
  });

  // folder icon
  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.innerHTML = iconHtml('folder', { size: 15, strokeWidth: 1.8, attrs: { fill: 'currentColor' } });

  const chevron = document.createElement('span');
  chevron.className = 'group-chevron';
  chevron.textContent = '›';

  const nameEl = document.createElement('span');
  nameEl.className = 'group-name';
  nameEl.textContent = folder.name;
  nameEl.addEventListener('dblclick', (e) => {
    if (!state.organizeMode) return;
    e.stopPropagation();
    startRename(nameEl);
  });

  const fetchableCount = folder.items.filter((p) => p.branches).length;

  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-toggle' + (folder.pinned ? ' active' : '');
  pinBtn.title = folder.pinned ? 'Unpin folder' : 'Pin folder to top';
  pinBtn.setAttribute('aria-pressed', String(!!folder.pinned));
  pinBtn.innerHTML = iconHtml('pin', { size: 11, strokeWidth: 1.8 });
  pinBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    folder.pinned = !folder.pinned;
    await persist();
    renderProjects();
  });

  // folder fetch action
  const fetchBtn = document.createElement('button');
  fetchBtn.className = 'folder-fetch-btn';
  fetchBtn.innerHTML = iconHtml('arrowDownUp', { size: 11, strokeWidth: 1.8 });
  fetchBtn.title = fetchableCount > 0
    ? `Fetch all ${fetchableCount} project${fetchableCount === 1 ? '' : 's'} in this folder`
    : 'No fetchable projects in this folder';
  fetchBtn.disabled = fetchableCount === 0;
  fetchBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (fetchBtn.disabled) return;
    fetchBtn.disabled = true;
    try {
      await fetchFolderProjects(folder);
    } finally {
      fetchBtn.disabled = false;
    }
  });

  // color marker (edit mode only)
  const colorBtn = document.createElement('button');
  colorBtn.className = 'folder-color-btn';
  colorBtn.title = 'Folder color';
  if (folder.color) colorBtn.style.backgroundColor = folder.color;
  else colorBtn.classList.add('no-color');

  const colorPalette = document.createElement('div');
  colorPalette.className = 'color-palette-dropdown';
  document.body.appendChild(colorPalette);

  const FOLDER_COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
    '#f43f5e', '#78716c',
  ];

  const setColor = async (color) => {
    colorPalette.classList.remove('open');
    folder.color = color;
    await persist();
    renderProjects();
  };

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open, .color-palette-dropdown.open')
      .forEach((d) => d.classList.remove('open'));
    colorPalette.innerHTML = '';
    const none = document.createElement('div');
    none.className = 'color-option color-option-none';
    none.title = 'No color';
    none.addEventListener('click', (ev) => { ev.stopPropagation(); setColor(null); });
    colorPalette.appendChild(none);
    for (const c of FOLDER_COLORS) {
      const opt = document.createElement('div');
      opt.className = 'color-option';
      opt.style.backgroundColor = c;
      if (folder.color === c) opt.classList.add('active');
      opt.addEventListener('click', (ev) => { ev.stopPropagation(); setColor(c); });
      colorPalette.appendChild(opt);
    }
    colorPalette.classList.add('open');
    positionDropdown(colorPalette, colorBtn.getBoundingClientRect(), { align: 'right' });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'group-delete';
  deleteBtn.title = 'Remove folder (projects move to top level)';
  deleteBtn.innerHTML = '×';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const n = folder.items.length;
    const confirmed = await confirmDialog({
      message: `Remove folder "${folder.name}"?`,
      detail: n === 0
        ? 'This folder is empty.'
        : `${n} project${n === 1 ? '' : 's'} will move to the top level.`,
    });
    if (!confirmed) return;
    // Promote children to top-level at the folder's position
    const idx = state.items.indexOf(folder);
    if (idx !== -1) state.items.splice(idx, 1, ...folder.items);
    await persist();
    renderProjects();
  });

  el.appendChild(handle);
  el.appendChild(checkboxLabel);
  el.appendChild(chevron);
  el.appendChild(icon);
  el.appendChild(nameEl);
  if (state.organizeMode) {
    el.appendChild(pinBtn);
  } else if (folder.pinned) {
    pinBtn.classList.add('static');
    pinBtn.classList.remove('active');
    el.appendChild(pinBtn);
  }
  el.appendChild(fetchBtn);
  el.appendChild(colorBtn);
  el.appendChild(deleteBtn);

  // collapse toggle (normal mode only) — update in-place so the chevron transition fires
  el.addEventListener('click', async (e) => {
    if (state.organizeMode) return;
    if (nameEl.contentEditable === 'true') return;
    if (e.target === deleteBtn) return;
    if (e.target.closest('.pin-toggle')) return;
    if (e.target.closest('.folder-fetch-btn')) return;
    folder.collapsed = !folder.collapsed;
    el.classList.toggle('collapsed', folder.collapsed);
    let sibling = el.nextElementSibling;
    while (sibling && sibling.classList.contains('group-member')) {
      sibling.hidden = folder.collapsed;
      sibling = sibling.nextElementSibling;
    }
    syncCollapseBtn();
    await persist();
  });

  // ── Folder drag-and-drop ─────────────────────────────────────────────────
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'FOLDER:' + folder.id);
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', () => {
    el.draggable = state.organizeMode;
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
