import React, { useState } from "react";
import {
  Send,
  Loader2,
  Clock,
  Sparkles,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { RagResponse } from "../../types";
import { formatSecondsToTime } from "../../utils/formatters";

interface AskLecturePanelProps {
  onSeekTimestamp?: (time: number) => void;
}

interface QAPair {
  question: string;
  response: RagResponse;
  timestamp: string;
}

const PRESET_QUESTIONS = [
  "What is Stack Overflow and when does it happen?",
  "What are the main operations of a Queue and their complexities?",
  "What real-world applications did the professor mention?",
  "Explain the difference between LIFO and FIFO.",
  "When did the teacher explain the Pop operation?",
];

export const AskLecturePanel: React.FC<AskLecturePanelProps> = ({ onSeekTimestamp }) => {
  const { askLectureQuestion } = useLecture();
  const [inputQuery, setInputQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<QAPair[]>([
    {
      question: "What is Stack Overflow and when does it occur?",
      response: {
        answer:
          "According to the lecture, Stack Overflow is an error condition that occurs when an attempt is made to push a new element onto a stack that has already reached its maximum allocated memory capacity (top == MAX - 1).",
        sources: [
          {
            chapterTitle: "Stack Errors: Overflow and Underflow",
            timestampStart: 1450,
            timestampEnd: 2050,
            snippet:
              "Stack overflow occurs when we attempt to push an element onto a stack that is already full (top == MAX - 1).",
            confidence: 0.98,
          },
        ],
        suggestedFollowUps: [
          "How is Stack Underflow prevented?",
          "What is the time complexity of the Push operation?",
        ],
      },
      timestamp: "Just now",
    },
  ]);

  const handleAsk = async (queryText: string) => {
    if (!queryText.trim() || isLoading) return;

    const q = queryText.trim();
    setInputQuery("");
    setIsLoading(true);

    try {
      const resp = await askLectureQuestion(q);
      setHistory((prev) => [
        ...prev,
        {
          question: q,
          response: resp,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err: any) {
      console.error("Ask lecture error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xs overflow-hidden font-sans">
      {/* Header Banner */}
      <div className="p-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold tracking-wider text-[#66736E] dark:text-[#9BA4A0] uppercase">
            Ask the Lecture
          </h3>
          <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">
            Study assistant grounded directly in this lecture transcript
          </p>
        </div>

        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D]">
          100% Grounded Citations
        </span>
      </div>

      {/* Chat Thread */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {history.map((item, idx) => (
          <div key={idx} className="space-y-3">
            {/* User Question */}
            <div className="flex justify-end">
              <div className="bg-[#E7F6F1] dark:bg-[#1E3730] text-[#17201D] dark:text-[#F1FAF7] px-4 py-2.5 rounded-2xl rounded-tr-xs text-xs sm:text-sm max-w-lg leading-relaxed shadow-xs font-medium">
                {item.question}
              </div>
            </div>

            {/* AI Assistant Answer Card */}
            <div className="flex items-start space-x-3">
              <div className="w-7 h-7 rounded-xl bg-[#168A72] text-white flex items-center justify-center shrink-0 mt-1 shadow-xs">
                <Sparkles className="w-3.5 h-3.5" />
              </div>

              <div className="flex-1 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl p-4 sm:p-5 text-xs sm:text-sm space-y-4 shadow-xs">
                <p className="text-[#17201D] dark:text-[#F1FAF7] leading-relaxed">
                  {item.response.answer}
                </p>

                {/* Sources & Timestamp Citation */}
                {item.response.sources && item.response.sources.length > 0 && (
                  <div className="pt-2 border-t border-[#E4EAE7] dark:border-[#2C3B36] space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.response.sources.map((src, sIdx) => (
                        <button
                          key={sIdx}
                          onClick={() => onSeekTimestamp?.(src.timestampStart)}
                          className="px-3 py-1 text-[11px] font-mono rounded-xl bg-white dark:bg-[#1B2421] text-[#168A72] dark:text-[#23A98D] border border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72] transition flex items-center gap-1.5 font-semibold"
                        >
                          <Clock className="w-3 h-3 text-[#9BA4A0]" />
                          <span>
                            Source: [{formatSecondsToTime(src.timestampStart)}] {src.chapterTitle}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Follow ups */}
                {item.response.suggestedFollowUps && item.response.suggestedFollowUps.length > 0 && (
                  <div className="pt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">Follow-up:</span>
                    {item.response.suggestedFollowUps.map((fu, fIdx) => (
                      <button
                        key={fIdx}
                        onClick={() => handleAsk(fu)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-[#1B2421] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] border border-[#E4EAE7] dark:border-[#2C3B36] transition"
                      >
                        {fu}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center space-x-2 text-xs text-[#168A72] animate-pulse p-3.5 bg-[#E7F6F1]/50 dark:bg-[#1E3730]/40 rounded-xl border border-[#168A72]/20">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="font-medium">Searching spoken audio index and formulating verified answer...</span>
          </div>
        )}
      </div>

      {/* Suggested Questions Pills */}
      <div className="px-4 py-2 border-t border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider font-semibold shrink-0">
          Suggested:
        </span>
        {PRESET_QUESTIONS.map((pq, idx) => (
          <button
            key={idx}
            onClick={() => handleAsk(pq)}
            className="px-2.5 py-1 text-[11px] whitespace-nowrap rounded-lg bg-white dark:bg-[#1B2421] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] hover:bg-[#F4F6F5] dark:hover:bg-[#24302C] border border-[#E4EAE7] dark:border-[#2C3B36] transition"
          >
            {pq}
          </button>
        ))}
      </div>

      {/* Input Field at Bottom */}
      <div className="p-3.5 border-t border-[#E4EAE7] dark:border-[#2C3B36] bg-white dark:bg-[#1B2421]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk(inputQuery);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Ask anything about this lecture..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl bg-white dark:bg-[#17201D] text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72] transition"
          />
          <button
            type="submit"
            disabled={isLoading || !inputQuery.trim()}
            className="px-4 py-2.5 bg-[#168A72] hover:bg-[#0F6B59] text-white disabled:opacity-40 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-xs shrink-0"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};
