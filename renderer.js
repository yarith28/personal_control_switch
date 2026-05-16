const THEMES = [
  {
    id: 'aurora', label: 'Aurora', swatch: '#c4b5fd',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #fce7f3 0%, #ede9fe 50%, #dbeafe 100%)',
      '--blob1': '#f9a8d4', '--blob2': '#c4b5fd', '--blob3': '#93c5fd',
      '--title-gradient': 'linear-gradient(135deg, #a855f7, #ec4899, #f59e0b)',
      '--text-primary': '#1e1b4b', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
      '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
      '--glass-shadow': 'rgba(0,0,0,0.07)', '--surface': 'rgba(255,255,255,0.6)',
      '--branch-bg': 'rgba(168,85,247,0.12)', '--branch-color': '#7c3aed',
      '--output-bg': 'rgba(20,16,56,0.78)', '--output-text': '#f3e8ff',
      '--output-placeholder': '#a78bfa',
    },
  },
  {
    id: 'midnight', label: 'Midnight', swatch: '#4f46e5',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      '--blob1': '#312e81', '--blob2': '#1e3a5f', '--blob3': '#4c1d95',
      '--title-gradient': 'linear-gradient(135deg, #818cf8, #a78bfa, #c4b5fd)',
      '--text-primary': '#e2e8f0', '--text-muted': '#94a3b8', '--text-faint': '#64748b',
      '--glass-bg': 'rgba(255,255,255,0.08)', '--glass-bg-hover': 'rgba(255,255,255,0.14)',
      '--glass-border': 'rgba(255,255,255,0.15)', '--glass-highlight': 'rgba(255,255,255,0.14)',
      '--glass-shadow': 'rgba(0,0,0,0.4)', '--surface': 'rgba(255,255,255,0.09)',
      '--branch-bg': 'rgba(129,140,248,0.15)', '--branch-color': '#818cf8',
      '--output-bg': 'rgba(0,0,0,0.55)', '--output-text': '#c7d2fe',
      '--output-placeholder': '#6366f1',
    },
  },
  {
    id: 'forest', label: 'Forest', swatch: '#10b981',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 40%, #bfdbfe 100%)',
      '--blob1': '#6ee7b7', '--blob2': '#34d399', '--blob3': '#93c5fd',
      '--title-gradient': 'linear-gradient(135deg, #059669, #0d9488, #06b6d4)',
      '--text-primary': '#064e3b', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.55)', '--glass-bg-hover': 'rgba(255,255,255,0.7)',
      '--glass-border': 'rgba(255,255,255,0.7)', '--glass-highlight': 'rgba(255,255,255,0.8)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.6)',
      '--branch-bg': 'rgba(16,185,129,0.12)', '--branch-color': '#059669',
      '--output-bg': 'rgba(4,50,38,0.8)', '--output-text': '#d1fae5',
      '--output-placeholder': '#34d399',
    },
  },
  {
    id: 'sunset', label: 'Sunset', swatch: '#f97316',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 40%, #fecdd3 100%)',
      '--blob1': '#fdba74', '--blob2': '#fb923c', '--blob3': '#fda4af',
      '--title-gradient': 'linear-gradient(135deg, #f97316, #ef4444, #ec4899)',
      '--text-primary': '#431407', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.58)', '--glass-bg-hover': 'rgba(255,255,255,0.72)',
      '--glass-border': 'rgba(255,255,255,0.72)', '--glass-highlight': 'rgba(255,255,255,0.82)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.62)',
      '--branch-bg': 'rgba(249,115,22,0.12)', '--branch-color': '#ea580c',
      '--output-bg': 'rgba(50,15,5,0.8)', '--output-text': '#ffedd5',
      '--output-placeholder': '#fb923c',
    },
  },
  {
    id: 'ocean', label: 'Ocean', swatch: '#0ea5e9',
    vars: {
      '--bg-gradient': 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 40%, #a5f3fc 100%)',
      '--blob1': '#7dd3fc', '--blob2': '#38bdf8', '--blob3': '#67e8f9',
      '--title-gradient': 'linear-gradient(135deg, #0ea5e9, #06b6d4, #10b981)',
      '--text-primary': '#0c4a6e', '--text-muted': '#6b7280', '--text-faint': '#9ca3af',
      '--glass-bg': 'rgba(255,255,255,0.58)', '--glass-bg-hover': 'rgba(255,255,255,0.72)',
      '--glass-border': 'rgba(255,255,255,0.72)', '--glass-highlight': 'rgba(255,255,255,0.82)',
      '--glass-shadow': 'rgba(0,0,0,0.06)', '--surface': 'rgba(255,255,255,0.62)',
      '--branch-bg': 'rgba(14,165,233,0.12)', '--branch-color': '#0284c7',
      '--output-bg': 'rgba(8,50,75,0.8)', '--output-text': '#e0f2fe',
      '--output-placeholder': '#38bdf8',
    },
  },
];

