import { getGeminiClient, MODELS } from "../geminiClient";
import { Lecture, Quiz, QuizAttempt, QuestionResult, TopicPerformance, WeakTopic, MiniPracticeQuestion } from "../../src/types";
import { aiOrchestrator, TaskPriority } from "./aiOrchestrator";

export interface EvaluateQuizOptions {
  lecture: Lecture;
  quiz: Quiz;
  userAnswers: Record<string, string>;
}

export async function evaluateQuizAndDetectWeakTopics(options: EvaluateQuizOptions): Promise<{
  attempt: QuizAttempt;
  weakTopics: WeakTopic[];
}> {
  const { lecture, quiz, userAnswers } = options;

  let score = 0;
  const questionResults: QuestionResult[] = [];
  const topicStats: Record<string, { total: number; correct: number }> = {};

  for (const q of quiz.questions) {
    const userAns = (userAnswers[q.id] || "").trim();
    const isCorrect = userAns.toLowerCase() === q.correctAnswer.trim().toLowerCase();

    if (isCorrect) score += 1;

    // Track topic stats
    const topic = q.topic || "General";
    if (!topicStats[topic]) {
      topicStats[topic] = { total: 0, correct: 0 };
    }
    topicStats[topic].total += 1;
    if (isCorrect) topicStats[topic].correct += 1;

    questionResults.push({
      questionId: q.id,
      userAnswer: userAns,
      isCorrect,
      score: isCorrect ? 1 : 0,
      feedback: isCorrect
        ? `Correct! ${q.explanation}`
        : `Incorrect. The correct answer is: "${q.correctAnswer}". ${q.explanation}`,
      topic,
      difficulty: q.difficulty,
    });
  }

  const topicBreakdown: Record<string, TopicPerformance> = {};
  const identifiedWeakTopicNames: string[] = [];

  for (const [topic, stat] of Object.entries(topicStats)) {
    const accuracy = Math.round((stat.correct / stat.total) * 100);
    topicBreakdown[topic] = {
      total: stat.total,
      correct: stat.correct,
      accuracy,
    };

    // If accuracy < 70%, mark as weak topic
    if (accuracy < 70) {
      identifiedWeakTopicNames.push(topic);
    }
  }

  const totalQuestions = quiz.questions.length;
  const overallAccuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  const attempt: QuizAttempt = {
    id: `attempt-${Date.now()}`,
    quizId: quiz.id,
    lectureId: lecture.id,
    timestamp: new Date().toISOString(),
    answers: userAnswers,
    score,
    maxScore: totalQuestions,
    correctCount: score,
    totalQuestions,
    accuracy: overallAccuracy,
    questionResults,
    topicBreakdown,
    weakTopics: identifiedWeakTopicNames,
  };

  // Generate Personalized Revision for Weak Topics
  const weakTopics: WeakTopic[] = [];
  for (const topicName of identifiedWeakTopicNames) {
    const topicAccuracy = topicBreakdown[topicName]?.accuracy || 0;
    const weakTopic = await generatePersonalizedRevision(lecture, topicName, topicAccuracy, questionResults);
    weakTopics.push(weakTopic);
  }

  return { attempt, weakTopics };
}

