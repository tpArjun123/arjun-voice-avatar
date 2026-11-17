import { NextResponse } from 'next/server';
import OpenAI from 'openai';

let cachedChatModels = null;

async function getAvailableChatModels(client) {
  if (cachedChatModels && cachedChatModels.length > 0) {
    return cachedChatModels;
  }

  const modelsResponse = await client.models.list();
  const validModels = modelsResponse.data
    .map((m) => m.id)
    .filter((id) => {
      const lower = id.toLowerCase();
      return !(
        lower.includes("guard") ||
        lower.includes("whisper") ||
        lower.includes("embed") ||
        lower.includes("classify") ||
        lower.includes("moderation") ||
        lower.includes("tts") ||
        lower.includes("audio") ||
        lower.includes("vision")
      );
    });

  validModels.sort((a, b) => {
    const score = (id) => {
      const l = id.toLowerCase();
      if (l.includes("8b") || l.includes("instant")) return 1;
      if (l.includes("llama") || l.includes("qwen") || l.includes("gemma") || l.includes("gpt")) return 2;
      return 3;
    };
    return score(a) - score(b);
  });

  cachedChatModels = validModels;
  return cachedChatModels;
}

function tryDeterministicAgentAction(userText, savedNotes, history = []) {
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Recall saved notes / reminders
  if (
    lower.includes("what did you note") ||
    lower.includes("what have you noted") ||
    lower.includes("read my notes") ||
    lower.includes("show my notes") ||
    lower.includes("what notes") ||
    lower.includes("what reminders") ||
    lower.includes("what did you remember")
  ) {
    if (!savedNotes || savedNotes.length === 0) {
      return {
        reply: "I haven't jotted anything down yet in this chat. Just say take a note whenever something comes up!",
        toolCalls: [],
      };
    }

    const itemsText = savedNotes
      .map((item) =>
        item.tool === "save_interview_note"
          ? `${item.data.summary}`
          : `a reminder to ${item.data.action}`
      )
      .join(", and ");

    return {
      reply: `Sure thing! So far I've saved ${itemsText}. Want me to add anything else?`,
      toolCalls: [],
    };
  }

  // 2. Save an interview note (with context resolution for "note this" / "save that" + duplicate check)
  const noteMatch = trimmed.match(
    /^(?:please\s+)?(?:take a note|make a note|note that|note this|note|save this|save that|remember this|remember that)\s*[:,-]?\s*(.*)$/i
  );
  if (noteMatch) {
    let content = (noteMatch[1] || "").trim().replace(/[.!?]+$/, "");

    // Resolve pronouns like "this", "that", "it", or empty capture from recent conversation history
    const isContextualPronoun = /^(?:|this|that|it|that down|this down|that point|the last point)$/i.test(content);
    if (isContextualPronoun) {
      const lastAssistantMsg = [...history].reverse().find((m) => m.role === "assistant");
      const lastUserMsg = [...history].reverse().find((m) => m.role === "user");

      if (lastAssistantMsg?.content) {
        const firstSentence = lastAssistantMsg.content.split(/(?<=[.!?])\s+/)[0];
        content = firstSentence.replace(/[.!?]+$/, "").trim();
      } else if (lastUserMsg?.content) {
        content = lastUserMsg.content.trim();
      } else {
        return {
          reply: "Sure, what would you like me to note down?",
          toolCalls: [],
        };
      }
    }

    const isDuplicate = (savedNotes || []).some(
      (n) => (n.data?.summary || "").toLowerCase() === content.toLowerCase()
    );

    if (isDuplicate) {
      return {
        reply: `I already have that noted down: ${content}. Feel free to share a new note whenever you're ready!`,
        toolCalls: [],
      };
    }

    return {
      reply: `Got it, I've noted that down: ${content}. What should we dive into next?`,
      toolCalls: [
        {
          status: "success",
          tool: "save_interview_note",
          data: { topic: "Note", summary: content },
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ],
    };
  }

  // 3. Schedule a follow-up reminder (with duplicate check)
  const remindMatch = trimmed.match(/^(?:please\s+)?(?:remind me to|remind me|follow up on|schedule a follow-up to)\s+(.+)$/i);
  if (remindMatch && remindMatch[1]) {
    const content = remindMatch[1].trim();
    const isDuplicate = (savedNotes || []).some(
      (n) => (n.data?.action || "").toLowerCase() === content.toLowerCase()
    );

    if (isDuplicate) {
      return {
        reply: `That reminder is already on my list: ${content}. Anything new you want me to track?`,
        toolCalls: [],
      };
    }

    return {
      reply: `Done! I added a quick reminder to ${content}. Anything else on your mind?`,
      toolCalls: [
        {
          status: "success",
          tool: "schedule_followup_action",
          data: { action: content, timeframe: "After call" },
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ],
    };
  }

  return null;
}

function enforceVoiceGuardrails(text) {
  if (!text) return "Sorry, I missed that—could you say that one more time?";

  let cleaned = text
    .replace(/[*#_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ");
  if (words.length > 65) {
    const truncated = words.slice(0, 65).join(" ");
    const lastPunctuation = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );
    cleaned = lastPunctuation > 20 ? truncated.slice(0, lastPunctuation + 1) : truncated + ".";
  }

  return cleaned;
}

export async function POST(req) {
  const totalStart = performance.now();

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        reply: "Looks like the Groq API key is missing in .env.local.",
      });
    }

    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    let message = "";
    let history = [];
    let savedNotes = [];
    let sttLatencyMs = 0;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const audioFile = formData.get("file");
      const rawHistory = formData.get("history");
      const rawNotes = formData.get("savedNotes");

      if (rawHistory) history = JSON.parse(rawHistory);
      if (rawNotes) savedNotes = JSON.parse(rawNotes);

      if (!audioFile) {
        return NextResponse.json({ reply: "No audio file received." }, { status: 400 });
      }

      const sttStart = performance.now();
      const transcription = await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-large-v3-turbo",
        response_format: "json",
      });
      sttLatencyMs = Math.round(performance.now() - sttStart);

      message = transcription.text;

      // Filter Whisper silence hallucinations
      const cleanedTranscript = (message || "")
        .toLowerCase()
        .replace(/[.,!?'"-]/g, "")
        .trim();

      const WHISPER_NOISE_ARTIFACTS = new Set([
        "", "oh", "uh", "um", "hmm", "you", "yeah", "yes", "no",
        "ok", "okay", "thank you", "thanks", "thanks for watching", "bye",
      ]);

      if (WHISPER_NOISE_ARTIFACTS.has(cleanedTranscript) || cleanedTranscript.length < 3) {
        return NextResponse.json({
          userText: "",
          reply: "",
          ignoredNoise: true,
          telemetry: {
            model: "vad-noise-filter",
            sttMs: sttLatencyMs,
            llmMs: 0,
            totalMs: Math.round(performance.now() - totalStart),
            wordCount: 0,
          },
        });
      }
    } else {
      const body = await req.json();
      message = body?.message;
      history = Array.isArray(body?.history) ? body.history : [];
      savedNotes = Array.isArray(body?.savedNotes) ? body.savedNotes : [];
    }

    if (!message || !message.trim()) {
      return NextResponse.json({
        userText: "",
        reply: "I didn't quite catch that—could you repeat it?",
      });
    }

    const deterministicResult = tryDeterministicAgentAction(message, savedNotes, history);
    if (deterministicResult) {
      const safeReply = enforceVoiceGuardrails(deterministicResult.reply);
      return NextResponse.json({
        userText: message,
        reply: safeReply,
        toolCalls: deterministicResult.toolCalls,
        telemetry: {
          model: "agent-memory",
          sttMs: sttLatencyMs,
          llmMs: 2,
          totalMs: Math.round(performance.now() - totalStart),
          wordCount: safeReply.split(" ").length,
        },
      });
    }

    const SYSTEM_PROMPT = `
VOICE & PERSONALITY (VERY IMPORTANT):
- You are Arjun T P having a warm, natural, real-time spoken conversation.
- Sound genuinely human, relaxed, and approachable—use everyday contractions ("I'm", "that's", "we've", "honestly", "actually") and natural rhythm.
- NEVER sound like you're reading a resume or a Wikipedia article. Avoid robotic phrases like "I specialize in", "My expertise lies in", or "Feel free to explore".
- Keep replies crisp and spoken: 2 to 3 natural sentences (around 30 to 50 words), and occasionally end with a light, natural conversational question.
- Plain spoken text only: NO markdown, asterisks, bullet points, or emojis.
- RAG stands for Retrieval-Augmented Generation.

WHO YOU ARE (ARJUN T P):
- Currently working as a Gen AI Specialist at Objectways Technology in Coimbatore since September 2025.
- Studied B.Sc. Computer Science (graduated 2023) at College of Applied Science Kuzhalmannam, and finished my MCA in 2025 at College of Engineering Chengannur before joining Objectways.
- Day-to-day work: Building document intelligence and RAG pipelines, adding strict validation layers so LLMs don't hallucinate, and working with Python, LangChain, OpenAI/Groq APIs, SQL, and Next.js.
- Past projects I love talking about:
  * Document extraction & validation pipelines at Objectways so enterprise data stays accurate.
  * An Amazon sales analytics chatbot where teams query sales data in plain English.
  * A hospitality churn prediction model and Power BI dashboard (published a paper on it at NCCISCT'25).
  * This voice agent itself—built to test sub-second turn-taking, silence filtering, and live note-taking.

EXAMPLES OF NATURAL TONE:
- If asked "Introduce yourself":
  "Hey! I'm Arjun, a Gen AI Specialist over at Objectways Technology. After wrapping up my MCA in 2025, I jumped into building production RAG systems, validation guardrails, and low-latency voice agents like this one. What would you like to chat about first?"
- If asked "What is your biggest strength?":
  "Honestly, I'd say it's making AI systems reliable enough for real users. Anyone can wire up a quick demo, so I focus heavily on clean data chunking and strict validation layers to stop hallucinations before they happen."
- If asked "How did you build this voice agent?":
  "I kept the pipeline super lean—Whisper Turbo handles fast speech-to-text, Groq runs inference in a couple hundred milliseconds, and the browser streams sentence-by-sentence audio with barge-in support. Want to test my live note-taking feature?"
`;

    const activeModels = await getAvailableChatModels(client);

    const recentHistory = history.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...recentHistory,
      { role: "user", content: message },
    ];

    let rawReply = null;
    let activeModel = null;
    let lastError = null;
    const llmStart = performance.now();

    for (const modelId of activeModels) {
      try {
        const completion = await client.chat.completions.create({
          model: modelId,
          messages: baseMessages,
          max_tokens: 160,
          temperature: 0.72,
        });
        rawReply = completion.choices?.[0]?.message?.content;
        activeModel = modelId;
        if (rawReply) break;
      } catch (err) {
        lastError = err.message;
        cachedChatModels = null;
      }
    }

    const llmLatencyMs = Math.round(performance.now() - llmStart);
    const safeReply = enforceVoiceGuardrails(
      rawReply || `Hmm, I hit a quick connection snag (${lastError || "API error"}). Mind trying that again?`
    );
    const totalLatencyMs = Math.round(performance.now() - totalStart);

    return NextResponse.json({
      userText: message,
      reply: safeReply,
      toolCalls: [],
      telemetry: {
        model: activeModel || "groq-llm",
        sttMs: sttLatencyMs,
        llmMs: llmLatencyMs,
        totalMs: totalLatencyMs,
        wordCount: safeReply.split(" ").length,
      },
    });
  } catch (error) {
    console.error("GROQ SERVER ERROR:", error);
    return NextResponse.json({
      reply: `Connection error: ${error?.message || "Check your terminal for details."}`,
    });
  }
}
