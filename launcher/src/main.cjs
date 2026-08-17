const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { compareVersions, downloadAndVerify, promoteDownload, validateManifest } = require("./update-service.cjs");

const CHANNELS = new Set(["main", "testing"]);
const TESTING_RELEASE_ROOT = "https://github.com/FennXWeb/life-is-a-gamble/releases/download/v0.0.0-testing-channel";
const TESTING_MANIFEST_URL = `${TESTING_RELEASE_ROOT}/channel-manifest.json`;

let launcherWindow = null;
let settings = { channel: "testing" };
let updateState = { phase: "idle", busy: false, percent: 0, message: "Ready to play" };
let updateCheckPromise = null;

const sharedRoot = () => path.join(app.getPath("appData"), "Life is a Gamble");
const settingsPath = () => path.join(sharedRoot(), "launcher-settings.json");
const savesPath = () => path.join(sharedRoot(), "saves", "backups");
const activeSavePath = () => path.join(sharedRoot(), "saves", "active-save.json");
const managedGameDirectory = () => path.join(sharedRoot(), "game");
const managedGamePath = () => path.join(managedGameDirectory(), "Life is a Gamble Game.exe");
const managedGameVersionPath = () => path.join(managedGameDirectory(), "version.json");
const bundledGamePath = () => path.join(process.resourcesPath, "game", "Life is a Gamble Game.exe");
const bundledGamePackagePath = () => path.join(process.resourcesPath, "bundled-game-package.json");

async function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(await fs.readFile(settingsPath(), "utf8")) };
  } catch { /* first launch */ }
  if (!CHANNELS.has(settings.channel)) settings.channel = "main";
}

async function saveSettings() {
  await fs.mkdir(sharedRoot(), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

async function gameCommand() {
  if (app.isPackaged) {
    try {
      await fs.access(managedGamePath());
      return { command: managedGamePath(), args: [] };
    } catch { /* use the game bundled with the launcher */ }
    return {
      command: bundledGamePath(),
      args: [],
    };
  }
  return {
    command: process.execPath,
    args: [path.resolve(__dirname, "..", "..", "game")],
  };
}

async function launchGame() {
  const target = await gameCommand();
  try {
    await fs.access(target.command);
  } catch {
    throw new Error("The native game executable is missing. Reinstall or update Life is a Gamble.");
  }
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(target.command, target.args, {
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(target.command),
    env: environment,
    windowsHide: false,
  });
  child.unref();
}

function sendUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  launcherWindow?.webContents.send("launcher:update-state", updateState);
}

function configureLauncherUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.channel = "testing";
  autoUpdater.setFeedURL({ provider: "generic", url: TESTING_RELEASE_ROOT, channel: "testing" });
}

