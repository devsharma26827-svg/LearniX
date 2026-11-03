import React, { useState } from "react";
import { CheckCircle2, Loader2, ArrowRight, Brain, AlertCircle, RefreshCw, Home } from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";

export const ProcessingScreen: React.FC = () => {
  const { activeLecture, setActiveView, setWorkspaceTab, processLearningPack } = useLecture();
  const [isRetrying, setIsRetrying] = useState(false);

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

  const isFailed = activeLecture?.status === "failed";
  const isComplete = activeLecture?.status === "ready" || progress.percent >= 100;

  const handleOpenLearningPack = () => {
    setActiveView("workspace");
    setWorkspaceTab("overview");
  };

  const handleReturnToDashboard = () => {
    setActiveView("student-dashboard");
  };

  const handleRetry = async () => {
    if (!activeLecture) return;
    setIsRetrying(true);
    try {
      await processLearningPack(activeLecture.id);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.75rem)] bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-sm w-full max-w-lg p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div
            className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center shadow-xs ${
              isFailed
                ? "bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F]"
                : "bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]"
            }`}
          >
            {isFailed ? (
              <AlertCircle className="w-6 h-6 text-[#E07A5F]" />
            ) : isComplete ? (
              <CheckCircle2 className="w-6 h-6 text-[#168A72]" />
            ) : (
              <Brain className="w-6 h-6 animate-pulse text-[#168A72]" />
            )}
          </div>

          <h2 className="text-xl font-bold tracking-tight text-[#17201D] dark:text-[#F1FAF7]">
            {isFailed
              ? "Temporary AI Service Issue"
              : isComplete
              ? "Study Materials Ready"
              : "Structuring Lecture Knowledge"}
          </h2>

          <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] max-w-sm mx-auto leading-relaxed">
            {isFailed
              ? "The AI model experienced high demand (503) or temporary service interruption. Your transcript and audio are safely preserved."
              : activeLecture?.title
              ? `Processing "${activeLecture.title}" (${activeLecture.subject})`
              : `${APP_NAME} is transcribing audio and generating study chapters, notes, and quizzes.`}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold">
            <span className={isFailed ? "text-[#E07A5F]" : "text-[#168A72] dark:text-[#23A98D]"}>
              {isFailed ? "Generation Pending / Interrupted" : progress.stage}
            </span>
            <span className="font-mono text-[#17201D] dark:text-[#F1FAF7]">
              {isFailed ? "Paused" : `${progress.percent}%`}
            </span>
          </div>
          <div className="w-full h-2 bg-[#F4F6F5] dark:bg-[#24302C] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isFailed ? "bg-[#E07A5F]" : "bg-[#168A72]"
              }`}
              style={{ width: `${isFailed ? 45 : progress.percent}%` }}
            />
          </div>
          <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] text-center">
            {isFailed
              ? "Your request context is saved. Click Retry Generation below to resume."
              : progress.message}
          </p>
        </div>

        {/* Stages Checklist */}
        <div className="space-y-2.5 bg-[#F8FAF8] dark:bg-[#17201D] p-4 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36]">
          {progress.steps.map((step, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2.5">
                {step.completed ? (
                  <CheckCircle2 className="w-4 h-4 text-[#168A72] shrink-0" />
                ) : isFailed && step.active ? (
                  <AlertCircle className="w-4 h-4 text-[#E07A5F] shrink-0" />
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
                      : isFailed && step.active
                      ? "text-[#E07A5F]"
                      : step.active
                      ? "text-[#168A72] dark:text-[#23A98D]"
                      : "text-[#9BA4A0]"
                  }`}
                >
                  {step.name}
                </span>
              </div>
              <span className="text-[11px] font-medium text-[#66736E] dark:text-[#9BA4A0]">
                {step.completed
                  ? "Done"
                  : isFailed && step.active
                  ? "Retry Needed"
                  : step.active
                  ? "Analyzing..."
                  : "Queued"}
              </span>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          {isFailed ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying}
                className="flex-1 py-2.5 rounded-xl font-semibold text-xs bg-[#168A72] hover:bg-[#0F6B59] text-white transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
                <span>{isRetrying ? "Retrying Generation..." : "Retry Generation"}</span>
              </button>
              <button
                type="button"
                onClick={handleReturnToDashboard}
                className="py-2.5 px-4 rounded-xl font-semibold text-xs bg-[#F4F6F5] dark:bg-[#24302C] text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#EAEFEA] border border-[#E4EAE7] dark:border-[#2C3B36] transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleOpenLearningPack}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer ${
                  isComplete
                    ? "bg-[#168A72] hover:bg-[#0F6B59] text-white"
                    : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#17201D] dark:text-[#F1FAF7] hover:bg-[#EAEFEA] border border-[#E4EAE7] dark:border-[#2C3B36]"
                }`}
              >
                <span>{isComplete ? "Open Lecture Workspace" : "Continue in Background"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleReturnToDashboard}
                className="py-2.5 px-3 rounded-xl font-semibold text-xs text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] transition flex items-center justify-center gap-1 cursor-pointer"
                title="Return to Student Dashboard"
              >
                <Home className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
