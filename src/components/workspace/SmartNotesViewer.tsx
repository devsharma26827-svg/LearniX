import React, { useState } from "react";
import { motion } from "motion/react";
import {
  Clock,
  Sparkles,
  Code2,
} from "lucide-react";
import { SmartNote } from "../../types";
import { formatSecondsToTime } from "../../utils/formatters";
import {
  PAGE_CONTAINER_VARIANTS,
  SECTION_ITEM_VARIANTS,
} from "../../utils/motionVariants";

interface SmartNotesViewerProps {
  notes: SmartNote[];
  onSeekTimestamp?: (time: number) => void;
}

export const SmartNotesViewer: React.FC<SmartNotesViewerProps> = ({
  notes,
  onSeekTimestamp,
}) => {
  const [selectedTopic, setSelectedTopic] = useState<string>("all");

  const topics = Array.from(new Set(notes.map((n) => n.topic)));
  const filteredNotes =
    selectedTopic === "all"
      ? notes
      : notes.filter((n) => n.topic === selectedTopic);

  return (
    <motion.div
      variants={PAGE_CONTAINER_VARIANTS}
      initial="hidden"
      animate="visible"
      className="max-w-4xl space-y-7 font-sans"
    >
      {/* Header & Topic Filter */}
      <motion.div
        variants={SECTION_ITEM_VARIANTS}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] pb-4"
      >
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
              Curated AI Study Notes
            </h2>
          </div>
          <p className="text-xs text-[#66736E] dark:text-[#9BA4A0] mt-0.5">
            Structured study notes extracted from the lecture with precise timestamp anchors
          </p>
        </div>

        {/* Minimal Buttons for Topic Filtering */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedTopic("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl whitespace-nowrap transition-all duration-150 cursor-pointer ${
              selectedTopic === "all"
                ? "bg-[#168A72] text-white font-semibold shadow-2xs"
                : "bg-white dark:bg-[#1B2421] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] border border-[#E4EAE7] dark:border-[#2C3B36]"
            }`}
          >
            All Topics ({notes.length})
          </button>
          {topics.map((topic) => (
            <button
              key={topic}
              onClick={() => setSelectedTopic(topic)}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl whitespace-nowrap transition-all duration-150 cursor-pointer ${
                selectedTopic === topic
                  ? "bg-[#168A72] text-white font-semibold shadow-2xs"
                  : "bg-white dark:bg-[#1B2421] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] border border-[#E4EAE7] dark:border-[#2C3B36]"
              }`}
            >
              {topic}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Study Notes Document Stream */}
      <motion.div variants={SECTION_ITEM_VARIANTS} className="space-y-7">
        {filteredNotes.map((note) => (
          <article
            key={note.id}
            className="p-6 sm:p-8 border border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] hover:border-[#168A72]/30 transition-colors duration-150 rounded-2xl shadow-xs space-y-6"
          >
            {/* Note Heading & Timestamp Ref */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36] gap-2">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#17201D] dark:text-[#F1FAF7]">
                  {note.topic}
                </h3>
                <div className="flex items-center space-x-2 text-xs text-[#66736E] dark:text-[#9BA4A0] mt-1 font-mono tabular-nums">
                  {note.sourceTimestamps.map((ts, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSeekTimestamp?.(ts.start)}
                      className="hover:text-[#168A72] dark:hover:text-[#23A98D] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Clock className="w-3 h-3 text-[#9BA4A0]" />
                      <span>
                        [{formatSecondsToTime(ts.start)} –{" "}
                        {formatSecondsToTime(ts.end)}]
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Concepts as subtle tags */}
              <div className="flex flex-wrap items-center gap-1.5">
                {note.keyConcepts.map((c, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-0.5 text-[11px] rounded-full font-medium bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* Note Core Summary */}
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-[#168A72] dark:text-[#23A98D] uppercase tracking-wider block">
                Executive Overview
              </span>
              <p className="text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                {note.summary}
              </p>
            </div>

            {/* Key Definitions in Soft Mint Callout */}
            {note.definitions && note.definitions.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
                  Key Definitions
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {note.definitions.map((def, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/20 space-y-1"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#0F6B59] dark:text-[#23A98D]">
                          {def.term}
                        </span>
                        {def.timestamp && (
                          <button
                            onClick={() => onSeekTimestamp?.(def.timestamp!)}
                            className="text-[10px] font-mono tabular-nums text-[#168A72] dark:text-[#23A98D] hover:underline cursor-pointer"
                          >
                            @{formatSecondsToTime(def.timestamp)}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                        {def.definition}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step-by-step Procedures & Execution Rules */}
            {note.procedures && note.procedures.length > 0 && (
              <div className="space-y-2 pt-1">
                <h4 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
                  Execution Invariants & Protocols
                </h4>
                <ul className="space-y-2 text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                  {note.procedures.map((p, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#168A72] dark:bg-[#23A98D] mt-2 shrink-0" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Real World Deployments & Complexity Bounds */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36]">
              {note.examples && note.examples.length > 0 && (
                <div className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-[#F8FAF8] dark:bg-[#17201D]">
                  <h5 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#168A72] dark:text-[#23A98D]" />
                    Real-World Deployments
                  </h5>
                  <ul className="text-xs text-[#66736E] dark:text-[#9BA4A0] space-y-1.5 list-disc list-inside leading-relaxed">
                    {note.examples.map((ex, i) => (
                      <li key={i}>{ex}</li>
                    ))}
                  </ul>
                </div>
              )}

              {note.formulas && note.formulas.length > 0 && (
                <div className="p-4 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-[#F8FAF8] dark:bg-[#17201D]">
                  <h5 className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] mb-2 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-[#168A72] dark:text-[#23A98D]" />
                    Complexity Bounds & Math
                  </h5>
                  <ul className="text-xs font-mono text-[#66736E] dark:text-[#9BA4A0] space-y-1.5">
                    {note.formulas.map((f, i) => (
                      <li key={i}>• {f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </article>
        ))}
      </motion.div>
    </motion.div>
  );
};
