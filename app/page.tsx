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

const initialSkills = { Guns: 3, Barter: 2, Speech: 3, Survival: 4, Medicine: 1, Mechanics: 2 };
const reelSymbols = ["♠", "7", "☢", "♦", "★", "BAR"];

const inventoryItems = [
  { id: 1, name: "Pipe Pistol", icon: "⌐", x: 0, y: 0, w: 2, h: 1, note: "5–9 DMG · .22 scrapshot" },
  { id: 2, name: "Road Coat", icon: "♜", x: 3, y: 0, w: 2, h: 3, note: "+1 Armor · many pockets" },
  { id: 3, name: "Dried Apples", icon: "●", x: 0, y: 2, w: 1, h: 1, note: "+8 HP · tastes like paper" },
  { id: 4, name: "Bent Lockpick", icon: "⌁", x: 1, y: 2, w: 1, h: 2, note: "+5% Lockpick · fragile" },
  { id: 5, name: "Old Chips", icon: "◉", x: 6, y: 0, w: 2, h: 2, note: "Currency · 37 chips" },
  { id: 6, name: "Squirrel Tail", icon: "〰", x: 6, y: 3, w: 1, h: 2, note: "Quest item · still warm" },
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

function EnvSprite({ row, col, label, className = "", style }: { row: number; col: number; label: string; className?: string; style?: CSSProperties }) {
  return <div className={`env-sprite ${className}`} role="img" aria-label={label} style={{ ...style, backgroundPosition: `${col * 33.333}% ${row * 33.333}%` }} />;
}

const interactions: Record<string, InteractionTarget> = {
  supplyDoor: { id: "supply-door", label: "Clinton Provisioners", kind: "door", locked: true, lockpick: true, interior: "Clinton Provisioners" },
  museumDoor: { id: "museum-door", label: "Erie Canal Museum Archive", kind: "door", interior: "Erie Canal Museum Archive" },
  theaterDoor: { id: "theater-door", label: "Landmark Theatre Stage Door", kind: "door", inaccessible: true },
  cityHallDoor: { id: "city-hall-door", label: "Syracuse City Hall Records Annex", kind: "door", locked: true, lockpick: true, interior: "City Hall Records Annex" },
  sedan: { id: "rusted-sedan", label: "Abandoned Sedan", kind: "prop", action: "search" },
  lamp: { id: "erie-lamp", label: "Erie Boulevard Street Lamp", kind: "prop", action: "inspect" },
};

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
  const [walkFrame, setWalkFrame] = useState(1);
  const [walkFacing, setWalkFacing] = useState<"left" | "right">("right");
  const [walkDuration, setWalkDuration] = useState(500);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: InteractionTarget } | null>(null);
  const [unlockedDoors, setUnlockedDoors] = useState<string[]>([]);
  const [interior, setInterior] = useState<string | null>(null);
  const [dialogueInput, setDialogueInput] = useState("");
  const [dialogueBusy, setDialogueBusy] = useState(false);
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
      if (save.location && !String(save.location).includes("Salt Yard")) setLocation(save.location);
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
    const timer = setInterval(() => setWalkFrame((frame) => frame === 1 ? 2 : 1), 145);
    return () => clearInterval(timer);
  }, [walking]);

  const xpGoal = level * 100;
  const currentFrame = walking ? walkFrame : combat === "player" ? 3 : combat === "enemy" ? 4 : 0;
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
    const distance = Math.hypot((x - playerPosition.x) * bounds.width / 100, (y - playerPosition.y) * bounds.height / 100);
    const duration = Math.max(240, Math.min(1700, distance * 3.5));
    setContextMenu(null);
    setWalkFacing(x < playerPosition.x ? "left" : "right");
    setDestination({ x, y });
    setWalkDuration(duration);
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
    if (place.kind === "citadel" && level < 4) {
      addLog("Albany Citadel denies entry. Clearance requires Level 4.", "bad");
      return;
    }
    setPanel(null);
    const result = await spinFate("Road event");
    setLocation(place.name);
    if (result.jackpot) {
      setWorldFlags((v) => [...new Set([...v, `Lucky cache found near ${place.name}`])]);
      addLog(`A road cache turns up outside ${place.name}.`, "good");
    } else addLog(`Traveled to ${place.name}. ${place.detail}`);
  };

  const fallbackDialogue = (message: string, roll: number) => {
    const lower = message.toLowerCase();
    if (/help|squirrel|fight/.test(lower)) return "I’ll cover the road, but that little plague-bag is yours. Don’t let it get behind you.";
    if (/albany|citadel|marble/.test(lower)) return "The Marble Crown? White stone outside, iron rules underneath. They’re buying pre-Silence records—and burying some of them.";
    if (/government|silence|collapse/.test(lower)) return "My grandmother called it the Federal Silence. Orders stopped, money froze, and every county became a little kingdom with a hungry army.";
    if (/trade|buy|sell|chips/.test(lower)) return roll < 55 ? "Maybe. Show me something useful and keep your hands where I can see them." : "Not today. I don’t know you well enough to open my pack.";
    return roll < 45 ? "That’s a strange thing to say out here. Still… I believe you mean it." : "Words are cheap on this road. Give me a reason to remember yours.";
  };

  const speak = async () => {
    const message = dialogueInput.trim();
    if (!message || dialogueBusy) return;
    setDialogueInput("");
    setConversation((v) => [...v, { speaker: "YOU", text: message }]);
    setDialogueBusy(true);
    const slot = await spinFate("Dialogue check");
    try {
      const response = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, npc, skills, luck, slot: slot.score, worldFlags, location }),
      });
      if (!response.ok) throw new Error("Dialogue service unavailable");
      const turn = await response.json();
      setConversation((v) => [...v, { speaker: "ROWAN", text: turn.reply }]);
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
            <div className="map-reference">STREET PLAN · REAL-WORLD DOWNTOWN ANCHORS</div>

            <div className="street erie"><span>ERIE BLVD W</span></div>
            <div className="street salina"><span>S SALINA ST</span></div>
            <div className="street franklin"><span>S FRANKLIN ST</span></div>
            <div className="street fayette"><span>W FAYETTE ST</span></div>
            <div className="street washington"><span>W WASHINGTON ST</span></div>
            <EnvSprite row={0} col={1} label="Cracked downtown intersection" className="city-tile tile-intersection" />
            <EnvSprite row={0} col={0} label="Cracked Erie Boulevard road tile" className="city-tile tile-road-a" />
            <EnvSprite row={0} col={2} label="Broken sidewalk corner" className="city-tile tile-sidewalk" />
            <EnvSprite row={0} col={3} label="Clinton Square brick plaza" className="city-tile tile-plaza" />

            <div className="district-label clinton-label"><b>CLINTON SQUARE</b><small>MONUMENT BASIN</small></div>
            <div className="district-label armory-label"><b>ARMORY SQUARE</b><small>CARAVAN MARKET</small></div>
            <div className="district-label hanover-label"><b>HANOVER SQUARE</b><small>NEUTRAL BLOCK</small></div>

            <div className="city-building canal-museum" onClick={(e) => e.stopPropagation()}>
              <EnvSprite row={3} col={0} label="Canal-era warehouse facade" className="building-art" />
              <div className="building-name"><small>318 ERIE BLVD E</small><b>ERIE CANAL MUSEUM</b><span>MEMORY EXCHANGE</span></div>
              <button className="hotspot door museum-door" onClick={(e) => openInteraction(e, interactions.museumDoor)} onContextMenu={(e) => openInteraction(e, interactions.museumDoor)} aria-label="Interact with Erie Canal Museum archive door"><EnvSprite row={1} col={2} label="Museum archive door" /></button>
            </div>

            <div className="city-building city-hall" onClick={(e) => e.stopPropagation()}>
              <EnvSprite row={1} col={1} label="Soot-stained civic limestone building" className="building-art civic-art" />
              <div className="building-name"><small>E WASHINGTON + MONTGOMERY</small><b>SYRACUSE CITY HALL</b><span>FREE RECORDS ANNEX</span></div>
              <button className="hotspot door hall-door" onClick={(e) => openInteraction(e, interactions.cityHallDoor)} onContextMenu={(e) => openInteraction(e, interactions.cityHallDoor)} aria-label="Interact with City Hall records annex door"><EnvSprite row={1} col={2} label="Locked City Hall door" /></button>
            </div>

            <div className="city-building landmark-theatre" onClick={(e) => e.stopPropagation()}>
              <EnvSprite row={3} col={1} label="Ruined Landmark Theatre storefront" className="building-art theatre-art" />
              <div className="marquee">LANDMARK</div>
              <button className="hotspot door theater-door" onClick={(e) => openInteraction(e, interactions.theaterDoor)} onContextMenu={(e) => openInteraction(e, interactions.theaterDoor)} aria-label="Interact with inaccessible Landmark Theatre door"><EnvSprite row={1} col={3} label="Boarded theater door" /></button>
            </div>

            <div className="city-building provisioners" onClick={(e) => e.stopPropagation()}>
              <EnvSprite row={1} col={0} label="Ruined red brick provisioner building" className="building-art shop-art" />
              <div className="building-name"><small>S CLINTON + W FAYETTE</small><b>CLINTON PROVISIONERS</b><span>LOCKED · TRADE GOODS</span></div>
              <button className="hotspot door supply-door" onClick={(e) => openInteraction(e, interactions.supplyDoor)} onContextMenu={(e) => openInteraction(e, interactions.supplyDoor)} aria-label="Interact with locked provisioner door"><EnvSprite row={1} col={2} label="Locked steel shop door" /></button>
            </div>

            <button className="hotspot prop sedan-prop" onClick={(e) => openInteraction(e, interactions.sedan)} onContextMenu={(e) => openInteraction(e, interactions.sedan)} aria-label="Interact with abandoned sedan"><EnvSprite row={2} col={3} label="Rusted abandoned sedan" /></button>
            <button className="hotspot prop lamp-prop" onClick={(e) => openInteraction(e, interactions.lamp)} onContextMenu={(e) => openInteraction(e, interactions.lamp)} aria-label="Interact with Erie Boulevard street lamp"><EnvSprite row={2} col={1} label="Bent street lamp" /></button>
            <EnvSprite row={2} col={2} label="Scrap checkpoint barricade" className="city-prop barricade-prop" />
            <EnvSprite row={3} col={2} label="Downtown rubble pile" className="city-prop rubble-prop" />
            <EnvSprite row={3} col={3} label="Dead tree planter" className="city-prop tree-prop" />

            <div className="walk-destination" style={{ left: `${destination.x}%`, top: `${destination.y}%` }} />
            <div className={`downtown-player ${walking ? "walking" : ""}`} data-facing={walkFacing} style={{ left: `${playerPosition.x}%`, top: `${playerPosition.y}%`, transitionDuration: `${walkDuration}ms` }}>
              <div className="status-tag you">YOU {walking ? "· WALKING" : "· READY"}</div>
              <Sprite row={0} col={currentFrame} label="Courier walking through downtown Syracuse" />
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
            <div className="interior-player"><Sprite row={0} col={0} label="Courier inside building" /><div className="entity-ring" /></div>
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
              />
            )}
            {panel === "help" && <Codex worldFlags={worldFlags} />}
          </section>
        </div>
      )}
    </main>
  );
}

