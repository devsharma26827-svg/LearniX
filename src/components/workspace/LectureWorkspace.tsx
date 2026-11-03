import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  FileText,
  ListTree,
  MessageSquare,
  HelpCircle,
  AlertTriangle,
  Download,
  Clock,
  ChevronLeft,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useLecture, WorkspaceTab } from "../../context/LectureContext";
import { formatSecondsToTime } from "../../utils/formatters";
import { TranscriptViewer } from "./TranscriptViewer";
import { SmartNotesViewer } from "./SmartNotesViewer";
import { ChaptersTimeline } from "./ChaptersTimeline";
import { AskLecturePanel } from "./AskLecturePanel";
import { QuizExperience } from "../quiz/QuizExperience";
import { WeakTopicsView } from "../revision/WeakTopicsView";
import { PdfExportModal } from "../pdf/PdfExportModal";
import { EASE_OUT_EXPO } from "../../utils/motionVariants";

export interface LectureWorkspaceProps {
  initialTab?: WorkspaceTab;
}

export const LectureWorkspace: React.FC<LectureWorkspaceProps> = ({
  initialTab,
}) => {
  const { lectureId } = useParams<{ lectureId?: string }>();
  const navigate = useNavigate();
  const { lectures, activeLecture, workspaceTab, setWorkspaceTab, openLecture } =
    useLecture();
  const [selectedTimestamp, setSelectedTimestamp] = useState<
    number | undefined
  >(undefined);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setWorkspaceTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (lectureId && (!activeLecture || activeLecture.id !== lectureId)) {
      openLecture(lectureId, initialTab || workspaceTab);
    } else if (!activeLecture && lectures.length > 0) {
      const savedId = localStorage.getItem("learnix_active_lecture_id");
      const target = lectures.find((l) => l.id === savedId) || lectures[0];
      if (target) {
        openLecture(target.id, initialTab || workspaceTab);
      }
    }
  }, [lectureId, activeLecture, lectures]);

  // Keep track of current tab for global highlighting
  (window as any)._currentTab = workspaceTab;

  if (!activeLecture) {
    return (
      <div className="min-h-[calc(100vh-3.75rem)] flex items-center justify-center p-6 text-center font-sans">
        <div className="space-y-3">
          <BookOpen className="w-10 h-10 text-[#9BA4A0] mx-auto" />
          <p className="text-[#66736E] dark:text-[#9BA4A0] font-semibold text-sm">
            No lecture selected.
          </p>
          <button
            onClick={() => navigate("/student-dashboard")}
            className="px-4 py-2 bg-[#168A72] text-white text-xs font-semibold rounded-xl hover:bg-[#0F6B59] transition shadow-xs cursor-pointer"
          >
            Go to Student Dashboard
          </button>
        </div>
      </div>
    );
  }

  const handleSeekTimestamp = (time: number) => {
    setSelectedTimestamp(time);
  };

  const tabs: {
    id: WorkspaceTab;
    label: string;
    icon: React.ElementType;
    badge?: boolean;
  }[] = [
    { id: "overview", label: "Overview", icon: Sparkles },
    { id: "notes", label: "AI Notes", icon: FileText },
    { id: "chapters", label: "Chapters", icon: ListTree },
    { id: "transcript", label: "Transcript", icon: BookOpen },
    { id: "ask", label: "Ask AI", icon: MessageSquare },
    { id: "quiz", label: "Quiz", icon: HelpCircle },
    {
      id: "revision",
      label: `Revision ${
        activeLecture.weakTopics && activeLecture.weakTopics.length > 0
          ? `(${activeLecture.weakTopics.length})`
          : ""
      }`,
      icon: AlertTriangle,
      badge: Boolean(
        activeLecture.weakTopics && activeLecture.weakTopics.length > 0
      ),
    },
  ];

  return (
    <div className="min-h-[calc(100vh-3.75rem)] bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] flex flex-col transition-colors font-sans">
      {/* 1. TOP WORKSPACE HEADER & TABS BAR */}
      <div className="border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-white/95 dark:bg-[#1B2421]/95 sticky top-15 z-20 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 pt-4 pb-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Title & Metadata */}
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate("/student-dashboard")}
                className="p-2 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.96] text-[#66736E] dark:text-[#9BA4A0] transition-all duration-150 cursor-pointer"
                title="Back to Student Dashboard"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-base sm:text-lg font-bold text-[#17201D] dark:text-[#F1FAF7] truncate max-w-lg">
                    {activeLecture.title}
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#66736E] dark:text-[#9BA4A0] mt-0.5 font-mono">
                  <span className="font-sans px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
                    {activeLecture.subject}
                  </span>
                  <span>•</span>
                  <span>{activeLecture.instructor || "Course Instructor"}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1 tabular-nums">
                    <Clock className="w-3 h-3 text-[#9BA4A0]" />
                    {formatSecondsToTime(activeLecture.duration)}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions (PDF Export) */}
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => setIsPdfModalOpen(true)}
                className="px-3.5 py-1.5 text-xs font-semibold bg-white dark:bg-[#1B2421] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.98] transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
                <span>Export PDF</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs Bar with smooth layoutId indicator */}
          <div className="mt-4 flex items-center space-x-1.5 border-t border-[#E4EAE7] dark:border-[#2C3B36] pt-1 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const isActive = workspaceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setWorkspaceTab(tab.id)}
                  className={`relative px-3.5 py-2.5 text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? "text-[#168A72] dark:text-[#23A98D] font-bold"
                      : "text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7]"
                  }`}
                >
                  <tab.icon
                    className={`w-3.5 h-3.5 ${tab.badge ? "text-[#E07A5F]" : ""}`}
                  />
                  <span>{tab.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="workspace-active-tab"
                      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#168A72] dark:bg-[#23A98D] rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. MAIN SUBVIEW CONTENT */}
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 w-full flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeLecture.id}-${workspaceTab}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          >
            {workspaceTab === "overview" && (
              <div className="space-y-6">
                {/* Executive Summary Card */}
                <div className="p-6 sm:p-7 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl shadow-xs space-y-5">
                  <div className="flex items-center justify-between pb-4 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                          Lecture Summary
                        </h2>
                        <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                          Generated from {activeLecture.transcript.length}{" "}
                          transcript segments
                        </p>
                      </div>
                    </div>

                    <span className="text-[11px] font-mono tabular-nums text-[#0F6B59] dark:text-[#23A98D] bg-[#E7F6F1] dark:bg-[#1E3730] px-3 py-1 rounded-full font-semibold">
                      {formatSecondsToTime(activeLecture.duration)} total runtime
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                    This lecture on{" "}
                    <strong className="font-semibold">
                      {activeLecture.title}
                    </strong>{" "}
                    explores core structural invariants, execution protocols, and
                    memory boundaries governing linear buffers. Key conceptual
                    pillars include operational invariants (LIFO vs. FIFO),
                    asymptotic algorithmic efficiency (O(1) push and pop
                    operations), edge conditions (overflow and underflow limits),
                    and practical computer systems applications including
                    compiler call stacks, recursion trees, and I/O buffer
                    pipelines.
                  </p>

                  {/* Quick Jump Action Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-4 border-t border-[#E4EAE7] dark:border-[#2C3B36]">
                    <button
                      onClick={() => setWorkspaceTab("notes")}
                      className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] hover:border-[#168A72]/45 hover:-translate-y-0.5 active:scale-[0.99] text-left transition-all duration-150 group cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-[#168A72] dark:text-[#23A98D] mb-2" />
                      <div className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                        Study Notes ({activeLecture.notes.length} Topics)
                      </div>
                      <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                        Definitions, algorithms, and complexity analyses.
                      </p>
                    </button>

                    <button
                      onClick={() => setWorkspaceTab("quiz")}
                      className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] hover:border-[#168A72]/45 hover:-translate-y-0.5 active:scale-[0.99] text-left transition-all duration-150 group cursor-pointer"
                    >
                      <HelpCircle className="w-4 h-4 text-[#168A72] dark:text-[#23A98D] mb-2" />
                      <div className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                        Take Quiz ({activeLecture.quiz?.questions?.length || 0}{" "}
                        Questions)
                      </div>
                      <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                        Adaptive diagnostic test with explanations.
                      </p>
                    </button>

                    <button
                      onClick={() => setWorkspaceTab("ask")}
                      className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] hover:border-[#168A72]/45 hover:-translate-y-0.5 active:scale-[0.99] text-left transition-all duration-150 group cursor-pointer"
                    >
                      <MessageSquare className="w-4 h-4 text-[#168A72] dark:text-[#23A98D] mb-2" />
                      <div className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                        Ask AI Assistant
                      </div>
                      <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                        Grounded answers with source timestamps.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Chapters Preview */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
                      Lecture Chapters
                    </h3>
                    <button
                      onClick={() => setWorkspaceTab("chapters")}
                      className="text-xs font-semibold text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] flex items-center gap-1 transition-colors cursor-pointer group"
                    >
                      <span>View full index</span>
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                    {activeLecture.chapters.map((ch, idx) => (
                      <div
                        key={ch.id}
                        onClick={() => {
                          setSelectedTimestamp(ch.startTime);
                          setWorkspaceTab("chapters");
                        }}
                        className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/45 hover:-translate-y-0.5 active:scale-[0.99] rounded-2xl cursor-pointer transition-all duration-150 space-y-1.5 shadow-xs group"
                      >
                        <div className="flex items-center justify-between text-xs text-[#66736E] dark:text-[#9BA4A0]">
                          <span className="font-semibold text-[#168A72] dark:text-[#23A98D] text-[11px]">
                            Chapter {idx + 1}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums">
                            {formatSecondsToTime(ch.startTime)} –{" "}
                            {formatSecondsToTime(ch.endTime)}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors line-clamp-1">
                          {ch.title}
                        </div>
                        <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] line-clamp-2">
                          {ch.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {workspaceTab === "notes" && (
              <SmartNotesViewer
                notes={activeLecture.notes}
                onSeekTimestamp={handleSeekTimestamp}
              />
            )}

            {workspaceTab === "chapters" && (
              <ChaptersTimeline
                chapters={activeLecture.chapters}
                onSeekTimestamp={handleSeekTimestamp}
              />
            )}

            {workspaceTab === "transcript" && (
              <div className="h-[75vh]">
                <TranscriptViewer
                  transcript={activeLecture.transcript}
                  onSeekTimestamp={handleSeekTimestamp}
                  selectedTimestamp={selectedTimestamp}
                />
              </div>
            )}

            {workspaceTab === "ask" && (
              <div className="h-[75vh]">
                <AskLecturePanel onSeekTimestamp={handleSeekTimestamp} />
              </div>
            )}

            {workspaceTab === "quiz" && activeLecture.quiz && (
              <QuizExperience
                quiz={activeLecture.quiz}
                onSeekTimestamp={handleSeekTimestamp}
                onGoToRevision={() => setWorkspaceTab("revision")}
              />
            )}

            {workspaceTab === "revision" && (
              <WeakTopicsView
                weakTopics={activeLecture.weakTopics || []}
                onSeekTimestamp={handleSeekTimestamp}
                onOpenTranscriptTab={() => setWorkspaceTab("transcript")}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* PDF Export Modal */}
      {isPdfModalOpen && (
        <PdfExportModal
          lecture={activeLecture}
          isOpen={isPdfModalOpen}
          onClose={() => setIsPdfModalOpen(false)}
        />
      )}
    </div>
  );
};
