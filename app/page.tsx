"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useGameAudio } from "./game-audio";
import type { CompanionState, DialogueAction, DialogueGameSnapshot, DialogueTurn, QuestState } from "./dialogue-contract";
import type { GameProject, LevelObject, SpriteAsset } from "./editor/project-types";
import { WorldScene } from "./world/world-scene";

type Panel = "inventory" | "skills" | "map" | "journal" | "dialogue" | "help" | "saves" | null;
type CombatState = "idle" | "player" | "enemy" | "won";
type NpcId = "rowan" | "squirrel";
type LogEntry = { id: number; tone: "system" | "good" | "bad" | "plain"; text: string };
type InteractionTarget = {
  id: string;
  label: string;
  kind: "door" | "prop" | "npc" | "corpse";
  locked?: boolean;
  lockpick?: boolean;
  inaccessible?: boolean;
  interior?: string;
  action?: "search" | "inspect";
  npcId?: NpcId;
  corpseId?: NpcId;
  canTalk?: boolean;
  authoredType?: SpriteAsset["category"];
  tags?: string[];
  trigger?: boolean;
};
type NpcState = {
  trust: number;
  respect: number;
  fear: number;
  mood: string;
  opinion: string;
  memories: string[];
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionController = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type WorldPoint = { x: number; y: number };
type WorldViewport = { left: number; top: number; width: number; height: number };
type WeaponType = "unarmed" | "pistol" | "rifle" | "shotgun" | "melee";
type HolsterSlot = "holster-left" | "holster-right";
type CollisionZone =
  | { kind: "rect"; x1: number; x2: number; y1: number; y2: number; label: string }
  | { kind: "ellipse"; x: number; y: number; rx: number; ry: number; label: string };

const WALKABLE_BOUNDS = { x1: 4, x2: 96, y1: 46.5, y2: 90 };
const PLAYER_CLEARANCE = { x: 1.15, y: .8 };

const fixedCollisionZones: CollisionZone[] = [
  { kind: "rect", x1: 0, x2: 100, y1: 0, y2: 45.6, label: "North Fayette building frontage" },
  { kind: "ellipse", x: 70, y: 79, rx: 5.7, ry: 2.7, label: "abandoned sedan" },
  { kind: "ellipse", x: 40, y: 57, rx: 1.5, ry: 1.25, label: "street lamp" },
  { kind: "ellipse", x: 58, y: 84, rx: 6.2, ry: 2.8, label: "scrap barricade" },
  { kind: "ellipse", x: 34, y: 61, rx: 3.2, ry: 1.8, label: "dead tree planter" },
];

function pointBlocked(point: WorldPoint, dynamicZones: CollisionZone[] = [], bounds = WALKABLE_BOUNDS, includeLegacy = true) {
  if (point.x < bounds.x1 || point.x > bounds.x2 || point.y < bounds.y1 || point.y > bounds.y2) return true;
  return [...(includeLegacy ? fixedCollisionZones : []), ...dynamicZones].some((zone) => {
    if (zone.kind === "rect") return point.x >= zone.x1 - PLAYER_CLEARANCE.x && point.x <= zone.x2 + PLAYER_CLEARANCE.x && point.y >= zone.y1 - PLAYER_CLEARANCE.y && point.y <= zone.y2 + PLAYER_CLEARANCE.y;
    const dx = (point.x - zone.x) / (zone.rx + PLAYER_CLEARANCE.x);
    const dy = (point.y - zone.y) / (zone.ry + PLAYER_CLEARANCE.y);
    return dx * dx + dy * dy <= 1;
  });
}

function segmentIsClear(from: WorldPoint, to: WorldPoint, dynamicZones: CollisionZone[] = [], bounds = WALKABLE_BOUNDS, includeLegacy = true) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / .55));
  for (let step = 1; step <= steps; step++) {
    const amount = step / steps;
    if (pointBlocked({ x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount }, dynamicZones, bounds, includeLegacy)) return false;
  }
  return true;
}

function findWalkPath(start: WorldPoint, requestedTarget: WorldPoint, dynamicZones: CollisionZone[] = [], bounds = WALKABLE_BOUNDS, includeLegacy = true) {
  const step = 1.8;
  const columns = Math.floor((bounds.x2 - bounds.x1) / step) + 1;
  const rows = Math.floor((bounds.y2 - bounds.y1) / step) + 1;
  const toPoint = (column: number, row: number): WorldPoint => ({ x: bounds.x1 + column * step, y: bounds.y1 + row * step });
  const nearestCell = (point: WorldPoint) => ({
    column: Math.max(0, Math.min(columns - 1, Math.round((point.x - bounds.x1) / step))),
    row: Math.max(0, Math.min(rows - 1, Math.round((point.y - bounds.y1) / step))),
  });
  const requestedCell = nearestCell(requestedTarget);
  let targetCell = requestedCell;
  if (pointBlocked(toPoint(targetCell.column, targetCell.row), dynamicZones, bounds, includeLegacy)) {
    let nearest: { column: number; row: number; distance: number } | null = null;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const point = toPoint(column, row);
      if (pointBlocked(point, dynamicZones, bounds, includeLegacy)) continue;
      const distance = Math.hypot(column - requestedCell.column, row - requestedCell.row);
      if (!nearest || distance < nearest.distance) nearest = { column, row, distance };
    }
    if (!nearest) return [];
    targetCell = nearest;
  }
  const startCell = nearestCell(start);
  const key = (column: number, row: number) => `${column},${row}`;
  const targetKey = key(targetCell.column, targetCell.row);
  const open = [{ ...startCell, score: 0 }];
  const cameFrom = new Map<string, string>();
  const cost = new Map<string, number>([[key(startCell.column, startCell.row), 0]]);
  const directions = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ dx, dy }))).filter(({ dx, dy }) => dx || dy);
  let found = false;
  while (open.length) {
    open.sort((a, b) => a.score - b.score);
    const current = open.shift()!;
    const currentKey = key(current.column, current.row);
    if (currentKey === targetKey) { found = true; break; }
    for (const { dx, dy } of directions) {
      const column = current.column + dx;
      const row = current.row + dy;
      if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
      const point = toPoint(column, row);
      if (pointBlocked(point, dynamicZones, bounds, includeLegacy)) continue;
      if (dx && dy && (pointBlocked(toPoint(current.column + dx, current.row), dynamicZones, bounds, includeLegacy) || pointBlocked(toPoint(current.column, current.row + dy), dynamicZones, bounds, includeLegacy))) continue;
      const nextKey = key(column, row);
      const nextCost = (cost.get(currentKey) ?? 0) + (dx && dy ? 1.414 : 1);
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost);
      cameFrom.set(nextKey, currentKey);
      open.push({ column, row, score: nextCost + Math.hypot(targetCell.column - column, targetCell.row - row) });
    }
  }
  if (!found) return [];
  const cells: WorldPoint[] = [];
  let cursor = targetKey;
  while (cursor !== key(startCell.column, startCell.row)) {
    const [column, row] = cursor.split(",").map(Number);
    cells.unshift(toPoint(column, row));
    cursor = cameFrom.get(cursor)!;
  }
  const candidates = [start, ...cells];
  const route: WorldPoint[] = [];
  let anchor = 0;
  while (anchor < candidates.length - 1) {
    let furthest = anchor + 1;
    for (let next = anchor + 2; next < candidates.length; next++) {
      if (!segmentIsClear(candidates[anchor], candidates[next], dynamicZones, bounds, includeLegacy)) break;
      furthest = next;
    }
    route.push(candidates[furthest]);
    anchor = furthest;
  }
  if (!pointBlocked(requestedTarget, dynamicZones, bounds, includeLegacy) && segmentIsClear(route.at(-1) ?? start, requestedTarget, dynamicZones, bounds, includeLegacy)) route.push(requestedTarget);
  return route;
}

const cities = [
  { name: "Niagara Falls", x: 5, y: 39, kind: "landmark", detail: "The water still falls. Everything around it does not." },
  { name: "Buffalo", x: 10, y: 57, kind: "city", detail: "Lakewall Exchange — caravans, grain futures, and old-world steel." },
  { name: "Letchworth", x: 22, y: 68, kind: "landmark", detail: "The Grand Scar — bridges above a poisoned gorge." },
  { name: "Rochester", x: 29, y: 48, kind: "city", detail: "The Glassworks — a river city lit by salvaged projectors." },
  { name: "Finger Lakes", x: 39, y: 65, kind: "landmark", detail: "Wine vaults, flooded estates, and the Vineyard Clans." },
  { name: "Syracuse", x: 49, y: 53, kind: "current", detail: "Salt Yard — your road begins in the ruins of the old fairgrounds." },
  { name: "Fort Stanwix", x: 63, y: 43, kind: "landmark", detail: "A reconstructed fort reconstructed again, this time with scrap steel." },
  { name: "Adirondack Preserve", x: 70, y: 23, kind: "landmark", detail: "Black pines, radio ghosts, and things larger than deer." },
  { name: "Saratoga", x: 80, y: 39, kind: "landmark", detail: "The battlefield is neutral ground for the summer armistice." },
  { name: "ALBANY CITADEL", x: 87, y: 54, kind: "citadel", detail: "The Marble Crown — fortress capital of the Provisional Continuity." },
  { name: "Binghamton", x: 56, y: 82, kind: "city", detail: "The Carousel Warrens — tunnels, machines, and clockwork taxes." },
  { name: "Watertown", x: 53, y: 26, kind: "city", detail: "Northwatch — the last warm stop before the old border." },
];

const playableCity = "Syracuse";

const initialSkills = { Guns: 3, Barter: 2, Speech: 3, Survival: 4, Medicine: 1, Mechanics: 2 };
const initialQuests: QuestState[] = [{
  id: "salt-yard-pest",
  title: "Rabid in the Ruins",
  description: "A fever-maddened squirrel is stalking the Fayette Street crossing. Put it down before it reaches the occupied blocks.",
  giver: "Salt Yard survivors",
  status: "active",
  objectives: [{ id: "salt-yard-pest-1", text: "Kill the rabid squirrel near Armory Alley", complete: false }],
  rewardXp: 30,
  history: ["The Courier encountered the animal in downtown Syracuse."],
  updatedAt: 1,
}];
const initialCompanions: CompanionState[] = [{
  id: "rowan",
  name: "Rowan Vale",
  role: "Scout · Survival / Speech",
  status: "available",
  loyalty: 18,
  morale: 58,
  hp: 26,
  maxHp: 26,
  opinion: "Watching to see what the Courier does when the plan breaks.",
  abilities: ["Roadwise: +5% ranged accuracy", "Second Barrel: +2 damage against non-human threats"],
  history: ["Met the Courier at the Salt Yard."],
}];
const reelSymbols = ["♠", "7", "☢", "♦", "★", "BAR"];

type EquipSlot = "head" | "torso" | "legs" | "hands" | "feet" | "holster-left" | "holster-right";
type InventoryItem = { id: number; name: string; icon: string; x: number; y: number; w: number; h: number; note: string; weight: number; fits?: Exclude<EquipSlot, "holster-left" | "holster-right"> | "holster"; equipped: EquipSlot | null; weaponType?: Exclude<WeaponType, "unarmed">; damage?: [number, number]; attackAp?: number; accuracy?: number };

const ACTIVE_SAVE_KEY = "life-is-a-gamble-save";
const SAVE_SLOTS_KEY = "life-is-a-gamble-save-slots";
const SAVE_SCHEMA_VERSION = 4;
const MAX_MANUAL_SAVES = 8;

type GameSnapshot = {
  schemaVersion: number;
  savedAt: string;
  playtimeSeconds: number;
  level: number;
  xp: number;
  chips: number;
  skills: typeof initialSkills;
  skillPoints: number;
  npc: NpcState;
  worldFlags: string[];
  conversation: { speaker: string; text: string }[];
  location: string;
  hp: number;
  maxHp: number;
  ap: number;
  enemyHp: number;
  rowanHp: number;
  combat: CombatState;
  combatTarget: NpcId | null;
  selectedNpc: NpcId | null;
  unlockedDoors: string[];
  playerPosition: WorldPoint;
  enemyPosition: WorldPoint;
  rowanPosition: WorldPoint;
  lootedCorpses: NpcId[];
  inventory: InventoryItem[];
  quests: QuestState[];
  companions: CompanionState[];
  interior: string | null;
  selectedAction: string;
  activeHolster: HolsterSlot;
  log: LogEntry[];
};

type SaveSlot = {
  id: string;
  name: string;
  kind: "manual" | "quick" | "auto";
  createdAt: string;
  updatedAt: string;
  snapshot: GameSnapshot;
};

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function formatPlaytime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

const inventoryItems: InventoryItem[] = [
  { id: 1, name: "Pipe Pistol", icon: "⌐", x: 0, y: 0, w: 2, h: 1, note: "5–9 DMG · .22 scrapshot", weight: 2.1, fits: "holster", equipped: "holster-right", weaponType: "pistol", damage: [5, 9], attackAp: 3, accuracy: 0 },
  { id: 2, name: "Road Coat", icon: "♜", x: 3, y: 0, w: 2, h: 3, note: "+1 Armor · many pockets", weight: 4.2, fits: "torso", equipped: "torso" },
  { id: 3, name: "Dried Apples", icon: "●", x: 2, y: 0, w: 1, h: 1, note: "+8 HP · tastes like paper", weight: .4, equipped: null },
  { id: 4, name: "Bent Lockpick", icon: "⌁", x: 0, y: 0, w: 1, h: 2, note: "+5% Lockpick · fragile", weight: .1, equipped: null },
  { id: 5, name: "Old Chips", icon: "◉", x: 3, y: 0, w: 2, h: 2, note: "Currency · 37 chips", weight: 1.2, equipped: null },
  { id: 7, name: "Welding Hood", icon: "◒", x: 6, y: 0, w: 2, h: 2, note: "+1 Perception defense · smoked lens", weight: 1.8, fits: "head", equipped: null },
  { id: 8, name: "Work Gloves", icon: "✥", x: 8, y: 0, w: 2, h: 1, note: "+1 Mechanics · cracked leather", weight: .6, fits: "hands", equipped: null },
  { id: 9, name: "Road Boots", icon: "⌊", x: 8, y: 2, w: 2, h: 2, note: "+1 Survival · resoled twice", weight: 2.4, fits: "feet", equipped: null },
  { id: 10, name: "Canvas Trousers", icon: "⋔", x: 6, y: 3, w: 2, h: 2, note: "+2 carry weight · reinforced knees", weight: 1.5, fits: "legs", equipped: null },
  { id: 11, name: "Scrap Knife", icon: "†", x: 0, y: 3, w: 1, h: 2, note: "3–6 DMG · quiet and close", weight: .8, fits: "holster", equipped: null, weaponType: "melee", damage: [3, 6], attackAp: 3, accuracy: 8 },
  { id: 12, name: "Service Rifle", icon: "⌁", x: 0, y: 5, w: 3, h: 1, note: "7–12 DMG · accurate at range", weight: 4.6, fits: "holster", equipped: null, weaponType: "rifle", damage: [7, 12], attackAp: 4, accuracy: 10 },
  { id: 13, name: "Coach Shotgun", icon: "═", x: 3, y: 5, w: 3, h: 1, note: "9–15 DMG · brutal up close", weight: 5.2, fits: "holster", equipped: null, weaponType: "shotgun", damage: [9, 15], attackAp: 5, accuracy: -6 },
];

const weaponTemplates = new Map(inventoryItems.filter((item) => item.weaponType).map((item) => [item.name, item]));

function restoreInventory(items: InventoryItem[]) {
  return items.map((item) => {
    const template = weaponTemplates.get(item.name);
    return template ? { ...item, weaponType: template.weaponType, damage: template.damage, attackAp: template.attackAp, accuracy: template.accuracy, fits: template.fits } : item;
  });
}

const dialogueItemCatalog: Record<string, InventoryItem> = {
  "rowan-map": { id: 101, name: "Rowan's Transit Map", icon: "⌁", x: 0, y: 0, w: 1, h: 1, note: "Annotated safe lanes · Rowan's handwriting", weight: .1, equipped: null },
  "chicory-flask": { id: 102, name: "Chicory Flask", icon: "◒", x: 0, y: 0, w: 1, h: 2, note: "+4 HP · bitter enough to work", weight: .5, equipped: null },
  "field-bandage": { id: 103, name: "Field Bandage", icon: "+", x: 0, y: 0, w: 1, h: 1, note: "+6 HP · clean by wasteland standards", weight: .2, equipped: null },
  "scrapshot-box": { id: 104, name: "Scrapshot Box", icon: "∷", x: 0, y: 0, w: 1, h: 1, note: "12 rounds · mixed .22 scrapshot", weight: .7, equipped: null },
  "spare-lockpick": { id: 105, name: "Spare Lockpick", icon: "⌁", x: 0, y: 0, w: 1, h: 2, note: "+5% Lockpick · Rowan's spare", weight: .1, equipped: null },
};

const corpseLoot: Record<NpcId, InventoryItem[]> = {
  squirrel: [
    { id: 201, name: "Squirrel Tail", icon: "〰", x: 0, y: 0, w: 1, h: 2, note: "Trophy · fever-warm fur", weight: .3, equipped: null },
  ],
  rowan: [
    { id: 202, name: "Rowan's Revolver", icon: "⌐", x: 0, y: 0, w: 2, h: 1, note: "7–11 DMG · worn walnut grip", weight: 2.4, fits: "holster", equipped: null, weaponType: "pistol", damage: [7, 11], attackAp: 3, accuracy: 5 },
    { ...dialogueItemCatalog["rowan-map"], id: 203 },
  ],
};

