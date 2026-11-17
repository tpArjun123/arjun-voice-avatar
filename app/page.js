"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const QUICK_TOPICS = [
  { label: "👋 Introduce yourself", prompt: "Introduce yourself" },
  { label: "⚡ How this voice AI works", prompt: "How did you build this voice agent?" },
  { label: "🎯 Biggest strength", prompt: "What is your biggest strength?" },
  { label: "📝 Save a note", prompt: "Take a note: we discussed low-latency voice pipelines" },
  { label: "📋 Check notes", prompt: "What did you note?" },
];

function pickWorkingMaleOrFallbackVoice(available) {
  if (!available || available.length === 0) return null;

  const maleNames = [
    "guy",
    "andrew",
    "brian",
    "christopher",
    "eric",
    "ryan",
    "liam",
    "william",
    "george",
    "daniel",
    "google uk english male",
    "male",
  ];

  const isMale = (v) =>
    maleNames.some((name) => v.name.toLowerCase().includes(name));

  return (
    available.find((v) => v.lang.startsWith("en") && v.name.includes("Natural") && isMale(v)) ||
    available.find((v) => v.lang.startsWith("en-GB") && isMale(v)) ||
    available.find((v) => v.lang.startsWith("en") && isMale(v)) ||
    available.find((v) => v.lang.startsWith("en") && v.name.includes("Natural")) ||
    available.find((v) => v.lang.startsWith("en-GB")) ||
    available.find((v) => v.lang.startsWith("en")) ||
    available[0]
  );
}

