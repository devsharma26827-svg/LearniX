import { getGeminiClient, MODELS } from "../geminiClient";
import { Lecture, Quiz, QuizQuestion, QuestionType, QuestionDifficulty } from "../../src/types";
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

  // Filter content if specific chapter selected
  let targetTranscript = lecture.transcript;
  let targetNotes = lecture.notes;
  let targetChapterTitle = "Entire Lecture";

  if (chapterId) {
    const ch = lecture.chapters.find((c) => c.id === chapterId);
    if (ch) {
      targetChapterTitle = ch.title;
      targetTranscript = lecture.transcript.filter((t) => t.startTime >= ch.startTime && t.startTime <= ch.endTime);
    }
  }

  const notesText = targetNotes
    .map((n) => `Topic: ${n.topic}\nDefinitions: ${JSON.stringify(n.definitions)}\nConcepts: ${n.keyConcepts.join(", ")}\nSummary: ${n.summary}`)
    .join("\n\n");
  const transcriptSnippet = targetTranscript.slice(0, 30).map((t) => `[${t.startTime}s] ${t.text}`).join("\n");

  const prompt = `You are the Quiz Generation engine for LearniX.
Generate a high-quality ${numQuestions}-question academic assessment based STRICTLY on this lecture.

LECTURE INFO:
Subject: ${lecture.subject}
Title: ${lecture.title}
Target Section: ${targetChapterTitle}
Requested Difficulty: ${difficulty}
Requested Type: ${questionType}

SMART NOTES & CONCEPTS:
${notesText}

TRANSCRIPT EXCERPTS:
${transcriptSnippet}

CRITICAL INSTRUCTIONS:
1. Every question must be grounded in the provided lecture.
2. For each question, link it to the exact source chapter name, topic name, and real source timestamp from the lecture.
3. Include an academic explanation of why the correct answer is right and why distractors are wrong.
4. If MCQ, provide 4 distinct plausible options with one clear correct answer.

Output valid JSON matching this schema:
{
  "questions": [
    {
      "id": "q-1",
      "question": "Question text here?",
      "type": "mcq",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Exact matching string of correct option",
      "explanation": "Clear explanation grounded in lecture",
      "sourceChapter": "Chapter Name",
      "sourceTimestamp": 120,
      "difficulty": "easy",
      "topic": "Specific Topic Name"
    }
  ]
}`;

  const fallback = () => fallbackQuiz(lecture, numQuestions);

  try {
    const taskRes = await aiOrchestrator.executeTask<Quiz>({
      taskType: "quiz_generation",
      priority: TaskPriority.NORMAL,
      userId: lecture.createdBy,
      lectureId: lecture.id,
      idempotencyKey: `quiz-${lecture.id}-${chapterId || "all"}-${numQuestions}-${difficulty}`,
      promptOrInput: `${notesText}\n---\n${transcriptSnippet}\nnum:${numQuestions}:diff:${difficulty}:chap:${targetChapterTitle}`,
      preferredModel: MODELS.TEXT,
      fallbackModels: [MODELS.FALLBACK_TEXT, "gemini-2.0-flash", "gemini-1.5-flash"].filter(
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
            temperature: 0.3,
          },
        });

        const responseText = response.text || "{}";
        const parsed = JSON.parse(responseText);

        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          const questions: QuizQuestion[] = parsed.questions.map((q: any, idx: number) => ({
            id: `q-${Date.now()}-${idx + 1}`,
            question: q.question || "Assessment Question",
            type: (q.type as QuestionType) || "mcq",
            options: Array.isArray(q.options) ? q.options : ["True", "False"],
            correctAnswer: q.correctAnswer || (q.options ? q.options[0] : "True"),
            explanation: q.explanation || "Grounded in lecture notes.",
            sourceChapter: q.sourceChapter || lecture.chapters[0]?.title || "Core Lecture",
            sourceTimestamp: Number(q.sourceTimestamp) || 0,
            difficulty: (q.difficulty as QuestionDifficulty) || "medium",
            topic: q.topic || "Lecture Content",
          }));

          return {
            id: `quiz-${Date.now()}`,
            lectureId: lecture.id,
            title: `${lecture.title} - ${targetChapterTitle} Quiz`,
            questions,
            totalQuestions: questions.length,
            createdAt: new Date().toISOString(),
          };
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
  const fallbackQuestions: QuizQuestion[] = [];
  const chapters = lecture.chapters.length > 0 ? lecture.chapters : [{ id: "c1", title: "General", startTime: 0, endTime: 60, description: "", keyConcepts: [] }];

  lecture.notes.forEach((note, idx) => {
    // MCQ from definitions
    if (note.definitions && note.definitions.length > 0) {
      for (const def of note.definitions) {
        if (!def.term || !def.definition) continue;
        fallbackQuestions.push({
          id: `q-gen-${idx}-${fallbackQuestions.length + 1}`,
          question: `What is the definition of "${def.term}" according to the lecture?`,
          type: "mcq",
          options: [
            def.definition,
            `A secondary implementation detail not covered in ${lecture.subject}.`,
            `An outdated concept superseded in modern ${lecture.subject} practices.`,
            `An unrelated theoretical construct outside the current course scope.`,
          ],
          correctAnswer: def.definition,
          explanation: `The lecture explicitly defines "${def.term}" as: "${def.definition}".`,
          sourceChapter: chapters[idx % chapters.length]?.title || "Fundamentals",
          sourceTimestamp: def.timestamp || note.sourceTimestamps[0]?.start || 0,
          difficulty: "easy",
          topic: note.topic,
        });
      }
    }

    // Question from key concepts
    if (note.keyConcepts && note.keyConcepts.length > 0) {
      for (const concept of note.keyConcepts) {
        fallbackQuestions.push({
          id: `q-gen-${idx}-${fallbackQuestions.length + 1}`,
          question: `Which statement accurately reflects the lecture's teaching on "${concept}"?`,
          type: "mcq",
          options: [
            `It is a foundational concept in "${note.topic}" emphasized during the session.`,
            `It was refuted by the instructor as invalid for real-world scenarios.`,
            `It only applies in purely theoretical environments without practical utility.`,
            `It is prohibited by language compilers and system runtime engines.`,
          ],
          correctAnswer: `It is a foundational concept in "${note.topic}" emphasized during the session.`,
          explanation: `Covered during ${note.topic} as a core takeaway of ${lecture.title}.`,
          sourceChapter: chapters[idx % chapters.length]?.title || "Operations",
          sourceTimestamp: note.sourceTimestamps[0]?.start || 0,
          difficulty: "medium",
          topic: note.topic,
        });
      }
    }
  });

  // If notes provided fewer than requested, generate from transcript segments
  if (fallbackQuestions.length < numQuestions && lecture.transcript.length > 0) {
    const importantSegs = lecture.transcript.filter((s) => s.isImportant || s.isKeyPoint || s.text.length > 30);
    const pool = importantSegs.length > 0 ? importantSegs : lecture.transcript;

    for (let i = 0; i < pool.length && fallbackQuestions.length < numQuestions; i++) {
      const seg = pool[i];
      fallbackQuestions.push({
        id: `q-gen-seg-${i + 1}`,
        question: `According to the lecture, what was discussed regarding "${seg.topic || lecture.title}"?`,
        type: "mcq",
        options: [
          seg.text,
          `The concept was completely skipped during this lecture module.`,
          `This topic was mentioned as deprecated and should not be used.`,
          `The instructor recommended consulting external hardware manuals instead.`,
        ],
        correctAnswer: seg.text,
        explanation: `Stated directly by the instructor at timestamp ${seg.startTime}s.`,
        sourceChapter: chapters[i % chapters.length]?.title || "Overview",
        sourceTimestamp: seg.startTime,
        difficulty: "easy",
        topic: seg.topic || lecture.subject,
      });
    }
  }

  const selected = fallbackQuestions.slice(0, numQuestions);

  return {
    id: `quiz-${Date.now()}`,
    lectureId: lecture.id,
    title: `${lecture.title} Knowledge Check`,
    questions: selected.length > 0 ? selected : [
      {
        id: "q-1",
        question: `What is the primary topic of this lecture?`,
        type: "mcq",
        options: [lecture.title, "Unrelated Subject", "Compiler Architecture", "Cloud Database Sharding"],
        correctAnswer: lecture.title,
        explanation: `The entire lecture explores ${lecture.title}.`,
        sourceChapter: chapters[0]?.title || "Overview",
        sourceTimestamp: 0,
        difficulty: "easy",
        topic: lecture.subject,
      },
    ],
    totalQuestions: selected.length || 1,
    createdAt: new Date().toISOString(),
  };
}
