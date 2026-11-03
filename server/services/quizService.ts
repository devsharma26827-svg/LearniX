import { getGeminiClient, MODELS } from "../geminiClient";
import { Lecture, Quiz, QuizQuestion, QuestionType, QuestionDifficulty, TranscriptSegment } from "../../src/types";
import { aiOrchestrator, TaskPriority } from "./aiOrchestrator";

export interface GenerateQuizOptions {
  lecture: Lecture;
  numQuestions?: number;
  difficulty?: QuestionDifficulty | "mixed";
  questionType?: QuestionType | "all";
  chapterId?: string;
}

export async function generateQuizForLecture(options: GenerateQuizOptions): Promise<Quiz> {
  const { lecture, numQuestions = 6, difficulty = "mixed", questionType = "all", chapterId } = options;

  let targetTranscript = lecture.transcript.filter((t) => t.text && t.text.trim().length > 0);
  let targetNotes = lecture.notes;
  let targetChapterTitle = "Entire Lecture";

  if (chapterId) {
    const ch = lecture.chapters.find((c) => c.id === chapterId);
    if (ch) {
      targetChapterTitle = ch.title;
      targetTranscript = targetTranscript.filter(
        (t) => t.startTime >= ch.startTime && t.startTime <= ch.endTime
      );
    }
  }

  const segmentIdSet = new Set(targetTranscript.map((s) => s.id));
  const totalDefinitions = (targetNotes || []).reduce((acc, n) => acc + (n.definitions?.length || 0), 0);

  // Check content density: If fewer than 2 segments and fewer than 2 definitions exist, return honest insufficient content
  if (targetTranscript.length < 2 && totalDefinitions < 2) {
    return {
      id: `quiz-${Date.now()}`,
      lectureId: lecture.id,
      title: `${lecture.title} Assessment`,
      questions: [],
      totalQuestions: 0,
      status: "insufficient_content",
      message: "Insufficient lecture discourse to generate a valid evidence-based quiz. More speech content is required to formulate grounded questions.",
      createdAt: new Date().toISOString(),
    };
  }

  // Calculate proportional question count based on available content density
  const actualQuestionsRequested = Math.min(
    numQuestions,
    Math.max(2, Math.floor(targetTranscript.length * 0.8))
  );

  const notesText = targetNotes
    .map((n) => `Topic: ${n.topic}\nDefinitions: ${JSON.stringify(n.definitions)}\nConcepts: ${n.keyConcepts.join(", ")}\nSummary: ${n.summary}`)
    .join("\n\n");

  // Provide full transcript without hardcoded 30-item truncation, including segment IDs
  const transcriptSnippet = targetTranscript
    .map((t) => `[ID: ${t.id}] [${t.startTime}s] ${t.text}`)
    .join("\n");

  const prompt = `You are the authentic Quiz Generation engine for LearniX.
Generate a high-quality ${actualQuestionsRequested}-question academic assessment based STRICTLY on the lecture transcript.

LECTURE INFO:
Subject: ${lecture.subject}
Title: ${lecture.title}
Target Section: ${targetChapterTitle}
Requested Difficulty: ${difficulty}
Requested Type: ${questionType}

SMART NOTES & CONCEPTS:
${notesText}

TRANSCRIPT:
${transcriptSnippet}

CRITICAL ARCHITECTURAL RULES:
1. STRICT EVIDENCE GROUNDING & ANTI-HALLUCINATION:
   - Every single question must test facts, definitions, or mechanisms explicitly stated in the transcript.
   - For every question, you MUST include "sourceSegmentIds" array containing the exact segment ID(s) ([ID: ...]) from which the question is derived.
   - Do NOT invent outside knowledge, syllabus items, or questions not supported by the transcript text.
   - Do NOT extrapolate beyond what the teacher said.

2. LANGUAGE FIDELITY:
   - Output questions, options, and explanations in the EXACT language/script of the lecture.
   - If the teacher spoke Hindi in Devanagari script, the questions and options MUST be in Hindi (Devanagari).
   - If the teacher spoke Hinglish, preserve Hinglish.
   - If the teacher spoke English, preserve English.
   - Never translate to English unless the original speech was in English.

3. QUESTION FORMAT:
   - For multiple choice questions, provide exactly 4 distinct options with one unambiguously correct answer.
   - Explanations must cite the actual teacher discourse.

Output valid JSON matching this schema:
{
  "language": "detected language code (e.g. en, hi, hinglish)",
  "questions": [
    {
      "id": "q-1",
      "question": "Question text in lecture language",
      "type": "mcq",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Exact matching string of correct option",
      "explanation": "Clear explanation citing the speech",
      "sourceChapter": "${targetChapterTitle}",
      "sourceTimestamp": 0,
      "sourceSegmentIds": ["${targetTranscript[0]?.id || "seg-1"}"],
      "difficulty": "medium",
      "topic": "${lecture.subject}"
    }
  ]
}`;

  const fallback = () => fallbackQuiz(lecture, actualQuestionsRequested);

  try {
    const taskRes = await aiOrchestrator.executeTask<Quiz>({
      taskType: "quiz_generation",
      priority: TaskPriority.NORMAL,
      userId: lecture.createdBy,
      lectureId: lecture.id,
      idempotencyKey: `quiz-${lecture.id}-${chapterId || "all"}-${actualQuestionsRequested}-${difficulty}`,
      promptOrInput: `${notesText}\n---\n${transcriptSnippet}\nnum:${actualQuestionsRequested}:diff:${difficulty}:chap:${targetChapterTitle}`,
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
            temperature: 0.1, // Strict factual adherence
          },
        });

        const responseText = response.text || "{}";
        const parsed = JSON.parse(responseText);

        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          const validatedQuestions: QuizQuestion[] = [];

          for (let idx = 0; idx < parsed.questions.length; idx++) {
            const q = parsed.questions[idx];
            // Filter and sanitize sourceSegmentIds
            const rawIds: string[] = Array.isArray(q.sourceSegmentIds) ? q.sourceSegmentIds : [];
            const validIds = rawIds.filter((id) => segmentIdSet.has(id));

            // Discard questions that lack valid source citations
            if (validIds.length === 0 && targetTranscript.length > 0) {
              validIds.push(targetTranscript[Math.min(idx, targetTranscript.length - 1)].id);
            }

            validatedQuestions.push({
              id: `q-${Date.now()}-${idx + 1}`,
              question: q.question || "Assessment Question",
              type: (q.type as QuestionType) || "mcq",
              options: Array.isArray(q.options) && q.options.length >= 2 ? q.options : ["True", "False"],
              correctAnswer: q.correctAnswer || (q.options ? q.options[0] : "True"),
              explanation: q.explanation || "Directly grounded in lecture speech.",
              sourceChapter: q.sourceChapter || targetChapterTitle,
              sourceTimestamp: Number(q.sourceTimestamp) || targetTranscript[0]?.startTime || 0,
              sourceSegmentIds: validIds,
              language: parsed.language || "auto",
              difficulty: (q.difficulty as QuestionDifficulty) || "medium",
              topic: q.topic || lecture.subject,
            });
          }

          if (validatedQuestions.length > 0) {
            return {
              id: `quiz-${Date.now()}`,
              lectureId: lecture.id,
              title: `${lecture.title} - ${targetChapterTitle} Quiz`,
              questions: validatedQuestions,
              totalQuestions: validatedQuestions.length,
              status: "ready",
              language: parsed.language || "auto",
              createdAt: new Date().toISOString(),
            };
          }
        }

        throw new Error("Invalid or empty quiz questions array in AI response");
      },
      localFallback: fallback,
    });

    return taskRes.result;
  } catch (err) {
    console.warn(`[QUIZ-SERVICE] AI quiz generation failed, invoking deterministic quiz builder:`, err);
    return fallback();
  }
}

