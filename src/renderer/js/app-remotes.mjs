const REMOTE_ID_PATTERN = /^[a-z0-9_-]{1,80}$/i;

export function normalizeAppRemotes(value) {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set();
  const seenNames = new Set();
  const remotes = [];
  for (const entry of value) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
    const nameKey = name.toLocaleLowerCase();
    if (
      !REMOTE_ID_PATTERN.test(id)
      || !name
      || !url
      || seenIds.has(id)
      || seenNames.has(nameKey)
    ) continue;
    seenIds.add(id);
    seenNames.add(nameKey);
    remotes.push({ id, name, url });
  }
  return remotes;
}

export function selectedAppRemote(project) {
  const remotes = normalizeAppRemotes(project?.appRemotes);
  return remotes.find((remote) => remote.id === project?.selectedRemoteId) || null;
}

export function validateAppRemoteDraft(nameValue, urlValue) {
  const name = String(nameValue || '').trim();
  const url = String(urlValue || '').trim();
  if (!name) return { ok: false, error: 'Enter a remote name.' };
  if (name.length > 64) return { ok: false, error: 'Keep the remote name under 65 characters.' };
  if (/\p{Cc}/u.test(name)) return { ok: false, error: 'The remote name contains an invalid character.' };
  if (!url) return { ok: false, error: 'Enter a remote URL or local repository path.' };
  if (url.length > 4096) return { ok: false, error: 'The remote URL is too long.' };
  if (/\p{Cc}/u.test(url)) return { ok: false, error: 'The remote URL contains an invalid character.' };
  return { ok: true, remote: { name, url } };
}