function inventoryKey(item: InventoryItem) {
  return item.name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function findInventorySpace(items: InventoryItem[], width: number, height: number) {
  const packed = items.filter((item) => !item.equipped);
  for (let y = 0; y <= 6 - height; y++) for (let x = 0; x <= 10 - width; x++) {
    const clear = packed.every((item) => x + width <= item.x || item.x + item.w <= x || y + height <= item.y || item.y + item.h <= y);
    if (clear) return { x, y };
  }
  return null;
}

function Sprite({ row, col, label, className = "" }: { row: number; col: number; label: string; className?: string }) {
  return (
    <div
      className={`sprite ${className}`}
      role="img"
      aria-label={label}
      style={{ backgroundPosition: `${col * 25}% ${row * 50}%` }}
    />
  );
}

function CorpseSprite({ character, label }: { character: "courier" | NpcId; label: string }) {
  const column = character === "courier" ? 0 : character === "rowan" ? 1 : 2;
  return <div className={`corpse-sprite corpse-${character}`} role="img" aria-label={label} style={{ backgroundPosition: `${column * 50}% 50%` }} />;
}

function NpcActor({ className, status, statusTone, row, col, label, motion = "idle", facing = "right", position, transitionMs = 0, selected = false, onClick, onContextMenu }: {
  className: string;
  status: string;
  statusTone: "npc" | "enemy";
  row: number;
  col: number;
  label: string;
  motion?: "idle" | "patrol" | "combat" | "attack";
  facing?: "left" | "right";
  position: WorldPoint;
  transitionMs?: number;
  selected?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return <button
    className={`npc-actor ${className} ${motion}${selected ? " targeted" : ""}`}
    data-facing={facing}
    style={{ left: `${position.x}%`, top: `${position.y}%`, transitionDuration: `${transitionMs}ms` }}
    onClick={onClick}
    onContextMenu={onContextMenu}
    aria-label={label}
    aria-pressed={selected}
  >
    <div className={`status-tag ${statusTone}`}>{status}</div>
    <Sprite row={row} col={col} label={label} />
    <div className="entity-ring" />
  </button>;
}

function CourierMotionSprite({ mode, frame, label }: { mode: "idle" | "walk" | "run"; frame: number; label: string }) {
  const row = mode === "run" ? 1 : 0;
  const col = mode === "idle" ? 1 : frame;
  return (
    <div
      className="courier-motion-sprite"
      role="img"
      aria-label={label}
      style={{ backgroundPosition: `${col * 33.333}% ${row * 100}%` }}
    />
  );
}

function PlayerWeaponSprite({ weaponType, firing, label }: { weaponType: WeaponType; firing: boolean; label: string }) {
  const columns: Record<WeaponType, number> = { unarmed: 0, pistol: 1, rifle: 2, shotgun: 3, melee: 4 };
  return <div
    className={`player-weapon-sprite weapon-${weaponType}${firing ? " firing" : ""}`}
    role="img"
    aria-label={label}
    style={{ backgroundPosition: `${columns[weaponType] * 25}% ${firing ? 100 : 0}%` }}
  />;
}

function EnvSprite({ row, col, label, className = "", style }: { row: number; col: number; label: string; className?: string; style?: CSSProperties }) {
  return <div className={`env-sprite ${className}`} role="img" aria-label={label} style={{ ...style, backgroundPosition: `${col * 33.333}% ${row * 33.333}%` }} />;
}

function DecorSprite({ row, col, label, className = "", x, y, width, height }: { row: number; col: number; label: string; className?: string; x: number; y: number; width: number; height: number }) {
  return <div className={`decor-sprite ${className}`} role="img" aria-label={label} style={{ left: `${x}%`, top: `${y}%`, width, height, backgroundPosition: `${col * 33.333}% ${row * 50}%` }} />;
}

function LandmarkSprite({ row, col, label, className = "" }: { row: number; col: number; label: string; className?: string }) {
  return <div className={`landmark-sprite ${className}`} role="img" aria-label={label} style={{ backgroundPosition: `${col * 100}% ${row * 100}%` }} />;
}

function BuildingTile({ row, col, className = "" }: { row: number; col: number; className?: string }) {
  return <div className={`building-tile ${className}`} style={{ backgroundPosition: `${col * 33.333}% ${row * 50}%` }} />;
}

type ModularBuildingProps = {
  className: string;
  name: string;
  subtitle: string;
  material: "brick" | "stone" | "metal";
  floors: number;
  bays: number;
  door?: InteractionTarget;
  doorBay?: number;
  storefront?: boolean;
  damaged?: boolean;
  facade?: {
    kind: "storefront" | "full" | "landmark";
    id: string;
  };
  onInteract: (event: React.MouseEvent, target: InteractionTarget) => void;
};

function ModularBuilding({ className, name, subtitle, material, floors, bays, door, doorBay = 1, storefront = false, damaged = false, facade, onInteract }: ModularBuildingProps) {
  const materialRow = material === "stone" ? 1 : material === "metal" ? 2 : 0;
  const cells = Array.from({ length: floors * bays }, (_, index) => {
    const floor = Math.floor(index / bays);
    const bay = index % bays;
    const groundFloor = floor === floors - 1;
    const isDoor = Boolean(door && groundFloor && bay === Math.min(doorBay, bays - 1));
    let row = materialRow;
    let col = 0;
    if (material === "metal") col = 3;
    else if (storefront && groundFloor && !isDoor) { row = 2; col = 1; }
    else if (floor < floors - 1) col = damaged && (index + bay) % 5 === 0 ? 2 : material === "stone" && bay % 3 === 0 ? 2 : 1;
    else col = bay % 2 === 0 ? 0 : 1;
    if (isDoor) { row = 2; col = 0; }
    const tile = <BuildingTile row={row} col={col} className={isDoor ? "door-tile" : ""} />;
    if (facade) return <div key={index} className="building-cell">{tile}</div>;
    return isDoor && door ? <button key={index} className="building-door-cell" onClick={(event) => onInteract(event, door)} onContextMenu={(event) => onInteract(event, door)} aria-label={`Interact with ${door.label}`}>{tile}</button> : <div key={index} className="building-cell">{tile}</div>;
  });
  return <section className={`modular-building ${className} ${material}${facade ? ` has-facade facade-kind-${facade.kind} facade-id-${facade.id}` : ""}`} style={{ "--bays": bays, "--floors": floors } as CSSProperties} aria-label={`${name} — ${subtitle}`} onClick={(event) => event.stopPropagation()}>
    <div className="building-roof"><BuildingTile row={2} col={2} /></div>
    <div className="building-side">{Array.from({ length: floors }, (_, floor) => <BuildingTile key={floor} row={material === "stone" ? 1 : 0} col={0} />)}</div>
    <div className="building-face">
      {facade && <div className={`building-facade-art ${facade.kind} facade-${facade.id}`} style={{ backgroundImage: `url('/${facade.kind === "landmark" ? "landmarks" : "storefronts"}/${facade.id}.png')` }} aria-hidden="true" />}
      {cells}
      {facade && door && <button className={`facade-door-hitbox facade-door-${facade.id}`} onClick={(event) => onInteract(event, door)} onContextMenu={(event) => onInteract(event, door)} aria-label={`Interact with ${door.label}`}><span>ENTRY</span></button>}
    </div>
    <div className="building-cornice"><BuildingTile row={material === "stone" ? 1 : 0} col={3} /></div>
  </section>;
}

const interactions: Record<string, InteractionTarget> = {
  supplyDoor: { id: "supply-door", label: "Clinton Provisioners", kind: "door", locked: true, lockpick: true, interior: "Clinton Provisioners" },
  museumDoor: { id: "museum-door", label: "Erie Canal Museum Archive", kind: "door", interior: "Erie Canal Museum Archive" },
  theaterDoor: { id: "theater-door", label: "Landmark Theatre Stage Door", kind: "door", inaccessible: true },
  cityHallDoor: { id: "city-hall-door", label: "Syracuse City Hall Records Annex", kind: "door", locked: true, lockpick: true, interior: "City Hall Records Annex" },
  sedan: { id: "rusted-sedan", label: "Abandoned Sedan", kind: "prop", action: "search" },
  lamp: { id: "erie-lamp", label: "Erie Boulevard Street Lamp", kind: "prop", action: "inspect" },
  marketDoor: { id: "market-door", label: "Salina Market", kind: "door", inaccessible: true },
  houseDoor: { id: "house-door", label: "Clinton House", kind: "door", inaccessible: true },
  warehouseDoor: { id: "warehouse-door", label: "Armory Storage", kind: "door", inaccessible: true },
  rowhouseDoor: { id: "rowhouse-door", label: "Hanover Row", kind: "door", inaccessible: true },
  foundryDoor: { id: "foundry-door", label: "Salt City Foundry", kind: "door", inaccessible: true },
  bankDoor: { id: "bank-door", label: "Onondaga Trust", kind: "door", inaccessible: true },
  hotelDoor: { id: "hotel-door", label: "Empire Rooms", kind: "door", inaccessible: true },
  saltworksDoor: { id: "saltworks-door", label: "Saltworks Exchange", kind: "door", inaccessible: true },
};

const npcInteractions: Record<NpcId, InteractionTarget> = {
  rowan: { id: "npc-rowan", label: "Rowan Vale", kind: "npc", npcId: "rowan", canTalk: true },
  squirrel: { id: "npc-squirrel", label: "Rabid Squirrel", kind: "npc", npcId: "squirrel", canTalk: false },
};

const corpseInteractions: Record<NpcId, InteractionTarget> = {
  rowan: { id: "corpse-rowan", label: "Rowan Vale's Body", kind: "corpse", corpseId: "rowan" },
  squirrel: { id: "corpse-squirrel", label: "Rabid Squirrel Corpse", kind: "corpse", corpseId: "squirrel" },
};

const cityDecor = [
  { row: 0, col: 0, label: "Rusted fire hydrant", className: "decor-hydrant-a", x: 42, y: 54, width: 52, height: 64, rx: 1.25, ry: 1 },
  { row: 0, col: 0, label: "Rusted fire hydrant", className: "decor-hydrant-b", x: 62, y: 82, width: 52, height: 64, rx: 1.25, ry: 1 },
  { row: 0, col: 1, label: "Abandoned payphone", className: "decor-payphone", x: 3, y: 53, width: 92, height: 128, rx: 2.1, ry: 1.4 },
  { row: 0, col: 2, label: "Dented postal mailbox", className: "decor-mailbox-a", x: 65, y: 53, width: 66, height: 80, rx: 1.6, ry: 1.1 },
  { row: 0, col: 2, label: "Dented postal mailbox", className: "decor-mailbox-b", x: 94, y: 81, width: 66, height: 80, rx: 1.6, ry: 1.1 },
  { row: 0, col: 3, label: "Overflowing trash cans", className: "decor-trash-a", x: 13, y: 52, width: 116, height: 104, rx: 2.6, ry: 1.55 },
  { row: 0, col: 3, label: "Overflowing trash cans", className: "decor-trash-b", x: 87, y: 72, width: 112, height: 100, rx: 2.5, ry: 1.5 },
  { row: 1, col: 0, label: "Abandoned newspaper box", className: "decor-news-a", x: 34, y: 52, width: 72, height: 88, rx: 1.55, ry: 1 },
  { row: 1, col: 0, label: "Abandoned newspaper box", className: "decor-news-b", x: 77, y: 81, width: 72, height: 88, rx: 1.55, ry: 1 },
  { row: 1, col: 1, label: "Rusted oil drums", className: "decor-barrels-a", x: 7, y: 72, width: 132, height: 122, rx: 3.3, ry: 1.75 },
  { row: 1, col: 1, label: "Rusted oil drums", className: "decor-barrels-b", x: 48, y: 84, width: 128, height: 118, rx: 3.2, ry: 1.7 },
  { row: 1, col: 2, label: "Broken park bench", className: "decor-bench-a", x: 22, y: 52, width: 142, height: 104, rx: 4, ry: 1.25 },
  { row: 1, col: 2, label: "Broken park bench", className: "decor-bench-b", x: 84, y: 52, width: 136, height: 100, rx: 3.8, ry: 1.2 },
  { row: 1, col: 3, label: "Overturned shopping cart", className: "decor-cart", x: 72, y: 72, width: 122, height: 100, rx: 3.2, ry: 1.45 },
  { row: 2, col: 0, label: "Damaged traffic signal", className: "decor-signal", x: 46, y: 52, width: 112, height: 140, rx: 2.1, ry: 1.35 },
  { row: 2, col: 1, label: "Stacked sandbags", className: "decor-sandbags", x: 57, y: 83, width: 150, height: 108, rx: 4.1, ry: 1.45 },
  { row: 2, col: 2, label: "Leaning utility pole", className: "decor-pole", x: 68, y: 54, width: 122, height: 174, rx: 1.85, ry: 1.25 },
  { row: 2, col: 3, label: "Broken municipal sign", className: "decor-sign", x: 18, y: 79, width: 88, height: 114, rx: 1.7, ry: 1.05 },
];

fixedCollisionZones.push(...cityDecor.map((decor): CollisionZone => ({ kind: "ellipse", x: decor.x, y: decor.y, rx: decor.rx, ry: decor.ry, label: decor.label })));

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function parseActionTarget(target: string) {
  return target.split("|").map((part) => part.trim());
}

export default function Home() {
  const audio = useGameAudio();
  const [mainMenu, setMainMenu] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [location, setLocation] = useState("Downtown Syracuse — Clinton Square");
  const [hp, setHp] = useState(32);
  const [maxHp, setMaxHp] = useState(32);
  const [ap, setAp] = useState(7);
  const [enemyHp, setEnemyHp] = useState(18);
  const [rowanHp, setRowanHp] = useState(26);
  const [combat, setCombat] = useState<CombatState>("idle");
  const [selectedNpc, setSelectedNpc] = useState<NpcId | null>(null);
  const [combatTarget, setCombatTarget] = useState<NpcId | null>(null);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(35);
  const [chips, setChips] = useState(37);
  const [skillPoints, setSkillPoints] = useState(2);
  const [skills, setSkills] = useState(initialSkills);
  const [luck] = useState(6);
  const [selectedAction, setSelectedAction] = useState("Attack");
  const [isSpinning, setIsSpinning] = useState(false);
  const [reels, setReels] = useState(["♠", "7", "★"]);
  const [slotLabel, setSlotLabel] = useState("FATE AWAITS");
  const [jackpotBurst, setJackpotBurst] = useState(false);
  const [playerPosition, setPlayerPosition] = useState({ x: 51, y: 71 });
  const [destination, setDestination] = useState({ x: 51, y: 71 });
  const [walking, setWalking] = useState(false);
  const [walkFrame, setWalkFrame] = useState(0);
  const [movementMode, setMovementMode] = useState<"walk" | "run">("walk");
  const [walkFacing, setWalkFacing] = useState<"left" | "right">("right");
  const [walkDuration, setWalkDuration] = useState(500);
  const [enemyPosition, setEnemyPosition] = useState<WorldPoint>({ x: 66, y: 78 });
  const [enemyMoving, setEnemyMoving] = useState(false);
  const [enemyFacing, setEnemyFacing] = useState<"left" | "right">("right");
  const [enemyMoveDuration, setEnemyMoveDuration] = useState(1500);
  const [rowanPosition, setRowanPosition] = useState<WorldPoint>({ x: 38, y: 72 });
  const [rowanMoving, setRowanMoving] = useState(false);
  const [rowanFacing, setRowanFacing] = useState<"left" | "right">("right");
  const [rowanMoveDuration, setRowanMoveDuration] = useState(700);
  const [enemyTactic, setEnemyTactic] = useState("ASSESSING");
  const [weaponFiring, setWeaponFiring] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: InteractionTarget } | null>(null);
  const [worldProject, setWorldProject] = useState<GameProject | null>(null);
  const [worldSource, setWorldSource] = useState<"github" | "bundled" | "offline">("offline");
  const [worldViewport, setWorldViewport] = useState<WorldViewport>({ left: 0, top: 0, width: 100, height: 100 });
  const [unlockedDoors, setUnlockedDoors] = useState<string[]>([]);
  const [interior, setInterior] = useState<string | null>(null);
  const [dialogueInput, setDialogueInput] = useState("");
  const [dialogueBusy, setDialogueBusy] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [liveConversation, setLiveConversation] = useState(() => typeof window !== "undefined" && localStorage.getItem("life-is-a-gamble-live-conversation") === "true");
  const [speakingCharacter, setSpeakingCharacter] = useState<"YOU" | "ROWAN" | null>(null);
  const [dialogueEngine, setDialogueEngine] = useState<"ai" | "local" | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>(inventoryItems);
  const [activeHolster, setActiveHolster] = useState<HolsterSlot>("holster-right");
  const [lootedCorpses, setLootedCorpses] = useState<NpcId[]>([]);
  const [quests, setQuests] = useState<QuestState[]>(initialQuests);
  const [companions, setCompanions] = useState<CompanionState[]>(initialCompanions);
  const [saveReady, setSaveReady] = useState(false);
  const [saveSlotsReady, setSaveSlotsReady] = useState(false);
  const [saveSlots, setSaveSlots] = useState<SaveSlot[]>([]);
  const [hasActiveSave, setHasActiveSave] = useState(false);
  const [npc, setNpc] = useState<NpcState>({
    trust: 18,
    respect: 24,
    fear: 8,
    mood: "Wary",
    opinion: "Another hungry drifter with a loaded question.",
    memories: ["Saw you approach the Salt Yard alone."],
  });
  const [conversation, setConversation] = useState([
    { speaker: "ROWAN", text: "Easy. I’m not after your pack. Name’s Rowan. You always walk straight toward rabid wildlife, or is today special?" },
  ]);
  const [worldFlags, setWorldFlags] = useState<string[]>(["Rowan met at Salt Yard"]);
  const [log, setLog] = useState<LogEntry[]>([
    { id: 1, tone: "system", text: "YEAR 2186 · 100 years after the Federal Silence." },
    { id: 2, tone: "plain", text: "A rabid squirrel tears into a ration tin. Rowan watches from the bus wreck." },
  ]);
  const logId = useRef(3);
  const sceneRef = useRef<HTMLElement | null>(null);
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movementToken = useRef(0);
  const enemyPatrolIndex = useRef(0);
  const enemyStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enemyTurnToken = useRef(0);
  const enemyTurnCount = useRef(0);
  const bracedRef = useRef(false);
  const jackpotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const npcCombatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const combatTransitionRef = useRef(false);
  const voiceQueue = useRef<Promise<void>>(Promise.resolve());
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const createdQuestIds = useRef(new Set<string>());
  const resolvedQuestIds = useRef(new Set<string>());
  const playtimeOffset = useRef(0);
  const playtimeStartedAt = useRef(0);

  const worldLevel = worldProject?.levels[0];
  const activeWalkBounds = worldLevel ? { x1: 0, x2: worldLevel.width, y1: 0, y2: worldLevel.height } : WALKABLE_BOUNDS;
  const authoredCollisionZones = useMemo<CollisionZone[]>(() => {
    if (!worldProject || !worldLevel) return [];
    return worldProject.levelObjects.filter((object) => object.levelId === worldLevel.id && object.collision.enabled && object.collision.solid).map((object) => object.collision.shape === "circle"
      ? { kind: "ellipse", x: object.x + object.width / 2, y: object.y + object.height / 2, rx: object.width / 2, ry: object.height / 2, label: object.name }
      : { kind: "rect", x1: object.x, x2: object.x + object.width, y1: object.y, y2: object.y + object.height, label: object.name });
  }, [worldProject, worldLevel]);
  const worldToScenePoint = (point: WorldPoint): WorldPoint => worldLevel ? {
    x: worldViewport.left + point.x / worldLevel.width * worldViewport.width,
    y: worldViewport.top + point.y / worldLevel.height * worldViewport.height,
  } : point;
  useEffect(() => {
    let active = true;
    const loadWorld = async () => {
      try {
        const response = await fetch("/api/game/world", { cache: "no-store" });
        const payload = await response.json() as { project?: GameProject; source?: "github" | "bundled"; error?: string };
        if (!response.ok || !payload.project) throw new Error(payload.error || "World data is unavailable.");
        if (!active) return;
        setWorldProject(payload.project); setWorldSource(payload.source || "github");
        const firstLevel = payload.project.levels[0];
        const courier = payload.project.levelObjects.find((entry) => entry.id === "scene-courier");
        const rowan = payload.project.levelObjects.find((entry) => entry.id === "scene-rowan");
        const squirrel = payload.project.levelObjects.find((entry) => entry.id === "scene-squirrel");
        if (firstLevel) {
          const spawn = courier ? { x: courier.x + courier.width / 2, y: courier.y + courier.height / 2 } : firstLevel.playerSpawn;
          setPlayerPosition(spawn); setDestination(spawn); setLocation(`${firstLevel.region} — ${firstLevel.name}`);
        }
        if (rowan) setRowanPosition({ x: rowan.x + rowan.width / 2, y: rowan.y + rowan.height / 2 });
        if (squirrel) setEnemyPosition({ x: squirrel.x + squirrel.width / 2, y: squirrel.y + squirrel.height / 2 });
      } catch { if (active) setWorldSource("offline"); }
    };
    void loadWorld();
    const onFocus = () => void loadWorld();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !worldLevel) {
      setWorldViewport({ left: 0, top: 0, width: 100, height: 100 });
      return;
    }
    const updateViewport = () => {
      const bounds = scene.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const aspect = worldLevel.width / worldLevel.height;
      const planeWidth = Math.min(bounds.width, bounds.height * aspect);
      const planeHeight = planeWidth / aspect;
      setWorldViewport({
        left: (bounds.width - planeWidth) / 2 / bounds.width * 100,
        top: (bounds.height - planeHeight) / 2 / bounds.height * 100,
        width: planeWidth / bounds.width * 100,
        height: planeHeight / bounds.height * 100,
      });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scene);
    return () => observer.disconnect();
  }, [worldLevel]);

  const currentPlaytime = () => playtimeOffset.current + Math.max(0, Math.floor((Date.now() - playtimeStartedAt.current) / 1000));

  const makeSnapshot = (): GameSnapshot => ({
    schemaVersion: SAVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    playtimeSeconds: currentPlaytime(),
    level,
    xp,
    chips,
    skills: cloneValue(skills),
    skillPoints,
    npc: cloneValue(npc),
    worldFlags: cloneValue(worldFlags),
    conversation: cloneValue(conversation.slice(-40)),
    location,
    hp,
    maxHp,
    ap,
    enemyHp,
    rowanHp,
    combat,
    combatTarget,
    selectedNpc,
    unlockedDoors: cloneValue(unlockedDoors),
    playerPosition: cloneValue(playerPosition),
    enemyPosition: cloneValue(enemyPosition),
    rowanPosition: cloneValue(rowanPosition),
    lootedCorpses: cloneValue(lootedCorpses),
    inventory: cloneValue(inventory),
    quests: cloneValue(quests),
    companions: cloneValue(companions),
    interior,
    selectedAction,
    activeHolster,
    log: cloneValue(log.slice(-30)),
  });

  const restoreSnapshot = (save: Partial<GameSnapshot>) => {
    movementToken.current += 1;
    enemyTurnToken.current += 1;
    enemyTurnCount.current = 0;
    bracedRef.current = false;
    if (walkTimer.current) clearTimeout(walkTimer.current);
    if (enemyStopTimer.current) clearTimeout(enemyStopTimer.current);
    setWalking(false);
    setEnemyMoving(false);
    setRowanMoving(false);
    setWeaponFiring(false);
    setEnemyTactic("ASSESSING");
    setContextMenu(null);
    setDialogueBusy(false);
    setSpeakingCharacter(null);
    activeAudio.current?.pause();
    if (typeof save.level === "number") setLevel(save.level);
    if (typeof save.xp === "number") setXp(save.xp);
    if (typeof save.chips === "number") setChips(save.chips);
    if (save.skills) setSkills(save.skills);
    if (typeof save.skillPoints === "number") setSkillPoints(save.skillPoints);
    if (save.npc) setNpc(save.npc);
    if (Array.isArray(save.worldFlags)) setWorldFlags(save.worldFlags);
    if (Array.isArray(save.conversation)) setConversation(save.conversation.slice(-40));
    if (save.location && String(save.location).includes("Syracuse")) setLocation(save.location);
    if (typeof save.hp === "number") setHp(save.hp);
    if (typeof save.maxHp === "number") setMaxHp(save.maxHp);
    if (typeof save.ap === "number") setAp(save.ap);
    if (typeof save.enemyHp === "number") setEnemyHp(save.enemyHp);
    if (typeof save.rowanHp === "number") setRowanHp(save.rowanHp);
    if (save.combat && ["idle", "player", "enemy", "won"].includes(save.combat)) setCombat(save.combat);
    setCombatTarget(save.combatTarget === "rowan" || save.combatTarget === "squirrel" ? save.combatTarget : null);
    setSelectedNpc(save.selectedNpc === "rowan" || save.selectedNpc === "squirrel" ? save.selectedNpc : null);
    if (Array.isArray(save.unlockedDoors)) setUnlockedDoors(save.unlockedDoors);
    if (save.playerPosition && typeof save.playerPosition.x === "number" && typeof save.playerPosition.y === "number") {
      setPlayerPosition(save.playerPosition);
      setDestination(save.playerPosition);
    }
    if (save.enemyPosition && typeof save.enemyPosition.x === "number" && typeof save.enemyPosition.y === "number") setEnemyPosition(save.enemyPosition);
    if (save.rowanPosition && typeof save.rowanPosition.x === "number" && typeof save.rowanPosition.y === "number") setRowanPosition(save.rowanPosition);
    if (Array.isArray(save.lootedCorpses)) setLootedCorpses(save.lootedCorpses.filter((id): id is NpcId => id === "rowan" || id === "squirrel"));
    if (Array.isArray(save.inventory) && save.inventory.length) setInventory(restoreInventory(save.inventory));
    if (Array.isArray(save.quests)) {
      setQuests(save.quests);
      createdQuestIds.current = new Set(save.quests.map((quest) => quest.id));
      resolvedQuestIds.current = new Set(save.quests.filter((quest) => quest.status !== "active").map((quest) => quest.id));
    }
    if (Array.isArray(save.companions)) setCompanions(save.companions);
    setInterior(typeof save.interior === "string" ? save.interior : null);
    if (typeof save.selectedAction === "string") setSelectedAction(save.selectedAction);
    if (save.activeHolster === "holster-left" || save.activeHolster === "holster-right") setActiveHolster(save.activeHolster);
    if (Array.isArray(save.log) && save.log.length) {
      setLog(save.log.slice(-30));
      logId.current = Math.max(...save.log.map((entry) => Number(entry.id) || 0), 2) + 1;
    }
    playtimeOffset.current = typeof save.playtimeSeconds === "number" ? Math.max(0, save.playtimeSeconds) : 0;
    playtimeStartedAt.current = Date.now();
  };

  useEffect(() => {
    playtimeStartedAt.current = Date.now();
    try {
      const raw = localStorage.getItem(ACTIVE_SAVE_KEY);
      if (raw) {
        restoreSnapshot(JSON.parse(raw));
        setHasActiveSave(true);
      }
    } catch {
      // A damaged local save should never keep the player from starting.
    } finally {
      setSaveReady(true);
    }
    try {
      const rawSlots = localStorage.getItem(SAVE_SLOTS_KEY);
      const parsed = rawSlots ? JSON.parse(rawSlots) : [];
      if (Array.isArray(parsed)) setSaveSlots(parsed.filter((slot) => slot && typeof slot.id === "string" && slot.snapshot));
    } catch {
      // Ignore damaged slot indexes; the active autosave can still be loaded.
    } finally {
      setSaveSlotsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!saveReady) return;
    const snapshot = makeSnapshot();
    localStorage.setItem(ACTIVE_SAVE_KEY, JSON.stringify(snapshot));
    if (!saveSlotsReady) return;
    const timer = window.setTimeout(() => {
      setSaveSlots((slots) => {
        const existing = slots.find((slot) => slot.id === "autosave");
        const autosave: SaveSlot = {
          id: "autosave",
          name: "AUTOSAVE",
          kind: "auto",
          createdAt: existing?.createdAt || snapshot.savedAt,
          updatedAt: snapshot.savedAt,
          snapshot,
        };
        return [autosave, ...slots.filter((slot) => slot.id !== "autosave")];
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [saveReady, saveSlotsReady, level, xp, chips, skills, skillPoints, npc, worldFlags, conversation, location, hp, maxHp, ap, enemyHp, rowanHp, combat, combatTarget, selectedNpc, unlockedDoors, playerPosition, enemyPosition, rowanPosition, lootedCorpses, inventory, quests, companions, interior, selectedAction, activeHolster]);

  useEffect(() => {
    localStorage.setItem("life-is-a-gamble-live-conversation", String(liveConversation));
  }, [liveConversation]);

  useEffect(() => {
    if (!saveSlotsReady) return;
    localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(saveSlots));
  }, [saveSlotsReady, saveSlots]);

  useEffect(() => {
    if (!walking) return;
    const timer = setInterval(() => setWalkFrame((frame) => (frame + 1) % 4), movementMode === "run" ? 90 : 135);
    return () => clearInterval(timer);
  }, [walking, movementMode]);

  useEffect(() => {
    const nextMode = mainMenu ? "menu" : combat === "player" || combat === "enemy" ? "combat" : panel === "dialogue" ? "dialogue" : interior ? "interior" : "ambient";
    audio.setMusic(nextMode);
  }, [mainMenu, combat, panel, interior, audio.setMusic]);

  useEffect(() => {
    if (!mainMenu) return;
    const beginMenuMusic = () => { void audio.activate("menu"); };
    beginMenuMusic();
    window.addEventListener("pointerdown", beginMenuMusic, { once: true });
    window.addEventListener("keydown", beginMenuMusic, { once: true });
    return () => {
      window.removeEventListener("pointerdown", beginMenuMusic);
      window.removeEventListener("keydown", beginMenuMusic);
    };
  }, [mainMenu, audio.activate]);

  useEffect(() => {
    if (mainMenu || interior || enemyHp <= 0 || combat !== "idle") {
      return;
    }
    const patrolWaypoints: WorldPoint[] = [
      { x: 65, y: 66 }, { x: 73, y: 66 }, { x: 81, y: 66 },
      { x: 90, y: 66 }, { x: 84, y: 69 }, { x: 74, y: 70 },
    ];
    const timer = setTimeout(() => {
      const ordered = patrolWaypoints.map((_, offset) => patrolWaypoints[(enemyPatrolIndex.current + offset) % patrolWaypoints.length]);
      const patrolAvoidance: CollisionZone[] = [
        ...(rowanHp > 0 ? [{ kind: "ellipse" as const, x: 38, y: 72, rx: 1.5, ry: 1.1, label: "Rowan" }] : []),
        { kind: "ellipse", x: playerPosition.x, y: playerPosition.y, rx: 1.5, ry: 1.1, label: "player" },
      ];
      const next = ordered.find((candidate) => segmentIsClear(enemyPosition, candidate, patrolAvoidance));
      if (!next) return;
      enemyPatrolIndex.current = (patrolWaypoints.indexOf(next) + 1) % patrolWaypoints.length;
      const sceneBounds = sceneRef.current?.getBoundingClientRect();
      const pixelDistance = sceneBounds ? Math.hypot((next.x - enemyPosition.x) * sceneBounds.width / 100, (next.y - enemyPosition.y) * sceneBounds.height / 100) : 120;
      const duration = Math.max(900, Math.min(1900, pixelDistance * 6.5));
      setEnemyFacing(next.x < enemyPosition.x ? "left" : "right");
      setEnemyMoveDuration(duration);
      setEnemyMoving(true);
      setEnemyPosition(next);
      if (enemyStopTimer.current) clearTimeout(enemyStopTimer.current);
      enemyStopTimer.current = setTimeout(() => setEnemyMoving(false), duration);
    }, 1800 + (enemyPatrolIndex.current % 3) * 650);
    return () => clearTimeout(timer);
  }, [mainMenu, interior, enemyHp, rowanHp, combat, enemyPosition, playerPosition.x, playerPosition.y]);

  useEffect(() => () => {
    movementToken.current += 1;
    enemyTurnToken.current += 1;
    if (walkTimer.current) clearTimeout(walkTimer.current);
    if (enemyStopTimer.current) clearTimeout(enemyStopTimer.current);
    if (jackpotTimer.current) clearTimeout(jackpotTimer.current);
  }, []);

  const xpGoal = level * 100;
  const activeWeapon = inventory.find((item) => item.equipped === activeHolster && item.weaponType)
    || inventory.find((item) => (item.equipped === "holster-left" || item.equipped === "holster-right") && item.weaponType)
    || null;
  const activeWeaponType: WeaponType = activeWeapon?.weaponType || "unarmed";
  const activeWeaponDamage: [number, number] = activeWeapon?.damage || [1, 3];
  const activeWeaponAp = activeWeapon?.attackAp || 3;
  const activeWeaponAccuracy = activeWeapon?.accuracy || 0;
  const squirrelFrame = enemyHp <= 0 ? 4 : combat === "enemy" ? 3 : isSpinning || enemyMoving ? 1 : 0;
  const selectedTargetName = selectedNpc === "rowan" ? "ROWAN VALE" : selectedNpc === "squirrel" ? "RABID SQUIRREL" : "NO TARGET";
  const selectedTargetHp = selectedNpc === "rowan" ? rowanHp : selectedNpc === "squirrel" ? enemyHp : 0;
  const selectedTargetMaxHp = selectedNpc === "rowan" ? 26 : selectedNpc === "squirrel" ? 18 : 1;

  useEffect(() => {
    if (inventory.some((item) => item.equipped === activeHolster && item.weaponType)) return;
    const fallback = inventory.find((item) => (item.equipped === "holster-right" || item.equipped === "holster-left") && item.weaponType);
    if (fallback?.equipped === "holster-left" || fallback?.equipped === "holster-right") setActiveHolster(fallback.equipped);
  }, [inventory, activeHolster]);

  const addLog = (text: string, tone: LogEntry["tone"] = "plain") => {
    setLog((old) => [...old.slice(-5), { id: logId.current++, tone, text }]);
  };

  const saveAvailable = !dialogueBusy && !isSpinning && !walking && combat !== "enemy";

  const writeSaveSlot = (id: string, name: string, kind: SaveSlot["kind"]) => {
    if (!saveAvailable) return false;
    const snapshot = makeSnapshot();
    setSaveSlots((slots) => {
      const existing = slots.find((slot) => slot.id === id);
      const next: SaveSlot = {
        id,
        name,
        kind,
        createdAt: existing?.createdAt || snapshot.savedAt,
        updatedAt: snapshot.savedAt,
        snapshot,
      };
      return [next, ...slots.filter((slot) => slot.id !== id)];
    });
    localStorage.setItem(ACTIVE_SAVE_KEY, JSON.stringify(snapshot));
    setHasActiveSave(true);
    audio.play("ui");
    addLog(`${name} written to the courier archive.`, "good");
    return true;
  };

  const createManualSave = (requestedName: string) => {
    if (saveSlots.filter((slot) => slot.kind === "manual").length >= MAX_MANUAL_SAVES) return false;
    const name = requestedName.trim().slice(0, 36) || `FIELD SAVE ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `manual-${Date.now()}`;
    return writeSaveSlot(id, name.toUpperCase(), "manual");
  };

  const overwriteSave = (slot: SaveSlot) => {
    if (slot.kind === "auto") return false;
    if (!window.confirm(`Overwrite ${slot.name}?`)) return false;
    return writeSaveSlot(slot.id, slot.name, slot.kind);
  };

  const deleteSave = (slot: SaveSlot) => {
    if (slot.kind === "auto" || !window.confirm(`Delete ${slot.name}? This cannot be undone.`)) return;
    setSaveSlots((slots) => slots.filter((candidate) => candidate.id !== slot.id));
    audio.play("ui");
  };

  const loadSave = (slot: SaveSlot) => {
    if (!mainMenu && !window.confirm(`Load ${slot.name}? Unsaved progress since the last autosave will be lost.`)) return;
    restoreSnapshot(cloneValue(slot.snapshot));
    localStorage.setItem(ACTIVE_SAVE_KEY, JSON.stringify(slot.snapshot));
    setHasActiveSave(true);
    setPanel(null);
    setMainMenu(false);
    audio.play("door");
    addLog(`${slot.name} restored.`, "system");
  };

  const quickSave = () => {
    if (!writeSaveSlot("quicksave", "QUICKSAVE", "quick")) addLog("Cannot save during movement, enemy actions, dialogue processing, or a Fate spin.", "bad");
  };

  const quickLoad = () => {
    const slot = saveSlots.find((candidate) => candidate.id === "quicksave");
    if (!slot) {
      addLog("No quicksave exists yet. Press F5 to create one.", "bad");
      return;
    }
    loadSave(slot);
  };

  const startNewGame = async () => {
    if (hasActiveSave && !window.confirm("Start a new game? Named saves will remain available, but the active autosave will be replaced.")) return;
    movementToken.current += 1;
    enemyTurnToken.current += 1;
    enemyTurnCount.current = 0;
    bracedRef.current = false;
    if (walkTimer.current) clearTimeout(walkTimer.current);
    if (enemyStopTimer.current) clearTimeout(enemyStopTimer.current);
    setPanel(null);
    setLocation("Downtown Syracuse — Clinton Square");
    setHp(32); setMaxHp(32); setAp(7); setEnemyHp(18); setRowanHp(26);
    setCombat("idle"); setCombatTarget(null); setSelectedNpc(null);
    setLevel(1); setXp(35); setChips(37); setSkillPoints(2); setSkills(cloneValue(initialSkills));
    setSelectedAction("Attack"); setReels(["♠", "7", "★"]); setSlotLabel("FATE AWAITS");
    setPlayerPosition({ x: 51, y: 71 }); setDestination({ x: 51, y: 71 }); setWalking(false);
    setEnemyPosition({ x: 66, y: 78 }); setEnemyMoving(false);
    setRowanPosition({ x: 38, y: 72 }); setRowanMoving(false); setEnemyTactic("ASSESSING");
    setUnlockedDoors([]); setInterior(null); setDialogueInput(""); setDialogueEngine(null);
    setInventory(cloneValue(inventoryItems)); setActiveHolster("holster-right"); setLootedCorpses([]); setQuests(cloneValue(initialQuests)); setCompanions(cloneValue(initialCompanions));
    setNpc({ trust: 18, respect: 24, fear: 8, mood: "Wary", opinion: "Another hungry drifter with a loaded question.", memories: ["Saw you approach the Salt Yard alone."] });
    setConversation([{ speaker: "ROWAN", text: "Easy. I’m not after your pack. Name’s Rowan. You always walk straight toward rabid wildlife, or is today special?" }]);
    setWorldFlags(["Rowan met at Salt Yard"]);
    setLog([
      { id: 1, tone: "system", text: "YEAR 2186 · 100 years after the Federal Silence." },
      { id: 2, tone: "plain", text: "A rabid squirrel tears into a ration tin. Rowan watches from the bus wreck." },
    ]);
    logId.current = 3;
    createdQuestIds.current = new Set();
    resolvedQuestIds.current = new Set();
    playtimeOffset.current = 0;
    playtimeStartedAt.current = Date.now();
    setHasActiveSave(true);
    void audio.activate("menu");
    audio.play("door");
    setMainMenu(false);
  };

  const beginRoute = (route: WorldPoint[]) => {
    const token = ++movementToken.current;
    if (walkTimer.current) clearTimeout(walkTimer.current);
    if (!route.length) { setWalking(false); return; }
    setDestination(route[route.length - 1]);
    const moveStep = (from: WorldPoint, index: number) => {
      if (token !== movementToken.current || index >= route.length) {
        if (token === movementToken.current) setWalking(false);
        return;
      }
      const next = route[index];
      const bounds = sceneRef.current?.getBoundingClientRect();
      const distance = bounds ? Math.hypot((next.x - from.x) * bounds.width / 100, (next.y - from.y) * bounds.height / 100) : 80;
      const nextMovementMode = distance > 260 ? "run" : "walk";
      const duration = nextMovementMode === "run"
        ? Math.max(220, Math.min(1150, distance * 2.05))
        : Math.max(240, Math.min(1700, distance * 3.5));
      setWalkFacing(next.x < from.x ? "left" : "right");
      setWalkDuration(duration);
      setMovementMode(nextMovementMode);
      setWalkFrame(0);
      setWalking(true);
      setPlayerPosition(next);
      walkTimer.current = setTimeout(() => moveStep(next, index + 1), duration);
    };
    moveStep(playerPosition, 0);
  };

  const walkTo = (event: React.MouseEvent<HTMLElement>) => {
    if (interior || combat === "enemy" || isSpinning) return;
    const bounds = sceneRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const sceneX = (event.clientX - bounds.left) / bounds.width * 100;
    const sceneY = (event.clientY - bounds.top) / bounds.height * 100;
    if (worldLevel && (sceneX < worldViewport.left || sceneX > worldViewport.left + worldViewport.width || sceneY < worldViewport.top || sceneY > worldViewport.top + worldViewport.height)) return;
    const x = Math.max(activeWalkBounds.x1, Math.min(activeWalkBounds.x2, worldLevel ? (sceneX - worldViewport.left) / worldViewport.width * worldLevel.width : sceneX));
    const y = Math.max(activeWalkBounds.y1, Math.min(activeWalkBounds.y2, worldLevel ? (sceneY - worldViewport.top) / worldViewport.height * worldLevel.height : sceneY));
    const actorZones: CollisionZone[] = [
      ...authoredCollisionZones,
      ...(rowanHp > 0 ? [{ kind: "ellipse" as const, x: rowanPosition.x, y: rowanPosition.y, rx: 1.5, ry: 1.1, label: "Rowan" }] : []),
      ...(enemyHp > 0 ? [{ kind: "ellipse" as const, x: enemyPosition.x, y: enemyPosition.y, rx: 1.35, ry: 1, label: "rabid squirrel" }] : []),
    ];
    const requested = { x, y };
    const requestedBlocked = pointBlocked(requested, actorZones, activeWalkBounds, !worldProject);
    const route = findWalkPath(playerPosition, requested, actorZones, activeWalkBounds, !worldProject);
    setContextMenu(null);
    if (!route.length) {
      addLog("No walkable route reaches that point.", "bad");
      return;
    }
    if (requestedBlocked) addLog("Path adjusted to stop clear of the obstacle.", "system");
    beginRoute(route);
  };

  const openInteraction = (event: React.MouseEvent, target: InteractionTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 285), y: Math.min(event.clientY, window.innerHeight - 220), target });
  };

  const openAuthoredObject = (event: React.MouseEvent, object: LevelObject, sprite?: SpriteAsset) => {
    const lower = object.name.toLowerCase();
    if (lower.includes("rowan")) return openInteraction(event, npcInteractions.rowan);
    if (lower.includes("squirrel")) return openInteraction(event, npcInteractions.squirrel);
    openInteraction(event, { id: object.id, label: object.name, kind: "prop", action: sprite?.category === "prop" || sprite?.tags.some((tag) => /loot|container|search/i.test(tag)) ? "search" : "inspect", authoredType: sprite?.category || "effect", tags: sprite?.tags || [], trigger: object.collision.trigger });
  };

  const openAuthoredDoor = (event: React.MouseEvent, cellId: string, doorId: string) => {
    const cell = worldProject?.cells.find((entry) => entry.id === cellId);
    const door = cell?.doors.find((entry) => entry.id === doorId);
    if (!cell || !door) return;
    const targetCell = worldProject?.cells.find((entry) => entry.id === door.targetCellId);
    openInteraction(event, { id: door.id, label: door.name, kind: "door", locked: door.locked, lockpick: door.locked, interior: targetCell?.name || cell.name });
  };

  const selectNpc = (npcId: NpcId) => {
    const alive = npcId === "rowan" ? rowanHp > 0 : enemyHp > 0;
    if (!alive) return;
    setContextMenu(null);
    setSelectedNpc(npcId);
    if (combat === "won" && combatTarget !== npcId) {
      setCombat("idle");
      setCombatTarget(null);
    }
    if (selectedNpc !== npcId) addLog(`${npcId === "rowan" ? "Rowan Vale" : "Rabid Squirrel"} targeted. Combat actions are ready.`, "system");
  };

  const openNpcInteraction = (event: React.MouseEvent, npcId: NpcId) => {
    selectNpc(npcId);
    openInteraction(event, npcInteractions[npcId]);
  };

  const enterTarget = (target: InteractionTarget) => {
    setContextMenu(null);
    if (target.inaccessible) {
      addLog(`${target.label} is inaccessible. The passage has collapsed behind the door.`, "bad");
      return;
    }
    if (target.locked && !unlockedDoors.includes(target.id)) {
      addLog(`${target.label} is locked. Right-click and attempt to pick it.`, "bad");
      return;
    }
    if (target.interior) {
      audio.play("door");
      setInterior(target.interior);
      setLocation(`${target.interior}, Downtown Syracuse`);
      addLog(`Entered ${target.interior}.`, "system");
    }
  };

  const lockpickTarget = async (target: InteractionTarget) => {
    setContextMenu(null);
    if (!target.lockpick || target.inaccessible) return;
    audio.play("lockpick");
    const result = await spinFate(`Lockpick · ${target.label}`);
    const targetScore = 28 + skills.Mechanics * 9 + luck * 4;
    if (result.score <= targetScore || result.jackpot) {
      setUnlockedDoors((doors) => [...new Set([...doors, target.id])]);
      audio.play("loot");
      awardXp(12);
      addLog(`LOCK OPENED · ${target.label}. +12 XP.`, "good");
    } else if (result.score > targetScore + 25) {
      audio.play("lockBreak");
      addLog(`LOCKPICK BROKE · The snapped tip is still inside ${target.label}'s lock.`, "bad");
    } else {
      audio.play("lockpick");
      addLog(`The lock holds. Your bent pick is one mistake from snapping.`, "bad");
    }
  };

  const interactWithProp = (target: InteractionTarget) => {
    setContextMenu(null);
    if (target.action === "search") {
      if (worldFlags.includes("Downtown sedan searched")) addLog("The sedan has already been picked clean.");
      else {
        audio.play("loot");
        setWorldFlags((flags) => [...flags, "Downtown sedan searched"]);
        setChips((value) => value + 4);
        addLog("You search the sedan: 4 chips and a damp parking receipt.", "good");
      }
    } else addLog("The lamp bears a municipal seal dated 2039. Its copper wiring is gone.");
  };

  const lootCorpse = (corpseId: NpcId) => {
    setContextMenu(null);
    if (lootedCorpses.includes(corpseId)) {
      addLog(corpseId === "rowan" ? "Rowan's body has already been searched." : "The squirrel corpse has already been searched.");
      return;
    }
    const nextInventory = cloneValue(inventory);
    const recovered: string[] = [];
    for (const template of corpseLoot[corpseId]) {
      if (nextInventory.some((item) => item.name === template.name)) continue;
      const space = findInventorySpace(nextInventory, template.w, template.h);
      if (!space) {
        addLog("PACK FULL · Make room before looting the corpse.", "bad");
        return;
      }
      nextInventory.push({ ...cloneValue(template), ...space, id: Math.max(0, ...nextInventory.map((item) => item.id)) + 1 });
      recovered.push(template.name);
    }
    setInventory(nextInventory);
    setLootedCorpses((ids) => [...new Set([...ids, corpseId])]);
    audio.play("loot");
    addLog(recovered.length ? "CORPSE LOOTED · " + recovered.join(" · ") : "The corpse carries nothing you can use.", recovered.length ? "good" : "plain");
  };

  const awardXp = (amount: number) => {
    setXp((old) => {
      const next = old + amount;
      if (next >= xpGoal) {
        setLevel((v) => v + 1);
        setSkillPoints((v) => v + 3);
        setMaxHp((v) => v + 5);
        setHp((v) => v + 5);
        addLog(`LEVEL UP · ${level + 1}. Three skill points gained.`, "good");
        return next - xpGoal;
      }
      return next;
    });
  };

  const finishQuest = (questId: string, status: "completed" | "failed", reason: string) => {
    if (resolvedQuestIds.current.has(questId)) return null;
    const quest = quests.find((entry) => entry.id === questId && entry.status === "active");
    if (!quest) return null;
    resolvedQuestIds.current.add(questId);
    setQuests((entries) => entries.map((entry) => entry.id === questId ? {
      ...entry,
      status,
      objectives: status === "completed" ? entry.objectives.map((objective) => ({ ...objective, complete: true })) : entry.objectives,
      history: [...entry.history, reason].slice(-10),
      updatedAt: Date.now(),
    } : entry));
    if (status === "completed" && quest.rewardXp > 0) awardXp(quest.rewardXp);
    return `QUEST ${status === "completed" ? "COMPLETED" : "FAILED"} · ${quest.title}${status === "completed" && quest.rewardXp ? ` · +${quest.rewardXp} XP` : ""}`;
  };

  const activeCompanion = companions.find((companion) => companion.status === "active");

  const setCompanionStatus = (id: string, status: CompanionState["status"], reason: string) => {
    const current = companions.find((companion) => companion.id === id);
    if (!current || current.status === "dead" || current.status === status) return null;
    setCompanions((entries) => entries.map((companion) => companion.id === id ? {
      ...companion,
      status,
      opinion: reason,
      history: [...companion.history, reason].slice(-10),
    } : companion));
    return `${status === "active" ? "COMPANION JOINED" : status === "dismissed" ? "COMPANION DISMISSED" : "COMPANION STATUS"} · ${current.name}`;
  };

  const spinFate = async (reason: string): Promise<{ score: number; jackpot: boolean; symbols: string[] }> => {
    if (isSpinning) return { score: 0, jackpot: false, symbols: reels };
    setIsSpinning(true);
    setSlotLabel(reason.toUpperCase());
    audio.play("slotSpin");
    for (let step = 0; step < 7; step++) {
      await new Promise((resolve) => setTimeout(resolve, 75 + step * 14));
      setReels([
        reelSymbols[Math.floor(Math.random() * reelSymbols.length)],
        reelSymbols[Math.floor(Math.random() * reelSymbols.length)],
        reelSymbols[Math.floor(Math.random() * reelSymbols.length)],
      ]);
    }
    const roll = Math.floor(Math.random() * 100) + 1;
    const lucky = roll <= luck * 5;
    const jackpot = roll <= Math.max(3, luck - 2);
    const finalSymbols = jackpot ? ["7", "7", "7"] : lucky ? ["★", "★", "♦"] : [
      reelSymbols[Math.floor(Math.random() * reelSymbols.length)],
      reelSymbols[Math.floor(Math.random() * reelSymbols.length)],
      reelSymbols[Math.floor(Math.random() * reelSymbols.length)],
    ];
    setReels(finalSymbols);
    setSlotLabel(jackpot ? "JACKPOT" : lucky ? "LUCK TURNS" : `ROLL ${roll}`);
    setIsSpinning(false);
    audio.play(jackpot ? "slotJackpot" : lucky ? "slotWin" : "slotLose");
    if (jackpot) {
      setJackpotBurst(true);
      if (jackpotTimer.current) clearTimeout(jackpotTimer.current);
      jackpotTimer.current = setTimeout(() => setJackpotBurst(false), 2600);
      setChips((v) => v + 25);
      addLog("JACKPOT · Fate pays 25 old-world chips.", "good");
    }
    return { score: roll + (lucky ? 18 : 0), jackpot, symbols: finalSymbols };
  };

  const startCombat = (requestedTarget?: NpcId, initiator: "player" | "npc" = "player") => {
    const target = requestedTarget ?? selectedNpc ?? "squirrel";
    const targetHp = target === "rowan" ? rowanHp : enemyHp;
    if (targetHp <= 0) return false;
    if (initiator === "npc" && combatTransitionRef.current) return false;
    if (initiator === "player" && combat === "player" && combatTarget === target) return true;
    const startingEncounter = combat === "idle" || combat === "won";
    audio.play("enemyAggro");
    setSelectedNpc(target);
    setCombatTarget(target);
    setCombat(initiator === "npc" ? "enemy" : "player");
    if (initiator === "npc") setAp(0);
    else if (startingEncounter) setAp(7);
    if (target === "rowan") {
      const playerStartedIt = initiator === "player";
      setWorldFlags((flags) => [...new Set([...flags, playerStartedIt ? "Courier attacked Rowan" : "Rowan initiated combat", "Rowan became hostile"])]);
      setNpc((state) => ({
        ...state,
        trust: clamp(state.trust - (playerStartedIt ? 24 : 12)),
        respect: clamp(state.respect - (playerStartedIt ? 8 : 5)),
        fear: clamp(state.fear + (playerStartedIt ? 18 : 6)),
        mood: "Hostile",
        opinion: playerStartedIt ? "You drew on me. Whatever this was before, it is over." : "The talking is over. I chose to fire first.",
        memories: [...state.memories.slice(-7), playerStartedIt ? "The Courier raised a weapon against me." : "I ended the exchange by drawing on the Courier."],
      }));
      setCompanions((entries) => entries.map((companion) => companion.id === "rowan" && companion.status !== "dead" ? {
        ...companion,
        status: "hostile",
        loyalty: 0,
        morale: clamp(companion.morale - 30),
        opinion: playerStartedIt ? "The Courier betrayed me at gunpoint." : "I decided the Courier was too dangerous to leave standing.",
        history: [...companion.history, playerStartedIt ? "The Courier attacked Rowan." : "Rowan initiated combat during dialogue."].slice(-10),
      } : companion));
      if (playerStartedIt) {
        setPanel(null);
        addLog("HOSTILITIES · Rowan reaches for her sidearm.", "bad");
      } else {
        combatTransitionRef.current = true;
        addLog("DIALOGUE BROKEN · Rowan draws first. She has the initiative.", "bad");
        if (npcCombatTimer.current) clearTimeout(npcCombatTimer.current);
        npcCombatTimer.current = setTimeout(() => {
          setPanel(null);
          void enemyTurn("rowan").finally(() => { combatTransitionRef.current = false; });
        }, 1100);
      }
    } else addLog("TURN 1 · The squirrel bares wet, yellow teeth.", "bad");
    return true;
  };

  const combatDistance = (from: WorldPoint, to: WorldPoint) => Math.hypot(from.x - to.x, (from.y - to.y) * 1.45);

  const moveCombatActor = async (actor: NpcId, requested: WorldPoint, token: number, fromOverride?: WorldPoint) => {
    const from = fromOverride || (actor === "rowan" ? rowanPosition : enemyPosition);
    const blockers: CollisionZone[] = [
      ...authoredCollisionZones,
      { kind: "ellipse", x: playerPosition.x, y: playerPosition.y, rx: 1.5, ry: 1.05, label: "player" },
      ...(actor === "squirrel" && rowanHp > 0 ? [{ kind: "ellipse" as const, x: rowanPosition.x, y: rowanPosition.y, rx: 1.45, ry: 1, label: "Rowan" }] : []),
      ...(actor === "rowan" && enemyHp > 0 && combatTarget !== "squirrel" ? [{ kind: "ellipse" as const, x: enemyPosition.x, y: enemyPosition.y, rx: 1.3, ry: .95, label: "squirrel" }] : []),
    ];
    const route = findWalkPath(from, requested, blockers, activeWalkBounds, !worldProject);
    const next = route.at(-1);
    if (!next) return from;
    const bounds = sceneRef.current?.getBoundingClientRect();
    const pixels = bounds ? Math.hypot((next.x - from.x) * bounds.width / 100, (next.y - from.y) * bounds.height / 100) : 100;
    const duration = Math.max(320, Math.min(1050, pixels * (actor === "squirrel" ? 2.3 : 3.2)));
    if (actor === "rowan") {
      setRowanFacing(next.x < from.x ? "left" : "right");
      setRowanMoveDuration(duration); setRowanMoving(true); setRowanPosition(next);
    } else {
      setEnemyFacing(next.x < from.x ? "left" : "right");
      setEnemyMoveDuration(duration); setEnemyMoving(true); setEnemyPosition(next);
    }
    await new Promise((resolve) => setTimeout(resolve, duration));
    if (token !== enemyTurnToken.current) return next;
    if (actor === "rowan") setRowanMoving(false); else setEnemyMoving(false);
    return next;
  };

  const enemyTurn = async (turnTarget: NpcId | null = combatTarget) => {
    if (!turnTarget) return;
    const token = ++enemyTurnToken.current;
    const turnNumber = ++enemyTurnCount.current;
    setCombat("enemy");
    setAp(0);
    let actionPoints = 7;
    let actorPosition = turnTarget === "rowan" ? rowanPosition : enemyPosition;
    const vectorFromPlayer = () => {
      const dx = actorPosition.x - playerPosition.x;
      const dy = actorPosition.y - playerPosition.y;
      const length = Math.max(.1, Math.hypot(dx, dy));
      return { dx: dx / length, dy: dy / length };
    };
    const resolveEnemyAttack = async () => {
      if (token !== enemyTurnToken.current) return;
      setEnemyTactic(turnTarget === "rowan" ? "FIRING" : "LUNGING");
      audio.play(turnTarget === "rowan" ? "shootPistol" : "enemyAttack");
      await new Promise((resolve) => setTimeout(resolve, turnTarget === "rowan" ? 360 : 280));
      const dodgeChance = skills.Survival * 4 + luck * 2 + (bracedRef.current ? 12 : 0);
      const roll = Math.floor(Math.random() * 100);
      if (roll < dodgeChance) {
        audio.play("enemyNormal");
        addLog(turnTarget === "rowan" ? "You dive aside as Rowan's shot sparks off the curb." : "You read the lunge and step aside.", "good");
      } else {
        const damage = (turnTarget === "rowan" ? 5 : 3) + Math.floor(Math.random() * 5);
        setHp((value) => Math.max(1, value - damage));
        addLog(`${turnTarget === "rowan" ? "Rowan fires from her new angle" : "The rabid squirrel lunges and bites"} for ${damage} damage.`, "bad");
      }
    };

    if (turnTarget === "squirrel") {
      let distance = combatDistance(actorPosition, playerPosition);
      if (distance > 7 && actionPoints >= 3) {
        setEnemyTactic(distance > 18 ? "CLOSING FAST" : "STALKING");
        const direction = vectorFromPlayer();
        actorPosition = await moveCombatActor("squirrel", {
          x: playerPosition.x + direction.dx * 4.4,
          y: playerPosition.y + direction.dy * 3.2,
        }, token, actorPosition);
        actionPoints -= 3;
        distance = combatDistance(actorPosition, playerPosition);
        addLog("ENEMY MOVE · The squirrel darts through cover toward your flank.", "bad");
      }
      if (distance <= 9 && actionPoints >= 3) {
        await resolveEnemyAttack();
        actionPoints -= 3;
      }
      if (actionPoints >= 2 && token === enemyTurnToken.current) {
        setEnemyTactic("CIRCLING");
        const direction = vectorFromPlayer();
        actorPosition = await moveCombatActor("squirrel", {
          x: actorPosition.x - direction.dy * (turnNumber % 2 ? 5 : -5),
          y: actorPosition.y + direction.dx * (turnNumber % 2 ? 3.5 : -3.5),
        }, token, actorPosition);
        addLog("ENEMY MOVE · The squirrel circles instead of presenting a clean shot.", "plain");
      }
    } else {
      const distance = combatDistance(actorPosition, playerPosition);
      if ((distance < 14 || turnNumber % 3 === 0) && actionPoints >= 3) {
        const direction = vectorFromPlayer();
        const strafe = turnNumber % 2 ? 1 : -1;
        setEnemyTactic(distance < 14 ? "BREAKING CONTACT" : "SEEKING ANGLE");
        actorPosition = await moveCombatActor("rowan", {
          x: actorPosition.x + direction.dx * (distance < 14 ? 9 : 2) - direction.dy * 7 * strafe,
          y: actorPosition.y + direction.dy * (distance < 14 ? 6 : 1.5) + direction.dx * 4 * strafe,
        }, token, actorPosition);
        actionPoints -= 3;
        addLog(distance < 14 ? "ENEMY MOVE · Rowan disengages toward cover." : "ENEMY MOVE · Rowan changes her firing angle.", "bad");
      }
      if (actionPoints >= 4) {
        await resolveEnemyAttack();
        actionPoints -= 4;
      }
      if (actionPoints >= 3 && token === enemyTurnToken.current) {
        const direction = vectorFromPlayer();
        setEnemyTactic("REPOSITIONING");
        await moveCombatActor("rowan", { x: actorPosition.x - direction.dy * 5, y: actorPosition.y + direction.dx * 3 }, token, actorPosition);
      }
    }
    if (token !== enemyTurnToken.current) return;
    setEnemyMoving(false); setRowanMoving(false); setEnemyTactic("HOLDING");
    bracedRef.current = false;
    setAp(7);
    setSelectedAction("Attack");
    setCombat("player");
  };

  const attack = async (aimed = false) => {
    const target = selectedNpc;
    if (!target || combat === "enemy" || isSpinning) {
      if (!target) addLog("Select an NPC before attacking.", "bad");
      return;
    }
    const targetHp = target === "rowan" ? rowanHp : enemyHp;
    if (targetHp <= 0) return;
    const enteringCombat = combat !== "player" || combatTarget !== target;
    const startingEncounter = combat !== "player";
    const cost = activeWeaponAp + (aimed ? 2 : 0);
    const availableAp = startingEncounter ? 7 : ap;
    if (availableAp < cost) {
      addLog("Not enough Action Points.", "bad");
      return;
    }
    const targetPosition = target === "rowan" ? rowanPosition : enemyPosition;
    const distance = combatDistance(playerPosition, targetPosition);
    if ((activeWeaponType === "melee" || activeWeaponType === "unarmed") && distance > 9) {
      addLog(`${activeWeapon?.name || "Unarmed strike"} is out of reach. Move closer before attacking.`, "bad");
      return;
    }
    if (enteringCombat) startCombat(target);
    setAp(availableAp - cost);
    setWeaponFiring(true);
    if (activeWeaponType === "pistol") audio.play("shootPistol");
    else if (activeWeaponType === "rifle") audio.play("shootRifle");
    else if (activeWeaponType === "shotgun") audio.play("shootShotgun");
    else audio.play("enemyAttack");
    await new Promise((resolve) => setTimeout(resolve, activeWeaponType === "shotgun" ? 380 : 260));
    setWeaponFiring(false);
    const result = await spinFate(aimed ? "Aimed shot" : "Attack check");
    const companionAssist = activeCompanion?.id === "rowan" && target === "squirrel";
    const rangeModifier = activeWeaponType === "shotgun" ? (distance < 14 ? 14 : -12) : activeWeaponType === "rifle" ? (distance > 12 ? 8 : -5) : 0;
    const combatSkill = activeWeaponType === "melee" || activeWeaponType === "unarmed" ? skills.Survival : skills.Guns;
    const hitTarget = 38 + combatSkill * 7 + luck * 2 + activeWeaponAccuracy + rangeModifier + (aimed ? 16 : 0) + (companionAssist ? 5 : 0);
    if (result.score <= hitTarget || result.jackpot) {
      const baseDamage = activeWeaponDamage[0] + Math.floor(Math.random() * (activeWeaponDamage[1] - activeWeaponDamage[0] + 1));
      const damage = baseDamage + Math.floor(combatSkill / 2) + (aimed ? 2 : 0) + (result.jackpot ? 8 : 0) + (companionAssist ? 2 : 0);
      const remaining = Math.max(0, targetHp - damage);
      if (target === "rowan") setRowanHp(remaining);
      else setEnemyHp(remaining);
      audio.play("enemyDamaged");
      addLog(`${aimed ? "AIMED" : activeWeaponType === "melee" || activeWeaponType === "unarmed" ? "CLOSE" : "SNAP"} ATTACK · ${damage} damage with ${activeWeapon?.name || "bare hands"} to ${target === "rowan" ? "Rowan" : "Rabid Squirrel"}.`, "good");
      if (remaining === 0) {
        setCombat("won");
        if (target === "rowan") {
          awardXp(40);
          setWorldFlags((flags) => [...new Set([...flags, "Rowan killed by Courier"])]);
          setCompanions((entries) => entries.map((companion) => companion.id === "rowan" ? { ...companion, status: "dead", hp: 0, loyalty: 0, morale: 0, opinion: "Dead.", history: [...companion.history, "Killed by the Courier in downtown Syracuse."].slice(-10) } : companion));
          setQuests((entries) => entries.map((quest) => quest.giver === "Rowan Vale" && quest.status === "active" ? { ...quest, status: "failed", history: [...quest.history, "Failed when Rowan Vale was killed."].slice(-10), updatedAt: Date.now() } : quest));
          addLog("ROWAN FALLS · +40 XP · Her story ends here.", "bad");
        } else {
          awardXp(65);
          if (!worldFlags.includes("Salt Yard squirrel killed")) setWorldFlags((v) => [...v, "Salt Yard squirrel killed"]);
          addLog("ENCOUNTER WON · +65 XP · The squirrel's corpse can now be looted.", "good");
          const questEffect = finishQuest("salt-yard-pest", "completed", "The Courier killed the rabid squirrel at Armory Alley.");
          if (questEffect) addLog(questEffect, "good");
        }
        return;
      }
    } else {
      addLog(activeWeaponType === "melee" || activeWeaponType === "unarmed" ? "The strike cuts empty air." : "The shot powders a patch of dead asphalt.", "bad");
    }
    if (availableAp - cost < Math.min(3, activeWeaponAp)) void enemyTurn(target);
  };

  const defend = async () => {
    if (combat !== "player" || ap < 2 || isSpinning) return;
    setSelectedAction("Brace");
    bracedRef.current = true;
    setAp((v) => v - 2);
    const result = await spinFate("Defensive read");
    if (result.score < 45 + skills.Survival * 5) {
      setHp((v) => Math.min(maxHp, v + 2));
      addLog("You find solid footing. +2 HP.", "good");
    } else addLog(combatTarget === "rowan" ? "You brace behind a rusted mailbox. Rowan keeps her sights trained." : "You brace. The squirrel circles.");
    enemyTurn(combatTarget);
  };

  const travel = async (place: (typeof cities)[number]) => {
    if (place.name !== playableCity) {
      addLog(`${place.name} is outside the current playable build. Syracuse must be finished first.`, "bad");
      return;
    }
    setPanel(null);
    setLocation("Downtown Syracuse — Clinton Square");
    addLog("Syracuse selected. All other routes remain closed while their districts are built.", "system");
  };

  const fallbackDialogue = (message: string, roll: number) => {
    const subject = message.toLowerCase().match(/[a-z']{4,}/g)?.find((word) => !["what", "where", "when", "that", "this", "with", "your", "about", "would", "could"].includes(word)) || "that";
    const previous = [...conversation].reverse().find((line) => line.speaker === "YOU")?.text;
    const seed = [...message].reduce((total, character) => total + character.charCodeAt(0), roll + conversation.length);
    const responses = [
      `You chose “${subject}” carefully. I can hear the request underneath it, but I want you to say which part costs me something.`,
      `${previous ? `That's not quite where you left the last thought.` : "You waited before saying that."} Are you asking what I know about ${subject}, or what I'm willing to do about it?`,
      `The Fate reels liked your timing more than I did. Give me one concrete thing about ${subject}, and I'll give you one honest answer.`,
      `I don't have a clean answer for ${subject}. I have a useful one, but those usually come with terms.`,
    ];
    return responses[seed % responses.length];
  };

  const speakWithDeviceVoice = (text: string, character: "player" | "rowan") => new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
    const preferred = character === "rowan"
      ? voices.find((voice) => /zira|samantha|aria|jenny|female|woman|natural/i.test(voice.name)) || voices.find((voice) => /natural|neural/i.test(voice.name)) || voices[1] || voices[0]
      : voices.find((voice) => /david|guy|christopher|male|man|mark/i.test(voice.name)) || voices.find((voice) => /natural|neural/i.test(voice.name)) || voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = character === "rowan" ? .9 : .96;
    utterance.pitch = character === "rowan" ? .88 : .78;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });

  const queueVoice = (text: string, character: "player" | "rowan", mood = "neutral") => {
    if (!voiceEnabled || !text.trim()) return;
    voiceQueue.current = voiceQueue.current.then(async () => {
      setSpeakingCharacter(character === "rowan" ? "ROWAN" : "YOU");
      try {
        const response = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, character, mood }),
        });
        if (!response.ok) throw new Error("Hosted voice unavailable");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          activeAudio.current = audio;
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(() => { URL.revokeObjectURL(url); resolve(); });
        });
      } catch {
        await speakWithDeviceVoice(text, character);
      } finally {
        activeAudio.current = null;
        setSpeakingCharacter(null);
      }
    });
  };

  const toggleVoice = () => {
    setVoiceEnabled((enabled) => {
      if (enabled) {
        activeAudio.current?.pause();
        window.speechSynthesis?.cancel();
        setSpeakingCharacter(null);
      }
      return !enabled;
    });
  };

  const applyDialogueAction = (action: DialogueAction) => {
    const amount = Math.round(Number(action.amount) || 0);
    switch (action.type) {
      case "add_world_flag":
        if (!action.target || worldFlags.includes(action.target)) return null;
        setWorldFlags((flags) => [...new Set([...flags, action.target])]);
        return `WORLD STATE · ${action.target}`;
      case "remove_world_flag":
        if (!worldFlags.includes(action.target)) return null;
        setWorldFlags((flags) => flags.filter((flag) => flag !== action.target));
        return `WORLD STATE REMOVED · ${action.target}`;
      case "award_xp": {
        const gained = Math.max(1, Math.min(25, amount));
        awardXp(gained);
        return `+${gained} XP · ${action.reason}`;
      }
      case "change_chips": {
        const change = Math.max(-25, Math.min(25, amount));
        if (change < 0 && chips < Math.abs(change)) return "TRANSACTION FAILED · Not enough chips";
        setChips((value) => Math.max(0, value + change));
        audio.play(change > 0 ? "loot" : "ui");
        return `${change >= 0 ? "+" : ""}${change} CHIPS · ${action.reason}`;
      }
      case "change_hp": {
        const change = Math.max(-12, Math.min(12, amount));
        setHp((value) => Math.max(1, Math.min(maxHp, value + change)));
        return `${change >= 0 ? "+" : ""}${change} HP · ${action.reason}`;
      }
      case "change_ap": {
        const change = Math.max(-7, Math.min(7, amount));
        setAp((value) => Math.max(0, Math.min(7, value + change)));
        return `${change >= 0 ? "+" : ""}${change} AP · ${action.reason}`;
      }
      case "damage_enemy": {
        if (action.target !== "squirrel" || enemyHp <= 0) return null;
        const damage = Math.max(1, Math.min(12, amount));
        const remaining = Math.max(0, enemyHp - damage);
        setEnemyHp(remaining);
        audio.play("enemyDamaged");
        if (!remaining) {
          setCombat("won");
          setWorldFlags((flags) => [...new Set([...flags, "Rowan killed the Salt Yard squirrel"])]);
          const questEffect = finishQuest("salt-yard-pest", "completed", "Rowan killed the rabid squirrel during the conversation.");
          if (questEffect) addLog(questEffect, "good");
        }
        return `ROWAN ATTACKS · ${damage} damage${remaining ? "" : " · enemy defeated"}`;
      }
      case "set_combat":
        if (action.target === "player") {
          return startCombat("rowan", "npc") ? "COMBAT STARTED · Rowan seized the opening turn" : null;
        }
        if (action.target === "idle") { setCombat("idle"); return "COMBAT ENDED · Hostility stood down"; }
        if (action.target === "won" && enemyHp <= 0) { setCombat("won"); return "ENCOUNTER RESOLVED"; }
        return null;
      case "unlock_door": {
        const target = Object.values(interactions).find((entry) => entry.id === action.target);
        if (!target || target.inaccessible || unlockedDoors.includes(target.id)) return null;
        setUnlockedDoors((doors) => [...new Set([...doors, target.id])]);
        audio.play("lockpick");
        return `ACCESS GRANTED · ${target.label}`;
      }
      case "enter_interior": {
        const target = Object.values(interactions).find((entry) => entry.interior === action.target);
        if (!target?.interior || target.inaccessible) return null;
        setUnlockedDoors((doors) => [...new Set([...doors, target.id])]);
        setInterior(target.interior);
        setLocation(`${target.interior}, Downtown Syracuse`);
        audio.play("door");
        return `ENTERED · ${target.interior}`;
      }
      case "move_player": {
        const anchors: Record<string, { x: number; y: number }> = {
          rowan: { x: 36, y: 72 }, clinton_square: { x: 35, y: 58 },
          salina_crossing: { x: 52, y: 64 }, squirrel_alley: { x: 61, y: 76 },
        };
        const destinationPoint = anchors[action.target];
        if (!destinationPoint) return null;
        const actorZones: CollisionZone[] = [
          ...authoredCollisionZones,
          ...(rowanHp > 0 ? [{ kind: "ellipse" as const, x: rowanPosition.x, y: rowanPosition.y, rx: 1.5, ry: 1.1, label: "Rowan" }] : []),
          ...(enemyHp > 0 ? [{ kind: "ellipse" as const, x: enemyPosition.x, y: enemyPosition.y, rx: 1.35, ry: 1, label: "rabid squirrel" }] : []),
        ];
        const route = findWalkPath(playerPosition, destinationPoint, actorZones, activeWalkBounds, !worldProject);
        if (!route.length) return "MOVE BLOCKED · no safe route";
        beginRoute(route);
        return `MOVED · ${action.target.replaceAll("_", " ")}`;
      }
      case "grant_skill_points": {
        const gained = Math.max(1, Math.min(3, amount));
        setSkillPoints((points) => points + gained);
        return `+${gained} SKILL POINT${gained === 1 ? "" : "S"}`;
      }
      case "modify_skill": {
        if (!(action.target in skills)) return null;
        const name = action.target as keyof typeof skills;
        const change = amount < 0 ? -1 : 1;
        setSkills((values) => ({ ...values, [name]: Math.max(0, Math.min(10, values[name] + change)) }));
        return `${name.toUpperCase()} ${change > 0 ? "+1" : "−1"} · ${action.reason}`;
      }
      case "add_item": {
        const template = dialogueItemCatalog[action.target];
        if (!template || inventory.some((item) => inventoryKey(item) === action.target)) return null;
        if (action.target === "scrapshot-box" && chips < 3) return "ITEM NOT RECEIVED · Payment did not clear";
        const position = findInventorySpace(inventory, template.w, template.h);
        if (!position) return "ITEM NOT RECEIVED · Pack has no room";
        setInventory((items) => [...items, { ...template, ...position }]);
        audio.play("loot");
        return `ITEM RECEIVED · ${template.name}`;
      }
      case "remove_item": {
        const item = inventory.find((entry) => inventoryKey(entry) === action.target);
        if (!item) return null;
        setInventory((items) => items.filter((entry) => entry.id !== item.id));
        return `ITEM REMOVED · ${item.name}`;
      }
      case "equip_item": {
        const [key, requestedSlot] = action.target.split("@");
        const item = inventory.find((entry) => inventoryKey(entry) === key);
        const slot = requestedSlot as EquipSlot;
        if (!item || !["head", "torso", "legs", "hands", "feet", "holster-left", "holster-right"].includes(slot)) return null;
        const compatible = item.fits === slot || (item.fits === "holster" && slot.startsWith("holster"));
        if (!compatible || inventory.some((entry) => entry.id !== item.id && entry.equipped === slot)) return null;
        setInventory((items) => items.map((entry) => entry.id === item.id ? { ...entry, equipped: slot } : entry));
        if (slot === "holster-left" || slot === "holster-right") setActiveHolster(slot);
        audio.play("equip");
        return `EQUIPPED · ${item.name}`;
      }
      case "open_panel":
        if (!["inventory", "skills", "map", "journal", "help"].includes(action.target)) return null;
        window.setTimeout(() => setPanel(action.target as Panel), 900);
        return `OPENING ${action.target.toUpperCase()} · ${action.reason}`;
      case "create_quest": {
        const [id, title, firstObjective] = parseActionTarget(action.target);
        if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(id || "") || !title || !firstObjective || quests.some((quest) => quest.id === id) || createdQuestIds.current.has(id)) return null;
        createdQuestIds.current.add(id);
        const rewardXp = Math.max(5, Math.min(75, amount || 15));
        const quest: QuestState = {
          id,
          title: title.slice(0, 64),
          description: action.reason.slice(0, 220),
          giver: "Rowan Vale",
          status: "active",
          objectives: [{ id: `${id}-1`, text: firstObjective.slice(0, 120), complete: false }],
          rewardXp,
          history: [`Quest accepted through dialogue with Rowan: ${action.reason}`],
          updatedAt: Date.now(),
        };
        setQuests((entries) => [...entries, quest]);
        return `NEW QUEST · ${quest.title}`;
      }
      case "edit_quest": {
        const [id, operation, value] = parseActionTarget(action.target);
        const quest = quests.find((entry) => entry.id === id && entry.status === "active");
        if (!quest || !operation || !value) return null;
        const validOperations = ["title", "description", "add_objective", "complete_objective", "remove_objective"];
        if (!validOperations.includes(operation)) return null;
        setQuests((entries) => entries.map((entry) => {
          if (entry.id !== id) return entry;
          let objectives = entry.objectives;
          let title = entry.title;
          let description = entry.description;
          if (operation === "title") title = value.slice(0, 64);
          if (operation === "description") description = value.slice(0, 220);
          if (operation === "add_objective" && !objectives.some((objective) => objective.text.toLowerCase() === value.toLowerCase())) objectives = [...objectives, { id: `${id}-${Date.now()}`, text: value.slice(0, 120), complete: false }];
          if (operation === "complete_objective") objectives = objectives.map((objective, index) => objective.id === value || String(index + 1) === value || objective.text.toLowerCase().includes(value.toLowerCase()) ? { ...objective, complete: true } : objective);
          if (operation === "remove_objective" && objectives.length > 1) objectives = objectives.filter((objective, index) => objective.id !== value && String(index + 1) !== value && !objective.text.toLowerCase().includes(value.toLowerCase()));
          return { ...entry, title, description, objectives, history: [...entry.history, action.reason].slice(-10), updatedAt: Date.now() };
        }));
        return `QUEST UPDATED · ${quest.title} · ${action.reason}`;
      }
      case "complete_quest":
        return finishQuest(action.target, "completed", action.reason);
      case "fail_quest":
        return finishQuest(action.target, "failed", action.reason);
      case "add_companion":
        if (action.target !== "rowan" || npc.trust < 20 || worldFlags.includes("Rowan became hostile")) return null;
        return setCompanionStatus("rowan", "active", action.reason);
      case "remove_companion":
        if (action.target !== "rowan") return null;
        return setCompanionStatus("rowan", "dismissed", action.reason);
      case "modify_companion": {
        const [id, field] = parseActionTarget(action.target);
        const companion = companions.find((entry) => entry.id === id && entry.status !== "dead");
        if (!companion || !["loyalty", "morale", "hp"].includes(field)) return null;
        const change = Math.max(-20, Math.min(20, amount));
        if (field === "hp") setRowanHp(Math.max(0, Math.min(companion.maxHp, companion.hp + change)));
        setCompanions((entries) => entries.map((entry) => {
          if (entry.id !== id) return entry;
          if (field === "hp") {
            const nextHp = Math.max(0, Math.min(entry.maxHp, entry.hp + change));
            return { ...entry, hp: nextHp, status: nextHp === 0 ? "dead" : entry.status, opinion: action.reason, history: [...entry.history, action.reason].slice(-10) };
          }
          if (field === "loyalty") return { ...entry, loyalty: clamp(entry.loyalty + change), opinion: action.reason, history: [...entry.history, action.reason].slice(-10) };
          return { ...entry, morale: clamp(entry.morale + change), opinion: action.reason, history: [...entry.history, action.reason].slice(-10) };
        }));
        return `COMPANION ${field.toUpperCase()} ${change >= 0 ? "+" : ""}${change} · ${companion.name}`;
      }
      case "close_dialogue":
        window.setTimeout(() => setPanel(null), 1200);
        return "CONVERSATION ENDED";
      default:
        return null;
    }
  };

  const speak = async (spokenMessage?: string) => {
    const message = (spokenMessage ?? dialogueInput).trim();
    if (!message || dialogueBusy) return;
    setDialogueInput("");
    setConversation((v) => [...v, { speaker: "YOU", text: message }]);
    setDialogueBusy(true);
    // Live mic already carries the player's real voice; only typed dialogue needs synthetic player narration.
    if (!liveConversation) queueVoice(message, "player", "intentional");
    const slot = await spinFate("Dialogue check");
    try {
      const response = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message, npc, skills, luck, slot: slot.score, worldFlags, location,
          history: conversation.slice(-24),
          game: {
            hp, maxHp, ap, enemyHp, rowanHp, combat, combatTarget, selectedNpc, level, xp, xpGoal, chips, skillPoints,
            unlockedDoors, interior, playerPosition, rowanPosition, activeHolster,
            inventory: inventory.map((item) => ({ id: item.id, name: item.name, equipped: item.equipped })),
            quests,
            companions,
          } satisfies DialogueGameSnapshot,
        }),
      });
      if (!response.ok) throw new Error("Dialogue service unavailable");
      const turn = await response.json() as DialogueTurn;
      setDialogueEngine(turn.engine || "ai");
      queueVoice(turn.reply, "rowan", turn.mood || npc.mood);
      setNpc((old) => ({
        trust: clamp(old.trust + Number(turn.trustDelta || 0)),
        respect: clamp(old.respect + Number(turn.respectDelta || 0)),
        fear: clamp(old.fear + Number(turn.fearDelta || 0)),
        mood: turn.mood || old.mood,
        opinion: turn.opinion || old.opinion,
        memories: [...old.memories, turn.memory || `You said: ${message}`].slice(-12),
      }));
      setCompanions((entries) => entries.map((companion) => companion.id === "rowan" && companion.status !== "dead" && companion.status !== "hostile" ? {
        ...companion,
        loyalty: clamp(companion.loyalty + Math.round(Number(turn.trustDelta || 0) / 2)),
        morale: clamp(companion.morale + Math.round(Number(turn.respectDelta || 0) / 2) - Math.max(0, Number(turn.fearDelta || 0))),
        opinion: turn.opinion || companion.opinion,
        history: turn.memory ? [...companion.history, turn.memory].slice(-10) : companion.history,
      } : companion));
      const effects = (turn.actions || []).map(applyDialogueAction).filter((effect): effect is string => Boolean(effect));
      effects.forEach((effect) => addLog(effect, effect.includes("FAILED") ? "bad" : "system"));
      const checkText = effects.length ? effects.join(" · ") : turn.actionCheck || "No immediate world change.";
      setConversation((lines) => [...lines, { speaker: "ROWAN", text: turn.reply }, { speaker: "WORLD", text: `ACTION CHECK · ${checkText}` }]);
      if (turn.conversationStatus === "end" && !(turn.actions || []).some((action) => action.type === "close_dialogue" || action.type === "set_combat")) {
        window.setTimeout(() => setPanel(null), 1400);
      }
    } catch {
      const reply = fallbackDialogue(message, slot.score);
      setDialogueEngine("local");
      setConversation((v) => [...v, { speaker: "ROWAN", text: reply }, { speaker: "WORLD", text: "ACTION CHECK · Dialogue service unreachable; no game state changed." }]);
      queueVoice(reply, "rowan", slot.score < 55 ? "curious" : "guarded");
      setNpc((old) => ({
        ...old,
        trust: clamp(old.trust + (slot.score < 55 ? 2 : -1)),
        mood: slot.score < 55 ? "Curious" : "Guarded",
        opinion: slot.score < 55 ? "Odd, but maybe worth knowing." : "Talks more easily than they listen.",
        memories: [...old.memories, `You said: ${message}`].slice(-6),
      }));
    } finally {
      setDialogueBusy(false);
    }
  };

  const upgradeSkill = (name: keyof typeof skills) => {
    if (!skillPoints) return;
    setSkills((v) => ({ ...v, [name]: v[name] + 1 }));
    setSkillPoints((v) => v - 1);
  };

  useEffect(() => {
    const handleSaveKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") && event.key !== "Escape") return;
      if (event.key === "F5") {
        event.preventDefault();
        if (!mainMenu) quickSave();
      } else if (event.key === "F9") {
        event.preventDefault();
        quickLoad();
      } else if (event.key === "Escape") {
        if (panel) setPanel(null);
        else if (!mainMenu) setMainMenu(true);
      }
    };
    window.addEventListener("keydown", handleSaveKeys);
    return () => window.removeEventListener("keydown", handleSaveKeys);
  }, [mainMenu, panel, quickSave, quickLoad]);

  return (
    <main className="game-shell" onClickCapture={(event) => {
      const target = event.target as HTMLElement;
      if (!mainMenu && target.closest("button")) audio.play("ui");
    }}>
      {mainMenu && <section className="main-menu" aria-label="Life is a Gamble main menu">
        <div className="menu-sector-stamp" aria-hidden="true">
          <span>FENNX CREATIVE</span>
          <b>SYRACUSE<br/>EXCLUSION<br/>ZONE</b>
          <i>EST. 2186</i>
        </div>
        <div className="main-menu-card">
          <div className="menu-classification"><span>100 YEARS AFTER THE FEDERAL SILENCE</span><b>FIELD TERMINAL // 01</b></div>
          <div className="menu-title-lockup">
            <small>A POST-FEDERAL ROLE-PLAYING GAME</small>
            <h2>LIFE <i>IS A</i> GAMBLE</h2>
            <p>Luck is the last law left standing.</p>
          </div>
          <div className="menu-divider"><i/><span>SELECT DEPLOYMENT</span><i/></div>
          <div className="main-menu-actions">
            <button className="enter-game" disabled={!hasActiveSave} onClick={() => { void audio.activate("menu"); audio.play("door"); setMainMenu(false); }}><span>CONTINUE</span><small>Return to the Syracuse ruins</small></button>
            <button onClick={() => { void startNewGame(); }}><span>NEW GAME</span><small>Begin a new wager</small></button>
            <button onClick={() => setPanel("saves")} disabled={!saveSlots.length}><span>LOAD GAME</span><small>Open the save archive</small></button>
          </div>
          <div className="menu-footer"><span>SYRACUSE, NEW YORK // 2186</span><em>F5 QUICK SAVE · F9 QUICK LOAD · ESC PAUSE</em></div>
        </div>
      </section>}
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">A POST-FEDERAL ROLE-PLAYING GAME</span>
          <h1>LIFE <i>IS A</i> GAMBLE</h1>
        </div>
        <div className="location-block"><span>◈ CURRENT SECTOR</span><strong>{location}</strong><div className="audio-controls"><button onClick={audio.toggleMusic} aria-pressed={audio.musicOn}>MUSIC {audio.musicOn ? "ON" : "OFF"}</button><button onClick={audio.toggleSfx} aria-pressed={audio.sfxOn}>SFX {audio.sfxOn ? "ON" : "OFF"}</button></div></div>
        <div className="top-stats">
          <div><span>LEVEL</span><b>{level}</b></div>
          <div className="xp-stat"><span>XP {xp}/{xpGoal}</span><div><i style={{ width: `${(xp / xpGoal) * 100}%` }} /></div></div>
          <div><span>CHIPS</span><b>{chips}</b></div>
        </div>
      </header>

      <section className="world-layout">
        <aside className="left-rail">
          <button className={panel === "map" ? "active" : ""} onClick={() => setPanel(panel === "map" ? null : "map")}><b>◉</b><span>WORLD</span><em>M</em></button>
          <button className={panel === "inventory" ? "active" : ""} onClick={() => setPanel(panel === "inventory" ? null : "inventory")}><b>▦</b><span>PACK</span><em>I</em></button>
          <button className={panel === "skills" ? "active" : ""} onClick={() => setPanel(panel === "skills" ? null : "skills")}><b>✦</b><span>SKILLS</span><em>K</em></button>
          <button className={panel === "journal" ? "active" : ""} onClick={() => setPanel(panel === "journal" ? null : "journal")}><b>◆</b><span>JOURNAL</span><em>J</em></button>
          <button className={panel === "saves" ? "active" : ""} onClick={() => setPanel(panel === "saves" ? null : "saves")}><b>▣</b><span>SAVES</span><em>F5</em></button>
          <button className={panel === "help" ? "active" : ""} onClick={() => setPanel(panel === "help" ? null : "help")}><b>?</b><span>CODEX</span><em>H</em></button>
        </aside>

        <section
          ref={sceneRef}
          className="scene city-scene"
          aria-label="Walkable downtown Syracuse isometric game scene"
          onClick={walkTo}
          onContextMenu={(event) => { event.preventDefault(); setContextMenu(null); }}
        >
          {!interior ? <>
            <div className="syracuse-skyline"><i /><i /><i /><i /><i /><i /></div>
            <div className="scene-title downtown-title"><small>DISTRICT LOADED · CLICK GROUND TO WALK</small><strong>DOWNTOWN SYRACUSE</strong><span>CLINTON SQUARE ↔ ARMORY SQUARE · 0.3 MI COMPRESSED</span></div>
            {worldProject && worldLevel ? <WorldScene project={worldProject} levelId={worldLevel.id} assetEndpoint={worldSource === "github" ? "/api/game/assets" : ""} hideObjectIds={["scene-courier", "scene-rowan", "scene-squirrel"]} onObjectContextMenu={openAuthoredObject} onDoorClick={(event, cell, door) => openAuthoredDoor(event, cell.id, door.id)} onDoorContextMenu={(event, cell, door) => openAuthoredDoor(event, cell.id, door.id)} /> : <><div className="level-ground">
              <div className="road road-east-west"><span>W FAYETTE STREET</span></div>
              <div className="road road-north-south"><span>S SALINA STREET</span></div>
              <div className="sidewalk sidewalk-north"/><div className="sidewalk sidewalk-south"/>
              <div className="sidewalk sidewalk-west"/><div className="sidewalk sidewalk-east"/>
              <div className="crosswalk cross-north"/><div className="crosswalk cross-south"/>
              <div className="crosswalk cross-west"/><div className="crosswalk cross-east"/>
              <div className="corner-plaza"><span>CLINTON SQUARE</span></div>
              <div className="street-cracks"/><div className="drain drain-a"/><div className="drain drain-b"/>
            </div>

            <div className="streetwall-row" aria-label="North Fayette Street building frontage">
              <ModularBuilding className="build-bank" name="ONONDAGA TRUST" subtitle="SEALED PROPERTY" material="stone" floors={4} bays={4} door={interactions.bankDoor} doorBay={1} damaged facade={{ kind: "storefront", id: "onondaga-trust" }} onInteract={openInteraction} />
              <ModularBuilding className="build-canal" name="ERIE CANAL MUSEUM" subtitle="WEIGHLOCK ARCHIVE · OPEN" material="brick" floors={3} bays={4} door={interactions.museumDoor} doorBay={2} damaged facade={{ kind: "landmark", id: "erie-canal-museum" }} onInteract={openInteraction} />
              <ModularBuilding className="build-provisioners" name="CLINTON PROVISIONERS" subtitle="TRADE GOODS · LOCKED" material="brick" floors={2} bays={4} door={interactions.supplyDoor} doorBay={3} storefront facade={{ kind: "storefront", id: "clinton-provisioners" }} onInteract={openInteraction} />
              <ModularBuilding className="build-market" name="SALINA MARKET" subtitle="SHUTTERED" material="brick" floors={3} bays={5} door={interactions.marketDoor} doorBay={3} storefront damaged facade={{ kind: "storefront", id: "salina-market" }} onInteract={openInteraction} />
              <ModularBuilding className="build-hotel" name="EMPIRE ROOMS" subtitle="CONDEMNED" material="stone" floors={4} bays={3} door={interactions.hotelDoor} doorBay={1} damaged facade={{ kind: "storefront", id: "empire-rooms" }} onInteract={openInteraction} />
              <ModularBuilding className="build-corner" name="CLINTON HOUSE" subtitle="CLAIMED · NO ENTRY" material="brick" floors={4} bays={5} door={interactions.houseDoor} doorBay={2} storefront facade={{ kind: "full", id: "clinton-house" }} onInteract={openInteraction} />
              <ModularBuilding className="build-hall" name="SYRACUSE CITY HALL" subtitle="RECORDS · LOCKED" material="stone" floors={4} bays={4} door={interactions.cityHallDoor} doorBay={1} facade={{ kind: "landmark", id: "syracuse-city-hall" }} onInteract={openInteraction} />
              <ModularBuilding className="build-foundry" name="SALT CITY FOUNDRY" subtitle="UNION PROPERTY" material="metal" floors={3} bays={5} door={interactions.foundryDoor} doorBay={4} damaged facade={{ kind: "storefront", id: "salt-city-foundry" }} onInteract={openInteraction} />
              <ModularBuilding className="build-theatre" name="LANDMARK THEATRE" subtitle="STRUCTURE UNSAFE" material="brick" floors={3} bays={5} door={interactions.theaterDoor} doorBay={2} storefront damaged facade={{ kind: "landmark", id: "landmark-theatre" }} onInteract={openInteraction} />
              <ModularBuilding className="build-warehouse" name="ARMORY STORAGE" subtitle="NO TENANT" material="metal" floors={2} bays={4} door={interactions.warehouseDoor} doorBay={2} damaged facade={{ kind: "storefront", id: "armory-storage" }} onInteract={openInteraction} />
              <ModularBuilding className="build-rowhouse" name="HANOVER ROW" subtitle="RESIDENTIAL CLAIM" material="brick" floors={3} bays={3} door={interactions.rowhouseDoor} doorBay={2} damaged facade={{ kind: "full", id: "hanover-row" }} onInteract={openInteraction} />
              <ModularBuilding className="build-saltworks" name="SALTWORKS EXCHANGE" subtitle="BOARDED" material="brick" floors={3} bays={4} door={interactions.saltworksDoor} doorBay={0} storefront damaged facade={{ kind: "full", id: "saltworks-exchange" }} onInteract={openInteraction} />
            </div>

            <button className="hotspot prop sedan-prop" onClick={(e) => openInteraction(e, interactions.sedan)} onContextMenu={(e) => openInteraction(e, interactions.sedan)} aria-label="Interact with abandoned sedan"><LandmarkSprite row={0} col={0} label="Rusted abandoned sedan" /></button>
            <button className="hotspot prop lamp-prop" onClick={(e) => openInteraction(e, interactions.lamp)} onContextMenu={(e) => openInteraction(e, interactions.lamp)} aria-label="Interact with street lamp"><LandmarkSprite row={0} col={1} label="Bent street lamp" /></button>
            <LandmarkSprite row={1} col={0} label="Scrap checkpoint barricade" className="city-prop barricade-prop" />
            <LandmarkSprite row={1} col={1} label="Dead tree planter" className="city-prop tree-prop" />
            {cityDecor.map((decor, index) => <DecorSprite key={`${decor.className}-${index}`} {...decor} />)}</>}

            <div className="walk-destination" style={{ left: `${worldToScenePoint(destination).x}%`, top: `${worldToScenePoint(destination).y}%` }} />
            <div className={`downtown-player weapon-${activeWeaponType}${walking ? ` walking ${movementMode}` : ""}${weaponFiring ? " weapon-firing" : ""}`} data-facing={walkFacing} data-weapon={activeWeaponType} style={{ left: `${worldToScenePoint(playerPosition).x}%`, top: `${worldToScenePoint(playerPosition).y}%`, transitionDuration: `${walkDuration}ms` }}>
              <div className="status-tag you">YOU {walking ? `· ${movementMode === "run" ? "RUNNING" : "WALKING"}` : "· READY"}</div>
              {walking
                ? <CourierMotionSprite mode={movementMode} frame={walkFrame} label={`Courier ${movementMode} in downtown Syracuse`} />
                : <PlayerWeaponSprite weaponType={activeWeaponType} firing={weaponFiring} label={`Courier ${weaponFiring ? "attacking with" : "carrying"} ${activeWeapon?.name || "no weapon"} in downtown Syracuse`} />}
              {weaponFiring && activeWeaponType !== "unarmed" && activeWeaponType !== "melee" && <div className="ballistic-fx" aria-hidden="true"><i/><b/></div>}
              <div className="entity-ring" />
            </div>

            {rowanHp > 0 && <NpcActor
              className="downtown-rowan"
              status={`ROWAN · ${selectedNpc === "rowan" ? "TARGETED" : "WARY"}`}
              statusTone="npc"
              row={2}
              col={npc.trust > 35 ? 3 : 0}
              label="Target Rowan Vale"
              position={worldToScenePoint(rowanPosition)}
              selected={selectedNpc === "rowan"}
              motion={combatTarget === "rowan" && combat === "enemy" && enemyTactic === "FIRING" ? "attack" : rowanMoving ? "patrol" : combatTarget === "rowan" && combat !== "idle" ? "combat" : "idle"}
              facing={rowanFacing}
              onClick={(event) => { event.stopPropagation(); selectNpc("rowan"); }}
              onContextMenu={(event) => openNpcInteraction(event, "rowan")}
              transitionMs={rowanMoveDuration}
            />}
            {enemyHp > 0 && <NpcActor
              className="downtown-squirrel"
              status={`RABID SQUIRREL · ${selectedNpc === "squirrel" ? "TARGETED" : `${enemyHp}/18`}`}
              statusTone="enemy"
              row={1}
              col={squirrelFrame}
              label="Target rabid squirrel"
              motion={combatTarget === "squirrel" && combat === "enemy" && enemyTactic === "LUNGING" ? "attack" : enemyMoving ? "patrol" : combatTarget === "squirrel" && combat !== "idle" ? "combat" : "idle"}
              facing={enemyFacing}
              position={worldToScenePoint(enemyPosition)}
              transitionMs={enemyMoveDuration}
              selected={selectedNpc === "squirrel"}
              onClick={(event) => { event.stopPropagation(); selectNpc("squirrel"); }}
              onContextMenu={(event) => openNpcInteraction(event, "squirrel")}
            />}
            {rowanHp <= 0 && <button className={`corpse-actor corpse-actor-rowan${lootedCorpses.includes("rowan") ? " looted" : ""}`} style={{ left: `${worldToScenePoint({ x: rowanPosition.x, y: rowanPosition.y + 2 }).x}%`, top: `${worldToScenePoint({ x: rowanPosition.x, y: rowanPosition.y + 2 }).y}%` }} onClick={(event) => openInteraction(event, corpseInteractions.rowan)} onContextMenu={(event) => openInteraction(event, corpseInteractions.rowan)} aria-label="Loot Rowan Vale's body"><CorpseSprite character="rowan" label="Rowan Vale lying dead" /><span>{lootedCorpses.includes("rowan") ? "SEARCHED" : "LOOT"}</span></button>}
            {enemyHp <= 0 && <button className={`corpse-actor corpse-actor-squirrel${lootedCorpses.includes("squirrel") ? " looted" : ""}`} style={{ left: `${worldToScenePoint({ x: enemyPosition.x, y: enemyPosition.y + 1 }).x}%`, top: `${worldToScenePoint({ x: enemyPosition.x, y: enemyPosition.y + 1 }).y}%` }} onClick={(event) => openInteraction(event, corpseInteractions.squirrel)} onContextMenu={(event) => openInteraction(event, corpseInteractions.squirrel)} aria-label="Loot rabid squirrel corpse"><CorpseSprite character="squirrel" label="Rabid squirrel lying dead" /><span>{lootedCorpses.includes("squirrel") ? "SEARCHED" : "LOOT"}</span></button>}
            <div className="control-hint"><b>LEFT CLICK</b> WALK / TARGET NPC <i>•</i> <b>RIGHT CLICK</b> TYPE-AWARE ACTIONS <i>•</i> <b>WORLD</b> {worldSource === "github" ? "TESTING SYNCED" : worldSource === "bundled" ? "BUNDLED RELEASE" : "OFFLINE FALLBACK"}</div>
          </> : <div className="interior-scene">
            <div className="interior-wall left-wall" /><div className="interior-wall right-wall" />
            <EnvSprite row={0} col={3} label="Interior brick floor" className="interior-floor" />
            <EnvSprite row={1} col={0} label="Interior brick wall" className="interior-brick" />
            <EnvSprite row={2} col={2} label="Interior scrap counter" className="interior-counter" />
            <div className="interior-card"><small>INTERIOR CELL</small><h2>{interior}</h2><p>{interior.includes("Museum") ? "Stacks of canal manifests survive behind steel mesh. Someone has circled Albany-bound shipments in red grease pencil." : interior.includes("City Hall") ? "Municipal ledgers cover the desks. The last entry is dated three weeks after the Federal Silence began." : "Shelves of canned roots and shotgun shells line the old storefront. The shopkeeper is elsewhere—for now."}</p><button onClick={(e) => { e.stopPropagation(); setInterior(null); setLocation("Downtown Syracuse — Clinton Square"); addLog(`Exited ${interior}.`); }}>EXIT TO STREET</button></div>
            <div className="interior-player"><CourierMotionSprite mode="idle" frame={0} label="Courier inside building" /><div className="entity-ring" /></div>
          </div>}

          {contextMenu && <div className="interaction-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
            <header><small>INTERACT WITH</small><strong>{contextMenu.target.label}</strong></header>
            {contextMenu.target.kind === "door" ? <>
              {contextMenu.target.inaccessible ? <button disabled><b>×</b><span>INACCESSIBLE<small>Collapsed beyond this point</small></span></button> : <button onClick={() => enterTarget(contextMenu.target)}><b>↳</b><span>ENTER<small>{contextMenu.target.locked && !unlockedDoors.includes(contextMenu.target.id) ? "Door is locked" : "Open passage"}</small></span></button>}
              {contextMenu.target.lockpick && !unlockedDoors.includes(contextMenu.target.id) && <button onClick={() => lockpickTarget(contextMenu.target)}><b>⌁</b><span>LOCKPICK<small>Mechanics {skills.Mechanics} + Luck {luck}</small></span></button>}
              <button onClick={() => { addLog(`${contextMenu.target.label}: ${contextMenu.target.inaccessible ? "the structure behind it has collapsed." : "a century-old entrance reinforced by recent hands."}`); setContextMenu(null); }}><b>?</b><span>EXAMINE<small>Perception check</small></span></button>
            </> : contextMenu.target.kind === "npc" ? <>
              <button disabled={!contextMenu.target.canTalk || contextMenu.target.npcId !== "rowan" || rowanHp <= 0 || combat === "enemy"} onClick={() => { setContextMenu(null); setPanel("dialogue"); }}><b>“</b><span>TALK<small>{contextMenu.target.canTalk ? "Open dialogue" : "It cannot be reasoned with"}</small></span></button>
              <button onClick={() => { const npcId = contextMenu.target.npcId; setContextMenu(null); if (npcId) startCombat(npcId); }} disabled={!contextMenu.target.npcId || combat === "enemy"}><b>⌖</b><span>ATTACK<small>Initiate turn-based combat</small></span></button>
              <button onClick={() => { addLog(`${contextMenu.target.label}: ${contextMenu.target.npcId === "rowan" ? npc.opinion : "Fever-bright eyes track every movement."}`); setContextMenu(null); }}><b>?</b><span>EXAMINE<small>Read current disposition</small></span></button>
            </> : contextMenu.target.kind === "corpse" ? <>
              <button onClick={() => contextMenu.target.corpseId && lootCorpse(contextMenu.target.corpseId)} disabled={!contextMenu.target.corpseId || lootedCorpses.includes(contextMenu.target.corpseId)}><b>▦</b><span>{contextMenu.target.corpseId && lootedCorpses.includes(contextMenu.target.corpseId) ? "SEARCHED" : "LOOT"}<small>Transfer carried items to pack</small></span></button>
              <button onClick={() => { addLog(contextMenu.target.corpseId === "rowan" ? "Rowan Vale is dead. Her body will remain where she fell." : "The rabid animal is dead. Its body will remain in Armory Alley."); setContextMenu(null); }}><b>?</b><span>EXAMINE<small>Inspect remains</small></span></button>
            </> : <>
              {(contextMenu.target.action === "search" || contextMenu.target.tags?.some((tag) => /loot|container|search/i.test(tag))) && <button onClick={() => interactWithProp({ ...contextMenu.target, action: "search" })}><b>⌕</b><span>SEARCH<small>Check this {contextMenu.target.authoredType || "object"} for usable items</small></span></button>}
              {contextMenu.target.trigger && <button onClick={() => { addLog(`${contextMenu.target.label}: trigger activated.`); setContextMenu(null); }}><b>◆</b><span>ACTIVATE<small>Run the authored world trigger</small></span></button>}
              <button onClick={() => interactWithProp({ ...contextMenu.target, action: "inspect" })}><b>?</b><span>EXAMINE<small>Inspect {contextMenu.target.authoredType || "object"} properties</small></span></button>
            </>}
          </div>}
          {combat === "won" && <div className="victory-stamp">{combatTarget === "rowan" ? "ROWAN DEFEATED" : "ARMORY ALLEY CLEARED"} <span>{combatTarget === "rowan" ? "+40 XP" : "+65 XP"}</span></div>}
        </section>

        <aside className="right-panel">
          <section className="vitals">
            <div className="portrait"><Sprite row={0} col={0} label="Courier portrait" /></div>
            <div><small>THE COURIER</small><strong>Drifter, Level {level}</strong><div className="meter hp"><i style={{ width: `${(hp / maxHp) * 100}%` }} /><span>HP {hp}/{maxHp}</span></div></div>
          </section>

          <button className={`companion-hud ${activeCompanion ? "active" : ""}`} onClick={() => setPanel("journal")}>
            <span>{activeCompanion ? "ACTIVE COMPANION" : "COMPANION SLOT"}</span>
            <strong>{activeCompanion?.name || "NO ONE TRAVELLING"}</strong>
            <em>{activeCompanion ? `HP ${activeCompanion.hp}/${activeCompanion.maxHp} · LOYALTY ${activeCompanion.loyalty}` : "Talk to Rowan about travelling together"}</em>
          </button>

          <section className="turn-panel">
            <div className="section-heading"><span>{combat === "player" ? "YOUR TURN" : combat === "enemy" ? `ENEMY · ${enemyTactic}` : "FIELD ACTIONS"}</span><b>{ap} AP</b></div>
            <div className="ap-pips">{Array.from({ length: 7 }, (_, i) => <i key={i} className={i < ap ? "filled" : ""} />)}</div>
            <div className={`target-readout ${selectedNpc ? "locked" : ""}`}><div><small>ACTIVE TARGET</small><strong>{selectedTargetName}</strong></div><span>{selectedNpc ? `HP ${selectedTargetHp}/${selectedTargetMaxHp}` : "CLICK AN NPC"}</span></div>
            <div className="weapon-card">
              <div className={`weapon-art weapon-${activeWeaponType}`}>{activeWeapon?.icon || "✊"}<span>{activeHolster === "holster-right" ? "R" : "L"} HOLSTER</span></div>
              <div><small>ACTIVE LOADOUT</small><strong>{activeWeapon?.name || "BARE HANDS"}</strong><span>{activeWeaponDamage[0]}–{activeWeaponDamage[1]} DMG · {activeWeaponAp} AP · {activeWeaponType.toUpperCase()}</span></div>
            </div>
            <div className="action-grid">
              <button className={selectedAction === "Attack" ? "selected" : ""} onClick={() => { setSelectedAction("Attack"); void attack(false); }} disabled={!selectedNpc || selectedTargetHp <= 0 || combat === "enemy" || isSpinning}><span>{activeWeaponAp} AP</span><b>{activeWeaponType === "melee" || activeWeaponType === "unarmed" ? "STRIKE" : "SNAP SHOT"}</b><em>{combat === "idle" ? "Start combat" : `${activeWeaponType === "melee" || activeWeaponType === "unarmed" ? "Survival" : "Guns"} + Luck`}</em></button>
              <button onClick={() => { setSelectedAction("Aim"); void attack(true); }} disabled={!selectedNpc || selectedTargetHp <= 0 || combat === "enemy" || isSpinning}><span>{activeWeaponAp + 2} AP</span><b>{activeWeaponType === "melee" || activeWeaponType === "unarmed" ? "POWER ATTACK" : "AIMED SHOT"}</b><em>{combat === "idle" ? "Start combat" : "+16% hit"}</em></button>
              <button onClick={defend} disabled={combat !== "player" || isSpinning}><span>2 AP</span><b>BRACE</b><em>Survival check</em></button>
              <button onClick={() => setPanel("dialogue")} disabled={selectedNpc !== "rowan" || rowanHp <= 0 || combat === "enemy"}><span>—</span><b>TALK</b><em>{selectedNpc === "rowan" ? "Rowan" : "Target Rowan"}</em></button>
            </div>
          </section>

          <section className="event-log">
            <div className="section-heading"><span>WASTELAND FEED</span><b>LIVE</b></div>
            <div className="log-scroll">
              {log.map((entry) => <p key={entry.id} className={entry.tone}>{entry.text}</p>)}
            </div>
          </section>
        </aside>
      </section>

      <footer className="fate-bar">
        <div className="fate-copy"><small>THE HOUSE ALWAYS LISTENS</small><strong>FATE ENGINE</strong><p>Every bullet, bargain, and bad idea is a wager.</p></div>
        <div className={`slot-machine ${isSpinning ? "spinning" : ""} ${jackpotBurst ? "jackpot" : ""}`}>
          {jackpotBurst && <div className="jackpot-burst" role="status" aria-live="assertive"><strong>777</strong><span>JACKPOT</span><em>+25 CHIPS</em>{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--coin": index } as CSSProperties} />)}</div>}
          <div className="slot-cap"><span>{slotLabel}</span><b>LUCK {luck}</b></div>
          <div className="reels">{reels.map((reel, i) => <div key={i}><span>{reel}</span></div>)}</div>
          <button onClick={() => spinFate("Tempt fate")} disabled={isSpinning}>PULL</button>
          <div className="slot-lamps"><i /><i /><i /><i /><i /></div>
        </div>
        <div className="fate-odds"><span>FATE MODIFIERS</span><div><b>+12%</b> LUCK</div><div><b>+6%</b> SKILL</div><div><b>−4%</b> RADIATION</div></div>
      </footer>

      {panel && (
        <div className={`overlay${panel === "saves" ? " save-overlay" : ""}`} role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) setPanel(null); }}>
          <section className={`modal ${panel}`} role="dialog" aria-modal="true" aria-label={`${panel} panel`}>
            <button className="close" onClick={() => setPanel(null)} aria-label="Close panel">×</button>

            {panel === "inventory" && <Inventory chips={chips} playEquip={() => audio.play("equip")} items={inventory} setItems={setInventory} activeHolster={activeHolster} setActiveHolster={setActiveHolster} />}
            {panel === "skills" && <Skills level={level} skills={skills} points={skillPoints} upgrade={upgradeSkill} />}
            {panel === "map" && <WorldMap level={level} location={location} travel={travel} />}
            {panel === "journal" && <Journal quests={quests} companions={companions} dismiss={(id) => {
              const effect = setCompanionStatus(id, "dismissed", "The Courier asked Rowan to wait in downtown Syracuse.");
              if (effect) addLog(effect, "system");
            }} />}
            {panel === "dialogue" && (
              <Dialogue
                npc={npc}
                conversation={conversation}
                input={dialogueInput}
                setInput={setDialogueInput}
                speak={speak}
                busy={dialogueBusy}
                reels={reels}
                voiceEnabled={voiceEnabled}
                liveConversation={liveConversation}
                speakingCharacter={speakingCharacter}
                toggleVoice={toggleVoice}
                toggleLiveConversation={() => setLiveConversation((enabled) => !enabled)}
                engine={dialogueEngine}
                activeQuestCount={quests.filter((quest) => quest.status === "active").length}
                companionStatus={companions.find((companion) => companion.id === "rowan")?.status || "available"}
                combatActive={combat === "enemy" && combatTarget === "rowan"}
              />
            )}
            {panel === "saves" && <SaveLoad
              slots={saveSlots}
              allowSave={!mainMenu && saveAvailable}
              blockedReason={!saveAvailable ? "Finish movement, dialogue, enemy actions, or the Fate spin before saving." : null}
              onCreate={createManualSave}
              onLoad={loadSave}
              onOverwrite={overwriteSave}
              onDelete={deleteSave}
              onQuickSave={quickSave}
            />}
            {panel === "help" && <Codex worldFlags={worldFlags} />}
          </section>
        </div>
      )}
    </main>
  );
}

