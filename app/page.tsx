"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Panel = "inventory" | "skills" | "map" | "dialogue" | "help" | null;
type CombatState = "idle" | "player" | "enemy" | "won";
type LogEntry = { id: number; tone: "system" | "good" | "bad" | "plain"; text: string };
type InteractionTarget = {
  id: string;
  label: string;
  kind: "door" | "prop";
  locked?: boolean;
  lockpick?: boolean;
  inaccessible?: boolean;
  interior?: string;
  action?: "search" | "inspect";
};
type NpcState = {
  trust: number;
  respect: number;
  fear: number;
  mood: string;
  opinion: string;
  memories: string[];
};

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
const reelSymbols = ["♠", "7", "☢", "♦", "★", "BAR"];

type EquipSlot = "head" | "torso" | "legs" | "hands" | "feet" | "holster-left" | "holster-right";
type InventoryItem = { id: number; name: string; icon: string; x: number; y: number; w: number; h: number; note: string; weight: number; fits?: Exclude<EquipSlot, "holster-left" | "holster-right"> | "holster"; equipped: EquipSlot | null };

const inventoryItems: InventoryItem[] = [
  { id: 1, name: "Pipe Pistol", icon: "⌐", x: 0, y: 0, w: 2, h: 1, note: "5–9 DMG · .22 scrapshot", weight: 2.1, fits: "holster", equipped: "holster-right" },
  { id: 2, name: "Road Coat", icon: "♜", x: 3, y: 0, w: 2, h: 3, note: "+1 Armor · many pockets", weight: 4.2, fits: "torso", equipped: "torso" },
  { id: 3, name: "Dried Apples", icon: "●", x: 2, y: 0, w: 1, h: 1, note: "+8 HP · tastes like paper", weight: .4, equipped: null },
  { id: 4, name: "Bent Lockpick", icon: "⌁", x: 0, y: 0, w: 1, h: 2, note: "+5% Lockpick · fragile", weight: .1, equipped: null },
  { id: 5, name: "Old Chips", icon: "◉", x: 3, y: 0, w: 2, h: 2, note: "Currency · 37 chips", weight: 1.2, equipped: null },
  { id: 6, name: "Squirrel Tail", icon: "〰", x: 5, y: 0, w: 1, h: 2, note: "Quest item · still warm", weight: .3, equipped: null },
  { id: 7, name: "Welding Hood", icon: "◒", x: 6, y: 0, w: 2, h: 2, note: "+1 Perception defense · smoked lens", weight: 1.8, fits: "head", equipped: null },
  { id: 8, name: "Work Gloves", icon: "✥", x: 8, y: 0, w: 2, h: 1, note: "+1 Mechanics · cracked leather", weight: .6, fits: "hands", equipped: null },
  { id: 9, name: "Road Boots", icon: "⌊", x: 8, y: 2, w: 2, h: 2, note: "+1 Survival · resoled twice", weight: 2.4, fits: "feet", equipped: null },
  { id: 10, name: "Canvas Trousers", icon: "⋔", x: 6, y: 3, w: 2, h: 2, note: "+2 carry weight · reinforced knees", weight: 1.5, fits: "legs", equipped: null },
  { id: 11, name: "Scrap Knife", icon: "†", x: 0, y: 3, w: 1, h: 2, note: "3–6 DMG · quiet and close", weight: .8, fits: "holster", equipped: null },
];

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

function EnvSprite({ row, col, label, className = "", style }: { row: number; col: number; label: string; className?: string; style?: CSSProperties }) {
  return <div className={`env-sprite ${className}`} role="img" aria-label={label} style={{ ...style, backgroundPosition: `${col * 33.333}% ${row * 33.333}%` }} />;
}

function DecorSprite({ row, col, label, className = "" }: { row: number; col: number; label: string; className?: string }) {
  return <div className={`decor-sprite ${className}`} role="img" aria-label={label} style={{ backgroundPosition: `${col * 33.333}% ${row * 50}%` }} />;
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
  onInteract: (event: React.MouseEvent, target: InteractionTarget) => void;
};

