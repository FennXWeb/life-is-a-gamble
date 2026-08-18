"use client";

import type { PointerEvent, MouseEvent } from "react";
import type { Door, GameProject, LevelObject, SpriteAsset, WorldCell } from "../editor/project-types";
import styles from "./world-scene.module.css";

function spriteUrl(sprite: SpriteAsset, assetEndpoint: string) {
  return sprite.builtIn ? `/${sprite.path.replace(/^public\//, "")}` : `${assetEndpoint}?path=${encodeURIComponent(sprite.path)}`;
}

function SpriteVisual({ sprite, assetEndpoint }: { sprite: SpriteAsset; assetEndpoint: string }) {
  const source = spriteUrl(sprite, assetEndpoint);
  if (!sprite.frame) return <img draggable={false} src={source} alt="" />;
  const { columns, rows, column, row } = sprite.frame;
  return <span className={styles.frame} style={{ backgroundImage: `url('${source}')`, backgroundSize: `${columns * 100}% ${rows * 100}%`, backgroundPosition: `${columns <= 1 ? 0 : column / (columns - 1) * 100}% ${rows <= 1 ? 0 : row / (rows - 1) * 100}%` }} />;
}

export function WorldScene({ project, levelId, assetEndpoint = "/api/game/assets", hideObjectIds = [], selectedObjectId, showCollision = false, showDoors = true, onObjectPointerDown, onObjectContextMenu, onDoorClick, onDoorContextMenu }: {
  project: GameProject;
  levelId: string;
  assetEndpoint?: string;
  hideObjectIds?: string[];
  selectedObjectId?: string;
  showCollision?: boolean;
  onObjectPointerDown?: (event: PointerEvent<HTMLButtonElement>, object: LevelObject) => void;
  onObjectContextMenu?: (event: MouseEvent<HTMLButtonElement>, object: LevelObject, sprite?: SpriteAsset) => void;
  showDoors?: boolean;
  onDoorClick?: (event: MouseEvent<HTMLButtonElement>, cell: WorldCell, door: Door) => void;
  onDoorContextMenu?: (event: MouseEvent<HTMLButtonElement>, cell: WorldCell, door: Door) => void;
}) {
  const level = project.levels.find((entry) => entry.id === levelId);
  if (!level) return null;
  const hidden = new Set(hideObjectIds);
  const objects = project.levelObjects.filter((entry) => entry.levelId === levelId && !hidden.has(entry.id));
  const layers = project.levelLayers.filter((entry) => entry.levelId === levelId && entry.visible);
  return <div className={styles.world} aria-label={`${level.name} authored world`}>
    <div className={styles.ground}><i className={styles.roadHorizontal} /><i className={styles.roadVertical} /><i className={styles.plaza} /></div>
    {layers.flatMap((layer, layerIndex) => objects.filter((object) => object.layerId === layer.id).map((object) => {
      const sprite = project.spriteAssets.find((asset) => asset.id === object.spriteId);
      const collisionOnly = !sprite && object.collision.enabled;
      if (collisionOnly && !showCollision) return null;
      return <button key={object.id} type="button" aria-label={object.name} data-world-object={object.id} data-sprite-category={sprite?.category} className={`${styles.object} ${selectedObjectId === object.id ? styles.selected : ""} ${collisionOnly ? styles.collision : ""}`} style={{ left: `${object.x / level.width * 100}%`, top: `${object.y / level.height * 100}%`, width: `${object.width / level.width * 100}%`, height: `${object.height / level.height * 100}%`, opacity: layer.opacity, zIndex: 10 + layerIndex, transform: `rotate(${object.rotation}deg) scale(${object.flipX ? -object.scaleX : object.scaleX}, ${object.flipY ? -object.scaleY : object.scaleY})`, backgroundColor: sprite ? "transparent" : object.tint }} onPointerDown={(event) => onObjectPointerDown?.(event, object)} onContextMenu={(event) => onObjectContextMenu?.(event, object, sprite)}>{sprite ? <SpriteVisual sprite={sprite} assetEndpoint={assetEndpoint} /> : <span>{object.collision.enabled ? "COLLISION" : object.name}</span>}</button>;
    }))}
    {showDoors && project.cells.filter((cell) => cell.levelId === levelId).flatMap((cell) => cell.doors.filter((door) => door.x !== undefined && door.y !== undefined).map((door) => <button key={`${cell.id}-${door.id}`} type="button" className={styles.door} aria-label={door.name} title={`${door.name} → ${door.targetCellId || "unassigned"}`} style={{ left: `${(door.x || 0) / level.width * 100}%`, top: `${(door.y || 0) / level.height * 100}%`, width: `${(door.width || level.gridSize) / level.width * 100}%`, height: `${(door.height || level.gridSize) / level.height * 100}%` }} onClick={(event) => onDoorClick?.(event, cell, door)} onContextMenu={(event) => onDoorContextMenu?.(event, cell, door)}>⇥</button>))}
  </div>;
}
