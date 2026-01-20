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
  console.log(`📂 Loading memory from: ${filePath}`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      console.log(`✅ Memory loaded for user: ${userId}`);
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`❌ Failed to load memory for ${userId}:`, err.message);
  }

  console.log(`🆕 Creating new memory for user: ${userId}`);
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
    console.log(`💾 Memory saved for user: ${userId}`);
  } catch (err) {
    console.error(`❌ Failed to save memory for ${userId}:`, err.message);
  }
}

// 🧠 Simple heuristic to classify text language
function detectLanguage(text) {
  if (!text || typeof text !== 'string') {
    return "english";
  }
  
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
  
  // Log request details
  console.log(`📝 Method: ${req.method}`);
  console.log(`🌐 URL: ${req.url}`);
  console.log(`📦 Headers:`, req.headers);
  
  // --- CORS setup ---
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    console.log("✅ CORS preflight request handled");
    return res.status(200).end();
  }

  // Allow GET for testing
  if (req.method === "GET") {
    console.log("📋 GET request - returning API info");
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
    console.log(`❌ Method ${req.method} not allowed`);
    return res.status(405).json({ 
      error: `Method ${req.method} not allowed. Use POST or GET for testing.`,
      allowed: ['POST', 'GET', 'OPTIONS']
    });
  }

  try {
    console.log("📥 Processing POST request...");
    
    // Check if body is parsed
    let body;
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch (parseError) {
        console.error("❌ Failed to parse JSON body:", parseError);
        return res.status(400).json({ error: "Invalid JSON in request body" });
      }
    } else {
      body = req.body;
    }
    
    const { prompt, project, userId = "default" } = body;
    console.log(`👤 User ID: ${userId}`);
    console.log(`💬 Prompt: ${prompt?.substring(0, 100)}${prompt?.length > 100 ? '...' : ''}`);
    
    if (!prompt || prompt.trim() === '') {
      console.log("❌ Missing prompt");
      return res.status(400).json({ 
        error: "Missing or empty prompt parameter.",
        example: {
          prompt: "What movies do you recommend?",
          userId: "optional_user_id"
        }
      });
    }

    // 🧠 Load memory
    console.log("🧠 Loading memory...");
    let memory = loadMemory(userId);
    if (project) memory.lastProject = project;
    memory.lastTask = prompt;
    
    // Add user message to conversation
    memory.conversation.push({ role: "user", content: prompt });
    console.log(`💭 Conversation length: ${memory.conversation.length}`);

    // 🌍 Detect language
    const lang = detectLanguage(prompt);
    console.log(`🌍 Detected language: ${lang}`);
    
    let languageInstruction = "";
    if (lang === "swahili") {
      languageInstruction = "Respond fully in Swahili or Sheng naturally depending on tone.";
    } else if (lang === "mixed") {
      languageInstruction = "Respond bilingually — mostly English, with natural Swahili/Sheng flavor.";
    } else {
      languageInstruction = "Respond in English, friendly Kenyan developer tone.";
    }

    // 🔥 Prepare messages for DeepSeek API
    const messages = [...memory.conversation];
    if (messages[0]?.role === "system") {
      messages[0].content += `\n\n${languageInstruction}`;
    }
    
    console.log(`📤 Preparing to call DeepSeek API with ${messages.length} messages`);
    console.log(`🔑 API Key present: ${!!process.env.DEEPSEEK_API_KEY ? 'Yes' : 'No'}`);
    
    // Check if API key is set
    if (!process.env.DEEPSEEK_API_KEY) {
      console.error("❌ DEEPSEEK_API_KEY is not set in environment variables");
      return res.status(500).json({ 
        error: "Server configuration error",
        message: "API key is not configured"
      });
    }

    // 🔥 Call DeepSeek API
    console.log("📡 Calling DeepSeek API...");
    const deepSeekResponse = await axios.post(
      "https://api.deepseek.com/chat/completions",
      {
        model: "deepseek-chat",
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
        timeout: 30000,
      }
    ).catch(error => {
      console.error("❌ DeepSeek API call failed:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    });

    console.log("✅ DeepSeek API responded successfully");
    console.log(`📊 Response status: ${deepSeekResponse.status}`);
    
    const assistantReply = deepSeekResponse.data?.choices?.[0]?.message?.content || 
                          "I apologize, but I couldn't generate a response. Please try again.";
    
    console.log(`📝 Assistant reply length: ${assistantReply.length} characters`);

    // 🧹 Clean response and save memory
    const cleanText = assistantReply.replace(/as an ai|language model/gi, "");
    memory.conversation.push({ role: "assistant", content: cleanText });
    
    // Limit conversation history to last 20 messages (including system message)
    if (memory.conversation.length > 20) {
      const systemMessage = memory.conversation[0];
      const recentMessages = memory.conversation.slice(-19);
      memory.conversation = [systemMessage, ...recentMessages];
      console.log(`✂️ Trimmed conversation from ${memory.conversation.length + 1} to 20 messages`);
    }
    
    saveMemory(userId, memory);

    // ✅ Return response
    console.log("✅ Request completed successfully");
    console.log("=".repeat(50) + "\n");
    
    return res.status(200).json({ 
      reply: cleanText,
      memory: {
        lastProject: memory.lastProject,
        conversationLength: memory.conversation.length,
        userId: userId
      }
    });
    
  } catch (error) {
    console.error("\n💥 CRITICAL ERROR:");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error stack:", error.stack);
    
    if (error.response) {
      console.error("API Response error:");
      console.error("- Status:", error.response.status);
      console.error("- Status text:", error.response.statusText);
      console.error("- Data:", JSON.stringify(error.response.data, null, 2));
    }
    
    console.error("=".repeat(50) + "\n");
    
    // Return user-friendly error message
    let errorMessage = "Server error. Please try again.";
    let statusCode = 500;
    let details = null;
    
    if (error.response?.status === 401) {
      errorMessage = "API key is invalid or missing.";
      statusCode = 401;
      details = "Check your DEEPSEEK_API_KEY environment variable";
    } else if (error.response?.status === 429) {
      errorMessage = "Rate limit exceeded. Please try again later.";
      statusCode = 429;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "Request timeout. Please try again.";
      statusCode = 408;
    } else if (error.message.includes('ENOENT')) {
      errorMessage = "File system error.";
      statusCode = 500;
    }
    
    return res.status(statusCode).json({ 
      error: errorMessage,
      details: details || (process.env.NODE_ENV === 'development' ? error.message : undefined)
    });
  }
}
