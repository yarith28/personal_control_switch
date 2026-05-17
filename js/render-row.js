import { state, findProjectByPath, findFolderById, findLocation, removeItem } from './state.js';
import { projectsEl } from './dom.js';
import { basename, displayPath, positionDropdown } from './util.js';
import { log } from './log.js';
import { persist } from './persist.js';
import { refreshBranches } from './branches.js';
import { doPull, doPush, doQuickCommit, removeProject, updateBatchButtons } from './actions.js';
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
  const nameText = document.createElement('span');
  nameText.className = 'name-text';
  nameText.textContent = basename(project.path);
  nameText.title = 'Open terminal here';
  nameText.addEventListener('click', async (e) => {
    if (state.organizeMode || state.multiSelect) return;
    if (row.classList.contains('busy')) return;
    e.stopPropagation();
    const res = await window.api.openTerminal(project.path);
    if (!res.ok) log(`[${basename(project.path)}] failed to open terminal: ${res.error}`);
  });
  const nameBranch = document.createElement('span');
  nameBranch.className = 'name-branch';
  nameBranch.textContent = project.current || '';
  name.appendChild(nameText);
  name.appendChild(nameBranch);
  const fullPath = document.createElement('div');
  fullPath.className = 'path';
  fullPath.textContent = '‎' + displayPath(project.path, state.homedir);
  fullPath.title = project.path;
  info.appendChild(name);
  info.appendChild(fullPath);

  // branch dropdown (portal) — opens from the inline name-branch chip
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
        setRowBusy(project, true);
        log(`[${basename(project.path)}] checking out ${b}...`);
        const res = await window.api.checkout(project.path, b);
        if (res.ok) {
          project.current = b;
          nameBranch.textContent = b;
          branchDropdown.querySelectorAll('.branch-option').forEach((el) =>
            el.classList.toggle('active', el.textContent === b)
          );
          log(`[${basename(project.path)}] switched to ${b}`, true);
        } else {
          log(`[${basename(project.path)}] checkout failed: ${res.stderr.trim()}`, true);
          await refreshBranches(project);
        }
        setRowBusy(project, false);
      });
      branchDropdown.appendChild(opt);
    }
    nameBranch.classList.add('clickable');
    nameBranch.title = 'Switch branch';
    nameBranch.addEventListener('click', (e) => {
      e.stopPropagation();
      if (row.classList.contains('busy')) return;
      const isOpen = branchDropdown.classList.contains('open');
      document.querySelectorAll('.branch-dropdown.open').forEach((d) => d.classList.remove('open'));
      if (!isOpen) {
        branchDropdown.classList.add('open');
        positionDropdown(branchDropdown, nameBranch.getBoundingClientRect());
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
  pullBtn.addEventListener('click', () => doPull(project));
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
  pushBtn.addEventListener('click', () => doPush(project));
  if (project.ahead > 0) {
    const badge = document.createElement('span');
    badge.className = 'btn-badge';
    badge.textContent = project.ahead;
    pushBtn.appendChild(badge);
  }

  const commitBtn = document.createElement('button');
  commitBtn.className = 'btn btn-commit';
  commitBtn.title = 'Quick commit';
  commitBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <line x1="6.5" y1="1" x2="6.5" y2="4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <line x1="6.5" y1="8.8" x2="6.5" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="6.5" cy="6.5" r="2.3" stroke="currentColor" stroke-width="1.4" fill="none"/>
  </svg>`;
  commitBtn.disabled = !project.branches || !project.uncommitted;
  commitBtn.addEventListener('click', () => doQuickCommit(project));

  btnRow.appendChild(pullBtn);
  btnRow.appendChild(pushBtn);
  btnRow.appendChild(commitBtn);

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
  row.appendChild(btnRow);
  row.appendChild(moveBtn);
  row.appendChild(removeBtn);

  // If an action was already running when this row was (re-)rendered,
  // restore the busy visual + disable state.
  if (project.busy) {
    row.classList.add('busy');
    row.querySelectorAll('button, input').forEach((el) => {
      if (!el.classList.contains('remove')) el.disabled = true;
    });
  }

  return row;
}

// Always look up the current row by project path so we operate on whatever
// node is actually attached to the DOM right now — re-renders during long
// operations would otherwise leave stale refs pointing at detached nodes.
export function setRowBusy(project, busy) {
  if (!project) return;
  project.busy = busy;
  const row = projectsEl.querySelector(
    `.project-row[data-path="${CSS.escape(project.path)}"]`
  );
  if (!row) return;
  row.classList.toggle('busy', busy);
  row.querySelectorAll('button, input').forEach((el) => {
    if (el.classList.contains('remove')) return;
    el.disabled = busy;
  });
}
