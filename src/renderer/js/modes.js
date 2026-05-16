import { selectAll, multiSelectBtn, organizeBtn, container } from './dom.js';
import { state, getProjects } from './state.js';
import { renderProjects } from './render-list.js';
import { updateBatchButtons } from './actions.js';

export function setMultiSelect(active) {
  if (active) setOrganizeMode(false);
  state.multiSelect = active;
  container.classList.toggle('multi-select', active);
  multiSelectBtn.classList.toggle('active', active);
  if (!active) {
    for (const p of getProjects()) p.selected = false;
    selectAll.checked = false;
    selectAll.indeterminate = false;
    updateBatchButtons();
    renderProjects();
  }
}

export function setOrganizeMode(active) {
  if (active) setMultiSelect(false);
  state.organizeMode = active;
  container.classList.toggle('organize-mode', active);
  organizeBtn.classList.toggle('active', active);
  renderProjects();
}