function ModularBuilding({ className, name, subtitle, material, floors, bays, door, doorBay = 1, storefront = false, damaged = false, onInteract }: ModularBuildingProps) {
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
    return isDoor && door ? <button key={index} className="building-door-cell" onClick={(event) => onInteract(event, door)} onContextMenu={(event) => onInteract(event, door)} aria-label={`Interact with ${door.label}`}>{tile}</button> : <div key={index} className="building-cell">{tile}</div>;
  });
  return <section className={`modular-building ${className} ${material}`} style={{ "--bays": bays, "--floors": floors } as CSSProperties} onClick={(event) => event.stopPropagation()}>
    <div className="building-roof"><BuildingTile row={2} col={2} /></div>
    <div className="building-side">{Array.from({ length: floors }, (_, floor) => <BuildingTile key={floor} row={material === "stone" ? 1 : 0} col={0} />)}</div>
    <div className="building-face">{cells}</div>
    <div className="building-cornice"><BuildingTile row={material === "stone" ? 1 : 0} col={3} /></div>
    <div className="building-sign"><strong>{name}</strong><small>{subtitle}</small></div>
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

const cityDecor = [
  { row: 0, col: 0, label: "Rusted fire hydrant", className: "decor-hydrant-a" },
  { row: 0, col: 0, label: "Rusted fire hydrant", className: "decor-hydrant-b" },
  { row: 0, col: 1, label: "Abandoned payphone", className: "decor-payphone" },
  { row: 0, col: 2, label: "Dented postal mailbox", className: "decor-mailbox-a" },
  { row: 0, col: 2, label: "Dented postal mailbox", className: "decor-mailbox-b" },
  { row: 0, col: 3, label: "Overflowing trash cans", className: "decor-trash-a" },
  { row: 0, col: 3, label: "Overflowing trash cans", className: "decor-trash-b" },
  { row: 1, col: 0, label: "Abandoned newspaper box", className: "decor-news-a" },
  { row: 1, col: 0, label: "Abandoned newspaper box", className: "decor-news-b" },
  { row: 1, col: 1, label: "Rusted oil drums", className: "decor-barrels-a" },
  { row: 1, col: 1, label: "Rusted oil drums", className: "decor-barrels-b" },
  { row: 1, col: 2, label: "Broken park bench", className: "decor-bench-a" },
  { row: 1, col: 2, label: "Broken park bench", className: "decor-bench-b" },
  { row: 1, col: 3, label: "Overturned shopping cart", className: "decor-cart" },
  { row: 2, col: 0, label: "Damaged traffic signal", className: "decor-signal" },
  { row: 2, col: 1, label: "Stacked sandbags", className: "decor-sandbags" },
  { row: 2, col: 2, label: "Leaning utility pole", className: "decor-pole" },
  { row: 2, col: 3, label: "Broken municipal sign", className: "decor-sign" },
];

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

