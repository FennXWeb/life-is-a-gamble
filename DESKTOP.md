# Windows desktop builds

Life is a Gamble now ships as two native Windows applications:

- **Life is a Gamble Launcher** installs and updates the complete game, selects the `main` or `testing` release channel, starts the game process, and manages save backups.
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
  launcher-settings.json
  saves\
    active-save.json
    save-slots.json
    backups\
```

`active-save.json` mirrors the most recent world state for launcher backups. `save-slots.json` contains the in-game autosave, quicksave, and named field records. Both are restored into the game automatically on startup.

Set `OPENAI_API_KEY` in the environment that starts the game if AI dialogue and speech should use OpenAI. Keys are never bundled into either executable.

## Release channels

Pushes to `main` publish stable `latest` builds. Pushes to `testing` publish prerelease `testing` builds. The Windows workflow builds the game first, embeds that build in the launcher installer, publishes differential updater metadata, and attaches the standalone game EXE plus checksums to the same GitHub release.
