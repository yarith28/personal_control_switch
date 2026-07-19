import { state, findProjectByPath, findFolderById, findLocation, removeItem } from './state.js';
import { projectsEl } from './dom.js';
import { basename, displayPath, positionDropdown, withButtonLoading } from './util.js';
import { log, logDetails } from './log.js';
import { persist } from './persist.js';
import { refreshBranches } from './branches.js';
import { doPull, doPush, doFetch, doQuickCommit, removeProject, updateBatchButtons } from './actions.js';
import { checkboxIconMarkup, dragHandleIconMarkup, iconHtml } from './icons.js';
import { renderProjects } from './render-list.js';
import { createBranchPicker } from './branch-picker.js';
import { createProjectOpenMenu } from './project-open-menu.js';
import { showToast } from './notify.js';

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
  row.className = 'project-row' + (project.missing ? ' missing' : '');
  row.dataset.path = project.path;
  row.title = project.missing ? project.path + ' — folder not found' : project.path;
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
  checkbox.setAttribute('aria-label', `Select ${basename(project.path)} for batch operations`);
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
  const nameText = document.createElement('button');
  nameText.type = 'button';
  nameText.className = 'name-text';
  nameText.textContent = basename(project.path);
  nameText.setAttribute('aria-label', `Open ${basename(project.path)} with another application`);
  createProjectOpenMenu({
    trigger: nameText,
    projectPath: project.path,
    scope: 'git',
    disabled: () => state.organizeMode || state.multiSelect || row.classList.contains('busy'),
  });
  let branchPicker;
  branchPicker = createBranchPicker({
    scope: 'git',
    title: 'Switch branch',
    emptyText: '',
    onSelect: async (branch) => {
      if (row.classList.contains('busy')) return false;
      setRowBusy(project, true);
      setRowStatus(project, `Switching to ${branch}...`);
      log(`[${basename(project.path)}] checking out ${branch}...`);
      try {
        const res = await window.api.checkout(project.path, branch);
        if (res.ok) {
          project.current = branch;
          log(`[${basename(project.path)}] switched to ${branch}`, true);
          return true;
        }

        logGitFailure(basename(project.path), 'checkout failed', res);
        await refreshBranches(project);
        branchPicker.setBranches(project.branches || [], project.current, project.current);
        return false;
      } finally {
        setRowBusy(project, false);
      }
    },
    onCreate: async (branch) => {
      if (row.classList.contains('busy')) return false;
      setRowBusy(project, true);
      setRowStatus(project, `Creating ${branch}...`);
      log(`[${basename(project.path)}] creating branch ${branch}...`);
      try {
        const res = await window.api.createBranch(project.path, branch);
        if (!res.ok) {
          logGitFailure(basename(project.path), 'branch creation failed', res);
          showToast(
            'Could not create branch',
            res.errorSummary || 'Git could not create that branch.',
            { tone: 'warning' }
          );
          return false;
        }

        await refreshBranches(project);
        branchPicker.setBranches(project.branches || [], project.current, project.current);
        log(`[${basename(project.path)}] created and switched to ${branch}`, true);
        showToast('Branch created', branch);
        return true;
      } finally {
        setRowBusy(project, false);
      }
    },
  });
  const nameBranch = branchPicker.el;
  branchPicker.setBranches(project.branches || [], project.current, project.current);
  nameInner.appendChild(nameText);
  nameInner.appendChild(nameBranch);
  name.appendChild(nameInner);

  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-toggle' + (project.pinned ? ' active' : '');
  pinBtn.type = 'button';
  pinBtn.title = project.pinned ? 'Unpin project' : 'Pin project to top';
  pinBtn.setAttribute('aria-pressed', String(!!project.pinned));
  pinBtn.setAttribute('aria-label', pinBtn.title);
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

  const fetchBtn = document.createElement('button');
  fetchBtn.className = 'fetch-btn';
  fetchBtn.type = 'button';
  fetchBtn.title = 'Fetch';
  fetchBtn.setAttribute('aria-label', `Fetch ${basename(project.path)}`);
  fetchBtn.innerHTML = iconHtml('arrowDownUp', { size: 11, strokeWidth: 1.8 });
  fetchBtn.disabled = !project.branches;
  fetchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (fetchBtn.disabled) return;
    withButtonLoading(fetchBtn, () => doFetch(project));
  });
  name.appendChild(fetchBtn);

  const fullPath = document.createElement('div');
  fullPath.className = 'path';
  fullPath.textContent = '‎' + displayPath(project.path, state.homedir);
  fullPath.title = project.path;
  const operationStatus = document.createElement('div');
  operationStatus.className = 'operation-status';
  operationStatus.textContent = project.statusText || '';
  operationStatus.hidden = !project.statusText;
  operationStatus.classList.toggle('warning', !!project.statusWarning);
  info.appendChild(name);
  info.appendChild(fullPath);
  info.appendChild(operationStatus);

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';

  const pullBtn = document.createElement('button');
  pullBtn.className = 'btn btn-pull';
  pullBtn.type = 'button';
  pullBtn.title = 'Pull';
  pullBtn.setAttribute('aria-label', `Pull ${basename(project.path)}`);
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
  pushBtn.type = 'button';
  pushBtn.title = 'Push';
  pushBtn.setAttribute('aria-label', `Push ${basename(project.path)}`);
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
  commitBtn.type = 'button';
  commitBtn.title = 'Quick commit';
  commitBtn.setAttribute('aria-label', `Quick commit ${basename(project.path)}`);
  commitBtn.innerHTML = iconHtml('gitCommitVertical', { size: 11, strokeWidth: 1.8 });
  commitBtn.disabled = !project.branches || !project.uncommitted;
  commitBtn.addEventListener('click', () => doQuickCommit(project));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-cancel';
  cancelBtn.type = 'button';
  cancelBtn.title = 'Cancel Git operation';
  cancelBtn.setAttribute('aria-label', `Cancel Git operation for ${basename(project.path)}`);
  cancelBtn.innerHTML = iconHtml('x', { size: 11, strokeWidth: 2 });
  cancelBtn.hidden = !project.cancellable;
  cancelBtn.addEventListener('click', async () => {
    if (!project.cancellable || project.cancelling) return;
    project.cancelling = true;
    cancelBtn.disabled = true;
    setRowStatus(project, 'Cancelling...');
    const result = await window.api.cancelGit(project.path);
    if (!result?.cancelled) {
      project.cancelling = false;
      cancelBtn.disabled = false;
      setRowStatus(project, 'Waiting for Git to stop...', { warning: true });
    }
  });

  btnRow.appendChild(pullBtn);
  btnRow.appendChild(pushBtn);
  btnRow.appendChild(commitBtn);
  btnRow.appendChild(cancelBtn);

