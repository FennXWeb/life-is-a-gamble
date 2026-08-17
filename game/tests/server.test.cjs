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

test("desktop runtime forwards OpenAI bindings used by dialogue, voice, and transcription", async () => {
  const source = await require("node:fs/promises").readFile(path.resolve(__dirname, "..", "src", "server.cjs"), "utf8");
  assert.match(source, /OPENAI_API_KEY: runtimeEnvironment\.OPENAI_API_KEY/);
  assert.match(source, /OPENAI_STT_MODEL: runtimeEnvironment\.OPENAI_STT_MODEL/);
  const main = await require("node:fs/promises").readFile(path.resolve(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /details\.mediaTypes\.includes\("audio"\)/);
  assert.match(main, /reg\.exe/);
  assert.match(main, /runtimeEnvironmentValue\("OPENAI_API_KEY"\)/);
});

test("desktop transcription route receives recorded audio and returns text", async () => {
  const nativeFetch = global.fetch;
  let transcriptionRequest = null;
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      transcriptionRequest = init;
      return Response.json({ text: "Rowan, can you hear me?" });
    }
    return nativeFetch(input, init);
  };
  const runtime = await createGameServer(path.resolve(__dirname, "..", "..", "dist"), { OPENAI_API_KEY: "test-key" });
  try {
    const form = new FormData();
    form.append("audio", new Blob([Buffer.alloc(1600)], { type: "audio/webm" }), "dialogue.webm");
    const response = await nativeFetch(`${runtime.origin}/api/transcribe`, { method: "POST", body: form });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: "Rowan, can you hear me?" });
    assert.equal(transcriptionRequest?.headers?.Authorization, "Bearer test-key");
    assert.equal(transcriptionRequest?.body?.get("model"), "gpt-4o-mini-transcribe");
    assert.equal(transcriptionRequest?.body?.get("language"), "en");
  } finally {
    global.fetch = nativeFetch;
    await runtime.close();
  }
});
