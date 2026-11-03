import { GoogleGenAI } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;
let isMockSet = false;
let warningLogged = false;

/**
 * Resolves the Gemini API key from environment variables using a consistent strategy.
 * Prioritizes GEMINI_API_KEY, falls back to GOOGLE_API_KEY.
 * Warns if both are set with conflicting values, without logging the keys.
 */
export function resolveGeminiApiKey(): string | null {
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const googleKey = process.env.GOOGLE_API_KEY?.trim() || "";

  if (geminiKey && googleKey) {
    if (geminiKey !== googleKey && !warningLogged) {
      console.warn(
        `[GEMINI] Warning: Both GEMINI_API_KEY and GOOGLE_API_KEY are configured with different values. Prioritizing GEMINI_API_KEY.`
      );
      warningLogged = true;
    }
    // Harmonize environment so internal SDK checks don't fire duplicate warnings
    process.env.GOOGLE_API_KEY = geminiKey;
    process.env.GEMINI_API_KEY = geminiKey;
    return geminiKey;
  }

  if (geminiKey) {
    process.env.GOOGLE_API_KEY = geminiKey;
    return geminiKey;
  }

  if (googleKey) {
    process.env.GEMINI_API_KEY = googleKey;
    return googleKey;
  }

  return null;
}

export function getGeminiClient(): GoogleGenAI | null {
  if (isMockSet) return aiInstance;
  if (aiInstance) return aiInstance;

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    console.warn("[GEMINI] No API key found in environment variables. Running in resilient fallback mode.");
    return null;
  }

  try {
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    return aiInstance;
  } catch (err: any) {
    console.error("[GEMINI] Failed to initialize GoogleGenAI client:", err?.message || err);
    return null;
  }
}

/**
 * Allows test suites to inject a mocked GoogleGenAI client to avoid consuming API quota.
 */
export function setMockGeminiClient(mock: GoogleGenAI | null) {
  aiInstance = mock;
  isMockSet = true;
}

export function resetGeminiClient() {
  aiInstance = null;
  isMockSet = false;
  warningLogged = false;
}

export const MODELS = {
  TEXT: process.env.GEMINI_TEXT_MODEL || "gemini-3.7-flash",
  TRANSCRIBE: process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe",
  EMBEDDING: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2-preview",
};
