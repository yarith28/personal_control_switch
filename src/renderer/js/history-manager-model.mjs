export function historyManagerGroups(items = []) {
  const groups = [];
  const ungrouped = { id: 'ungrouped', name: 'Ungrouped', projects: [] };
  const isProject = (item) => item?.type === 'project' && typeof item.path === 'string' && item.path.trim();
  for (const [index, item] of items.entries()) {
    if (isProject(item)) {
      if (!ungrouped.projects.length) groups.push(ungrouped);
      ungrouped.projects.push(item);
    } else if (item?.type === 'folder') {
      const projects = (item.items || []).filter(isProject);
      if (projects.length) groups.push({
        id: `folder:${item.id || index}`,
        name: item.name || 'Folder',
        color: item.color || null,
        projects,
      });
    }
  }
  return groups;
}

export const MAX_CACHED_HISTORY_VIEWS = 3;

export function trimHistoryViews(views, savedStates, activePath, limit = MAX_CACHED_HISTORY_VIEWS) {
  for (const [path, view] of views) {
    if (views.size <= limit) break;
    if (path === activePath || view.isBusy()) continue;
    if (!savedStates.has(path)) savedStates.set(path, view.getState());
    view.close({ restoreFocus: false, keepWindow: true });
    views.delete(path);
  }
}
