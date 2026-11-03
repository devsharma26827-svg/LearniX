import { getGeminiClient, MODELS } from "../geminiClient";
import { Chapter, SmartNoteSection, TranscriptSegment } from "../../src/types";
import { aiOrchestrator, TaskPriority } from "./aiOrchestrator";

export interface UnderstandingResult {
  chapters: Chapter[];
  notes: SmartNoteSection[];
  cleanedTranscript: TranscriptSegment[];
  summary: string;
  language?: string;
  source?: "ai_generated" | "local_algorithm" | "cached";
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export async function processLectureTranscript(
  title: string,
  subject: string,
  rawTranscript: TranscriptSegment[],
  userId?: string,
  lectureId?: string
): Promise<UnderstandingResult> {
  const validSegments = rawTranscript.filter((s) => s.text && s.text.trim().length > 0);
  const segmentIdSet = new Set(validSegments.map((s) => s.id));

  const fallback = () => fallbackExtraction(title, subject, validSegments);

  if (validSegments.length === 0) {
    return fallback();
  }

  // Format transcript with explicit segment IDs and timestamps for provenance tracking
  const formattedTranscript = validSegments
    .map((seg) => `[ID: ${seg.id}] [${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${seg.text}`)
    .join("\n");

  const isShortLecture = validSegments.length <= 4;

  const prompt = `You are LearniX, an authentic academic lecture intelligence engine.
Your task is to analyze this complete lecture transcript and transform it into a structured, evidence-grounded interactive learning pack.

LECTURE METADATA:
Subject: ${subject}
Lecture Title: ${title}

TRANSCRIPT:
${formattedTranscript}

CRITICAL ARCHITECTURAL RULES:
1. LANGUAGE FIDELITY:
   - Preserve the EXACT language and script of the spoken speech.
   - If the teacher spoke Hindi in Devanagari script, the summary, notes, and key concepts MUST be in Hindi (Devanagari).
   - If the teacher spoke Hinglish (Hindi words in Roman/English script), preserve Hinglish.
   - If the teacher spoke English, preserve English.
   - NEVER translate speech into English or any other language unless explicitly requested.

2. EVIDENCE-BASED GROUNDING & ANTI-HALLUCINATION:
   - Every note section, definition, and concept MUST be derived strictly and exclusively from the spoken transcript text.
   - For every note section, you MUST populate "sourceSegmentIds" with the exact segment IDs ([ID: ...]) that substantiate that section.
   - Do NOT invent, assume, or extrapolate outside syllabus details not spoken in the transcript.

3. PROPORTIONALITY:
   ${isShortLecture
     ? "- This is a short or focused lecture segment. Produce exactly 1 concise chapter and 1 note section faithfully representing what was spoken. Do NOT hallucinate extra topics."
     : "- Structure the lecture into logical chapters matching the actual topic shifts in the lecture timeline."}

Output STRICT JSON ONLY matching this schema:
{
  "summary": "High-level summary faithful to spoken lecture language",
  "language": "detected language code or name (e.g. en, hi, hinglish)",
  "chapters": [
    {
      "id": "ch-1",
      "title": "Chapter Title",
      "startTime": 0,
      "endTime": 60,
      "description": "Short chapter description in lecture language",
      "keyConcepts": ["Concept 1", "Concept 2"],
      "summaryPoints": ["Point 1", "Point 2"]
    }
  ],
  "notes": [
    {
      "id": "note-1",
      "topic": "Topic Name",
      "summary": "Concise summary in lecture language",
      "sourceSegmentIds": ["${validSegments[0]?.id || "seg-1"}"],
      "definitions": [
        {
          "term": "Term in lecture language",
          "definition": "Definition explanation from speech",
          "timestamp": 0
        }
      ],
      "keyConcepts": ["Key concept 1"],
      "proceduresOrSteps": [],
      "examples": [],
      "formulas": [],
      "importantPoints": [],
      "sourceTimestamps": [
        { "start": 0, "end": 60 }
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
      fallbackModels: [MODELS.FALLBACK_TEXT, "gemini-2.5-flash", "gemini-2.0-flash"].filter(
        (m) => Boolean(m) && m !== MODELS.TEXT
      ),
      executeAi: async (modelName: string) => {
        const client = getGeminiClient();
        if (!client) throw new Error("Gemini client uninitialized");

        const response = await client.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.1, // Low temperature for high factual adherence
          },
        });

        const responseText = response.text || "{}";
        const parsed = JSON.parse(responseText);

        const totalEndTime = validSegments[validSegments.length - 1]?.endTime || 60;

        const chapters: Chapter[] = (parsed.chapters || []).map((ch: any, idx: number) => ({
          id: ch.id || `ch-${idx + 1}`,
          title: ch.title || (isShortLecture ? title : `Chapter ${idx + 1}`),
          startTime: Number(ch.startTime) || 0,
          endTime: Math.min(Number(ch.endTime) || totalEndTime, totalEndTime),
          description: ch.description || "",
          keyConcepts: Array.isArray(ch.keyConcepts) ? ch.keyConcepts : [],
          summaryPoints: Array.isArray(ch.summaryPoints) ? ch.summaryPoints : [],
        }));

        const notes: SmartNoteSection[] = (parsed.notes || []).map((note: any, idx: number) => {
          // Verify and sanitize cited sourceSegmentIds
          const rawIds: string[] = Array.isArray(note.sourceSegmentIds) ? note.sourceSegmentIds : [];
          const validIds = rawIds.filter((id) => segmentIdSet.has(id));
          const finalSegmentIds = validIds.length > 0 ? validIds : [validSegments[Math.min(idx, validSegments.length - 1)].id];

          return {
            id: note.id || `note-${idx + 1}`,
            topic: note.topic || (isShortLecture ? title : "Key Discourse"),
            summary: note.summary || "",
            sourceSegmentIds: finalSegmentIds,
            language: parsed.language || "auto",
            confidence: "supported",
            definitions: Array.isArray(note.definitions) ? note.definitions : [],
            keyConcepts: Array.isArray(note.keyConcepts) ? note.keyConcepts : [],
            proceduresOrSteps: Array.isArray(note.proceduresOrSteps) ? note.proceduresOrSteps : [],
            examples: Array.isArray(note.examples) ? note.examples : [],
            formulas: Array.isArray(note.formulas) ? note.formulas : [],
            importantPoints: Array.isArray(note.importantPoints) ? note.importantPoints : [],
            sourceTimestamps: Array.isArray(note.sourceTimestamps) && note.sourceTimestamps.length > 0
              ? note.sourceTimestamps
              : [{ start: 0, end: totalEndTime }],
          };
        });

        return {
          chapters: chapters.length > 0 ? chapters : fallback().chapters,
          notes: notes.length > 0 ? notes : fallback().notes,
          cleanedTranscript: validSegments,
          summary: parsed.summary || `${title} lecture summary.`,
          language: parsed.language || "auto",
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
  const totalDuration = transcript.length > 0 ? transcript[transcript.length - 1].endTime : 60;
  const validSegments = transcript.filter((s) => s.text && s.text.trim().length > 0);

  if (validSegments.length === 0) {
    return {
      chapters: [
        {
          id: "ch-1",
          title: "Lecture Introduction",
          startTime: 0,
          endTime: 60,
          description: `Introduction to ${title}.`,
          keyConcepts: [subject, title],
          summaryPoints: [`Overview of ${subject}`],
        },
      ],
      notes: [
        {
          id: "note-1",
          topic: title,
          summary: `Introductory overview for ${title} under ${subject}.`,
          sourceSegmentIds: [],
          definitions: [],
          keyConcepts: [title],
          proceduresOrSteps: [],
          examples: [],
          formulas: [],
          importantPoints: [],
          sourceTimestamps: [{ start: 0, end: 60 }],
        },
      ],
      cleanedTranscript: [],
      summary: `${title} lecture overview.`,
      source: "local_algorithm",
    };
  }

  // Extract genuine definitions from transcript segments
  const definitions: { term: string; definition: string; timestamp: number }[] = [];
  for (const seg of validSegments) {
    if (seg.isDefinition) {
      definitions.push({
        term: seg.topic || title,
        definition: seg.text,
        timestamp: seg.startTime,
      });
    } else {
      const match = seg.text.match(/([A-Z][a-zA-Z\s]{2,25})\s+(?:is defined as|refers to|means|is a type of|is a)\s+([^.]+)/i);
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
      definition: `Core lecture content for ${title}.`,
      timestamp: validSegments[0]?.startTime || 0,
    });
  }

  // Short lecture: single cohesive chapter and note
  if (validSegments.length <= 4) {
    const allText = validSegments.map((s) => s.text).join(" ");
    const segmentIds = validSegments.map((s) => s.id);
    return {
      chapters: [
        {
          id: "ch-1",
          title: title,
          startTime: validSegments[0].startTime,
          endTime: validSegments[validSegments.length - 1].endTime,
          description: allText.slice(0, 160),
          keyConcepts: [title, subject],
          summaryPoints: [allText.slice(0, 120)],
        },
      ],
      notes: [
        {
          id: "note-1",
          topic: title,
          summary: allText,
          sourceSegmentIds: segmentIds,
          confidence: "supported",
          definitions,
          keyConcepts: Array.from(new Set(validSegments.map((s) => s.topic || title))),
          proceduresOrSteps: [],
          examples: validSegments.filter((s) => s.isExample).map((s) => s.text),
          formulas: [],
          importantPoints: validSegments.filter((s) => s.isImportant || s.isKeyPoint).map((s) => s.text),
          sourceTimestamps: [
            {
              start: validSegments[0].startTime,
              end: validSegments[validSegments.length - 1].endTime,
            },
          ],
        },
      ],
      cleanedTranscript: validSegments,
      summary: `${title} - ${allText}`,
      source: "local_algorithm",
    };
  }

  // Segment clustering for longer lectures (e.g. 5+ segments)
  const chapters: Chapter[] = [];
  const notes: SmartNoteSection[] = [];
  const clusterSize = Math.max(3, Math.ceil(validSegments.length / 4));

  for (let i = 0; i < validSegments.length; i += clusterSize) {
    const cluster = validSegments.slice(i, i + clusterSize);
    const start = cluster[0].startTime;
    const end = cluster[cluster.length - 1].endTime;
    const topic = cluster[0].topic || `Section ${Math.floor(i / clusterSize) + 1}`;
    const clusterText = cluster.map((s) => s.text).join(". ");
    const clusterIds = cluster.map((s) => s.id);

    const chId = `ch-${Math.floor(i / clusterSize) + 1}`;
    chapters.push({
      id: chId,
      title: topic,
      startTime: start,
      endTime: end,
      description: clusterText.slice(0, 140),
      keyConcepts: [topic],
      summaryPoints: cluster.slice(0, 3).map((s) => s.text.slice(0, 80)),
    });

    notes.push({
      id: `note-${Math.floor(i / clusterSize) + 1}`,
      topic,
      summary: clusterText.slice(0, 250),
      sourceSegmentIds: clusterIds,
      confidence: "supported",
      definitions: cluster
        .filter((s) => s.isDefinition)
        .map((s) => ({ term: topic, definition: s.text, timestamp: s.startTime })),
      keyConcepts: [topic],
      proceduresOrSteps: [],
      examples: cluster.filter((s) => s.isExample).map((s) => s.text),
      formulas: [],
      importantPoints: cluster.filter((s) => s.isImportant || s.isKeyPoint).map((s) => s.text),
      sourceTimestamps: [{ start, end }],
    });
  }

  return {
    chapters,
    notes,
    cleanedTranscript: validSegments,
    summary: `${title} comprehensive lecture analysis with ${chapters.length} structured topics.`,
    source: "local_algorithm",
  };
}
