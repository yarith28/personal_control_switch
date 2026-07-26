const REMOTE_ID_PATTERN = /^[a-z0-9_-]{1,80}$/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRemoteUrlOptions(value) {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set();
  const seenUrls = new Set();
  const options = [];
  for (const entry of value) {
    const id = clean(entry?.id);
    const remoteName = clean(entry?.remoteName);
    const url = clean(entry?.url);
    if (
      !REMOTE_ID_PATTERN.test(id)
      || remoteName.length > 255
      || !url
      || url.length > 4096
      || /\p{Cc}/u.test(remoteName)
      || /\p{Cc}/u.test(url)
      || seenIds.has(id)
      || seenUrls.has(url)
    ) continue;
    seenIds.add(id);
    seenUrls.add(url);
    options.push(remoteName ? { id, remoteName, url } : { id, url });
  }
  return options;
}

export function validateRemoteUrl(value) {
  const url = clean(value);
  if (!url) return { ok: false, error: 'Enter a remote URL or local repository path.' };
  if (url.length > 4096) return { ok: false, error: 'The remote URL is too long.' };
  if (/\p{Cc}/u.test(url)) return { ok: false, error: 'The remote URL contains an invalid character.' };
  return { ok: true, url };
}

export function selectRemoteName(selectedValue, remotes, fallbacks = []) {
  const names = (Array.isArray(remotes) ? remotes : [])
    .map((remote) => clean(remote?.name))
    .filter(Boolean);
  const selected = clean(selectedValue);
  if (names.includes(selected)) return selected;
  for (const fallback of Array.isArray(fallbacks) ? fallbacks : []) {
    const name = clean(fallback);
    if (names.includes(name)) return name;
  }
  if (names.includes('origin')) return 'origin';
  return names[0] || '';
}

export function mergeConfiguredRemoteUrls(optionsValue, remotes, makeId) {
  const options = normalizeRemoteUrlOptions(optionsValue);
  let changed = JSON.stringify(options) !== JSON.stringify(
    Array.isArray(optionsValue) ? optionsValue : []
  );
  for (const remote of Array.isArray(remotes) ? remotes : []) {
    const remoteName = clean(remote?.name);
    const values = [
      ...(Array.isArray(remote?.urls) ? remote.urls : [remote?.url]),
      ...(Array.isArray(remote?.pushUrls) ? remote.pushUrls : [remote?.pushUrl]),
    ];
    for (const value of values) {
      const url = clean(value);
      if (!remoteName || !url || options.some((option) => option.url === url)) continue;
      options.push({ id: makeId(options), remoteName, url });
      changed = true;
    }
  }
  return { options, changed };
}
