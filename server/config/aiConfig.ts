/**
 * Centralized AI Configuration Module for LearniX (EduPulse AI OS).
 * 
 * Rules:
 * 1. GEMINI_API_KEY is the canonical configuration variable.
 * 2. GOOGLE_API_KEY is supported ONLY as a documented legacy fallback.
 * 3. If both are configured with different values, show ONE clear warning at startup.
 * 4. Every Gemini service must use this initialized configuration.
 * 5. Never print API key values.
 * 6. Never silently switch between keys during a running request.
 * 7. Validate API configuration during startup.
 */

export interface AiConfig {
  apiKey: string | null;
  isConfigured: boolean;
  models: {
    text: string;
    transcribe: string;
    embedding: string;
  };
  transcription: {
    targetChunkDurationSeconds: number;
    rpmLimit: number;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

let cachedConfig: AiConfig | null = null;
let startupWarningLogged = false;

export function initializeAiConfig(): AiConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawGeminiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const rawGoogleKey = process.env.GOOGLE_API_KEY?.trim() || "";

  let resolvedKey: string | null = null;

  if (rawGeminiKey && rawGoogleKey) {
    if (rawGeminiKey !== rawGoogleKey && !startupWarningLogged) {
      console.warn(
        "[AI-CONFIG] Warning: Both GEMINI_API_KEY and GOOGLE_API_KEY are configured with different values. " +
        "Prioritizing canonical GEMINI_API_KEY. GOOGLE_API_KEY is deprecated and will be ignored."
      );
      startupWarningLogged = true;
    }
    resolvedKey = rawGeminiKey;
  } else if (rawGeminiKey) {
    resolvedKey = rawGeminiKey;
  } else if (rawGoogleKey) {
    if (!startupWarningLogged) {
      console.info(
        "[AI-CONFIG] Notice: Using GOOGLE_API_KEY as legacy fallback. " +
        "Please migrate to canonical GEMINI_API_KEY."
      );
      startupWarningLogged = true;
    }
    resolvedKey = rawGoogleKey;
  }

  // Harmonize process.env once so internal library checks share the canonical value without mutating mid-flight
  if (resolvedKey) {
    process.env.GEMINI_API_KEY = resolvedKey;
    process.env.GOOGLE_API_KEY = resolvedKey;
  }

  const chunkDuration = Math.min(
    60,
    Math.max(30, parseInt(process.env.AUDIO_CHUNK_DURATION_SECONDS || "45", 10))
  );

  cachedConfig = {
    apiKey: resolvedKey,
    isConfigured: Boolean(resolvedKey),
    models: {
      text: process.env.GEMINI_TEXT_MODEL || "gemini-3.7-flash",
      transcribe: process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe",
      embedding: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2-preview",
    },
    transcription: {
      targetChunkDurationSeconds: chunkDuration,
      rpmLimit: Math.max(1, parseInt(process.env.GEMINI_TRANSCRIPTION_RPM || "3", 10)),
      maxRetries: Math.max(0, parseInt(process.env.GEMINI_TRANSCRIPTION_MAX_RETRIES || "3", 10)),
      baseDelayMs: Math.max(500, parseInt(process.env.GEMINI_TRANSCRIPTION_BASE_DELAY_MS || "2000", 10)),
      maxDelayMs: Math.max(5000, parseInt(process.env.GEMINI_TRANSCRIPTION_MAX_DELAY_MS || "30000", 10)),
    },
  };

  return cachedConfig;
}

export function getAiConfig(): AiConfig {
  if (!cachedConfig) {
    return initializeAiConfig();
  }
  return cachedConfig;
}

export function resetAiConfigForTesting(): void {
  cachedConfig = null;
  startupWarningLogged = false;
}