function SaveLoad({ slots, allowSave, blockedReason, onCreate, onLoad, onOverwrite, onDelete, onQuickSave }: {
  slots: SaveSlot[];
  allowSave: boolean;
  blockedReason: string | null;
  onCreate: (name: string) => boolean;
  onLoad: (slot: SaveSlot) => void;
  onOverwrite: (slot: SaveSlot) => boolean;
  onDelete: (slot: SaveSlot) => void;
  onQuickSave: () => void;
}) {
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("Named saves survive autosave changes and launcher updates.");
  const manualCount = slots.filter((slot) => slot.kind === "manual").length;
  const ordered = [...slots].sort((left, right) => {
    const weight = { quick: 0, auto: 1, manual: 2 };
    return weight[left.kind] - weight[right.kind] || right.updatedAt.localeCompare(left.updatedAt);
  });
  const create = () => {
    if (!allowSave) return;
    if (onCreate(name)) {
      setName("");
      setNotice("Manual save written successfully.");
    } else {
      setNotice(manualCount >= MAX_MANUAL_SAVES ? "Archive full. Delete or overwrite a manual save." : "The game cannot be saved right now.");
    }
  };
  return <div className="save-view">
    <div className="modal-head"><small>COURIER ARCHIVE · SCHEMA V{SAVE_SCHEMA_VERSION}</small><h2>SAVE / LOAD</h2><p>Keep up to {MAX_MANUAL_SAVES} named field records. Autosave tracks world changes; quicksave is bound to F5.</p></div>
    <div className="save-toolbar">
      <div><label htmlFor="save-name">NEW FIELD RECORD</label><input id="save-name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }} maxLength={36} placeholder={`Field save ${manualCount + 1}`} disabled={!allowSave || manualCount >= MAX_MANUAL_SAVES} /></div>
      <button onClick={create} disabled={!allowSave || manualCount >= MAX_MANUAL_SAVES}>CREATE SAVE</button>
      <button onClick={() => { onQuickSave(); setNotice("Quicksave updated."); }} disabled={!allowSave}>QUICKSAVE · F5</button>
      <span>{manualCount}/{MAX_MANUAL_SAVES} MANUAL</span>
    </div>
    <div className={`save-notice${blockedReason ? " blocked" : ""}`}>{blockedReason || (!allowSave ? "Title archive is load-only. Enter Syracuse to create or overwrite saves." : notice)}</div>
    <div className="save-slot-list">
      {ordered.length ? ordered.map((slot) => <article className={`save-slot ${slot.kind}`} key={slot.id}>
        <div className="save-slot-mark"><b>{slot.kind === "quick" ? "Q" : slot.kind === "auto" ? "A" : "S"}</b><span>{slot.kind}</span></div>
        <div className="save-slot-info"><small>{slot.kind.toUpperCase()} RECORD · {new Date(slot.updatedAt).toLocaleString()}</small><strong>{slot.name}</strong><p>{slot.snapshot.location}</p><div><span>LEVEL {slot.snapshot.level}</span><span>HP {slot.snapshot.hp}/{slot.snapshot.maxHp}</span><span>{slot.snapshot.chips} CHIPS</span><span>PLAY {formatPlaytime(slot.snapshot.playtimeSeconds || 0)}</span></div></div>
        <div className="save-slot-actions"><button className="load" onClick={() => onLoad(slot)}>LOAD</button>{slot.kind !== "auto" && <button onClick={() => { if (onOverwrite(slot)) setNotice(`${slot.name} overwritten.`); }} disabled={!allowSave}>OVERWRITE</button>}{slot.kind !== "auto" && <button className="danger" onClick={() => onDelete(slot)}>DELETE</button>}</div>
      </article>) : <div className="save-empty"><strong>NO ARCHIVE RECORDS</strong><p>Enter Syracuse and create a manual save, or wait for the first autosave.</p></div>}
    </div>
    <footer className="save-footer"><span>F5 · QUICK SAVE</span><span>F9 · QUICK LOAD</span><span>AUTOSAVE · WORLD STATE CHANGES</span></footer>
  </div>;
}

