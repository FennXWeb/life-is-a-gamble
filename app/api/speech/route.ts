type SpeechRequest = {
  text?: string;
  character?: "player" | "rowan";
  mood?: string;
};

const voiceProfiles = {
  player: {
    voice: "cedar",
    displayName: "The Courier",
    demographics: "masculine-presenting adult, approximately 28 to 35 years old",
    accent: "inland Northern American English with only a faint Upstate New York influence",
    delivery: "weathered baritone, grounded and direct, medium pace, restrained emotion, never theatrical",
  },
  rowan: {
    voice: "marin",
    displayName: "Rowan Vale",
    demographics: "feminine-presenting adult woman, approximately 32 to 38 years old",
    accent: "inland Northern American English with a subtle Upstate New York cadence",
    delivery: "low contralto impression, dry, guarded, intelligent, understated emotion, natural pauses, never announcer-like",
  },
} as const;

export async function POST(request: Request) {
  const data = (await request.json()) as SpeechRequest;
  const text = String(data.text || "").trim().slice(0, 650);
  const character = data.character === "player" ? "player" : "rowan";
  if (!text) return Response.json({ error: "No speech text" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Hosted voice unavailable", fallback: true }, { status: 503 });

  const profile = voiceProfiles[character];
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: profile.voice,
      input: text,
      instructions: `Perform ${profile.displayName}, a ${profile.demographics}. Accent and cadence: ${profile.accent}. Vocal identity: ${profile.delivery}. Keep this identity consistent across every line. Current emotional color: ${String(data.mood || "neutral").slice(0, 40)}. Let mood affect intensity and timing, not the character's age, gender presentation, accent, or core timbre.`,
      response_format: "mp3",
    }),
  });

  if (!response.ok) return Response.json({ error: "Voice generation failed", fallback: true }, { status: 502 });
  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=86400",
      "X-Voice-Character": character,
    },
  });
}
