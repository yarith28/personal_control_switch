const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileP = promisify(execFile);

const DIRECTORY_ACL_RIGHTS = [
  'list',
  'search',
  'add_file',
  'add_subdirectory',
  'delete_child',
  'readattr',
  'writeattr',
  'readextattr',
  'writeextattr',
  'readsecurity',
  'file_inherit',
  'directory_inherit',
].join(',');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function appleScriptString(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;
}

function validGroupName(value) {
  return /^[a-z0-9_.-]{1,128}$/i.test(String(value || ''));
}

async function resolveRepositoryRoot(repoPath, {
  fsApi = fs,
  homePath = os.homedir(),
} = {}) {
  const requestedPath = typeof repoPath === 'string' ? repoPath.trim() : '';
  if (!requestedPath || requestedPath.includes('\0')) {
    throw new Error('Choose a valid repository folder.');
  }

  let resolvedPath;
  try {
    resolvedPath = await fsApi.realpath(requestedPath);
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      throw new Error('You do not have permission to inspect the selected repository folder.');
    }
    throw new Error('The selected repository folder could not be found.');
  }

  let stat;
  try {
    stat = await fsApi.stat(resolvedPath);
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      throw new Error('You do not have permission to inspect the selected repository folder.');
    }
    throw new Error(`The selected repository folder could not be inspected: ${error.message}`);
  }
  if (!stat.isDirectory()) throw new Error('The selected path is not a repository folder.');

  const filesystemRoot = path.parse(resolvedPath).root;
  const resolvedHome = path.resolve(homePath);
  if (resolvedPath === filesystemRoot || resolvedPath === resolvedHome) {
    throw new Error('Git Sync will not change permissions on a filesystem or home folder.');
  }

  try {
    await fsApi.lstat(path.join(resolvedPath, '.git'));
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      throw new Error('You do not have permission to inspect this repository metadata.');
    }
    throw new Error('The selected folder is not a Git repository root.');
  }

  return resolvedPath;
}

function buildPermissionCommand(repoPath, groupName) {
  if (!validGroupName(groupName)) throw new Error('Could not determine a safe primary group.');

  const target = shellQuote(repoPath);
  const group = shellQuote(groupName);
  const acl = shellQuote(`group:${groupName} allow ${DIRECTORY_ACL_RIGHTS}`);

  return [
    `/usr/bin/find ${target} -type d -exec /usr/bin/chgrp ${group} {} +`,
    `/usr/bin/find ${target} -type d -exec /bin/chmod g+rwx,g+s {} +`,
    `/usr/bin/find ${target} -type d -exec /bin/chmod +a ${acl} {} +`,
  ].join(' && ');
}

function commandFailure(error, fallback) {
  const raw = String(error?.stderr || error?.message || error || '').trim();
  if (/user canceled|user cancelled|\(-128\)|execution error:.*-128/i.test(raw)) {
    return {
      ok: false,
      cancelled: true,
      stdout: '',
      stderr: '',
      errorSummary: 'Permission repair cancelled.',
      errorRaw: '',
    };
  }
  return {
    ok: false,
    stdout: '',
    stderr: raw,
    errorSummary: fallback,
    errorRaw: raw,
  };
}

async function ensureSafeDirectory(repoPath, exec = execFileP) {
  let existing = '';
  try {
    const result = await exec(
      '/usr/bin/git',
      ['config', '--global', '--get-all', 'safe.directory'],
      { encoding: 'utf8' }
    );
    existing = result.stdout || '';
  } catch (error) {
    // Git exits 1 when the key does not exist. Other failures are reported
    // after the permission repair so the successful filesystem change is not
    // misrepresented as a complete failure.
    if (error?.code !== 1) throw error;
  }

  const configured = existing
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(repoPath)) return false;

  await exec(
    '/usr/bin/git',
    ['config', '--global', '--add', 'safe.directory', repoPath],
    { encoding: 'utf8' }
  );
  return true;
}

async function fixSharedPermissions(repoPath, {
  platform = process.platform,
  exec = execFileP,
  fsApi = fs,
  homePath = os.homedir(),
} = {}) {
  if (platform !== 'darwin') {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      errorCode: 'UNSUPPORTED_PLATFORM',
      errorSummary: 'Permission repair is currently available on macOS only.',
      errorRaw: '',
    };
  }

  let target;
  try {
    target = await resolveRepositoryRoot(repoPath, { fsApi, homePath });
  } catch (error) {
    return commandFailure(error, error.message);
  }

  let groupName;
  try {
    const result = await exec('/usr/bin/id', ['-gn'], { encoding: 'utf8' });
    groupName = String(result.stdout || '').trim();
    if (!validGroupName(groupName)) throw new Error('Invalid primary group');
  } catch (error) {
    return commandFailure(error, 'Could not determine the current macOS user group.');
  }

  const command = buildPermissionCommand(target, groupName);
  const script = `do shell script ${appleScriptString(command)} with administrator privileges`;
  try {
    await exec('/usr/bin/osascript', ['-e', script], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    return commandFailure(error, 'macOS could not repair the repository permissions.');
  }

  let trustWarning = '';
  try {
    await ensureSafeDirectory(target, exec);
  } catch (error) {
    trustWarning = String(error?.stderr || error?.message || error || '').trim();
  }

  const summary = `Shared directory permissions updated for group ${groupName}.`;
  return {
    ok: true,
    stdout: trustWarning
      ? `${summary}\nGit trust could not be updated automatically: ${trustWarning}`
      : `${summary}\nThe repository is trusted by Git for this account.`,
    stderr: '',
    repoPath: target,
    groupName,
    trustWarning,
  };
}

module.exports = {
  buildPermissionCommand,
  fixSharedPermissions,
  resolveRepositoryRoot,
  shellQuote,
};
