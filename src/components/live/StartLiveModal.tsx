import React, { useState, useEffect } from "react";
import { Mic, X, AlertCircle, BookOpen, User, Languages, Check } from "lucide-react";
import { useLecture } from "../../context/LectureContext";
import { APP_NAME } from "../../config/branding";
import { Teacher, Subject, Topic } from "../../types";

interface StartLiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUPPORTED_LANGUAGES = [
  { code: "auto", label: "Auto-Detect (Multilingual)", flag: "🌐" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "Hindi (हिन्दी)", flag: "🇮🇳" },
  { code: "hinglish", label: "Hinglish (Hindi + English)", flag: "🇮🇳" },
  { code: "bn", label: "Bengali (বাংলা)", flag: "🇮🇳" },
  { code: "ta", label: "Tamil (தமிழ்)", flag: "🇮🇳" },
  { code: "te", label: "Telugu (తెలుగు)", flag: "🇮🇳" },
  { code: "mr", label: "Marathi (मराठी)", flag: "🇮🇳" },
  { code: "es", label: "Spanish (Español)", flag: "🇪🇸" },
];

export const StartLiveModal: React.FC<StartLiveModalProps> = ({ isOpen, onClose }) => {
  const { startLiveLecture } = useLecture();

  // Master data state
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  // Selected master references
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("auto");

  // Free-text lecture fields (pre-filled from master selections or customizable)
  const [title, setTitle] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [instructorName, setInstructorName] = useState("");

  // Consent & execution state
  // REQUIREMENT: Microphone consent MUST be initialized to false (unchecked by default)
  const [consentChecked, setConsentChecked] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingMaster, setIsLoadingMaster] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load master teachers and initial subjects on modal open
  useEffect(() => {
    if (!isOpen) return;

    setConsentChecked(false);
    setError(null);
    setIsLoadingMaster(true);

    const loadInitialData = async () => {
      try {
        const token = localStorage.getItem("learnix_token") || "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        const [teachersRes, subjectsRes] = await Promise.all([
          fetch("/api/master/teachers", { headers, credentials: "include" }),
          fetch("/api/master/subjects", { headers, credentials: "include" }),
        ]);

        if (teachersRes.ok && subjectsRes.ok) {
          const teachersData: Teacher[] = await teachersRes.json();
          const subjectsData: Subject[] = await subjectsRes.json();

          setTeachers(teachersData);
          setSubjects(subjectsData);

          if (teachersData.length > 0) {
            const firstTeacher = teachersData[0];
            setSelectedTeacherId(firstTeacher.id);
            setInstructorName(firstTeacher.name);
          }

          if (subjectsData.length > 0) {
            const firstSubject = subjectsData[0];
            setSelectedSubjectId(firstSubject.id);
            setSubjectName(firstSubject.subjectName);
            setTitle(`${firstSubject.subjectName} Lecture`);
          }
        }
      } catch (err) {
        console.warn("Could not load master data:", err);
      } finally {
        setIsLoadingMaster(false);
      }
    };

    loadInitialData();
  }, [isOpen]);

  // When selected teacher changes, reload subjects associated with teacher
  useEffect(() => {
    if (!isOpen || !selectedTeacherId) return;

    const teacher = teachers.find((t) => t.id === selectedTeacherId);
    if (teacher) {
      setInstructorName(teacher.name);
    }

    const loadTeacherSubjects = async () => {
      try {
        const token = localStorage.getItem("learnix_token") || "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        const res = await fetch(`/api/master/subjects?teacherId=${selectedTeacherId}`, {
          headers,
          credentials: "include",
        });

        if (res.ok) {
          const data: Subject[] = await res.json();
          setSubjects(data);
          if (data.length > 0) {
            // If current selected subject is not taught by this teacher, switch to first
            if (!data.some((s) => s.id === selectedSubjectId)) {
              const firstSub = data[0];
              setSelectedSubjectId(firstSub.id);
              setSubjectName(firstSub.subjectName);
              setTitle(`${firstSub.subjectName} Lecture`);
            }
          }
        }
      } catch (err) {
        console.warn("Could not filter subjects by teacher:", err);
      }
    };

    loadTeacherSubjects();
  }, [selectedTeacherId, isOpen]);

  // When selected subject changes, reload topics for that subject
  useEffect(() => {
    if (!isOpen || !selectedSubjectId) {
      setTopics([]);
      setSelectedTopicIds([]);
      return;
    }

    const sub = subjects.find((s) => s.id === selectedSubjectId);
    if (sub) {
      setSubjectName(sub.subjectName);
      if (!title || title.endsWith("Lecture")) {
        setTitle(`${sub.subjectName} Lecture`);
      }
    }

    const loadSubjectTopics = async () => {
      try {
        const token = localStorage.getItem("learnix_token") || "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        const res = await fetch(`/api/master/topics?subjectId=${selectedSubjectId}`, {
          headers,
          credentials: "include",
        });

        if (res.ok) {
          const data: Topic[] = await res.json();
          setTopics(data);
          setSelectedTopicIds([]);
        }
      } catch (err) {
        console.warn("Could not load topics for subject:", err);
      }
    };

    loadSubjectTopics();
  }, [selectedSubjectId, isOpen]);

  if (!isOpen) return null;

  const toggleTopic = (topicId: string, topicName: string) => {
    setSelectedTopicIds((prev) => {
      const exists = prev.includes(topicId);
      const next = exists ? prev.filter((id) => id !== topicId) : [...prev, topicId];
      if (!exists && (!title || title.endsWith("Lecture"))) {
        setTitle(topicName);
      }
      return next;
    });
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !subjectName.trim()) {
      setError("Please provide both lecture title and subject.");
      return;
    }
    if (!consentChecked) {
      setError("Please acknowledge microphone recording consent to continue.");
      return;
    }

    setError(null);
    setIsStarting(true);
    const success = await startLiveLecture(
      title.trim(),
      subjectName.trim(),
      instructorName.trim(),
      {
        teacherId: selectedTeacherId || undefined,
        subjectId: selectedSubjectId || undefined,
        topicIds: selectedTopicIds.length > 0 ? selectedTopicIds : undefined,
        language: selectedLanguage,
      }
    );
    setIsStarting(false);
    if (success) {
      onClose();
    } else {
      setError("Could not access microphone. Please check browser permissions and try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in font-sans">
      <div className="bg-white dark:bg-[#1B2421] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D] shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-[#E7F6F1] dark:bg-[#1E3730] text-[#0F6B59] dark:text-[#23A98D] flex items-center justify-center">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#17201D] dark:text-[#F1FAF7]">
                Start Live Lecture
              </h2>
              <p className="text-xs text-[#66736E] dark:text-[#9BA4A0]">
                Real-time multilingual transcription & AI study pack generation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleStart} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-[#FDF0ED] dark:bg-[#38241D] border border-[#E07A5F]/30 rounded-xl text-xs text-[#E07A5F] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Cascading Relational Master Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 1. Teacher Selector */}
            <div>
              <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#168A72]" />
                Instructor / Teacher
              </label>
              <select
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72]"
              >
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.designation})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Subject Selector */}
            <div>
              <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-[#168A72]" />
                Course / Subject *
              </label>
              <select
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72]"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.subjectCode} · {s.subjectName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Topics Pill Selection */}
          {topics.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5">
                Topics Covered (Select to focus notes & quiz)
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 rounded-xl border border-[#E4EAE7] dark:border-[#2C3B36] bg-[#F8FAF8] dark:bg-[#17201D]">
                {topics.map((top) => {
                  const isSelected = selectedTopicIds.includes(top.id);
                  return (
                    <button
                      type="button"
                      key={top.id}
                      onClick={() => toggleTopic(top.id, top.topicName)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 cursor-pointer ${
                        isSelected
                          ? "bg-[#168A72] text-white shadow-2xs"
                          : "bg-white dark:bg-[#232F2B] text-[#66736E] dark:text-[#9BA4A0] hover:text-[#17201D] dark:hover:text-[#F1FAF7] border border-[#E4EAE7] dark:border-[#2C3B36]"
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                      <span>{top.topicName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Spoken Language Selector */}
          <div>
            <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-[#168A72]" />
              Spoken Language / Dialect
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              className="w-full px-3 py-2 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-[#17201D] dark:text-[#F1FAF7] focus:outline-none focus:border-[#168A72]"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[#66736E] dark:text-[#9BA4A0] mt-1">
              Supports mixed classroom speech (e.g. Hindi + English terms). Preserves original speech verbatim without translating.
            </p>
          </div>

          {/* 5. Lecture Title */}
          <div>
            <label className="block text-xs font-semibold text-[#66736E] dark:text-[#9BA4A0] uppercase tracking-wider mb-1.5">
              Lecture Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Stack Basics & Push/Pop Pointer Operations"
              className="w-full px-3.5 py-2.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs sm:text-sm text-[#17201D] dark:text-[#F1FAF7] placeholder-[#9BA4A0] focus:outline-none focus:border-[#168A72]"
            />
          </div>

          {/* Privacy & Microphone Consent Notice (Unchecked by default) */}
          <div className="p-3.5 bg-[#F8FAF8] dark:bg-[#17201D] border border-[#E4EAE7] dark:border-[#2C3B36] rounded-xl text-xs text-[#66736E] dark:text-[#9BA4A0]">
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                id="mic-consent"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 rounded border-[#E4EAE7] text-[#168A72] focus:ring-[#168A72] cursor-pointer"
              />
              <label htmlFor="mic-consent" className="cursor-pointer select-none leading-relaxed text-[11px]">
                <span className="font-semibold text-[#17201D] dark:text-[#F1FAF7]">
                  Microphone Recording Consent
                </span>
                : I authorize {APP_NAME} to access my microphone to record and transcribe this lecture. Audio is processed for learning pack synthesis and can be paused or stopped at any moment.
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-[#E4EAE7] dark:border-[#2C3B36] flex items-center justify-end space-x-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#66736E] hover:text-[#17201D] dark:text-[#9BA4A0] dark:hover:text-[#F1FAF7] rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isStarting || !consentChecked}
              className="px-5 py-2 text-xs font-semibold bg-[#168A72] hover:bg-[#0F6B59] text-white rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>{isStarting ? "Connecting Mic..." : "Start Recording"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