export default function Home() {
  const [panel, setPanel] = useState<Panel>(null);
  const [location, setLocation] = useState("Downtown Syracuse — Clinton Square");
  const [hp, setHp] = useState(32);
  const [maxHp, setMaxHp] = useState(32);
  const [ap, setAp] = useState(7);
  const [enemyHp, setEnemyHp] = useState(18);
  const [combat, setCombat] = useState<CombatState>("idle");
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(35);
  const [chips, setChips] = useState(37);
  const [skillPoints, setSkillPoints] = useState(2);
  const [skills, setSkills] = useState(initialSkills);
  const [luck] = useState(6);
  const [selectedAction, setSelectedAction] = useState("Pistol");
  const [isSpinning, setIsSpinning] = useState(false);
  const [reels, setReels] = useState(["♠", "7", "★"]);
  const [slotLabel, setSlotLabel] = useState("FATE AWAITS");
  const [playerPosition, setPlayerPosition] = useState({ x: 51, y: 71 });
  const [destination, setDestination] = useState({ x: 51, y: 71 });
  const [walking, setWalking] = useState(false);
  const [walkFrame, setWalkFrame] = useState(0);
  const [movementMode, setMovementMode] = useState<"walk" | "run">("walk");
  const [walkFacing, setWalkFacing] = useState<"left" | "right">("right");
  const [walkDuration, setWalkDuration] = useState(500);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: InteractionTarget } | null>(null);
  const [unlockedDoors, setUnlockedDoors] = useState<string[]>([]);
  const [interior, setInterior] = useState<string | null>(null);
  const [dialogueInput, setDialogueInput] = useState("");
  const [dialogueBusy, setDialogueBusy] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speakingCharacter, setSpeakingCharacter] = useState<"YOU" | "ROWAN" | null>(null);
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
  const voiceQueue = useRef<Promise<void>>(Promise.resolve());
  const activeAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("life-is-a-gamble-save");
      if (!raw) return;
      const save = JSON.parse(raw);
      if (save.level) setLevel(save.level);
      if (typeof save.xp === "number") setXp(save.xp);
      if (typeof save.chips === "number") setChips(save.chips);
      if (save.skills) setSkills(save.skills);
      if (save.npc) setNpc(save.npc);
      if (save.worldFlags) setWorldFlags(save.worldFlags);
      if (save.location && String(save.location).includes("Syracuse")) setLocation(save.location);
    } catch {
      // A damaged local save should never keep the player from starting.
    }
  }, []);

  useEffect(() => {
    const save = { level, xp, chips, skills, npc, worldFlags, location };
    localStorage.setItem("life-is-a-gamble-save", JSON.stringify(save));
  }, [level, xp, chips, skills, npc, worldFlags, location]);

  useEffect(() => {
    if (!walking) return;
    const timer = setInterval(() => setWalkFrame((frame) => (frame + 1) % 4), movementMode === "run" ? 90 : 135);
    return () => clearInterval(timer);
  }, [walking, movementMode]);

  const xpGoal = level * 100;
  const combatFrame = combat === "player" ? 3 : combat === "enemy" ? 4 : null;
  const squirrelFrame = enemyHp <= 0 ? 4 : combat === "enemy" ? 3 : isSpinning ? 1 : 0;

  const addLog = (text: string, tone: LogEntry["tone"] = "plain") => {
    setLog((old) => [...old.slice(-5), { id: logId.current++, tone, text }]);
  };

  const walkTo = (event: React.MouseEvent<HTMLElement>) => {
    if (interior || combat === "enemy" || isSpinning) return;
    const bounds = sceneRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.max(8, Math.min(92, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(30, Math.min(86, ((event.clientY - bounds.top) / bounds.height) * 100));
    const blocked = [
      { x1: 0, x2: 40, y1: 12, y2: 45 }, { x1: 66, x2: 100, y1: 12, y2: 45 },
      { x1: 0, x2: 40, y1: 84, y2: 100 }, { x1: 66, x2: 100, y1: 84, y2: 100 },
    ];
    if (blocked.some((area) => x >= area.x1 && x <= area.x2 && y >= area.y1 && y <= area.y2)) {
      addLog("That route is blocked by a building footprint.", "bad");
      setContextMenu(null);
      return;
    }
    const distance = Math.hypot((x - playerPosition.x) * bounds.width / 100, (y - playerPosition.y) * bounds.height / 100);
    const nextMovementMode = distance > 260 ? "run" : "walk";
    const duration = nextMovementMode === "run"
      ? Math.max(220, Math.min(1150, distance * 2.05))
      : Math.max(240, Math.min(1700, distance * 3.5));
    setContextMenu(null);
    setWalkFacing(x < playerPosition.x ? "left" : "right");
    setDestination({ x, y });
    setWalkDuration(duration);
    setMovementMode(nextMovementMode);
    setWalkFrame(0);
    setWalking(true);
    setPlayerPosition({ x, y });
    if (walkTimer.current) clearTimeout(walkTimer.current);
    walkTimer.current = setTimeout(() => setWalking(false), duration);
  };

  const openInteraction = (event: React.MouseEvent, target: InteractionTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 235), y: Math.min(event.clientY, window.innerHeight - 175), target });
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
      setInterior(target.interior);
      setLocation(`${target.interior}, Downtown Syracuse`);
      addLog(`Entered ${target.interior}.`, "system");
    }
  };

  const lockpickTarget = async (target: InteractionTarget) => {
    setContextMenu(null);
    if (!target.lockpick || target.inaccessible) return;
    const result = await spinFate(`Lockpick · ${target.label}`);
    const targetScore = 28 + skills.Mechanics * 9 + luck * 4;
    if (result.score <= targetScore || result.jackpot) {
      setUnlockedDoors((doors) => [...new Set([...doors, target.id])]);
      awardXp(12);
      addLog(`LOCK OPENED · ${target.label}. +12 XP.`, "good");
    } else addLog(`The lock holds. Your bent pick is one mistake from snapping.`, "bad");
  };

  const useProp = (target: InteractionTarget) => {
    setContextMenu(null);
    if (target.action === "search") {
      if (worldFlags.includes("Downtown sedan searched")) addLog("The sedan has already been picked clean.");
      else {
        setWorldFlags((flags) => [...flags, "Downtown sedan searched"]);
        setChips((value) => value + 4);
        addLog("You search the sedan: 4 chips and a damp parking receipt.", "good");
      }
    } else addLog("The lamp bears a municipal seal dated 2039. Its copper wiring is gone.");
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

  const spinFate = async (reason: string): Promise<{ score: number; jackpot: boolean; symbols: string[] }> => {
    if (isSpinning) return { score: 0, jackpot: false, symbols: reels };
    setIsSpinning(true);
    setSlotLabel(reason.toUpperCase());
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
    if (jackpot) {
      setChips((v) => v + 25);
      addLog("JACKPOT · Fate pays 25 old-world chips.", "good");
    }
    return { score: roll + (lucky ? 18 : 0), jackpot, symbols: finalSymbols };
  };

  const startCombat = () => {
    if (enemyHp <= 0) return;
    setCombat("player");
    setAp(7);
    addLog("TURN 1 · The squirrel bares wet, yellow teeth.", "bad");
  };

  const enemyTurn = async () => {
    setCombat("enemy");
    await new Promise((resolve) => setTimeout(resolve, 650));
    const dodgeChance = skills.Survival * 4 + luck * 2;
    const roll = Math.floor(Math.random() * 100);
    if (roll < dodgeChance) {
      addLog("You read the lunge and step aside.", "good");
    } else {
      const damage = 3 + Math.floor(Math.random() * 5);
      setHp((v) => Math.max(1, v - damage));
      addLog(`Rabid Squirrel bites for ${damage} damage.`, "bad");
    }
    setAp(7);
    setCombat("player");
  };

  const attack = async (aimed = false) => {
    if (combat !== "player" || isSpinning) return;
    const cost = aimed ? 5 : 3;
    if (ap < cost) {
      addLog("Not enough Action Points.", "bad");
      return;
    }
    setAp((v) => v - cost);
    const result = await spinFate(aimed ? "Aimed shot" : "Attack check");
    const hitTarget = 38 + skills.Guns * 7 + luck * 2 + (aimed ? 16 : 0);
    if (result.score <= hitTarget || result.jackpot) {
      const damage = 5 + skills.Guns + (aimed ? 3 : 0) + (result.jackpot ? 8 : 0);
      const remaining = Math.max(0, enemyHp - damage);
      setEnemyHp(remaining);
      addLog(`${aimed ? "AIMED" : "SNAP"} SHOT · ${damage} damage.`, "good");
      if (remaining === 0) {
        setCombat("won");
        setChips((v) => v + 6);
        awardXp(65);
        if (!worldFlags.includes("Salt Yard squirrel killed")) setWorldFlags((v) => [...v, "Salt Yard squirrel killed"]);
        addLog("ENCOUNTER WON · +65 XP · +6 chips · Squirrel Tail found.", "good");
        return;
      }
    } else {
      addLog("The shot powders a patch of dead asphalt.", "bad");
    }
    if (ap - cost < 3) enemyTurn();
  };

  const defend = async () => {
    if (combat !== "player" || ap < 2 || isSpinning) return;
    setAp((v) => v - 2);
    const result = await spinFate("Defensive read");
    if (result.score < 45 + skills.Survival * 5) {
      setHp((v) => Math.min(maxHp, v + 2));
      addLog("You find solid footing. +2 HP.", "good");
    } else addLog("You brace. The squirrel circles.");
    enemyTurn();
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
    const lower = message.toLowerCase();
    if (/help|squirrel|fight/.test(lower)) return "I’ll cover the road, but that little plague-bag is yours. Don’t let it get behind you.";
    if (/albany|citadel|marble/.test(lower)) return "The Marble Crown? White stone outside, iron rules underneath. They’re buying pre-Silence records—and burying some of them.";
    if (/government|silence|collapse/.test(lower)) return "My grandmother called it the Federal Silence. Orders stopped, money froze, and every county became a little kingdom with a hungry army.";
    if (/trade|buy|sell|chips/.test(lower)) return roll < 55 ? "Maybe. Show me something useful and keep your hands where I can see them." : "Not today. I don’t know you well enough to open my pack.";
    return roll < 45 ? "That’s a strange thing to say out here. Still… I believe you mean it." : "Words are cheap on this road. Give me a reason to remember yours.";
  };

  const speakWithDeviceVoice = (text: string, character: "player" | "rowan") => new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices().filter((voice) => /^en[-_]/i.test(voice.lang));
    const preferred = character === "rowan"
      ? voices.find((voice) => /zira|samantha|aria|female|natural/i.test(voice.name)) || voices[1] || voices[0]
      : voices.find((voice) => /david|guy|male|mark/i.test(voice.name)) || voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.rate = character === "rowan" ? .88 : .98;
    utterance.pitch = character === "rowan" ? .82 : 1.02;
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

  const speak = async () => {
    const message = dialogueInput.trim();
    if (!message || dialogueBusy) return;
    setDialogueInput("");
    setConversation((v) => [...v, { speaker: "YOU", text: message }]);
    setDialogueBusy(true);
    queueVoice(message, "player", "intentional");
    const slot = await spinFate("Dialogue check");
    try {
      const response = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, npc, skills, luck, slot: slot.score, worldFlags, location, history: conversation.slice(-10) }),
      });
      if (!response.ok) throw new Error("Dialogue service unavailable");
      const turn = await response.json();
      setConversation((v) => [...v, { speaker: "ROWAN", text: turn.reply }]);
      queueVoice(turn.reply, "rowan", turn.mood || npc.mood);
      setNpc((old) => ({
        trust: clamp(old.trust + Number(turn.trustDelta || 0)),
        respect: clamp(old.respect + Number(turn.respectDelta || 0)),
        fear: clamp(old.fear + Number(turn.fearDelta || 0)),
        mood: turn.mood || old.mood,
        opinion: turn.opinion || old.opinion,
        memories: [...old.memories, turn.memory || `You said: ${message}`].slice(-6),
      }));
      if (turn.worldEvent) {
        setWorldFlags((v) => [...new Set([...v, turn.worldEvent])]);
        addLog(`WORLD UPDATED · ${turn.worldEvent}`, "system");
      }
      if (turn.xp) awardXp(Math.min(20, Number(turn.xp)));
    } catch {
      const reply = fallbackDialogue(message, slot.score);
      setConversation((v) => [...v, { speaker: "ROWAN", text: reply }]);
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

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">A POST-FEDERAL ROLE-PLAYING GAME</span>
          <h1>LIFE <i>IS A</i> GAMBLE</h1>
        </div>
        <div className="location-block"><span>◈ CURRENT SECTOR</span><strong>{location}</strong></div>
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
            <div className="level-ground">
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
              <ModularBuilding className="build-bank" name="ONONDAGA TRUST" subtitle="SEALED PROPERTY" material="stone" floors={4} bays={4} door={interactions.bankDoor} doorBay={1} damaged onInteract={openInteraction} />
              <ModularBuilding className="build-canal" name="ERIE CANAL MUSEUM" subtitle="MEMORY EXCHANGE · OPEN" material="brick" floors={3} bays={4} door={interactions.museumDoor} doorBay={2} damaged onInteract={openInteraction} />
              <ModularBuilding className="build-provisioners" name="CLINTON PROVISIONERS" subtitle="TRADE GOODS · LOCKED" material="brick" floors={2} bays={4} door={interactions.supplyDoor} doorBay={1} storefront onInteract={openInteraction} />
              <ModularBuilding className="build-market" name="SALINA MARKET" subtitle="SHUTTERED" material="brick" floors={3} bays={5} door={interactions.marketDoor} doorBay={2} storefront damaged onInteract={openInteraction} />
              <ModularBuilding className="build-hotel" name="EMPIRE ROOMS" subtitle="CONDEMNED" material="stone" floors={4} bays={3} door={interactions.hotelDoor} doorBay={1} damaged onInteract={openInteraction} />
              <ModularBuilding className="build-corner" name="CLINTON HOUSE" subtitle="CLAIMED · NO ENTRY" material="brick" floors={4} bays={5} door={interactions.houseDoor} doorBay={3} storefront onInteract={openInteraction} />
              <ModularBuilding className="build-hall" name="CITY HALL ANNEX" subtitle="RECORDS · LOCKED" material="stone" floors={4} bays={4} door={interactions.cityHallDoor} doorBay={1} onInteract={openInteraction} />
              <ModularBuilding className="build-foundry" name="SALT CITY FOUNDRY" subtitle="UNION PROPERTY" material="metal" floors={3} bays={5} door={interactions.foundryDoor} doorBay={2} damaged onInteract={openInteraction} />
              <ModularBuilding className="build-theatre" name="LANDMARK THEATRE" subtitle="STRUCTURE UNSAFE" material="brick" floors={3} bays={5} door={interactions.theaterDoor} doorBay={2} storefront damaged onInteract={openInteraction} />
              <ModularBuilding className="build-warehouse" name="ARMORY STORAGE" subtitle="NO TENANT" material="metal" floors={2} bays={4} door={interactions.warehouseDoor} doorBay={2} damaged onInteract={openInteraction} />
              <ModularBuilding className="build-rowhouse" name="HANOVER ROW" subtitle="RESIDENTIAL CLAIM" material="brick" floors={3} bays={3} door={interactions.rowhouseDoor} doorBay={1} damaged onInteract={openInteraction} />
              <ModularBuilding className="build-saltworks" name="SALTWORKS EXCHANGE" subtitle="BOARDED" material="brick" floors={3} bays={4} door={interactions.saltworksDoor} doorBay={2} storefront damaged onInteract={openInteraction} />
            </div>

            <button className="hotspot prop sedan-prop" onClick={(e) => openInteraction(e, interactions.sedan)} onContextMenu={(e) => openInteraction(e, interactions.sedan)} aria-label="Interact with abandoned sedan"><LandmarkSprite row={0} col={0} label="Rusted abandoned sedan" /></button>
            <button className="hotspot prop lamp-prop" onClick={(e) => openInteraction(e, interactions.lamp)} onContextMenu={(e) => openInteraction(e, interactions.lamp)} aria-label="Interact with street lamp"><LandmarkSprite row={0} col={1} label="Bent street lamp" /></button>
            <LandmarkSprite row={1} col={0} label="Scrap checkpoint barricade" className="city-prop barricade-prop" />
            <LandmarkSprite row={1} col={1} label="Dead tree planter" className="city-prop tree-prop" />
            {cityDecor.map((decor, index) => <DecorSprite key={`${decor.className}-${index}`} {...decor} />)}

            <div className="walk-destination" style={{ left: `${destination.x}%`, top: `${destination.y}%` }} />
            <div className={`downtown-player ${walking ? `walking ${movementMode}` : ""}`} data-facing={walkFacing} style={{ left: `${playerPosition.x}%`, top: `${playerPosition.y}%`, transitionDuration: `${walkDuration}ms` }}>
              <div className="status-tag you">YOU {walking ? `· ${movementMode === "run" ? "RUNNING" : "WALKING"}` : "· READY"}</div>
              {combatFrame === null
                ? <CourierMotionSprite mode={walking ? movementMode : "idle"} frame={walkFrame} label={`Courier ${walking ? movementMode : "standing"} in downtown Syracuse`} />
                : <Sprite row={0} col={combatFrame} label="Courier in combat in downtown Syracuse" />}
              <div className="entity-ring" />
            </div>

            <button className="downtown-rowan" onClick={(e) => { e.stopPropagation(); setPanel("dialogue"); }} aria-label="Talk to Rowan">
              <div className="status-tag npc">ROWAN · TALK</div><Sprite row={2} col={npc.trust > 35 ? 3 : 0} label="Rowan near Clinton Square" /><div className="entity-ring" />
            </button>
            {enemyHp > 0 && <button className="downtown-squirrel" onClick={(e) => { e.stopPropagation(); startCombat(); }} aria-label="Engage rabid squirrel"><div className="status-tag enemy">RABID SQUIRREL · {enemyHp}/18</div><Sprite row={1} col={squirrelFrame} label="Rabid squirrel in Armory Square alley" /><div className="entity-ring" /></button>}
            <div className="control-hint"><b>LEFT CLICK</b> WALK <i>•</i> <b>RIGHT CLICK</b> INTERACT <i>•</i> Doors remember locks</div>
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
            </> : <button onClick={() => useProp(contextMenu.target)}><b>⌕</b><span>{contextMenu.target.action === "search" ? "SEARCH" : "INSPECT"}<small>Interact with object</small></span></button>}
          </div>}
          {combat === "idle" && enemyHp > 0 && <button className="engage-prompt city-engage" onClick={(e) => { e.stopPropagation(); startCombat(); }}><span>ALLEY THREAT</span> Engage rabid squirrel <kbd>E</kbd></button>}
          {combat === "won" && <div className="victory-stamp">ARMORY ALLEY CLEARED <span>+65 XP</span></div>}
        </section>

        <aside className="right-panel">
          <section className="vitals">
            <div className="portrait"><Sprite row={0} col={0} label="Courier portrait" /></div>
            <div><small>THE COURIER</small><strong>Drifter, Level {level}</strong><div className="meter hp"><i style={{ width: `${(hp / maxHp) * 100}%` }} /><span>HP {hp}/{maxHp}</span></div></div>
          </section>

          <section className="turn-panel">
            <div className="section-heading"><span>{combat === "player" ? "YOUR TURN" : combat === "enemy" ? "ENEMY TURN" : "FIELD ACTIONS"}</span><b>{ap} AP</b></div>
            <div className="ap-pips">{Array.from({ length: 7 }, (_, i) => <i key={i} className={i < ap ? "filled" : ""} />)}</div>
            <div className="weapon-card">
              <div className="weapon-art">⌐<span>• • •</span></div>
              <div><small>EQUIPPED</small><strong>PIPE PISTOL</strong><span>5–9 DMG · 71% BASE</span></div>
            </div>
            <div className="action-grid">
              <button className={selectedAction === "Pistol" ? "selected" : ""} onClick={() => { setSelectedAction("Pistol"); attack(false); }} disabled={combat !== "player" || isSpinning}><span>3 AP</span><b>SNAP SHOT</b><em>Guns + Luck</em></button>
              <button onClick={() => { setSelectedAction("Aim"); attack(true); }} disabled={combat !== "player" || isSpinning}><span>5 AP</span><b>AIMED SHOT</b><em>+16% hit</em></button>
              <button onClick={defend} disabled={combat !== "player" || isSpinning}><span>2 AP</span><b>BRACE</b><em>Survival check</em></button>
              <button onClick={() => setPanel("dialogue")} disabled={combat === "enemy"}><span>—</span><b>TALK</b><em>Rowan</em></button>
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
        <div className={`slot-machine ${isSpinning ? "spinning" : ""}`}>
          <div className="slot-cap"><span>{slotLabel}</span><b>LUCK {luck}</b></div>
          <div className="reels">{reels.map((reel, i) => <div key={i}><span>{reel}</span></div>)}</div>
          <button onClick={() => spinFate("Tempt fate")} disabled={isSpinning}>PULL</button>
          <div className="slot-lamps"><i /><i /><i /><i /><i /></div>
        </div>
        <div className="fate-odds"><span>FATE MODIFIERS</span><div><b>+12%</b> LUCK</div><div><b>+6%</b> SKILL</div><div><b>−4%</b> RADIATION</div></div>
      </footer>

      {panel && (
        <div className="overlay" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) setPanel(null); }}>
          <section className={`modal ${panel}`} role="dialog" aria-modal="true" aria-label={`${panel} panel`}>
            <button className="close" onClick={() => setPanel(null)} aria-label="Close panel">×</button>

            {panel === "inventory" && <Inventory chips={chips} />}
            {panel === "skills" && <Skills level={level} skills={skills} points={skillPoints} upgrade={upgradeSkill} />}
            {panel === "map" && <WorldMap level={level} location={location} travel={travel} />}
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
                speakingCharacter={speakingCharacter}
                toggleVoice={toggleVoice}
              />
            )}
            {panel === "help" && <Codex worldFlags={worldFlags} />}
          </section>
        </div>
      )}
    </main>
  );
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

