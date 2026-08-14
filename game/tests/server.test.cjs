const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createGameServer } = require("../src/server.cjs");

test("desktop runtime serves the built game and its static assets", async () => {
  const runtime = await createGameServer(path.resolve(__dirname, "..", "..", "dist"));
  try {
    const page = await fetch(`${runtime.origin}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Life is a Gamble/i);

    const manifest = await fetch(`${runtime.origin}/manifest.json`);
    assert.ok([200, 404].includes(manifest.status));
  } finally {
    await runtime.close();
  }
});
