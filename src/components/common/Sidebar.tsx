import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Home,
  LayoutDashboard,
  BookOpen,
  Mic,
  FileText,
  HelpCircle,
  RefreshCw,
  TrendingUp,
  CalendarCheck,
  Bookmark,
  X,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME, APP_CONFIG } from "../../config/branding";
import { StudyProgressChart } from "./StudyProgressChart";
import {
  EASE_OUT_EXPO,
  MODAL_BACKDROP_VARIANTS,
  MODAL_PANEL_VARIANTS,
} from "../../utils/motionVariants";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenLiveModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen = true,
  onClose,
  onOpenLiveModal,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeLecture,
    openLecture,
    lectures,
    liveSession,
    resetToSampleData,
    isLoading,
    workspaceTab,
  } = useLecture();

  const [activeStudyModal, setActiveStudyModal] = useState<
    "progress" | "study-plan" | "bookmarks" | null
  >(null);

  const [studyPlanTasks, setStudyPlanTasks] = useState([
    {
      id: "sp-1",
      day: "Today",
      task: "Review Stack Overflow Invariants",
      course: "DSA",
      done: true,
    },
    {
      id: "sp-2",
      day: "Tomorrow",
      task: "Practice Queue Circular Buffer Drill",
      course: "DSA",
      done: false,
    },
    {
      id: "sp-3",
      day: "Wednesday",
      task: "Virtual Memory Paging Notes",
      course: "OS",
      done: false,
    },
    {
      id: "sp-4",
      day: "Thursday",
      task: "TCP 3-Way Handshake Quiz",
      course: "Networks",
      done: false,
    },
  ]);

  // Close active study modal on Escape key
  useEffect(() => {
    if (!activeStudyModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveStudyModal(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeStudyModal]);

  const isHomeOverviewActive =
    location.pathname === "/home" || location.pathname === "/";
  const isStudentDashboardActive = location.pathname === "/student-dashboard";
  const isLecturesActive =
    location.pathname === "/lectures" || location.pathname === "/library";
  const isLiveActive = location.pathname === "/live";
  const isNotesActive =
    location.pathname === "/notes" ||
    (location.pathname.startsWith("/workspace") && workspaceTab === "notes");
  const isQuizActive =
    location.pathname === "/quizzes" ||
    (location.pathname.startsWith("/workspace") && workspaceTab === "quiz");
  const isRevisionActive =
    location.pathname === "/revision" ||
    (location.pathname.startsWith("/workspace") && workspaceTab === "revision");

  const mainNavItems = [
    {
      id: "home-overview",
      label: "Home Overview",
      icon: Home,
      isActive: isHomeOverviewActive,
      onClick: () => {
        navigate("/home");
        onClose?.();
      },
    },
    {
      id: "student-dashboard",
      label: "Student Dashboard",
      icon: LayoutDashboard,
      isActive: isStudentDashboardActive,
      onClick: () => {
        navigate("/student-dashboard");
        onClose?.();
      },
    },
    {
      id: "lectures",
      label: "Lectures",
      icon: BookOpen,
      isActive: isLecturesActive,
      onClick: () => {
        navigate("/lectures");
        onClose?.();
      },
    },
    {
      id: "live",
      label: "Live Lecture",
      icon: Mic,
      isActive: isLiveActive,
      badge: liveSession.isRecording ? "Live" : undefined,
      onClick: () => {
        if (liveSession.isRecording) {
          navigate("/live");
        } else {
          onOpenLiveModal();
        }
        onClose?.();
      },
    },
    {
      id: "notes",
      label: "Notes",
      icon: FileText,
      isActive: isNotesActive,
      onClick: () => {
        const targetId = activeLecture?.id || lectures[0]?.id;
        if (targetId) {
          openLecture(targetId, "notes");
        } else {
          navigate("/notes");
        }
        onClose?.();
      },
    },
    {
      id: "quizzes",
      label: "Quizzes",
      icon: HelpCircle,
      isActive: isQuizActive,
      onClick: () => {
        const targetId = activeLecture?.id || lectures[0]?.id;
        if (targetId) {
          openLecture(targetId, "quiz");
        } else {
          navigate("/quizzes");
        }
        onClose?.();
      },
    },
    {
      id: "revision",
      label: "Revision",
      icon: RefreshCw,
      isActive: isRevisionActive,
      onClick: () => {
        const targetId = activeLecture?.id || lectures[0]?.id;
        if (targetId) {
          openLecture(targetId, "revision");
        } else {
          navigate("/revision");
        }
        onClose?.();
      },
    },
  ];

  const studyNavItems = [
    {
      id: "progress",
      label: "Progress",
      icon: TrendingUp,
      onClick: () => setActiveStudyModal("progress"),
    },
    {
      id: "study-plan",
      label: "Study Plan",
      icon: CalendarCheck,
      onClick: () => setActiveStudyModal("study-plan"),
    },
    {
      id: "bookmarks",
      label: "Bookmarks",
      icon: Bookmark,
      onClick: () => setActiveStudyModal("bookmarks"),
    },
  ];

  const totalLectures = lectures.length;
  const allAttempts = lectures.flatMap((l) => l.attempts || []);
  const avgAccuracy =
    allAttempts.length > 0
      ? Math.round(
          allAttempts.reduce((sum, a) => sum + a.score, 0) / allAttempts.length
        )
      : 86;

  const toggleStudyPlanTask = (taskId: string) => {
    setStudyPlanTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t))
    );
  };

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-[#1B2421] border-r border-[#E4EAE7] dark:border-[#2C3B36] flex flex-col transition-transform duration-200 ease-out md:translate-x-0 ${
          isOpen
            ? "translate-x-0 shadow-lg md:shadow-none"
            : "-translate-x-full"
        }`}
      >
        {/* Brand Lockup */}
        <div className="h-16 px-5 border-b border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between shrink-0">
          <button
            onClick={() => {
              navigate("/home");
              onClose?.();
            }}
            className="flex items-center gap-2.5 text-left focus:outline-none group cursor-pointer"
            title="Return to Home Overview"
          >
            <div className="w-8 h-8 rounded-xl bg-[#168A72] flex items-center justify-center text-white shadow-xs transition-transform duration-150 group-hover:scale-[1.03] group-active:scale-[0.97]">
              <span className="font-mono text-xs font-bold tracking-tight">
                {APP_CONFIG.shortCode}
              </span>
            </div>
            <span className="text-sm font-semibold tracking-tight text-[#17201D] dark:text-[#F1FAF7]">
              {APP_NAME}
            </span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden p-1.5 rounded-lg text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation Sections */}
        <div className="p-3 space-y-6 overflow-y-auto flex-1">
          {/* MAIN SECTION */}
          <div className="space-y-1">
            <div className="px-3 pb-1 text-[11px] font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider">
              Main
            </div>
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className={`relative w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-150 cursor-pointer group ${
                    item.isActive
                      ? "text-[#17201D] dark:text-[#F1FAF7] font-semibold"
                      : "text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5]/80 dark:hover:bg-[#24302C]/70"
                  }`}
                >
                  {item.isActive && (
                    <motion.div
                      layoutId="sidebar-active-indicator"
                      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                      className="absolute inset-0 rounded-xl bg-[#F1FAF7] dark:bg-[#1E3730] border border-[#168A72]/15 dark:border-[#23A98D]/20"
                    />
                  )}

                  <div className="relative z-10 flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5 ${
                        item.isActive
                          ? "text-[#0F6B59] dark:text-[#23A98D]"
                          : "text-[#66736E] dark:text-[#9BA4A0] group-hover:text-[#17201D] dark:group-hover:text-[#F1FAF7]"
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span className="relative z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#E7F6F1] text-[#0F6B59] dark:bg-[#1E3730] dark:text-[#23A98D]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#168A72]" />
                      <span>{item.badge}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* STUDY SECTION */}
          <div className="space-y-1">
            <div className="px-3 pb-1 text-[11px] font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider">
              Study
            </div>
            {studyNavItems.map((item) => {
              const Icon = item.icon;
              const isModalOpen = activeStudyModal === item.id;
              return (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-150 cursor-pointer group ${
                    isModalOpen
                      ? "bg-[#F1FAF7] dark:bg-[#1E3730] text-[#17201D] dark:text-[#F1FAF7] font-semibold"
                      : "text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5 ${
                        isModalOpen
                          ? "text-[#0F6B59] dark:text-[#23A98D]"
                          : "text-[#66736E] dark:text-[#9BA4A0] group-hover:text-[#17201D] dark:group-hover:text-[#F1FAF7]"
                      }`}
                    />
                    <span>{item.label}</span>
                  </div>
                </button>
              );
            })}

            <button
              onClick={async () => {
                await resetToSampleData();
                onClose?.();
              }}
              disabled={isLoading}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors duration-150 cursor-pointer group"
              title="Reset sample lecture data"
            >
              <div className="flex items-center gap-2.5">
                <RotateCcw
                  className={`w-4 h-4 text-[#66736E] dark:text-[#9BA4A0] transition-transform duration-150 group-hover:-rotate-12 ${
                    isLoading ? "animate-spin text-[#168A72]" : ""
                  }`}
                />
                <span>Reset Demo Data</span>
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* Modals with AnimatePresence */}
      <AnimatePresence>
        {/* 1. Interactive Progress & Analytics Modal */}
        {activeStudyModal === "progress" && (
          <motion.div
            key="progress-modal-backdrop"
            variants={MODAL_BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => setActiveStudyModal(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs font-sans overflow-y-auto"
          >
            <motion.div
              key="progress-modal-panel"
              variants={MODAL_PANEL_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Study Progress & Metrics"
              className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-2xl p-5 sm:p-6 space-y-5 my-auto max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-[#17201D] dark:text-[#F1FAF7]">
                      Study Progress & Learning Velocity
                    </h3>
                    <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                      Interactive performance trend and mastery metrics across all courses
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveStudyModal(null)}
                  className="p-1.5 rounded-lg text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors cursor-pointer"
                  aria-label="Close progress modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 4 Metric Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36]">
                  <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] block">
                    Lectures Processed
                  </span>
                  <span className="text-xl sm:text-2xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums mt-0.5 block">
                    {totalLectures}
                  </span>
                  <span className="text-[10px] text-[#0F6B59] dark:text-[#23A98D] font-medium mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Indexed
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36]">
                  <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] block">
                    Quiz Accuracy
                  </span>
                  <span className="text-xl sm:text-2xl font-bold text-[#168A72] dark:text-[#23A98D] tabular-nums mt-0.5 block">
                    {avgAccuracy}%
                  </span>
                  <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] mt-1 block">
                    All question drills
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36]">
                  <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] block">
                    Revision Streak
                  </span>
                  <span className="text-xl sm:text-2xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums mt-0.5 block">
                    5 Days
                  </span>
                  <span className="text-[10px] text-[#0F6B59] dark:text-[#23A98D] font-medium mt-1 block">
                    Consistent pace
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36]">
                  <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] block">
                    Notes Generated
                  </span>
                  <span className="text-xl sm:text-2xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums mt-0.5 block">
                    {lectures.reduce((acc, l) => acc + (l.notes?.length || 0), 0)}
                  </span>
                  <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] mt-1 block">
                    Key concept units
                  </span>
                </div>
              </div>

              {/* Interactive Line Graph & Course Mastery Breakdown */}
              <StudyProgressChart
                onSelectLecture={(lectureId) => {
                  setActiveStudyModal(null);
                  onClose?.();
                  openLecture(lectureId, "overview");
                }}
              />

              {/* Footer */}
              <div className="pt-2 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between">
                <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                  Hover or tap any data point on the graph to inspect daily performance
                </span>
                <button
                  onClick={() => setActiveStudyModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white transition cursor-pointer shadow-xs"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* 2. Study Plan Modal */}
        {activeStudyModal === "study-plan" && (
          <motion.div
            key="study-plan-backdrop"
            variants={MODAL_BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => setActiveStudyModal(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs font-sans"
          >
            <motion.div
              key="study-plan-panel"
              variants={MODAL_PANEL_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Weekly Study Plan"
              className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                    <CalendarCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Weekly Study Plan
                    </h3>
                    <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                      Click any task to toggle completion status
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveStudyModal(null)}
                  className="p-1.5 rounded-lg text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                {studyPlanTasks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleStudyPlanTask(item.id)}
                    className="w-full p-3.5 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] hover:border-[#168A72]/40 transition flex items-center justify-between text-xs text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] transition-colors ${
                          item.done
                            ? "bg-[#168A72] text-white"
                            : "border border-[#E4EAE7] dark:border-[#2C3B36] text-[#66736E] group-hover:border-[#168A72]"
                        }`}
                      >
                        {item.done ? "✓" : ""}
                      </span>
                      <div>
                        <span
                          className={`font-semibold block transition-colors ${
                            item.done
                              ? "line-through text-[#66736E] dark:text-[#9BA4A0]"
                              : "text-[#17201D] dark:text-[#F1FAF7]"
                          }`}
                        >
                          {item.task}
                        </span>
                        <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0]">
                          {item.course} · {item.day}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded transition-colors ${
                        item.done
                          ? "bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]"
                          : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0]"
                      }`}
                    >
                      {item.done ? "Completed" : "Scheduled"}
                    </span>
                  </button>
                ))}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setActiveStudyModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white transition cursor-pointer shadow-xs"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* 3. Bookmarks Modal */}
        {activeStudyModal === "bookmarks" && (
          <motion.div
            key="bookmarks-backdrop"
            variants={MODAL_BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => setActiveStudyModal(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs font-sans"
          >
            <motion.div
              key="bookmarks-panel"
              variants={MODAL_PANEL_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Saved Bookmarks"
              className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
                    <Bookmark className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      Saved Bookmarks
                    </h3>
                    <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                      Key chapters and note sections you pinned
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveStudyModal(null)}
                  className="p-1.5 rounded-lg text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                {[
                  {
                    title: "Stack Operations: Push & Pop Invariants",
                    time: "@04:20",
                    subject: "Data Structures & Algorithms",
                    lectureIdx: 0,
                  },
                  {
                    title: "Circular Queue Boundary Conditions",
                    time: "@14:50",
                    subject: "Data Structures & Algorithms",
                    lectureIdx: 0,
                  },
                  {
                    title: "Page Table Inverted Index Algorithm",
                    time: "@22:15",
                    subject: "Operating Systems",
                    lectureIdx: 1,
                  },
                ].map((b, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setActiveStudyModal(null);
                      onClose?.();
                      const target = lectures[b.lectureIdx] || lectures[0];
                      if (target) openLecture(target.id, "notes");
                    }}
                    className="p-3.5 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] hover:border-[#168A72]/40 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer flex items-center justify-between text-xs group"
                  >
                    <div>
                      <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors block">
                        {b.title}
                      </span>
                      <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0]">
                        {b.subject} · {b.time}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#168A72] dark:text-[#23A98D] font-medium group-hover:translate-x-0.5 transition-transform">
                      Jump →
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setActiveStudyModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white transition cursor-pointer shadow-xs"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
