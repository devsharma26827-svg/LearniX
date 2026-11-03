import { getGeminiClient, MODELS } from "../geminiClient";
import { TranscriptSegment } from "../../src/types";
import { transcriptionScheduler } from "./geminiScheduler";

export interface TranscribeChunkOptions {
  audioBase64: string;
  mimeType: string;
  currentTimestamp: number;
  existingContext?: string;
  lectureId?: string;
  userId?: string;
  sequenceNumber?: number;
  fallbackText?: string;
  language?: string;
}

export class TranscriptionError extends Error {
  public status: number;
  public isRetryable: boolean;

  constructor(message: string, status = 400, isRetryable = false) {
    super(message);
    this.name = "TranscriptionError";
    this.status = status;
    this.isRetryable = isRetryable;
  }
}

const SUPPORTED_MIME_TYPES = new Set([
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
]);

/**
 * Validates and normalizes audio data and MIME type.
 * Throws a TranscriptionError with 400 status if validation fails.
 */
export function validateAndNormalizeAudio(
  audioBase64: string,
  rawMimeType: string
): { cleanBase64: string; normalizedMime: string; byteLength: number } {
  if (!audioBase64 || typeof audioBase64 !== "string") {
    throw new TranscriptionError("Audio data is missing or not a string", 400);
  }

  // Strip data URL scheme prefix if present (e.g. data:audio/webm;base64,)
  let cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, "").trim();
  // Strip any whitespace and newlines
  cleanBase64 = cleanBase64.replace(/[\r\n\t ]/g, "");

  if (cleanBase64.length === 0) {
    throw new TranscriptionError("Audio data cannot be empty", 400);
  }

  // Validate Base64 encoding characters
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
    throw new TranscriptionError("Invalid base64 audio encoding", 400);
  }

  const byteLength = Buffer.from(cleanBase64, "base64").length;
  if (byteLength < 50) {
    throw new TranscriptionError(
      `Audio chunk is too small (${byteLength} bytes). Minimum 50 bytes required.`,
      400
    );
  }

  // Sanitize MIME type: strip codec parameters (e.g. audio/webm;codecs=opus -> audio/webm)
  const baseMime = (rawMimeType || "audio/webm").split(";")[0].trim().toLowerCase();

  let normalizedMime = baseMime;
  if (baseMime === "audio/wave" || baseMime === "audio/x-wav") {
    normalizedMime = "audio/wav";
  } else if (baseMime === "audio/mp3") {
    normalizedMime = "audio/mpeg";
  }

  if (!SUPPORTED_MIME_TYPES.has(baseMime) && !SUPPORTED_MIME_TYPES.has(normalizedMime)) {
    throw new TranscriptionError(
      `Unsupported audio MIME type: ${rawMimeType}. Supported types: audio/webm, audio/wav, audio/mp3, audio/mpeg, audio/ogg, audio/aac, audio/flac.`,
      400
    );
  }

  return { cleanBase64, normalizedMime, byteLength };
}

/**
 * Extracts transcribed speech text from Gemini API response candidates.
 * Avoids SDK console warnings by directly inspecting parts and handles
 * both text parts and audioTranscription parts.
 */
export function extractTextFromResponse(response: any): string {
  if (!response) return "";

  const candidate = response.candidates?.[0];
  if (!candidate) {
    return typeof response.text === "string" ? response.text : "";
  }

  const parts = candidate.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    // If no parts exist, check top-level text property if available
    try {
      return typeof response.text === "string" ? response.text : "";
    } catch {
      return "";
    }
  }

  const textSnippets: string[] = [];

  for (const part of parts) {
    if (!part) continue;

    // 1. Text part
    if (typeof part.text === "string" && !part.thought) {
      textSnippets.push(part.text);
    }

    // 2. audioTranscription part
    if (part.audioTranscription && typeof part.audioTranscription.text === "string") {
      textSnippets.push(part.audioTranscription.text);
    }
  }

  return textSnippets.join("\n").trim();
}

/**
 * Parses raw extracted text into structured TranscriptSegments.
 */
export function parseTranscriptionToSegments(
  rawText: string,
  currentTimestamp: number,
  defaultLanguage?: string
): TranscriptSegment[] {
  if (!rawText || rawText.trim().length === 0) {
    return [];
  }

  // 1. Check for JSON structure
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const detectedLang = parsed.detectedLanguage || defaultLanguage;
      const langCode = parsed.languageCode || (detectedLang === "Hindi" ? "hi" : detectedLang === "English" ? "en" : undefined);

      if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
        let runningTime = currentTimestamp;
        return parsed.segments.map((seg: any, idx: number) => {
          const segDuration =
            typeof seg.durationEstimate === "number" && seg.durationEstimate > 0
              ? seg.durationEstimate
              : 5;
          const segment: TranscriptSegment = {
            id: `trans-${Date.now()}-${idx}`,
            startTime: Math.round(runningTime),
            endTime: Math.round(runningTime + segDuration),
            text: String(seg.text || "").trim(),
            topic: String(seg.topic || "General Lecture").trim(),
            detectedLanguage: seg.detectedLanguage || detectedLang,
            languageCode: seg.languageCode || langCode,
            isImportant: Boolean(seg.isImportant),
            isDefinition: Boolean(seg.isDefinition),
            isExample: Boolean(seg.isExample),
            isKeyPoint: Boolean(seg.isKeyPoint),
          };
          runningTime += segDuration;
          return segment;
        });
      }

      // Single text object
      if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
        return [
          {
            id: `trans-${Date.now()}`,
            startTime: Math.round(currentTimestamp),
            endTime: Math.round(currentTimestamp + 5),
            text: parsed.text.trim(),
            topic: parsed.topic || "Live Lecture",
            detectedLanguage: parsed.detectedLanguage || detectedLang,
            languageCode: parsed.languageCode || langCode,
            isImportant: Boolean(parsed.isImportant),
          },
        ];
      }
    } catch {
      // JSON parse error, fall through to plain text
    }
  }

  // 2. Plain text speech fallback
  const cleanedText = rawText.replace(/```json|```/g, "").trim();
  if (cleanedText.length > 0) {
    return [
      {
        id: `trans-${Date.now()}`,
        startTime: Math.round(currentTimestamp),
        endTime: Math.round(currentTimestamp + 5),
        text: cleanedText,
        topic: "Live Lecture",
        detectedLanguage: defaultLanguage,
        isImportant: false,
      },
    ];
  }

  return [];
}

