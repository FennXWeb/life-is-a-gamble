const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createGameServer } = require("../src/server.cjs");

test("desktop runtime serves the built game and its static assets", async () => {
  const runtime = await createGameServer(path.resolve(__dirname, "..", "..", "dist"));
  try {
    const page = await fetch(`${runtime.origin}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Life is a Gamble/i);

    const stylesheetPath = html.match(/href="([^"]+\.css)"/)?.[1];
    assert.ok(stylesheetPath, "Rendered game HTML should reference its generated stylesheet.");
    const stylesheet = await fetch(`${runtime.origin}${stylesheetPath}`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type") || "", /^text\/css\b/i);
    assert.match(await stylesheet.text(), /\.game-shell\{/);

    const manifest = await fetch(`${runtime.origin}/manifest.json`);
    assert.ok([200, 404].includes(manifest.status));
  } finally {
    await runtime.close();
  }
});
