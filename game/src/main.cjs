const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createGameServer } = require("./server.cjs");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const SAVE_KEY = "life-is-a-gamble-save";
const SAVE_SLOTS_KEY = "life-is-a-gamble-save-slots";
let gameWindow = null;
let gameServer = null;
let saveTimer = null;
let initialSaveApplied = false;

const sharedRoot = () => path.join(app.getPath("appData"), "Life is a Gamble");
const activeSavePath = () => path.join(sharedRoot(), "saves", "active-save.json");
const saveSlotsPath = () => path.join(sharedRoot(), "saves", "save-slots.json");
const runtimeRoot = () => app.isPackaged
  ? path.join(process.resourcesPath, "game-dist")
  : path.resolve(__dirname, "..", "..", "dist");

function readWindowsUserEnvironment(name) {
  if (process.platform !== "win32") return undefined;
  try {
    const output = execFileSync("reg.exe", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true });
    const line = output.split(/\r?\n/).find((candidate) => candidate.includes(name) && /REG_(?:EXPAND_)?SZ/.test(candidate));
    return line?.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const runtimeEnvironmentValue = (name) => process.env[name] || readWindowsUserEnvironment(name);

async function readSaveFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(filePath, data) {
  const saveDirectory = path.dirname(filePath);
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(saveDirectory, { recursive: true });
  await fs.writeFile(temporaryPath, data, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function persistNativeSaves() {
  if (!gameWindow || gameWindow.isDestroyed() || gameWindow.webContents.isLoading()) return;
  const saves = await gameWindow.webContents.executeJavaScript(`({
    active: localStorage.getItem(${JSON.stringify(SAVE_KEY)}),
    slots: localStorage.getItem(${JSON.stringify(SAVE_SLOTS_KEY)})
  })`, true);
  const writes = [];
  if (saves.active) {
    JSON.parse(saves.active);
    writes.push(atomicWrite(activeSavePath(), saves.active));
  }
  if (saves.slots) {
    const parsedSlots = JSON.parse(saves.slots);
    if (!Array.isArray(parsedSlots)) throw new Error("The named save archive is not an array.");
    writes.push(atomicWrite(saveSlotsPath(), saves.slots));
  }
  await Promise.all(writes);
}

async function applyNativeSaves() {
  if (initialSaveApplied || !gameWindow || gameWindow.isDestroyed()) return;
  initialSaveApplied = true;
  const [rawSave, rawSlots] = await Promise.all([readSaveFile(activeSavePath()), readSaveFile(saveSlotsPath())]);
  if (!rawSave && !rawSlots) return;
  if (rawSave) JSON.parse(rawSave);
  if (rawSlots && !Array.isArray(JSON.parse(rawSlots))) throw new Error("The named save archive is not an array.");
  const changed = await gameWindow.webContents.executeJavaScript(`(() => {
    const incoming = [
      [${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(rawSave)}],
      [${JSON.stringify(SAVE_SLOTS_KEY)}, ${JSON.stringify(rawSlots)}]
    ];
    let changed = false;
    for (const [key, next] of incoming) {
      if (typeof next !== "string" || localStorage.getItem(key) === next) continue;
      localStorage.setItem(key, next);
      changed = true;
    }
    return changed;
  })()`, true);
  if (changed) await gameWindow.webContents.reload();
}

function createGameWindow(origin) {
  const isGameOrigin = (requestingOrigin) => {
    try { return new URL(requestingOrigin).origin === origin; } catch { return false; }
  };
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => permission === "media" && isGameOrigin(requestingOrigin));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const wantsAudio = !details.mediaTypes?.length || details.mediaTypes.includes("audio");
    callback(permission === "media" && wantsAudio && isGameOrigin(details.requestingUrl));
  });
  gameWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#080a08",
    title: "Life is a Gamble",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  gameWindow.removeMenu();
  gameWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  gameWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  gameWindow.webContents.on("did-finish-load", () => {
    void applyNativeSaves().catch((error) => console.error("Unable to load native saves", error));
  });
  gameWindow.once("ready-to-show", () => {
    gameWindow.show();
    gameWindow.maximize();
  });
  gameWindow.on("close", (event) => {
    if (gameWindow.__saveInProgress) return;
    event.preventDefault();
    gameWindow.__saveInProgress = true;
    void persistNativeSaves().catch((error) => console.error("Unable to persist native saves", error)).finally(() => gameWindow?.destroy());
  });
  gameWindow.on("closed", () => { gameWindow = null; });
  void gameWindow.loadURL(origin);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.on("second-instance", () => {
  if (!gameWindow) return;
  if (gameWindow.isMinimized()) gameWindow.restore();
  gameWindow.focus();
});

app.whenReady().then(async () => {
  try {
    gameServer = await createGameServer(runtimeRoot(), {
      OPENAI_API_KEY: runtimeEnvironmentValue("OPENAI_API_KEY"),
      OPENAI_DIALOGUE_MODEL: runtimeEnvironmentValue("OPENAI_DIALOGUE_MODEL"),
      OPENAI_TTS_MODEL: runtimeEnvironmentValue("OPENAI_TTS_MODEL"),
      OPENAI_STT_MODEL: runtimeEnvironmentValue("OPENAI_STT_MODEL"),
    });
    createGameWindow(gameServer.origin);
    saveTimer = setInterval(() => {
      void persistNativeSaves().catch((error) => console.error("Native save mirror failed", error));
    }, 5000);
  } catch (error) {
    console.error(error);
    dialog.showErrorBox("Life is a Gamble could not start", `${error.message}\n\nReinstall the game if its runtime files are missing.`);
    app.quit();
  }
});

app.on("before-quit", () => {
  if (saveTimer) clearInterval(saveTimer);
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  if (gameServer) void gameServer.close();
});
