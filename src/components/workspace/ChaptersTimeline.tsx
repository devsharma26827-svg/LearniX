import React from "react";
import { Chapter } from "../../types";
import { formatSecondsToTime } from "../../utils/formatters";
import { Clock } from "lucide-react";

interface ChaptersTimelineProps {
  chapters: Chapter[];
  onSelectChapter?: (chapter: Chapter) => void;
  onSeekTimestamp?: (time: number) => void;
  selectedChapterId?: string;
}

export const ChaptersTimeline: React.FC<ChaptersTimelineProps> = ({
  chapters,
  onSelectChapter,
  onSeekTimestamp,
  selectedChapterId,
}) => {
  return (
    <div className="max-w-3xl space-y-6 animate-fade-in font-sans">
      <div className="border-b border-[#E4EAE7] dark:border-[#2C3B36] pb-3">
        <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
          Lecture Index & Timeline ({chapters.length} Chapters)
        </h2>
      </div>

      {/* Minimal Vertical Timeline */}
      <div className="relative pl-6 space-y-8 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-[#E4EAE7] dark:before:bg-[#2C3B36]">
        {chapters.map((ch, idx) => {
          const isSelected = selectedChapterId === ch.id;

          return (
            <div key={ch.id} className="relative group">
              {/* Brand Green Timeline Marker */}
              <div
                className={`absolute -left-[23px] top-1.5 w-3 h-3 rounded-full transition-transform ${
                  isSelected
                    ? "bg-[#168A72] ring-4 ring-[#E7F6F1] dark:ring-[#1E3730] scale-110"
                    : "bg-[#168A72] group-hover:scale-125"
                }`}
              />

              <div className="space-y-1.5">
                {/* Header: Title + Square Bracket Timestamp */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    {idx + 1}. {ch.title}
                  </h3>

                  <button
                    onClick={() => onSeekTimestamp?.(ch.startTime)}
                    className="font-mono text-xs text-[#66736E] dark:text-[#9BA4A0] hover:text-[#168A72] dark:hover:text-[#23A98D] transition-colors flex items-center gap-1"
                  >
                    <Clock className="w-3 h-3 text-[#9BA4A0]" />
                    <span>[{formatSecondsToTime(ch.startTime)} – {formatSecondsToTime(ch.endTime)}]</span>
                  </button>
                </div>

                {/* Summary Description */}
                <p className="text-xs sm:text-sm text-[#66736E] dark:text-[#9BA4A0] leading-relaxed max-w-2xl">
                  {ch.description}
                </p>

                {/* Concepts as subtle muted pills */}
                {ch.keyConcepts && ch.keyConcepts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {ch.keyConcepts.map((concept, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-0.5 text-[11px] rounded-full bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0]"
                      >
                        {concept}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
