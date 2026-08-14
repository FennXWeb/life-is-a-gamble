# Life is a Gamble

## LIAG Editor

The admin-only editor is mounted at `/editor`. It provides structured builders
for levels, positioned cells and doors, loot tables, custom NPCs, hostile NPC
spawners, and quests. Its Files workspace can inspect the repository tree and
edit text source files.

All writes happen server-side through the GitHub Contents API and are committed
to the configured `testing` branch. Configure `LIAG_EDITOR_ADMIN_EMAILS`,
`LIAG_GITHUB_REPOSITORY`, and `LIAG_GITHUB_TOKEN` in the hosted runtime. The
token should be fine-grained and limited to Contents read/write access for this
repository. `LIAG_GITHUB_BRANCH` defaults to `testing`; the canonical project
document defaults to `game-data/editor-project.json`.

For local development only, set `LIAG_EDITOR_DEV_EMAIL` to an address that is
also included in `LIAG_EDITOR_ADMIN_EMAILS`.

An original isometric post-apocalyptic CRPG set in the ruins of Upstate New York, one hundred years after the collapse of the United States government.

The current playable district is downtown Syracuse. It includes click-to-walk exploration, collision-aware streets, turn-based combat, dynamic AI dialogue, persistent NPC state, grid inventory and equipment, skill progression, Fate slot-machine checks, adaptive music playlists, and a Windows launcher.

## Branches

- `main` — stable release source.
- `testing` — automatic integration branch for future work and prerelease launcher builds.

GitHub permissions apply to the repository as a whole. The testing branch is readable wherever the repository is readable; write access is limited to repository collaborators and branch rules.

## Web game

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Production validation:

```powershell
npm run build
```

The folder-driven soundtrack lives under `public/music`. Development and production builds regenerate its playlist manifest automatically.

## Windows launcher and installer

The launcher opens the hosted game in a persistent game window and provides:

- local save backup, restore, deletion, and reset;
- stable (`main`) and prerelease (`testing`) update channels;
- automatic update checks and background downloads;
- differential NSIS updates using blockmap metadata;
- an update progress bar and disabled Launch button while patching;
- restart-and-apply behavior after an update is downloaded.

Build the installer:

```powershell
cd launcher
npm install
npm run check
npm run dist
```

The installer is written to `launcher/release`.

## Automatic testing sync

Run once in a fresh clone:

```powershell
.\scripts\install-git-hooks.ps1
```

After installation, every local commit is mirrored to the GitHub `testing` branch. Failed offline pushes do not discard the local commit and can be retried with `git push github HEAD:testing`.

## Saves

The web game stores its active save locally. The launcher keeps timestamped backup files in the Electron user-data directory and never deletes backups when the active save is reset.

## Rights

Copyright © 2026 FennXWeb. All rights reserved. No license is granted for redistribution or derivative works.
