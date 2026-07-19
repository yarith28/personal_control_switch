# Git Sync

Git Sync is a desktop dashboard for working with multiple Git repositories. It keeps routine fetch, pull, push, branch, and commit actions in one place while leaving each repository as a normal Git working tree.

## Features

- Track repositories individually or organize them into folders
- Search by repository name, path, or branch
- Fetch, pull, or push one repository, a folder, a selection, or the full list
- Run batch operations sequentially or in parallel with Burst mode
- Cancel an active fetch, pull, or push; stalled Git commands time out automatically
- Switch local branches and open a repository in a terminal, file manager, VS Code, SourceTree, or another supported tool
- Create or amend quick commits
- Compare and coordinate branches between independent local repositories with Cross Sync
- Inspect commit history and safely rewrite supported commit metadata with Commit Tool
- Choose themes, fonts, and compact layout

## Requirements

- Node.js 22.12 or later
- pnpm 11.9.0 (the version declared in `package.json`)
- Git available in `PATH`

Recent Node releases include Corepack. If `pnpm` is unavailable, enable it once:

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

## Setup

Install the locked dependencies:

```bash
pnpm install --frozen-lockfile
```

The project post-install step downloads the Electron runtime automatically. No separate Electron command is required.

## Run

```bash
pnpm start
```

`pnpm run dev` starts the same development server. On macOS or Windows, `start.command` and `start.bat` provide double-click launchers after setup.

## Test and verify

```bash
pnpm test
pnpm run check
```

`check` runs the automated tests and builds the production Electron bundle.

## Build an installer

Build on the operating system you are targeting:

```bash
# macOS — produces a DMG in dist/
pnpm run build:mac

# Windows — produces portable and unpacked builds in dist/
pnpm run build:win
```

The included packaging configuration does not sign installers. Public distribution should add the appropriate Apple or Windows signing identity.

## Safety and recovery

- Pull and push use Git's existing behavior and configuration. The app does not choose a merge or rebase strategy for you.
- Git credential prompts are disabled inside the app so an operation cannot wait on an invisible terminal prompt. Configure credentials with your normal Git tooling.
- Fetch, pull, and push can be cancelled from the repository row. Network operations time out after five minutes; other Git commands time out after two minutes.
- Commit Tool only rewrites clean, linear local history. It creates a temporary backup branch, updates the branch with compare-and-swap semantics, verifies the result, and attempts an automatic rollback if verification fails.
- Cross Sync refuses dirty target working trees and aborts a conflicted rebase.
- Configuration saves are atomic. Before replacing a valid configuration, the app keeps a last known-good backup. An unreadable configuration is preserved and recovery is reported in the app.

## Basic usage

1. Select **Add project** and choose one or more Git repository folders.
2. Use the branch badge to switch branches.
3. Use the repository actions to fetch, pull, push, or create a quick commit.
4. Use search to focus a large repository list.
5. Open the activity log for Git output and error details.
6. Open the in-app quick tour for toolbar and repository-action help.
