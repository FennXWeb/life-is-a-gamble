import type { LevelObject, SpriteAsset } from "./project-types";

type Category = SpriteAsset["category"];

function frames(prefix: string, path: string, columns: number, rows: number, width: number, height: number, names: string[], category: Category, tags: string[]): SpriteAsset[] {
  return Array.from({ length: columns * rows }, (_, index) => ({
    id: `builtin-${prefix}-${index}`,
    name: names[index] || `${prefix.replaceAll("-", " ")} ${index + 1}`,
    path,
    width: Math.round(width / columns), height: Math.round(height / rows), category, tags, builtIn: true,
    frame: { columns, rows, column: index % columns, row: Math.floor(index / columns) },
  }));
}

const decorNames = ["Rusted fire hydrant", "Abandoned payphone", "Dented postal mailbox", "Overflowing trash cans", "Abandoned newspaper box", "Rusted oil drums", "Broken park bench", "Overturned shopping cart", "Damaged traffic signal", "Stacked sandbags", "Leaning utility pole", "Broken municipal sign"];
const landmarkNames = ["Rusted abandoned sedan", "Bent street lamp", "Scrap checkpoint barricade", "Dead tree planter"];
const environmentNames = Array.from({ length: 16 }, (_, index) => `Syracuse environment tile ${index + 1}`);
environmentNames[3] = "Interior brick floor"; environmentNames[4] = "Interior brick wall"; environmentNames[10] = "Interior scrap counter";
const buildingNames = ["Brick wall tile", "Brick window tile", "Brick door tile", "Brick cornice tile", "Stone wall tile", "Stone window tile", "Stone door tile", "Stone cornice tile", "Metal wall tile", "Metal window tile", "Roof tile", "Damaged roof tile"];
const characterNames = [...Array.from({ length: 5 }, (_, index) => `Courier combat frame ${index + 1}`), ...Array.from({ length: 5 }, (_, index) => `Rabid squirrel frame ${index + 1}`), ...Array.from({ length: 5 }, (_, index) => `Rowan Vale frame ${index + 1}`)];

const standalone: SpriteAsset[] = [
  ["storefront-armory-storage", "Armory Storage", "public/storefronts/armory-storage.png", 469, 437],
  ["storefront-clinton-house", "Clinton House", "public/storefronts/clinton-house.png", 506, 888],
  ["storefront-clinton-provisioners", "Clinton Provisioners", "public/storefronts/clinton-provisioners.png", 489, 436],
  ["storefront-empire-rooms", "Empire Rooms", "public/storefronts/empire-rooms.png", 477, 436],
  ["storefront-hanover-row", "Hanover Row", "public/storefronts/hanover-row.png", 536, 893],
  ["storefront-onondaga-trust", "Onondaga Trust", "public/storefronts/onondaga-trust.png", 472, 439],
  ["storefront-salina-market", "Salina Market", "public/storefronts/salina-market.png", 471, 436],
  ["storefront-salt-city-foundry", "Salt City Foundry", "public/storefronts/salt-city-foundry.png", 467, 436],
  ["storefront-saltworks-exchange", "Saltworks Exchange", "public/storefronts/saltworks-exchange.png", 504, 874],
  ["landmark-erie-canal-museum", "Erie Canal Museum", "public/landmarks/erie-canal-museum.png", 525, 465],
  ["landmark-landmark-theatre", "Landmark Theatre", "public/landmarks/landmark-theatre.png", 517, 629],
  ["landmark-syracuse-city-hall", "Syracuse City Hall", "public/landmarks/syracuse-city-hall.png", 536, 914],
].map(([id, name, path, width, height]) => ({ id: `builtin-${id}`, name: String(name), path: String(path), width: Number(width), height: Number(height), category: "structure", tags: ["built-in", "syracuse", "building"], builtIn: true }));

const catalog: SpriteAsset[] = [
  ...standalone,
  ...frames("character-v2", "public/life-is-a-gamble-sprite-atlas-v2.png", 5, 3, 1536, 1024, characterNames, "character", ["built-in", "character", "current"]),
  ...frames("character-legacy", "public/life-is-a-gamble-sprite-atlas.png", 5, 3, 1536, 1024, characterNames.map((name) => `${name} · legacy`), "character", ["built-in", "character", "legacy"]),
  ...frames("courier-motion", "public/courier-motion-atlas.png", 4, 2, 1536, 1024, ["Courier idle", "Courier ready", "Courier walk 1", "Courier walk 2", "Courier run 1", "Courier run 2", "Courier run 3", "Courier run 4"], "character", ["built-in", "courier", "motion"]),
  ...frames("corpse", "public/character-corpse-atlas.png", 3, 1, 2172, 724, ["Courier corpse", "Rowan Vale corpse", "Rabid squirrel corpse"], "character", ["built-in", "corpse"]),
  ...frames("syracuse-decor", "public/syracuse-decor-atlas.png", 4, 3, 1448, 1086, decorNames, "prop", ["built-in", "syracuse", "decor"]),
  ...frames("syracuse-environment", "public/syracuse-environment-atlas.png", 4, 4, 1254, 1254, environmentNames, "terrain", ["built-in", "syracuse", "environment"]),
  ...frames("syracuse-landmark", "public/syracuse-landmark-atlas.png", 2, 2, 1254, 1254, landmarkNames, "prop", ["built-in", "syracuse", "landmark"]),
  ...frames("modular-building", "public/modular-building-atlas.png", 4, 3, 1448, 1086, buildingNames, "structure", ["built-in", "building", "tile"]),
  ...frames("hud-material", "public/hud-material-atlas.png", 3, 2, 1536, 1024, ["Dark steel panel", "Worn brass panel", "Field terminal panel", "Amber control panel", "Radio display panel", "Olive equipment panel"], "effect", ["built-in", "interface", "material"]),
];

