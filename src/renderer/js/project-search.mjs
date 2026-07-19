function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function projectMatchesQuery(project, query) {
  return normalize(project?.path).includes(query)
    || normalize(project?.current).includes(query);
}

export function searchProjectTree(items, query = '') {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      item,
      children: item.type === 'folder' ? item.items : null,
    }));
  }

  const visible = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item.type === 'project') {
      if (projectMatchesQuery(item, normalizedQuery)) visible.push({ item, children: null });
      continue;
    }
    if (item.type !== 'folder') continue;

    const folderMatches = normalize(item.name).includes(normalizedQuery);
    const children = folderMatches
      ? item.items
      : item.items.filter((project) => projectMatchesQuery(project, normalizedQuery));
    if (children.length > 0 || (folderMatches && item.items.length === 0)) {
      visible.push({ item, children });
    }
  }
  return visible;
}
