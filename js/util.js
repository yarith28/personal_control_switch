export function basename(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function displayPath(p, homedir) {
  if (!homedir || !p) return p;
  const sep = homedir.includes('\\') ? '\\' : '/';
  const pl = p.toLowerCase();
  const hl = homedir.toLowerCase();
  if (pl === hl) return '~';
  if (pl.startsWith(hl + sep)) return '~' + p.slice(homedir.length);
  return p;
}
