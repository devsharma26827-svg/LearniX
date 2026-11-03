import React from "react";
import { CheckCircle2, Loader2, ArrowRight, Brain, Sparkles } from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";

export const ProcessingScreen: React.FC = () => {
  const { activeLecture, setActiveView, setWorkspaceTab } = useLecture();

  const progress = activeLecture?.processingProgress || {
    stage: "Processing lecture content...",
    percent: 65,
    message: "Analyzing speech transcript and structuring chapters...",
    steps: [
      { name: "Audio Transcription & Timestamping", completed: true, active: false },
      { name: "Topic Detection & Chapter Structuring", completed: true, active: false },
      { name: "AI Smart Notes & Concept Extraction", completed: false, active: true },
      { name: "Lecture Q&A Vector Grounding", completed: false, active: false },
      { name: "Adaptive Assessment Generation", completed: false, active: false },
      { name: "Personalized Revision Setup", completed: false, active: false },
    ],
  };

  const isComplete = activeLecture?.status === "ready" || progress.percent >= 100;

  const handleOpenLearningPack = () => {
    setActiveView("workspace");
    setWorkspaceTab("overview");
  };

  return (
    <div className="min-h-[calc(100vh-3.75rem)] bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-sm w-full max-w-lg p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] mx-auto flex items-center justify-center shadow-xs">
            {isComplete ? <CheckCircle2 className="w-6 h-6 text-[#168A72]" /> : <Brain className="w-6 h-6 animate-pulse text-[#168A72]" />}
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[#17201D] dark:text-[#F1FAF7]">
            {isComplete ? "Study Materials Ready" : "Structuring Lecture Knowledge"}
          </h2>
          <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] max-w-sm mx-auto leading-relaxed">
            {activeLecture?.title ? `Processing "${activeLecture.title}" (${activeLecture.subject})` : `${APP_NAME} is transcribing audio and generating study chapters, notes, and quizzes.`}
          </p>
        </div>

        {/* Progress Bar in Brand Green */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-[#168A72] dark:text-[#23A98D]">{progress.stage}</span>
            <span className="font-mono text-[#17201D] dark:text-[#F1FAF7]">{progress.percent}%</span>
          </div>
          <div className="w-full h-2 bg-[#F4F6F5] dark:bg-[#24302C] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#168A72] rounded-full transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] text-center">{progress.message}</p>
        </div>

        {/* Stages Checklist */}
        <div className="space-y-2.5 bg-[#F8FAF8] dark:bg-[#17201D] p-4 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36]">
          {progress.steps.map((step, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2.5">
                {step.completed ? (
                  <CheckCircle2 className="w-4 h-4 text-[#168A72] shrink-0" />
                ) : step.active ? (
                  <Loader2 className="w-4 h-4 text-[#168A72] animate-spin shrink-0" />
                ) : (
                  <span className="w-4 h-4 rounded-full border border-[#E4EAE7] dark:border-[#2C3B36] shrink-0 flex items-center justify-center text-[10px] text-[#9BA4A0]">
                    {idx + 1}
                  </span>
                )}
                <span
                  className={`font-semibold ${
                    step.completed
                      ? "text-[#17201D] dark:text-[#F1FAF7]"
                      : step.active
                      ? "text-[#168A72] dark:text-[#23A98D]"
                      : "text-[#9BA4A0]"
                  }`}
                >
                  {step.name}
                </span>
              </div>
              <span className="text-[11px] font-medium text-[#66736E] dark:text-[#9BA4A0]">
                {step.completed ? "Done" : step.active ? "Analyzing..." : "Queued"}
              </span>
            </div>
          ))}
        </div>

        {/* Action Button */}
        <div>
          <button
            onClick={handleOpenLearningPack}
            className={`w-full py-2.5 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-xs ${
              isComplete
                ? "bg-[#168A72] hover:bg-[#0F6B59] text-white"
                : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#EAEFEA] border border-[#E4EAE7] dark:border-[#2C3B36]"
            }`}
          >
            <span>{isComplete ? "Open Lecture Workspace" : "Continue in Background"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