/**
 * Transcribes an audio chunk using the rate-limiting scheduler and Gemini API.
 */
export async function transcribeAudioChunk(
  options: TranscribeChunkOptions
): Promise<TranscriptSegment[]> {
  const {
    audioBase64,
    mimeType,
    currentTimestamp,
    existingContext,
    lectureId = "lecture-active",
    userId,
    sequenceNumber = Math.round(currentTimestamp),
    fallbackText,
    language = "auto",
  } = options;

  console.log(`[TRANSCRIPTION] Audio chunk received (lecture: ${lectureId}, seq: ${sequenceNumber}, lang: ${language})`);

  // Step 1: Validate and normalize audio
  const { cleanBase64, normalizedMime, byteLength } = validateAndNormalizeAudio(
    audioBase64,
    mimeType
  );
  console.log(`[TRANSCRIPTION] Audio validation successful (${byteLength} bytes, ${normalizedMime})`);

  const ai = getGeminiClient();

  if (ai) {
    try {
      const segments = await transcriptionScheduler.enqueue({
        lectureId,
        userId,
        sequenceNumber,
        audioBase64: cleanBase64,
        execute: async () => {
          const langInstruction =
            language && language !== "auto"
              ? `Language Instruction: The speaker is delivering the lecture in ${language}. Transcribe the speech verbatim in that language. Use its authentic native script (e.g., Devanagari for Hindi, Bengali script for Bengali, Tamil script for Tamil, or Roman/Latin script for English/Hinglish). CRITICAL: DO NOT TRANSLATE TO ENGLISH. Preserve technical terminology and jargon accurately.`
              : `Language Instruction: Auto-detect the spoken language (supports English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Spanish, etc.). Transcribe verbatim in the native spoken language and script (e.g. Hindi in Devanagari, English in Latin, Hinglish in Latin/Devanagari as spoken). CRITICAL: DO NOT translate non-English speech to English. Maintain authentic spoken words.`;

          const prompt = `You are the real-time audio transcription engine for LearniX.
Listen carefully to this lecture audio chunk. 
Context so far: "${existingContext || "Start of lecture"}".
${langInstruction}
Transcribe the speech accurately into text.
Identify:
1. The exact spoken words.
2. The detected language and language code (e.g. "Hindi" / "hi", "English" / "en", "Hinglish" / "hi-Latn").
3. The current academic topic (e.g., "Stack Basics", "Push Operation", "Theorem Proof", etc.).
4. Whether this segment contains an important definition, key principle, or illustrative example.

Output valid JSON only with this structure:
{
  "detectedLanguage": "Hindi",
  "languageCode": "hi",
  "segments": [
    {
      "text": "spoken sentence or thought in native script",
      "topic": "topic name",
      "detectedLanguage": "Hindi",
      "languageCode": "hi",
      "isImportant": boolean,
      "isDefinition": boolean,
      "isExample": boolean,
      "isKeyPoint": boolean,
      "durationEstimate": 5
    }
  ]
}`;

          const audioPart = {
            inlineData: {
              mimeType: normalizedMime,
              data: cleanBase64,
            },
          };

          const response = await ai.models.generateContent({
            model: MODELS.TRANSCRIBE,
            contents: {
              parts: [audioPart, { text: prompt }],
            },
          });

          const rawText = extractTextFromResponse(response);
          return parseTranscriptionToSegments(rawText, currentTimestamp, language);
        },
      });

      console.log(`[TRANSCRIPTION] Transcription completed (${segments.length} segments)`);
      return segments;
    } catch (err: any) {
      console.warn(`[TRANSCRIPTION] Gemini transcription failed after scheduling:`, err?.message || err);
      // If error is 400 (invalid argument), re-throw immediately
      if (err instanceof TranscriptionError && err.status === 400) {
        throw err;
      }
    }
  }

  // Step 2: Honest Fallback when Gemini is unavailable or failed
  console.log(`[TRANSCRIPTION] Fallback activated`);

  // If authentic fallback text was captured (e.g. from client Web Speech API)
  if (fallbackText && fallbackText.trim().length > 0) {
    const fallbackSegments: TranscriptSegment[] = [
      {
        id: `trans-fallback-${Date.now()}`,
        startTime: Math.round(currentTimestamp),
        endTime: Math.round(currentTimestamp + 5),
        text: fallbackText.trim(),
        topic: "Live Lecture",
        detectedLanguage: language !== "auto" ? language : undefined,
        isImportant: false,
      },
    ];
    console.log(`[TRANSCRIPTION] Transcription completed using client speech fallback (${fallbackSegments.length} segments)`);
    return fallbackSegments;
  }

  // If no Gemini client and no fallback speech text, return empty or throw honest error
  if (!ai) {
    throw new TranscriptionError(
      "Gemini AI transcription client is not configured and no offline fallback transcript is available.",
      503,
      true
    );
  }

  // If transcription genuinely failed without speech detected
  return [];
}
