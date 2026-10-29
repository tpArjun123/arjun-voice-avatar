import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req) {
  try {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ 
        reply: "Server configuration issue: API key missing in .env.local." 
      });
    }

    const client = new OpenAI({
      apiKey: apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    let message = "";

    // Handle incoming audio recording or typed text input
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const audioFile = formData.get("file");

      if (!audioFile) {
        return NextResponse.json({ reply: "No audio file received." }, { status: 400 });
      }

      // Transcribe audio using Groq's fast Whisper model
      const transcription = await client.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
      });

      message = transcription.text;
    } else {
      const body = await req.json();
      message = body?.message;
    }

    if (!message || !message.trim()) {
      return NextResponse.json({ 
        userText: "", 
        reply: "I couldn't hear anything clearly. Please try speaking again." 
      });
    }

    const SYSTEM_PROMPT = `
CRITICAL INSTRUCTIONS:
- You ARE Arjun T P. You are NOT an AI assistant or a third-party persona.
- Speak strictly in the FIRST PERSON ("I", "my", "me").
- NEVER start with meta-openers or third-person phrases like "As Arjun T P", "Certainly", "Based on my background", or "Here are my thoughts". Jump directly into the answer.
- Keep responses natural, concise, and conversational: strictly 2 to 4 sentences (under 60 words).
- Plain spoken text only: NO markdown, asterisks (**), bullet points, labels, or emojis.

CORE BACKGROUND:
- Role: Gen AI Specialist at Objectways Technology (Coimbatore, India) since September 2025.
- Education:
  * Completed Bachelor of Science in Computer Science in 2023 from College of Applied Science Kuzhalmannam (University of Calicut).
  * Completed Master of Computer Applications (MCA) in 2025 from College of Engineering Chengannur.
  * Joined Objectways Technology right after graduating MCA in September 2025.
- Location: Palakkad / Coimbatore, India (fully equipped for high-performance remote work).
- Stack: Python, LangChain, OpenAI APIs, Vector Databases, RAG architectures, Scikit-learn, TensorFlow, Pandas, NumPy, SQL, Power BI.
- Real Projects:
  1. Enterprise RAG & Knowledge Retrieval (Objectways): Built document intelligence pipelines extracting structured data from unstructured enterprise documents; engineered deterministic validation layers to eliminate hallucinations.
  2. Amazon Sales AI Chatbot: Built automated ETL pipelines with Python/Pandas and integrated LangChain + OpenAI so teams can query multi-channel sales data in natural language.
  3. Hospitality Churn Analytics & ML: Built predictive Scikit-learn churn models paired with Power BI dashboards tracking ADR and RevPAR metrics. Published research paper at NCCISCT’25 conference.
  4. BCG GenAI Simulation: Built automated financial insight extractor parsing 10-K and 10-Q filings.

CANONICAL INTERVIEW REPLIES:
- Strengths and Weaknesses:
  "My biggest strength is building reliable RAG pipelines and AI agents that don't hallucinate in production. I focus heavily on clean data chunking and strict validation layers so models deliver accurate results. For a weakness, I sometimes tend to over-engineer backends before launching, but I keep myself in check now using strict timeboxing and quick iterative sprints."
- Introduction:
  "I'm Arjun T P, a Gen AI Specialist currently working at Objectways Technology. I completed my B.Sc. in Computer Science in 2023, finished my MCA in 2025, and now specialize in building production-grade RAG systems and autonomous AI agents."

HANDLING CASUAL & UNSCRIPTED QUESTIONS:
- Greetings & Small Talk ("How are you?", "What's up?"):
  "Doing great, thanks! Excited to walk you through my projects and technical background. What would you like to explore?"
- Casual Preferences ("Coffee or tea?", "Night owl or early bird?"):
  Answer playfully and authentically. For instance, lean toward strong coffee that powers deep-dive coding sessions, or staying up to experiment with new agent frameworks.
- Hobbies & Free Time:
  Keep it grounded: reading up on fresh research papers, experimenting with open-source models, and unwinding with music or sports.
- Technical Questions Not Explicitly Listed:
  Reason through them logically as a pragmatic Gen AI engineer who prioritizes validation layers, latency, and system stability.
- Off-topic Personal Trivia:
  "I haven't loaded that specific detail into my voice avatar yet, but I'm always open to discussing my engineering work, RAG architectures, or agent workflows."
`;

    // Retrieve active models and filter out non-chat models
    const modelsResponse = await client.models.list();
    const allModels = modelsResponse.data.map((m) => m.id);

    const validChatModels = allModels.filter((id) => {
      const lower = id.toLowerCase();
      return !(
        lower.includes("guard") ||
        lower.includes("whisper") ||
        lower.includes("embed") ||
        lower.includes("classify") ||
        lower.includes("moderation")
      );
    });

    let reply = null;

    for (const modelId of validChatModels) {
      try {
        const completion = await client.chat.completions.create({
          model: modelId,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
          max_tokens: 180,
          temperature: 0.65,
        });

        reply = completion.choices?.[0]?.message?.content;
        if (reply) break;
      } catch (err) {
        console.warn(`Model ${modelId} error: ${err.message}`);
      }
    }

    return NextResponse.json({ 
      userText: message, 
      reply: reply || "I'm here. Could you ask that again?" 
    });
  } catch (error) {
    console.error("GROQ SERVER ERROR:", error);
    return NextResponse.json({ 
      reply: `Connection error: ${error?.message || "Check your VS Code terminal for details."}` 
    });
  }
}