function extractDeterministicNote(userText, messages) {
  const clean = userText.trim();
  const lower = clean.toLowerCase();

  // Case 1: Contextual pronoun reference ("note this", "save that", "note it down")
  if (/^(take a note[:\s]*)?(note|save|remember|write down)\s+(this|that|it)(\s+down)?[.!?]*$/i.test(lower)) {
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
    return lastAssistantMsg ? lastAssistantMsg.content : null;
  }

  // Case 2: Explicit note command ("Take a note: ...", "Note that ...", "Save note: ...")
  const explicitMatch = clean.match(
    /^(?:please\s+)?(?:take a note|save a note|make a note|note down|note that|note|save this|remember that)[:\s-]+(.+)$/i
  );
  if (explicitMatch && explicitMatch[1]) {
    return explicitMatch[1].trim().replace(/[.!?]+$/, "");
  }

  return null;
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("Tap the AI orb to speak");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [actionLog, setActionLog] = useState([]);
  const [autoListen, setAutoListen] = useState(false);
  const [copiedNotes, setCopiedNotes] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const abortControllerRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const maxVolumeRef = useRef(0);
  const recordingStartRef = useRef(0);
  const autoListenRef = useRef(autoListen);
  const selectedVoiceRef = useRef(null);

  useEffect(() => {
    autoListenRef.current = autoListen;
  }, [autoListen]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const pickConsistentVoice = () => {
      const available = window.speechSynthesis.getVoices();
      if (!available || available.length === 0) return;

      if (!selectedVoiceRef.current) {
        selectedVoiceRef.current = pickWorkingMaleOrFallbackVoice(available);
      }
    };

    pickConsistentVoice();
    window.speechSynthesis.onvoiceschanged = pickConsistentVoice;
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const stopAudioMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const startAudioMonitor = (stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const peak = Math.max(...dataArray);
        const normalized = Math.round((peak / 255) * 100);
        if (normalized > maxVolumeRef.current) {
          maxVolumeRef.current = normalized;
        }
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch {
      // Ignore if AudioContext is restricted
    }
  };

  const interruptAgent = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSpeaking(false);
    setLoading(false);
  }, []);

  const speakReply = useCallback((text) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();

    if (!selectedVoiceRef.current) {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        selectedVoiceRef.current = pickWorkingMaleOrFallbackVoice(available);
      }
    }

    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const preferredVoice = selectedVoiceRef.current;

    sentences.forEach((sentence, index) => {
      const clean = sentence.trim();
      if (!clean) return;

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.02;
      utterance.pitch = 0.85;
      if (preferredVoice) utterance.voice = preferredVoice;

      if (index === 0) {
        utterance.onstart = () => {
          setIsSpeaking(true);
          setStatusText("AI is speaking · Tap orb to interrupt");
        };
      }
      if (index === sentences.length - 1) {
        utterance.onend = () => {
          setIsSpeaking(false);
          if (autoListenRef.current) {
            setStatusText("Auto-listening...");
            startRecording();
          } else {
            setStatusText("Tap the AI orb to speak");
          }
        };
      }
      utterance.onerror = () => {
        setIsSpeaking(false);
        setStatusText("Tap the AI orb to speak");
      };

      window.speechSynthesis.speak(utterance);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    if (isSpeaking || loading) {
      interruptAgent();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      maxVolumeRef.current = 0;
      recordingStartRef.current = Date.now();

      startAudioMonitor(stream);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopAudioMonitor();
        stream.getTracks().forEach((track) => track.stop());

        const durationMs = Date.now() - recordingStartRef.current;
        if (durationMs < 450 || maxVolumeRef.current <= 22) {
          setStatusText("No speech detected · Tap the AI orb to speak");
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await sendAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusText("Listening... Tap the AI orb again to send");
    } catch {
      setStatusText("Please allow microphone access in browser");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusText("AI is thinking...");
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleApiResponse = (data, includeUserMessage = false, rawUserText = "") => {
    if (data.ignoredNoise || !data.reply) {
      setStatusText("No speech detected · Tap the AI orb to speak");
      return;
    }

    const reply = data.reply;
    const effectiveUserText = rawUserText || data.userText || "";

    if (includeUserMessage) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: data.userText || "Voice input" },
        { role: "assistant", content: reply },
      ]);
    } else {
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    }

    const incomingNotes = Array.isArray(data.toolCalls) ? [...data.toolCalls] : [];

    if (incomingNotes.length === 0 && effectiveUserText) {
      const extracted = extractDeterministicNote(effectiveUserText, messages);
      if (extracted) {
        incomingNotes.push({
          tool: "save_note",
          data: { summary: extracted },
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
      }
    }

    if (incomingNotes.length > 0) {
      setActionLog((prev) => {
        const existing = new Set(
          prev.map((n) => (n.data?.summary || n.data?.action || "").toLowerCase().trim())
        );
        const deduped = incomingNotes.filter((n) => {
          const text = (n.data?.summary || n.data?.action || "").toLowerCase().trim();
          if (!text || existing.has(text)) return false;
          existing.add(text);
          return true;
        });
        return [...deduped, ...prev];
      });
    }

    speakReply(reply);
  };

  const sendAudio = async (audioBlob) => {
    setLoading(true);
    setStatusText("AI is thinking...");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");
    formData.append("history", JSON.stringify(messages));
    formData.append("savedNotes", JSON.stringify(actionLog));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const data = await res.json();
      handleApiResponse(data, true);
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatusText("Connection error · Tap the AI orb to speak");
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const sendTextMessage = async (text) => {
    if (!text.trim()) return;
    if (isSpeaking || loading) interruptAgent();

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setStatusText("AI is thinking...");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages,
          savedNotes: actionLog,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      handleApiResponse(data, false, text);
    } catch (err) {
      if (err.name !== "AbortError") {
        setStatusText("Connection error · Tap the AI orb to speak");
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (inputText.trim()) {
      sendTextMessage(inputText);
      setInputText("");
    }
  };

  const copyAllNotes = () => {
    const text = actionLog
      .map((n) => `• ${n.data?.summary || n.data?.action} (${n.timestamp})`)
      .join("\n");
    navigator.clipboard?.writeText(text);
    setCopiedNotes(true);
    setTimeout(() => setCopiedNotes(false), 1500);
  };

  const orbStyle = isRecording
    ? "from-rose-500 via-pink-500 to-rose-600 shadow-rose-500/40 scale-105"
    : loading
    ? "from-indigo-500 via-violet-500 to-purple-600 shadow-indigo-500/40"
    : isSpeaking
    ? "from-amber-400 via-orange-500 to-amber-500 shadow-amber-500/40"
    : "from-cyan-400 via-teal-400 to-emerald-500 shadow-cyan-500/35";

  return (
    <main className="min-h-screen bg-[#060A14] text-slate-100 flex flex-col items-center justify-center p-3 sm:p-4">
      {/* Ambient AI Glow */}
      <div className="pointer-events-none fixed top-6 left-1/2 -translate-x-1/2 w-[500px] h-[260px] rounded-full bg-cyan-500/10 blur-3xl" />

      {/* Main AI Voice Agent Container (Compact Single-Screen Fit) */}
      <div className="relative z-10 w-full max-w-2xl bg-slate-900/75 backdrop-blur-2xl border border-white/10 rounded-3xl p-4 sm:p-5 shadow-2xl">
        {/* Top Status & AI Identity Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 text-[10px] font-semibold tracking-wide">
              ✦ AI VOICE AGENT
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoListen((prev) => !prev)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition cursor-pointer ${
                autoListen
                  ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-300"
                  : "bg-white/5 border-white/10 text-slate-400 hover:text-slate-200"
              }`}
              title="Automatically listen again after AI finishes speaking"
            >
              Auto-Listen: {autoListen ? "ON" : "OFF"}
            </button>

            {messages.length > 0 && (
              <button
                onClick={() => {
                  interruptAgent();
                  setMessages([]);
                  setActionLog([]);
                  setStatusText("Tap the AI orb to speak");
                }}
                className="px-2.5 py-0.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-slate-400 hover:text-white transition cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Agent Profile & Capabilities */}
        <div className="text-center mt-3">
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Arjun T P · Conversational AI Agent
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Natural Voice Q&A · Live Note Memory · Instant Barge-In Interruption
          </p>
        </div>

        {/* Center Interactive AI Voice Orb */}
        <div className="my-4 flex flex-col items-center">
          <div className="relative flex items-center justify-center">
            <span
              className={`absolute -inset-2 rounded-full border border-cyan-400/25 ${
                isRecording || isSpeaking || loading ? "animate-ping opacity-50" : "opacity-60"
              }`}
            />
            <button
              onClick={toggleRecording}
              aria-label="Tap the AI orb to speak"
              className={`relative z-10 w-20 h-20 rounded-full bg-gradient-to-tr ${orbStyle} flex flex-col items-center justify-center shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer`}
            >
              {loading ? (
                <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isSpeaking ? (
                <div className="flex items-center gap-1 h-6">
                  <span className="w-1 h-3 bg-white rounded-full animate-bounce [animation-delay:-0.2s]" />
                  <span className="w-1 h-6 bg-white rounded-full animate-bounce" />
                  <span className="w-1 h-4.5 bg-white rounded-full animate-bounce [animation-delay:-0.1s]" />
                  <span className="w-1 h-2.5 bg-white rounded-full animate-bounce [animation-delay:-0.3s]" />
                </div>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-6 h-6 text-white"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 1.5a3.75 3.75 0 00-3.75 3.75v6a3.75 3.75 0 007.5 0v-6A3.75 3.75 0 0012 1.5z"
                    />
                  </svg>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/95 mt-0.5">
                    {isRecording ? "Send" : "Speak"}
                  </span>
                </>
              )}
            </button>
          </div>

          <p className="mt-2.5 text-xs font-medium text-cyan-200">
            {statusText}
          </p>
        </div>

        {/* Interactive Topic & Action Chips */}
        <div className="mb-3">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {QUICK_TOPICS.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  const alreadyNoted = actionLog.some(
                    (n) =>
                      (n.data?.summary || "").toLowerCase() ===
                      "we discussed low-latency voice pipelines"
                  );
                  if (item.prompt.startsWith("Take a note:") && alreadyNoted) {
                    setInputText("Take a note: ");
                    inputRef.current?.focus();
                  } else {
                    sendTextMessage(item.prompt);
                  }
                }}
                disabled={loading}
                className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-400/40 text-slate-300 hover:text-cyan-200 transition disabled:opacity-40 cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* AI Memory / Saved Notes Card */}
        {actionLog.length > 0 && (
          <div className="mb-3 rounded-xl bg-amber-500/10 border border-amber-400/25 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-amber-300 flex items-center gap-1">
                ✦ AI Session Memory ({actionLog.length})
              </span>
              <button
                onClick={copyAllNotes}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition cursor-pointer"
              >
                {copiedNotes ? "Copied!" : "Copy Notes"}
              </button>
            </div>
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {actionLog.map((note, idx) => (
                <div
                  key={idx}
                  className="text-[11px] text-amber-100/90 flex items-center justify-between bg-black/25 px-2.5 py-1 rounded-md"
                >
                  <span>• {note.data?.summary || note.data?.action}</span>
                  <span className="text-[10px] text-amber-300/70 ml-2 shrink-0">
                    {note.timestamp}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversation Feed */}
        <div className="w-full bg-slate-950/75 border border-white/10 rounded-2xl p-3 h-44 overflow-y-auto space-y-2.5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <p className="text-xs text-slate-400">
                Tap the AI orb to speak, pick a topic pill above, or type below to start chatting.
              </p>
            </div>
          ) : (
            messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5 px-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    {m.role === "user" ? "You" : "Arjun AI"}
                  </span>
                  {m.role === "assistant" && (
                    <button
                      onClick={() => speakReply(m.content)}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
                      title="Replay voice"
                    >
                      🔊 Replay
                    </button>
                  )}
                </div>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-slate-800 text-slate-100 rounded-br-sm"
                      : "bg-cyan-500/10 border border-cyan-500/20 text-cyan-50 rounded-bl-sm"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Text Input Bar */}
        <form onSubmit={handleTextSubmit} className="w-full mt-2.5 flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask anything or say 'Take a note...'"
            className="flex-1 bg-slate-950/85 border border-white/10 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/50"
          />
          <button
            type="submit"
            disabled={loading || !inputText.trim()}
            className="bg-gradient-to-r from-cyan-400 to-emerald-400 hover:opacity-90 disabled:opacity-30 text-slate-950 font-semibold px-4 py-2 rounded-xl text-xs sm:text-sm transition cursor-pointer"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