function Inventory({ chips }: { chips: number }) {
  const [items, setItems] = useState<InventoryItem[]>(inventoryItems);
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
      setItems((old) => old.map((entry) => entry.id === item.id ? { ...entry, x, y, equipped: null } : entry));
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
      setItems((old) => old.map((entry) => entry.id === item.id ? { ...entry, equipped: slot } : entry));
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
          return <div key={slot.id} className={`equip-slot slot-${slot.id} ${dragOver === slot.id ? "drag-over" : ""} ${equipped ? "occupied" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragOver(slot.id); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => dropOnSlot(event, slot.id)}>
            <small>{slot.mark} {slot.label}</small>
            {equipped ? <button draggable onDragStart={(event) => beginDrag(event, equipped)} onDragEnd={() => { setDraggingId(null); setDragOver(null); }} onClick={() => setSelectedId(equipped.id)}><b>{equipped.icon}</b><span>{equipped.name}</span></button> : <em>EMPTY</em>}
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
    <div className="inventory-foot"><span>OLD-WORLD CHIPS</span><b>◉ {chips}</b><em>Drag equipped items back into any valid pack cell to unequip</em></div>
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

function Dialogue({ npc, conversation, input, setInput, speak, busy, reels, voiceEnabled, speakingCharacter, toggleVoice }: { npc: NpcState; conversation: { speaker: string; text: string }[]; input: string; setInput: (v: string) => void; speak: () => void; busy: boolean; reels: string[]; voiceEnabled: boolean; speakingCharacter: "YOU" | "ROWAN" | null; toggleVoice: () => void }) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = transcriptRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [conversation, busy]);
  return <div className="dialogue-view">
    <aside className="npc-dossier">
      <div className="npc-portrait"><Sprite row={2} col={0} label="Rowan portrait" /></div>
      <small>LONE WANDERER</small><h2>ROWAN VALE</h2><p className="mood">MOOD · {npc.mood}</p>
      <div className="relation"><span>TRUST <b>{npc.trust}</b></span><i><em style={{ width: `${npc.trust}%` }} /></i></div>
      <div className="relation"><span>RESPECT <b>{npc.respect}</b></span><i><em style={{ width: `${npc.respect}%` }} /></i></div>
      <div className="relation fear"><span>FEAR <b>{npc.fear}</b></span><i><em style={{ width: `${npc.fear}%` }} /></i></div>
      <div className="opinion"><small>CURRENT OPINION</small><p>“{npc.opinion}”</p></div>
      <div className="knowledge"><small>KNOWN / REMEMBERED</small>{npc.memories.slice(-3).map((m, i) => <p key={i}>• {m}</p>)}</div>
      <div className="likes"><span><b>LIKES</b> candor, maps, coffee</span><span><b>DISLIKES</b> Citadel clerks, threats</span></div>
    </aside>
    <section className="conversation">
      <div className="conversation-head"><div><small>LIVE CHARACTER SIMULATION</small><strong>Say anything. Rowan remembers.</strong><em>{speakingCharacter ? `VOICE · ${speakingCharacter} SPEAKING` : voiceEnabled ? "VOICE · READY" : "VOICE · MUTED"}</em></div><button className={`voice-toggle ${voiceEnabled ? "on" : ""}`} onClick={toggleVoice} aria-pressed={voiceEnabled} aria-label={voiceEnabled ? "Mute character voices" : "Enable character voices"}>{voiceEnabled ? "◖))" : "◖×"}<small>{voiceEnabled ? "VOICES ON" : "VOICES OFF"}</small></button><div className="mini-slot">{reels.map((r, i) => <b key={i}>{r}</b>)}</div></div>
      <div className="transcript" ref={transcriptRef} tabIndex={0} aria-label="Scrollable conversation transcript">{conversation.map((line, i) => <div key={i} className={line.speaker === "YOU" ? "player-line" : "npc-line"}><span>{line.speaker}<i>{line.speaker === "YOU" ? "CORAL" : "CEDAR"}</i></span><p>{line.text}</p></div>)}{busy && <div className="npc-line thinking"><span>ROWAN</span><p>Weighing your words against what you have already said…</p></div>}</div>
      <div className="dialogue-compose"><div className="check-hints"><span>[SPEECH {3}] Persuade</span><span>[BARTER {2}] Deal</span><span>[LUCK 6] Tempt fate</span></div><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); speak(); } }} placeholder="Type anything to Rowan… ask, lie, threaten, joke, bargain." maxLength={500} /><button onClick={speak} disabled={busy || !input.trim()}>{busy ? "THINKING…" : "SAY IT"}</button><small>Every line is spoken. Voices are AI-generated. Rowan tracks context, subtext, memory, mood, and consequences.</small></div>
    </section>
  </div>;
}

function Codex({ worldFlags }: { worldFlags: string[] }) {
  return <div className="codex-view">
    <div className="modal-head"><small>ARCHIVE TERMINAL</small><h2>WASTELAND CODEX</h2><p>The old government did not fall in one day. It simply stopped answering.</p></div>
    <div className="codex-columns"><section><h3>THE FEDERAL SILENCE · 2086</h3><p>A cascading debt crisis, state mutinies, infrastructure failures, and a disputed transfer of power ended the federal chain of command. No singular apocalypse came. Payrolls ceased. Grids went dark. Counties fortified. A century later, every surviving institution claims to be the legitimate continuation.</p><h3>THE MARBLE CROWN</h3><p>Albany Citadel occupies the Capitol complex and Empire State Plaza. Its archivists trade security for records, identity papers, and loyalty.</p></section><section><h3>DYNAMIC WORLD STATE</h3>{worldFlags.map((flag, i) => <p className="flag" key={i}>◈ {flag}</p>)}<h3>CONTROLS</h3><p>Click characters and threats to interact. Use the left rail for map, inventory, and skills. Combat actions consume AP. Every meaningful check spins the Fate Engine.</p></section><section className="atlas"><h3>ANIMATION SPRITE GRAPH</h3><img src="/life-is-a-gamble-sprite-atlas.png" alt="Generated animation sprite atlas with courier, squirrel, and Rowan frames" /><p>Courier · Rabid Squirrel · Rowan Vale</p></section></div>
  </div>;
}
