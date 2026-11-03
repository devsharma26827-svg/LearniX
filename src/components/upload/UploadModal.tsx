import React, { useState } from "react";
import { Upload, X, FileAudio, FileVideo, AlertCircle, Sparkles } from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { useAuth } from "../../context/AuthContext";
import { apiFetch } from "../../services/apiClient";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose }) => {
  const { fetchLectures, openLecture } = useLecture();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [instructor, setInstructor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selected = e.dataTransfer.files[0];
      setFile(selected);
      if (!title) {
        setTitle(selected.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      if (!title) {
        setTitle(selected.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !subject.trim()) {
      setError("Please provide a title and subject for this lecture.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setProgress(20);

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("subject", subject.trim());
    formData.append("instructor", instructor.trim() || "Course Professor");
    if (file) {
      formData.append("file", file);
    }

    try {
      setProgress(50);
      const token = localStorage.getItem("learnix_token") || "";
      const res = await apiFetch("/api/lectures/upload", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed. Please check file format.");
      }

      const data = await res.json();
      setProgress(100);
      await fetchLectures();
      onClose();
      openLecture(data.id, "overview");
    } catch (err: any) {
      setError(err.message || "Failed to upload lecture.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7]">
                Upload Lecture Media
              </h2>
              <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                Audio & video files (MP4, WEBM, MP3, WAV, M4A)
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

        {/* Modal Body Form */}
        <form onSubmit={handleUpload} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-[#FDF0ED] dark:bg-[#38241D] border border-[#E07A5F]/30 rounded-xl text-xs text-[#E07A5F] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Drag & Drop Area */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className={`border border-dashed rounded-2xl p-6 text-center transition cursor-pointer ${
              file
                ? "border-[#168A72] bg-[#E7F6F1]/40 dark:bg-[#1E3730]/40"
                : "border-[#E4EAE7] dark:border-[#2C3B36] hover:border-[#168A72] bg-[#F8FAF8] dark:bg-[#17201D]"
            }`}
          >
            <input
              type="file"
              id="lecture-file-input"
              accept="audio/*,video/*,.mp4,.webm,.mov,.mp3,.wav,.m4a"
              onChange={handleFileSelect}
              className="hidden"
            />
            <label htmlFor="lecture-file-input" className="cursor-pointer block">
              {file ? (
                <div className="flex items-center justify-center space-x-3 text-[#168A72] dark:text-[#23A98D]">
                  {file.type.startsWith("video") ? <FileVideo className="w-8 h-8" /> : <FileAudio className="w-8 h-8" />}
                  <div className="text-left">
                    <p className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7] truncate max-w-xs">{file.name}</p>
                    <p className="text-[11px] font-mono text-[#66736E] dark:text-[#9BA4A0]">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Upload className="w-6 h-6 mx-auto text-[#168A72]" />
                  <p className="text-xs font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                    Drop media file here, or <span className="text-[#168A72] underline">browse files</span>
                  </p>
                  <p className="text-[11px] text-[#66736E] dark:text-[#9BA4A0]">MP4, WEBM, MP3, WAV up to 100MB</p>
                </div>
              )}
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5">
              Lecture Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Graph Algorithms & Shortest Path"
              className="w-full px-3.5 py-2.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5">
                Discipline / Subject *
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Computer Science"
                className="w-full px-3.5 py-2.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5">
                Instructor
              </label>
              <input
                type="text"
                value={instructor}
                onChange={(e) => setInstructor(e.target.value)}
                placeholder="e.g. Prof. Davis"
                className="w-full px-3.5 py-2.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72]"
              />
            </div>
          </div>

          {/* Progress bar if uploading */}
          {isUploading && (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs text-[#66736E] dark:text-[#9BA4A0]">
                <span>Processing media and generating study materials...</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-[#F4F6F5] dark:bg-[#24302C] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#168A72] transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-end space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-5 py-2 text-xs font-semibold rounded-xl bg-[#168A72] hover:bg-[#0F6B59] text-white transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isUploading ? "Processing..." : "Upload & Analyze"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
