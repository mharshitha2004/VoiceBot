"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLE_QUESTIONS, PERSONA_NAME } from "@/lib/persona";

const MAX_RECORD_MS = 60_000;

const STATUS_TEXT = {
  idle: "Tap the mic and ask me a question",
  listening: "Listening… tap again when you're done",
  transcribing: "Catching what you said…",
  thinking: "Thinking…",
  speaking: "Speaking… tap to stop",
};

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function extFor(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function chooseVoice(voices) {
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  const byName = (re) => en.find((v) => re.test(v.name));
  const gb = en.filter((v) => /en[-_]GB/i.test(v.lang));
  return (
    // 1st choice: Google UK English Female (Chrome on desktop & Android)
    byName(/Google UK English Female/i) ||
    // Closest UK female voices on Safari/macOS/iOS, Edge and Windows
    gb.find((v) => /Serena|Kate|Martha|Stephanie|Libby|Sonia|Maisie|Hazel|Susan|Female/i.test(v.name)) ||
    gb.find((v) => !/Male|Daniel|Arthur|Oliver|Ryan|George/i.test(v.name)) ||
    gb[0] ||
    byName(/Samantha|Zira|Aria|Jenny|Female/i) ||
    en[0] ||
    voices[0]
  );
}

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

export default function Home() {
  const [messages, setMessages] = useState([]); // {role, content}
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [canRecord, setCanRecord] = useState(true);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const voiceRef = useRef(null);
  const ttsUnlockedRef = useRef(false);
  const messagesRef = useRef([]);
  const endRef = useRef(null);

  messagesRef.current = messages;

  // ---------- setup ----------
  useEffect(() => {
    setCanRecord(!!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"));
    if ("speechSynthesis" in window) {
      const load = () => (voiceRef.current = chooseVoice(window.speechSynthesis.getVoices()));
      load();
      window.speechSynthesis.onvoiceschanged = load;
    } else {
      setVoiceOn(false);
    }
    return () => {
      window.speechSynthesis?.cancel();
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  // iOS/Safari need speech to be started from a user gesture once
  const unlockTTS = () => {
    if (ttsUnlockedRef.current || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
    ttsUnlockedRef.current = true;
  };

  // ---------- text to speech ----------
  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setStatus("idle");
  };

  const speak = useCallback(
    (text) => {
      if (!voiceOn || !("speechSynthesis" in window)) {
        setStatus("idle");
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel();
      const sentences = splitSentences(text);
      setStatus("speaking");
      sentences.forEach((s, i) => {
        const u = new SpeechSynthesisUtterance(s);
        if (voiceRef.current) u.voice = voiceRef.current;
        u.lang = voiceRef.current?.lang || "en-GB";
        u.rate = 1.0;
        u.pitch = 1.0;
        if (i === sentences.length - 1) {
          u.onend = () => setStatus((st) => (st === "speaking" ? "idle" : st));
        }
        u.onerror = () => setStatus((st) => (st === "speaking" ? "idle" : st));
        synth.speak(u);
      });
    },
    [voiceOn]
  );

  // ---------- ask the bot ----------
  const ask = useCallback(
    async (question) => {
      const q = question.trim();
      if (!q) return;
      setError("");
      window.speechSynthesis?.cancel();
      const next = [...messagesRef.current, { role: "user", content: q }];
      setMessages(next);
      setStatus("thinking");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.reply) throw new Error(data.error || "Something went wrong.");
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
        speak(data.reply);
      } catch (e) {
        setError(e.message || "Something went wrong. Please try again.");
        setStatus("idle");
      }
    },
    [speak]
  );

  // ---------- recording ----------
  function stopStream() {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }

  const startRecording = async () => {
    setError("");
    unlockTTS();
    window.speechSynthesis?.cancel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // live mic level for the button animation
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        audioCtxRef.current = ctx;
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {}

      const mime = pickMimeType();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stopStream();
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 2000) {
          setStatus("idle");
          setError("I didn't catch anything — hold on a moment longer and try again.");
          return;
        }
        setStatus("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, `speech.${extFor(type)}`);
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Couldn't transcribe that.");
          if (!data.text) throw new Error("I didn't catch that — could you try again?");
          await ask(data.text);
        } catch (e) {
          setError(e.message);
          setStatus("idle");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStatus("listening");
      timerRef.current = setTimeout(() => stopRecording(), MAX_RECORD_MS);
    } catch (e) {
      stopStream();
      setStatus("idle");
      setError(
        e?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow mic access in your browser (the icon in the address bar), or just type your question below."
          : "Couldn't start the microphone. You can type your question below instead."
      );
    }
  };

  const stopRecording = () => {
    clearTimeout(timerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const onMicClick = () => {
    if (status === "listening") return stopRecording();
    if (status === "speaking") return stopSpeaking();
    if (status === "idle") return startRecording();
  };

  const onChip = (q) => {
    if (status === "listening" || status === "transcribing" || status === "thinking") return;
    unlockTTS();
    ask(q);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (status === "transcribing" || status === "thinking" || status === "listening") return;
    unlockTTS();
    const q = input;
    setInput("");
    ask(q);
  };

  const replay = (text) => {
    unlockTTS();
    speak(text);
  };

  const busy = status === "transcribing" || status === "thinking";
  const ringScale = 1 + level * 0.6;

  return (
    <main className="wrap">
      <header className="hero">
        <div className="avatar" aria-hidden="true">HR</div>
        <p className="eyebrow">Voice interview · AI twin</p>
        <h1>
          Hi, I&apos;m <span>{PERSONA_NAME}</span>.
        </h1>
        <p className="lede">
          AI engineer from Hyderabad. Ask me what you&apos;d ask in an interview —
          tap the mic and speak, or type below. I&apos;ll answer out loud, the way I would.
        </p>
      </header>

      <section className="stage">
        <button
          className={`mic mic--${status}`}
          onClick={onMicClick}
          disabled={busy || (!canRecord && status !== "speaking")}
          aria-label={
            status === "listening" ? "Stop recording" : status === "speaking" ? "Stop speaking" : "Start recording"
          }
        >
          <span className="ring" style={{ transform: `scale(${status === "listening" ? ringScale : 1})` }} />
          {status === "listening" ? (
            <svg viewBox="0 0 24 24" className="icon"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
          ) : status === "speaking" ? (
            <svg viewBox="0 0 24 24" className="icon wave">
              <rect x="4" y="9" width="2.4" height="6" rx="1.2" />
              <rect x="8.4" y="6" width="2.4" height="12" rx="1.2" />
              <rect x="12.8" y="4" width="2.4" height="16" rx="1.2" />
              <rect x="17.2" y="8" width="2.4" height="8" rx="1.2" />
            </svg>
          ) : busy ? (
            <span className="spinner" />
          ) : (
            <svg viewBox="0 0 24 24" className="icon">
              <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z" />
              <path d="M18.5 11.5a6.5 6.5 0 0 1-13 0M12 18v3" fill="none" strokeWidth="2" strokeLinecap="round" stroke="currentColor" />
            </svg>
          )}
        </button>
        <p className="status" aria-live="polite">
          {canRecord ? STATUS_TEXT[status] : "Voice input isn't supported in this browser — type your question below."}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="chips" aria-label="Try a question">
        <p className="chips__label">Try one of these</p>
        <div className="chips__row">
          {SAMPLE_QUESTIONS.map((q) => (
            <button key={q} className="chip" onClick={() => onChip(q)} disabled={busy || status === "listening"}>
              {q}
            </button>
          ))}
        </div>
      </section>

      {messages.length > 0 && (
        <section className="convo" aria-label="Conversation">
          {messages.map((m, i) => (
            <div key={i} className={`msg msg--${m.role}`}>
              <span className="msg__who">{m.role === "user" ? "You" : PERSONA_NAME}</span>
              <p>{m.content}</p>
              {m.role === "assistant" && voiceOn && (
                <button className="replay" onClick={() => replay(m.content)}>▶ Play again</button>
              )}
            </div>
          ))}
          {status === "thinking" && (
            <div className="msg msg--assistant">
              <span className="msg__who">{PERSONA_NAME}</span>
              <p className="dots"><span>.</span><span>.</span><span>.</span></p>
            </div>
          )}
          <div ref={endRef} />
        </section>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Or type a question…"
          aria-label="Type a question"
          maxLength={500}
        />
        <button type="submit" disabled={!input.trim() || busy || status === "listening"}>Ask</button>
      </form>

      <footer className="foot">
        <label className="toggle">
          <input
            type="checkbox"
            checked={voiceOn}
            onChange={(e) => {
              setVoiceOn(e.target.checked);
              if (!e.target.checked) stopSpeaking();
            }}
          />
          <span>Speak answers aloud</span>
        </label>
        {messages.length > 0 && (
          <button className="link" onClick={() => { stopSpeaking(); setMessages([]); setError(""); }}>
            Start over
          </button>
        )}
        <p className="credit">Speech-to-text: Whisper on Groq · Answers: open LLM on Groq · Voice: your browser</p>
      </footer>
    </main>
  );
}
