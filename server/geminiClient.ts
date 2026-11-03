import { GoogleGenAI } from "@google/genai";
import { getAiConfig } from "./config/aiConfig";

let aiInstance: GoogleGenAI | null = null;
let isMockSet = false;

/**
 * Resolves the Gemini API key via the centralized AiConfig module.
 * Prioritizes GEMINI_API_KEY, falls back to GOOGLE_API_KEY with one startup warning.
 */
export function resolveGeminiApiKey(): string | null {
  const config = getAiConfig();
  return config.apiKey;
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
}

export const MODELS = {
  get TEXT() {
    return getAiConfig().models.text;
  },
  get TRANSCRIBE() {
    return getAiConfig().models.transcribe;
  },
  get EMBEDDING() {
    return getAiConfig().models.embedding;
  },
};

