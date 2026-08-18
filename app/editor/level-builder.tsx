"use client";
/* eslint-disable @next/next/no-img-element -- authenticated repository sprites use the editor asset proxy */

import { useMemo, useRef, useState } from "react";
import styles from "./editor.module.css";
import type { Door, GameProject, Level, LevelLayer, LevelObject, SpriteAsset, WorldCell } from "./project-types";
import { WorldScene } from "../world/world-scene";

type Edit = (mutator: (draft: GameProject) => void) => void;
type Tool = "select" | "place" | "collision" | "cell" | "door" | "spawn" | "erase";
type Point = { x: number; y: number };
type DraftRect = Point & { width: number; height: number };
type BuilderMenu = { x: number; y: number } & (
  | { kind: "object"; objectId: string }
  | { kind: "cell"; cellId: string }
  | { kind: "door"; cellId: string; doorId: string }
  | { kind: "sprite"; spriteId: string }
  | { kind: "canvas"; point: Point }
);

function makeId(label: string, prefix: string) {
  const slug = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || prefix;
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`${styles.builderField} ${wide ? styles.builderWide : ""}`}><span>{label}</span>{children}</label>;
}

function spriteUrl(sprite: SpriteAsset) {
  return sprite.builtIn ? `/${sprite.path.replace(/^public\//, "")}` : `/api/editor/assets?path=${encodeURIComponent(sprite.path)}`;
}

function SpriteVisual({ sprite, alt }: { sprite: SpriteAsset; alt: string }) {
  const source = spriteUrl(sprite);
  if (!sprite.frame) return <img className={styles.spriteVisual} draggable={false} src={source} alt={alt} />;
  const { columns, rows, column, row } = sprite.frame;
  const x = columns <= 1 ? 0 : column / (columns - 1) * 100;
  const y = rows <= 1 ? 0 : row / (rows - 1) * 100;
  return <span className={styles.spriteVisual} role="img" aria-label={alt} style={{ backgroundImage: `url('${source}')`, backgroundSize: `${columns * 100}% ${rows * 100}%`, backgroundPosition: `${x}% ${y}%` }} />;
}

function defaultLayers(levelId: string): LevelLayer[] {
  return [
    { id: makeId(`${levelId}-terrain`, "layer"), levelId, name: "Terrain", kind: "terrain", visible: true, locked: false, opacity: 1 },
    { id: makeId(`${levelId}-objects`, "layer"), levelId, name: "Objects", kind: "objects", visible: true, locked: false, opacity: 1 },
    { id: makeId(`${levelId}-collision`, "layer"), levelId, name: "Collision", kind: "collision", visible: true, locked: false, opacity: 0.65 },
    { id: makeId(`${levelId}-entities`, "layer"), levelId, name: "Entities", kind: "entities", visible: true, locked: false, opacity: 1 },
  ];
}

function emptyCollision(enabled = false) {
  return { enabled, shape: "rectangle" as const, solid: enabled, trigger: false, tag: "" };
}

