// Nested tree: top-level items are { type:'project', ... } or { type:'folder', id, name, collapsed, items:[projects] }
export const state = {
  items: [],
  multiSelect: false,
  organizeMode: false,
  currentTheme: null,
  homedir: null,
};

// ── Tree helpers ─────────────────────────────────────────────────────────────

export function getProjects() {
  const out = [];
  for (const item of state.items) {
    if (item.type === 'project') out.push(item);
    else if (item.type === 'folder') {
      for (const child of item.items) if (child.type === 'project') out.push(child);
    }
  }
  return out;
}

export function findProjectByPath(path) {
  for (const item of state.items) {
    if (item.type === 'project' && item.path === path) return item;
    if (item.type === 'folder') {
      const f = item.items.find((p) => p.type === 'project' && p.path === path);
      if (f) return f;
    }
  }
  return null;
}

export function findFolderById(id) {
  return state.items.find((i) => i.type === 'folder' && i.id === id) || null;
}

// Returns { list, index } where the item lives, or null if not found
export function findLocation(target) {
  for (let i = 0; i < state.items.length; i++) {
    if (state.items[i] === target) return { list: state.items, index: i };
    if (state.items[i].type === 'folder') {
      const list = state.items[i].items;
      for (let j = 0; j < list.length; j++) {
        if (list[j] === target) return { list, index: j };
      }
    }
  }
  return null;
}

export function removeItem(target) {
  const loc = findLocation(target);
  if (!loc) return null;
  return loc.list.splice(loc.index, 1)[0];
}
