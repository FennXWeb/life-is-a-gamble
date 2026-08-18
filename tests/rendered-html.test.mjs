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

async function dialogue(message, overrides = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("dialogue-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  const game = {
    hp: 32, maxHp: 32, ap: 7, enemyHp: 18, rowanHp: 26, combat: "idle", combatTarget: null,
    selectedNpc: "rowan", level: 1, xp: 35, xpGoal: 100, chips: 37, skillPoints: 2,
    unlockedDoors: [], interior: null, playerPosition: { x: 51, y: 71 }, inventory: [], quests: [],
    companions: [{ id: "rowan", name: "Rowan Vale", role: "Scout", status: "available", loyalty: 24, morale: 58, hp: 26, maxHp: 26, opinion: "Wary", abilities: [], history: [] }],
    ...overrides.game,
  };
  return worker.fetch(new Request("http://localhost/api/dialogue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, npc: { trust: 30, respect: 28, fear: 5, mood: "Wary", opinion: "Testing", memories: [] }, skills: { Speech: 4 }, luck: 6, slot: 12, worldFlags: [], location: "Downtown Syracuse", history: [], game, ...overrides }),
  }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Life is a Gamble game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Life is a Gamble/);
  assert.match(html, /NEW GAME/);
  assert.match(html, /LOAD GAME/);
  assert.match(html, /SELECT DEPLOYMENT/);
  assert.doesNotMatch(html, /WAKE THE RADIO|RESTART TITLE SIGNAL|RADIO DORMANT/);
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
  const [page, css, worldCss, nativeRuntime] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/world/world-scene.module.css", import.meta.url), "utf8"),
    readFile(new URL("../game/src/main.cjs", import.meta.url), "utf8"),
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
  assert.match(page, /beginMenuMusic/);
  assert.match(page, /audio\.activate\("menu"\)/);
  assert.match(nativeRuntime, /autoplay-policy", "no-user-gesture-required/);
  assert.match(worldCss, /appearance: none/);
  assert.match(worldCss, /data-sprite-category="structure"/);
  assert.match(page, /facade-door-hitbox/);
  assert.match(page, /facade-door-/);
  assert.match(page, /facade=\{\{ kind: "landmark", id: "syracuse-city-hall" \}\}/);
  assert.match(css, /\.building-facade-art\.storefront/);
  assert.doesNotMatch(page, /className=\{`building-sign/);
  assert.match(css, /--facade-width:263px;--facade-height:500px/);
  assert.match(css, /\.building-facade-art\.facade-syracuse-city-hall\{background-size:112% 100%/);
  assert.match(css, /\.building-facade-art\.facade-landmark-theatre\{background-size:114% 100%/);
  assert.match(css, /\.streetwall-row \.has-facade \.building-cell \.building-tile/);
  assert.match(css, /\.facade-door-syracuse-city-hall/);
  assert.match(css, /\.player-weapon-sprite\{[^}]*width:90px;height:150px/);
  assert.match(css, /saturate\(\.76\) brightness\(\.88\)/);
});

test("dead characters leave persistent lootable corpses and live dialogue uses the default microphone", async () => {
  const [page, css, transcription] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/transcribe/route.ts", import.meta.url), "utf8"),
  ]);
  await access(new URL("../public/character-corpse-atlas.png", import.meta.url));
  assert.match(page, /const corpseLoot/);
  assert.match(page, /lootedCorpses: cloneValue\(lootedCorpses\)/);
  assert.match(page, /kind: "corpse"/);
  assert.match(page, /lootCorpse/);
  assert.match(page, /SpeechRecognition/);
  assert.match(page, /webkitSpeechRecognition/);
  assert.match(page, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(page, /new MediaRecorder/);
  assert.match(page, /fetch\("\/api\/transcribe"/);
  assert.match(page, /volume > \.022/);
  assert.match(page, /life-is-a-gamble-live-conversation/);
  assert.match(page, /speakRef\.current\(clean\)/);
  assert.match(page, /if \(!liveConversation\) queueVoice\(message, "player", "intentional"\)/);
  assert.match(transcription, /gpt-4o-mini-transcribe/);
  assert.match(transcription, /\/v1\/audio\/transcriptions/);
  assert.match(css, /character-corpse-atlas\.png/);
  assert.match(css, /\.live-toggle/);
  assert.match(css, /Atlas safety gutters/);
  assert.match(css, /\.decor-sprite::before\{[^}]*inset:4% 5% 6%/);
  assert.match(css, /\.sprite::before\{[^}]*life-is-a-gamble-sprite-atlas-v2\.png/);
});

test("combat AI moves tactically and the active holster drives weapon art, stats, animation, and SFX", async () => {
  const [page, css, audio, atlas] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/game-audio.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/player-weapon-atlas-v1.png", import.meta.url)),
  ]);
  assert.equal(atlas[25], 6, "weapon atlas must use RGBA color type");
  assert.match(page, /type WeaponType = "unarmed" \| "pistol" \| "rifle" \| "shotgun" \| "melee"/);
  assert.match(page, /const moveCombatActor/);
  assert.match(page, /CLOSING FAST/);
  assert.match(page, /SEEKING ANGLE/);
  assert.match(page, /activeWeapon = inventory\.find/);
  assert.match(page, /function restoreInventory/);
  assert.match(page, /setInventory\(restoreInventory\(save\.inventory\)\)/);
  assert.match(page, /enemyTurnToken\.current \+= 1/);
  assert.match(page, /setActiveHolster\(slot\)/);
  assert.match(page, /<PlayerWeaponSprite weaponType=\{activeWeaponType\} firing=\{weaponFiring\}/);
  assert.match(css, /player-weapon-atlas-v1\.png/);
  assert.match(css, /\.ballistic-fx/);
  assert.match(audio, /sound === "shootPistol"/);
  assert.match(audio, /sound === "shootRifle"/);
  assert.match(audio, /sound === "shootShotgun"/);
});

test("dialogue can create validated quests and recruit a companion", async () => {
  const questResponse = await dialogue("Do you have a job for me?");
  assert.equal(questResponse.status, 200);
  const questTurn = await questResponse.json();
  assert.ok(questTurn.actions.some((action) => action.type === "create_quest" && action.target.startsWith("weighlock-dead-drop|")));

  const recruitResponse = await dialogue("Come with me. Travel together as companions.");
  assert.equal(recruitResponse.status, 200);
  const recruitTurn = await recruitResponse.json();
  assert.ok(recruitTurn.actions.some((action) => action.type === "add_companion" && action.target === "rowan"));
});

test("hostile dialogue lets Rowan initiate combat and take the opening turn", async () => {
  const response = await dialogue("Hand over your gear or I'll shoot you.");
  assert.equal(response.status, 200);
  const turn = await response.json();
  assert.equal(turn.conversationStatus, "end");
  assert.ok(turn.actions.some((action) => action.type === "set_combat" && action.target === "player"));
  assert.ok(turn.actions.some((action) => action.type === "close_dialogue"));

  const [page, route, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dialogue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /startCombat\("rowan", "npc"\)/);
  assert.match(page, /enemyTurn\("rowan"\)/);
  assert.match(page, /Rowan initiated combat/);
  assert.match(route, /always emit set_combat targeting player plus close_dialogue/);
  assert.match(css, /\.conversation-head\.hostile/);
});

test("quest and companion systems are persisted, visible, and included in AI context", async () => {
  const [page, contract, route, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dialogue-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dialogue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const \[quests, setQuests\]/);
  assert.match(page, /const \[companions, setCompanions\]/);
  assert.match(page, /<Journal quests=\{quests\} companions=\{companions\}/);
  assert.match(contract, /"create_quest"/);
  assert.match(contract, /"modify_companion"/);
  assert.match(route, /including every active quest and Rowan's companion record/);
  assert.match(css, /\.journal-columns/);
  assert.match(css, /\.companion-hud/);
});

test("versioned save slots persist the complete RPG state in the native game", async () => {
  const [page, css, nativeRuntime] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../game/src/main.cjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /SAVE_SCHEMA_VERSION = 4/);
  assert.match(page, /MAX_MANUAL_SAVES = 8/);
  assert.match(page, /const makeSnapshot/);
  assert.match(page, /quests: cloneValue\(quests\)/);
  assert.match(page, /companions: cloneValue\(companions\)/);
  assert.match(page, /enemyPosition: cloneValue\(enemyPosition\)/);
  assert.match(page, /rowanPosition: cloneValue\(rowanPosition\)/);
  assert.match(page, /activeHolster,/);
  assert.match(page, /event\.key === "F5"/);
  assert.match(page, /event\.key === "F9"/);
  assert.match(page, /<SaveLoad/);
  assert.match(css, /\.save-slot-list/);
  assert.match(nativeRuntime, /save-slots\.json/);
  assert.match(nativeRuntime, /persistNativeSaves/);
});
