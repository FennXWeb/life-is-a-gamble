const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Live transcription is not configured." }, { status: 503 });

  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "No microphone audio was received." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "The microphone recording was too large." }, { status: 413 });
  }

  const contentType = audio.type || "audio/webm";
  const extension = contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", audio, `dialogue-turn.${extension}`);
  form.append("model", process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe");
  form.append("language", "en");
  form.append("response_format", "json");
  form.append("prompt", "Natural conversational English. Setting vocabulary may include Rowan Vale, Syracuse, Salina Street, Clinton Square, Albany Citadel, Fate Engine, lockpick, wasteland, and Courier.");

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) {
      console.error("Transcription request failed", response.status, await response.text());
      return Response.json({ error: "The speech service could not transcribe that turn." }, { status: 502 });
    }
    const result = await response.json() as { text?: string };
    const text = String(result.text || "").trim().slice(0, 500);
    if (!text) return Response.json({ error: "No speech was detected." }, { status: 422 });
    return Response.json({ text });
  } catch (error) {
    console.error("Transcription request failed", error);
    return Response.json({ error: "The speech service is unreachable." }, { status: 502 });
  }
}
