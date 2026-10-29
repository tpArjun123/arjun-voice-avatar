"use client";

import { useState, useRef } from "react";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("Tap mic to speak");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const speakReply = (text) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setStatusText("Speaking...");
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setStatusText("Tap mic to speak");
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setStatusText("Tap mic to speak");
    };

    window.speechSynthesis.speak(utterance);
  };

  const startRecording = async () => {
    if (isSpeaking) {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        await sendAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusText("Listening... (Tap mic again to stop)");
    } catch (err) {
      console.error("Mic error:", err);
      setStatusText("Microphone access denied. Check browser permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatusText("Processing your voice...");
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const sendAudio = async (audioBlob) => {
    setLoading(true);
    setStatusText("Transcribing & thinking...");

    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      const userText = data.userText || "Audio message";
      const reply = data.reply || "Sorry, I couldn't process that.";

      setMessages((prev) => [
        ...prev,
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      ]);

      speakReply(reply);
    } catch (err) {
      console.error(err);
      setStatusText("Error processing voice. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const sendTextMessage = async (text) => {
    if (!text.trim()) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setStatusText("Thinking...");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();
      const reply = data.reply || "No response received.";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      speakReply(reply);
    } catch (err) {
      console.error(err);
      setStatusText("Connection error.");
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (inputText.trim()) {
      sendTextMessage(inputText);
      setInputText("");
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-between p-4 sm:p-8">
      {/* Top Profile Card */}
      <div className="w-full max-w-xl text-center pt-4">
        <div className="inline-block p-1 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full mb-3">
          <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center font-bold text-xl text-emerald-400">
            AP
          </div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Arjun T P</h1>
        <p className="text-sm text-slate-400 mt-1">
          Gen AI Specialist & AI Engineer · Voice Avatar
        </p>
      </div>

      {/* Center Interactive Microphone */}
      <div className="flex flex-col items-center justify-center my-6">
        <div className="relative">
          {(isRecording || isSpeaking) && (
            <span className="absolute -inset-4 rounded-full bg-emerald-500/20 animate-ping"></span>
          )}
          <button
            onClick={toggleRecording}
            className={`relative z-10 w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl ${
              isRecording
                ? "bg-rose-600 hover:bg-rose-500 scale-105 animate-pulse"
                : isSpeaking
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-emerald-600 hover:bg-emerald-500 hover:scale-105 active:scale-95"
            }`}
          >
            {isSpeaking ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-12 h-12 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.216-1.614.597-2.316.234-.847 1.059-1.354 1.938-1.354h2.24z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-12 h-12 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 1.5a3.75 3.75 0 00-3.75 3.75v6a3.75 3.75 0 007.5 0v-6A3.75 3.75 0 0012 1.5z" />
              </svg>
            )}
          </button>
        </div>

        <p className="mt-4 text-sm font-medium text-slate-300">
          {statusText}
        </p>
      </div>

      {/* Conversation Thread & Text Bar */}
      <div className="w-full max-w-xl flex flex-col space-y-4">
        <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-4 max-h-72 overflow-y-auto space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-xs text-slate-500 py-6">
              Tap the mic to talk, or type your question below.
            </p>
          ) : (
            messages.map((m, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-slate-800 text-slate-200 ml-8 border border-slate-700"
                    : "bg-emerald-950/40 text-emerald-200 mr-8 border border-emerald-900/60"
                }`}
              >
                <span className="block text-[10px] uppercase font-bold tracking-wider mb-1 opacity-60">
                  {m.role === "user" ? "You" : "Arjun"}
                </span>
                {m.content}
              </div>
            ))
          )}
          {loading && (
            <div className="text-xs text-emerald-400 animate-pulse italic p-2">
              Thinking...
            </div>
          )}
        </div>

        <form onSubmit={handleTextSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your question..."
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={loading || !inputText.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium px-5 py-3 rounded-xl text-sm transition"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}