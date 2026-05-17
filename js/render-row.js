import { state, findProjectByPath, findFolderById, findLocation, removeItem } from './state.js';
import { basename, displayPath, positionDropdown } from './util.js';
import { log } from './log.js';
import { persist } from './persist.js';
import { refreshBranches } from './branches.js';
import { doPull, doPush, doFetch, removeProject, updateBatchButtons } from './actions.js';
import { renderProjects } from './render-list.js';

export function renderRow(project, parentFolder = null) {
  const row = document.createElement('div');
  row.className = 'project-row';
  row.dataset.path = project.path;

  // drag handle
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;
  handle.addEventListener('mousedown', () => { if (state.organizeMode) row.draggable = true; });
  row.addEventListener('dragend', () => { row.draggable = false; });

  const checkboxLabel = document.createElement('label');
  checkboxLabel.className = 'checkbox-wrap';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'select';
  checkbox.checked = !!project.selected;
  checkbox.disabled = !project.branches;
  checkbox.addEventListener('change', () => {
    project.selected = checkbox.checked;
    updateBatchButtons();
  });
  checkboxLabel.appendChild(checkbox);
  checkboxLabel.insertAdjacentHTML('beforeend',
    `<span class="checkbox-box">
      <svg class="checkbox-check" width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1.5 4L3.5 6.5L8.5 1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="checkbox-dash" width="8" height="2" viewBox="0 0 8 2" fill="none"><line x1="0" y1="1" x2="8" y2="1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </span>`
  );

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = basename(project.path);
  const fullPath = document.createElement('div');
  fullPath.className = 'path';
  fullPath.textContent = '‎' + displayPath(project.path, state.homedir);
  fullPath.title = project.path;
  info.appendChild(name);
  info.appendChild(fullPath);

  // custom branch dropdown (portal)
  const branchText = document.createElement('span');
  branchText.className = 'branch-text';
  branchText.textContent = project.current || project.error || '—';

  const branchDropdown = document.createElement('div');
  branchDropdown.className = 'branch-dropdown';
  document.body.appendChild(branchDropdown);

  const closeDropdown = () => branchDropdown.classList.remove('open');

  if (project.branches) {
    for (const b of project.branches) {
      const opt = document.createElement('div');
      opt.className = 'branch-option' + (b === project.current ? ' active' : '');
      opt.textContent = b;
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeDropdown();
        if (b === project.current) return;
        setRowBusy(row, true);
        log(`[${basename(project.path)}] checking out ${b}...`);
        const res = await window.api.checkout(project.path, b);
        if (res.ok) {
          project.current = b;
          branchText.textContent = b;
          branchDropdown.querySelectorAll('.branch-option').forEach((el) =>
            el.classList.toggle('active', el.textContent === b)
          );
          log(`[${basename(project.path)}] switched to ${b}`, true);
        } else {
          log(`[${basename(project.path)}] checkout failed: ${res.stderr.trim()}`, true);
          await refreshBranches(project);
        }
        setRowBusy(row, false);
      });
      branchDropdown.appendChild(opt);
    }
  }

  const branchWrap = document.createElement('div');
  branchWrap.className = 'branch-wrap' + (!project.branches ? ' disabled' : '');
  branchWrap.title = 'Switch branch';
  branchWrap.insertAdjacentHTML('afterbegin',
    `<svg class="branch-icon" width="12" height="13" viewBox="0 0 12 13" fill="none">
      <circle cx="2.5" cy="2.5" r="1.6" stroke="currentColor" stroke-width="1.15"/>
      <circle cx="9.5" cy="2.5" r="1.6" stroke="currentColor" stroke-width="1.15"/>
      <circle cx="2.5" cy="10.5" r="1.6" stroke="currentColor" stroke-width="1.15"/>
      <path d="M2.5 4.1V8.9" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
      <path d="M9.5 4.1C9.5 6.3 2.5 6.3 2.5 8.9" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
    </svg>`
  );
  branchWrap.appendChild(branchText);
  branchWrap.insertAdjacentHTML('beforeend',
    `<svg class="branch-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  );

  if (project.branches) {
    branchWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = branchDropdown.classList.contains('open');
      document.querySelectorAll('.branch-dropdown.open').forEach((d) => d.classList.remove('open'));
      document.querySelectorAll('.branch-wrap.open').forEach((w) => w.classList.remove('open'));
      if (!isOpen) {
        const rect = branchWrap.getBoundingClientRect();
        branchDropdown.style.minWidth = rect.width + 'px';
        branchDropdown.classList.add('open');
        branchWrap.classList.add('open');
        positionDropdown(branchDropdown, rect);
      }
    });
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';

  const pullBtn = document.createElement('button');
  pullBtn.className = 'btn btn-pull';
  pullBtn.title = 'Pull';
  pullBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M6.5 2V10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M3 6.5L6.5 10L10 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  pullBtn.disabled = !project.branches;
  pullBtn.addEventListener('click', () => doPull(project, row));
  if (project.behind > 0) {
    const badge = document.createElement('span');
    badge.className = 'btn-badge';
    badge.textContent = project.behind;
    pullBtn.appendChild(badge);
  }

  const pushBtn = document.createElement('button');
  pushBtn.className = 'btn btn-push';
  pushBtn.title = 'Push';
  pushBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M6.5 11V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M3 6.5L6.5 3L10 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  pushBtn.disabled = !project.branches;
  pushBtn.addEventListener('click', () => doPush(project, row));
  if (project.ahead > 0) {
    const badge = document.createElement('span');
    badge.className = 'btn-badge';
    badge.textContent = project.ahead;
    pushBtn.appendChild(badge);
  }

  const fetchBtn = document.createElement('button');
  fetchBtn.className = 'btn btn-fetch';
  fetchBtn.title = 'Fetch';
  fetchBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M11 6.5A4.5 4.5 0 1 1 9.7 3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M8.2 3.7L9.7 3.3L10.1 1.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  fetchBtn.disabled = !project.branches;
  fetchBtn.addEventListener('click', () => doFetch(project, row));

  btnRow.appendChild(pullBtn);
  btnRow.appendChild(pushBtn);
  btnRow.appendChild(fetchBtn);

  const termBtn = document.createElement('button');
  termBtn.className = 'btn-terminal';
  termBtn.title = 'Open terminal here';
  termBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1" y="1" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M3.5 5.5L6 7.5L3.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="7.5" y1="9.5" x2="10.5" y2="9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
  termBtn.addEventListener('click', async () => {
    const res = await window.api.openTerminal(project.path);
    if (!res.ok) log(`[${basename(project.path)}] failed to open terminal: ${res.error}`);
  });

  const moveBtn = document.createElement('button');
  moveBtn.className = 'btn-move';
  moveBtn.title = 'Move to folder';
  moveBtn.innerHTML = `<svg width="14" height="13" viewBox="0 0 15 13" fill="none"><path d="M1 2.5C1 1.67 1.67 1 2.5 1H5.5L7 2.5H12.5C13.33 2.5 14 3.17 14 4V10.5C14 11.33 13.33 12 12.5 12H2.5C1.67 12 1 11.33 1 10.5V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

  const moveDropdown = document.createElement('div');
  moveDropdown.className = 'move-dropdown';
  document.body.appendChild(moveDropdown);

  const doMove = async (target) => {
    moveDropdown.classList.remove('open');
    removeItem(project);
    if (target === null) state.items.push(project);
    else target.items.push(project);
    await persist();
    renderProjects();
  };

  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open').forEach((d) => d.classList.remove('open'));
    moveDropdown.innerHTML = '';
    const folders = state.items.filter((i) => i.type === 'folder');
    const options = [];
    if (parentFolder) options.push({ label: '↑ Top level', target: null });
    for (const f of folders) {
      if (parentFolder && f.id === parentFolder.id) continue;
      options.push({ label: f.name, target: f });
    }
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'move-empty';
      empty.textContent = 'No folders available';
      moveDropdown.appendChild(empty);
    } else {
      for (const opt of options) {
        const el = document.createElement('div');
        el.className = 'move-option';
        el.textContent = opt.label;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); doMove(opt.target); });
        moveDropdown.appendChild(el);
      }
    }
    moveDropdown.classList.add('open');
    positionDropdown(moveDropdown, moveBtn.getBoundingClientRect(), { align: 'right' });
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove from list';
  removeBtn.addEventListener('click', () => removeProject(project));

  // drag & drop reorder (organize mode only)
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'PROJECT:' + project.path);
    setTimeout(() => row.classList.add('dragging'), 0);
  });
  row.addEventListener('dragend', () => {
    row.draggable = false;
    row.classList.remove('dragging');
    document.querySelectorAll('.project-row, .group-header').forEach((r) => r.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', (e) => {
    if (!state.organizeMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.project-row, .group-header').forEach((r) => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', (e) => {
    if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over');
  });
  row.addEventListener('drop', async (e) => {
    if (!state.organizeMode) return;
    e.preventDefault();
    row.classList.remove('drag-over');
    const data = e.dataTransfer.getData('text/plain');

    if (data.startsWith('PROJECT:')) {
      const srcPath = data.slice('PROJECT:'.length);
      if (srcPath === project.path) return;
      const src = findProjectByPath(srcPath);
      if (!src) return;
      removeItem(src);
      const targetLoc = findLocation(project);
      if (!targetLoc) state.items.push(src);
      else targetLoc.list.splice(targetLoc.index, 0, src);
      await persist();
      renderProjects();
    } else if (data.startsWith('FOLDER:')) {
      // Folders can only live at top-level; only allow drop on top-level rows
      if (parentFolder) return;
      const srcId = data.slice('FOLDER:'.length);
      const src = findFolderById(srcId);
      if (!src) return;
      removeItem(src);
      const targetIdx = state.items.indexOf(project);
      if (targetIdx === -1) state.items.push(src);
      else state.items.splice(targetIdx, 0, src);
      await persist();
      renderProjects();
    }
  });

  row.appendChild(handle);
  row.appendChild(checkboxLabel);
  row.appendChild(info);
  row.appendChild(branchWrap);
  row.appendChild(btnRow);
  row.appendChild(termBtn);
  row.appendChild(moveBtn);
  row.appendChild(removeBtn);

  return row;
}

export function setRowBusy(row, busy) {
  row.querySelectorAll('button, input').forEach((el) => {
    if (el.classList.contains('remove')) return;
    el.disabled = busy;
  });
  row.querySelector('.branch-wrap')?.classList.toggle('busy', busy);
}