export function LevelBuilder({ project, edit, setNotice }: { project: GameProject; edit: Edit; setNotice: (notice: { tone: "ok" | "warn" | "bad"; text: string } | null) => void }) {
  const [levelId, setLevelId] = useState(project.levels[0]?.id || "");
  const level = project.levels.find((entry) => entry.id === levelId) || project.levels[0];
  const layers = useMemo(() => project.levelLayers.filter((entry) => entry.levelId === level?.id), [project.levelLayers, level?.id]);
  const [layerId, setLayerId] = useState(layers[0]?.id || "");
  const activeLayer = layers.find((entry) => entry.id === layerId) || layers[0];
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [selectedCellId, setSelectedCellId] = useState("");
  const [spriteId, setSpriteId] = useState(project.spriteAssets[0]?.id || "");
  const [assetQuery, setAssetQuery] = useState("");
  const [assetCategory, setAssetCategory] = useState<"all" | SpriteAsset["category"]>("all");
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
  const [drag, setDrag] = useState<{ kind: "draw" | "move"; start: Point; origin?: Point } | null>(null);
  const [importing, setImporting] = useState(false);
  const [contextMenu, setContextMenu] = useState<BuilderMenu | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const visibleSprites = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    return project.spriteAssets.filter((sprite) => (assetCategory === "all" || sprite.category === assetCategory) && (!query || `${sprite.name} ${sprite.tags.join(" ")}`.toLowerCase().includes(query)));
  }, [assetCategory, assetQuery, project.spriteAssets]);

  if (!level) return <div className={styles.builderEmpty}><b>＋</b><h2>Create the first level</h2><p>Start with a canvas, then draw cells, import sprites, and place collision-ready objects.</p><button onClick={() => {
    const id = makeId("new-level", "level");
    edit((draft) => { draft.levels.push({ id, name: "Untitled level", region: "New region", description: "", environment: "", width: 100, height: 100, gridSize: 5, playerSpawn: { x: 50, y: 50 } }); draft.levelLayers.push(...defaultLayers(id)); });
    setLevelId(id);
  }}>Create level</button></div>;

  const objects = project.levelObjects.filter((entry) => entry.levelId === level.id);
  const cells = project.cells.filter((entry) => entry.levelId === level.id);
  const selectedObject = objects.find((entry) => entry.id === selectedObjectId);
  const selectedCell = cells.find((entry) => entry.id === selectedCellId);
  const selectedSprite = project.spriteAssets.find((entry) => entry.id === spriteId);
  const unitPoint = (event: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    let x = clamp((event.clientX - rect.left) / rect.width * level.width, 0, level.width);
    let y = clamp((event.clientY - rect.top) / rect.height * level.height, 0, level.height);
    if (snap) { x = Math.round(x / level.gridSize) * level.gridSize; y = Math.round(y / level.gridSize) * level.gridSize; }
    return { x, y };
  };

  const updateLevel = (patch: Partial<Level>) => edit((draft) => Object.assign(draft.levels.find((entry) => entry.id === level.id)!, patch));
  const updateLayer = (id: string, patch: Partial<LevelLayer>) => edit((draft) => Object.assign(draft.levelLayers.find((entry) => entry.id === id)!, patch));
  const updateObject = (id: string, patch: Partial<LevelObject>) => edit((draft) => Object.assign(draft.levelObjects.find((entry) => entry.id === id)!, patch));
  const updateCell = (id: string, patch: Partial<WorldCell>) => edit((draft) => Object.assign(draft.cells.find((entry) => entry.id === id)!, patch));
  const duplicateObject = (object: LevelObject) => {
    const copy = { ...structuredClone(object), id: makeId(object.name, "object"), name: `${object.name} copy`, x: object.x + level.gridSize, y: object.y + level.gridSize };
    edit((draft) => draft.levelObjects.push(copy)); setSelectedObjectId(copy.id);
  };
  const duplicateCell = (cell: WorldCell) => {
    const copy = { ...structuredClone(cell), id: makeId(cell.name, "cell"), name: `${cell.name} copy`, x: cell.x + level.gridSize, y: cell.y + level.gridSize, doors: cell.doors.map((door) => ({ ...door, id: makeId(door.name, "door") })) };
    edit((draft) => draft.cells.push(copy)); setSelectedCellId(copy.id);
  };
  const menuAt = (event: React.MouseEvent, menu: Omit<BuilderMenu, "x" | "y">) => {
    event.preventDefault(); event.stopPropagation();
    setContextMenu({ ...menu, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 260) } as BuilderMenu);
  };

  const onCanvasDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setContextMenu(null);
    const point = unitPoint(event);
    if (tool === "spawn") { updateLevel({ playerSpawn: point }); return; }
    if (tool === "door") {
      const host = selectedCell || cells.find((cell) => point.x >= cell.x && point.x <= cell.x + cell.width && point.y >= cell.y && point.y <= cell.y + cell.height);
      if (!host) { setNotice({ tone: "warn", text: "Select a cell, or click inside one, before placing a door." }); return; }
      const door: Door = { id: makeId("door", "door"), name: "New door", edge: "interior", targetLevelId: level.id, targetCellId: "", loadMode: "transition", locked: false, keyId: "", x: point.x, y: point.y, width: level.gridSize, height: level.gridSize };
      edit((draft) => draft.cells.find((entry) => entry.id === host.id)!.doors.push(door));
      setSelectedCellId(host.id); setNotice({ tone: "ok", text: `Door added to ${host.name}. Configure its destination in the inspector.` }); return;
    }
    if (tool === "erase") return;
    if (["place", "collision", "cell"].includes(tool)) {
      if ((tool === "place" || tool === "collision") && (!activeLayer || activeLayer.locked)) { setNotice({ tone: "warn", text: "Choose an unlocked layer before drawing." }); return; }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setDrag({ kind: "draw", start: point }); setDraftRect({ ...point, width: 0, height: 0 });
    }
  };

  const onCanvasMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const point = unitPoint(event);
    if (drag.kind === "draw") {
      setDraftRect({ x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y), width: Math.abs(point.x - drag.start.x), height: Math.abs(point.y - drag.start.y) });
    } else if (selectedObject && drag.origin) {
      updateObject(selectedObject.id, { x: clamp(drag.origin.x + point.x - drag.start.x, 0, level.width - selectedObject.width), y: clamp(drag.origin.y + point.y - drag.start.y, 0, level.height - selectedObject.height) });
    }
  };

  const onCanvasUp = () => {
    if (drag?.kind === "draw" && draftRect) {
      const width = Math.max(level.gridSize, draftRect.width);
      const height = Math.max(level.gridSize, draftRect.height);
      if (tool === "cell") {
        const id = makeId("cell", "cell");
        edit((draft) => draft.cells.push({ id, levelId: level.id, name: "New cell", kind: "exterior", x: draftRect.x, y: draftRect.y, width, height, ambience: "", notes: "", doors: [] }));
        setSelectedCellId(id); setSelectedObjectId("");
      } else {
        const id = makeId(tool === "collision" ? "collision" : selectedSprite?.name || "object", "object");
        const object: LevelObject = { id, levelId: level.id, layerId: activeLayer.id, name: tool === "collision" ? "Collision volume" : selectedSprite?.name || "New object", spriteId: tool === "collision" ? "" : selectedSprite?.id || "", x: draftRect.x, y: draftRect.y, width, height, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, tint: "#ffffff", collision: emptyCollision(tool === "collision") };
        edit((draft) => draft.levelObjects.push(object)); setSelectedObjectId(id); setSelectedCellId("");
      }
    }
    setDrag(null); setDraftRect(null);
  };

  const beginMove = (event: React.PointerEvent, object: LevelObject) => {
    event.stopPropagation();
    if (tool === "erase") { edit((draft) => { draft.levelObjects = draft.levelObjects.filter((entry) => entry.id !== object.id); }); setSelectedObjectId(""); return; }
    if (tool !== "select") { setSelectedObjectId(object.id); return; }
    const layer = layers.find((entry) => entry.id === object.layerId);
    setSelectedObjectId(object.id); setSelectedCellId("");
    if (layer?.locked) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ kind: "move", start: unitPoint(event), origin: { x: object.x, y: object.y } });
  };

  const importSprite = async (file: File) => {
    setImporting(true); setNotice(null);
    try {
      const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(new Error("Could not read that image.")); reader.readAsDataURL(file); });
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("That image could not be decoded.")); image.src = URL.createObjectURL(file); });
      const response = await fetch("/api/editor/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, content }) });
      const payload = await response.json() as { path?: string; error?: string };
      if (!response.ok || !payload.path) throw new Error(payload.error || "Sprite import failed.");
      const id = makeId(file.name.replace(/\.[^.]+$/, ""), "sprite");
      const asset: SpriteAsset = { id, name: file.name.replace(/\.[^.]+$/, ""), path: payload.path, width: dimensions.width, height: dimensions.height, category: "prop", tags: [] };
      edit((draft) => draft.spriteAssets.push(asset)); setSpriteId(id); setTool("place");
      setNotice({ tone: "ok", text: `${file.name} was added to the testing branch. Publish the project to register it in this level library.` });
    } catch (error) { setNotice({ tone: "bad", text: error instanceof Error ? error.message : "Sprite import failed." }); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const addLevel = () => { const id = makeId("new-level", "level"); edit((draft) => { draft.levels.push({ id, name: "Untitled level", region: "New region", description: "", environment: "", width: 100, height: 100, gridSize: 5, playerSpawn: { x: 50, y: 50 } }); draft.levelLayers.push(...defaultLayers(id)); }); setLevelId(id); setSelectedObjectId(""); };
  const addLayer = () => { const layer: LevelLayer = { id: makeId("new-layer", "layer"), levelId: level.id, name: "New layer", kind: "objects", visible: true, locked: false, opacity: 1 }; edit((draft) => draft.levelLayers.push(layer)); setLayerId(layer.id); };

  return <div className={styles.builder} onClick={() => setContextMenu(null)}>
    <div className={styles.builderBar}>
      <div className={styles.builderTitle}><span>LEVEL BUILDER</span><select value={level.id} onChange={(event) => { setLevelId(event.target.value); setLayerId(""); setSelectedObjectId(""); setSelectedCellId(""); }}>{project.levels.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select><button onClick={addLevel}>＋ Level</button></div>
      <div className={styles.toolGroup}>{([ ["select", "↖", "Select / move"], ["place", "▧", "Place sprite"], ["cell", "▦", "Draw cell"], ["collision", "▨", "Collision volume"], ["door", "⇥", "Place door"], ["spawn", "◆", "Player spawn"], ["erase", "⌫", "Erase"] ] as Array<[Tool, string, string]>).map(([id, icon, label]) => <button key={id} title={label} aria-label={label} className={tool === id ? styles.toolActive : ""} onClick={() => setTool(id)}><b>{icon}</b><span>{label}</span></button>)}</div>
      <div className={styles.viewTools}><label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> SNAP {level.gridSize}</label><button onClick={() => setZoom((value) => clamp(value - .25, .25, 2))}>−</button><strong>{Math.round(zoom * 100)}%</strong><button onClick={() => setZoom((value) => clamp(value + .25, .25, 2))}>＋</button><button onClick={() => setZoom(1)}>FIT</button></div>
    </div>
    <aside className={styles.builderLeft}>
      <section><div className={styles.builderSectionHead}><span>LAYERS</span><button onClick={addLayer}>＋</button></div><div className={styles.layerList}>{[...layers].reverse().map((layer) => <div key={layer.id} className={activeLayer?.id === layer.id ? styles.layerActive : ""}><button aria-label={layer.visible ? "Hide layer" : "Show layer"} onClick={() => updateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? "◉" : "○"}</button><button className={styles.layerPick} onClick={() => setLayerId(layer.id)}><b>{layer.name}</b><small>{layer.kind}</small></button><button aria-label={layer.locked ? "Unlock layer" : "Lock layer"} onClick={() => updateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? "▣" : "□"}</button></div>)}</div></section>
      <section className={styles.spriteLibrary}><div className={styles.builderSectionHead}><span>SPRITE LIBRARY</span><button onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? "…" : "IMPORT"}</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importSprite(file); }} /></div>
        <div className={styles.assetFilters}><input aria-label="Search sprites" placeholder={`Search ${project.spriteAssets.length} sprites…`} value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} /><select aria-label="Sprite category" value={assetCategory} onChange={(event) => setAssetCategory(event.target.value as typeof assetCategory)}><option value="all">All art</option><option value="terrain">Terrain</option><option value="structure">Structures</option><option value="prop">Props</option><option value="character">Characters</option><option value="effect">Materials / FX</option></select></div>
        {visibleSprites.length === 0 ? <div className={styles.spriteEmpty}><b>▧</b><p>No art matches this filter. Import another sprite or change the search.</p></div> : <div className={styles.spriteGrid}>{visibleSprites.map((sprite) => <button key={sprite.id} className={sprite.id === spriteId ? styles.spriteActive : ""} onClick={(event) => { event.stopPropagation(); setSpriteId(sprite.id); setTool("place"); }} onContextMenu={(event) => menuAt(event, { kind: "sprite", spriteId: sprite.id })}><SpriteVisual sprite={sprite} alt={sprite.name} /><span>{sprite.name}</span><small>{sprite.category} · {sprite.frame ? "atlas frame" : `${sprite.width}×${sprite.height}`}</small></button>)}</div>}
      </section>
      <section><div className={styles.builderSectionHead}><span>CELLS</span><b>{cells.length}</b></div><div className={styles.cellList}>{cells.map((cell) => <button key={cell.id} className={cell.id === selectedCellId ? styles.layerActive : ""} onClick={(event) => { event.stopPropagation(); setSelectedCellId(cell.id); setSelectedObjectId(""); }} onContextMenu={(event) => menuAt(event, { kind: "cell", cellId: cell.id })}><b>{cell.name}</b><small>{cell.kind} · {cell.doors.length} doors</small></button>)}</div></section>
    </aside>
    <div className={styles.builderViewport}>
      <div className={styles.canvasRulers}><span>{level.region} / {level.name}</span><b>{level.width} × {level.height} UNITS</b></div>
      <div className={styles.canvasScroll}><div ref={canvasRef} className={styles.builderCanvas} style={{ width: `${zoom * 100}%`, aspectRatio: `${level.width}/${level.height}`, backgroundSize: `${level.gridSize / level.width * 100}% ${level.gridSize / level.height * 100}%` }} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerCancel={onCanvasUp} onContextMenu={(event) => menuAt(event, { kind: "canvas", point: unitPoint(event as unknown as React.PointerEvent) })}>
        <WorldScene project={project} levelId={level.id} assetEndpoint="/api/editor/assets" selectedObjectId={selectedObjectId} showCollision onObjectPointerDown={beginMove} onObjectContextMenu={(event, object) => menuAt(event, { kind: "object", objectId: object.id })} onDoorClick={(event, cell) => { event.stopPropagation(); setSelectedCellId(cell.id); setSelectedObjectId(""); }} onDoorContextMenu={(event, cell, door) => menuAt(event, { kind: "door", cellId: cell.id, doorId: door.id })} />
        {cells.map((cell) => <button key={cell.id} className={`${styles.builderCell} ${cell.id === selectedCellId ? styles.builderCellSelected : ""}`} style={{ left: `${cell.x / level.width * 100}%`, top: `${cell.y / level.height * 100}%`, width: `${cell.width / level.width * 100}%`, height: `${cell.height / level.height * 100}%` }} onPointerDown={(event) => { event.stopPropagation(); setSelectedCellId(cell.id); setSelectedObjectId(""); if (tool === "erase") edit((draft) => { draft.cells = draft.cells.filter((entry) => entry.id !== cell.id); }); }} onContextMenu={(event) => menuAt(event, { kind: "cell", cellId: cell.id })}><span>{cell.name}</span></button>)}
        <i className={styles.builderSpawn} style={{ left: `${level.playerSpawn.x / level.width * 100}%`, top: `${level.playerSpawn.y / level.height * 100}%` }}>◆</i>
        {draftRect && <i className={styles.drawPreview} style={{ left: `${draftRect.x / level.width * 100}%`, top: `${draftRect.y / level.height * 100}%`, width: `${draftRect.width / level.width * 100}%`, height: `${draftRect.height / level.height * 100}%` }} />}
      </div></div>
      <div className={styles.builderStatus}><span>TOOL <b>{tool.toUpperCase()}</b></span><span>LAYER <b>{activeLayer?.name || "NONE"}</b></span><span>{objects.length} OBJECTS · {cells.length} CELLS · {cells.reduce((sum, cell) => sum + cell.doors.length, 0)} DOORS</span></div>
    </div>
    <aside className={styles.builderInspector}>
      <div className={styles.builderSectionHead}><span>INSPECTOR</span><b>{selectedObject ? "OBJECT" : selectedCell ? "CELL" : activeLayer ? "LAYER" : "LEVEL"}</b></div>
      {selectedObject ? <ObjectInspector object={selectedObject} layers={layers} sprites={project.spriteAssets} update={(patch) => updateObject(selectedObject.id, patch)} duplicate={() => duplicateObject(selectedObject)} remove={() => { edit((draft) => { draft.levelObjects = draft.levelObjects.filter((entry) => entry.id !== selectedObject.id); }); setSelectedObjectId(""); }} /> : selectedCell ? <CellBuilderInspector cell={selectedCell} project={project} update={(patch) => updateCell(selectedCell.id, patch)} edit={edit} /> : activeLayer ? <LayerInspector layer={activeLayer} update={(patch) => updateLayer(activeLayer.id, patch)} remove={() => { if (layers.length <= 1) return; edit((draft) => { draft.levelObjects = draft.levelObjects.filter((entry) => entry.layerId !== activeLayer.id); draft.levelLayers = draft.levelLayers.filter((entry) => entry.id !== activeLayer.id); }); setLayerId(""); }} /> : <LevelInspector level={level} update={updateLevel} />}
    </aside>
    {contextMenu && <BuilderContextMenu menu={contextMenu} project={project} level={level} onClose={() => setContextMenu(null)} actions={{ selectObject: (id) => { setSelectedObjectId(id); setSelectedCellId(""); }, duplicateObject: (id) => { const object = objects.find((entry) => entry.id === id); if (object) duplicateObject(object); }, toggleCollision: (id) => { const object = objects.find((entry) => entry.id === id); if (object) updateObject(id, { collision: { ...object.collision, enabled: !object.collision.enabled, solid: !object.collision.enabled || object.collision.solid } }); }, deleteObject: (id) => edit((draft) => { draft.levelObjects = draft.levelObjects.filter((entry) => entry.id !== id); }), selectCell: (id) => { setSelectedCellId(id); setSelectedObjectId(""); }, duplicateCell: (id) => { const cell = cells.find((entry) => entry.id === id); if (cell) duplicateCell(cell); }, addDoor: (id) => edit((draft) => draft.cells.find((entry) => entry.id === id)?.doors.push({ id: makeId("door", "door"), name: "New door", edge: "interior", targetLevelId: level.id, targetCellId: "", loadMode: "transition", locked: false, keyId: "" })), deleteCell: (id) => edit((draft) => { draft.cells = draft.cells.filter((entry) => entry.id !== id); }), toggleDoor: (cellId, doorId) => edit((draft) => { const door = draft.cells.find((entry) => entry.id === cellId)?.doors.find((entry) => entry.id === doorId); if (door) door.locked = !door.locked; }), duplicateDoor: (cellId, doorId) => edit((draft) => { const cell = draft.cells.find((entry) => entry.id === cellId); const door = cell?.doors.find((entry) => entry.id === doorId); if (cell && door) cell.doors.push({ ...structuredClone(door), id: makeId(door.name, "door"), name: `${door.name} copy` }); }), deleteDoor: (cellId, doorId) => edit((draft) => { const cell = draft.cells.find((entry) => entry.id === cellId); if (cell) cell.doors = cell.doors.filter((entry) => entry.id !== doorId); }), chooseSprite: (id) => { setSpriteId(id); setTool("place"); }, canvasTool: (next) => setTool(next), setSpawn: (point) => updateLevel({ playerSpawn: point }) }} />}
  </div>;
}

