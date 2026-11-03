import React, { useState } from "react";
import { motion } from "motion/react";
import {
  FolderKanban,
  Search,
  Trash2,
  Clock,
  ArrowRight,
  Upload,
  Mic,
  FileText,
  ListTree,
  HelpCircle,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";
import { formatSecondsToTime } from "../../utils/formatters";
import {
  PAGE_CONTAINER_VARIANTS,
  SECTION_ITEM_VARIANTS,
} from "../../utils/motionVariants";

interface LectureLibraryProps {
  onStartLive: () => void;
  onOpenUpload: () => void;
}

export const LectureLibrary: React.FC<LectureLibraryProps> = ({
  onStartLive,
  onOpenUpload,
}) => {
  const { lectures, openLecture, deleteLecture } = useLecture();
  const [search, setSearch] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "duration" | "title">("date");

  const subjects = Array.from(new Set(lectures.map((l) => l.subject)));

  const filtered = lectures
    .filter((l) => {
      const matchSearch =
        search.trim() === "" ||
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        l.subject.toLowerCase().includes(search.toLowerCase()) ||
        (l.instructor &&
          l.instructor.toLowerCase().includes(search.toLowerCase()));
      const matchSubject =
        selectedSubject === "all" || l.subject === selectedSubject;
      return matchSearch && matchSubject;
    })
    .sort((a, b) => {
      if (sortBy === "duration") return b.duration - a.duration;
      if (sortBy === "title") return a.title.localeCompare(b.title);
      return (
        new Date(b.createdAt || b.date).getTime() -
        new Date(a.createdAt || a.date).getTime()
      );
    });

  return (
    <motion.div
      variants={PAGE_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
      className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-7 font-sans"
    >
      {/* 1. Header with Breadcrumb & Primary Action */}
      <motion.div
        variants={SECTION_ITEM_VARIANTS}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#E4EAE7] dark:border-[#2C3B36]"
      >
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
              <FolderKanban className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-bold text-[#17201D] dark:text-[#F1FAF7]">
              Lecture Library
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#66736E] dark:text-[#9BA4A0] mt-1">
            Complete collection of transcribed recordings, synthesized notes, and adaptive quizzes
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={onStartLive}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white shadow-xs transition-all duration-150 flex items-center gap-1.5 cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Record Live</span>
          </button>
          <button
            onClick={onOpenUpload}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#1B2421] text-[#17201D] dark:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] active:scale-[0.98] transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#66736E] dark:text-[#9BA4A0]" />
            <span>Upload Media</span>
          </button>
        </div>
      </motion.div>

      {/* 2. Search & Filter Bar */}
      <motion.div
        variants={SECTION_ITEM_VARIANTS}
        className="p-4 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs flex flex-col md:flex-row items-center justify-between gap-3.5"
      >
        <div className="relative w-full md:w-80">
          <Search className="w-3.5 h-3.5 text-[#9BA4A0] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search lectures, topics, or faculty..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto overflow-x-auto justify-between md:justify-end">
          {/* Subject Filter Chips */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSelectedSubject("all")}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
                selectedSubject === "all"
                  ? "bg-[#168A72] text-white font-semibold"
                  : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7]"
              }`}
            >
              All ({lectures.length})
            </button>
            {subjects.map((sub) => (
              <button
                key={sub}
                onClick={() => setSelectedSubject(sub)}
                className={`px-3 py-1.5 text-xs font-medium rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
                  selectedSubject === sub
                    ? "bg-[#168A72] text-white font-semibold"
                    : "bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7]"
                }`}
              >
                {sub}
              </button>
            ))}
          </div>

          {/* Sort Selector */}
          <select
            value={sortBy}
            onChange={(e: any) => setSortBy(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] text-[#17201D] dark:text-[#F1FAF7] focus:outline-none cursor-pointer"
          >
            <option value="date">Most Recent</option>
            <option value="duration">Longest Duration</option>
            <option value="title">Title (A-Z)</option>
          </select>
        </div>
      </motion.div>

      {/* 3. Empty State or Grid */}
      <motion.div variants={SECTION_ITEM_VARIANTS}>
        {filtered.length === 0 ? (
          <div className="p-12 text-center bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl max-w-md mx-auto space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] mx-auto flex items-center justify-center">
              <FolderKanban className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                No lectures found
              </h3>
              <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mt-1 leading-relaxed">
                Upload your first lecture or record a live class, and {APP_NAME} will turn it into structured notes.
              </p>
            </div>
            <div className="pt-2 flex justify-center gap-2">
              <button
                onClick={onStartLive}
                className="px-4 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs cursor-pointer"
              >
                Record Live
              </button>
              <button
                onClick={onOpenUpload}
                className="px-4 py-2 text-xs font-semibold bg-[#F4F6F5] dark:bg-[#24302C] text-[#17201D] dark:text-[#F1FAF7] rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] cursor-pointer"
              >
                Upload Media
              </button>
            </div>
          </div>
        ) : (
          /* 4. Grid of Lecture Cards */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((lecture) => {
              const hasQuiz = lecture.quiz && lecture.quiz.questions.length > 0;
              const hasNotes = lecture.notes && lecture.notes.length > 0;
              const chaptersCount = lecture.chapters?.length || 0;

              return (
                <div
                  key={lecture.id}
                  onClick={() => openLecture(lecture.id, "overview")}
                  className="p-5 bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl hover:border-[#168A72]/45 hover:-translate-y-0.5 hover:shadow-sm transition-all duration-150 shadow-xs flex flex-col justify-between space-y-4 group cursor-pointer"
                >
                  <div>
                    {/* Top tags: Subject + Duration */}
                    <div className="flex items-center justify-between text-xs mb-3">
                      <span className="font-semibold text-[11px] rounded-full px-2.5 py-0.5 bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
                        {lecture.subject}
                      </span>
                      <span className="text-xs text-[#66736E] dark:text-[#9BA4A0] flex items-center gap-1 font-mono tabular-nums">
                        <Clock className="w-3 h-3 text-[#9BA4A0]" />
                        {formatSecondsToTime(lecture.duration)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="text-base font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] dark:group-hover:text-[#23A98D] transition-colors leading-snug">
                      {lecture.title}
                    </h3>

                    {/* Instructor & Date */}
                    <div className="flex items-center justify-between text-xs text-[#66736E] dark:text-[#9BA4A0] mt-1.5">
                      <span>
                        {lecture.instructor || "Course Lecture"} · {lecture.date}
                      </span>
                    </div>

                    {/* Badges for Chapters, Notes, Quiz */}
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#66736E] dark:text-[#9BA4A0] bg-[#F4F6F5] dark:bg-[#24302C] px-2 py-0.5 rounded-md tabular-nums">
                        <ListTree className="w-3 h-3 text-[#168A72]" />
                        <span>{chaptersCount} Chapters</span>
                      </span>

                      {hasNotes && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#66736E] dark:text-[#9BA4A0] bg-[#F4F6F5] dark:bg-[#24302C] px-2 py-0.5 rounded-md">
                          <FileText className="w-3 h-3 text-[#168A72]" />
                          <span>AI Notes</span>
                        </span>
                      )}

                      {hasQuiz && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#66736E] dark:text-[#9BA4A0] bg-[#F4F6F5] dark:bg-[#24302C] px-2 py-0.5 rounded-md">
                          <HelpCircle className="w-3 h-3 text-[#168A72]" />
                          <span>Quiz Ready</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLecture(lecture.id);
                      }}
                      className="p-1.5 text-[#9BA4A0] hover:text-[#E07A5F] rounded-lg hover:bg-[#FDF0ED] dark:hover:bg-[#38241D] transition cursor-pointer"
                      title="Delete Lecture"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openLecture(lecture.id, "overview");
                      }}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] active:scale-[0.98] text-white transition-all duration-150 flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <span>Open Workspace</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-150" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
