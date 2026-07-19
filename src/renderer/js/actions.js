import { selectAll, pullSelectedBtn, pushSelectedBtn, fetchSelectedBtn, fetchAllBtn, projectsEl } from './dom.js';
import { state, getProjects, removeItem } from './state.js';
import { basename } from './util.js';
import { log, logDetails } from './log.js';
import { showToast } from './notify.js';
import { persist } from './persist.js';
import { refreshAll, refreshBranches } from './branches.js';
import { renderProjects } from './render-list.js';
import { setRowBusy, setRowCancellable, setRowStatus } from './render-row.js';
import { confirmDialog, promptDialog } from './modal.js';

const LONG_RUNNING_WARNING_MS = 8000;
let pushSetupPromptQueue = Promise.resolve();

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

function confirmPushSetup(projectName) {
  const pending = pushSetupPromptQueue.then(() => confirmDialog({
    message: `Set up an upstream branch for "${projectName}"?`,
    detail: 'The current branch has no upstream. This will use its configured push remote (or origin), create the matching remote branch, set it as upstream, and retry the push.',
    confirmText: 'Set up & push',
    danger: false,
  }));
  pushSetupPromptQueue = pending.catch(() => false);
  return pending;
}

export async function pushWithUpstreamPrompt(repoPath) {
  const result = await window.api.push(repoPath);
  if (result?.ok || result?.errorCode !== 'NO_UPSTREAM') return result;

  const projectName = basename(repoPath);
  const confirmed = await confirmPushSetup(projectName);
  if (!confirmed) {
    return {
      ...result,
      cancelled: true,
      errorSummary: 'Push cancelled.',
      errorRaw: '',
    };
  }

  log(`[${projectName}] setting upstream and retrying push...`, true);
  return await window.api.pushSetUpstream(repoPath);
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
  cancellable = false,
}) {
  const projectName = basename(project.path);
  setRowCancellable(project, cancellable);
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
    } else if (res.cancelled) {
      log(`[${projectName}] ${completedActionLabel(startLabel)} cancelled`, true);
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
    setRowCancellable(project, false);
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
    cancellable: true,
  });
}

export async function doPush(project) {
  await runProjectAction(project, {
    actionLabel: 'pushing',
    startLabel: 'Pushing',
    successLabel: 'push complete',
    failureLabel: 'push failed',
    action: pushWithUpstreamPrompt,
    warnLongRunning: true,
    notifyOnFailure: true,
    cancellable: true,
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
    cancellable: true,
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
  const commitInput = await promptDialog({
    message: `Commit ${status.changedCount} change${status.changedCount === 1 ? '' : 's'} in ${basename(project.path)}`,
    detail: 'All staged and unstaged changes will be added (git add -A) and committed.',
    defaultValue: '',
    placeholder: 'Commit message',
    confirmText: 'Commit',
    checkbox: status.hasHead ? {
      label: 'Amend previous commit',
      checked: false,
      inputValue: status.headMessage,
      confirmText: 'Amend',
      detail: 'All staged and unstaged changes will be added to the previous commit. Its commit ID and message will change.',
    } : null,
  });
  if (!commitInput) return;
  const message = commitInput.value;
  const amend = commitInput.checked;

  await runProjectAction(project, {
    actionLabel: `${amend ? 'amending' : 'committing'} "${message}"`,
    startLabel: amend ? 'Amending commit' : 'Committing',
    successLabel: amend ? 'commit amended' : 'commit complete',
    failureLabel: amend ? 'amend failed' : 'commit failed',
    action: (repoPath) => window.api.commitAll(repoPath, message, amend),
  });
}

export async function addProjectPaths(dirs, { notify = false } = {}) {
  if (!Array.isArray(dirs) || dirs.length === 0) return;

  const existing = new Set(getProjects().map((p) => p.path));
  const added = [];
  let duplicateCount = 0;
  let invalidCount = 0;
  let firstInvalidReason = '';

  for (const dir of dirs) {
    if (typeof dir !== 'string' || !dir.trim()) continue;
    if (existing.has(dir)) {
      log(`Already in list: ${dir}`);
      duplicateCount += 1;
      continue;
    }

    const project = { type: 'project', path: dir, pinned: false, selected: false };
    try {
      await refreshBranches(project);
    } catch (error) {
      project.branches = null;
      project.error = error?.message || String(error);
    }
    if (!project.branches) {
      log(`Cannot add ${dir}: ${project.error}`);
      invalidCount += 1;
      if (!firstInvalidReason) firstInvalidReason = project.error || 'Not a Git repository.';
      continue;
    }

    state.items.push(project);
    existing.add(dir);
    added.push(dir);
  }

  if (added.length === 0) {
    if (notify) {
      if (invalidCount > 0) {
        showToast('No projects added', firstInvalidReason, { tone: 'error' });
      } else if (duplicateCount > 0) {
        showToast('Already added', 'The dropped project is already in the list.');
      }
    }
    return;
  }

  await persist();
  renderProjects();
  log(
    added.length === 1
      ? `Added ${added[0]}`
      : `Added ${added.length} projects`
  );

  if (notify) {
    const skipped = duplicateCount + invalidCount;
    showToast(
      added.length === 1 ? `Added ${basename(added[0])}` : `Added ${added.length} projects`,
      skipped > 0 ? `${skipped} dropped item${skipped === 1 ? ' was' : 's were'} skipped.` : ''
    );
  }
}

export async function addProject() {
  const dirs = await window.api.pickFolders();
  await addProjectPaths(dirs);
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
  let cancelCount = 0;

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
      cancellable: ['Fetching', 'Pulling', 'Pushing'].includes(opName),
    };
    if (state.burstMode) {
      const results = await Promise.all(targets.map((p) => runProjectAction(p, projectOpts)));
      for (const res of results) {
        if (res?.ok) okCount += 1;
        else if (res?.cancelled) cancelCount += 1;
        else failCount += 1;
      }
    } else {
      for (const project of targets) {
        const res = await runProjectAction(project, projectOpts);
        if (res?.ok) okCount += 1;
        else if (res?.cancelled) cancelCount += 1;
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
    const body = `${okCount} succeeded, ${failCount} failed${cancelCount ? `, ${cancelCount} cancelled` : ''}.`;
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

export async function pullFolderProjects(folder) {
  const targets = folder.items.filter((p) => p.branches);
  await runBatchOp('Pulling', targets, (repoPath) => window.api.pull(repoPath));
}

export async function pushFolderProjects(folder) {
  const targets = folder.items.filter((p) => p.branches);
  await runBatchOp('Pushing', targets, pushWithUpstreamPrompt);
}

export async function batchOp(opName, opFn) {
  const targets = getProjects().filter((p) => p.selected && p.branches);
  await runBatchOp(opName, targets, opFn);
}
