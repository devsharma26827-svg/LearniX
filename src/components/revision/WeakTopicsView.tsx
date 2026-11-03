import React, { useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  RefreshCw,
  Play,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sparkles,
  BookOpen,
  Award,
} from "lucide-react";
import { WeakTopic } from "../../types";
import { formatSecondsToTime, formatTimeRange } from "../../utils/formatters";
import {
  PAGE_CONTAINER_VARIANTS,
  SECTION_ITEM_VARIANTS,
} from "../../utils/motionVariants";

interface WeakTopicsViewProps {
  weakTopics: WeakTopic[];
  onSeekTimestamp?: (time: number) => void;
  onOpenTranscriptTab?: () => void;
}

export const WeakTopicsView: React.FC<WeakTopicsViewProps> = ({
  weakTopics,
  onSeekTimestamp,
  onOpenTranscriptTab,
}) => {
  const [selectedTopicIndex, setSelectedTopicIndex] = useState(0);
  const [drillAnswers, setDrillAnswers] = useState<Record<string, string>>({});
  const [showHints, setShowHints] = useState<Record<string, boolean>>({});
  const [drillSubmitted, setDrillSubmitted] = useState(false);

  const activeWeakTopic: WeakTopic | undefined = weakTopics[selectedTopicIndex];

  const handleSelectDrillOption = (qId: string, option: string) => {
    if (drillSubmitted) return;
    setDrillAnswers((prev) => ({ ...prev, [qId]: option }));
  };

  const toggleHint = (qId: string) => {
    setShowHints((prev) => ({ ...prev, [qId]: !prev[qId] }));
  };

  const handleSubmitDrill = () => {
    setDrillSubmitted(true);
  };

  const handleResetDrill = () => {
    setDrillAnswers({});
    setShowHints({});
    setDrillSubmitted(false);
  };

  if (!weakTopics || weakTopics.length === 0) {
    return (
      <div className="p-10 text-center bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl max-w-2xl mx-auto space-y-4 font-sans">
        <div className="w-12 h-12 rounded-2xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] mx-auto flex items-center justify-center">
          <Award className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7]">
          No Weak Topics Identified!
        </h3>
        <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] max-w-md mx-auto leading-relaxed">
          Comprehension criteria met across all evaluated lecture segments. Take additional quizzes to diagnose further areas.
        </p>
      </div>
    );
  }

  const drillQuestions = activeWeakTopic?.practiceDrill || [];
  const drillScore = drillQuestions.reduce(
    (acc, q) => (drillAnswers[q.id] === q.correctAnswer ? acc + 1 : acc),
    0
  );

  return (
    <motion.div
      variants={PAGE_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
      className="max-w-3xl mx-auto space-y-6 font-sans"
    >
      {/* 1. Revision Overview Card */}
      <motion.div
        variants={SECTION_ITEM_VARIANTS}
        className="p-6 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F] mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Targeted Concept Reinforcement</span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[#17201D] dark:text-[#F1FAF7]">
            Topics Recommended for Revision
          </h2>
          <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
            {weakTopics.length} conceptual area{weakTopics.length > 1 ? "s" : ""} flagged from recent assessment performance
          </p>
        </div>

        {/* Tab pills for multiple weak topics */}
        {weakTopics.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {weakTopics.map((wt, idx) => (
              <button
                key={wt.id || idx}
                onClick={() => {
                  setSelectedTopicIndex(idx);
                  handleResetDrill();
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap transition-all duration-150 cursor-pointer ${
                  selectedTopicIndex === idx
                    ? "bg-[#168A72] text-white"
                    : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7]"
                }`}
              >
                {wt.topicName} ({wt.accuracy}%)
              </button>
            ))}
          </div>
        )}
      </motion.div>

      {activeWeakTopic && (
        <motion.div variants={SECTION_ITEM_VARIANTS} className="space-y-5">
          {/* 2. Diagnostic Card */}
          <div className="p-6 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#E07A5F]">
                  Diagnostic Analysis
                </span>
                <h3 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7] mt-0.5">
                  {activeWeakTopic.topicName}
                </h3>
              </div>

              <span className="px-3 py-1 text-xs font-mono tabular-nums font-bold rounded-full bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F]">
                Accuracy: {activeWeakTopic.accuracy}%
              </span>
            </div>

            {/* Explanation of mistake */}
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0]">
                Observed Knowledge Gap:
              </h4>
              <p className="text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                {activeWeakTopic.explanation}
              </p>
            </div>

            {/* Audio Timestamp Jump Button */}
            <div className="p-4 bg-[#F8FAF8] dark:bg-[#17201D] rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[#168A72]" />
                  <span>Review Spoken Lecture Section</span>
                </div>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] tabular-nums">
                  Discussed at{" "}
                  {formatTimeRange(
                    activeWeakTopic.recommendedTimestampStart,
                    activeWeakTopic.recommendedTimestampEnd
                  )}
                </p>
              </div>

              <button
                onClick={() => {
                  onSeekTimestamp?.(activeWeakTopic.recommendedTimestampStart);
                  onOpenTranscriptTab?.();
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white transition-all duration-150 flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
              >
                <Play className="w-3 h-3 fill-current" />
                <span className="tabular-nums">
                  Jump to @{formatSecondsToTime(activeWeakTopic.recommendedTimestampStart)}
                </span>
              </button>
            </div>
          </div>

          {/* 3. Interactive Practice Drill */}
          <div className="p-6 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#66736E] dark:text-[#9BA4A0]">
                    Targeted Reinforcement Drill
                  </h3>
                  <p className="text-xs text-[#17201D] dark:text-[#F1FAF7] font-semibold">
                    Practice items for {activeWeakTopic.topicName}
                  </p>
                </div>
              </div>

              {drillSubmitted && (
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-mono tabular-nums font-bold text-[#168A72] dark:text-[#23A98D]">
                    Score: {drillScore}/{drillQuestions.length}
                  </span>
                  <button
                    onClick={handleResetDrill}
                    className="p-1 rounded-md text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition cursor-pointer"
                    title="Retry Drill"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Questions */}
            <div className="space-y-4">
              {drillQuestions.map((q, idx) => {
                const isSelected = drillAnswers[q.id];
                const isCorrect = isSelected === q.correctAnswer;
                const showHint = showHints[q.id];

                return (
                  <div
                    key={q.id}
                    className={`p-4 rounded-xl border transition-all space-y-3 ${
                      drillSubmitted
                        ? isCorrect
                          ? "bg-[#E7F6F1]/50 dark:bg-[#1E3730]/40 border-[#168A72]/40"
                          : "bg-[#FDF0ED]/50 dark:bg-[#38241D]/40 border-[#E07A5F]/40"
                        : "bg-[#F8FAF8] dark:bg-[#17201D] border-[#E4EAE7] dark:border-[#2C3B36]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase">
                        Question {idx + 1}
                      </span>

                      {!drillSubmitted && (
                        <button
                          onClick={() => toggleHint(q.id)}
                          className="text-xs text-[#66736E] dark:text-[#9BA4A0] hover:text-[#168A72] dark:hover:text-[#23A98D] flex items-center gap-1 font-medium transition-colors cursor-pointer"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                          <span>{showHint ? "Hide Hint" : "Hint"}</span>
                        </button>
                      )}
                    </div>

                    <p className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      {q.question}
                    </p>

                    {showHint && !drillSubmitted && (
                      <div className="p-3 bg-[#E7F6F1] dark:bg-[#1E3730] rounded-xl text-xs text-[#0F6B59] dark:text-[#23A98D]">
                        <strong>Hint:</strong> Re-examine boundary condition invariants and stack overflow triggers.
                      </div>
                    )}

                    {/* Options */}
                    <div className="space-y-2">
                      {q.options?.map((opt, oIdx) => {
                        const isChosen = drillAnswers[q.id] === opt;
                        const isThisCorrect = opt === q.correctAnswer;

                        return (
                          <button
                            key={oIdx}
                            onClick={() => handleSelectDrillOption(q.id, opt)}
                            disabled={drillSubmitted}
                            className={`w-full text-left p-3 rounded-xl border text-xs transition-all duration-150 flex items-center justify-between cursor-pointer ${
                              drillSubmitted
                                ? isThisCorrect
                                  ? "bg-[#E7F6F1] dark:bg-[#1E3730] border-[#168A72] font-semibold text-[#0F6B59] dark:text-[#23A98D]"
                                  : isChosen
                                  ? "bg-[#FDF0ED] dark:bg-[#38241D] border-[#E07A5F] font-semibold text-[#E07A5F]"
                                  : "bg-white dark:bg-[#1B2421] border-[#E4EAE7] dark:border-[#2C3B36] text-[#9BA4A0]"
                                : isChosen
                                ? "bg-[#E7F6F1] dark:bg-[#1E3730] border-[#168A72] text-[#17201D] dark:text-[#F1FAF7] font-semibold"
                                : "bg-white dark:bg-[#1B2421] border-[#E4EAE7] dark:border-[#2C3B36] text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C]"
                            }`}
                          >
                            <span>{opt}</span>
                            {drillSubmitted && (
                              <span>
                                {isThisCorrect ? (
                                  <CheckCircle2 className="w-4 h-4 text-[#168A72]" />
                                ) : isChosen ? (
                                  <XCircle className="w-4 h-4 text-[#E07A5F]" />
                                ) : null}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {drillSubmitted && q.explanation && (
                      <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] pt-1 leading-relaxed">
                        <strong>Rationale:</strong> {q.explanation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end space-x-2">
              {drillSubmitted ? (
                <button
                  onClick={handleResetDrill}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.98] border border-[#E4EAE7] dark:border-[#2C3B36] text-[#17201D] dark:text-[#F1FAF7] transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Practice Again</span>
                </button>
              ) : (
                <button
                  onClick={handleSubmitDrill}
                  disabled={Object.keys(drillAnswers).length === 0}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white disabled:opacity-40 transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Check Answers</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