function Inventory({ chips }: { chips: number }) {
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
  const [hovered, setHovered] = useState(cities.find((c) => location.includes(c.name)) || cities[5]);
  return <div className="map-view">
    <div className="modal-head"><small>ROAD NETWORK 2186</small><h2>THE UPSTATE WASTES</h2><p>A compressed expedition map · routes redraw as the world changes.</p></div>
    <div className="map-paper">
      <div className="lake lake-erie">LAKE ERIE</div><div className="lake lake-ontario">LAKE ONTARIO</div>
      <div className="route r1" /><div className="route r2" /><div className="route r3" /><div className="route r4" /><div className="route r5" />
      {cities.map((place) => <button key={place.name} className={`map-pin ${place.kind} ${location.includes(place.name) ? "here" : ""}`} style={{ left: `${place.x}%`, top: `${place.y}%` }} onMouseEnter={() => setHovered(place)} onFocus={() => setHovered(place)} onClick={() => travel(place)}><i />{place.name}<small>{place.kind === "citadel" && level < 4 ? "LOCKED · LVL 4" : place.kind.toUpperCase()}</small></button>)}
      <div className="map-gridlines" />
    </div>
    <div className="map-readout"><span>SELECTED DESTINATION</span><strong>{hovered.name}</strong><p>{hovered.detail}</p><em>{hovered.kind === "citadel" && level < 4 ? "Citadel access denied until Level 4" : "Click marker to travel · road event will test Fate"}</em></div>
  </div>;
}

