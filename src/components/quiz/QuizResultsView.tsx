import React from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  Clock,
  Award,
  Sparkles,
} from "lucide-react";
import { QuizAttempt, QuizQuestion, WeakTopic } from "../../types";
import { formatSecondsToTime } from "../../utils/formatters";

interface QuizResultsViewProps {
  attempt: QuizAttempt;
  questions: QuizQuestion[];
  weakTopics: WeakTopic[];
  onRetake: () => void;
  onGoToRevision?: () => void;
  onSeekTimestamp?: (time: number) => void;
}

export const QuizResultsView: React.FC<QuizResultsViewProps> = ({
  attempt,
  questions,
  weakTopics,
  onRetake,
  onGoToRevision,
  onSeekTimestamp,
}) => {
  const accuracy = attempt.score;

  // Compute topic-wise stats
  const topicStats: Record<string, { total: number; correct: number }> = {};
  questions.forEach((q) => {
    if (!topicStats[q.topic]) topicStats[q.topic] = { total: 0, correct: 0 };
    topicStats[q.topic].total += 1;
    if (attempt.answers[q.id] === q.correctAnswer) {
      topicStats[q.topic].correct += 1;
    }
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in font-sans">
      {/* 1. Score Summary Card */}
      <div className="p-8 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs text-center space-y-5">
        <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
          <Award className="w-8 h-8" />
        </div>

        <div>
          <h2 className="text-xl font-bold text-[#17201D] dark:text-[#F1FAF7]">
            Assessment Complete!
          </h2>
          <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mt-1">
            Evaluated against core lecture invariants and principles
          </p>
        </div>

        {/* Large accuracy percentage number */}
        <div className="py-2">
          <div className="text-5xl font-extrabold text-[#168A72] dark:text-[#23A98D] tracking-tight tabular-nums">
            {accuracy}%
          </div>
          <span className="text-xs font-mono font-semibold text-[#66736E] dark:text-[#9BA4A0] mt-1 inline-block">
            {attempt.correctCount} of {attempt.totalQuestions} questions correct
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={onRetake}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-white dark:bg-[#1B2421] text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] border border-[#E4EAE7] dark:border-[#2C3B36] transition flex items-center gap-1.5 shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retake Quiz</span>
          </button>

          {weakTopics.length > 0 && onGoToRevision && (
            <button
              onClick={onGoToRevision}
              className="px-5 py-2.5 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] text-white shadow-xs transition flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Recommended Revision ({weakTopics.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Topic-wise Performance Card */}
      <div className="p-6 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs space-y-4">
        <h3 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
          Topic-wise Performance
        </h3>

        <div className="space-y-3">
          {Object.entries(topicStats).map(([topic, stat]) => {
            const pct = Math.round((stat.correct / stat.total) * 100);
            return (
              <div key={topic} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">{topic}</span>
                  <span className="font-mono text-[#66736E] dark:text-[#9BA4A0]">{pct}% ({stat.correct}/{stat.total})</span>
                </div>
                <div className="w-full h-1.5 bg-[#F4F6F5] dark:bg-[#24302C] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${pct >= 70 ? "bg-[#168A72]" : "bg-[#E07A5F]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Detailed Question Review */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
          Question Review & Citations
        </h3>

        <div className="space-y-3">
          {questions.map((q, idx) => {
            const userAnswer = attempt.answers[q.id];
            const isCorrect = userAnswer === q.correctAnswer;

            return (
              <div
                key={q.id}
                className={`p-5 rounded-2xl border transition-all space-y-2.5 ${
                  isCorrect
                    ? "bg-[#E7F6F1]/50 dark:bg-[#1E3730]/40 border-[#168A72]/30"
                    : "bg-[#FDF0ED]/50 dark:bg-[#38241D]/40 border-[#E07A5F]/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    {isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-[#168A72] shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-[#E07A5F] shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Question {idx + 1}: {q.topic}
                    </span>
                  </div>

                  <button
                    onClick={() => onSeekTimestamp?.(q.sourceTimestamp)}
                    className="text-[11px] font-mono text-[#66736E] dark:text-[#9BA4A0] hover:text-[#168A72] dark:hover:text-[#23A98D] flex items-center gap-1 transition-colors"
                  >
                    <Clock className="w-3 h-3 text-[#9BA4A0]" />
                    <span>[{formatSecondsToTime(q.sourceTimestamp)}]</span>
                  </button>
                </div>

                <p className="text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] leading-relaxed font-medium">
                  {q.question}
                </p>

                <div className="text-xs space-y-1 pt-1.5 border-t border-[#E4EAE7] dark:border-[#2C3B36]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#66736E] dark:text-[#9BA4A0]">Your answer:</span>
                    <span
                      className={`font-semibold ${
                        isCorrect
                          ? "text-[#0F6B59] dark:text-[#23A98D]"
                          : "text-[#E07A5F]"
                      }`}
                    >
                      {userAnswer || "Not answered"}
                    </span>
                  </div>

                  {!isCorrect && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#66736E] dark:text-[#9BA4A0]">Correct answer:</span>
                      <span className="font-semibold text-[#0F6B59] dark:text-[#23A98D]">
                        {q.correctAnswer}
                      </span>
                    </div>
                  )}

                  {q.explanation && (
                    <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] pt-1 leading-relaxed">
                      {q.explanation}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
