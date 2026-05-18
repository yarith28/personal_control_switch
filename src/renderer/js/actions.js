import { selectAll, pullSelectedBtn, pushSelectedBtn, fetchSelectedBtn, fetchAllBtn, projectsEl } from './dom.js';
import { state, getProjects, removeItem } from './state.js';
import { basename } from './util.js';
import { log, logDetails } from './log.js';
import { showToast } from './notify.js';
import { persist } from './persist.js';
import { refreshAll, refreshBranches } from './branches.js';
import { renderProjects } from './render-list.js';
import { setRowBusy, setRowStatus } from './render-row.js';
import { confirmDialog, promptDialog } from './modal.js';

const LONG_RUNNING_WARNING_MS = 8000;

function startLongRunningWarning(project, actionLabel) {
  const projectName = basename(project.path);
  return window.setTimeout(() => {
    setRowStatus(project, `Still ${actionLabel}...`, { warning: true });
    log(
      `[${projectName}] still ${actionLabel}... this may be waiting on the network, remote hooks, or authentication.`,
      true
    );
  }, LONG_RUNNING_WARNING_MS);
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

function notificationBody(summary, details = '') {
  if (!details) return summary;
  const firstLine = String(details).split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine || firstLine === summary) return summary;
  return `${summary}\n${firstLine}`;
}

async function notifyUser(title, body = '', { tone = 'default' } = {}) {
  showToast(title, body, { tone });
}

function completedActionLabel(opName) {
  switch (opName) {
    case 'Fetching':
      return 'Fetch';
    case 'Pulling':
      return 'Pull';
    case 'Pushing':
      return 'Push';
    default:
      return opName.replace(/ing$/i, '');
  }
}

async function runProjectAction(project, {
  actionLabel,
  startLabel,
  successLabel,
  failureLabel,
  action,
  refreshAfter = true,
  warnLongRunning = false,
  notifyOnFailure = false,
}) {
  const projectName = basename(project.path);
  setRowBusy(project, true);
  setRowStatus(project, `${startLabel}...`);
  log(`[${projectName}] ${actionLabel}...`);

  const warningTimer = warnLongRunning
    ? startLongRunningWarning(project, actionLabel)
    : null;

  try {
    const res = await action(project.path);
    if (res.ok) {
      const detail = res.liveOutput ? '' : (res.stdout + res.stderr).trim();
      log(`[${projectName}] ${successLabel}${detail ? '\n' + detail : ''}`, true);
    } else {
      logGitFailure(projectName, failureLabel, res);
      if (notifyOnFailure) {
        await notifyUser(
          `${projectName}: ${failureLabel}`,
          notificationBody(res.errorSummary || failureLabel, rawGitOutput(res)),
          { tone: 'error' }
        );
      }
    }
    return res;
  } catch (err) {
    const detail = err?.message || String(err);
    const failure = {
      ok: false,
      stdout: '',
      stderr: detail,
      errorSummary: detail,
      errorRaw: detail,
    };
    logGitFailure(projectName, failureLabel, failure);
    if (notifyOnFailure) {
      await notifyUser(
        `${projectName}: ${failureLabel}`,
        notificationBody(failure.errorSummary || failureLabel, failure.errorRaw),
        { tone: 'error' }
      );
    }
    return failure;
  } finally {
    if (warningTimer) window.clearTimeout(warningTimer);
    setRowBusy(project, false);
    if (refreshAfter) await refreshAll({ force: true });
  }
}

export function updateBatchButtons() {
  const projects = getProjects();
  const anySelected = projects.some((p) => p.selected && p.branches);
  const anyFetchable = projects.some((p) => p.branches);
  pullSelectedBtn.disabled = !anySelected;
  pushSelectedBtn.disabled = !anySelected;
  fetchSelectedBtn.disabled = !anySelected;
  fetchAllBtn.disabled = !anyFetchable;

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
  await runProjectAction(project, {
    actionLabel: 'pulling',
    startLabel: 'Pulling',
    successLabel: 'pull complete',
    failureLabel: 'pull failed',
    action: (repoPath) => window.api.pull(repoPath),
    warnLongRunning: true,
    notifyOnFailure: true,
  });
}

export async function doPush(project) {
  await runProjectAction(project, {
    actionLabel: 'pushing',
    startLabel: 'Pushing',
    successLabel: 'push complete',
    failureLabel: 'push failed',
    action: (repoPath) => window.api.push(repoPath),
    warnLongRunning: true,
    notifyOnFailure: true,
  });
}

