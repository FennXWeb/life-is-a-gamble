const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { compareVersions, downloadAndVerify, promoteDownload, validateManifest } = require("../src/update-service.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("launcher UI does not expose its update host or repository", () => {
  const visibleLauncherSource = [
    read("src/preload.cjs"),
    read("src/renderer/index.html"),
    read("src/renderer/renderer.js"),
  ].join("\n");
  assert.doesNotMatch(visibleLauncherSource, /github|view repository|open-repository/i);
});

test("successful game launch hides and closes the launcher", () => {
  const main = read("src/main.cjs");
  assert.match(main, /launcherWindow\?\.hide\(\)/);
  assert.match(main, /setTimeout\(\(\) => app\.quit\(\), 250\)/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false/);
  assert.match(main, /phase: "game-downloading"/);
  assert.match(main, /phase: "launcher-downloaded"/);
});

test("launcher uses custom frameless chrome and reports the installed game version", () => {
  const main = read("src/main.cjs");
  const preload = read("src/preload.cjs");
  const renderer = read("src/renderer/renderer.js");
  const html = read("src/renderer/index.html");
  const css = read("src/renderer/styles.css");
  assert.match(main, /frame: false/);
  assert.match(main, /maximizable: false/);
  assert.match(main, /resizable: false/);
  assert.match(main, /launcher:minimize/);
  assert.match(main, /launcher:close/);
  assert.match(main, /gameVersion: await installedGameVersion\(\)/);
  assert.match(preload, /minimizeWindow/);
  assert.match(preload, /closeWindow/);
  assert.match(renderer, /active-game-version/);
  assert.match(html, /id="minimize-window"/);
  assert.match(html, /id="close-window"/);
  assert.doesNotMatch(html, /maximize-window|save data remains|stable public builds/i);
  assert.match(html, /FENNX CREATIVE/);
  assert.match(css, /-webkit-app-region:drag/);
});

test("game updates download, verify, and promote without a launcher restart", async () => {
  assert.equal(compareVersions("1.0.12-testing.0", "1.0.11-testing.0"), 1);
  assert.equal(compareVersions("1.1.0-testing.0", "1.1.0"), 0);
  const payload = Buffer.from("standalone game payload");
  const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
  const manifest = validateManifest({
    schemaVersion: 1,
    channel: "testing",
    game: { version: "1.0.12-testing.0", url: "https://updates.invalid/game.exe", sha256, size: payload.length },
    launcher: { version: "1.1.0-testing.0", url: "https://updates.invalid/launcher.exe", sha256, size: payload.length },
  });
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "liag-update-"));
  const nextPath = path.join(directory, "game.next.exe");
  const installedPath = path.join(directory, "game.exe");
  try {
    await fsp.writeFile(installedPath, "old game");
    await downloadAndVerify(manifest.game, nextPath, () => {}, async () => new Response(payload, { status: 200, headers: { "content-length": String(payload.length) } }));
    await promoteDownload(nextPath, installedPath);
    assert.deepEqual(await fsp.readFile(installedPath), payload);
    await assert.rejects(fsp.access(`${installedPath}.previous`));
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test("release automation publishes the testing channel only", () => {
  const workflow = read("../.github/workflows/launcher-release.yml");
  assert.match(workflow, /branches: \[testing\]/);
  assert.doesNotMatch(workflow, /branches: \[[^\]]*main/);
  assert.match(workflow, /channel-manifest\.json/);
  assert.match(workflow, /PUBLISH_LAUNCHER_BOOTSTRAP/);
});
