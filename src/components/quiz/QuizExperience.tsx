import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  HelpCircle,
  Clock,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { Quiz, QuizQuestion, QuizAttempt, WeakTopic } from "../../types";
import { useLecture } from "../../context/LectureContext";
import { formatSecondsToTime } from "../../utils/formatters";
import { QuizResultsView } from "./QuizResultsView";
import {
  PAGE_CONTAINER_VARIANTS,
  SECTION_ITEM_VARIANTS,
  EASE_OUT_EXPO,
} from "../../utils/motionVariants";

interface QuizExperienceProps {
  quiz: Quiz;
  onSeekTimestamp?: (time: number) => void;
  onGoToRevision?: () => void;
}

export const QuizExperience: React.FC<QuizExperienceProps> = ({
  quiz,
  onSeekTimestamp,
  onGoToRevision,
}) => {
  const { submitQuizAttempt } = useLecture();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attemptResult, setAttemptResult] = useState<QuizAttempt | null>(null);
  const [weakTopicsResult, setWeakTopicsResult] = useState<WeakTopic[]>([]);

  const questions = quiz.questions || [];
  const currentQ: QuizQuestion | undefined = questions[currentIndex];

  const handleSelectOption = (option: string) => {
    if (isSubmitted || !currentQ) return;
    setAnswers((prev) => ({ ...prev, [currentQ.id]: option }));
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const res = await submitQuizAttempt(answers);
      setAttemptResult(res.attempt);
      setWeakTopicsResult(res.weakTopics);
      setIsSubmitted(true);
    } catch (err) {
      console.error("Quiz submission error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetake = () => {
    setAnswers({});
    setIsSubmitted(false);
    setAttemptResult(null);
    setCurrentIndex(0);
  };

  if (isSubmitted && attemptResult) {
    return (
      <QuizResultsView
        attempt={attemptResult}
        questions={questions}
        weakTopics={weakTopicsResult}
        onRetake={handleRetake}
        onGoToRevision={onGoToRevision}
        onSeekTimestamp={onSeekTimestamp}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <div className="p-10 text-center bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl max-w-2xl mx-auto font-sans">
        <HelpCircle className="w-8 h-8 text-[#9BA4A0] mx-auto mb-2.5" />
        <h3 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
          No Quiz Questions Generated Yet
        </h3>
        <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mt-1">
          Assessment items will appear after full transcript analysis.
        </p>
      </div>
    );
  }

  const answeredCount = Object.keys(answers).length;
  const progressPercent = Math.round(
    ((currentIndex + 1) / questions.length) * 100
  );

  return (
    <motion.div
      variants={PAGE_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
      className="max-w-2xl mx-auto space-y-4 font-sans"
    >
      {/* Quiz Header & Progress Bar */}
      <motion.div
        variants={SECTION_ITEM_VARIANTS}
        className="p-5 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl shadow-xs space-y-2.5"
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-[#168A72] dark:text-[#23A98D]">
              Knowledge Assessment Drill
            </span>
            <span className="text-[#9BA4A0]">•</span>
            <span className="text-[#66736E] dark:text-[#9BA4A0] tabular-nums">
              Question {currentIndex + 1} of {questions.length}
            </span>
          </div>

          <span className="text-[#66736E] dark:text-[#9BA4A0] font-mono text-xs font-semibold tabular-nums">
            {answeredCount} of {questions.length} answered
          </span>
        </div>

        {/* Brand Green Progress line */}
        <div className="w-full h-1.5 bg-[#F4F6F5] dark:bg-[#24302C] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[#168A72] dark:bg-[#23A98D] rounded-full"
            initial={false}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
          />
        </div>
      </motion.div>

      {/* Clean White Question Card with smooth question transitions */}
      {currentQ && (
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQ.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="p-6 sm:p-8 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs space-y-6"
          >
            {/* Question Metadata */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] capitalize">
                  {currentQ.difficulty}
                </span>
                <span className="text-xs text-[#66736E] dark:text-[#9BA4A0] font-medium">
                  {currentQ.topic}
                </span>
              </div>

              <button
                onClick={() => onSeekTimestamp?.(currentQ.sourceTimestamp)}
                className="text-xs text-[#66736E] dark:text-[#9BA4A0] hover:text-[#168A72] dark:hover:text-[#23A98D] transition flex items-center gap-1 font-mono tabular-nums cursor-pointer"
              >
                <Clock className="w-3 h-3 text-[#9BA4A0]" />
                <span>[{formatSecondsToTime(currentQ.sourceTimestamp)}]</span>
              </button>
            </div>

            {/* Question Text */}
            <h3 className="text-base sm:text-lg font-bold text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
              {currentQ.question}
            </h3>

            {/* Answer Options */}
            <div className="space-y-2.5">
              {currentQ.options?.map((opt, idx) => {
                const isSelected = answers[currentQ.id] === opt;
                const letter = String.fromCharCode(65 + idx);

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectOption(opt)}
                    className={`w-full text-left p-4 rounded-xl border transition-all duration-150 flex items-start space-x-3 cursor-pointer active:scale-[0.99] ${
                      isSelected
                        ? "bg-[#E7F6F1] dark:bg-[#1E3730] border-[#168A72] text-[#17201D] dark:text-[#F1FAF7] shadow-xs"
                        : "bg-[#F8FAF8] dark:bg-[#17201D] border-[#E4EAE7] dark:border-[#2C3B36] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] hover:border-[#168A72]/40 text-[#17201D] dark:text-[#F1FAF7]"
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-lg text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        isSelected
                          ? "bg-[#168A72] text-white"
                          : "bg-white dark:bg-[#1B2421] text-[#66736E] dark:text-[#9BA4A0] border border-[#E4EAE7] dark:border-[#2C3B36]"
                      }`}
                    >
                      {letter}
                    </span>
                    <span className="text-xs sm:text-sm leading-relaxed pt-0.5">
                      {opt}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Navigation Controls with Brand Green Button */}
            <div className="pt-4 flex items-center justify-between border-t border-[#E4EAE7] dark:border-[#2C3B36]">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="px-3.5 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] disabled:opacity-25 flex items-center gap-1 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>

              {currentIndex === questions.length - 1 ? (
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || answeredCount === 0}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white disabled:opacity-40 transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? "Evaluating..." : "Submit Answers"}</span>
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <span>Next Question</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
};