function LegacyInventory({ chips }: { chips: number }) {
  const [selected, setSelected] = useState(inventoryItems[0]);
  return <div className="inventory-view">
    <div className="modal-head"><small>FIELD STORAGE</small><h2>PACK GRID</h2><p>Drag space is survival. Every object occupies real room.</p></div>
    <div className="weight"><span>LOAD</span><strong>16.4 / 28 KG</strong><i><b style={{ width: "58%" }} /></i></div>
    <div className="inventory-body">
      <div className="paperdoll">
        <span>WORN</span><div className="body-shape">♙</div>
        <button>HEAD<br /><b>EMPTY</b></button><button>ARMOR<br /><b>ROAD COAT</b></button><button>WEAPON<br /><b>PIPE PISTOL</b></button>
      </div>
      <div className="grid-wrap">
        <div className="stash-grid">
          {Array.from({ length: 60 }, (_, i) => <i key={i} />)}
          {inventoryItems.map((item) => <button
            key={item.id}
            className={selected.id === item.id ? "selected" : ""}
            onClick={() => setSelected(item)}
            style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }}
            title={item.name}
          ><b>{item.icon}</b><span>{item.name}</span></button>)}
        </div>
        <div className="item-readout"><div><small>INSPECTED ITEM</small><strong>{selected.name}</strong><p>{selected.note}</p></div><b>{selected.icon}</b></div>
      </div>
    </div>
    <div className="inventory-foot"><span>OLD-WORLD CHIPS</span><b>◉ {chips}</b><em>Local save active</em></div>
  </div>;
}