function BuilderContextMenu({ menu, project, level, actions, onClose }: { menu: BuilderMenu; project: GameProject; level: Level; onClose: () => void; actions: { selectObject: (id: string) => void; duplicateObject: (id: string) => void; toggleCollision: (id: string) => void; deleteObject: (id: string) => void; selectCell: (id: string) => void; duplicateCell: (id: string) => void; addDoor: (id: string) => void; deleteCell: (id: string) => void; toggleDoor: (cellId: string, doorId: string) => void; duplicateDoor: (cellId: string, doorId: string) => void; deleteDoor: (cellId: string, doorId: string) => void; chooseSprite: (id: string) => void; canvasTool: (tool: Tool) => void; setSpawn: (point: Point) => void } }) {
  const run = (action: () => void) => { action(); onClose(); };
  const object = menu.kind === "object" ? project.levelObjects.find((entry) => entry.id === menu.objectId) : undefined;
  const cell = "cellId" in menu ? project.cells.find((entry) => entry.id === menu.cellId) : undefined;
  const door = menu.kind === "door" ? cell?.doors.find((entry) => entry.id === menu.doorId) : undefined;
  const sprite = menu.kind === "sprite" ? project.spriteAssets.find((entry) => entry.id === menu.spriteId) : undefined;
  return <div className={styles.builderContextMenu} style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}><header><small>{menu.kind.toUpperCase()}</small><strong>{object?.name || door?.name || cell?.name || sprite?.name || level.name}</strong></header>
    {object && <><button onClick={() => run(() => actions.selectObject(object.id))}>⌖ <span>Edit object</span></button><button onClick={() => run(() => actions.duplicateObject(object.id))}>▣ <span>Duplicate</span></button><button onClick={() => run(() => actions.toggleCollision(object.id))}>▨ <span>{object.collision.enabled ? "Disable" : "Enable"} collision</span></button><button className={styles.contextDanger} onClick={() => run(() => actions.deleteObject(object.id))}>⌫ <span>Delete object</span></button></>}
    {menu.kind === "cell" && cell && <><button onClick={() => run(() => actions.selectCell(cell.id))}>⌖ <span>Edit cell</span></button><button onClick={() => run(() => actions.duplicateCell(cell.id))}>▣ <span>Duplicate cell</span></button><button onClick={() => run(() => actions.addDoor(cell.id))}>⇥ <span>Add door</span></button><button className={styles.contextDanger} onClick={() => run(() => actions.deleteCell(cell.id))}>⌫ <span>Delete cell</span></button></>}
    {door && cell && <><button onClick={() => run(() => actions.selectCell(cell.id))}>⌖ <span>Edit door</span></button><button onClick={() => run(() => actions.duplicateDoor(cell.id, door.id))}>▣ <span>Duplicate door</span></button><button onClick={() => run(() => actions.toggleDoor(cell.id, door.id))}>⌁ <span>{door.locked ? "Unlock" : "Lock"} door</span></button><button className={styles.contextDanger} onClick={() => run(() => actions.deleteDoor(cell.id, door.id))}>⌫ <span>Delete door</span></button></>}
    {sprite && <><button onClick={() => run(() => actions.chooseSprite(sprite.id))}>▧ <span>Place this sprite</span></button><button onClick={() => run(() => navigator.clipboard?.writeText(sprite.path))}>{"{}"} <span>Copy asset path</span></button></>}
    {menu.kind === "canvas" && <><button onClick={() => run(() => actions.canvasTool("place"))}>▧ <span>Place selected sprite</span></button><button onClick={() => run(() => actions.canvasTool("cell"))}>▦ <span>Draw cell</span></button><button onClick={() => run(() => actions.canvasTool("collision"))}>▨ <span>Draw collision</span></button><button onClick={() => run(() => actions.setSpawn(menu.point))}>◆ <span>Set player spawn here</span></button></>}
  </div>;
}