export async function generatePersonalizedRevision(
  lecture: Lecture,
  topicName: string,
  accuracy: number,
  results: QuestionResult[]
): Promise<WeakTopic> {
  // Find relevant chapter or notes for timestamp reference
  const matchingChapter = lecture.chapters.find((c) => c.title.toLowerCase().includes(topicName.toLowerCase())) ||
    lecture.chapters.find((c) => c.keyConcepts.some((k) => k.toLowerCase().includes(topicName.toLowerCase()))) ||
    lecture.chapters[0];

  const matchingNote = lecture.notes.find((n) => n.topic.toLowerCase().includes(topicName.toLowerCase()));

  const startSec = matchingChapter ? matchingChapter.startTime : matchingNote?.sourceTimestamps[0]?.start || 0;
  const endSec = matchingChapter ? matchingChapter.endTime : matchingNote?.sourceTimestamps[0]?.end || 300;

  const missedQuestions = results.filter((r) => r.topic === topicName && !r.isCorrect);

  const fallback = () => ({
    id: `weak-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    lectureId: lecture.id,
    topicName,
    accuracy,
    explanation: `You scored ${accuracy}% in ${topicName}. Key boundary conditions and definitions were missed in the assessment.`,
    reviewTimestampRange: {
      start: startSec,
      end: endSec,
    },
    recommendedTimestampStart: startSec,
    recommendedTimestampEnd: endSec,
    practiceDrill: [
      {
        id: `drill-${Date.now()}-1`,
        question: `What is the key condition associated with ${topicName}?`,
        type: "mcq" as const,
        options: [
          `Properly validating state limits before modifying ${topicName}`,
          "Bypassing index bounds",
          "Resetting memory unconditionally",
          "Ignoring operational complexity",
        ],
        correctAnswer: `Properly validating state limits before modifying ${topicName}`,
        explanation: `Proper validation prevents unexpected boundary errors in ${topicName}.`,
        sourceChapter: matchingChapter?.title || topicName,
        sourceTimestamp: startSec,
        difficulty: "easy" as const,
        topic: topicName,
      },
    ],
    miniPracticeQuestions: defaultMiniPractice(topicName),
    recommendedAction: `Review ${formatTime(startSec)} to ${formatTime(endSec)} in "${matchingChapter?.title || topicName}" and solve the targeted review questions below.`,
    status: "pending" as const,
  });

  const prompt = `You are the personalized adaptive revision tutor for LearniX.
The student took a lecture assessment on "${lecture.title}" (${lecture.subject}) and struggled with the topic: "${topicName}".
Topic Accuracy: ${accuracy}%
Missed Questions Feedback: ${missedQuestions.map((m) => m.feedback).join("; ")}
Matching Lecture Chapter: "${matchingChapter?.title || topicName}" (Timestamps: ${formatTime(startSec)} - ${formatTime(endSec)})

TASK:
1. Explain concisely why the student likely struggled and clarify the core misconception.
2. Provide a 3-question mini-practice drill with answer hints and key expected terms.
3. Recommend a targeted revision action with exact timestamp range.

Output valid JSON matching:
{
  "explanation": "Diagnostic root cause of confusion and clear conceptual clarification.",
  "recommendedAction": "Actionable review recommendation with lecture timestamp references.",
  "miniPracticeQuestions": [
    {
      "id": "mp-1",
      "question": "Targeted conceptual question 1?",
      "answerHint": "Clear hint/answer",
      "expectedKeyTerms": ["term1", "term2"]
    }
  ]
}`;

  try {
    const taskRes = await aiOrchestrator.executeTask<WeakTopic>({
      taskType: "weak_topic_drill",
      priority: TaskPriority.LOW,
      userId: lecture.createdBy,
      lectureId: lecture.id,
      promptOrInput: `${lecture.id}:${topicName}:${accuracy}:${missedQuestions.length}`,
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
          id: `weak-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          lectureId: lecture.id,
          topicName,
          accuracy,
          explanation: parsed.explanation || `You scored ${accuracy}% on questions related to ${topicName}. Reviewing the core concepts will solidify your understanding.`,
          reviewTimestampRange: {
            start: startSec,
            end: endSec,
          },
          recommendedTimestampStart: startSec,
          recommendedTimestampEnd: endSec,
          practiceDrill: [
            {
              id: `drill-${Date.now()}-1`,
              question: `What is the key principle or check associated with ${topicName}?`,
              type: "mcq",
              options: [
                `Correct verification of boundary states and operation parameters for ${topicName}`,
                "Executing without boundary validation",
                "Ignoring memory capacity limits",
                "Assuming constant time execution for arbitrary collections",
              ],
              correctAnswer: `Correct verification of boundary states and operation parameters for ${topicName}`,
              explanation: `Ensuring proper state checks prevents runtime errors in ${topicName}.`,
              sourceChapter: matchingChapter?.title || topicName,
              sourceTimestamp: startSec,
              difficulty: "easy",
              topic: topicName,
            },
            {
              id: `drill-${Date.now()}-2`,
              question: `In production systems, what is the best strategy to handle ${topicName}?`,
              type: "mcq",
              options: [
                "Implement robust exception handling and defensive guards",
                "Suppress error messages silently",
                "Rely on operating system crash dumps",
                "Disable recursion limits globally",
              ],
              correctAnswer: "Implement robust exception handling and defensive guards",
              explanation: "Defensive assertions and boundary checks ensure system reliability.",
              sourceChapter: matchingChapter?.title || topicName,
              sourceTimestamp: startSec + 60,
              difficulty: "medium",
              topic: topicName,
            },
          ],
          miniPracticeQuestions: Array.isArray(parsed.miniPracticeQuestions)
            ? parsed.miniPracticeQuestions
            : defaultMiniPractice(topicName),
          recommendedAction: parsed.recommendedAction || `Review lecture segment ${formatTime(startSec)}–${formatTime(endSec)} and complete the mini-practice drill.`,
          status: "pending",
        };
      },
      localFallback: fallback,
    });

    return taskRes.result;
  } catch (err) {
    console.warn(`[WEAK-TOPIC-SERVICE] AI personalized revision generation failed, engaging rule-based fallback:`, err);
    return fallback();
  }
}

function defaultMiniPractice(topicName: string): MiniPracticeQuestion[] {
  return [
    {
      id: "mp-1",
      question: `Define the primary rule governing ${topicName} in one concise sentence.`,
      answerHint: `State the operational invariant and core state condition.`,
      expectedKeyTerms: [topicName, "rule", "state"],
    },
    {
      id: "mp-2",
      question: `What is the most frequent error or boundary failure associated with ${topicName}?`,
      answerHint: `Consider boundary limits (e.g. empty or full state limits).`,
      expectedKeyTerms: ["boundary", "overflow", "underflow", "limit"],
    },
    {
      id: "mp-3",
      question: `Give one real-world software engineering application where ${topicName} is vital.`,
      answerHint: `Think of operating systems, memory caches, or graph traversals.`,
      expectedKeyTerms: ["system", "memory", "algorithm"],
    },
  ];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
