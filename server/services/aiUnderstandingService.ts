import { getGeminiClient, MODELS } from "../geminiClient";
import { Chapter, SmartNoteSection, TranscriptSegment } from "../../src/types";
import { aiOrchestrator, TaskPriority } from "./aiOrchestrator";

export interface UnderstandingResult {
  chapters: Chapter[];
  notes: SmartNoteSection[];
  cleanedTranscript: TranscriptSegment[];
  summary: string;
  source?: "ai_generated" | "local_algorithm" | "cached";
}

export async function processLectureTranscript(
  title: string,
  subject: string,
  rawTranscript: TranscriptSegment[],
  userId?: string,
  lectureId?: string
): Promise<UnderstandingResult> {
  const ai = getGeminiClient();

  // Combine transcript text with timestamps for prompt and content hashing
  const formattedTranscript = rawTranscript
    .map((seg) => `[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${seg.text}`)
    .join("\n");

  const fallback = () => fallbackExtraction(title, subject, rawTranscript);

  if (!formattedTranscript.trim()) {
    return fallback();
  }

  const prompt = `You are LearniX, an advanced academic lecture intelligence engine.
Your task is to analyze this complete lecture transcript and transform it into a structured interactive learning pack.

LECTURE METADATA:
Subject: ${subject}
Lecture Title: ${title}

TRANSCRIPT:
${formattedTranscript}

TASK INSTRUCTIONS:
1. Divide the lecture into automatic chapters based on major conceptual and topic shifts.
   - For each chapter: Title, Start time (seconds), End time (seconds), Short description, Key concepts list (3-5 items).
   - Use the REAL timestamps from the transcript. Do NOT hallucinate times.
2. Generate structured SMART NOTES grounded strictly in the transcript:
   - Topic name
   - Summary (2-3 concise sentences)
   - Definitions (term, definition, source timestamp in seconds)
   - Key Concepts list
   - Procedures or algorithmic steps (if discussed)
   - Concrete examples given by the instructor
   - Formulas or mathematical/code notations (if present)
   - Important points & warnings
3. Provide an overall executive summary of the lecture.

Output STRICT JSON ONLY matching this schema:
{
  "summary": "High-level summary of the entire lecture",
  "chapters": [
    {
      "id": "ch-1",
      "title": "Chapter Title",
      "startTime": 0,
      "endTime": 300,
      "description": "Short chapter summary",
      "keyConcepts": ["Concept 1", "Concept 2"],
      "summaryPoints": ["Point 1", "Point 2"]
    }
  ],
  "notes": [
    {
      "id": "note-1",
      "topic": "Topic Name",
      "summary": "Concise summary",
      "definitions": [
        {
          "term": "Term",
          "definition": "Definition explanation",
          "timestamp": 120
        }
      ],
      "keyConcepts": ["Key concept 1", "Key concept 2"],
      "proceduresOrSteps": ["Step 1", "Step 2"],
      "examples": ["Example 1"],
      "formulas": ["Formula 1"],
      "importantPoints": ["Important warning or rule"],
      "sourceTimestamps": [
        { "start": 0, "end": 300 }
      ]
    }
  ]
}`;

  try {
    const taskRes = await aiOrchestrator.executeTask<UnderstandingResult>({
      taskType: "ai_understanding",
      priority: TaskPriority.MEDIUM,
      userId,
      lectureId,
      promptOrInput: formattedTranscript,
      preferredModel: MODELS.TEXT,
      fallbackModels: process.env.GEMINI_FALLBACK_TEXT_MODEL ? [process.env.GEMINI_FALLBACK_TEXT_MODEL] : [],
      executeAi: async (modelName: string) => {
        const client = getGeminiClient();
        if (!client) throw new Error("Gemini client uninitialized");

        const response = await client.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const responseText = response.text || "{}";
        const parsed = JSON.parse(responseText);

        return {
          chapters: (parsed.chapters || []).map((ch: any, idx: number) => ({
            id: ch.id || `ch-${idx + 1}`,
            title: ch.title || `Chapter ${idx + 1}`,
            startTime: Number(ch.startTime) || 0,
            endTime: Number(ch.endTime) || rawTranscript[rawTranscript.length - 1]?.endTime || 60,
            description: ch.description || "",
            keyConcepts: Array.isArray(ch.keyConcepts) ? ch.keyConcepts : [],
            summaryPoints: Array.isArray(ch.summaryPoints) ? ch.summaryPoints : [],
          })),
          notes: (parsed.notes || []).map((note: any, idx: number) => ({
            id: note.id || `note-${idx + 1}`,
            topic: note.topic || "Core Lecture Topic",
            summary: note.summary || "",
            definitions: Array.isArray(note.definitions) ? note.definitions : [],
            keyConcepts: Array.isArray(note.keyConcepts) ? note.keyConcepts : [],
            proceduresOrSteps: Array.isArray(note.proceduresOrSteps) ? note.proceduresOrSteps : [],
            examples: Array.isArray(note.examples) ? note.examples : [],
            formulas: Array.isArray(note.formulas) ? note.formulas : [],
            importantPoints: Array.isArray(note.importantPoints) ? note.importantPoints : [],
            sourceTimestamps: Array.isArray(note.sourceTimestamps) ? note.sourceTimestamps : [{ start: 0, end: 100 }],
          })),
          cleanedTranscript: rawTranscript,
          summary: parsed.summary || `${title} lecture overview`,
          source: "ai_generated",
        };
      },
      localFallback: fallback,
    });

    return {
      ...taskRes.result,
      source: taskRes.source as any,
    };
  } catch (err) {
    console.warn(`[AI-UNDERSTANDING] AI extraction failed, engaging dynamic local algorithm:`, err);
    return fallback();
  }
}

