import { GoogleGenAI } from "@google/genai";
import { TranscriptSegment } from "../../../src/types";
import { getAiConfig } from "../../config/aiConfig";
import { getGeminiClient, MODELS } from "../../geminiClient";
import { classifyAiError, ErrorClassification, isDailyQuotaCurrentlyExhausted } from "../errorClassifier";

export interface TranscribeRequest {
  audioBase64: string;
  mimeType: string;
  currentTimestamp: number;
  existingContext?: string;
  language?: string;
}

export interface TranscriptionProvider {
  name: string;
  isAvailable(): boolean;
  transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]>;
  classifyError(err: any): ErrorClassification;
}

/**
 * Extracts transcribed speech text from Gemini API response candidates.
 */
export function extractTextFromGeminiResponse(response: any): string {
  if (!response) return "";

  const candidate = response.candidates?.[0];
  if (!candidate) {
    return typeof response.text === "string" ? response.text : "";
  }

  const parts = candidate.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    try {
      return typeof response.text === "string" ? response.text : "";
    } catch {
      return "";
    }
  }

  const textSnippets: string[] = [];

  for (const part of parts) {
    if (!part) continue;

    if (typeof part.text === "string" && !part.thought) {
      textSnippets.push(part.text);
    }

    if (part.audioTranscription && typeof part.audioTranscription.text === "string") {
      textSnippets.push(part.audioTranscription.text);
    }
  }

  return textSnippets.join("\n").trim();
}

/**
 * Parses raw Gemini JSON or text response into structured TranscriptSegment array.
 */
export function parseResponseToSegments(
  rawText: string,
  currentTimestamp: number,
  fallbackLanguage?: string
): TranscriptSegment[] {
  if (!rawText || rawText.trim().length === 0) {
    return [];
  }

  // 1. JSON parsing branch
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const detectedLang = parsed.detectedLanguage || fallbackLanguage;
      const langCode = parsed.languageCode || (detectedLang === "Hindi" ? "hi" : detectedLang === "English" ? "en" : undefined);

      if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
        let runningTime = currentTimestamp;
        return parsed.segments.map((seg: any, idx: number) => {
          const segDuration =
            typeof seg.durationEstimate === "number" && seg.durationEstimate > 0
              ? seg.durationEstimate
              : 5;
          const segment: TranscriptSegment = {
            id: `seg-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
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

      if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
        return [
          {
            id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
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

  // 2. Cleaned markdown / raw text branch
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  if (cleaned.length > 0) {
    return [
      {
        id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        startTime: Math.round(currentTimestamp),
        endTime: Math.round(currentTimestamp + 5),
        text: cleaned,
        topic: "Live Lecture",
        detectedLanguage: fallbackLanguage,
        isImportant: false,
      },
    ];
  }

  return [];
}

/**
 * Official Gemini Live Audio Transcription Provider.
 */
export class GeminiTranscriptionProvider implements TranscriptionProvider {
  public name = "GeminiTranscriptionProvider";

  public isAvailable(): boolean {
    const config = getAiConfig();
    return Boolean(config.apiKey) && !isDailyQuotaCurrentlyExhausted();
  }

  public classifyError(err: any): ErrorClassification {
    return classifyAiError(err);
  }

  public async transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]> {
    const { audioBase64, mimeType, currentTimestamp, existingContext, language = "auto" } = request;

    if (isDailyQuotaCurrentlyExhausted()) {
      const quotaErr = new Error("Daily free-tier request quota limit reached for Gemini API.");
      (quotaErr as any).status = 429;
      (quotaErr as any).message = "generate_content_free_tier_requests daily limit exhausted";
      throw quotaErr;
    }

    const ai = getGeminiClient();
    if (!ai) {
      const noClientErr = new Error("Gemini AI client is not initialized.");
      (noClientErr as any).status = 503;
      throw noClientErr;
    }

    const config = getAiConfig();
    const model = config.models.transcribe || MODELS.TRANSCRIBE;

    const langInstruction =
      language && language !== "auto"
        ? `The speaker is delivering the lecture in ${language}. Transcribe speech verbatim in that language. Use its authentic native script (e.g. Devanagari for Hindi or Marathi, Bengali script for Bengali, Tamil script for Tamil, Latin script for English/Hinglish). CRITICAL: DO NOT TRANSLATE TO ENGLISH. Preserve technical terminology and jargon accurately.`
        : `Auto-detect the spoken language (supports English, Hindi, Hinglish, Bengali, Tamil, Telugu, Marathi, Spanish, etc.). Transcribe verbatim in the native spoken language and script (e.g. Hindi in authentic Devanagari script, English in Latin, Hinglish as spoken). CRITICAL: DO NOT translate non-English speech to English. Maintain authentic spoken words.`;

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
      "text": "spoken sentence in authentic native script",
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
        mimeType,
        data: audioBase64,
      },
    };

    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [audioPart, { text: prompt }],
      },
    });

    const rawText = extractTextFromGeminiResponse(response);
    return parseResponseToSegments(rawText, currentTimestamp, language);
  }
}

export const defaultTranscriptionProvider = new GeminiTranscriptionProvider();
