import { SYSTEM_PROMPT } from "@/lib/persona";

export const runtime = "nodejs";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Primary model, then fallbacks if Groq returns an error / rate limit.
const MODELS = [
  process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

const MAX_HISTORY = 10; // last N turns sent for context
const MAX_CHARS = 1000; // per message

async function callGroq(model, messages) {
  const body = {
    model,
    messages,
    temperature: 0.6,
    max_completion_tokens: 900,
  };
  // gpt-oss models are reasoning models: keep reasoning short and hidden
  if (model.startsWith("openai/gpt-oss")) {
    body.reasoning_effort = "low";
    body.include_reasoning = false;
  }
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq ${model} ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error(`Groq ${model}: empty reply`);
  return reply;
}

export async function POST(req) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "Server is missing GROQ_API_KEY." },
      { status: 500 }
    );
  }

  let history;
  try {
    ({ messages: history } = await req.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!Array.isArray(history) || history.length === 0) {
    return Response.json({ error: "No message provided." }, { status: 400 });
  }

  const cleaned = history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...cleaned];

  let lastErr;
  for (const model of MODELS) {
    try {
      const reply = await callGroq(model, messages);
      // Strip any stray markdown so text-to-speech sounds clean
      const spoken = reply.replace(/[*#_`>]/g, "").replace(/\n{2,}/g, "\n");
      return Response.json({ reply: spoken });
    } catch (e) {
      lastErr = e;
      console.error(e.message);
    }
  }
  return Response.json(
    { error: "I couldn't think of an answer just now — please try again." },
    { status: 502 }
  );
}