function Dialogue({ npc, conversation, input, setInput, speak, busy, reels }: { npc: NpcState; conversation: { speaker: string; text: string }[]; input: string; setInput: (v: string) => void; speak: () => void; busy: boolean; reels: string[] }) {
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
      <div className="conversation-head"><div><small>LIVE CHARACTER SIMULATION</small><strong>Say anything. Rowan remembers.</strong></div><div className="mini-slot">{reels.map((r, i) => <b key={i}>{r}</b>)}</div></div>
      <div className="transcript">{conversation.map((line, i) => <div key={i} className={line.speaker === "YOU" ? "player-line" : "npc-line"}><span>{line.speaker}</span><p>{line.text}</p></div>)}{busy && <div className="npc-line thinking"><span>ROWAN</span><p>Weighing your words against the road…</p></div>}</div>
      <div className="dialogue-compose"><div className="check-hints"><span>[SPEECH {3}] Persuade</span><span>[BARTER {2}] Deal</span><span>[LUCK 6] Tempt fate</span></div><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); speak(); } }} placeholder="Type anything to Rowan… ask, lie, threaten, joke, bargain." maxLength={500} /><button onClick={speak} disabled={busy || !input.trim()}>{busy ? "THINKING…" : "SAY IT"}</button><small>Each turn updates memory, mood, opinions, relationships, and potentially the world.</small></div>
    </section>
  </div>;
}

