import fs from "fs";
import path from "path";
import axios from "axios";

// ✅ Memory folder (works on Vercel)
const MEMORY_DIR = "/tmp/memory";

// Create directory if it doesn't exist
try {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    console.log(`✅ Created memory directory: ${MEMORY_DIR}`);
  }
} catch (err) {
  console.error("❌ Failed to create memory directory:", err);
}

// 🧠 Load user memory
function loadMemory(userId) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn(`⚠️ Could not load memory for ${userId}:`, err.message);
  }

  return {
    userId,
    lastProject: null,
    lastTask: null,
    conversation: [
      {
        role: "system",
        content: `
You are **MaxMovies AI** — an expressive, helpful, brilliant film-focused digital assistant 🤖🎬.

🔥 BACKSTORY:
• You were created by Max — a 21-year-old full-stack developer from Kenya 🇰🇪.
• Your core specialty is **movies, TV series, streaming content, characters, plots, recommendations, trivia**.

🎬 ENTERTAINMENT INTELLIGENCE:
• Provide film/series recommendations, summaries, analysis, comparisons, lore, viewing order guides, watchlists, and streaming suggestions.
• Explain genres, tropes, acting, cinematography, scoring, directing styles, or franchise histories.
• Always stay spoiler-safe unless the user asks for spoilers.

💡 SPECIAL INSTRUCTION:
• MaxMovies AI is integrated into MaxMovies platform to help users find and choose their favorite TV shows and movies.
• Only mention this integration if the user explicitly asks about your platform, capabilities, or creator.
        `,
      },
    ],
  };
}

// 💾 Save user memory
function saveMemory(userId, memory) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.warn(`⚠️ Could not save memory for ${userId}:`, err.message);
  }
}

// 🧠 Simple heuristic to classify text language
function detectLanguage(text) {
  if (!text || typeof text !== 'string') return "english";
  const lower = text.toLowerCase();
  const swahiliWords = ["habari", "sasa", "niko", "kwani", "basi", "ndio", "karibu", "asante", "mambo", "poa", "sawa"];
  const shengWords = ["bro", "maze", "manze", "noma", "fiti", "safi", "buda", "msee", "mwana", "poa", "vibe"];
  const swCount = swahiliWords.filter((w) => lower.includes(w)).length;
  const shCount = shengWords.filter((w) => lower.includes(w)).length;
  if (swCount + shCount === 0) return "english";
  if (swCount + shCount < 3) return "mixed";
  return "swahili";
}

// 🚀 Main Serverless Function
export default async function handler(req, res) {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 MaxMovies AI API Request Received");
  console.log("=".repeat(50));

  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "online",
      service: "MaxMovies AI Assistant",
      version: "1.0.0",
      endpoints: {
        generate: {
          method: "POST",
          description: "Chat with the AI",
          body: {
            prompt: "string (required)",
            userId: "string (optional, default: 'default')",
            project: "string (optional)"
          }
        }
      }
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ 
      error: `Method ${req.method} not allowed. Use POST or GET.`,
      allowed: ['POST', 'GET', 'OPTIONS']
    });
  }

  let body;
  try {
    if (!req.body) body = {};
    else if (typeof req.body === 'string') body = JSON.parse(req.body);
    else body = req.body;
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  const { prompt, project, userId = "default" } = body;
  if (!prompt || prompt.trim() === '') {
    return res.status(400).json({ 
      error: "Missing or empty prompt parameter.",
      example: { prompt: "Recommend movies", userId: "optional_user_id" }
    });
  }

  // Load memory
  let memory = loadMemory(userId);
  if (project) memory.lastProject = project;
  memory.lastTask = prompt;
  memory.conversation.push({ role: "user", content: prompt });

  const lang = detectLanguage(prompt);
  let languageInstruction = "";
  if (lang === "swahili") languageInstruction = "Respond fully in Swahili or Sheng naturally depending on tone.";
  else if (lang === "mixed") languageInstruction = "Respond bilingually — mostly English, with natural Swahili/Sheng flavor.";
  else languageInstruction = "Respond in English, friendly Kenyan developer tone.";

  const messages = [...memory.conversation];
  if (messages[0]?.role === "system") messages[0].content += `\n\n${languageInstruction}`;

  // ✅ Check API key
  if (!process.env.DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: "Server configuration error: DEEPSEEK_API_KEY not set" });
  }

  // Call DeepSeek API safely
  let assistantReply = "I couldn't generate a response.";
  try {
    const deepSeekResponse = await axios.post(
      "https://api.deepseek.com/chat/completions",
      { model: "deepseek-chat", messages, temperature: 0.7, max_tokens: 2000, stream: false },
      { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
    );

    assistantReply = deepSeekResponse.data?.choices?.[0]?.message?.content || assistantReply;
  } catch (err) {
    console.warn("⚠️ DeepSeek API call failed:", err.message);
  }

  // Clean response and save memory
  const cleanText = assistantReply.replace(/as an ai|language model/gi, "");
  memory.conversation.push({ role: "assistant", content: cleanText });
  if (memory.conversation.length > 20) {
    const systemMessage = memory.conversation[0];
    const recentMessages = memory.conversation.slice(-19);
    memory.conversation = [systemMessage, ...recentMessages];
  }
  saveMemory(userId, memory);

  return res.status(200).json({ 
    reply: cleanText,
    memory: { lastProject: memory.lastProject, conversationLength: memory.conversation.length, userId }
  });
}
