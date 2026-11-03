import React, { useState, useEffect } from "react";
import { Search, Play, Pause, RotateCcw, Volume2, Copy, Check } from "lucide-react";
import { TranscriptSegment } from "../../types";
import { formatSecondsToTime } from "../../utils/formatters";

interface TranscriptViewerProps {
  transcript: TranscriptSegment[];
  onSeekTimestamp?: (time: number) => void;
  selectedTimestamp?: number;
}

export const TranscriptViewer: React.FC<TranscriptViewerProps> = ({
  transcript,
  onSeekTimestamp,
  selectedTimestamp,
}) => {
  const [search, setSearch] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(selectedTimestamp || 0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const totalDuration =
    transcript.length > 0 ? transcript[transcript.length - 1].endTime : 3600;

  // Handle seeking from outside
  useEffect(() => {
    if (selectedTimestamp !== undefined) {
      setCurrentTime(selectedTimestamp);
    }
  }, [selectedTimestamp]);

  // Simulated audio playback progression
  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= totalDuration) {
            setIsPlaying(false);
            return totalDuration;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying, totalDuration]);

  const filtered = transcript.filter((seg) => {
    return (
      search.trim() === "" ||
      seg.text.toLowerCase().includes(search.toLowerCase()) ||
      seg.topic?.toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSeek = (time: number) => {
    setCurrentTime(time);
    onSeekTimestamp?.(time);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs overflow-hidden font-sans">
      {/* Search Bar at Top */}
      <div className="p-3.5 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-[#9BA4A0] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search transcript speech or keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-white dark:bg-[#1B2421] text-xs text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
          />
        </div>
        <span className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
          {filtered.length} of {transcript.length} segments
        </span>
      </div>

      {/* Transcript Document Body */}
      <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-[#9BA4A0] text-xs">
            No matching transcript sections found.
          </div>
        ) : (
          filtered.map((seg) => {
            const isCurrentlyPlaying =
              currentTime >= seg.startTime && currentTime <= seg.endTime;

            return (
              <div
                key={seg.id}
                className={`p-4 rounded-xl transition-colors group ${
                  isCurrentlyPlaying
                    ? "bg-[#E7F6F1]/60 dark:bg-[#1E3730]/40 border-l-4 border-[#168A72]"
                    : "hover:bg-[#F8FAF8] dark:hover:bg-[#17201D]"
                }`}
              >
                {/* Header: Speaker & Bracket Timestamp */}
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider">
                      {seg.speaker || "Instructor"}
                    </span>
                    <button
                      onClick={() => handleSeek(seg.startTime)}
                      className="font-mono text-xs text-[#9BA4A0] hover:text-[#168A72] transition-colors"
                    >
                      [{formatSecondsToTime(seg.startTime)}]
                    </button>
                    {seg.topic && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0]">
                        {seg.topic}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleCopy(seg.id, seg.text)}
                    className="opacity-0 group-hover:opacity-100 text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] transition p-1"
                    title="Copy text"
                  >
                    {copiedId === seg.id ? (
                      <Check className="w-3.5 h-3.5 text-[#168A72]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Clean Document Paragraph */}
                <p className="text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                  {seg.text}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Audio Player at Bottom */}
      <div className="p-3.5 border-t border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] flex flex-col gap-2">
        {/* Progress Bar in Brand Green */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            handleSeek(Math.round(pos * totalDuration));
          }}
          className="w-full h-1.5 bg-[#E4EAE7] dark:border-[#2C3B36] rounded-full cursor-pointer relative overflow-hidden"
        >
          <div
            className="h-full bg-[#168A72] rounded-full transition-all"
            style={{ width: `${(currentTime / totalDuration) * 100}%` }}
          />
        </div>

        {/* Controls and Timestamps */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-7 h-7 rounded-full bg-[#168A72] text-white flex items-center justify-center hover:bg-[#0F6B59] transition shadow-xs"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />}
            </button>

            <button
              onClick={() => handleSeek(0)}
              className="text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] p-1"
              title="Restart audio playback"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="font-mono text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
            <span>{formatSecondsToTime(currentTime)}</span>
            <span className="mx-1">/</span>
            <span>{formatSecondsToTime(totalDuration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