function wireUpdaterEvents() {
  autoUpdater.on("checking-for-update", () => sendUpdateState({ phase: "launcher-check", busy: false, percent: 0, message: "Checking launcher package…" }));
  autoUpdater.on("update-available", (info) => sendUpdateState({ phase: "launcher-downloading", busy: true, percent: 0, message: `Launcher ${info.version} downloading in the background…` }));
  autoUpdater.on("update-not-available", () => sendUpdateState({ phase: "ready", busy: false, percent: 100, message: "Game and launcher are up to date" }));
  autoUpdater.on("download-progress", (progress) => sendUpdateState({ phase: "launcher-downloading", busy: true, percent: Math.max(0, Math.min(100, progress.percent || 0)), message: `Launcher download · ${Math.round(progress.percent || 0)}%` }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateState({ phase: "launcher-downloaded", busy: false, percent: 100, message: `Launcher ${info.version} ready · restart to apply` }));
  autoUpdater.on("error", (error) => sendUpdateState({ phase: "error", busy: false, percent: 0, message: String(error?.message || "Update service unavailable").replace(/github/ig, "update service") }));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function installedGameVersion() {
  const managed = await readJson(managedGameVersionPath());
  if (managed?.version) return String(managed.version);
  const bundled = await readJson(bundledGamePackagePath());
  return String(bundled?.version || "0.0.0");
}

async function fetchTestingManifest() {
  const response = await fetch(`${TESTING_MANIFEST_URL}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Life-is-a-Gamble-Launcher" },
  });
  if (!response.ok) throw new Error(`Update manifest unavailable (${response.status}).`);
  return validateManifest(await response.json());
}

async function installGameUpdate(asset) {
  const downloadPath = path.join(managedGameDirectory(), "Life is a Gamble Game.next.exe");
  await downloadAndVerify(asset, downloadPath, (percent) => {
    const rounded = Math.max(0, Math.min(100, Math.round(percent || 0)));
    sendUpdateState({ phase: "game-downloading", busy: true, percent: rounded, message: `Installing game ${asset.version} in background · ${rounded}%` });
  });
  sendUpdateState({ phase: "game-installing", busy: true, percent: 100, message: `Applying game ${asset.version}…` });
  await promoteDownload(downloadPath, managedGamePath());
  await fs.writeFile(managedGameVersionPath(), JSON.stringify({ version: asset.version, installedAt: new Date().toISOString() }, null, 2), "utf8");
  sendUpdateState({ gameVersion: asset.version });
}

async function performUpdateCheck() {
  if (!app.isPackaged) {
    sendUpdateState({ phase: "ready", busy: false, percent: 100, message: "Development build · updater disabled" });
    return { development: true };
  }
  if (settings.channel !== "testing") {
    sendUpdateState({ phase: "ready", busy: false, percent: 100, message: "Stable installation ready · testing updates paused" });
    return { channel: "main", updated: false };
  }
  sendUpdateState({ phase: "checking", busy: false, percent: 0, message: "Checking testing channel…" });
  const manifest = await fetchTestingManifest();
  const currentGameVersion = await installedGameVersion();
  let gameUpdated = false;
  if (compareVersions(manifest.game.version, currentGameVersion) > 0) {
    await installGameUpdate(manifest.game);
    gameUpdated = true;
  }
  if (compareVersions(manifest.launcher.version, app.getVersion()) > 0) {
    configureLauncherUpdater();
    await autoUpdater.checkForUpdates();
    return { gameUpdated, launcherUpdate: true };
  }
  sendUpdateState({ phase: "ready", busy: false, percent: 100, message: gameUpdated ? `Game ${manifest.game.version} installed · no restart required` : "Game and launcher are up to date" });
  return { gameUpdated, launcherUpdate: false };
}

function checkForUpdates() {
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = performUpdateCheck().catch((error) => {
    sendUpdateState({ phase: "error", busy: false, percent: 0, message: String(error?.message || "Update service unavailable").replace(/github/ig, "update service") });
    return { error: String(error?.message || error) };
  }).finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 1240,
    height: 760,
    minWidth: 1240,
    minHeight: 760,
    maxWidth: 1240,
    maxHeight: 760,
    frame: false,
    titleBarStyle: "hidden",
    maximizable: false,
    resizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#090b08",
    title: "Life is a Gamble Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  launcherWindow.removeMenu();
  launcherWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  launcherWindow.once("ready-to-show", () => launcherWindow.show());
  launcherWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  launcherWindow.on("closed", () => { launcherWindow = null; });
}

async function readActiveSave() {
  try {
    return await fs.readFile(activeSavePath(), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeActiveSave(rawSave) {
  JSON.parse(rawSave);
  const directory = path.dirname(activeSavePath());
  const temporaryPath = `${activeSavePath()}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryPath, rawSave, "utf8");
  await fs.rename(temporaryPath, activeSavePath());
}

async function removeActiveSave() {
  try {
    await fs.unlink(activeSavePath());
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function listBackups() {
  await fs.mkdir(savesPath(), { recursive: true });
  const files = (await fs.readdir(savesPath())).filter((file) => file.endsWith(".json"));
  const saves = [];
  for (const filename of files) {
    try {
      const fullPath = path.join(savesPath(), filename);
      const stat = await fs.stat(fullPath);
      const wrapper = JSON.parse(await fs.readFile(fullPath, "utf8"));
      const game = JSON.parse(wrapper.data || "{}");
      saves.push({ filename, name: wrapper.name || filename, createdAt: wrapper.createdAt || stat.mtime.toISOString(), level: game.level || 1, location: game.location || "Unknown" });
    } catch { /* ignore damaged backups */ }
  }
  return saves.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

ipcMain.handle("launcher:get-state", async () => ({ version: app.getVersion(), gameVersion: await installedGameVersion(), channel: settings.channel, update: updateState, saves: await listBackups(), packaged: app.isPackaged }));
ipcMain.handle("launcher:minimize", () => launcherWindow?.minimize());
ipcMain.handle("launcher:close", () => launcherWindow?.close());
ipcMain.handle("launcher:launch-game", async () => {
  if (updateState.busy) return { ok: false, error: "Finish the update before launching." };
  try {
    await launchGame();
    launcherWindow?.hide();
    setTimeout(() => app.quit(), 250);
    return { ok: true, closing: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle("launcher:set-channel", async (_event, channel) => {
  if (!CHANNELS.has(channel)) throw new Error("Unknown release channel");
  settings.channel = channel;
  await saveSettings();
  sendUpdateState({ phase: "idle", busy: false, percent: 0, message: `${channel === "testing" ? "Testing" : "Main"} channel selected` });
  void checkForUpdates();
  return { channel };
});
ipcMain.handle("launcher:check-updates", () => checkForUpdates());
ipcMain.handle("launcher:install-update", () => { if (updateState.phase === "launcher-downloaded") autoUpdater.quitAndInstall(false, true); });
ipcMain.handle("saves:create", async (_event, requestedName) => {
  const raw = await readActiveSave();
  if (!raw) throw new Error("No active game save exists yet.");
  await fs.mkdir(savesPath(), { recursive: true });
  const createdAt = new Date().toISOString();
  const safeName = String(requestedName || `Backup ${createdAt.slice(0, 16).replace("T", " ")}`).trim().slice(0, 60);
  const filename = `${createdAt.replace(/[:.]/g, "-")}.json`;
  await fs.writeFile(path.join(savesPath(), filename), JSON.stringify({ name: safeName, createdAt, data: raw }, null, 2), "utf8");
  return listBackups();
});
ipcMain.handle("saves:restore", async (_event, filename) => {
  const wrapper = JSON.parse(await fs.readFile(path.join(savesPath(), path.basename(filename)), "utf8"));
  await writeActiveSave(wrapper.data);
  return { ok: true };
});
ipcMain.handle("saves:delete", async (_event, filename) => { await fs.unlink(path.join(savesPath(), path.basename(filename))); return listBackups(); });
ipcMain.handle("saves:reset-active", async () => { await removeActiveSave(); return { ok: true }; });
ipcMain.handle("saves:open-folder", async () => { await fs.mkdir(savesPath(), { recursive: true }); return shell.openPath(savesPath()); });

app.whenReady().then(async () => {
  await loadSettings();
  wireUpdaterEvents();
  createLauncherWindow();
  setTimeout(() => { void checkForUpdates(); }, 1300);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!launcherWindow) createLauncherWindow(); });