export async function doFetch(project) {
  await runProjectAction(project, {
    actionLabel: 'fetching',
    startLabel: 'Fetching',
    successLabel: 'fetch complete',
    failureLabel: 'fetch failed',
    action: (repoPath) => window.api.fetch(repoPath),
    warnLongRunning: true,
  });
}

export async function doQuickCommit(project) {
  // Sniff working-tree changes first so we don't prompt for a message when
  // there's nothing to stage.
  const status = await window.api.gitStatus(project.path);
  if (!status.ok) {
    logGitFailure(basename(project.path), 'status failed', {
      errorSummary: status.error,
      errorRaw: status.rawError || status.error,
    });
    return;
  }
  if (status.changedCount === 0) {
    log(`[${basename(project.path)}] nothing to commit`, true);
    return;
  }
  const message = await promptDialog({
    message: `Commit ${status.changedCount} change${status.changedCount === 1 ? '' : 's'} in ${basename(project.path)}`,
    detail: 'All staged and unstaged changes will be added (git add -A) and committed.',
    defaultValue: '',
    placeholder: 'Commit message',
    confirmText: 'Commit',
  });
  if (!message) return;

  await runProjectAction(project, {
    actionLabel: `committing "${message}"`,
    startLabel: 'Committing',
    successLabel: 'commit complete',
    failureLabel: 'commit failed',
    action: (repoPath) => window.api.commitAll(repoPath, message),
  });
}

export async function addProject() {
  const dirs = await window.api.pickFolders();
  if (!Array.isArray(dirs) || dirs.length === 0) return;

  const existing = new Set(getProjects().map((p) => p.path));
  const added = [];

  for (const dir of dirs) {
    if (existing.has(dir)) {
      log(`Already in list: ${dir}`);
      continue;
    }

    const project = { type: 'project', path: dir, pinned: false, selected: false };
    await refreshBranches(project);
    if (!project.branches) {
      log(`Cannot add ${dir}: ${project.error}`);
      continue;
    }

    state.items.push(project);
    existing.add(dir);
    added.push(dir);
  }

  if (added.length === 0) return;

  await persist();
  renderProjects();
  log(
    added.length === 1
      ? `Added ${added[0]}`
      : `Added ${added.length} projects`
  );
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

async function runBatchOp(opName, targets, opFn) {
  if (targets.length === 0) return;
  log(`${opName} ${targets.length} project(s)...`);
  const baseAction = opName.replace(/ing$/i, '').toLowerCase();
  let okCount = 0;
  let failCount = 0;

  // Mark every queued project so the user can see what is waiting next.
  targets.forEach((p) => {
    setRowBusy(p, true);
    setRowStatus(p, 'Queued...');
  });

  try {
    const projectOpts = {
      actionLabel: opName.toLowerCase(),
      startLabel: opName,
      successLabel: `${baseAction} complete`,
      failureLabel: `${baseAction} failed`,
      action: opFn,
      refreshAfter: false,
      warnLongRunning: ['Fetching', 'Pulling', 'Pushing'].includes(opName),
    };
    if (state.burstMode) {
      const results = await Promise.all(targets.map((p) => runProjectAction(p, projectOpts)));
      for (const res of results) {
        if (res?.ok) okCount += 1;
        else failCount += 1;
      }
    } else {
      for (const project of targets) {
        const res = await runProjectAction(project, projectOpts);
        if (res?.ok) okCount += 1;
        else failCount += 1;
      }
    }
  } finally {
    // Safety net in case anything was still flagged busy on early exit
    targets.forEach((p) => setRowBusy(p, false));
  }
  await refreshAll({ force: true });
  log(`${opName} done.`, true);

  if (failCount > 0) {
    const completed = completedActionLabel(opName);
    const body = `${okCount} succeeded, ${failCount} failed.`;
    await notifyUser(`${completed} finished`, body, {
      tone: 'error',
    });
  }
}

export async function fetchAllProjects() {
  const targets = getProjects().filter((p) => p.branches);
  await runBatchOp('Fetching', targets, (repoPath) => window.api.fetch(repoPath));
}

export async function fetchFolderProjects(folder) {
  const targets = folder.items.filter((p) => p.branches);
  await runBatchOp('Fetching', targets, (repoPath) => window.api.fetch(repoPath));
}

export async function batchOp(opName, opFn) {
  const targets = getProjects().filter((p) => p.selected && p.branches);
  await runBatchOp(opName, targets, opFn);
}