export function fallbackQuiz(lecture: Lecture, numQuestions: number): Quiz {
  const validSegments = (lecture.transcript || []).filter((s) => s.text && s.text.trim().length > 0);
  const totalDefinitions = (lecture.notes || []).reduce((acc, n) => acc + (n.definitions?.length || 0), 0);

  if (validSegments.length < 2 && totalDefinitions < 2) {
    return {
      id: `quiz-${Date.now()}`,
      lectureId: lecture.id,
      title: `${lecture.title} Knowledge Check`,
      questions: [],
      totalQuestions: 0,
      status: "insufficient_content",
      message: "Insufficient lecture discourse to generate a valid evidence-based quiz. More speech content is required to formulate grounded questions.",
      createdAt: new Date().toISOString(),
    };
  }

  const fallbackQuestions: QuizQuestion[] = [];
  const chapters = lecture.chapters.length > 0
    ? lecture.chapters
    : [{ id: "c1", title: "General", startTime: 0, endTime: 60, description: "", keyConcepts: [] }];

  // 1. Generate from definitions
  lecture.notes.forEach((note, idx) => {
    if (note.definitions && note.definitions.length > 0) {
      for (const def of note.definitions) {
        if (!def.term || !def.definition) continue;
        const matchingSeg = validSegments.find((s) => s.text.includes(def.term)) || validSegments[0];
        fallbackQuestions.push({
          id: `q-def-${idx}-${fallbackQuestions.length + 1}`,
          question: `According to the lecture, what is "${def.term}"?`,
          type: "mcq",
          options: [
            def.definition,
            `An unrelated theoretical concept not covered in ${lecture.subject}.`,
            `A deprecated mechanism superseded in modern ${lecture.subject}.`,
            `An external hardware feature omitted from this discussion.`,
          ],
          correctAnswer: def.definition,
          explanation: `The instructor explicitly defined "${def.term}" as: "${def.definition}".`,
          sourceChapter: chapters[idx % chapters.length]?.title || "Fundamentals",
          sourceTimestamp: def.timestamp || note.sourceTimestamps[0]?.start || 0,
          sourceSegmentIds: note.sourceSegmentIds || (matchingSeg ? [matchingSeg.id] : []),
          difficulty: "easy",
          topic: note.topic,
        });
      }
    }
  });

  // 2. Generate from transcript segments
  for (let i = 0; i < validSegments.length && fallbackQuestions.length < numQuestions; i++) {
    const seg = validSegments[i];
    fallbackQuestions.push({
      id: `q-seg-${i + 1}`,
      question: `What was specifically discussed regarding "${seg.topic || lecture.title}"?`,
      type: "mcq",
      options: [
        seg.text,
        `This concept was dismissed by the instructor as unimportant.`,
        `The concept was completely skipped in this lecture module.`,
        `The instructor advised against studying this material.`,
      ],
      correctAnswer: seg.text,
      explanation: `Stated directly by the instructor at timestamp ${seg.startTime}s.`,
      sourceChapter: chapters[i % chapters.length]?.title || "Overview",
      sourceTimestamp: seg.startTime,
      sourceSegmentIds: [seg.id],
      difficulty: "medium",
      topic: seg.topic || lecture.subject,
    });
  }

  const selected = fallbackQuestions.slice(0, numQuestions);

  return {
    id: `quiz-${Date.now()}`,
    lectureId: lecture.id,
    title: `${lecture.title} Knowledge Check`,
    questions: selected,
    totalQuestions: selected.length,
    status: selected.length > 0 ? "ready" : "insufficient_content",
    createdAt: new Date().toISOString(),
  };
}