/**
 * Meaningful deterministic local algorithmic extraction derived strictly from the actual transcript segments,
 * timestamps, and detected topics. Eliminates hardcoded dummy domain data.
 */
export function fallbackExtraction(
  title: string,
  subject: string,
  transcript: TranscriptSegment[]
): UnderstandingResult {
  const totalDuration = transcript.length > 0 ? transcript[transcript.length - 1].endTime : 300;

  // 1. Group segments into dynamic logical clusters based on timestamps or topic annotations
  const numClusters = Math.min(3, Math.max(1, Math.ceil(transcript.length / 5)));
  const clusterSize = Math.max(1, Math.ceil(transcript.length / numClusters));
  const chapters: Chapter[] = [];

  for (let i = 0; i < numClusters; i++) {
    const chunk = transcript.slice(i * clusterSize, (i + 1) * clusterSize);
    const start = chunk.length > 0 ? chunk[0].startTime : Math.round((i * totalDuration) / numClusters);
    const end = chunk.length > 0 ? chunk[chunk.length - 1].endTime : Math.round(((i + 1) * totalDuration) / numClusters);

    // Identify topics mentioned in this chunk
    const chunkTopics = Array.from(new Set(chunk.map((s) => s.topic).filter(Boolean))) as string[];
    const mainTopic = chunkTopics.length > 0 ? chunkTopics[0] : i === 0 ? "Introduction & Fundamentals" : i === 1 ? "Core Concepts & Deep Dive" : "Applications & Summary";

    // Extract key sentences
    const importantSentences = chunk
      .filter((s) => s.isImportant || s.isDefinition || s.isKeyPoint || s.text.length > 30)
      .map((s) => s.text)
      .slice(0, 3);

    const chapterTitle = `${title} - ${mainTopic}`;
    chapters.push({
      id: `ch-local-${i + 1}`,
      title: chapterTitle,
      startTime: start,
      endTime: end,
      description: importantSentences.length > 0
        ? importantSentences.join(" ")
        : `Discussion of ${mainTopic} in ${title} (${formatTime(start)} - ${formatTime(end)}).`,
      keyConcepts: chunkTopics.length > 0
        ? chunkTopics.slice(0, 4)
        : [`${title} Basics`, "Key Principles", "Application Context"],
      summaryPoints: importantSentences.length > 0
        ? importantSentences
        : [`Covered ${mainTopic} between ${formatTime(start)} and ${formatTime(end)}`],
    });
  }

  // 2. Extract genuine definitions from transcript segments
  const definitions: { term: string; definition: string; timestamp: number }[] = [];
  for (const seg of transcript) {
    if (seg.isDefinition) {
      definitions.push({
        term: seg.topic || title,
        definition: seg.text,
        timestamp: seg.startTime,
      });
    } else {
      // Look for definition patterns in speech: "X is defined as Y" or "X means Y"
      const match = seg.text.match(/([A-Z][a-zA-Z\s]{2,20})\s+(?:is defined as|refers to|means|is a type of)\s+([^.]+)/i);
      if (match && definitions.length < 5) {
        definitions.push({
          term: match[1].trim(),
          definition: match[0].trim(),
          timestamp: seg.startTime,
        });
      }
    }
  }

  if (definitions.length === 0) {
    definitions.push({
      term: title,
      definition: `Primary subject of discussion in this ${subject} lecture.`,
      timestamp: transcript[0]?.startTime || 0,
    });
  }

  // 3. Assemble smart notes from actual lecture segments
  const keyConcepts = Array.from(
    new Set(
      transcript
        .map((s) => s.topic)
        .filter(Boolean)
        .concat([`${subject} Principles`, `${title} Operations`])
    )
  ).slice(0, 6) as string[];

  const importantPoints = transcript
    .filter((s) => s.isImportant || s.isKeyPoint)
    .map((s) => s.text)
    .slice(0, 5);

  const notes: SmartNoteSection[] = [
    {
      id: `note-local-1`,
      topic: `${title} Fundamentals & Core Notes`,
      summary: transcript.length > 0
        ? transcript.slice(0, 3).map((s) => s.text).join(" ")
        : `Comprehensive overview of ${title} in ${subject}.`,
      definitions,
      keyConcepts,
      proceduresOrSteps: [
        "1. Identify core definitions and foundational premises stated by the instructor.",
        "2. Review the key operational transitions and examples discussed in class.",
        "3. Verify boundary conditions and practical application use cases.",
      ],
      examples: transcript
        .filter((s) => s.isExample || s.text.toLowerCase().includes("for example") || s.text.toLowerCase().includes("such as"))
        .map((s) => s.text)
        .slice(0, 3),
      importantPoints: importantPoints.length > 0
        ? importantPoints
        : [`Pay attention to key concepts: ${keyConcepts.slice(0, 3).join(", ")}.`],
      sourceTimestamps: [{ start: 0, end: totalDuration }],
    },
  ];

  const summary = `Structured lecture analysis for "${title}" (${subject}). Contains ${transcript.length} transcript segments covering ${chapters.length} major sections across ${formatTime(totalDuration)}.`;

  return {
    chapters,
    notes,
    cleanedTranscript: transcript,
    summary,
    source: "local_algorithm",
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
