export const dialogueActionTypes = [
  "add_world_flag",
  "remove_world_flag",
  "award_xp",
  "change_chips",
  "change_hp",
  "change_ap",
  "damage_enemy",
  "set_combat",
  "unlock_door",
  "enter_interior",
  "move_player",
  "grant_skill_points",
  "modify_skill",
  "add_item",
  "remove_item",
  "equip_item",
  "open_panel",
  "close_dialogue",
] as const;

export type DialogueActionType = (typeof dialogueActionTypes)[number];

export type DialogueAction = {
  type: DialogueActionType;
  target: string;
  amount: number;
  reason: string;
};

export type DialogueTurn = {
  reply: string;
  intent: string;
  trustDelta: number;
  respectDelta: number;
  fearDelta: number;
  mood: string;
  opinion: string;
  memory: string;
  actionCheck: string;
  conversationStatus: "continue" | "refuse" | "end";
  actions: DialogueAction[];
  engine?: "ai" | "local";
};

export type DialogueGameSnapshot = {
  hp: number;
  maxHp: number;
  ap: number;
  enemyHp: number;
  combat: string;
  level: number;
  xp: number;
  xpGoal: number;
  chips: number;
  skillPoints: number;
  unlockedDoors: string[];
  interior: string | null;
  playerPosition: { x: number; y: number };
  inventory: Array<{ id: number; name: string; equipped: string | null }>;
};

export const dialogueTurnSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply", "intent", "trustDelta", "respectDelta", "fearDelta", "mood", "opinion",
    "memory", "actionCheck", "conversationStatus", "actions",
  ],
  properties: {
    reply: { type: "string", minLength: 1, maxLength: 900 },
    intent: { type: "string", minLength: 1, maxLength: 80 },
    trustDelta: { type: "integer", minimum: -8, maximum: 8 },
    respectDelta: { type: "integer", minimum: -8, maximum: 8 },
    fearDelta: { type: "integer", minimum: -8, maximum: 8 },
    mood: { type: "string", minLength: 1, maxLength: 40 },
    opinion: { type: "string", minLength: 1, maxLength: 180 },
    memory: { type: "string", minLength: 1, maxLength: 220 },
    actionCheck: { type: "string", minLength: 1, maxLength: 180 },
    conversationStatus: { type: "string", enum: ["continue", "refuse", "end"] },
    actions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "target", "amount", "reason"],
        properties: {
          type: { type: "string", enum: dialogueActionTypes },
          target: { type: "string", maxLength: 140 },
          amount: { type: "integer", minimum: -100, maximum: 100 },
          reason: { type: "string", minLength: 1, maxLength: 180 },
        },
      },
    },
  },
} as const;

const actionTypeSet = new Set<string>(dialogueActionTypes);

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Math.round(Number(value) || 0);
  return Math.max(minimum, Math.min(maximum, number));
}

export function normalizeDialogueTurn(value: unknown): DialogueTurn | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const reply = String(candidate.reply || "").trim();
  if (!reply) return null;
  const rawActions = Array.isArray(candidate.actions) ? candidate.actions : [];
  const actions = rawActions.slice(0, 4).flatMap((entry): DialogueAction[] => {
    if (!entry || typeof entry !== "object") return [];
    const action = entry as Record<string, unknown>;
    const type = String(action.type || "");
    const reason = String(action.reason || "").trim();
    if (!actionTypeSet.has(type) || !reason) return [];
    return [{
      type: type as DialogueActionType,
      target: String(action.target || "").trim().slice(0, 140),
      amount: boundedInteger(action.amount, -100, 100),
      reason: reason.slice(0, 180),
    }];
  });
  const status = String(candidate.conversationStatus || "continue");
  return {
    reply: reply.slice(0, 900),
    intent: String(candidate.intent || "conversation").slice(0, 80),
    trustDelta: boundedInteger(candidate.trustDelta, -8, 8),
    respectDelta: boundedInteger(candidate.respectDelta, -8, 8),
    fearDelta: boundedInteger(candidate.fearDelta, -8, 8),
    mood: String(candidate.mood || "Wary").slice(0, 40),
    opinion: String(candidate.opinion || "Still deciding.").slice(0, 180),
    memory: String(candidate.memory || "The Courier chose their words carefully.").slice(0, 220),
    actionCheck: String(candidate.actionCheck || "No immediate game-state change was warranted.").slice(0, 180),
    conversationStatus: status === "end" || status === "refuse" ? status : "continue",
    actions,
  };
}
