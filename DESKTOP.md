# Windows desktop builds

Life is a Gamble now ships as two native Windows applications:

- **Life is a Gamble Launcher** installs game updates in the background, only requests a restart for launcher updates, selects the `main` or `testing` release channel, starts the game process, and manages save backups.
- **Life is a Gamble Game** is the standalone native game executable. It hosts the compiled game on a loopback-only server inside the process, so gameplay no longer depends on the hosted browser site.

## Local build

Use Node.js 22 on Windows, then run:

```powershell
npm ci
npm run build
npm --prefix game ci
npm --prefix game run check
npm --prefix game run dist
npm --prefix launcher ci
npm --prefix launcher run check
npm --prefix launcher run dist
```

The standalone game is written to `game/release/Life-is-a-Gamble-Game-<version>.exe`. The complete installer is written to `launcher/release/Life-is-a-Gamble-Launcher-Setup-<version>.exe`; it contains the unpacked game runtime and is the recommended download.

The shared Windows icon source lives in `desktop/assets/app-icon.png`; `desktop/assets/app-icon.ico` supplies the multi-resolution executable, installer, and shortcut icon.

## Runtime data

Native saves and launcher settings are stored outside the installation directory:

```text
%APPDATA%\Life is a Gamble\
  game\
    Life is a Gamble Game.exe
    version.json
  launcher-settings.json
  saves\
    active-save.json
    save-slots.json
    backups\
```

`active-save.json` mirrors the most recent world state for launcher backups. `save-slots.json` contains the in-game autosave, quicksave, and named field records. Both are restored into the game automatically on startup.

Set `OPENAI_API_KEY` in the environment that starts the game if AI dialogue and speech should use OpenAI. Keys are never bundled into either executable.

## Release channels

Automated Windows updates publish from `testing` only. The workflow maintains a rolling testing manifest with independent game and launcher versions. Game-only changes replace the managed game executable after a streamed SHA-256-verified download and need no launcher restart. A launcher version is published only after `launcher/package.json` is intentionally bumped; that package downloads in the background and exposes **Restart & Apply** when ready.

The first build of each launcher version also creates a conventional prerelease updater feed so older launchers can migrate to the split updater. The stable `main` branch is not changed or published automatically.