function ObjectInspector({ object, layers, sprites, update, duplicate, remove }: { object: LevelObject; layers: LevelLayer[]; sprites: SpriteAsset[]; update: (patch: Partial<LevelObject>) => void; duplicate: () => void; remove: () => void }) {
  return <div className={styles.builderForm}><Field label="Name" wide><input value={object.name} onChange={(event) => update({ name: event.target.value })} /></Field><Field label="Sprite" wide><select value={object.spriteId} onChange={(event) => update({ spriteId: event.target.value })}><option value="">No sprite / volume</option>{sprites.map((sprite) => <option key={sprite.id} value={sprite.id}>{sprite.name}</option>)}</select></Field><Field label="Layer" wide><select value={object.layerId} onChange={(event) => update({ layerId: event.target.value })}>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></Field>
    <Field label="X"><input type="number" value={object.x} onChange={(event) => update({ x: Number(event.target.value) })} /></Field><Field label="Y"><input type="number" value={object.y} onChange={(event) => update({ y: Number(event.target.value) })} /></Field><Field label="Width"><input type="number" min="1" value={object.width} onChange={(event) => update({ width: Number(event.target.value) })} /></Field><Field label="Height"><input type="number" min="1" value={object.height} onChange={(event) => update({ height: Number(event.target.value) })} /></Field><Field label="Scale X"><input type="number" step="0.1" value={object.scaleX} onChange={(event) => update({ scaleX: Number(event.target.value) })} /></Field><Field label="Scale Y"><input type="number" step="0.1" value={object.scaleY} onChange={(event) => update({ scaleY: Number(event.target.value) })} /></Field><Field label="Rotation"><input type="number" value={object.rotation} onChange={(event) => update({ rotation: Number(event.target.value) })} /></Field><Field label="Tint"><input type="color" value={object.tint} onChange={(event) => update({ tint: event.target.value })} /></Field>
    <div className={styles.builderChecks}><label><input type="checkbox" checked={object.flipX} onChange={(event) => update({ flipX: event.target.checked })} /> Flip X</label><label><input type="checkbox" checked={object.flipY} onChange={(event) => update({ flipY: event.target.checked })} /> Flip Y</label></div>
    <div className={styles.inspectorDivider}>COLLISION</div><div className={styles.builderChecks}><label><input type="checkbox" checked={object.collision.enabled} onChange={(event) => update({ collision: { ...object.collision, enabled: event.target.checked } })} /> Enabled</label><label><input type="checkbox" checked={object.collision.solid} onChange={(event) => update({ collision: { ...object.collision, solid: event.target.checked } })} /> Solid</label><label><input type="checkbox" checked={object.collision.trigger} onChange={(event) => update({ collision: { ...object.collision, trigger: event.target.checked } })} /> Trigger</label></div><Field label="Shape"><select value={object.collision.shape} onChange={(event) => update({ collision: { ...object.collision, shape: event.target.value as "rectangle" | "circle" } })}><option value="rectangle">Rectangle</option><option value="circle">Circle</option></select></Field><Field label="Tag"><input value={object.collision.tag} placeholder="wall, damage, quest…" onChange={(event) => update({ collision: { ...object.collision, tag: event.target.value } })} /></Field>
    <div className={styles.inspectorActions}><button onClick={duplicate}>Duplicate</button><button className={styles.dangerButton} onClick={remove}>Delete</button></div></div>;
}

