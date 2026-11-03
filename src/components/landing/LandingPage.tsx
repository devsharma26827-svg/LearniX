import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Mic,
  Upload,
  Play,
  FileText,
  ListTree,
  HelpCircle,
  MessageSquare,
  Sparkles,
  ArrowRight,
  Clock,
  LayoutDashboard,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME, APP_CONFIG } from "../../config/branding";
import { formatSecondsToTime } from "../../utils/formatters";
import {
  PAGE_CONTAINER_VARIANTS,
  SECTION_ITEM_VARIANTS,
} from "../../utils/motionVariants";

interface LandingPageProps {
  onStartLive: () => void;
  onOpenUpload: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartLive,
  onOpenUpload,
}) => {
  const navigate = useNavigate();
  const { openLecture, setActiveView, lectures } = useLecture();

  const handleOpenDemo = () => {
    openLecture("lecture-dsa-stack-queue", "overview");
  };

  // Student metrics computed from actual data
  const totalLectures = lectures.length;
  const totalNotes = lectures.reduce((acc, l) => acc + (l.notes?.length || 0), 0);
  const totalQuizzes = lectures.filter(
    (l) => l.quiz && l.quiz.questions.length > 0
  ).length;

  return (
    <motion.div
      variants={PAGE_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
      className="min-h-screen bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] font-sans transition-colors"
    >
      {/* 1. HERO SECTION */}
      <motion.section
        variants={SECTION_ITEM_VARIANTS}
        className="pt-10 pb-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Heading, Subtitle & CTAs */}
          <div className="lg:col-span-7 space-y-5 text-left">
            {/* Small Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/20 text-[#0F6B59] dark:text-[#23A98D] shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-[#168A72]" />
              <span className="font-semibold">{APP_NAME}</span>
              <span className="text-[#66736E] dark:text-[#9BA4A0] opacity-50">·</span>
              <span className="font-mono text-[10px] tracking-wider uppercase font-semibold text-[#0F6B59] dark:text-[#23A98D]">
                {APP_CONFIG.tagline}
              </span>
            </div>

            {/* Main Heading */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#17201D] dark:text-[#F1FAF7] leading-[1.18] text-balance">
              Turn Every Lecture into{" "}
              <span className="text-[#168A72] dark:text-[#23A98D]">
                Structured Knowledge
              </span>
            </h1>

            {/* Supporting Text */}
            <p className="text-sm sm:text-base text-[#66736E] dark:text-[#9BA4A0] leading-relaxed max-w-xl">
              Capture lectures, generate AI notes, create quizzes, ask doubts, and revise smarter from one place.
            </p>

            {/* Primary & Secondary CTAs */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate("/student-dashboard")}
                className="px-5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white shadow-xs transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Go to Student Dashboard</span>
              </button>

              <button
                onClick={onStartLive}
                className="px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] hover:border-[#168A72]/40 active:scale-[0.98] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition-all duration-150 flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Mic className="w-4 h-4 text-[#168A72]" />
                <span>Record Live</span>
              </button>

              <button
                onClick={onOpenUpload}
                className="px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-white dark:bg-[#1B2421] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] hover:border-[#168A72]/40 active:scale-[0.98] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] transition-all duration-150 flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                <Upload className="w-4 h-4 text-[#66736E] dark:text-[#9BA4A0]" />
                <span>Upload Lecture</span>
              </button>

              <button
                onClick={handleOpenDemo}
                className="px-4 py-2.5 rounded-xl font-medium text-xs sm:text-sm text-[#0F6B59] dark:text-[#23A98D] hover:bg-[#E7F6F1] dark:hover:bg-[#1E3730] active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Open Demo (DSA)</span>
              </button>
            </div>
          </div>

          {/* Right Column: Educational Visual / Illustration */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-2xl overflow-hidden border border-[#E4EAE7] dark:border-[#2C3B36] shadow-sm bg-white dark:bg-[#1B2421]">
              <img
                src="/src/assets/images/hero_study_companion_1790337146865.jpg"
                alt={`Student studying with ${APP_NAME} AI study companion`}
                referrerPolicy="no-referrer"
                className="w-full h-auto object-cover max-h-[340px]"
              />

              {/* Floating Smart Badge Overlay */}
              <div className="absolute bottom-3 left-3 right-3 p-3 rounded-xl bg-white/95 dark:bg-[#1B2421]/95 backdrop-blur-md border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-[#E7F6F1] dark:bg-[#1E3730] text-[#168A72] dark:text-[#23A98D] flex items-center justify-center font-bold text-xs">
                    ✓
                  </div>
                  <div>
                    <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] block text-[11px]">
                      Live Audio → Notes Engine
                    </span>
                    <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0]">
                      100% transcript-grounded citations
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-[#0F6B59] dark:text-[#23A98D] font-semibold bg-[#E7F6F1] dark:bg-[#1E3730] px-2 py-0.5 rounded">
                  Ready
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* 2. QUICK BENEFITS */}
      <motion.section
        variants={SECTION_ITEM_VARIANTS}
        className="border-y border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] py-8"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  AI Notes
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] leading-tight">
                  Verifiable key concepts
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center shrink-0">
                <ListTree className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Chapter Breakdown
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] leading-tight">
                  Timestamped topics
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center shrink-0">
                <HelpCircle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Instant Quizzes
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] leading-tight">
                  Adaptive practice drills
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Grounded Doubt Solving
                </h3>
                <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] leading-tight">
                  Source-linked AI Q&A
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* 3. STUDENT STATS */}
      <motion.section
        variants={SECTION_ITEM_VARIANTS}
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12"
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider">
              Student Activity & Progress
            </h2>
            <p className="text-base sm:text-lg font-semibold text-[#17201D] dark:text-[#F1FAF7] mt-0.5">
              Your Daily Learning Summary
            </p>
          </div>
          <button
            onClick={() => navigate("/student-dashboard")}
            className="text-xs font-semibold text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] flex items-center gap-1 transition-colors cursor-pointer group"
          >
            <span>Open Student Dashboard</span>{" "}
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-150" />
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-1">
            <span className="text-xs text-[#66736E] dark:text-[#9BA4A0] font-medium">
              Lectures Processed
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
              {totalLectures}
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Full audio recordings indexed
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-1">
            <span className="text-xs text-[#66736E] dark:text-[#9BA4A0] font-medium">
              Notes Generated
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#168A72] dark:text-[#23A98D] tabular-nums">
              {totalNotes}
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Key definitions & concepts
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-1">
            <span className="text-xs text-[#66736E] dark:text-[#9BA4A0] font-medium">
              Quizzes Completed
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#17201D] dark:text-[#F1FAF7] tabular-nums">
              {totalQuizzes}
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Adaptive practice tests
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs space-y-1">
            <span className="text-xs text-[#66736E] dark:text-[#9BA4A0] font-medium">
              Revision Streak
            </span>
            <div className="text-2xl sm:text-3xl font-bold text-[#168A72] dark:text-[#23A98D] tabular-nums">
              5 Days
            </div>
            <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
              Continuous study momentum
            </p>
          </div>
        </div>
      </motion.section>

      {/* 4. QUICK ACTIONS: "What would you like to do today?" */}
      <motion.section
        variants={SECTION_ITEM_VARIANTS}
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-14"
      >
        <div className="mb-5">
          <h2 className="text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider">
            Quick Actions
          </h2>
          <p className="text-base sm:text-lg font-semibold text-[#17201D] dark:text-[#F1EFE8] mt-0.5">
            What would you like to do today?
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* 1. Record Live Lecture */}
          <button
            onClick={onStartLive}
            className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-3">
                <Mic className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Record Live Lecture
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-1 leading-snug">
                Real-time audio transcription with waveform
              </p>
            </div>
            <div className="pt-4 flex items-center text-xs font-medium text-[#168A72] dark:text-[#23A98D]">
              <span>Record</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform duration-150" />
            </div>
          </button>

          {/* 2. Upload Lecture */}
          <button
            onClick={onOpenUpload}
            className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-3">
                <Upload className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Upload Lecture
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-1 leading-snug">
                Import audio or video files for AI analysis
              </p>
            </div>
            <div className="pt-4 flex items-center text-xs font-medium text-[#168A72] dark:text-[#23A98D]">
              <span>Upload</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform duration-150" />
            </div>
          </button>

          {/* 3. View Notes */}
          <button
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "notes");
              else setActiveView("library");
            }}
            className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-3">
                <FileText className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                View Notes
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-1 leading-snug">
                Review definitions, formulas & summaries
              </p>
            </div>
            <div className="pt-4 flex items-center text-xs font-medium text-[#168A72] dark:text-[#23A98D]">
              <span>Read Notes</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform duration-150" />
            </div>
          </button>

          {/* 4. Take Quiz */}
          <button
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "quiz");
              else setActiveView("library");
            }}
            className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-3">
                <HelpCircle className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Take Quiz
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-1 leading-snug">
                Test understanding with instant feedback
              </p>
            </div>
            <div className="pt-4 flex items-center text-xs font-medium text-[#168A72] dark:text-[#23A98D]">
              <span>Start Quiz</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform duration-150" />
            </div>
          </button>

          {/* 5. Ask a Doubt */}
          <button
            onClick={() => {
              if (lectures[0]) openLecture(lectures[0].id, "ask");
              else setActiveView("library");
            }}
            className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] transition-all duration-150 text-left shadow-xs flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="w-9 h-9 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center mb-3">
                <MessageSquare className="w-4 h-4" />
              </div>
              <h3 className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors">
                Ask a Doubt
              </h3>
              <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] mt-1 leading-snug">
                Grounded Q&A with exact audio timestamps
              </p>
            </div>
            <div className="pt-4 flex items-center text-xs font-medium text-[#168A72] dark:text-[#23A98D]">
              <span>Ask Doubt</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform duration-150" />
            </div>
          </button>
        </div>
      </motion.section>

      {/* 5. RECENT LECTURES LIBRARY PREVIEW */}
      <motion.section
        variants={SECTION_ITEM_VARIANTS}
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider">
              Lecture Archive
            </h2>
            <p className="text-base sm:text-lg font-semibold text-[#17201D] dark:text-[#F1FAF7] mt-0.5">
              Available Lectures in Your Workspace
            </p>
          </div>
          <button
            onClick={() => setActiveView("library")}
            className="text-xs font-semibold text-[#168A72] hover:text-[#0F6B59] dark:text-[#23A98D] flex items-center gap-1 transition-colors cursor-pointer group"
          >
            <span>View all ({totalLectures})</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-150" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {lectures.slice(0, 3).map((lecture) => (
            <div
              key={lecture.id}
              onClick={() => openLecture(lecture.id, "overview")}
              className="p-5 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.99] transition-all duration-150 shadow-xs cursor-pointer flex flex-col justify-between space-y-4 group"
            >
              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="px-2.5 py-0.5 text-[11px] font-medium rounded-full bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
                    {lecture.subject}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] font-mono tabular-nums text-[#66736E] dark:text-[#9BA4A0]">
                    <Clock className="w-3 h-3 text-[#9BA4A0]" />
                    {formatSecondsToTime(lecture.duration)}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors line-clamp-1">
                  {lecture.title}
                </h3>

                <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mt-1 line-clamp-1">
                  {lecture.instructor
                    ? `Prof. ${lecture.instructor}`
                    : "Course Faculty"}{" "}
                  · {lecture.date}
                </p>
              </div>

              <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between text-xs">
                <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0] tabular-nums">
                  {lecture.chapters?.length || 0} chapters ·{" "}
                  {lecture.notes?.length || 0} notes
                </span>
                <span className="font-medium text-[#168A72] dark:text-[#23A98D] group-hover:translate-x-0.5 transition-transform duration-150 flex items-center gap-1">
                  Study <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      {/* 6. CLEAN FOOTER */}
      <footer className="border-t border-[#E4EAE7] dark:border-[#2C3B36] py-8 px-4 sm:px-6 lg:px-8 bg-white dark:bg-[#1B2421]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-[#66736E] dark:text-[#9BA4A0] gap-4">
          <div className="flex items-center space-x-2 font-medium text-[#17201D] dark:text-[#F1FAF7]">
            <span className="font-semibold text-sm text-[#168A72] dark:text-[#23A98D]">
              {APP_NAME}
            </span>
            <span>—</span>
            <span className="font-mono text-xs uppercase tracking-wider text-[#0F6B59] dark:text-[#23A98D] font-bold">
              {APP_CONFIG.tagline}
            </span>
          </div>
          <div>
            Real-time classroom capture • 100% lecture grounded citations • Adaptive study drills
          </div>
        </div>
      </footer>
    </motion.div>
  );
};
