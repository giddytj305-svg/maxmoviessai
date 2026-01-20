import fs from "fs";
import path from "path";
import axios from "axios";

// ✅ Memory folder (works on Vercel)
const MEMORY_DIR = "/tmp/memory";
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });

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
  // --- CORS setup ---
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, project, userId = "default" } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt parameter." });
    }

    // 🧠 Load memory
    let memory = loadMemory(userId);
    if (project) memory.lastProject = project;
    memory.lastTask = prompt;
    
    // Add user message to conversation
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

    // 🔥 Prepare messages for DeepSeek API
    // Add language instruction to system message
    const messages = [...memory.conversation];
    if (messages[0]?.role === "system") {
      messages[0].content += `\n\n${languageInstruction}`;
    }

    // 🔥 Call DeepSeek API (updated to use chat completions format)
    const deepSeekResponse = await axios.post(
      "https://api.deepseek.com/chat/completions",
      {
        model: "deepseek-chat", // Use appropriate model
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    const assistantReply = deepSeekResponse.data?.choices?.[0]?.message?.content || 
                          "⚠️ No response received from AI.";

    // 🧹 Clean response and save memory
    const cleanText = assistantReply.replace(/as an ai|language model/gi, "");
    memory.conversation.push({ role: "assistant", content: cleanText });
    
    // Limit conversation history to last 20 messages (including system message)
    if (memory.conversation.length > 20) {
      const systemMessage = memory.conversation[0];
      const recentMessages = memory.conversation.slice(-19);
      memory.conversation = [systemMessage, ...recentMessages];
    }
    
    saveMemory(userId, memory);

    // ✅ Return response
    return res.status(200).json({ 
      reply: cleanText,
      memory: {
        lastProject: memory.lastProject,
        conversationLength: memory.conversation.length
      }
    });
    
  } catch (error) {
    console.error("💥 Backend error:", error.response?.data || error.message);
    
    // Return user-friendly error message
    let errorMessage = "Server error. Please try again.";
    let statusCode = 500;
    
    if (error.response?.status === 401) {
      errorMessage = "API key is invalid or missing.";
      statusCode = 401;
    } else if (error.response?.status === 429) {
      errorMessage = "Rate limit exceeded. Please try again later.";
      statusCode = 429;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "Request timeout. Please try again.";
      statusCode = 408;
    }
    
    return res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
