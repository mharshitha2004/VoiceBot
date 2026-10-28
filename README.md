# Talk to Harshitha: AI Voice Bot

A voice bot that answers interview questions the way **I (Mandadi Harshitha Reddy)** would. Tap the mic, ask a question out loud, and hear the answer spoken back. No sign-up, no API key, and it works on desktop and mobile.

**Live demo:** https://voice-chatbot-two.vercel.app/

## Features

- **Voice in, voice out:** speak a question and hear the answer read aloud
- **Sample questions:** one-tap buttons for the five assessment questions
- **Typing fallback:** if the mic is blocked or unsupported, type the question instead
- **Conversation memory:** the last 10 turns are sent as context, so follow-ups like "tell me more" work
- **Honest by design:** it never invents facts beyond its persona, and it says so if asked whether it is an AI
- **No API key for testers:** the key stays on the server

## Architecture

There is no separate backend service. This is a single **Next.js (App Router)** project. The frontend is the React page, and the backend is Next.js API route handlers, which Vercel runs as serverless functions. This keeps the Groq key off the browser without needing a FastAPI server.

```
 Browser (app/page.js)
   |  records mic audio with MediaRecorder
   v
 POST /api/transcribe  --->  Groq Whisper (whisper-large-v3-turbo)  --> text
   |
   v
 POST /api/chat        --->  Groq LLM (gpt-oss-120b, fallback gpt-oss-20b)
   |                         + persona system prompt (lib/persona.js)
   v
 Browser speech synthesis reads the answer aloud (British female voice)
```

| Layer | Responsibility |
|---|---|
| Frontend (`app/page.js`) | Mic capture, chat UI, sample questions, text input, text-to-speech |
| API routes (`app/api/...`) | Server-side calls to Groq so the key is never exposed |
| Persona (`lib/persona.js`) | Verified facts, talking points and speaking rules that shape every answer |

## Design decisions

- **Groq for speech-to-text and the LLM:** a free tier and low latency, which suits a conversational voice experience.
- **Browser speech synthesis for output:** free, instant, and no extra API or key.
- **Persona as a system prompt:** keeps answers grounded in real background and easy to edit.
- **Model fallbacks:** both transcription and the LLM retry on a backup model if the primary fails.
- **Resilience:** a 60-second recording cap, friendly error messages, and a typed-question fallback.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your free Groq key from https://console.groq.com/keys
npm run dev                  # open http://localhost:3000
```

Use Chrome for the best voice experience. Microphone access needs `localhost` or HTTPS.

## Deploy to Vercel

1. Push this project to a GitHub repo.
2. On [vercel.com](https://vercel.com), choose **Add New → Project** and import the repo. The framework is detected as Next.js.
3. Under **Environment Variables**, add `GROQ_API_KEY` with your Groq key.
4. Click **Deploy** and share the `https://....vercel.app` URL.

If you change an environment variable later, redeploy so it takes effect.

## Environment variables

| Name | Purpose |
|---|---|
| `GROQ_API_KEY` | Groq API key used for transcription and the LLM (server-side only) |


## Customising the persona

Edit `lib/persona.js` to change the facts, talking points and tone. Replace anything with your own stories so the bot sounds like you.

## Tech stack

Next.js 15 (App Router) · React 19 · Groq Whisper · Groq-hosted open-weight LLM (gpt-oss) · Web Speech API (speech synthesis) · Vercel