function Inventory({ chips, playEquip, items, setItems, activeHolster, setActiveHolster }: { chips: number; playEquip: () => void; items: InventoryItem[]; setItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>; activeHolster: HolsterSlot; setActiveHolster: (slot: HolsterSlot) => void }) {
  const [selectedId, setSelectedId] = useState(inventoryItems[0].id);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [message, setMessage] = useState("Drag items between the pack and equipment slots.");
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const packedItems = items.filter((item) => !item.equipped);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const slots: Array<{ id: EquipSlot; label: string; mark: string }> = [
    { id: "head", label: "HEAD", mark: "◉" }, { id: "torso", label: "TORSO", mark: "▣" },
    { id: "hands", label: "HANDS", mark: "✥" }, { id: "legs", label: "LEGS", mark: "⋔" },
    { id: "feet", label: "FEET", mark: "⌊" }, { id: "holster-left", label: "L HOLSTER", mark: "↙" },
    { id: "holster-right", label: "R HOLSTER", mark: "↘" },
  ];

  const beginDrag = (event: React.DragEvent, item: InventoryItem) => {
    setSelectedId(item.id); setDraggingId(item.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(item.id));
  };

  const canPlace = (item: InventoryItem, x: number, y: number) => {
    if (x < 0 || y < 0 || x + item.w > 10 || y + item.h > 6) return false;
    return packedItems.every((other) => other.id === item.id || x + item.w <= other.x || other.x + other.w <= x || y + item.h <= other.y || other.y + other.h <= y);
  };

  const dropInPack = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const item = items.find((entry) => entry.id === draggingId);
    if (!item) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(9, Math.floor((event.clientX - bounds.left) / (bounds.width / 10))));
    const y = Math.max(0, Math.min(5, Math.floor((event.clientY - bounds.top) / (bounds.height / 6))));
    if (!canPlace(item, x, y)) setMessage("That space is blocked or too small for this item.");
    else {
      if (item.equipped) playEquip();
      setItems((old) => old.map((entry) => entry.id === item.id ? { ...entry, x, y, equipped: null } : entry));
      if (item.equipped === activeHolster) {
        const alternate = activeHolster === "holster-right" ? "holster-left" : "holster-right";
        if (items.some((entry) => entry.id !== item.id && entry.equipped === alternate && entry.weaponType)) setActiveHolster(alternate);
      }
      setMessage(`${item.name} stowed at pack cell ${x + 1}, ${y + 1}.`);
    }
    setDraggingId(null); setDragOver(null);
  };

  const dropOnSlot = (event: React.DragEvent, slot: EquipSlot) => {
    event.preventDefault();
    const item = items.find((entry) => entry.id === draggingId);
    if (!item) return;
    const compatible = item.fits === slot || (item.fits === "holster" && slot.startsWith("holster"));
    const occupied = items.find((entry) => entry.equipped === slot && entry.id !== item.id);
    if (!compatible) setMessage(`${item.name} does not fit the ${slot.replace("-", " ")} slot.`);
    else if (occupied) setMessage(`${slot.replace("-", " ")} is already occupied by ${occupied.name}.`);
    else {
      playEquip();
      setItems((old) => old.map((entry) => entry.id === item.id ? { ...entry, equipped: slot } : entry));
      if (slot === "holster-left" || slot === "holster-right") setActiveHolster(slot);
      setMessage(`${item.name} equipped to ${slot.replace("-", " ")}.`);
    }
    setDraggingId(null); setDragOver(null);
  };

  return <div className="inventory-view interactive-inventory">
    <div className="modal-head"><small>FIELD STORAGE · CLICK & DRAG</small><h2>PACK & LOADOUT</h2><p>Every item occupies physical space. Drag gear onto the Courier or rearrange the pack.</p></div>
    <div className="weight"><span>LOAD</span><strong>{totalWeight.toFixed(1)} / 28 KG</strong><i><b style={{ width: `${Math.min(100, totalWeight / 28 * 100)}%` }} /></i></div>
    <div className="inventory-body">
      <div className="paperdoll full-loadout">
        <span>EQUIPMENT LOADOUT</span>
        <div className="body-silhouette" aria-label="Courier equipment silhouette"><i className="sil-head"/><i className="sil-torso"/><i className="sil-arm left"/><i className="sil-arm right"/><i className="sil-leg left"/><i className="sil-leg right"/></div>
        {slots.map((slot) => {
          const equipped = items.find((item) => item.equipped === slot.id);
          const isActive = (slot.id === "holster-left" || slot.id === "holster-right") && activeHolster === slot.id;
          return <div key={slot.id} className={`equip-slot slot-${slot.id} ${dragOver === slot.id ? "drag-over" : ""} ${equipped ? "occupied" : ""}${isActive ? " active-holster" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragOver(slot.id); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => dropOnSlot(event, slot.id)}>
            <small>{slot.mark} {slot.label}{isActive ? " · ACTIVE" : ""}</small>
            {equipped ? <button draggable onDragStart={(event) => beginDrag(event, equipped)} onDragEnd={() => { setDraggingId(null); setDragOver(null); }} onClick={() => { setSelectedId(equipped.id); if (slot.id === "holster-left" || slot.id === "holster-right") { setActiveHolster(slot.id); setMessage(`${equipped.name} is now the active weapon.`); } }}><b>{equipped.icon}</b><span>{equipped.name}</span></button> : <em>EMPTY</em>}
          </div>;
        })}
      </div>
      <div className="grid-wrap">
        <div className={`stash-grid ${dragOver === "pack" ? "drag-over" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragOver("pack"); }} onDragLeave={() => setDragOver(null)} onDrop={dropInPack}>
          {Array.from({ length: 60 }, (_, i) => <i key={i} />)}
          {packedItems.map((item) => <button key={item.id} draggable className={`${selected.id === item.id ? "selected" : ""} ${draggingId === item.id ? "dragging" : ""}`} onDragStart={(event) => beginDrag(event, item)} onDragEnd={() => { setDraggingId(null); setDragOver(null); }} onClick={() => setSelectedId(item.id)} style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}` }} title={item.name}><b>{item.icon}</b><span>{item.name}</span></button>)}
        </div>
        <div className="item-readout"><div><small>INSPECTED ITEM · {selected.equipped ? `EQUIPPED: ${selected.equipped.toUpperCase()}` : `${selected.w}×${selected.h} PACK CELLS`}</small><strong>{selected.name}</strong><p>{selected.note} · {selected.weight.toFixed(1)} KG</p><em>{message}</em></div><b>{selected.icon}</b></div>
      </div>
    </div>
    <div className="inventory-foot"><span>OLD-WORLD CHIPS</span><b>◉ {chips}</b><em>Click a holstered weapon to make that side active · drag to stow</em></div>
  </div>;
}

function Skills({ level, skills, points, upgrade }: { level: number; skills: typeof initialSkills; points: number; upgrade: (name: keyof typeof initialSkills) => void }) {
  const descriptions: Record<keyof typeof initialSkills, string> = {
    Guns: "Firearms accuracy and critical damage.", Barter: "Prices, wagers, and trade routes.", Speech: "Persuasion, deceit, and first impressions.", Survival: "Road events, scavenging, and evasion.", Medicine: "Healing and anatomy checks.", Mechanics: "Repair, crafting, and machine lore.",
  };
  return <div className="skills-view">
    <div className="modal-head"><small>CHARACTER DEVELOPMENT</small><h2>SKILLS & TRAITS</h2><p>Level {level} drifter · {points} upgrade points available</p></div>
    <div className="special-row"><div><small>STRENGTH</small><b>5</b></div><div><small>PERCEPTION</small><b>6</b></div><div><small>ENDURANCE</small><b>4</b></div><div className="highlight"><small>LUCK</small><b>6</b></div></div>
    <div className="skill-list">{(Object.keys(skills) as (keyof typeof skills)[]).map((name) => <div key={name}>
      <span className="skill-icon">{name.slice(0, 1)}</span><section><strong>{name}</strong><p>{descriptions[name]}</p><i><b style={{ width: `${skills[name] * 10}%` }} /></i></section><em>{skills[name]}</em><button onClick={() => upgrade(name)} disabled={!points}>+</button>
    </div>)}</div>
    <div className="traits"><div><small>TRAIT</small><strong>LOADED DICE</strong><p>Bad rolls slightly improve the next spin.</p></div><div><small>FLAW</small><strong>HOUSE DEBT</strong><p>Vendors know your face. Prices start 5% higher.</p></div></div>
  </div>;
}

function WorldMap({ level, location, travel }: { level: number; location: string; travel: (place: (typeof cities)[number]) => void }) {
  void level;
  const [hovered, setHovered] = useState(cities.find((c) => location.includes(c.name)) || cities[5]);
  return <div className="map-view">
    <div className="modal-head"><small>ROAD NETWORK 2186</small><h2>THE UPSTATE WASTES</h2><p>A compressed expedition map · routes redraw as the world changes.</p></div>
    <div className="map-paper">
      <div className="lake lake-erie">LAKE ERIE</div><div className="lake lake-ontario">LAKE ONTARIO</div>
      <div className="route r1" /><div className="route r2" /><div className="route r3" /><div className="route r4" /><div className="route r5" />
      {cities.map((place) => <button key={place.name} className={`map-pin ${place.kind} ${location.includes(place.name) ? "here" : ""} ${place.name !== playableCity ? "disabled" : ""}`} style={{ left: `${place.x}%`, top: `${place.y}%` }} onMouseEnter={() => setHovered(place)} onFocus={() => setHovered(place)} onClick={() => travel(place)} aria-disabled={place.name !== playableCity}><i />{place.name}<small>{place.name !== playableCity ? "LOCKED · NOT BUILT" : "PLAYABLE DISTRICT"}</small></button>)}
      <div className="map-gridlines" />
    </div>
    <div className="map-readout"><span>SELECTED DESTINATION</span><strong>{hovered.name}</strong><p>{hovered.detail}</p><em>{hovered.name === playableCity ? "PLAYABLE NOW · Open downtown Syracuse" : "ROUTE DISABLED · This location unlocks after its game level is built"}</em></div>
  </div>;
}

function Journal({ quests, companions, dismiss }: { quests: QuestState[]; companions: CompanionState[]; dismiss: (id: CompanionState["id"]) => void }) {
  const orderedQuests = [...quests].sort((left, right) => {
    const weight = { active: 0, completed: 1, failed: 2 };
    return weight[left.status] - weight[right.status] || (right.updatedAt || 0) - (left.updatedAt || 0);
  });
  const activeCount = quests.filter((quest) => quest.status === "active").length;
  return <div className="journal-view">
    <div className="modal-head"><small>COURIER FIELD LEDGER</small><h2>QUESTS & COMPANIONS</h2><p>{activeCount} active lead{activeCount === 1 ? "" : "s"} · Dialogue can alter every record below.</p></div>
    <div className="journal-summary"><div><span>ACTIVE</span><b>{activeCount}</b></div><div><span>RESOLVED</span><b>{quests.filter((quest) => quest.status === "completed").length}</b></div><div><span>FAILED</span><b>{quests.filter((quest) => quest.status === "failed").length}</b></div><div><span>PARTY</span><b>{companions.filter((companion) => companion.status === "active").length}/2</b></div></div>
    <div className="journal-columns">
      <section className="quest-ledger"><header><span>QUEST LEDGER</span><small>AI-DIRECTED · PERSISTENT</small></header><div className="journal-scroll">
        {orderedQuests.length ? orderedQuests.map((quest) => {
          const completeObjectives = quest.objectives.filter((objective) => objective.complete).length;
          return <article className={`quest-card ${quest.status}`} key={quest.id}>
            <div className="quest-title"><span>{quest.status}</span><strong>{quest.title}</strong><em>{completeObjectives}/{quest.objectives.length}</em></div>
            <p>{quest.description}</p><small>GIVER · {quest.giver} · REWARD {quest.rewardXp} XP</small>
            <ul>{quest.objectives.map((objective) => <li className={objective.complete ? "done" : ""} key={objective.id}><i>{objective.complete ? "✓" : "◇"}</i>{objective.text}</li>)}</ul>
            {quest.history.at(-1) && <blockquote>{quest.history.at(-1)}</blockquote>}
          </article>;
        }) : <p className="journal-empty">No leads yet. Talk to people and make promises.</p>}
      </div></section>
      <section className="companion-ledger"><header><span>COMPANION ROSTER</span><small>2 FIELD SLOTS</small></header><div className="journal-scroll">
        {companions.map((companion) => <article className={`companion-card ${companion.status}`} key={companion.id}>
          <div className="companion-card-head"><div className="companion-mini-portrait"><Sprite row={2} col={0} label={`${companion.name} portrait`} /></div><div><span>{companion.status}</span><strong>{companion.name}</strong><small>{companion.role}</small></div></div>
          <div className="companion-meter"><span>HP {companion.hp}/{companion.maxHp}</span><i><b style={{ width: `${(companion.hp / companion.maxHp) * 100}%` }} /></i></div>
          <div className="companion-meter loyalty"><span>LOYALTY {companion.loyalty}</span><i><b style={{ width: `${companion.loyalty}%` }} /></i></div>
          <div className="companion-meter morale"><span>MORALE {companion.morale}</span><i><b style={{ width: `${companion.morale}%` }} /></i></div>
          <p>“{companion.opinion}”</p>
          <ul>{companion.abilities.map((ability) => <li key={ability}>{ability}</li>)}</ul>
          {companion.status === "active" && <button onClick={() => dismiss(companion.id)}>ASK TO WAIT HERE</button>}
          {companion.status === "available" || companion.status === "dismissed" ? <em>Recruit through conversation. Rowan decides for herself.</em> : null}
        </article>)}
      </div></section>
    </div>
  </div>;
}

function Dialogue({ npc, conversation, input, setInput, speak, busy, reels, voiceEnabled, liveConversation, speakingCharacter, toggleVoice, toggleLiveConversation, engine, activeQuestCount, companionStatus, combatActive }: { npc: NpcState; conversation: { speaker: string; text: string }[]; input: string; setInput: (v: string) => void; speak: (spokenMessage?: string) => void; busy: boolean; reels: string[]; voiceEnabled: boolean; liveConversation: boolean; speakingCharacter: "YOU" | "ROWAN" | null; toggleVoice: () => void; toggleLiveConversation: () => void; engine: "ai" | "local" | null; activeQuestCount: number; companionStatus: CompanionState["status"]; combatActive: boolean }) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionController | null>(null);
  const speakRef = useRef(speak);
  const submittedSpeech = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const [micCycle, setMicCycle] = useState(0);
  const [forceRecorder, setForceRecorder] = useState(false);
  const [micState, setMicState] = useState<"off" | "ready" | "permission" | "listening" | "hearing" | "transcribing" | "processing" | "denied" | "unsupported" | "error">("off");
  useEffect(() => { speakRef.current = speak; }, [speak]);
  useEffect(() => {
    const box = transcriptRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [conversation, busy]);
  useEffect(() => {
    let disposed = false;
    let mediaStream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let audioContext: AudioContext | null = null;
    let animationFrame = 0;
    let maximumTimer = 0;
    const queueRestart = (delay = 450) => {
      if (disposed) return;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = window.setTimeout(() => setMicCycle((cycle) => cycle + 1), delay);
    };
    const cleanMedia = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (maximumTimer) window.clearTimeout(maximumTimer);
      mediaStream?.getTracks().forEach((track) => track.stop());
      mediaStream = null;
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
      audioContext = null;
    };
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    submittedSpeech.current = false;
    if (!liveConversation) { setMicState("off"); return; }
    if (busy || speakingCharacter || combatActive) { setMicState(busy ? "processing" : "ready"); return; }
    const speechWindow = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionController;
      webkitSpeechRecognition?: new () => SpeechRecognitionController;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    const finishTranscript = (clean: string) => {
      if (!clean || submittedSpeech.current || disposed) return;
      submittedSpeech.current = true;
      setInput(clean);
      setMicState("processing");
      window.setTimeout(() => speakRef.current(clean), 80);
    };
    const startRecorder = async () => {
      if (!canRecord) { setMicState("unsupported"); return; }
      setMicState("permission");
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (error) {
        if (!disposed) setMicState(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "error");
        return;
      }
      if (disposed || !mediaStream) { cleanMedia(); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const chunks: Blob[] = [];
      let heardSpeech = false;
      let lastVoiceAt = performance.now();
      const startedAt = lastVoiceAt;
      recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { if (!disposed) setMicState("error"); cleanMedia(); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || "audio/webm" });
        cleanMedia();
        if (disposed) return;
        if (!heardSpeech || blob.size < 800) { setMicState("ready"); queueRestart(); return; }
        setMicState("transcribing");
        try {
          const form = new FormData();
          form.append("audio", blob, blob.type.includes("ogg") ? "dialogue.ogg" : "dialogue.webm");
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const result = await response.json() as { text?: string; error?: string };
          if (!response.ok || !result.text?.trim()) throw new Error(result.error || "No speech detected");
          finishTranscript(result.text.trim().slice(0, 500));
        } catch (error) {
          console.error("Live transcription failed", error);
          if (!disposed) { setMicState("error"); queueRestart(1400); }
        }
      };
      recorder.start(250);
      setMicState("listening");

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(mediaStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = .4;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const monitor = () => {
        if (disposed || !recorder || recorder.state !== "recording") return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) { const centered = (sample - 128) / 128; energy += centered * centered; }
        const volume = Math.sqrt(energy / samples.length);
        const now = performance.now();
        if (volume > .022) {
          heardSpeech = true;
          lastVoiceAt = now;
          setMicState((state) => state === "hearing" ? state : "hearing");
        } else if (heardSpeech) {
          setMicState((state) => state === "listening" ? state : "listening");
        }
        if (heardSpeech && now - lastVoiceAt > 950 && now - startedAt > 1100) recorder.stop();
        else animationFrame = requestAnimationFrame(monitor);
      }
      animationFrame = requestAnimationFrame(monitor);
      maximumTimer = window.setTimeout(() => { if (recorder?.state === "recording") recorder.stop(); }, 15000);
    };
    const startBrowserRecognition = () => {
      if (!Recognition) { void startRecorder(); return; }
      const recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onstart = () => setMicState("listening");
      recognition.onresult = (event) => {
        let transcript = "";
        let final = false;
        for (let index = event.resultIndex; index < event.results.length; index++) {
          transcript += event.results[index][0]?.transcript || "";
          final = final || event.results[index].isFinal;
        }
        const clean = transcript.trim();
        if (clean) setInput(clean);
        if (final && clean) { recognition.stop(); finishTranscript(clean); }
      };
      recognition.onerror = (event) => {
        recognitionRef.current = null;
        if (event.error === "not-allowed") setMicState("denied");
        else if (canRecord) setForceRecorder(true);
        else { setMicState("error"); queueRestart(1200); }
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        if (!submittedSpeech.current && !disposed) { setMicState("ready"); queueRestart(); }
      };
      recognitionRef.current = recognition;
      try { recognition.start(); } catch { if (canRecord) setForceRecorder(true); else setMicState("error"); }
    };
    const nativeGame = /Electron\//i.test(navigator.userAgent);
    if (forceRecorder || nativeGame || !Recognition) void startRecorder();
    else startBrowserRecognition();
    return () => {
      disposed = true;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
      const recognition = recognitionRef.current;
      if (recognition) { recognition.onend = null; recognition.stop(); recognitionRef.current = null; }
      if (recorder?.state === "recording") recorder.stop();
      cleanMedia();
    };
  }, [liveConversation, busy, speakingCharacter, combatActive, setInput, forceRecorder, micCycle]);
  return <div className="dialogue-view">
    <aside className="npc-dossier">
      <div className="npc-portrait"><Sprite row={2} col={0} label="Head-and-shoulders portrait of Rowan Vale" /></div>
      <small>LONE WANDERER</small><h2>ROWAN VALE</h2><p className="mood">MOOD · {npc.mood}</p>
      <div className="relation"><span>TRUST <b>{npc.trust}</b></span><i><em style={{ width: `${npc.trust}%` }} /></i></div>
      <div className="relation"><span>RESPECT <b>{npc.respect}</b></span><i><em style={{ width: `${npc.respect}%` }} /></i></div>
      <div className="relation fear"><span>FEAR <b>{npc.fear}</b></span><i><em style={{ width: `${npc.fear}%` }} /></i></div>
      <div className="opinion"><small>CURRENT OPINION</small><p>“{npc.opinion}”</p></div>
      <div className="knowledge"><small>KNOWN / REMEMBERED</small>{npc.memories.slice(-3).map((m, i) => <p key={i}>• {m}</p>)}</div>
      <div className="likes"><span><b>LIKES</b> candor, maps, coffee</span><span><b>DISLIKES</b> Citadel clerks, threats</span></div>
    </aside>
    <section className="conversation">
      <div className={`conversation-head${combatActive ? " hostile" : ""}`}><div><small>{combatActive ? "HOSTILITIES · ROWAN HAS INITIATIVE" : `LIVE CHARACTER SIMULATION · ${engine === "local" ? "LOCAL FALLBACK" : engine === "ai" ? "AI DIRECTOR" : "READY"}`}</small><strong>{combatActive ? "Rowan drew first. Combat is beginning…" : "Say anything. Rowan remembers—and acts."}</strong><em>{speakingCharacter ? `VOICE · ${speakingCharacter} SPEAKING` : voiceEnabled ? "VOICE · READY" : "VOICE · MUTED"} · {activeQuestCount} ACTIVE QUEST{activeQuestCount === 1 ? "" : "S"} · PARTY {companionStatus.toUpperCase()}</em></div><button className={`live-toggle ${liveConversation ? "on" : ""}`} onClick={toggleLiveConversation} aria-pressed={liveConversation} aria-label={liveConversation ? "Disable live microphone conversation" : "Enable live microphone conversation"}><b>{micState === "listening" ? "●" : "◉"}</b><small>{liveConversation ? micState.toUpperCase() : "LIVE MIC"}</small></button><button className={`voice-toggle ${voiceEnabled ? "on" : ""}`} onClick={toggleVoice} aria-pressed={voiceEnabled} aria-label={voiceEnabled ? "Mute character voices" : "Enable character voices"}>{voiceEnabled ? "◖))" : "◖×"}<small>{voiceEnabled ? "VOICES ON" : "VOICES OFF"}</small></button><div className="mini-slot">{reels.map((r, i) => <b key={i}>{r}</b>)}</div></div>
      <div className="transcript" ref={transcriptRef} tabIndex={0} aria-label="Scrollable conversation transcript">{conversation.map((line, i) => <div key={i} className={line.speaker === "YOU" ? "player-line" : line.speaker === "WORLD" ? "world-line" : "npc-line"}><span>{line.speaker}<i>{line.speaker === "YOU" ? "CEDAR · ADULT BARITONE" : line.speaker === "WORLD" ? "STATE" : "MARIN · ADULT CONTRALTO"}</i></span><p>{line.text}</p></div>)}{busy && <div className="npc-line thinking"><span>ROWAN</span><p>Reading your words against memory, motive, and the state of the world…</p></div>}</div>
      <div className={`dialogue-compose${combatActive ? " hostile" : ""}`}><div className="check-hints"><span>[SPEECH {3}] Persuade</span><span>[BARTER {2}] Deal</span><span>[LUCK 6] Tempt fate</span>{liveConversation && <span className={`mic-state ${micState}`}>MIC · {micState.toUpperCase()}</span>}</div><textarea value={input} disabled={busy || combatActive} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); speak(); } }} placeholder={combatActive ? "Rowan has ended the conversation." : liveConversation ? "Speak naturally. A complete phrase is sent automatically…" : "Type anything to Rowan… ask, lie, threaten, joke, bargain, or request an action."} maxLength={500} /><button onClick={() => speak()} disabled={busy || combatActive || !input.trim()}>{combatActive ? "ENEMY TURN" : busy ? "CALCULATING…" : liveConversation && micState === "listening" ? "LISTENING…" : "SAY IT"}</button><small>{combatActive ? "Dialogue choices are locked while Rowan takes her opening combat action." : liveConversation ? "The default microphone pauses while voices play, then listens for your next turn automatically." : "Each turn checks relationships, memories, skills, Fate, inventory, combat, location, quests, and possible world actions."}</small></div>
    </section>
  </div>;
}

function Codex({ worldFlags }: { worldFlags: string[] }) {
  return <div className="codex-view">
    <div className="modal-head"><small>ARCHIVE TERMINAL</small><h2>WASTELAND CODEX</h2><p>The old government did not fall in one day. It simply stopped answering.</p></div>
    <div className="codex-columns"><section><h3>THE FEDERAL SILENCE · 2086</h3><p>A cascading debt crisis, state mutinies, infrastructure failures, and a disputed transfer of power ended the federal chain of command. No singular apocalypse came. Payrolls ceased. Grids went dark. Counties fortified. A century later, every surviving institution claims to be the legitimate continuation.</p><h3>THE MARBLE CROWN</h3><p>Albany Citadel occupies the Capitol complex and Empire State Plaza. Its archivists trade security for records, identity papers, and loyalty.</p></section><section><h3>DYNAMIC WORLD STATE</h3>{worldFlags.map((flag, i) => <p className="flag" key={i}>◈ {flag}</p>)}<h3>CONTROLS</h3><p>Click characters and threats to interact. Use the left rail for map, inventory, and skills. Combat actions consume AP. Every meaningful check spins the Fate Engine.</p></section><section className="atlas"><h3>ANIMATION SPRITE GRAPH</h3><img src="/life-is-a-gamble-sprite-atlas.png" alt="Generated animation sprite atlas with courier, squirrel, and Rowan frames" /><p>Courier · Rabid Squirrel · Rowan Vale</p></section></div>
  </div>;
}
