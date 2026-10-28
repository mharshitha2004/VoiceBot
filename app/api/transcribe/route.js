export const runtime = "nodejs";

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODELS = [
  process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
  "whisper-large-v3",
];

export async function POST(req) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "Server is missing GROQ_API_KEY." },
      { status: 500 }
    );
  }

  let audio;
  try {
    const form = await req.formData();
    audio = form.get("audio");
  } catch {
    return Response.json({ error: "Invalid audio upload." }, { status: 400 });
  }
  if (!audio || typeof audio === "string" || audio.size === 0) {
    return Response.json({ error: "No audio received." }, { status: 400 });
  }
  if (audio.size > 4 * 1024 * 1024) {
    return Response.json(
      { error: "Recording is too long — please keep it under a minute." },
      { status: 413 }
    );
  }

  let lastErr;
  for (const model of MODELS) {
    try {
      const fd = new FormData();
      fd.append("file", audio, audio.name || "speech.webm");
      fd.append("model", model);
      fd.append("language", "en");
      fd.append("response_format", "json");
      fd.append("temperature", "0");

      const res = await fetch(GROQ_STT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: fd,
      });
      if (!res.ok) {
        throw new Error(`STT ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = await res.json();
      return Response.json({ text: (data.text || "").trim() });
    } catch (e) {
      lastErr = e;
      console.error(e.message);
    }
  }
  return Response.json(
    { error: "Sorry, I couldn't hear that clearly — please try again." },
    { status: 502 }
  );
}
