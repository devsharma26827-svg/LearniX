/**
 * Centralized AI Configuration Module for LearniX (EduPulse AI OS).
 * 
 * Rules:
 * 1. GEMINI_API_KEY is the canonical configuration variable.
 * 2. GOOGLE_API_KEY is supported ONLY as a documented legacy fallback.
 * 3. When both variables exist, always select GEMINI_API_KEY.
 * 4. If both are configured with different values, show ONE clear warning at startup.
 * 5. Never print API key values.
 * 6. Remove conflicting GOOGLE_API_KEY from process.env once GEMINI_API_KEY is established
 *    to prevent the underlying @google/genai SDK from logging duplicate key warnings.
 * 7. Every Gemini service must use this initialized configuration.
 * 8. Never silently switch between keys during a running request.
 * 9. Validate API configuration during startup.
 */

export interface AiConfig {
  apiKey: string | null;
  isConfigured: boolean;
  keySource: "GEMINI_API_KEY" | "GOOGLE_API_KEY" | "NONE";
  models: {
    text: string;
    fallbackText: string;
    transcribe: string;
    liveTranscribe: string;
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
  let keySource: "GEMINI_API_KEY" | "GOOGLE_API_KEY" | "NONE" = "NONE";

  if (rawGeminiKey && rawGoogleKey) {
    // Both variables exist: GEMINI_API_KEY takes precedence
    resolvedKey = rawGeminiKey;
    keySource = "GEMINI_API_KEY";

    if (rawGeminiKey !== rawGoogleKey && !startupWarningLogged) {
      console.warn(
        "[AI-CONFIG] Warning: Both GEMINI_API_KEY and GOOGLE_API_KEY are configured with different values. " +
        "Prioritizing canonical GEMINI_API_KEY. GOOGLE_API_KEY is deprecated and will be ignored."
      );
      startupWarningLogged = true;
    }
  } else if (rawGeminiKey) {
    resolvedKey = rawGeminiKey;
    keySource = "GEMINI_API_KEY";
  } else if (rawGoogleKey) {
    resolvedKey = rawGoogleKey;
    keySource = "GOOGLE_API_KEY";
    if (!startupWarningLogged) {
      console.info(
        "[AI-CONFIG] Notice: Using GOOGLE_API_KEY as legacy fallback. " +
        "Please migrate to canonical GEMINI_API_KEY."
      );
      startupWarningLogged = true;
    }
  }

  // Normalize process.env:
  // 1. Ensure GEMINI_API_KEY holds the canonical value.
  // 2. Delete GOOGLE_API_KEY from process.env so that the @google/genai SDK
  //    does not detect both and emit 'Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.'
  if (resolvedKey) {
    process.env.GEMINI_API_KEY = resolvedKey;
    delete process.env.GOOGLE_API_KEY;
  }

  const chunkDuration = Math.min(
    60,
    Math.max(30, parseInt(process.env.AUDIO_CHUNK_DURATION_SECONDS || "45", 10))
  );

  cachedConfig = {
    apiKey: resolvedKey,
    isConfigured: Boolean(resolvedKey),
    keySource,
    models: {
      text: process.env.GEMINI_TEXT_MODEL || "gemini-3.7-flash",
      fallbackText: process.env.GEMINI_FALLBACK_TEXT_MODEL || "gemini-2.5-flash",
      transcribe: process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe",
      liveTranscribe: process.env.GEMINI_LIVE_TRANSCRIBE_MODEL || "gemini-3.5-transcribe-live",
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
