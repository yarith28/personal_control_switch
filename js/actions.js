import { selectAll, pullSelectedBtn, pushSelectedBtn, fetchSelectedBtn, projectsEl } from './dom.js';
import { state, getProjects, removeItem } from './state.js';
import { basename } from './util.js';
import { log } from './log.js';
import { persist } from './persist.js';
import { refreshAll, refreshBranches } from './branches.js';
import { renderProjects } from './render-list.js';
import { setRowBusy } from './render-row.js';
import { confirmDialog, promptDialog } from './modal.js';

export function updateBatchButtons() {
  const projects = getProjects();
  const anySelected = projects.some((p) => p.selected && p.branches);
  pullSelectedBtn.disabled = !anySelected;
  pushSelectedBtn.disabled = !anySelected;
  fetchSelectedBtn.disabled = !anySelected;

  const selectable = projects.filter((p) => p.branches);
  selectAll.checked =
    selectable.length > 0 && selectable.every((p) => p.selected);
  selectAll.indeterminate =
    !selectAll.checked && selectable.some((p) => p.selected);

  // sync per-folder checkboxes
  for (const item of state.items) {
    if (item.type !== 'folder') continue;
    const header = projectsEl.querySelector(`.group-header[data-id="${item.id}"]`);
    if (!header) continue;
    const cb = header.querySelector('.select');
    if (!cb) continue;
    const sel = item.items.filter((p) => p.branches);
    cb.disabled = sel.length === 0;
    cb.checked = sel.length > 0 && sel.every((p) => p.selected);
    cb.indeterminate = !cb.checked && sel.some((p) => p.selected);
  }
}

export async function doPull(project) {
  setRowBusy(project, true);
  log(`[${basename(project.path)}] pulling...`);
  const res = await window.api.pull(project.path);
  const tag = res.ok ? 'pull complete' : 'pull failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(project, false);
  await refreshAll({ force: true });
}

export async function doPush(project) {
  setRowBusy(project, true);
  log(`[${basename(project.path)}] pushing...`);
  const res = await window.api.push(project.path);
  const tag = res.ok ? 'push complete' : 'push failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(project, false);
  await refreshAll({ force: true });
}

export async function doQuickCommit(project) {
  // Sniff working-tree changes first so we don't prompt for a message when
  // there's nothing to stage.
  const status = await window.api.gitStatus(project.path);
  if (!status.ok) {
    log(`[${basename(project.path)}] status failed: ${status.error}`, true);
    return;
  }
  if (status.changedCount === 0) {
    log(`[${basename(project.path)}] nothing to commit`, true);
    return;
  }
  const message = await promptDialog({
    message: `Commit ${status.changedCount} change${status.changedCount === 1 ? '' : 's'} in ${basename(project.path)}`,
    detail: 'All staged and unstaged changes will be added (git add -A) and committed.',
    defaultValue: 'WIP',
    placeholder: 'Commit message',
    confirmText: 'Commit',
  });
  if (!message) return;

  setRowBusy(project, true);
  log(`[${basename(project.path)}] committing "${message}"...`);
  const res = await window.api.commitAll(project.path, message);
  const tag = res.ok ? 'commit complete' : 'commit failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(project, false);
  await refreshAll({ force: true });
}

export async function addProject() {
  const dir = await window.api.pickFolder();
  if (!dir) return;
  if (getProjects().some((p) => p.path === dir)) {
    log(`Already in list: ${dir}`);
    return;
  }
  const project = { type: 'project', path: dir, selected: false };
  await refreshBranches(project);
  if (!project.branches) {
    log(`Cannot add ${dir}: ${project.error}`);
    return;
  }
  state.items.push(project);
  await persist();
  renderProjects();
  log(`Added ${dir}`);
}

export async function removeProject(project) {
  const name = basename(project.path);
  const confirmed = await confirmDialog({
    message: `Remove "${name}"?`,
    detail: 'This removes it from the list. Your files are not deleted.',
  });
  if (!confirmed) return;
  removeItem(project);
  await persist();
  renderProjects();
  log(`Removed ${project.path}`);
}

export async function batchOp(opName, opFn) {
  const targets = getProjects().filter((p) => p.selected && p.branches);
  if (targets.length === 0) return;
  log(`${opName} ${targets.length} project(s)...`);

  // Mark every queued project busy up front so the user can see what's pending.
  targets.forEach((p) => setRowBusy(p, true));

  try {
    for (const project of targets) {
      log(`[${basename(project.path)}] ${opName.toLowerCase()}...`, true);
      const res = await opFn(project.path);
      const tag = res.ok ? 'ok' : 'failed';
      const detail = (res.stdout + res.stderr).trim();
      log(`[${basename(project.path)}] ${tag}${detail ? ': ' + detail.split('\n')[0] : ''}`, true);
      setRowBusy(project, false);
    }
  } finally {
    // Safety net in case anything was still flagged busy on early exit
    targets.forEach((p) => setRowBusy(p, false));
  }
  await refreshAll({ force: true });
  log(`${opName} done.`, true);
}