function LayerInspector({ layer, update, remove }: { layer: LevelLayer; update: (patch: Partial<LevelLayer>) => void; remove: () => void }) {
  return <div className={styles.builderForm}><Field label="Layer name" wide><input value={layer.name} onChange={(event) => update({ name: event.target.value })} /></Field><Field label="Type" wide><select value={layer.kind} onChange={(event) => update({ kind: event.target.value as LevelLayer["kind"] })}><option>terrain</option><option>objects</option><option>collision</option><option>entities</option><option>lighting</option></select></Field><Field label="Opacity" wide><input type="range" min="0" max="1" step="0.05" value={layer.opacity} onChange={(event) => update({ opacity: Number(event.target.value) })} /></Field><div className={styles.builderChecks}><label><input type="checkbox" checked={layer.visible} onChange={(event) => update({ visible: event.target.checked })} /> Visible</label><label><input type="checkbox" checked={layer.locked} onChange={(event) => update({ locked: event.target.checked })} /> Locked</label></div><div className={styles.inspectorActions}><button className={styles.dangerButton} onClick={remove}>Delete layer + objects</button></div></div>;
}

function LevelInspector({ level, update }: { level: Level; update: (patch: Partial<Level>) => void }) {
  return <div className={styles.builderForm}><Field label="Level name" wide><input value={level.name} onChange={(event) => update({ name: event.target.value })} /></Field><Field label="Region" wide><input value={level.region} onChange={(event) => update({ region: event.target.value })} /></Field><Field label="Environment" wide><input value={level.environment} onChange={(event) => update({ environment: event.target.value })} /></Field><Field label="Width"><input type="number" min="10" value={level.width} onChange={(event) => update({ width: Number(event.target.value) })} /></Field><Field label="Height"><input type="number" min="10" value={level.height} onChange={(event) => update({ height: Number(event.target.value) })} /></Field><Field label="Grid"><input type="number" min="1" value={level.gridSize} onChange={(event) => update({ gridSize: Number(event.target.value) })} /></Field><Field label="Description" wide><textarea value={level.description} onChange={(event) => update({ description: event.target.value })} /></Field></div>;
}

