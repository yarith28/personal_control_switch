import { getProjects } from './state.js';
import { renderProjects } from './render-list.js';
import { persist } from './persist.js';
import { log } from './log.js';
import {
  selectedGitRemoteTarget,
  selectedRemoteUrlOption,
} from './remote-url-options.mjs';

function reconcileConfiguredRemote(project, result) {
  const selectedRemote = selectedRemoteUrlOption(project);
  if (
    !result.configuredRemote
    || (
      selectedRemote?.remoteName === result.configuredRemote
      && (
        !result.configuredRemoteUrl
        || selectedRemote?.url === result.configuredRemoteUrl
      )
    )
  ) return false;

  const configuredOption = (project.remoteUrls || []).find((option) => (
    option.remoteName === result.configuredRemote
    && option.url === result.configuredRemoteUrl
  )) || (project.remoteUrls || []).find((option) => (
    option.remoteName === result.configuredRemote
  ));
  if (!configuredOption || configuredOption.id === project.selectedRemoteUrlId) return false;
  project.selectedRemoteUrlId = configuredOption.id;
  return true;
}

export async function refreshBranches(project) {
  let res = await window.api.getBranches(project.path, selectedGitRemoteTarget(project));
  if (res.ok && reconcileConfiguredRemote(project, res)) {
    res = await window.api.getBranches(project.path, selectedGitRemoteTarget(project));
  }
  if (res.ok) {
    project.branches    = res.branches;
    project.current     = res.current;
    project.hasUpstream = res.hasUpstream;
    project.upstream    = res.upstream || null;
    project.activeRemote = res.activeRemote || null;
    project.configuredRemote = res.configuredRemote || null;
    project.ahead       = res.ahead;
    project.behind      = res.behind;
    project.uncommitted = res.uncommitted ?? 0;
    project.error       = null;
    project.missing     = false;
  } else {
    project.branches = null;
    project.current = null;
    project.hasUpstream = null;
    project.upstream = null;
    project.uncommitted = 0;
    project.error = res.error;
    project.missing = !!res.missing;
    project.selected = false;
  }
}

let _refreshing = false;
let _lastRefresh = 0;
const REFRESH_DEBOUNCE_MS = 1500;

async function workerPool(items, concurrency, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array(concurrency).fill(0).map(worker));
}

// Re-read git state for every project (branches, current, ahead/behind, uncommitted)
// and repaint. Local only — does NOT contact remote. Auto-refresh callers should
// pass `source` for log visibility; internal callers (post pull/push/commit) leave it default.
export async function refreshAll({ force = false, source = '' } = {}) {
  if (_refreshing) {
    if (source) log(`auto-refresh (${source}): skipped, already refreshing`);
    return;
  }
  const projects = getProjects();
  if (projects.length === 0) {
    if (source) log(`auto-refresh (${source}): no projects`);
    return;
  }
  if (!force && Date.now() - _lastRefresh < REFRESH_DEBOUNCE_MS) return;
  _refreshing = true;
  try {
    if (source) log(`auto-refresh (${source}): re-reading ${projects.length} project(s)...`);
    await workerPool(projects, 4, refreshBranches);
    renderProjects();
    persist();
    if (source) log(`auto-refresh (${source}): done`, true);
  } finally {
    _refreshing = false;
    _lastRefresh = Date.now();
  }
}
