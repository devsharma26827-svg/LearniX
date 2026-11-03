import React, { useState } from "react";
import { Download, X } from "lucide-react";
import { Lecture } from "../../types";
import { generateLecturePdf } from "../../utils/pdfGenerator";

interface PdfExportModalProps {
  lecture: Lecture;
  isOpen: boolean;
  onClose: () => void;
}

export const PdfExportModal: React.FC<PdfExportModalProps> = ({ lecture, isOpen, onClose }) => {
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeChapters, setIncludeChapters] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [includeWeakTopics, setIncludeWeakTopics] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = () => {
    setIsExporting(true);
    setTimeout(() => {
      generateLecturePdf(lecture, {
        includeSummary,
        includeChapters,
        includeNotes,
        includeQuiz,
        includeWeakTopics,
      });
      setIsExporting(false);
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7]">
                Export Study Guide
              </h2>
              <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                Generate printable PDF study packet
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="p-6 space-y-4">
          <div className="space-y-2 text-xs text-[#17201D] dark:text-[#F1FAF7]">
            <label className="flex items-center space-x-3 p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] cursor-pointer select-none hover:border-[#168A72]/40 transition">
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={(e) => setIncludeSummary(e.target.checked)}
                className="w-4 h-4 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72]"
              />
              <span className="font-semibold">Lecture Summary & Key Concepts</span>
            </label>

            <label className="flex items-center space-x-3 p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] cursor-pointer select-none hover:border-[#168A72]/40 transition">
              <input
                type="checkbox"
                checked={includeChapters}
                onChange={(e) => setIncludeChapters(e.target.checked)}
                className="w-4 h-4 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72]"
              />
              <span className="font-semibold">Thematic Chapters & Timestamps</span>
            </label>

            <label className="flex items-center space-x-3 p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] cursor-pointer select-none hover:border-[#168A72]/40 transition">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="w-4 h-4 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72]"
              />
              <span className="font-semibold">Structured Notes & Terminology</span>
            </label>

            <label className="flex items-center space-x-3 p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] cursor-pointer select-none hover:border-[#168A72]/40 transition">
              <input
                type="checkbox"
                checked={includeQuiz}
                onChange={(e) => setIncludeQuiz(e.target.checked)}
                className="w-4 h-4 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72]"
              />
              <span className="font-semibold">Quiz Questions & Explanations</span>
            </label>

            <label className="flex items-center space-x-3 p-3.5 rounded-xl bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] cursor-pointer select-none hover:border-[#168A72]/40 transition">
              <input
                type="checkbox"
                checked={includeWeakTopics}
                onChange={(e) => setIncludeWeakTopics(e.target.checked)}
                className="w-4 h-4 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72]"
              />
              <span className="font-semibold">Diagnostic Revision Plan</span>
            </label>
          </div>

          <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-end space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] transition"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-5 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] text-white transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isExporting ? "Generating PDF..." : "Download PDF"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
