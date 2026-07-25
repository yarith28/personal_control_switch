const REMOTE_ID_PATTERN = /^[a-z0-9_-]{1,80}$/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRemoteUrlOptions(value) {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set();
  const seenOptions = new Set();
  const options = [];
  for (const entry of value) {
    const id = clean(entry?.id);
    const remoteName = clean(entry?.remoteName);
    const url = clean(entry?.url);
    const optionKey = `${remoteName}\0${url}`;
    if (
      !REMOTE_ID_PATTERN.test(id)
      || !remoteName
      || remoteName.length > 255
      || !url
      || url.length > 4096
      || /\p{Cc}/u.test(remoteName)
      || /\p{Cc}/u.test(url)
      || seenIds.has(id)
      || seenOptions.has(optionKey)
    ) continue;
    seenIds.add(id);
    seenOptions.add(optionKey);
    options.push({ id, remoteName, url });
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

export function mergeConfiguredRemoteUrls(optionsValue, remotes, makeId) {
  const options = normalizeRemoteUrlOptions(optionsValue);
  let changed = false;
  for (const remote of Array.isArray(remotes) ? remotes : []) {
    const remoteName = clean(remote?.name);
    const url = clean(remote?.url);
    if (!remoteName || !url) continue;
    const exists = options.some((option) => (
      option.remoteName === remoteName && option.url === url
    ));
    if (exists) continue;
    options.push({ id: makeId(options), remoteName, url });
    changed = true;
  }
  return { options, changed };
}
