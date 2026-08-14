import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Life is a Gamble game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Life is a Gamble/);
  assert.match(html, /ENTER SYRACUSE/);
  assert.match(html, /DOWNTOWN SYRACUSE/);
  assert.match(html, /FATE ENGINE/);
  assert.match(html, /slot-machine/);
  assert.doesNotMatch(html, /codex-preview|Building your site/);
});

test("keeps portraits, demographic voices, scaled decor, and jackpot feedback wired", async () => {
  const [page, css, speech, audio] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/speech/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game-audio.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /width: 132, height: 122/);
  assert.match(page, /slotJackpot/);
  assert.match(page, /jackpot-burst/);
  assert.match(css, /\.npc-portrait \.sprite\{[^}]*background-position:0 82%!important/);
  assert.match(css, /\.barricade-prop\{[^}]*width:176px;height:120px/);
  assert.match(css, /@keyframes jackpotCoin/);
  assert.match(speech, /voice: "cedar"/);
  assert.match(speech, /voice: "marin"/);
  assert.match(speech, /demographics:/);
  assert.match(speech, /Keep this identity consistent across every line/);
  assert.match(audio, /sound === "slotJackpot"/);
});

test("uses authored storefront and Syracuse landmark sprites without losing door interactions", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const assets = [
    "../public/landmarks/erie-canal-museum.png",
    "../public/landmarks/syracuse-city-hall.png",
    "../public/landmarks/landmark-theatre.png",
    "../public/storefronts/clinton-provisioners.png",
    "../public/storefronts/salina-market.png",
    "../public/storefronts/salt-city-foundry.png",
    "../public/storefronts/armory-storage.png",
  ];

  await Promise.all(assets.map((asset) => access(new URL(asset, import.meta.url))));
  assert.match(page, /building-facade-art/);
  assert.match(page, /facade-door-hitbox/);
  assert.match(page, /facade=\{\{ kind: "landmark", id: "syracuse-city-hall" \}\}/);
  assert.match(css, /\.building-facade-art\.storefront/);
  assert.match(css, /\.sign-landmark-theatre/);
});
