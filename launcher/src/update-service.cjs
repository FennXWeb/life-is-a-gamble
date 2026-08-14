const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function versionNumbers(version) {
  return String(version || "0").match(/\d+/g)?.map(Number) || [0];
}

function compareVersions(left, right) {
  const a = versionNumbers(left);
  const b = versionNumbers(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function validateAsset(asset, name) {
  if (!asset || typeof asset !== "object") throw new Error(`${name} update metadata is missing.`);
  if (!/^https:\/\//i.test(String(asset.url || ""))) throw new Error(`${name} update URL is invalid.`);
  if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ""))) throw new Error(`${name} update checksum is invalid.`);
  if (!String(asset.version || "").match(/^\d+\.\d+\.\d+/)) throw new Error(`${name} update version is invalid.`);
  return { version: String(asset.version), url: String(asset.url), sha256: String(asset.sha256).toLowerCase(), size: Math.max(0, Number(asset.size) || 0) };
}

function validateManifest(value) {
  if (!value || value.schemaVersion !== 1 || value.channel !== "testing") throw new Error("The testing update manifest is incompatible.");
  return {
    schemaVersion: 1,
    channel: "testing",
    publishedAt: String(value.publishedAt || ""),
    game: validateAsset(value.game, "Game"),
    launcher: validateAsset(value.launcher, "Launcher"),
  };
}

async function downloadAndVerify(asset, destination, onProgress = () => {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(asset.url, { redirect: "follow", headers: { Accept: "application/octet-stream", "User-Agent": "Life-is-a-Gamble-Launcher" } });
  if (!response.ok || !response.body) throw new Error(`Update download failed (${response.status}).`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rm(destination, { force: true });
  const file = await fs.open(destination, "w");
  const hash = crypto.createHash("sha256");
  const reader = response.body.getReader();
  const expectedSize = Number(response.headers.get("content-length")) || asset.size || 0;
  let received = 0;
  let streamError = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      await file.write(chunk);
      hash.update(chunk);
      received += chunk.byteLength;
      onProgress(expectedSize ? (received / expectedSize) * 100 : 0, received, expectedSize);
    }
    await file.sync();
  } catch (error) {
    streamError = error;
  } finally {
    await file.close();
  }
  if (streamError) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw streamError;
  }
  if (asset.size && received !== asset.size) {
    await fs.rm(destination, { force: true });
    throw new Error("Update download size did not match its manifest.");
  }
  if (hash.digest("hex") !== asset.sha256) {
    await fs.rm(destination, { force: true });
    throw new Error("Update checksum verification failed.");
  }
  return { path: destination, bytes: received };
}

async function promoteDownload(downloadPath, installedPath) {
  const backupPath = `${installedPath}.previous`;
  await fs.mkdir(path.dirname(installedPath), { recursive: true });
  await fs.rm(backupPath, { force: true });
  let backedUp = false;
  try {
    await fs.rename(installedPath, backupPath);
    backedUp = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await fs.rename(downloadPath, installedPath);
    await fs.rm(backupPath, { force: true });
  } catch (error) {
    if (backedUp) await fs.rename(backupPath, installedPath).catch(() => {});
    throw error;
  }
}

module.exports = { compareVersions, downloadAndVerify, promoteDownload, validateManifest };
