import { getProjects } from './state.js';
import { renderProjects } from './render-list.js';
import { persist } from './persist.js';

export async function refreshBranches(project) {
  const res = await window.api.getBranches(project.path);
  if (res.ok) {
    project.branches = res.branches;
    project.current  = res.current;
    project.ahead    = res.ahead;
    project.behind   = res.behind;
    project.error    = null;
  } else {
    project.branches = null;
    project.current = null;
    project.error = res.error;
    project.selected = false;
  }
}

let _refreshing = false;
let _lastRefresh = 0;
const REFRESH_DEBOUNCE_MS = 1500;

export async function fetchAndRefreshAll() {
  await refreshAll({ force: true });
}

export async function refreshAll({ force = false } = {}) {
  if (_refreshing) return;
  if (getProjects().length === 0) return;
  if (!force && Date.now() - _lastRefresh < REFRESH_DEBOUNCE_MS) return;
  _refreshing = true;
  try {
    const projects = getProjects();
    const CONCURRENCY = 4;
    let i = 0;
    const worker = async () => {
      while (i < projects.length) {
        await refreshBranches(projects[i++]);
      }
    };
    await Promise.all(Array(CONCURRENCY).fill(0).map(worker));
    renderProjects();
    persist();
  } finally {
    _refreshing = false;
    _lastRefresh = Date.now();
  }
}