const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'btn-move';
  moveBtn.title = 'Move to folder';
  moveBtn.setAttribute('aria-label', `Move ${basename(project.path)} to a folder`);
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
        const el = document.createElement('button');
        el.type = 'button';
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
  removeBtn.type = 'button';
  removeBtn.className = 'remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove from list';
  removeBtn.setAttribute('aria-label', `Remove ${basename(project.path)} from the list`);
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
      if (el.classList.contains('remove')) return;
      if (el.classList.contains('btn-cancel') && project.cancellable) return;
      el.disabled = true;
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
    project.cancelling = false;
  }
  const row = projectsEl.querySelector(
    `.project-row[data-path="${CSS.escape(project.path)}"]`
  );
  if (!row) return;
  row.classList.toggle('busy', busy);
  row.querySelectorAll('button, input').forEach((el) => {
    if (el.classList.contains('remove')) return;
    if (el.classList.contains('btn-cancel') && busy && project.cancellable) {
      el.disabled = false;
      return;
    }
    el.disabled = busy;
  });
  if (!busy) {
    const status = row.querySelector('.operation-status');
    if (status) {
      status.textContent = '';
      status.hidden = true;
      status.classList.remove('warning');
    }
  }
}

export function setRowCancellable(project, cancellable) {
  if (!project) return;
  project.cancellable = cancellable;
  if (!cancellable) project.cancelling = false;
  const row = projectsEl.querySelector(
    `.project-row[data-path="${CSS.escape(project.path)}"]`
  );
  const cancelBtn = row?.querySelector('.btn-cancel');
  if (!cancelBtn) return;
  cancelBtn.hidden = !cancellable;
  cancelBtn.disabled = !cancellable;
}

export function setRowStatus(project, text = '', { warning = false } = {}) {
  if (!project) return;
  project.statusText = text;
  project.statusWarning = warning;
  const row = projectsEl.querySelector(
    `.project-row[data-path="${CSS.escape(project.path)}"]`
  );
  const status = row?.querySelector('.operation-status');
  if (!status) return;
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('warning', warning);
}
