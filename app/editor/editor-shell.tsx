"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./editor.module.css";
import { LevelBuilder } from "./level-builder";
import type { GameProject, Level, LootEntry, LootTable, MountInfo, Npc, NpcSpawner, ProjectResponse, Quest, SpawnEntry, WorldCell } from "./project-types";

type Tab = "world" | "loot" | "npcs" | "spawners" | "quests" | "files";
type Notice = { tone: "ok" | "warn" | "bad"; text: string } | null;
type FileItem = { path: string; size: number; sha: string };

const tabs: Array<{ id: Tab; mark: string; label: string; note: string }> = [
  { id: "world", mark: "▦", label: "World", note: "Levels, cells & doors" },
  { id: "loot", mark: "◇", label: "Loot", note: "Weighted drop tables" },
  { id: "npcs", mark: "♟", label: "NPCs", note: "Characters & behavior" },
  { id: "spawners", mark: "✣", label: "Spawners", note: "Hostiles & chances" },
  { id: "quests", mark: "☷", label: "Quests", note: "Triggers, tasks, rewards" },
  { id: "files", mark: "{ }", label: "Files", note: "Testing branch source" },
];

function idFrom(label: string, prefix: string) {
  const slug = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || prefix;
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`${styles.field} ${wide ? styles.wide : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function NumberInput({ value, onChange, min = 0, max, step = 1 }: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />;
}

function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (value: string[]) => void; placeholder?: string }) {
  return <input value={value.join(", ")} placeholder={placeholder} onChange={(event) => onChange(event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean))} />;
}

function Empty({ title, text, addLabel, onAdd }: { title: string; text: string; addLabel: string; onAdd: () => void }) {
  return <div className={styles.empty}><b>＋</b><h3>{title}</h3><p>{text}</p><button className={styles.primary} onClick={onAdd}>{addLabel}</button></div>;
}

function PaneHeader({ eyebrow, title, count, onAdd, addLabel }: { eyebrow: string; title: string; count: number; onAdd?: () => void; addLabel?: string }) {
  return <div className={styles.paneHead}><div><span>{eyebrow}</span><h2>{title}</h2></div><em>{count}</em>{onAdd && <button className={styles.addButton} onClick={onAdd}>＋ {addLabel}</button>}</div>;
}

export function EditorShell({ user }: { user: { name: string; email: string } }) {
  const [tab, setTab] = useState<Tab>("world");
  const [project, setProject] = useState<GameProject | null>(null);
  const [mount, setMount] = useState<MountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const loadProject = useCallback(async () => {
    setLoading(true); setNotice(null);
    try {
      const response = await fetch("/api/editor/project", { cache: "no-store" });
      const payload = await response.json() as ProjectResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load the mounted project.");
      setProject(payload.project); setMount(payload.mount); setDirty(false);
      if (payload.mount.message) setNotice({ tone: payload.mount.mounted ? "warn" : "bad", text: payload.mount.message });
    } catch (error) { setNotice({ tone: "bad", text: error instanceof Error ? error.message : "Could not load LIAG Editor." }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => void loadProject()); }, [loadProject]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = useCallback((mutator: (draft: GameProject) => void) => {
    setProject((current) => {
      if (!current) return current;
      const draft = structuredClone(current); mutator(draft); return draft;
    });
    setDirty(true); setNotice(null);
  }, []);

  const publish = async () => {
    if (!project || !mount?.mounted || saving) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/editor/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, sha: mount.sha }) });
      const payload = await response.json() as ProjectResponse & { error?: string; commit?: { sha?: string } };
      if (!response.ok) throw new Error(payload.error || "Publishing failed.");
      setProject(payload.project); setMount(payload.mount); setDirty(false);
      setNotice({ tone: "ok", text: `Published to ${payload.mount.branch}${payload.commit?.sha ? ` · commit ${payload.commit.sha.slice(0, 7)}` : ""}.` });
    } catch (error) { setNotice({ tone: "bad", text: error instanceof Error ? error.message : "Publishing failed." }); }
    finally { setSaving(false); }
  };

  const totals = project ? project.levels.length + project.cells.length + project.lootTables.length + project.npcs.length + project.spawners.length + project.quests.length : 0;

  return <main className={styles.editor}>
    <header className={styles.topbar}>
      <div className={styles.brand}><i>LIAG</i><div><span>LIFE IS A GAMBLE</span><h1>EDITOR</h1></div><b>ADMIN</b></div>
      <div className={styles.mount}>
        <span className={mount?.mounted ? styles.liveDot : styles.offDot} />
        <div><small>{mount?.mounted ? "GITHUB MOUNT" : "MOUNT OFFLINE"}</small><strong>{mount ? `${mount.repository} / ${mount.branch}` : "Connecting…"}</strong></div>
      </div>
      <div className={styles.actions}>
        <button onClick={() => void loadProject()} disabled={loading || saving}>Reload</button>
        <button className={styles.publish} onClick={() => void publish()} disabled={!dirty || saving || !mount?.mounted}>{saving ? "Publishing…" : dirty ? "Publish to testing" : "Published"}</button>
        <div className={styles.avatar} title={user.email}>{user.name.slice(0, 1).toUpperCase()}</div>
      </div>
    </header>
    <aside className={styles.sidebar}>
      <div className={styles.navLabel}>BUILD SYSTEMS</div>
      <nav>{tabs.map((entry) => <button key={entry.id} className={tab === entry.id ? styles.active : ""} onClick={() => setTab(entry.id)}><b>{entry.mark}</b><span>{entry.label}<small>{entry.note}</small></span>{entry.id !== "files" && project && <em>{entry.id === "world" ? project.levels.length + project.cells.length : entry.id === "loot" ? project.lootTables.length : entry.id === "npcs" ? project.npcs.length : entry.id === "spawners" ? project.spawners.length : project.quests.length}</em>}</button>)}</nav>
      <div className={styles.projectStats}><span>PROJECT INDEX</span><strong>{totals} records</strong><small>Schema v{project?.schemaVersion || 1}</small><small>{project ? new Date(project.updatedAt).toLocaleString() : "Loading…"}</small></div>
      <Link className={styles.backLink} href="/">← Open game build</Link>
    </aside>
    <section className={styles.workspace}>
      {notice && <div className={`${styles.notice} ${styles[notice.tone]}`}><span>{notice.tone === "ok" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      {loading && <div className={styles.loading}><i /><h2>Mounting testing branch</h2><p>Reading the current game-data document…</p></div>}
      {!loading && !project && <Empty title="Project unavailable" text="LIAG Editor could not open its game-data document." addLabel="Try again" onAdd={() => void loadProject()} />}
      {!loading && project && tab === "world" && <LevelBuilder project={project} edit={edit} setNotice={setNotice} />}
      {!loading && project && tab === "loot" && <LootEditor project={project} edit={edit} />}
      {!loading && project && tab === "npcs" && <NpcEditor project={project} edit={edit} />}
      {!loading && project && tab === "spawners" && <SpawnerEditor project={project} edit={edit} />}
      {!loading && project && tab === "quests" && <QuestEditor project={project} edit={edit} />}
      {!loading && project && tab === "files" && <FilesEditor mounted={Boolean(mount?.mounted)} branch={mount?.branch || "testing"} />}
    </section>
  </main>;
}

export function LegacyWorldEditor({ project, edit }: { project: GameProject; edit: (fn: (draft: GameProject) => void) => void }) {
  const [levelId, setLevelId] = useState(project.levels[0]?.id || "");
  const level = project.levels.find((entry) => entry.id === levelId) || project.levels[0];
  const levelCells = project.cells.filter((cell) => cell.levelId === level?.id);
  const [cellId, setCellId] = useState(levelCells[0]?.id || "");
  const cell = project.cells.find((entry) => entry.id === cellId && entry.levelId === level?.id) || levelCells[0];
  const updateLevel = (patch: Partial<Level>) => level && edit((draft) => Object.assign(draft.levels.find((entry) => entry.id === level.id)!, patch));
  const updateCell = (patch: Partial<WorldCell>) => cell && edit((draft) => Object.assign(draft.cells.find((entry) => entry.id === cell.id)!, patch));
  const addLevel = () => {
    const id = idFrom("new-level", "level");
    edit((draft) => draft.levels.push({ id, name: "Untitled level", region: "Upstate Wastes", description: "", environment: "ruined-city", width: 100, height: 100, gridSize: 10, playerSpawn: { x: 50, y: 50 } }));
    setLevelId(id); setCellId("");
  };
  const addCell = () => {
    if (!level) return;
    const id = idFrom("new-cell", "cell");
    edit((draft) => draft.cells.push({ id, levelId: level.id, name: "Untitled cell", kind: "exterior", x: 10, y: 10, width: 25, height: 25, ambience: "", notes: "", doors: [] }));
    setCellId(id);
  };
  if (!level) return <Empty title="Build the first level" text="Levels contain positioned cells, player spawns, doors, encounters, and interiors." addLabel="Create level" onAdd={addLevel} />;
  return <div className={styles.threePane}>
    <div className={styles.recordPane}><PaneHeader eyebrow="WORLD INDEX" title="Levels" count={project.levels.length} onAdd={addLevel} addLabel="Level" />
      <div className={styles.records}>{project.levels.map((entry) => <button key={entry.id} className={entry.id === level.id ? styles.selected : ""} onClick={() => { setLevelId(entry.id); setCellId(project.cells.find((item) => item.levelId === entry.id)?.id || ""); }}><b>{entry.name}</b><small>{entry.region}</small><em>{project.cells.filter((item) => item.levelId === entry.id).length} cells</em></button>)}</div>
      <PaneHeader eyebrow="LEVEL CONTENT" title="Cells" count={levelCells.length} onAdd={addCell} addLabel="Cell" />
      <div className={styles.records}>{levelCells.map((entry) => <button key={entry.id} className={entry.id === cell?.id ? styles.selected : ""} onClick={() => setCellId(entry.id)}><b>{entry.name}</b><small>{entry.kind} · {entry.x},{entry.y}</small><em>{entry.doors.length} doors</em></button>)}</div>
    </div>
    <div className={styles.canvasPane}>
      <div className={styles.canvasHead}><div><span>LEVEL CANVAS / {level.region.toUpperCase()}</span><h2>{level.name}</h2></div><div><small>{level.width} × {level.height}</small><b>GRID {level.gridSize}</b></div></div>
      <div className={styles.worldCanvas} style={{ aspectRatio: `${level.width}/${level.height}` }}>
        <div className={styles.grid} style={{ backgroundSize: `${100 / Math.max(1, level.width / level.gridSize)}% ${100 / Math.max(1, level.height / level.gridSize)}%` }} />
        {levelCells.map((entry, index) => <button key={entry.id} className={`${styles.cellBlock} ${entry.id === cell?.id ? styles.selectedCell : ""}`} style={{ left: `${entry.x / level.width * 100}%`, top: `${entry.y / level.height * 100}%`, width: `${entry.width / level.width * 100}%`, height: `${entry.height / level.height * 100}%`, "--cellHue": `${38 + index * 21}` } as React.CSSProperties} onClick={() => setCellId(entry.id)}><span>{entry.kind}</span><b>{entry.name}</b><small>{entry.doors.length} door{entry.doors.length === 1 ? "" : "s"}</small></button>)}
        <i className={styles.spawnPoint} style={{ left: `${level.playerSpawn.x / level.width * 100}%`, top: `${level.playerSpawn.y / level.height * 100}%` }} title="Player spawn">◆</i>
        {project.spawners.filter((entry) => entry.levelId === level.id).map((entry) => <i key={entry.id} className={styles.spawnerPoint} style={{ left: `${entry.x / level.width * 100}%`, top: `${entry.y / level.height * 100}%` }} title={entry.name}>✣</i>)}
      </div>
      <div className={styles.legend}><span><i className={styles.legendCell} />CELL BOUNDS</span><span><i className={styles.legendSpawn}>◆</i>PLAYER SPAWN</span><span><i className={styles.legendHostile}>✣</i>NPC SPAWNER</span></div>
    </div>
    <div className={styles.inspector}><div className={styles.inspectorTabs}><b>{cell ? "CELL" : "LEVEL"} INSPECTOR</b>{cell && <button onClick={() => setCellId("")}>Edit level</button>}</div>
      {!cell ? <div className={styles.formGrid}>
        <Field label="Level name" wide><TextInput value={level.name} onChange={(name) => updateLevel({ name })} /></Field>
        <Field label="Stable ID" wide hint="Referenced by cells, spawners, and quests"><TextInput value={level.id} onChange={(id) => updateLevel({ id })} /></Field>
        <Field label="Region"><TextInput value={level.region} onChange={(region) => updateLevel({ region })} /></Field>
        <Field label="Environment"><TextInput value={level.environment} onChange={(environment) => updateLevel({ environment })} /></Field>
        <Field label="Width"><NumberInput value={level.width} min={10} onChange={(width) => updateLevel({ width })} /></Field><Field label="Height"><NumberInput value={level.height} min={10} onChange={(height) => updateLevel({ height })} /></Field>
        <Field label="Grid size"><NumberInput value={level.gridSize} min={1} onChange={(gridSize) => updateLevel({ gridSize })} /></Field><Field label="Spawn X"><NumberInput value={level.playerSpawn.x} onChange={(x) => updateLevel({ playerSpawn: { ...level.playerSpawn, x } })} /></Field><Field label="Spawn Y"><NumberInput value={level.playerSpawn.y} onChange={(y) => updateLevel({ playerSpawn: { ...level.playerSpawn, y } })} /></Field>
        <Field label="Description" wide><textarea value={level.description} onChange={(event) => updateLevel({ description: event.target.value })} /></Field>
      </div> : <CellInspector cell={cell} project={project} update={updateCell} edit={edit} />}
    </div>
  </div>;
}

function CellInspector({ cell, project, update, edit }: { cell: WorldCell; project: GameProject; update: (patch: Partial<WorldCell>) => void; edit: (fn: (draft: GameProject) => void) => void }) {
  const addDoor = () => edit((draft) => draft.cells.find((entry) => entry.id === cell.id)!.doors.push({ id: idFrom("door", "door"), name: "New door", edge: "north", targetLevelId: cell.levelId, targetCellId: "", loadMode: "transition", locked: false, keyId: "" }));
  const updateDoor = (doorId: string, patch: Record<string, unknown>) => edit((draft) => Object.assign(draft.cells.find((entry) => entry.id === cell.id)!.doors.find((entry) => entry.id === doorId)!, patch));
  return <div className={styles.formGrid}>
    <Field label="Cell name" wide><TextInput value={cell.name} onChange={(name) => update({ name })} /></Field><Field label="Stable ID" wide><TextInput value={cell.id} onChange={(id) => update({ id })} /></Field>
    <Field label="Type"><select value={cell.kind} onChange={(event) => update({ kind: event.target.value as WorldCell["kind"] })}><option>exterior</option><option>interior</option><option>dungeon</option><option>encounter</option></select></Field><Field label="Ambience"><TextInput value={cell.ambience} onChange={(ambience) => update({ ambience })} /></Field>
    <Field label="X"><NumberInput value={cell.x} onChange={(x) => update({ x })} /></Field><Field label="Y"><NumberInput value={cell.y} onChange={(y) => update({ y })} /></Field><Field label="Width"><NumberInput value={cell.width} min={1} onChange={(width) => update({ width })} /></Field><Field label="Height"><NumberInput value={cell.height} min={1} onChange={(height) => update({ height })} /></Field>
    <Field label="Design notes" wide><textarea value={cell.notes} onChange={(event) => update({ notes: event.target.value })} /></Field>
    <div className={styles.subhead}><div><span>CONNECTIONS</span><b>Doors</b></div><button onClick={addDoor}>＋ Door</button></div>
    <div className={styles.stack}>{cell.doors.map((door) => <div className={styles.nestedCard} key={door.id}><div className={styles.nestedTop}><TextInput value={door.name} onChange={(name) => updateDoor(door.id, { name })} /><button className={styles.delete} onClick={() => edit((draft) => { const item = draft.cells.find((entry) => entry.id === cell.id)!; item.doors = item.doors.filter((entry) => entry.id !== door.id); })}>×</button></div><div className={styles.miniGrid}>
      <Field label="Edge"><select value={door.edge} onChange={(event) => updateDoor(door.id, { edge: event.target.value })}><option>north</option><option>east</option><option>south</option><option>west</option><option>interior</option></select></Field>
      <Field label="Load mode"><select value={door.loadMode} onChange={(event) => updateDoor(door.id, { loadMode: event.target.value })}><option>stream</option><option>transition</option><option>locked</option></select></Field>
      <Field label="Target level"><select value={door.targetLevelId} onChange={(event) => updateDoor(door.id, { targetLevelId: event.target.value, targetCellId: "" })}>{project.levels.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
      <Field label="Target cell"><select value={door.targetCellId} onChange={(event) => updateDoor(door.id, { targetCellId: event.target.value })}><option value="">Unassigned</option>{project.cells.filter((entry) => entry.levelId === door.targetLevelId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
      <Field label="Key / requirement"><TextInput value={door.keyId} onChange={(keyId) => updateDoor(door.id, { keyId })} placeholder="optional-key-id" /></Field><label className={styles.check}><input type="checkbox" checked={door.locked} onChange={(event) => updateDoor(door.id, { locked: event.target.checked })} /><span>Starts locked</span></label>
    </div></div>)}</div>
  </div>;
}

function LootEditor({ project, edit }: { project: GameProject; edit: (fn: (draft: GameProject) => void) => void }) {
  const [selectedId, setSelectedId] = useState(project.lootTables[0]?.id || "");
  const table = project.lootTables.find((entry) => entry.id === selectedId) || project.lootTables[0];
  const add = () => { const id = idFrom("loot-table", "loot"); edit((draft) => draft.lootTables.push({ id, name: "Untitled loot table", rolls: 1, allowDuplicates: false, entries: [] })); setSelectedId(id); };
  if (!table) return <Empty title="Create a loot table" text="Loot tables can be assigned to searchable objects, NPC inventories, and NPC drops." addLabel="New loot table" onAdd={add} />;
  const update = (patch: Partial<LootTable>) => edit((draft) => Object.assign(draft.lootTables.find((entry) => entry.id === table.id)!, patch));
  const updateEntry = (id: string, patch: Partial<LootEntry>) => edit((draft) => Object.assign(draft.lootTables.find((item) => item.id === table.id)!.entries.find((entry) => entry.id === id)!, patch));
  return <div className={styles.twoPane}><div className={styles.recordPane}><PaneHeader eyebrow="DROP SYSTEM" title="Loot tables" count={project.lootTables.length} onAdd={add} addLabel="Table" /><div className={styles.records}>{project.lootTables.map((entry) => <button key={entry.id} className={entry.id === table.id ? styles.selected : ""} onClick={() => setSelectedId(entry.id)}><b>{entry.name}</b><small>{entry.rolls} roll{entry.rolls === 1 ? "" : "s"}</small><em>{entry.entries.length} entries</em></button>)}</div></div><div className={styles.detailPane}>
    <div className={styles.detailHead}><div><span>LOOT TABLE</span><h2>{table.name}</h2><p>Each entry checks chance, then participates in the weighted draw.</p></div><button className={styles.addButton} onClick={() => edit((draft) => draft.lootTables.find((entry) => entry.id === table.id)!.entries.push({ id: idFrom("loot-entry", "entry"), itemId: "", itemName: "New item", chance: 100, weight: 10, min: 1, max: 1, condition: "" }))}>＋ Entry</button></div>
    <div className={styles.formGrid}><Field label="Table name"><TextInput value={table.name} onChange={(name) => update({ name })} /></Field><Field label="Stable ID"><TextInput value={table.id} onChange={(id) => update({ id })} /></Field><Field label="Rolls"><NumberInput value={table.rolls} min={1} max={20} onChange={(rolls) => update({ rolls })} /></Field><label className={styles.check}><input type="checkbox" checked={table.allowDuplicates} onChange={(event) => update({ allowDuplicates: event.target.checked })} /><span>Allow duplicate draws</span></label></div>
    <div className={styles.tableHeader}><span>ITEM</span><span>CHANCE</span><span>WEIGHT</span><span>QUANTITY</span><span>CONDITION</span><span /></div>
    <div className={styles.entryTable}>{table.entries.map((entry) => <div className={styles.tableRow} key={entry.id}><div><TextInput value={entry.itemName} onChange={(itemName) => updateEntry(entry.id, { itemName })} /><small><TextInput value={entry.itemId} onChange={(itemId) => updateEntry(entry.id, { itemId })} placeholder="item-id" /></small></div><NumberInput value={entry.chance} min={0} max={100} onChange={(chance) => updateEntry(entry.id, { chance })} /><NumberInput value={entry.weight} min={0} onChange={(weight) => updateEntry(entry.id, { weight })} /><div className={styles.range}><NumberInput value={entry.min} min={0} onChange={(min) => updateEntry(entry.id, { min })} /><i>–</i><NumberInput value={entry.max} min={entry.min} onChange={(max) => updateEntry(entry.id, { max })} /></div><TextInput value={entry.condition} onChange={(condition) => updateEntry(entry.id, { condition })} placeholder="Always" /><button className={styles.delete} onClick={() => edit((draft) => { const item = draft.lootTables.find((value) => value.id === table.id)!; item.entries = item.entries.filter((value) => value.id !== entry.id); })}>×</button></div>)}</div>
  </div></div>;
}

function NpcEditor({ project, edit }: { project: GameProject; edit: (fn: (draft: GameProject) => void) => void }) {
  const [selectedId, setSelectedId] = useState(project.npcs[0]?.id || ""); const npc = project.npcs.find((entry) => entry.id === selectedId) || project.npcs[0];
  const add = () => { const id = idFrom("custom-npc", "npc"); edit((draft) => draft.npcs.push({ id, name: "Untitled NPC", role: "", faction: "Independent", hostile: false, level: 1, health: 20, armor: 0, personality: "", dialogueStyle: "", motivation: "", fears: "", traits: [], likes: [], dislikes: [], inventoryLootTableId: "", dropLootTableId: "" })); setSelectedId(id); };
  if (!npc) return <Empty title="Build a custom NPC" text="Define combat disposition, stats, personality, tastes, motives, and loot behavior." addLabel="New NPC" onAdd={add} />;
  const update = (patch: Partial<Npc>) => edit((draft) => Object.assign(draft.npcs.find((entry) => entry.id === npc.id)!, patch));
  return <div className={styles.twoPane}><div className={styles.recordPane}><PaneHeader eyebrow="CHARACTER LIBRARY" title="NPCs" count={project.npcs.length} onAdd={add} addLabel="NPC" /><div className={styles.records}>{project.npcs.map((entry) => <button key={entry.id} className={entry.id === npc.id ? styles.selected : ""} onClick={() => setSelectedId(entry.id)}><i className={entry.hostile ? styles.hostileBadge : styles.friendlyBadge}>{entry.hostile ? "H" : "N"}</i><b>{entry.name}</b><small>{entry.role || "Unassigned role"}</small><em>LV {entry.level}</em></button>)}</div></div><div className={styles.detailPane}>
    <div className={styles.characterHead}><div className={npc.hostile ? styles.hostilePortrait : styles.npcPortrait}>{npc.name.slice(0, 2).toUpperCase()}</div><div><span>CUSTOM NPC / {npc.faction.toUpperCase()}</span><h2>{npc.name}</h2><p>{npc.role || "No role assigned"}</p></div><label className={`${styles.toggle} ${npc.hostile ? styles.dangerToggle : ""}`}><input type="checkbox" checked={npc.hostile} onChange={(event) => update({ hostile: event.target.checked })} /><i /><span>{npc.hostile ? "HOSTILE" : "NON-HOSTILE"}</span></label></div>
    <div className={styles.formGrid}><Field label="Display name"><TextInput value={npc.name} onChange={(name) => update({ name })} /></Field><Field label="Stable ID"><TextInput value={npc.id} onChange={(id) => update({ id })} /></Field><Field label="Role"><TextInput value={npc.role} onChange={(role) => update({ role })} /></Field><Field label="Faction"><TextInput value={npc.faction} onChange={(faction) => update({ faction })} /></Field><Field label="Level"><NumberInput value={npc.level} min={1} max={100} onChange={(level) => update({ level })} /></Field><Field label="Health"><NumberInput value={npc.health} min={1} onChange={(health) => update({ health })} /></Field><Field label="Armor"><NumberInput value={npc.armor} onChange={(armor) => update({ armor })} /></Field>
      <Field label="Personality" wide><textarea value={npc.personality} onChange={(event) => update({ personality: event.target.value })} placeholder="Temperament, boundaries, contradictions…" /></Field><Field label="Dialogue style" wide><textarea value={npc.dialogueStyle} onChange={(event) => update({ dialogueStyle: event.target.value })} placeholder="Cadence, vocabulary, verbal habits…" /></Field><Field label="Primary motivation" wide><TextInput value={npc.motivation} onChange={(motivation) => update({ motivation })} /></Field><Field label="Fears / pressure points" wide><TextInput value={npc.fears} onChange={(fears) => update({ fears })} /></Field><Field label="Traits" wide hint="Comma separated"><TagsInput value={npc.traits} onChange={(traits) => update({ traits })} placeholder="pragmatic, loyal, reckless" /></Field><Field label="Likes"><TagsInput value={npc.likes} onChange={(likes) => update({ likes })} /></Field><Field label="Dislikes"><TagsInput value={npc.dislikes} onChange={(dislikes) => update({ dislikes })} /></Field><Field label="Inventory loot"><select value={npc.inventoryLootTableId} onChange={(event) => update({ inventoryLootTableId: event.target.value })}><option value="">None</option>{project.lootTables.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field><Field label="Drop loot"><select value={npc.dropLootTableId} onChange={(event) => update({ dropLootTableId: event.target.value })}><option value="">None</option>{project.lootTables.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
    </div>
  </div></div>;
}

function SpawnerEditor({ project, edit }: { project: GameProject; edit: (fn: (draft: GameProject) => void) => void }) {
  const [selectedId, setSelectedId] = useState(project.spawners[0]?.id || ""); const spawner = project.spawners.find((entry) => entry.id === selectedId) || project.spawners[0];
  const add = () => { const id = idFrom("npc-spawner", "spawner"), level = project.levels[0]; edit((draft) => draft.spawners.push({ id, name: "Untitled spawner", levelId: level?.id || "", cellId: project.cells.find((cell) => cell.levelId === level?.id)?.id || "", x: 50, y: 50, radius: 8, maxAlive: 1, cooldownSeconds: 90, enabled: true, entries: [] })); setSelectedId(id); };
  if (!spawner) return <Empty title="Place an NPC spawner" text="Spawners select NPCs from weighted entries and apply an explicit chance to each result." addLabel="New spawner" onAdd={add} />;
  const update = (patch: Partial<NpcSpawner>) => edit((draft) => Object.assign(draft.spawners.find((entry) => entry.id === spawner.id)!, patch));
  const updateEntry = (id: string, patch: Partial<SpawnEntry>) => edit((draft) => Object.assign(draft.spawners.find((item) => item.id === spawner.id)!.entries.find((entry) => entry.id === id)!, patch));
  const level = project.levels.find((entry) => entry.id === spawner.levelId);
  return <div className={styles.twoPane}><div className={styles.recordPane}><PaneHeader eyebrow="ENCOUNTER SYSTEM" title="NPC spawners" count={project.spawners.length} onAdd={add} addLabel="Spawner" /><div className={styles.records}>{project.spawners.map((entry) => <button key={entry.id} className={entry.id === spawner.id ? styles.selected : ""} onClick={() => setSelectedId(entry.id)}><i className={styles.hostileBadge}>✣</i><b>{entry.name}</b><small>{project.cells.find((cell) => cell.id === entry.cellId)?.name || "Unplaced"}</small><em>{entry.entries.length} entries</em></button>)}</div></div><div className={styles.detailPane}>
    <div className={styles.detailHead}><div><span>NPC SPAWNER / {level?.name.toUpperCase() || "UNPLACED"}</span><h2>{spawner.name}</h2><p>Spawn chances are evaluated independently before weighted selection.</p></div><label className={styles.toggle}><input type="checkbox" checked={spawner.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><i /><span>{spawner.enabled ? "ACTIVE" : "DISABLED"}</span></label></div>
    <div className={styles.formGrid}><Field label="Spawner name"><TextInput value={spawner.name} onChange={(name) => update({ name })} /></Field><Field label="Stable ID"><TextInput value={spawner.id} onChange={(id) => update({ id })} /></Field><Field label="Level"><select value={spawner.levelId} onChange={(event) => update({ levelId: event.target.value, cellId: project.cells.find((cell) => cell.levelId === event.target.value)?.id || "" })}>{project.levels.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></Field><Field label="Cell"><select value={spawner.cellId} onChange={(event) => update({ cellId: event.target.value })}>{project.cells.filter((entry) => entry.levelId === spawner.levelId).map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></Field><Field label="X"><NumberInput value={spawner.x} onChange={(x) => update({ x })} /></Field><Field label="Y"><NumberInput value={spawner.y} onChange={(y) => update({ y })} /></Field><Field label="Radius"><NumberInput value={spawner.radius} min={1} onChange={(radius) => update({ radius })} /></Field><Field label="Max alive"><NumberInput value={spawner.maxAlive} min={1} onChange={(maxAlive) => update({ maxAlive })} /></Field><Field label="Cooldown (seconds)"><NumberInput value={spawner.cooldownSeconds} min={0} onChange={(cooldownSeconds) => update({ cooldownSeconds })} /></Field></div>
    <div className={styles.subhead}><div><span>WEIGHTED ENCOUNTER LIST</span><b>Spawn table</b></div><button onClick={() => edit((draft) => draft.spawners.find((entry) => entry.id === spawner.id)!.entries.push({ id: idFrom("spawn-entry", "spawn"), npcId: project.npcs.find((npc) => npc.hostile)?.id || project.npcs[0]?.id || "", chance: 100, weight: 10, minGroup: 1, maxGroup: 1 }))}>＋ NPC entry</button></div>
    <div className={styles.tableHeader}><span>NPC</span><span>CHANCE</span><span>WEIGHT</span><span>GROUP SIZE</span><span /><span /></div><div className={styles.entryTable}>{spawner.entries.map((entry) => <div className={styles.tableRow} key={entry.id}><select value={entry.npcId} onChange={(event) => updateEntry(entry.id, { npcId: event.target.value })}>{project.npcs.map((npc) => <option value={npc.id} key={npc.id}>{npc.hostile ? "HOSTILE · " : ""}{npc.name}</option>)}</select><NumberInput value={entry.chance} min={0} max={100} onChange={(chance) => updateEntry(entry.id, { chance })} /><NumberInput value={entry.weight} min={0} onChange={(weight) => updateEntry(entry.id, { weight })} /><div className={styles.range}><NumberInput value={entry.minGroup} min={1} onChange={(minGroup) => updateEntry(entry.id, { minGroup })} /><i>–</i><NumberInput value={entry.maxGroup} min={entry.minGroup} onChange={(maxGroup) => updateEntry(entry.id, { maxGroup })} /></div><span className={styles.chanceBar}><i style={{ width: `${entry.chance}%` }} /></span><button className={styles.delete} onClick={() => edit((draft) => { const item = draft.spawners.find((value) => value.id === spawner.id)!; item.entries = item.entries.filter((value) => value.id !== entry.id); })}>×</button></div>)}</div>
  </div></div>;
}

function QuestEditor({ project, edit }: { project: GameProject; edit: (fn: (draft: GameProject) => void) => void }) {
  const [selectedId, setSelectedId] = useState(project.quests[0]?.id || ""); const quest = project.quests.find((entry) => entry.id === selectedId) || project.quests[0];
  const add = () => { const id = idFrom("new-quest", "quest"); edit((draft) => draft.quests.push({ id, title: "Untitled quest", summary: "", giverNpcId: "", repeatable: false, hidden: false, triggers: [], tasks: [], completionMode: "all_required", completionRequirements: "", rewards: [] })); setSelectedId(id); };
  if (!quest) return <Empty title="Build the first quest" text="Combine start triggers, ordered sub-tasks, completion logic, and rewards." addLabel="New quest" onAdd={add} />;
  const update = (patch: Partial<Quest>) => edit((draft) => Object.assign(draft.quests.find((entry) => entry.id === quest.id)!, patch));
  return <div className={styles.twoPane}><div className={styles.recordPane}><PaneHeader eyebrow="QUEST GRAPH" title="Quests" count={project.quests.length} onAdd={add} addLabel="Quest" /><div className={styles.records}>{project.quests.map((entry) => <button key={entry.id} className={entry.id === quest.id ? styles.selected : ""} onClick={() => setSelectedId(entry.id)}><b>{entry.title}</b><small>{entry.tasks.length} tasks · {entry.triggers.length} triggers</small><em>{entry.hidden ? "HIDDEN" : "VISIBLE"}</em></button>)}</div></div><div className={styles.detailPane}>
    <div className={styles.detailHead}><div><span>QUEST / {quest.id.toUpperCase()}</span><h2>{quest.title}</h2><p>{quest.summary || "No player-facing summary yet."}</p></div><div className={styles.statusPills}><label><input type="checkbox" checked={quest.hidden} onChange={(event) => update({ hidden: event.target.checked })} />Hidden</label><label><input type="checkbox" checked={quest.repeatable} onChange={(event) => update({ repeatable: event.target.checked })} />Repeatable</label></div></div>
    <div className={styles.formGrid}><Field label="Quest title"><TextInput value={quest.title} onChange={(title) => update({ title })} /></Field><Field label="Stable ID"><TextInput value={quest.id} onChange={(id) => update({ id })} /></Field><Field label="Quest giver"><select value={quest.giverNpcId} onChange={(event) => update({ giverNpcId: event.target.value })}><option value="">World / automatic</option>{project.npcs.map((npc) => <option value={npc.id} key={npc.id}>{npc.name}</option>)}</select></Field><Field label="Completion logic"><select value={quest.completionMode} onChange={(event) => update({ completionMode: event.target.value as Quest["completionMode"] })}><option value="all_required">All required tasks</option><option value="any_required">Any required task</option></select></Field><Field label="Player-facing summary" wide><textarea value={quest.summary} onChange={(event) => update({ summary: event.target.value })} /></Field></div>
    <QuestSection title="Start triggers" note="The quest becomes available when a trigger matches." add={() => edit((draft) => draft.quests.find((entry) => entry.id === quest.id)!.triggers.push({ id: idFrom("quest-trigger", "trigger"), type: "manual", targetId: "", operator: "is", value: "true" }))}>{quest.triggers.map((trigger) => <div className={styles.questRow} key={trigger.id}><select value={trigger.type} onChange={(event) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.triggers.find((entry) => entry.id === trigger.id)!.type = event.target.value as typeof trigger.type; })}><option>enter_cell</option><option>talk_to_npc</option><option>loot_object</option><option>world_flag</option><option>manual</option></select><TextInput value={trigger.targetId} onChange={(targetId) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.triggers.find((entry) => entry.id === trigger.id)!.targetId = targetId; })} placeholder="Target ID" /><select value={trigger.operator} onChange={(event) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.triggers.find((entry) => entry.id === trigger.id)!.operator = event.target.value as typeof trigger.operator; })}><option>is</option><option>is_not</option><option>at_least</option></select><TextInput value={trigger.value} onChange={(value) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.triggers.find((entry) => entry.id === trigger.id)!.value = value; })} /><button className={styles.delete} onClick={() => edit((draft) => { const item = draft.quests.find((entry) => entry.id === quest.id)!; item.triggers = item.triggers.filter((entry) => entry.id !== trigger.id); })}>×</button></div>)}</QuestSection>
    <QuestSection title="Sub-tasks" note="Required tasks feed the completion rule; optional tasks can grant bonus outcomes." add={() => edit((draft) => draft.quests.find((entry) => entry.id === quest.id)!.tasks.push({ id: idFrom("quest-task", "task"), title: "New objective", type: "visit", targetId: "", count: 1, optional: false }))}>{quest.tasks.map((task, index) => <div className={styles.taskRow} key={task.id}><b>{String(index + 1).padStart(2, "0")}</b><div><TextInput value={task.title} onChange={(title) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.tasks.find((entry) => entry.id === task.id)!.title = title; })} /><small><select value={task.type} onChange={(event) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.tasks.find((entry) => entry.id === task.id)!.type = event.target.value as typeof task.type; })}><option>visit</option><option>talk</option><option>kill</option><option>collect</option><option>interact</option><option>set_flag</option></select><TextInput value={task.targetId} onChange={(targetId) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.tasks.find((entry) => entry.id === task.id)!.targetId = targetId; })} placeholder="Target ID" /></small></div><NumberInput value={task.count} min={1} onChange={(count) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.tasks.find((entry) => entry.id === task.id)!.count = count; })} /><label><input type="checkbox" checked={task.optional} onChange={(event) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.tasks.find((entry) => entry.id === task.id)!.optional = event.target.checked; })} />Optional</label><button className={styles.delete} onClick={() => edit((draft) => { const item = draft.quests.find((entry) => entry.id === quest.id)!; item.tasks = item.tasks.filter((entry) => entry.id !== task.id); })}>×</button></div>)}</QuestSection>
    <div className={styles.requirement}><span>COMPLETION REQUIREMENTS</span><textarea value={quest.completionRequirements} onChange={(event) => update({ completionRequirements: event.target.value })} placeholder="Describe additional world-state requirements…" /></div>
    <QuestSection title="Rewards" note="Rewards apply once completion requirements pass." add={() => edit((draft) => draft.quests.find((entry) => entry.id === quest.id)!.rewards.push({ id: idFrom("quest-reward", "reward"), type: "xp", targetId: "player", amount: 10 }))}>{quest.rewards.map((reward) => <div className={styles.questRow} key={reward.id}><select value={reward.type} onChange={(event) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.rewards.find((entry) => entry.id === reward.id)!.type = event.target.value as typeof reward.type; })}><option>xp</option><option>chips</option><option>item</option><option>reputation</option><option>world_flag</option></select><TextInput value={reward.targetId} onChange={(targetId) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.rewards.find((entry) => entry.id === reward.id)!.targetId = targetId; })} placeholder="Target ID" /><NumberInput value={reward.amount} min={0} onChange={(amount) => edit((draft) => { draft.quests.find((entry) => entry.id === quest.id)!.rewards.find((entry) => entry.id === reward.id)!.amount = amount; })} /><span /><button className={styles.delete} onClick={() => edit((draft) => { const item = draft.quests.find((entry) => entry.id === quest.id)!; item.rewards = item.rewards.filter((entry) => entry.id !== reward.id); })}>×</button></div>)}</QuestSection>
  </div></div>;
}

function QuestSection({ title, note, add, children }: { title: string; note: string; add: () => void; children: React.ReactNode }) {
  return <section className={styles.questSection}><div><span>{title}</span><small>{note}</small><button onClick={add}>＋ Add</button></div>{children}</section>;
}

function FilesEditor({ mounted, branch }: { mounted: boolean; branch: string }) {
  const [files, setFiles] = useState<FileItem[]>([]); const [query, setQuery] = useState(""); const [selected, setSelected] = useState<{ path: string; content: string; sha: string; editable: boolean } | null>(null); const [content, setContent] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { if (!mounted) return; queueMicrotask(() => { setBusy(true); fetch("/api/editor/files", { cache: "no-store" }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setFiles(payload.files); }).catch((error) => setNotice(error.message)).finally(() => setBusy(false)); }); }, [mounted]);
  const filtered = useMemo(() => files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase())).slice(0, 500), [files, query]);
  const open = async (path: string) => { setBusy(true); setNotice(""); try { const response = await fetch(`/api/editor/files?path=${encodeURIComponent(path)}`, { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setSelected(payload); setContent(payload.content); } catch (error) { setNotice(error instanceof Error ? error.message : "File could not be opened."); } finally { setBusy(false); } };
  const save = async () => { if (!selected?.editable) return; setBusy(true); setNotice(""); try { const response = await fetch("/api/editor/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selected.path, content, sha: selected.sha }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setSelected({ ...selected, content, sha: payload.sha }); setNotice(`Published ${selected.path} to ${branch}.`); } catch (error) { setNotice(error instanceof Error ? error.message : "File publish failed."); } finally { setBusy(false); } };
  if (!mounted) return <Empty title="Repository mount offline" text="Configure the server-side GitHub repository and token to browse files on the testing branch." addLabel="Mount required" onAdd={() => {}} />;
  return <div className={styles.filesLayout}><div className={styles.fileTree}><PaneHeader eyebrow={`BRANCH / ${branch.toUpperCase()}`} title="Game files" count={files.length} /><input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter repository files…" /><div>{filtered.map((file) => <button key={file.path} className={selected?.path === file.path ? styles.selectedFile : ""} onClick={() => void open(file.path)}><b>{file.path.split("/").at(-1)}</b><small>{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "/"}</small><em>{file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}</em></button>)}</div></div><div className={styles.codePane}>{selected ? <><div className={styles.codeHead}><div><span>TESTING / {selected.path}</span><strong>{selected.editable ? "Editable text file" : "Read-only file"}</strong></div><button className={styles.publish} onClick={() => void save()} disabled={busy || !selected.editable || content === selected.content}>{busy ? "Working…" : "Publish file"}</button></div><textarea className={styles.codeEditor} spellCheck={false} value={content} readOnly={!selected.editable} onChange={(event) => setContent(event.target.value)} /></> : <div className={styles.fileWelcome}><b>{busy ? "…" : "{ }"}</b><h2>Select a game file</h2><p>Text source files can be edited and committed directly to <strong>{branch}</strong>. Binary assets are indexed but remain read-only.</p></div>}{notice && <div className={styles.fileNotice}>{notice}</div>}</div></div>;
}
