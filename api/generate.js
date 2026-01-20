import fs from "fs";
import path from "path";
import axios from "axios"; // We'll use axios for DeepSeek calls

// ✅ Memory folder (works on Vercel)
const MEMORY_DIR = "/tmp/memory";
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);

// 🧠 Load user memory
function loadMemory(userId) {
  const filePath = path.join(MEMORY_DIR, `memory_${userId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.error(`❌ Failed to load memory for ${userId}:`, err);
  }

  // Default memory
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
    console.error(`❌ Failed to save memory for ${userId}:`, err);
  }
}

// 🧠 Simple heuristic to classify text language
function detectLanguage(text) {
  const lower = text.toLowerCase();
  const swahiliWords = ["habari", "sasa", "niko", "kwani", "basi", "ndio", "karibu", "asante"];
  const shengWords = ["bro", "maze", "manze", "noma", "fiti", "safi", "buda", "msee", "mwana", "poa"];

  const swCount = swahiliWords.filter((w) => lower.includes(w)).length;
  const shCount = shengWords.filter((w) => lower.includes(w)).length;

  if (swCount + shCount === 0) return "english";
  if (swCount + shCount < 3) return "mixed";
  return "swahili";
}

// 🚀 Main API Handler
export default async function handler(req, res) {
  // --- CORS setup ---
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, project, userId } = req.body;
    if (!prompt || !userId)
      return res.status(400).json({ error: "Missing prompt or userId." });

    // 🧠 Load memory
    let memory = loadMemory(userId);
    if (project) memory.lastProject = project;
    memory.lastTask = prompt;
    memory.conversation.push({ role: "user", content: prompt });

    // 🌍 Detect language
    const lang = detectLanguage(prompt);
    let languageInstruction = "";
    if (lang === "swahili") {
      languageInstruction = "Respond fully in Swahili or Sheng naturally depending on tone.";
    } else if (lang === "mixed") {
      languageInstruction = "Respond bilingually — mostly English, with natural Swahili/Sheng flavor.";
    } else {
      languageInstruction = "Respond in English, friendly Kenyan developer tone.";
    }

    // 🧩 Build conversation context
    const promptText = `
${memory.conversation
  .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
  .join("\n")}

System instruction: ${languageInstruction}
`;

    // 🔥 Call DeepSeek API
    const deepSeekResponse = await axios.post(
      "https://api.deepseek.com/v1/chat", // Replace with actual DeepSeek endpoint if different
      {
        prompt: promptText,
        model: "deepseek-default", // adjust based on DeepSeek model naming
        temperature: 0.9,
        max_tokens: 900,
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const fullResponse =
      deepSeekResponse.data.reply || "⚠️ No response received.";

    // 🧹 Clean and save memory
    const cleanText = fullResponse.replace(/as an ai|language model/gi, "");
    memory.conversation.push({ role: "assistant", content: cleanText });
    saveMemory(userId, memory);

    // ✅ Return
    return res.status(200).json({ reply: cleanText });
  } catch (err) {
    console.error("💥 Backend error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Server error." });
  }
}
