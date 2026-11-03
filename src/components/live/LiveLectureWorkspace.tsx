import React, { useState, useEffect, useRef } from "react";
import {
  Pause,
  Play,
  Square,
  Sparkles,
  Clock,
  BookOpen,
  Tag,
  Lightbulb,
  AlertCircle,
  PanelRightClose,
  PanelRightOpen,
  Mic,
  Volume2,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";
import { AudioWaveform } from "../common/AudioWaveform";
import { formatSecondsToTime } from "../../utils/formatters";

export const LiveLectureWorkspace: React.FC = () => {
  const {
    activeLecture,
    liveSession,
    pauseLiveLecture,
    resumeLiveLecture,
    stopLiveLecture,
  } = useLecture();

  const [showInsights, setShowInsights] = useState(true);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll transcript to bottom as new speech arrives
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeLecture?.transcript]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.75rem)] bg-[#F8FAF8] dark:bg-[#121816] text-[#17201D] dark:text-[#F1FAF7] overflow-hidden font-sans">
      {/* 1. TOP STATUS & META BAR */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-white dark:bg-[#1B2421] border-b border-[#E4EAE7] dark:border-[#2C3B36] shrink-0">
        <div className="flex items-center space-x-3 truncate">
          {/* Status badge with green pulsing dot */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/20 text-xs font-semibold text-[#0F6B59] dark:text-[#23A98D]">
            <span
              className={`w-2 h-2 rounded-full ${
                liveSession.isPaused
                  ? "bg-[#9BA4A0]"
                  : "bg-[#168A72] animate-ping"
              }`}
            />
            <span>
              {liveSession.isPaused ? "Recording Paused" : "Live Recording"}
            </span>
          </div>

          <span className="text-[#E4EAE7] dark:text-[#2C3B36] hidden sm:inline">|</span>

          {/* Lecture Title & Subject */}
          <span className="font-semibold text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] truncate max-w-[200px] sm:max-w-md">
            {activeLecture?.title || "Live Lecture Discourse"}
          </span>

          <span className="text-[10px] text-[#0F6B59] dark:text-[#23A98D] bg-[#E7F6F1] dark:bg-[#1E3730] px-2 py-0.5 rounded-full font-semibold hidden md:inline">
            {activeLecture?.subject || "Subject"}
          </span>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          {/* Recording Timer in Monospace */}
          <div className="flex items-center gap-1.5 bg-[#F4F6F5] dark:bg-[#24302C] px-3 py-1 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] text-xs font-mono font-semibold text-[#17201D] dark:text-[#F1FAF7]">
            <Clock className="w-3.5 h-3.5 text-[#168A72]" />
            <span>{formatSecondsToTime(liveSession.duration)}</span>
          </div>

          {/* Toggle Live Insights Panel */}
          <button
            onClick={() => setShowInsights(!showInsights)}
            title="Toggle Live Insights"
            className="p-1.5 rounded-xl text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] transition"
          >
            {showInsights ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Error Alert if any */}
      {liveSession.errorMessage && (
        <div className="bg-[#FDF0ED] dark:bg-[#38241D] border-b border-[#E07A5F]/30 p-2.5 px-6 flex items-center gap-2 text-xs text-[#E07A5F]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{liveSession.errorMessage}</span>
        </div>
      )}

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex-1 flex overflow-hidden">
        {/* CENTER: Live Transcript Stream */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#F8FAF8] dark:bg-[#121816]">
          <div className="px-6 py-2.5 border-b border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-between bg-white/70 dark:bg-[#1B2421]/70">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#66736E] dark:text-[#9BA4A0] flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-[#168A72]" />
              Live Speech Transcript Stream
            </span>
            <span className="text-[11px] font-mono text-[#66736E] dark:text-[#9BA4A0] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#168A72] animate-pulse" />
              {activeLecture?.transcript.length || 0} segments recorded
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-4 max-w-3xl w-full mx-auto">
            {!activeLecture?.transcript || activeLecture.transcript.length === 0 ? (
              <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-center text-[#168A72] shadow-xs">
                  <Mic className="w-5 h-5 animate-pulse" />
                </div>
                <h4 className="font-semibold text-sm text-[#17201D] dark:text-[#F1FAF7]">
                  Listening for classroom speech...
                </h4>
                <p className="text-xs max-w-sm text-[#66736E] dark:text-[#9BA4A0] leading-relaxed">
                  Start speaking into your microphone. {APP_NAME} automatically converts spoken words into structured chapters, definitions, and smart notes.
                </p>
              </div>
            ) : (
              activeLecture.transcript.map((seg, idx) => (
                <div
                  key={seg.id || idx}
                  className={`p-4 rounded-2xl border transition-all animate-fade-in space-y-1.5 ${
                    seg.isDefinition
                      ? "bg-[#E7F6F1]/70 dark:bg-[#1E3730]/50 border-[#168A72]/30"
                      : "bg-white dark:bg-[#1B2421] border-[#E4EAE7] dark:border-[#2C3B36] shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-[#66736E] dark:text-[#9BA4A0]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#66736E] dark:text-[#9BA4A0]">
                        {seg.speaker || "Instructor"}
                      </span>
                      <span className="font-mono text-[11px] text-[#9BA4A0]">
                        [{formatSecondsToTime(seg.startTime)}]
                      </span>
                    </div>

                    {seg.topic && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] font-medium">
                        {seg.topic}
                      </span>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm leading-relaxed text-[#17201D] dark:text-[#F1FAF7]">
                    {seg.text}
                  </p>

                  {(seg.isDefinition || seg.isExample || seg.isImportant) && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] pt-1">
                      {seg.isDefinition && (
                        <span className="px-2 py-0.5 rounded-md bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] font-semibold">
                          Definition
                        </span>
                      )}
                      {seg.isExample && (
                        <span className="px-2 py-0.5 rounded-md bg-[#F4F6F5] dark:bg-[#24302C] text-[#66736E] dark:text-[#9BA4A0] font-medium">
                          Example
                        </span>
                      )}
                      {seg.isImportant && (
                        <span className="px-2 py-0.5 rounded-md bg-[#FDF0ED] dark:bg-[#38241D] text-[#E07A5F] font-semibold">
                          Key Concept
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* RIGHT: Live AI Insights Sidebar */}
        {showInsights && (
          <div className="w-80 border-l border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421] p-5 overflow-y-auto space-y-5 shrink-0 hidden md:block">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4EAE7] dark:border-[#2C3B36]">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#168A72]" />
                <span className="text-xs font-semibold tracking-wider text-[#17201D] dark:text-[#F1FAF7] uppercase">
                  Live Insights
                </span>
              </div>
              <span className="text-[10px] text-[#0F6B59] dark:text-[#23A98D] font-mono font-semibold bg-[#E7F6F1] dark:bg-[#1E3730] px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>

            {/* Active Topic Card */}
            <div className="p-3.5 rounded-2xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] space-y-1">
              <span className="text-[10px] font-semibold tracking-wider text-[#168A72] uppercase">
                Current Topic
              </span>
              <div className="text-xs sm:text-sm font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                {liveSession.currentTopic}
              </div>
            </div>

            {/* Identified Concepts */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#168A72]" />
                Identified Concepts
              </span>
              {liveSession.detectedConcepts.length === 0 ? (
                <p className="text-xs text-[#9BA4A0] italic">Listening for key concepts...</p>
              ) : (
                <div className="space-y-1.5">
                  {liveSession.detectedConcepts.map((c, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] text-xs text-[#17201D] dark:text-[#F1FAF7]"
                    >
                      • {c}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live Definitions */}
            {liveSession.detectedDefinitions.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[#168A72] flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" />
                  Key Definitions
                </span>
                <div className="space-y-1.5">
                  {liveSession.detectedDefinitions.map((d, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] border border-[#168A72]/20 text-xs text-[#17201D] dark:text-[#F1FAF7] leading-relaxed"
                    >
                      {d}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. BOTTOM RECORDING CONTROL BAR */}
      <div className="h-16 bg-white dark:bg-[#1B2421] border-t border-[#E4EAE7] dark:border-[#2C3B36] px-4 sm:px-8 flex items-center justify-between shrink-0">
        {/* Left: Waveform in Primary Brand Green */}
        <div className="flex items-center space-x-3">
          <AudioWaveform
            analyser={liveSession.audioAnalyser}
            isRecording={liveSession.isRecording}
            isPaused={liveSession.isPaused}
            className="w-24 sm:w-40 h-8"
            barColor="#168A72"
          />
          <div className="hidden sm:block text-xs">
            <div className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
              {liveSession.isPaused ? "Recording Paused" : "Microphone Active"}
            </div>
            <div className="text-[11px] font-mono text-[#66736E] dark:text-[#9BA4A0]">
              {formatSecondsToTime(liveSession.duration)}
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center space-x-2.5">
          {liveSession.isPaused ? (
            <button
              onClick={resumeLiveLecture}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] text-[#17201D] dark:text-[#F1FAF7] rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] transition"
            >
              <Play className="w-3.5 h-3.5 fill-current text-[#168A72]" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              onClick={pauseLiveLecture}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#F4F6F5] dark:bg-[#24302C] hover:bg-[#EAEFEA] text-[#17201D] dark:text-[#F1FAF7] rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] transition"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>
          )}

          <button
            onClick={stopLiveLecture}
            className="flex items-center gap-2 px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs transition"
          >
            <Square className="w-3.5 h-3.5 fill-current text-white" />
            <span>Finish & Generate Study Pack</span>
          </button>
        </div>
      </div>
    </div>
  );
};
