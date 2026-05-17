import { selectAll, pullSelectedBtn, pushSelectedBtn, projectsEl } from './dom.js';
import { state, getProjects, removeItem } from './state.js';
import { basename } from './util.js';
import { log } from './log.js';
import { persist } from './persist.js';
import { refreshAll, refreshBranches } from './branches.js';
import { renderProjects } from './render-list.js';
import { setRowBusy } from './render-row.js';
import { confirmDialog } from './modal.js';

export function updateBatchButtons() {
  const projects = getProjects();
  const anySelected = projects.some((p) => p.selected && p.branches);
  pullSelectedBtn.disabled = !anySelected;
  pushSelectedBtn.disabled = !anySelected;

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

export async function doPull(project, row) {
  setRowBusy(row, true);
  log(`[${basename(project.path)}] pulling...`);
  const res = await window.api.pull(project.path);
  const tag = res.ok ? 'pull complete' : 'pull failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(row, false);
  await refreshAll({ force: true });
}

export async function doPush(project, row) {
  setRowBusy(row, true);
  log(`[${basename(project.path)}] pushing...`);
  const res = await window.api.push(project.path);
  const tag = res.ok ? 'push complete' : 'push failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(row, false);
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
  for (const project of targets) {
    const row = projectsEl.querySelector(
      `.project-row[data-path="${CSS.escape(project.path)}"]`
    );
    if (row) setRowBusy(row, true);
    log(`[${basename(project.path)}] ${opName.toLowerCase()}...`, true);
    const res = await opFn(project.path);
    const tag = res.ok ? 'ok' : 'failed';
    const detail = (res.stdout + res.stderr).trim();
    log(`[${basename(project.path)}] ${tag}${detail ? ': ' + detail.split('\n')[0] : ''}`, true);
    if (row) setRowBusy(row, false);
  }
  await refreshAll({ force: true });
  log(`${opName} done.`, true);
}
