export type Door = {
  id: string;
  name: string;
  edge: "north" | "east" | "south" | "west" | "interior";
  targetLevelId: string;
  targetCellId: string;
  loadMode: "stream" | "transition" | "locked";
  locked: boolean;
  keyId: string;
};

export type WorldCell = {
  id: string;
  levelId: string;
  name: string;
  kind: "exterior" | "interior" | "dungeon" | "encounter";
  x: number;
  y: number;
  width: number;
  height: number;
  ambience: string;
  notes: string;
  doors: Door[];
};

export type Level = {
  id: string;
  name: string;
  region: string;
  description: string;
  environment: string;
  width: number;
  height: number;
  gridSize: number;
  playerSpawn: { x: number; y: number };
};

export type LootEntry = {
  id: string;
  itemId: string;
  itemName: string;
  chance: number;
  weight: number;
  min: number;
  max: number;
  condition: string;
};

export type LootTable = {
  id: string;
  name: string;
  rolls: number;
  allowDuplicates: boolean;
  entries: LootEntry[];
};

export type Npc = {
  id: string;
  name: string;
  role: string;
  faction: string;
  hostile: boolean;
  level: number;
  health: number;
  armor: number;
  personality: string;
  dialogueStyle: string;
  motivation: string;
  fears: string;
  traits: string[];
  likes: string[];
  dislikes: string[];
  inventoryLootTableId: string;
  dropLootTableId: string;
};

export type SpawnEntry = {
  id: string;
  npcId: string;
  chance: number;
  weight: number;
  minGroup: number;
  maxGroup: number;
};

export type NpcSpawner = {
  id: string;
  name: string;
  levelId: string;
  cellId: string;
  x: number;
  y: number;
  radius: number;
  maxAlive: number;
  cooldownSeconds: number;
  enabled: boolean;
  entries: SpawnEntry[];
};

export type QuestTrigger = {
  id: string;
  type: "enter_cell" | "talk_to_npc" | "loot_object" | "world_flag" | "manual";
  targetId: string;
  operator: "is" | "is_not" | "at_least";
  value: string;
};

export type QuestTask = {
  id: string;
  title: string;
  type: "visit" | "talk" | "kill" | "collect" | "interact" | "set_flag";
  targetId: string;
  count: number;
  optional: boolean;
};

export type QuestReward = {
  id: string;
  type: "xp" | "chips" | "item" | "reputation" | "world_flag";
  targetId: string;
  amount: number;
};

export type Quest = {
  id: string;
  title: string;
  summary: string;
  giverNpcId: string;
  repeatable: boolean;
  hidden: boolean;
  triggers: QuestTrigger[];
  tasks: QuestTask[];
  completionMode: "all_required" | "any_required";
  completionRequirements: string;
  rewards: QuestReward[];
};

export type GameProject = {
  schemaVersion: 1;
  game: "Life is a Gamble";
  updatedAt: string;
  levels: Level[];
  cells: WorldCell[];
  lootTables: LootTable[];
  npcs: Npc[];
  spawners: NpcSpawner[];
  quests: Quest[];
};

export type MountInfo = {
  mounted: boolean;
  repository: string;
  branch: string;
  path: string;
  sha: string | null;
  message?: string;
};

export type ProjectResponse = {
  project: GameProject;
  mount: MountInfo;
};
