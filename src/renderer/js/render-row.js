import { state, findProjectByPath, findFolderById, findLocation, removeItem } from './state.js';
import { projectsEl } from './dom.js';
import { basename, displayPath, positionDropdown, withButtonLoading } from './util.js';
import { log, logDetails } from './log.js';
import { persist } from './persist.js';
import { refreshBranches } from './branches.js';
import { doPull, doPush, doQuickCommit, removeProject, updateBatchButtons } from './actions.js';
import { checkboxIconMarkup, dragHandleIconMarkup, iconHtml } from './icons.js';
import { renderProjects } from './render-list.js';

function openTargetsForPlatform() {
  const isMac = document.body.classList.contains('platform-darwin');
  const isWindows = document.body.classList.contains('platform-win32');

  return [
    { id: 'terminal', label: 'Terminal' },
    { id: 'vscode', label: 'VS Code' },
    { id: 'sourcetree', label: 'SourceTree' },
    { id: 'antigravity', label: 'Antigravity' },
    { id: 'finder', label: isMac ? 'Finder' : (isWindows ? 'Explorer' : 'Folder') },
  ];
}

function rawGitOutput(result) {
  return String(
    result?.errorRaw
    || [result?.stderr || '', result?.stdout || ''].filter(Boolean).join('\n')
  ).trim();
}

function logGitFailure(projectName, failureLabel, result) {
  const summary = result?.errorSummary
    ? `[${projectName}] ${failureLabel}: ${result.errorSummary}`
    : `[${projectName}] ${failureLabel}`;
  const details = rawGitOutput(result);

  if (!details) {
    log(summary, true);
    return;
  }

  logDetails(summary, details, {
    append: true,
    detailsLabel: 'Show raw Git output',
  });
}

export function renderRow(project, parentFolder = null) {
  const row = document.createElement('div');
  row.className = 'project-row';
  row.dataset.path = project.path;
  row.draggable = state.organizeMode;

  // drag handle (visual affordance only — drag works from anywhere on the row in organize mode)
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = dragHandleIconMarkup();

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
    `<span class="checkbox-box">${checkboxIconMarkup()}</span>`
  );

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  const nameInner = document.createElement('div');
  nameInner.className = 'name-inner';
  const nameText = document.createElement('span');
  nameText.className = 'name-text';
  nameText.textContent = basename(project.path);
  nameText.title = 'Open with...';
  const nameBranch = document.createElement('span');
  nameBranch.className = 'name-branch';
  nameBranch.textContent = project.current || '';
  nameInner.appendChild(nameText);
  nameInner.appendChild(nameBranch);
  name.appendChild(nameInner);

  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-toggle' + (project.pinned ? ' active' : '');
  pinBtn.title = project.pinned ? 'Unpin project' : 'Pin project to top';
  pinBtn.setAttribute('aria-pressed', String(!!project.pinned));
  pinBtn.innerHTML = iconHtml('pin', { size: 11, strokeWidth: 1.8 });
  pinBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    project.pinned = !project.pinned;
    await persist();
    renderProjects();
  });
  if (state.organizeMode) {
    name.appendChild(pinBtn);
  } else if (project.pinned) {
    pinBtn.classList.add('static');
    pinBtn.classList.remove('active');
    name.appendChild(pinBtn);
  }

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

  const openDropdown = document.createElement('div');
  openDropdown.className = 'move-dropdown';
  document.body.appendChild(openDropdown);

  const closeOpenDropdown = () => openDropdown.classList.remove('open');

  nameText.addEventListener('click', (e) => {
    if (state.organizeMode || state.multiSelect) return;
    if (row.classList.contains('busy')) return;

    e.stopPropagation();
    const isOpen = openDropdown.classList.contains('open');
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open').forEach((d) => d.classList.remove('open'));
    if (isOpen) return;

    openDropdown.innerHTML = '';
    for (const target of openTargetsForPlatform()) {
      const option = document.createElement('div');
      option.className = 'move-option';
      option.textContent = target.label;
      option.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        closeOpenDropdown();
        const res = await window.api.openWith(project.path, target.id);
        if (!res.ok) {
          log(`[${basename(project.path)}] failed to open in ${target.label}: ${res.error}`, true);
        }
      });
      openDropdown.appendChild(option);
    }

    openDropdown.classList.add('open');
    positionDropdown(openDropdown, nameText.getBoundingClientRect());
  });

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
        setRowStatus(project, `Switching to ${b}...`);
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
          logGitFailure(basename(project.path), 'checkout failed', res);
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
  pullBtn.innerHTML = iconHtml('arrowDown', { size: 11, strokeWidth: 1.85 });
  pullBtn.disabled = !project.branches;
  pullBtn.addEventListener('click', () => withButtonLoading(pullBtn, () => doPull(project)));
  if (project.behind > 0) {
    const badge = document.createElement('span');
    badge.className = 'btn-badge';
    badge.textContent = project.behind;
    pullBtn.appendChild(badge);
  }

  const pushBtn = document.createElement('button');
  pushBtn.className = 'btn btn-push';
  pushBtn.title = 'Push';
  pushBtn.innerHTML = iconHtml('arrowUp', { size: 11, strokeWidth: 1.85 });
  pushBtn.disabled = !project.branches;
  pushBtn.addEventListener('click', () => withButtonLoading(pushBtn, () => doPush(project)));
  if (project.ahead > 0) {
    const badge = document.createElement('span');
    badge.className = 'btn-badge';
    badge.textContent = project.ahead;
    pushBtn.appendChild(badge);
  }

  const commitBtn = document.createElement('button');
  commitBtn.className = 'btn btn-commit';
  commitBtn.title = 'Quick commit';
  commitBtn.innerHTML = iconHtml('gitCommitVertical', { size: 11, strokeWidth: 1.8 });
  commitBtn.disabled = !project.branches || !project.uncommitted;
  commitBtn.addEventListener('click', () => doQuickCommit(project));

  btnRow.appendChild(pullBtn);
  btnRow.appendChild(pushBtn);
  btnRow.appendChild(commitBtn);

const moveBtn = document.createElement('button');
  moveBtn.className = 'btn-move';
  moveBtn.title = 'Move to folder';
  moveBtn.innerHTML = iconHtml('folderInput', { size: 11, strokeWidth: 1.8 });

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
    row.draggable = state.organizeMode;
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
  if (!busy) {
    project.statusText = '';
    project.statusWarning = false;
  }
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

export function setRowStatus(project, text = '', { warning = false } = {}) {
  if (!project) return;
  project.statusText = text;
  project.statusWarning = warning;
}
