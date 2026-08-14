const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getState: () => ipcRenderer.invoke("launcher:get-state"),
  launchGame: () => ipcRenderer.invoke("launcher:launch-game"),
  setChannel: (channel) => ipcRenderer.invoke("launcher:set-channel", channel),
  checkUpdates: () => ipcRenderer.invoke("launcher:check-updates"),
  installUpdate: () => ipcRenderer.invoke("launcher:install-update"),
  createBackup: (name) => ipcRenderer.invoke("saves:create", name),
  restoreBackup: (filename) => ipcRenderer.invoke("saves:restore", filename),
  deleteBackup: (filename) => ipcRenderer.invoke("saves:delete", filename),
  resetActiveSave: () => ipcRenderer.invoke("saves:reset-active"),
  openSaveFolder: () => ipcRenderer.invoke("saves:open-folder"),
  openRepository: () => ipcRenderer.invoke("launcher:open-repository"),
  onUpdateState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("launcher:update-state", listener);
    return () => ipcRenderer.removeListener("launcher:update-state", listener);
  },
});