let currentTheme = THEMES[0];

function applyTheme(theme) {
  const root = document.documentElement;
  for (const [p, v] of Object.entries(theme.vars)) root.style.setProperty(p, v);
  currentTheme = theme;
  document.querySelectorAll('.swatch').forEach((el) =>
    el.classList.toggle('active', el.dataset.id === theme.id)
  );
}

function buildSwatches() {
  const container = document.getElementById('theme-swatches');
  container.innerHTML = '';
  for (const theme of THEMES) {
    const dot = document.createElement('button');
    dot.className = 'swatch' + (theme.id === currentTheme.id ? ' active' : '');
    dot.style.background = theme.swatch;
    dot.dataset.id = theme.id;
    dot.title = theme.label;
    dot.addEventListener('click', async (e) => {
      e.stopPropagation();
      applyTheme(theme);
      await persist();
    });
    container.appendChild(dot);
  }
}

const addBtn = document.getElementById('add-project');
const selectAll = document.getElementById('select-all');
const pullSelectedBtn = document.getElementById('pull-selected');
const pushSelectedBtn = document.getElementById('push-selected');
const projectsEl = document.getElementById('projects');
const output = document.getElementById('output');

const state = {
  projects: [],
};

function log(text, append = false) {
  if (append) {
    output.textContent = (output.textContent ? output.textContent + '\n' : '') + text;
    output.scrollTop = output.scrollHeight;
  } else {
    output.textContent = text;
  }
}

