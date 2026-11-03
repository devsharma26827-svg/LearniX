import { getGeminiClient, MODELS } from "../geminiClient";
import { Lecture, RagResponse, RagSource, SearchResultItem } from "../../src/types";
import { aiOrchestrator, TaskPriority } from "./aiOrchestrator";

export interface AskLectureOptions {
  lecture: Lecture;
  question: string;
  allowGeneralKnowledgeFallback?: boolean;
}

export async function askTheLecture(options: AskLectureOptions): Promise<RagResponse> {
  const { lecture, question, allowGeneralKnowledgeFallback } = options;

  // Find relevant transcript segments
  const relevantSegments = findRelevantSegments(lecture, question, 5);

  const contextText = relevantSegments
    .map((seg) => `[Timestamp: ${formatTime(seg.startTime)} | Topic: ${seg.topic || "General"}]\n"${seg.text}"`)
    .join("\n\n");

  const sources: RagSource[] = relevantSegments.map((seg) => {
    const ch = lecture.chapters.find((c) => seg.startTime >= c.startTime && seg.startTime <= c.endTime) || lecture.chapters[0];
    return {
      chapter: ch ? ch.title : seg.topic || "Lecture Content",
      timestamp: seg.startTime,
      context: seg.text,
      relevanceScore: 0.9,
    };
  });

  const fallback = () => fallbackRagAnswer(lecture, question, relevantSegments, sources);

  try {
    const taskRes = await aiOrchestrator.executeTask<RagResponse>({
      taskType: "rag_query",
      priority: TaskPriority.NORMAL,
      userId: lecture.createdBy,
      lectureId: lecture.id,
      promptOrInput: `${lecture.id}:${question}:${allowGeneralKnowledgeFallback}`,
      preferredModel: MODELS.TEXT,
      fallbackModels: process.env.GEMINI_FALLBACK_TEXT_MODEL ? [process.env.GEMINI_FALLBACK_TEXT_MODEL] : [],
      executeAi: async (modelName: string) => {
        const client = getGeminiClient();
        if (!client) throw new Error("Gemini client uninitialized");

        const systemInstruction = `You are the "Ask the Lecture" AI Assistant for LearniX.
CRITICAL MANDATE - GROUNDING & HALLUCINATION PREVENTION:
1. You answer questions based STRICTLY and ONLY on the provided lecture context transcript below.
2. If the answer is NOT present or discussed in the lecture transcript, you MUST explicitly say:
   "I couldn't find this information in the lecture."
3. Do NOT make up, assume, or hallucinate facts that the instructor did not state.
4. If appropriate, you may mention when in the lecture a related topic was touched upon.
5. Provide a direct, concise, academically rigorous answer.
6. If the user explicitly asks for general knowledge or if ${allowGeneralKnowledgeFallback ? "true" : "false"} is enabled and lecture lacks info, state clearly that it was not in the lecture before providing general knowledge.`;

        const userPrompt = `LECTURE TITLE: "${lecture.title}" (${lecture.subject})
INSTRUCTOR: ${lecture.instructor || "Instructor"}

RETRIEVED LECTURE EXCERPTS:
${contextText || "No matching lecture excerpts found."}

STUDENT QUESTION:
"${question}"

Provide a grounded response. Include whether the answer is based on the lecture.`;

        const response = await client.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction,
            temperature: 0.1,
          },
        });

        const answerText = response.text || "I couldn't find this information in the lecture.";
        const isNotFound =
          answerText.toLowerCase().includes("couldn't find") ||
          answerText.toLowerCase().includes("not found in the lecture") ||
          answerText.toLowerCase().includes("wasn't covered");

        return {
          answer: answerText,
          sources: isNotFound ? [] : sources,
          isLectureGrounded: !isNotFound,
          generalKnowledgeOffered: isNotFound,
        };
      },
      localFallback: fallback,
    });

    return taskRes.result;
  } catch (err) {
    console.warn(`[RAG-SERVICE] AI RAG answering failed, engaging local semantic grounded search:`, err);
    return fallback();
  }
}

export function findRelevantSegments(lecture: Lecture, query: string, maxResults = 5) {
  const queryWords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const scored = lecture.transcript.map((seg) => {
    let score = 0;
    const textLower = seg.text.toLowerCase();
    const topicLower = (seg.topic || "").toLowerCase();

    for (const word of queryWords) {
      if (textLower.includes(word)) score += 3;
      if (topicLower.includes(word)) score += 5;
    }

    if (seg.isImportant) score += 1;
    if (seg.isDefinition) score += 1;

    return { seg, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((item) => item.seg);
}

export function fallbackRagAnswer(
  lecture: Lecture,
  question: string,
  relevantSegments: any[],
  sources: RagSource[]
): RagResponse {
  if (relevantSegments.length === 0) {
    return {
      answer: `I couldn't find information about "${question}" in this lecture on "${lecture.title}". The instructor did not explicitly cover this during the recorded session.`,
      sources: [],
      isLectureGrounded: false,
      generalKnowledgeOffered: true,
    };
  }

  const primary = relevantSegments[0];
  const matchingChapter = lecture.chapters.find((c) => primary.startTime >= c.startTime && primary.startTime <= c.endTime);

  return {
    answer: `According to the lecture (discussed around ${formatTime(primary.startTime)} in "${matchingChapter?.title || primary.topic}"), the instructor explained: "${primary.text}"`,
    sources: sources.slice(0, 2),
    isLectureGrounded: true,
  };
}

export function searchLectureContent(lecture: Lecture, query: string): SearchResultItem[] {
  if (!query || query.trim().length === 0) return [];
  const q = query.toLowerCase().trim();
  const results: SearchResultItem[] = [];

  // Search Transcript
  for (const seg of lecture.transcript) {
    if (seg.text.toLowerCase().includes(q) || (seg.topic && seg.topic.toLowerCase().includes(q))) {
      const ch = lecture.chapters.find((c) => seg.startTime >= c.startTime && seg.startTime <= c.endTime);
      results.push({
        lectureId: lecture.id,
        lectureTitle: lecture.title,
        chapterTitle: ch ? ch.title : seg.topic || "Lecture Transcript",
        timestamp: seg.startTime,
        text: seg.text,
        matchType: "transcript",
      });
    }
  }

  // Search Notes & Definitions
  for (const note of lecture.notes) {
    for (const def of note.definitions) {
      if (def.term.toLowerCase().includes(q) || def.definition.toLowerCase().includes(q)) {
        results.push({
          lectureId: lecture.id,
          lectureTitle: lecture.title,
          chapterTitle: note.topic,
          timestamp: def.timestamp || note.sourceTimestamps[0]?.start || 0,
          text: `[Definition] ${def.term}: ${def.definition}`,
          matchType: "definitions",
        });
      }
    }
    for (const concept of note.keyConcepts) {
      if (concept.toLowerCase().includes(q)) {
        results.push({
          lectureId: lecture.id,
          lectureTitle: lecture.title,
          chapterTitle: note.topic,
          timestamp: note.sourceTimestamps[0]?.start || 0,
          text: `[Key Concept] ${concept}`,
          matchType: "concept",
        });
      }
    }
  }

  return results.slice(0, 15);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