function CellBuilderInspector({ cell, project, update, edit }: { cell: WorldCell; project: GameProject; update: (patch: Partial<WorldCell>) => void; edit: Edit }) {
  const updateDoor = (doorId: string, patch: Partial<Door>) => edit((draft) => Object.assign(draft.cells.find((entry) => entry.id === cell.id)!.doors.find((entry) => entry.id === doorId)!, patch));
  return <div className={styles.builderForm}><Field label="Cell name" wide><input value={cell.name} onChange={(event) => update({ name: event.target.value })} /></Field><Field label="Type" wide><select value={cell.kind} onChange={(event) => update({ kind: event.target.value as WorldCell["kind"] })}><option>exterior</option><option>interior</option><option>dungeon</option><option>encounter</option></select></Field><Field label="X"><input type="number" value={cell.x} onChange={(event) => update({ x: Number(event.target.value) })} /></Field><Field label="Y"><input type="number" value={cell.y} onChange={(event) => update({ y: Number(event.target.value) })} /></Field><Field label="Width"><input type="number" value={cell.width} onChange={(event) => update({ width: Number(event.target.value) })} /></Field><Field label="Height"><input type="number" value={cell.height} onChange={(event) => update({ height: Number(event.target.value) })} /></Field><Field label="Ambience" wide><input value={cell.ambience} onChange={(event) => update({ ambience: event.target.value })} /></Field><Field label="Notes" wide><textarea value={cell.notes} onChange={(event) => update({ notes: event.target.value })} /></Field>
    <div className={styles.inspectorDivider}>DOORS · {cell.doors.length}</div>{cell.doors.map((door) => <div className={styles.doorCard} key={door.id}><input value={door.name} onChange={(event) => updateDoor(door.id, { name: event.target.value })} /><select value={door.targetLevelId} onChange={(event) => updateDoor(door.id, { targetLevelId: event.target.value, targetCellId: "" })}>{project.levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}</select><select value={door.targetCellId} onChange={(event) => updateDoor(door.id, { targetCellId: event.target.value })}><option value="">Unassigned destination</option>{project.cells.filter((entry) => entry.levelId === door.targetLevelId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><select value={door.loadMode} onChange={(event) => updateDoor(door.id, { loadMode: event.target.value as Door["loadMode"] })}><option>stream</option><option>transition</option><option>locked</option></select><label><input type="checkbox" checked={door.locked} onChange={(event) => updateDoor(door.id, { locked: event.target.checked })} /> Starts locked</label><button className={styles.dangerButton} onClick={() => edit((draft) => { const target = draft.cells.find((entry) => entry.id === cell.id)!; target.doors = target.doors.filter((entry) => entry.id !== door.id); })}>Delete door</button></div>)}</div>;
}
