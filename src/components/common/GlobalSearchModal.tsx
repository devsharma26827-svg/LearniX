import React, { useState, useEffect } from "react";
import { Search, X, BookOpen, Clock, Tag, ArrowRight } from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { SearchResultItem } from "../../types";
import { formatSecondsToTime } from "../../utils/formatters";

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const { lectures, openLecture } = useLecture();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setIsSearching(true);
      const q = query.toLowerCase().trim();
      const matched: SearchResultItem[] = [];

      for (const lecture of lectures) {
        // Transcript search
        for (const seg of lecture.transcript) {
          if (seg.text.toLowerCase().includes(q)) {
            const ch = lecture.chapters.find((c) => seg.startTime >= c.startTime && seg.startTime <= c.endTime);
            matched.push({
              lectureId: lecture.id,
              lectureTitle: lecture.title,
              chapterTitle: ch ? ch.title : seg.topic || "Transcript",
              timestamp: seg.startTime,
              text: seg.text,
              matchType: "transcript",
            });
          }
        }

        // Notes & Definitions search
        for (const note of lecture.notes) {
          for (const def of note.definitions) {
            if (def.term.toLowerCase().includes(q) || def.definition.toLowerCase().includes(q)) {
              matched.push({
                lectureId: lecture.id,
                lectureTitle: lecture.title,
                chapterTitle: note.topic,
                timestamp: def.timestamp || note.sourceTimestamps[0]?.start || 0,
                text: `[Definition] ${def.term}: ${def.definition}`,
                matchType: "definitions",
              });
            }
          }
          for (const concept of note.keyConcepts) {
            if (concept.toLowerCase().includes(q)) {
              matched.push({
                lectureId: lecture.id,
                lectureTitle: lecture.title,
                chapterTitle: note.topic,
                timestamp: note.sourceTimestamps[0]?.start || 0,
                text: `[Concept] ${concept}`,
                matchType: "concept",
              });
            }
          }
        }
      }

      setResults(matched.slice(0, 15));
      setIsSearching(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, lectures]);

  if (!isOpen) return null;

  const handleSelectResult = (item: SearchResultItem) => {
    openLecture(item.lectureId, item.matchType === "transcript" ? "transcript" : "notes");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D]">
          <Search className="w-4 h-4 text-[#168A72] mr-3 shrink-0" />
          <input
            type="text"
            placeholder="Search all lectures, concepts, definitions, timestamps..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-transparent border-none text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-2 px-2 py-0.5 text-[11px] font-mono bg-[#E4EAE7] dark:bg-[#2C3B36] text-[#66736E] dark:text-[#9BA4A0] rounded-md"
          >
            ESC
          </button>
        </div>

        {/* Results Body */}
        <div className="overflow-y-auto p-4 flex-1 space-y-2.5">
          {query.trim() === "" ? (
            <div className="text-center py-10 text-[#9BA4A0] space-y-2">
              <BookOpen className="w-8 h-8 mx-auto text-[#168A72]/60" />
              <p className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                Search across all recorded lectures and synthesized study notes
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center pt-2">
                {["Stack Overflow", "Push Operation", "LIFO", "Queue Applications", "Time Complexity"].map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setQuery(tag)}
                    className="px-3 py-1 text-xs rounded-xl bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#168A72] hover:bg-[#E7F6F1] dark:hover:bg-[#1E3730] transition font-medium"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 text-xs text-[#9BA4A0]">
              <p>No matching lecture excerpts found for "{query}".</p>
            </div>
          ) : (
            results.map((res, idx) => (
              <button
                key={`${res.lectureId}-${idx}`}
                onClick={() => handleSelectResult(res)}
                className="w-full text-left p-4 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/50 shadow-xs transition group"
              >
                <div className="flex items-center justify-between text-xs text-[#66736E] dark:text-[#9BA4A0] mb-1.5">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7] group-hover:text-[#168A72] transition-colors">
                      {res.lectureTitle}
                    </span>
                    <span>•</span>
                    <span className="text-[#168A72] flex items-center gap-1 text-[11px] font-medium">
                      <Tag className="w-3 h-3" />
                      {res.chapterTitle}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 font-mono text-[11px] text-[#0F6B59] dark:text-[#23A98D] bg-[#E7F6F1] dark:bg-[#1E3730] px-2 py-0.5 rounded-full font-semibold">
                    <Clock className="w-3 h-3 text-[#168A72]" />
                    {formatSecondsToTime(res.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-[#17201D] dark:text-[#F1FAF7] line-clamp-2 leading-relaxed">
                  {res.text}
                </p>
                <div className="mt-2 flex items-center text-[11px] font-semibold text-[#168A72] opacity-0 group-hover:opacity-100 transition-opacity">
                  Jump to lecture position <ArrowRight className="w-3 h-3 ml-1" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
