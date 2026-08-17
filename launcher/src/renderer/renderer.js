const elements = {
  version: document.querySelector("#app-version"), gameVersion: document.querySelector("#active-game-version"), channel: document.querySelector("#release-channel"), footerChannel: document.querySelector("#footer-channel"),
  updateMessage: document.querySelector("#update-message"), progress: document.querySelector("#progress-bar"), progressLabel: document.querySelector("#progress-label"), network: document.querySelector("#network-status"),
  launch: document.querySelector("#launch-game"), apply: document.querySelector("#apply-update"), check: document.querySelector("#check-update"),
  saveList: document.querySelector("#save-list"), backupName: document.querySelector("#backup-name"), toast: document.querySelector("#toast"),
};

let launcherState = null;
let toastTimer = null;

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function renderUpdate(update) {
  launcherState.update = update;
  elements.updateMessage.textContent = update.message;
  elements.progress.style.width = `${update.percent || 0}%`;
  elements.progressLabel.textContent = `${Math.round(update.percent || 0)}%`;
  elements.launch.disabled = Boolean(update.busy);
  elements.check.disabled = Boolean(update.busy);
  elements.channel.disabled = Boolean(update.busy);
  if (update.gameVersion) elements.gameVersion.textContent = `GAME v${update.gameVersion}`;
  elements.network.textContent = update.phase === "error" ? "PATCH OFFLINE" : "NATIVE";
  elements.apply.hidden = update.phase !== "launcher-downloaded";
}

function renderChannel(channel) {
  elements.channel.value = channel;
  elements.footerChannel.textContent = channel.toUpperCase();
}

function renderSaves(saves) {
  elements.saveList.replaceChildren();
  if (!saves.length) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "NO BACKUPS"; elements.saveList.append(empty); return;
  }
  for (const save of saves) {
    const row = document.createElement("div"); row.className = "save-row";
    const info = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = save.name;
    const meta = document.createElement("span"); meta.textContent = `LV ${save.level} · ${save.location} · ${new Date(save.createdAt).toLocaleString()}`;
    info.append(name, meta);
    const restore = document.createElement("button"); restore.textContent = "RESTORE"; restore.addEventListener("click", async () => { try { await window.launcher.restoreBackup(save.filename); toast("Save restored. It will load on the next game launch."); } catch (error) { toast(error.message); } });
    const remove = document.createElement("button"); remove.textContent = "DELETE"; remove.className = "danger"; remove.addEventListener("click", async () => { try { renderSaves(await window.launcher.deleteBackup(save.filename)); } catch (error) { toast(error.message); } });
    row.append(info, restore, remove); elements.saveList.append(row);
  }
}

async function init() {
  launcherState = await window.launcher.getState();
  elements.version.textContent = `v${launcherState.version}`;
  elements.gameVersion.textContent = `GAME v${launcherState.gameVersion}`;
  renderChannel(launcherState.channel);
  renderUpdate(launcherState.update);
  renderSaves(launcherState.saves);
  window.launcher.onUpdateState(renderUpdate);
}

elements.launch.addEventListener("click", async () => { const result = await window.launcher.launchGame(); if (!result.ok) toast(result.error); });
document.querySelector("#minimize-window").addEventListener("click", () => window.launcher.minimizeWindow());
document.querySelector("#close-window").addEventListener("click", () => window.launcher.closeWindow());
elements.check.addEventListener("click", () => window.launcher.checkUpdates().catch((error) => toast(error.message)));
elements.apply.addEventListener("click", () => window.launcher.installUpdate());
elements.channel.addEventListener("change", async () => { try { const result = await window.launcher.setChannel(elements.channel.value); renderChannel(result.channel); } catch (error) { toast(error.message); } });
document.querySelector("#open-saves").addEventListener("click", () => window.launcher.openSaveFolder());
document.querySelector("#create-backup").addEventListener("click", async () => { try { renderSaves(await window.launcher.createBackup(elements.backupName.value)); elements.backupName.value = ""; toast("Active save backed up."); } catch (error) { toast(error.message); } });
document.querySelector("#reset-save").addEventListener("click", async () => { try { await window.launcher.resetActiveSave(); toast("Active save reset. Backups were preserved."); } catch (error) { toast(error.message); } });

void init();