export function builtInSprites() { return catalog.map((asset) => ({ ...asset, tags: [...asset.tags], frame: asset.frame ? { ...asset.frame } : undefined })); }

function placed(id: string, spriteId: string, layerId: string, name: string, x: number, y: number, width: number, height: number, collision = false): LevelObject {
  return { id, levelId: "syracuse-salt-yard", layerId, name, spriteId, x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, tint: "#ffffff", collision: { enabled: collision, shape: "rectangle", solid: collision, trigger: false, tag: collision ? "building" : "" } };
}

export function builtInSyracuseScene(objectLayerId: string, entityLayerId: string): LevelObject[] {
  const buildings = [["onondaga-trust", 2, 4, 11, 17], ["erie-canal-museum", 13, 4, 12, 17], ["clinton-provisioners", 26, 5, 11, 16], ["salina-market", 38, 5, 11, 16], ["empire-rooms", 50, 4, 10, 17], ["clinton-house", 61, 2, 10, 20], ["syracuse-city-hall", 72, 1, 11, 21], ["salt-city-foundry", 84, 5, 12, 16]] as const;
  const spriteFor = (name: string) => name === "erie-canal-museum" || name === "syracuse-city-hall" ? `builtin-landmark-${name}` : `builtin-storefront-${name}`;
  const result = buildings.map(([name, x, y, width, height]) => placed(`scene-${name}`, spriteFor(name), objectLayerId, name.replaceAll("-", " "), x, y, width, height, true));
  result.push(
    placed("scene-landmark-theatre", "builtin-landmark-landmark-theatre", objectLayerId, "Landmark Theatre", 4, 73, 13, 22, true),
    placed("scene-armory-storage", "builtin-storefront-armory-storage", objectLayerId, "Armory Storage", 18, 77, 12, 17, true),
    placed("scene-hanover-row", "builtin-storefront-hanover-row", objectLayerId, "Hanover Row", 72, 75, 11, 21, true),
    placed("scene-saltworks-exchange", "builtin-storefront-saltworks-exchange", objectLayerId, "Saltworks Exchange", 85, 74, 11, 22, true),
    placed("scene-car", "builtin-syracuse-landmark-0", objectLayerId, "Rusted abandoned sedan", 28, 48, 8, 7, true),
    placed("scene-lamp", "builtin-syracuse-landmark-1", objectLayerId, "Bent street lamp", 68, 43, 4, 9, true),
    placed("scene-barricade", "builtin-syracuse-landmark-2", objectLayerId, "Scrap checkpoint barricade", 51, 58, 10, 6, true),
    placed("scene-tree", "builtin-syracuse-landmark-3", objectLayerId, "Dead tree planter", 88, 56, 6, 10, true),
    placed("scene-hydrant", "builtin-syracuse-decor-0", objectLayerId, "Rusted fire hydrant", 41, 53, 3, 4, true),
    placed("scene-payphone", "builtin-syracuse-decor-1", objectLayerId, "Abandoned payphone", 6, 54, 4, 7, true),
    placed("scene-mailbox", "builtin-syracuse-decor-2", objectLayerId, "Dented postal mailbox", 64, 52, 4, 5, true),
    placed("scene-barrels", "builtin-syracuse-decor-5", objectLayerId, "Rusted oil drums", 47, 82, 6, 6, true),
    placed("scene-bench", "builtin-syracuse-decor-6", objectLayerId, "Broken park bench", 21, 52, 8, 5, true),
    placed("scene-sandbags", "builtin-syracuse-decor-9", objectLayerId, "Stacked sandbags", 56, 81, 8, 5, true),
    placed("scene-courier", "builtin-courier-motion-1", entityLayerId, "The Courier", 47, 66, 7, 10),
    placed("scene-rowan", "builtin-character-v2-10", entityLayerId, "Rowan Vale", 35, 65, 7, 10),
    placed("scene-squirrel", "builtin-character-v2-5", entityLayerId, "Rabid squirrel", 65, 62, 6, 7),
  );
  return result;
}
