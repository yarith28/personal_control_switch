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
    const profileNameValue = clean(entry?.profileName || entry?.remoteName);
    const profileName = validateProfileName(profileNameValue).ok ? profileNameValue : '';
    const url = clean(entry?.url);
    if (
      !REMOTE_ID_PATTERN.test(id)
      || !url
      || url.length > 4096
      || /\p{Cc}/u.test(url)
      || seenIds.has(id)
      || seenUrls.has(url)
    ) continue;
    seenIds.add(id);
    seenUrls.add(url);
    options.push(profileName ? { id, profileName, url } : { id, url });
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

export function validateProfileName(value) {
  const profileName = clean(value);
  if (!profileName) return { ok: false, error: 'Enter a profile name.' };
  if (profileName.length > 64) return { ok: false, error: 'The profile name is too long.' };
  if (/\p{Cc}/u.test(profileName)) {
    return { ok: false, error: 'The profile name contains an invalid character.' };
  }
  return { ok: true, profileName };
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

export function applyGitRemoteUrlChange(remotesValue, result) {
  const remotes = Array.isArray(remotesValue) ? [...remotesValue] : [];
  const remote = result?.remote;
  const remoteName = clean(remote?.name);
  if (!remoteName) return remotes;

  const index = remotes.findIndex((entry) => clean(entry?.name) === remoteName);
  if (index === -1) remotes.push(remote);
  else remotes[index] = remote;
  remotes.sort((a, b) => clean(a?.name).localeCompare(clean(b?.name)));
  return remotes;
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
      if (!remoteName || !url) continue;
      const existing = options.find((option) => option.url === url);
      if (existing) {
        if (!existing.profileName) {
          existing.profileName = remoteName;
          changed = true;
        }
        continue;
      }
      options.push({ id: makeId(options), profileName: remoteName, url });
      changed = true;
    }
  }
  return { options, changed };
}
