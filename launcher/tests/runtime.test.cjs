const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("launcher UI does not expose its update host or repository", () => {
  const visibleLauncherSource = [
    read("src/main.cjs"),
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
  assert.match(main, /no newer channel build/i);
});
