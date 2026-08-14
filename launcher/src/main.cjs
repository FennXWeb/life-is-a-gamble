const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");

const GAME_URL = "https://life-is-a-gamble-rpg.neongrave.chatgpt.site/";
const REPOSITORY_URL = "https://github.com/FennXWeb/life-is-a-gamble";
const SAVE_KEY = "life-is-a-gamble-save";
const CHANNELS = new Set(["main", "testing"]);

let launcherWindow = null;
let gameWindow = null;
let settings = { channel: "main" };
let updateState = { phase: "idle", busy: false, percent: 0, message: "Ready to play" };

const settingsPath = () => path.join(app.getPath("userData"), "launcher-settings.json");
const savesPath = () => path.join(app.getPath("userData"), "save-backups");

async function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(await fs.readFile(settingsPath(), "utf8")) };
  } catch { /* first launch */ }
  if (!CHANNELS.has(settings.channel)) settings.channel = "main";
}

async function saveSettings() {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function sendUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  launcherWindow?.webContents.send("launcher:update-state", updateState);
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = settings.channel === "testing";
  autoUpdater.channel = settings.channel === "testing" ? "testing" : "latest";
}

function wireUpdaterEvents() {
  autoUpdater.on("checking-for-update", () => sendUpdateState({ phase: "checking", busy: false, percent: 0, message: `Checking ${settings.channel} channel…` }));
  autoUpdater.on("update-available", (info) => sendUpdateState({ phase: "downloading", busy: true, percent: 0, message: `Downloading ${info.version} in the background…` }));
  autoUpdater.on("update-not-available", () => sendUpdateState({ phase: "ready", busy: false, percent: 100, message: "Game is up to date" }));
  autoUpdater.on("download-progress", (progress) => sendUpdateState({ phase: "downloading", busy: true, percent: Math.max(0, Math.min(100, progress.percent || 0)), message: `Patching in background · ${Math.round(progress.percent || 0)}%` }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateState({ phase: "downloaded", busy: true, percent: 100, message: `${info.version} ready · restart to apply` }));
  autoUpdater.on("error", (error) => sendUpdateState({ phase: "error", busy: false, percent: 0, message: error?.message || "Update check failed" }));
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateState({ phase: "ready", busy: false, percent: 100, message: "Development build · updater disabled" });
    return { development: true };
  }
  configureUpdater();
  return autoUpdater.checkForUpdates();
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 980,
    minHeight: 620,
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

async function ensureGameWindow(show = true) {
  if (gameWindow && !gameWindow.isDestroyed()) {
    if (show) gameWindow.show();
    return gameWindow;
  }
  gameWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#080a08",
    title: "Life is a Gamble",
    webPreferences: {
      partition: "persist:life-is-a-gamble-game",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  gameWindow.removeMenu();
  gameWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  gameWindow.on("closed", () => { gameWindow = null; });
  await gameWindow.loadURL(GAME_URL);
  if (show) gameWindow.show();
  return gameWindow;
}

async function readActiveSave() {
  const window = await ensureGameWindow(false);
  if (!window.webContents.getURL().includes("neongrave.chatgpt.site")) throw new Error("Launch the game and sign in once before managing the active save.");
  return window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, true);
}

async function writeActiveSave(rawSave) {
  const window = await ensureGameWindow(false);
  if (!window.webContents.getURL().includes("neongrave.chatgpt.site")) throw new Error("Launch the game and sign in once before restoring a save.");
  await window.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(rawSave)}); location.reload();`, true);
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

ipcMain.handle("launcher:get-state", async () => ({ version: app.getVersion(), channel: settings.channel, update: updateState, saves: await listBackups(), packaged: app.isPackaged }));
ipcMain.handle("launcher:launch-game", async () => { if (updateState.busy) return { ok: false, error: "Finish the update before launching." }; await ensureGameWindow(true); return { ok: true }; });
ipcMain.handle("launcher:set-channel", async (_event, channel) => {
  if (!CHANNELS.has(channel)) throw new Error("Unknown release channel");
  settings.channel = channel; await saveSettings(); configureUpdater();
  sendUpdateState({ phase: "idle", busy: false, percent: 0, message: `${channel === "testing" ? "Testing" : "Main"} channel selected` });
  void checkForUpdates();
  return { channel };
});
ipcMain.handle("launcher:check-updates", () => checkForUpdates());
ipcMain.handle("launcher:install-update", () => { if (updateState.phase === "downloaded") autoUpdater.quitAndInstall(false, true); });
ipcMain.handle("launcher:open-repository", () => shell.openExternal(REPOSITORY_URL));
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
  const safeFile = path.basename(filename);
  const wrapper = JSON.parse(await fs.readFile(path.join(savesPath(), safeFile), "utf8"));
  await writeActiveSave(wrapper.data);
  return { ok: true };
});
ipcMain.handle("saves:delete", async (_event, filename) => { await fs.unlink(path.join(savesPath(), path.basename(filename))); return listBackups(); });
ipcMain.handle("saves:reset-active", async () => { const window = await ensureGameWindow(false); await window.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); location.reload();`, true); return { ok: true }; });
ipcMain.handle("saves:open-folder", async () => { await fs.mkdir(savesPath(), { recursive: true }); return shell.openPath(savesPath()); });

app.whenReady().then(async () => {
  await loadSettings();
  wireUpdaterEvents();
  configureUpdater();
  createLauncherWindow();
  setTimeout(() => { void checkForUpdates(); }, 1300);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!launcherWindow) createLauncherWindow(); });
