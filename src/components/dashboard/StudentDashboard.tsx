import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Mic,
  Upload,
  BookOpen,
  TrendingUp,
  Clock,
  ArrowRight,
  CheckCircle2,
  FileText,
  HelpCircle,
  MessageSquare,
  Home,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { useAuth } from "../../context/AuthContext";
import { formatSecondsToTime, formatTimeAgo } from "../../utils/formatters";
import { StudyProgressChart } from "../common/StudyProgressChart";
import { AiQuotaWidget } from "./AiQuotaWidget";
import {
  PAGE_CONTAINER_VARIANTS,
  SECTION_ITEM_VARIANTS,
} from "../../utils/motionVariants";

interface StudentDashboardProps {
  onStartLive: () => void;
  onOpenUpload: () => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  onStartLive,
  onOpenUpload,
}) => {
  const navigate = useNavigate();
  const { lectures, openLecture, setActiveView } = useLecture();
  const { user } = useAuth();

  // Metrics calculated strictly from currently authenticated user's lectures
  const totalLectures = lectures.length;
  const allAttempts = useMemo(() => lectures.flatMap((l) => l.attempts || []), [lectures]);
  const avgAccuracy = useMemo(() => {
    if (allAttempts.length === 0) return 0;
    const total = allAttempts.reduce((sum, a) => {
      const acc =
        typeof a.accuracy === "number"
          ? a.accuracy
          : a.maxScore && a.maxScore > 0
          ? (a.score / a.maxScore) * 100
          : a.score;
      return sum + acc;
    }, 0);
    return Math.round(total / allAttempts.length);
  }, [allAttempts]);

  const allWeakTopics = useMemo(() => lectures.flatMap((l) => l.weakTopics || []), [lectures]);
  const totalNotes = useMemo(
    () => lectures.reduce((acc, l) => acc + (l.notes?.length || 0), 0),
    [lectures]
  );

  // Revision streak calculated genuinely from saved activity dates
  const revisionStreak = useMemo(() => {
    const dates = new Set<string>();
    for (const l of lectures) {
      if (l.date) dates.add(l.date.split("T")[0]);
      if (l.createdAt) dates.add(l.createdAt.split("T")[0]);
      for (const a of l.attempts || []) {
        if (a.timestamp) dates.add(a.timestamp.split("T")[0]);
      }
    }
    if (dates.size === 0) return 0;

    const sorted = Array.from(dates).sort().reverse();
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Streak is active only if there was activity today or yesterday
    if (sorted[0] !== today && sorted[0] !== yesterdayStr) {
      return 0;
    }

    let streak = 0;
    let curr = new Date(sorted[0]);
    for (const dStr of sorted) {
      const expected = curr.toISOString().split("T")[0];
      if (dStr === expected) {
        streak++;
        curr.setUTCDate(curr.getUTCDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [lectures]);

  // Dynamic Recent Activity calculated strictly from the user's saved records
  const recentActivities = useMemo(() => {
    interface ActivityItem {
      id: string;
      title: string;
      description: string;
      timestamp: string;
      timeAgo: string;
      iconType: "quiz" | "lecture" | "live";
      lectureId: string;
      targetTab: "overview" | "notes" | "quiz" | "revision";
    }

    const items: ActivityItem[] = [];

    for (const l of lectures) {
      // Lecture addition activity
      const dateIso = l.createdAt || (l.date ? `${l.date}T10:00:00Z` : new Date().toISOString());
      const isLive = l.source === "live";
      items.push({
        id: `lec-${l.id}`,
        title: isLive ? `Live Class Captured: ${l.title}` : `Lecture Processed: ${l.title}`,
        description: isLive
          ? `${formatSecondsToTime(l.duration)} recorded · ${l.notes?.length || 0} notes generated`
          : `Generated ${l.chapters?.length || 0} chapters, ${l.notes?.length || 0} notes, and ${l.quiz?.questions?.length || 0} quiz questions`,
        timestamp: dateIso,
        timeAgo: formatTimeAgo(dateIso),
        iconType: isLive ? "live" : "lecture",
        lectureId: l.id,
        targetTab: isLive ? "overview" : "notes",
      });

      // Quiz attempt activities
      for (const a of l.attempts || []) {
        const attIso = a.timestamp || dateIso;
        const scorePct =
          a.accuracy !== undefined
            ? a.accuracy
            : a.maxScore && a.maxScore > 0
            ? Math.round((a.score / a.maxScore) * 100)
            : a.score;
        items.push({
          id: `att-${a.id}`,
          title: `Completed Quiz: ${l.title}`,
          description: `Scored ${scorePct}% · ${a.correctCount !== undefined ? a.correctCount : a.score} questions answered correctly`,
          timestamp: attIso,
          timeAgo: formatTimeAgo(attIso),
          iconType: "quiz",
          lectureId: l.id,
          targetTab: "quiz",
        });
      }
    }

    return items
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }, [lectures]);

  const studentName = user?.name ? user.name.split(" ")[0] : "Student";

  return (
    <motion.div
      variants={PAGE_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
      className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-9 font-sans"
    >
      {/* 1. TOP GREETING & PRIMARY ACTIONS */}
      <motion.div
        variants={SECTION_ITEM_VARIANTS}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] pb-6"
      >
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17201D] dark:text-[#F1FAF7]">
              Good morning, {studentName}.
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#66736E] dark:text-[#9BA4A0] mt-1">
            Turn every lecture into structured intelligence. What are we studying today?
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => navigate("/home")}
            className="px-3.5 py-2.5 text-xs font-semibold bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.98] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl transition-all duration-150 flex items-center gap-2 shadow-xs cursor-pointer"
            title="Go to Home Overview"
          >
            <Home className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
            <span>Home Overview</span>
          </button>

          <button
            onClick={onStartLive}
            className="px-4 py-2.5 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white rounded-xl shadow-xs transition-all duration-150 flex items-center gap-2 cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Record Live Lecture</span>
          </button>

          <button
            onClick={onOpenUpload}
            className="px-4 py-2.5 text-xs font-semibold bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.98] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl transition-all duration-150 flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
            <span>Upload Lecture</span>
          </button>
        </div>
      </motion.div>

      {/* 2. STUDENT STATS ROW */}
      <motion.section variants={SECTION_ITEM_VARIANTS} className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
          Learning Stats
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            onClick={() => setActiveView("library")}
            className="p-5 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/40 hover:-translate-y-0.5 rounded-2xl shadow-xs transition-all duration-150 space-y-1 cursor-pointer"
          >
            <span className="text-xs font-medium text-[#66736E] dark:text-[#9BA4A0]">
              Lectures Processed
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
              {totalLectures}
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Full classroom sessions
            </p>
          </div>

          <div
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "notes");
              else setActiveView("library");
            }}
            className="p-5 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/40 hover:-translate-y-0.5 rounded-2xl shadow-xs transition-all duration-150 space-y-1 cursor-pointer"
          >
            <span className="text-xs font-medium text-[#66736E] dark:text-[#9BA4A0]">
              Notes Generated
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#168A72] dark:text-[#23A98D] tabular-nums">
              {totalNotes}
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Definitions & invariants
            </p>
          </div>

          <div
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "quiz");
              else setActiveView("library");
            }}
            className="p-5 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/40 hover:-translate-y-0.5 rounded-2xl shadow-xs transition-all duration-150 space-y-1 cursor-pointer"
          >
            <span className="text-xs font-medium text-[#66736E] dark:text-[#9BA4A0]">
              Quiz Accuracy
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#168A72] dark:text-[#23A98D] tabular-nums">
              {avgAccuracy}%
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Across completed drills
            </p>
          </div>

          <div
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "revision");
              else setActiveView("library");
            }}
            className="p-5 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/40 hover:-translate-y-0.5 rounded-2xl shadow-xs transition-all duration-150 space-y-1 cursor-pointer"
          >
            <span className="text-xs font-medium text-[#66736E] dark:text-[#9BA4A0]">
              Revision Streak
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
              {revisionStreak} {revisionStreak === 1 ? "Day" : "Days"}
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              {allWeakTopics.length} areas flagged for review
            </p>
          </div>
        </div>
      </motion.section>

      {/* 3. QUICK ACTIONS: "What would you like to do today?" */}
      <motion.section variants={SECTION_ITEM_VARIANTS} className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
          Quick Actions
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          <button
            onClick={onStartLive}
            className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-2.5">
                <Mic className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Record Live Lecture
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                Live transcript & audio
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] mt-3 flex items-center gap-1">
              Start{" "}
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
            </span>
          </button>

          <button
            onClick={onOpenUpload}
            className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-2.5">
                <Upload className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Upload Lecture
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                Audio or video files
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] mt-3 flex items-center gap-1">
              Upload{" "}
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
            </span>
          </button>

          <button
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "notes");
              else setActiveView("library");
            }}
            className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-2.5">
                <FileText className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                View Notes
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                Structured summaries
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] mt-3 flex items-center gap-1">
              Notes{" "}
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
            </span>
          </button>

          <button
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "quiz");
              else setActiveView("library");
            }}
            className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-2.5">
                <HelpCircle className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Take Quiz
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                Self-evaluation drill
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] mt-3 flex items-center gap-1">
              Quiz{" "}
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
            </span>
          </button>

          <button
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "ask");
              else setActiveView("library");
            }}
            className="p-4 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-2.5">
                <MessageSquare className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Ask a Doubt
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
                Grounded citations
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] mt-3 flex items-center gap-1">
              Ask AI{" "}
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
            </span>
          </button>
        </div>
      </motion.section>

      {/* 4. INTERACTIVE LEARNING PROGRESS & VELOCITY GRAPH */}
      <motion.section variants={SECTION_ITEM_VARIANTS} className="space-y-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
              Learning Progress
            </h2>
          </div>
          <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
            Interactive trend across courses
          </span>
        </div>

        <div className="p-5 sm:p-6 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl shadow-xs">
          <StudyProgressChart compact />
        </div>
      </motion.section>

      {/* AI ORCHESTRATOR & QUOTA STATUS */}
      <motion.section variants={SECTION_ITEM_VARIANTS}>
        <AiQuotaWidget />
      </motion.section>

      {/* 5. RECENT LECTURES */}
      <motion.section variants={SECTION_ITEM_VARIANTS} className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
            Recent Lectures
          </h2>
          <button
            onClick={() => setActiveView("library")}
            className="text-xs font-semibold text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] transition-colors flex items-center gap-1 cursor-pointer group"
          >
            <span>View all</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
          </button>
        </div>

        {lectures.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {lectures.slice(0, 3).map((lecture) => {
              const hasQuiz = lecture.quiz && lecture.quiz.questions.length > 0;
              const lastAttempt =
                lecture.attempts && lecture.attempts[lecture.attempts.length - 1];

              return (
                <div
                  key={lecture.id}
                  onClick={() => openLecture(lecture.id, "overview")}
                  className="p-5 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl cursor-pointer transition-all duration-150 hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.99] shadow-xs flex flex-col justify-between space-y-4 group"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-[#66736E] dark:text-[#9BA4A0]">
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
                        {lecture.subject}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] font-mono tabular-nums">
                        <Clock className="w-3 h-3 text-[#9BA4A0]" />
                        {formatSecondsToTime(lecture.duration)}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors line-clamp-1">
                      {lecture.title}
                    </h3>

                    <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] line-clamp-1">
                      {lecture.instructor
                        ? `Prof. ${lecture.instructor}`
                        : "Recorded Lecture"}{" "}
                      · {lecture.date}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between text-xs">
                    <div>
                      {lastAttempt ? (
                        <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] tabular-nums">
                          Score: {lastAttempt.score}%
                        </span>
                      ) : hasQuiz ? (
                        <span className="text-[11px] font-medium text-[#66736E] dark:text-[#9BA4A0]">
                          Quiz Ready
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#9BA4A0]">Transcribed</span>
                      )}
                    </div>

                    <span className="text-xs font-semibold text-[#168A72] dark:text-[#23A98D] group-hover:translate-x-0.5 transition-transform duration-150 flex items-center gap-1">
                      Study <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl text-xs text-[#66736E] dark:text-[#9BA4A0] space-y-3">
            <p className="font-medium text-sm text-[#17201D] dark:text-[#F1FAF7]">No lectures processed yet</p>
            <p className="max-w-md mx-auto">Upload a recording or start a live lecture capture to generate structured notes, chapters, and quizzes.</p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={onStartLive}
                className="px-3.5 py-1.5 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white rounded-xl shadow-xs transition-all duration-150 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Record Live</span>
              </button>
              <button
                onClick={onOpenUpload}
                className="px-3.5 py-1.5 text-xs font-semibold bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.98] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl transition-all duration-150 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
                <span>Upload Lecture</span>
              </button>
            </div>
          </div>
        )}
      </motion.section>

      {/* 6. REVISION NEEDED (Flagged Weak Concepts) */}
      <motion.section variants={SECTION_ITEM_VARIANTS} className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
            Revision Needed
          </h2>
          {allWeakTopics.length > 0 && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F]">
              {allWeakTopics.length} topics flagged
            </span>
          )}
        </div>

        {allWeakTopics.length > 0 ? (
          <div className="space-y-2.5">
            {allWeakTopics.map((topic, idx) => (
              <div
                key={topic.id || idx}
                className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/35 transition-colors duration-150 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      {topic.topicName}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold font-mono tabular-nums bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F]">
                      Accuracy: {topic.accuracy}%
                    </span>
                  </div>
                  <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] max-w-2xl leading-relaxed">
                    {topic.explanation}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      const targetId = topic.lectureId || lectures[0]?.id;
                      if (targetId) openLecture(targetId, "revision");
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white rounded-xl transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer group"
                  >
                    <span>Review Topic</span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl text-xs text-[#66736E] dark:text-[#9BA4A0]">
            No weak topics detected. Take more quizzes to discover areas for practice.
          </div>
        )}
      </motion.section>

      {/* 7. RECENT ACTIVITY FEED */}
      <motion.section variants={SECTION_ITEM_VARIANTS} className="space-y-3.5">
        <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
          Recent Activity
        </h2>

        {recentActivities.length > 0 ? (
          <div className="border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl divide-y divide-[#E4EAE7] dark:divide-[#2C3B36] shadow-xs overflow-hidden">
            {recentActivities.map((act) => (
              <div
                key={act.id}
                onClick={() => {
                  if (act.lectureId) openLecture(act.lectureId, act.targetTab || "overview");
                }}
                className="p-4 flex items-center justify-between text-xs hover:bg-[#F8FAF8] dark:hover:bg-[#24302C]/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center ${
                      act.iconType === "quiz"
                        ? "bg-[#E7F6F1] dark:bg-[#1E3730] text-[#168A72] dark:text-[#23A98D]"
                        : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0]"
                    }`}
                  >
                    {act.iconType === "quiz" ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : act.iconType === "mic" ? (
                      <Mic className="w-4 h-4" />
                    ) : (
                      <BookOpen className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                      {act.title}
                    </span>
                    <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
                      {act.description}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-[#9BA4A0] tabular-nums">
                  {act.timeAgo}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] rounded-2xl text-xs text-[#66736E] dark:text-[#9BA4A0]">
            No learning activity yet. Start your first lecture to see your progress here.
          </div>
        )}
      </motion.section>
    </motion.div>
  );
};