function Codex({ worldFlags }: { worldFlags: string[] }) {
  return <div className="codex-view">
    <div className="modal-head"><small>ARCHIVE TERMINAL</small><h2>WASTELAND CODEX</h2><p>The old government did not fall in one day. It simply stopped answering.</p></div>
    <div className="codex-columns"><section><h3>THE FEDERAL SILENCE · 2086</h3><p>A cascading debt crisis, state mutinies, infrastructure failures, and a disputed transfer of power ended the federal chain of command. No singular apocalypse came. Payrolls ceased. Grids went dark. Counties fortified. A century later, every surviving institution claims to be the legitimate continuation.</p><h3>THE MARBLE CROWN</h3><p>Albany Citadel occupies the Capitol complex and Empire State Plaza. Its archivists trade security for records, identity papers, and loyalty.</p></section><section><h3>DYNAMIC WORLD STATE</h3>{worldFlags.map((flag, i) => <p className="flag" key={i}>◈ {flag}</p>)}<h3>CONTROLS</h3><p>Click characters and threats to interact. Use the left rail for map, inventory, and skills. Combat actions consume AP. Every meaningful check spins the Fate Engine.</p></section><section className="atlas"><h3>ANIMATION SPRITE GRAPH</h3><img src="/life-is-a-gamble-sprite-atlas.png" alt="Generated animation sprite atlas with courier, squirrel, and Rowan frames" /><p>Courier · Rabid Squirrel · Rowan Vale</p></section></div>
  </div>;
}