function basename(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

async function persist() {
  await window.api.saveConfig({
    theme: currentTheme.id,
    projects: state.projects.map((p) => ({ path: p.path })),
  });
}

function updateBatchButtons() {
  const anySelected = state.projects.some((p) => p.selected && p.branches);
  pullSelectedBtn.disabled = !anySelected;
  pushSelectedBtn.disabled = !anySelected;

  const selectable = state.projects.filter((p) => p.branches);
  selectAll.checked =
    selectable.length > 0 && selectable.every((p) => p.selected);
  selectAll.indeterminate =
    !selectAll.checked && selectable.some((p) => p.selected);
}

function renderRow(project) {
  const row = document.createElement('div');
  row.className = 'project-row';
  row.dataset.path = project.path;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'select';
  checkbox.checked = !!project.selected;
  checkbox.disabled = !project.branches;
  checkbox.addEventListener('change', () => {
    project.selected = checkbox.checked;
    updateBatchButtons();
  });

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = basename(project.path);
  const fullPath = document.createElement('div');
  fullPath.className = 'path';
  fullPath.textContent = project.path;
  fullPath.title = project.path;
  info.appendChild(name);
  info.appendChild(fullPath);

  const branchSelect = document.createElement('select');
  branchSelect.className = 'branch';
  branchSelect.title = 'Switch branch';
  if (project.branches) {
    branchSelect.innerHTML = project.branches
      .map(
        (b) =>
          `<option value="${b}"${b === project.current ? ' selected' : ''}>${b}</option>`
      )
      .join('');
  } else {
    branchSelect.innerHTML = `<option>${project.error || '—'}</option>`;
    branchSelect.disabled = true;
  }
  branchSelect.addEventListener('change', async () => {
    const branch = branchSelect.value;
    setRowBusy(row, true);
    log(`[${basename(project.path)}] checking out ${branch}...`);
    const res = await window.api.checkout(project.path, branch);
    if (res.ok) {
      project.current = branch;
      log(`[${basename(project.path)}] switched to ${branch}`, true);
    } else {
      log(`[${basename(project.path)}] checkout failed: ${res.stderr.trim()}`, true);
      await refreshBranches(project);
    }
    setRowBusy(row, false);
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';

  const pullBtn = document.createElement('button');
  pullBtn.className = 'btn btn-pull';
  pullBtn.textContent = 'Pull';
  pullBtn.disabled = !project.branches;
  pullBtn.addEventListener('click', () => doPull(project, row));

  const pushBtn = document.createElement('button');
  pushBtn.className = 'btn btn-push';
  pushBtn.textContent = 'Push';
  pushBtn.disabled = !project.branches;
  pushBtn.addEventListener('click', () => doPush(project, row));

  btnRow.appendChild(pullBtn);
  btnRow.appendChild(pushBtn);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove from list';
  removeBtn.addEventListener('click', () => removeProject(project));

  row.appendChild(checkbox);
  row.appendChild(info);
  row.appendChild(branchSelect);
  row.appendChild(btnRow);
  row.appendChild(removeBtn);

  return row;
}

function setRowBusy(row, busy) {
  row.querySelectorAll('button, select, input').forEach((el) => {
    if (el.classList.contains('remove')) return;
    el.disabled = busy;
  });
}

function renderProjects() {
  projectsEl.innerHTML = '';
  if (state.projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No projects yet — click "Add project" to begin.';
    projectsEl.appendChild(empty);
    updateBatchButtons();
    return;
  }
  for (const project of state.projects) {
    projectsEl.appendChild(renderRow(project));
  }
  updateBatchButtons();
}

async function refreshBranches(project) {
  const res = await window.api.getBranches(project.path);
  if (res.ok) {
    project.branches = res.branches;
    project.current = res.current;
    project.error = null;
  } else {
    project.branches = null;
    project.current = null;
    project.error = res.error;
    project.selected = false;
  }
}

async function doPull(project, row) {
  setRowBusy(row, true);
  log(`[${basename(project.path)}] pulling...`);
  const res = await window.api.pull(project.path);
  const tag = res.ok ? 'pull complete' : 'pull failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(row, false);
}

async function doPush(project, row) {
  setRowBusy(row, true);
  log(`[${basename(project.path)}] pushing...`);
  const res = await window.api.push(project.path);
  const tag = res.ok ? 'push complete' : 'push failed';
  const detail = (res.stdout + res.stderr).trim();
  log(`[${basename(project.path)}] ${tag}${detail ? '\n' + detail : ''}`, true);
  setRowBusy(row, false);
}

async function addProject() {
  const dir = await window.api.pickFolder();
  if (!dir) return;
  if (state.projects.some((p) => p.path === dir)) {
    log(`Already in list: ${dir}`);
    return;
  }
  const project = { path: dir, selected: false };
  await refreshBranches(project);
  if (!project.branches) {
    log(`Cannot add ${dir}: ${project.error}`);
    return;
  }
  state.projects.push(project);
  await persist();
  renderProjects();
  log(`Added ${dir}`);
}

async function removeProject(project) {
  state.projects = state.projects.filter((p) => p !== project);
  await persist();
  renderProjects();
  log(`Removed ${project.path}`);
}

async function batchOp(opName, opFn) {
  const targets = state.projects.filter((p) => p.selected && p.branches);
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
  log(`${opName} done.`, true);
}

addBtn.addEventListener('click', addProject);
pullSelectedBtn.addEventListener('click', () =>
  batchOp('Pulling', (p) => window.api.pull(p))
);
pushSelectedBtn.addEventListener('click', () =>
  batchOp('Pushing', (p) => window.api.push(p))
);
selectAll.addEventListener('change', () => {
  const checked = selectAll.checked;
  for (const p of state.projects) {
    if (p.branches) p.selected = checked;
  }
  renderProjects();
});

(async function init() {
  const platform = await window.api.getPlatform();
  document.body.classList.add('platform-' + platform);

  document
    .getElementById('win-min')
    ?.addEventListener('click', () => window.api.windowMinimize());
  document
    .getElementById('win-max')
    ?.addEventListener('click', () => window.api.windowMaximize());
  document
    .getElementById('win-close')
    ?.addEventListener('click', () => window.api.windowClose());

  const outputWrap = document.getElementById('output-wrap');
  document.getElementById('output-toggle')?.addEventListener('click', () => {
    outputWrap.classList.toggle('collapsed');
  });

  const themeSwatches = document.getElementById('theme-swatches');
  document.getElementById('theme-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    themeSwatches.classList.toggle('open');
  });
  document.addEventListener('click', () => themeSwatches.classList.remove('open'));

  const config = await window.api.loadConfig();

  currentTheme = THEMES.find((t) => t.id === config.theme) || THEMES[0];
  applyTheme(currentTheme);
  buildSwatches();

  for (const entry of config.projects) {
    const project = { path: entry.path, selected: false };
    await refreshBranches(project);
    state.projects.push(project);
  }
  renderProjects();
})();
